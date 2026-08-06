// 퇴직급여(DC 부담금 · 충당금) ↔ 급여 레코드의 DB 어댑터.
// 엔진(lib/severance.ts)은 DB 를 모른다 — 재료를 여기서 모아 넘기고 화면이 쓸 형태로 돌려준다.
//
// **저장하지 않고 그때그때 산정한다.** 퇴직급여는 그 달 급여에서 파생되는 값이라,
// 급여를 정정하면(잠금 해제 → 재산정) 따라 바뀌어야 한다. 따로 저장해 두면 정정한 달의
// 적립액이 옛 금액으로 남아 누계가 조용히 어긋난다.

import { prisma } from "./db";
import { parseSchedule, isContractorContract, PAY_SCHEME_LABEL } from "./constants";
import { computeWeeklyHours } from "./payroll";
import {
  DEFAULT_SEVERANCE_POLICY,
  severanceVerdict,
  severanceBase,
  monthlyAccrual,
  accrualNote,
  underMinimumWarning,
  type SeverancePolicy,
  type SeveranceStatus,
  type SeverancePayItems,
} from "./severance";

/** 산정 조건 (없으면 만들어 준다 — 화면에서 수정) */
export async function getSeverancePolicy(): Promise<SeverancePolicy & { id: number }> {
  const row = await prisma.severancePolicy.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return row as any;
}

const payItemsOf = (r: any): SeverancePayItems => ({
  baseP: r.baseP ?? 0,
  weeklyHolidayP: r.weeklyHolidayP ?? 0,
  positionP: r.positionP ?? 0,
  mealP: r.mealP ?? 0,
  carP: r.carP ?? 0,
  unusedLeaveP: r.unusedLeaveP ?? 0,
  incentiveP: r.incentiveP ?? 0,
  bonusP: r.bonusP ?? 0,
  extraP: r.extraP ?? 0,
  overtimeP: r.overtimeP ?? 0,
  nightP: r.nightP ?? 0,
  holidayP: r.holidayP ?? 0,
  // 포괄임금 약정분과 그 달 변동분을 가르는 재료 — 금액만으로는 갈리지 않는다
  extraHours: r.extraHours ?? 0,
  overtimeHours: r.overtimeHours ?? 0,
  nightHours: r.nightHours ?? 0,
  holidayHours: r.holidayHours ?? 0,
  holidayOverHours: r.holidayOverHours ?? 0,
  hourlyWage: r.hourlyWage ?? 0,
});

/** 그 달 마지막 날 (KST 벽시계를 UTC 필드에 담는 앱 규칙 그대로) */
const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0));

export interface SeveranceRow {
  employeeId: number;
  empNo: string;
  name: string;
  department: string | null;
  payScheme: string;
  paySchemeLabel: string;
  /** YYYY-MM-DD */
  hireDate: string;
  /** "1년 6개월" */
  serviceLabel: string;
  /** 정렬용 — 근속 개월수 */
  serviceMonths: number;
  weeklyContractual: number;
  status: SeveranceStatus;
  statusReason: string;
  /** DC 부담금이 시작되는 날 (YYYY-MM-DD) */
  dcStartsAt: string;

  /** 이 달 급여가 아직 없으면 true — 금액은 0이고 '급여 미산정' 으로 표시한다 */
  noPayroll: boolean;
  /** 이 달 급여가 발송(SENT)돼 확정된 상태인가 */
  payrollSent: boolean;
  /** 이 달 산정기준 임금 */
  base: number;
  /** 이 달 적립액 (충당금 또는 부담금) */
  amount: number;
  /** 산입·제외 근거 */
  note: string;
  included: Array<[string, number]>;
  excluded: Array<[string, number, string]>;
  /** 법정 하한 미달 소지 경고 (없으면 null) */
  warning: string | null;

  /** 이 달 인센티브 퇴직유보금 — 퇴직급여의 다른 갈래라 나란히 보여준다 */
  retention: number;

  /** 입사 이후 누계 (이 달 포함) */
  cumulative: number;
  /** 그중 DC 가입 전 충당금 누계 = **DC 전환 시 소급 납입할 몫** */
  cumulativeProvision: number;
  /** DC 부담금 누계 */
  cumulativeDc: number;
}

function serviceLabelOf(hireDate: Date, asOf: Date): { label: string; months: number } {
  let months =
    (asOf.getUTCFullYear() - hireDate.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - hireDate.getUTCMonth());
  if (asOf.getUTCDate() < hireDate.getUTCDate()) months -= 1;
  months = Math.max(months, 0);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const label = y ? (m ? `${y}년 ${m}개월` : `${y}년`) : `${m}개월`;
  return { label, months };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 한 달 퇴직급여 산정 — 직원별.
 *
 * 누계까지 함께 낸다. 충당금 누계는 **DC 전환 때 소급해서 넣어야 할 금액**이라
 * 그 달 금액만 보여주면 정작 필요한 숫자가 화면에 없다.
 */
export async function severanceMonth(year: number, month: number) {
  const asOf = monthEnd(year, month);
  const policy = await getSeverancePolicy();

  // 그 달에 재직한 직원만 — 입사 전이거나 이미 퇴사한 사람은 적립할 것이 없다
  const emps = await prisma.employee.findMany({
    where: {
      hireDate: { lte: asOf },
      OR: [{ resignDate: null }, { resignDate: { gte: new Date(Date.UTC(year, month - 1, 1)) } }],
    },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });
  if (!emps.length)
    return { rows: [] as SeveranceRow[], policy, totals: emptyTotals(), warnings: [] as string[] };

  const ids = emps.map((e) => e.id);
  // 누계를 위해 **입사 이후 전체** 급여 레코드를 읽는다 (이 달치는 그중 하나)
  const all = await prisma.payrollRecord.findMany({
    where: { employeeId: { in: ids } },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  const byEmp = new Map<number, typeof all>();
  for (const r of all) {
    const arr = byEmp.get(r.employeeId) ?? [];
    arr.push(r);
    byEmp.set(r.employeeId, arr);
  }

  const rows: SeveranceRow[] = [];
  const warnings: string[] = [];

  for (const e of emps) {
    const schedule = parseSchedule(e.schedule);
    const hasSchedule = schedule.some((d) => d.work);
    const { weeklyContractual } = computeWeeklyHours(schedule);
    const subject = {
      hireDate: e.hireDate,
      contractor: isContractorContract(e),
      weeklyContractual,
      hasSchedule,
    };
    const v = severanceVerdict(subject, asOf, policy);
    const svc = serviceLabelOf(e.hireDate, asOf);

    const records = byEmp.get(e.id) ?? [];
    const thisMonth = records.find((r) => r.year === year && r.month === month);

    // 이 달
    const items = thisMonth ? payItemsOf(thisMonth) : payItemsOf({});
    const b = severanceBase(items, policy);
    const accrues = v.status === "DC" || v.status === "PROVISION";
    const amount = accrues && thisMonth ? monthlyAccrual(b.base, policy) : 0;
    const warning = accrues && thisMonth ? underMinimumWarning(b, policy) : null;
    if (warning) warnings.push(`${e.name}: ${warning}`);

    // 누계 — 각 달의 단계를 그 달 기준으로 다시 판정한다.
    // 지금 대상이 아닌 사람(위탁·초단시간)은 과거분도 쌓지 않는다: 판정이 바뀌었다면
    // 그 사실을 화면에서 보고 사람이 처리할 일이지, 조용히 소급해 쌓을 일이 아니다.
    let cumulativeProvision = 0;
    let cumulativeDc = 0;
    if (accrues) {
      for (const r of records) {
        if (r.year > year || (r.year === year && r.month > month)) break;
        const rEnd = monthEnd(r.year, r.month);
        const rv = severanceVerdict(subject, rEnd, policy);
        if (rv.status !== "DC" && rv.status !== "PROVISION") continue;
        const amt = monthlyAccrual(severanceBase(payItemsOf(r), policy).base, policy);
        if (rv.status === "DC") cumulativeDc += amt;
        else cumulativeProvision += amt;
      }
    }

    rows.push({
      employeeId: e.id,
      empNo: e.empNo,
      name: e.name,
      department: e.department,
      payScheme: e.payScheme,
      paySchemeLabel: PAY_SCHEME_LABEL[e.payScheme] ?? e.payScheme,
      hireDate: ymd(e.hireDate),
      serviceLabel: svc.label,
      serviceMonths: svc.months,
      weeklyContractual: Math.round(weeklyContractual * 10) / 10,
      status: v.status,
      statusReason: v.reason,
      dcStartsAt: ymd(v.dcStartsAt),
      noPayroll: !thisMonth,
      payrollSent: thisMonth?.status === "SENT",
      base: thisMonth ? b.base : 0,
      amount,
      note: thisMonth ? accrualNote(b, amount, v.status === "DC" ? "DC" : "PROVISION", policy) : "",
      included: thisMonth ? b.included : [],
      excluded: thisMonth ? b.excluded : [],
      warning,
      retention: thisMonth?.retentionD ?? 0,
      cumulative: cumulativeProvision + cumulativeDc,
      cumulativeProvision,
      cumulativeDc,
    });
  }

  return { rows, policy, totals: totalsOf(rows), warnings };
}

export interface SeveranceTotals {
  /** 이 달 DC 부담금 합계 (실제로 납입할 돈) */
  dc: number;
  /** 이 달 충당금 합계 (아직 나가지 않는 적립) */
  provision: number;
  /** 이 달 인센티브 퇴직유보금 합계 — 퇴직급여의 다른 갈래 */
  retention: number;
  /** 충당금 누계 합계 = DC 전환 때 소급 납입할 몫 */
  provisionCumulative: number;
  dcCount: number;
  provisionCount: number;
  excludedCount: number;
  unknownCount: number;
  noPayrollCount: number;
}

const emptyTotals = (): SeveranceTotals => ({
  dc: 0,
  provision: 0,
  retention: 0,
  provisionCumulative: 0,
  dcCount: 0,
  provisionCount: 0,
  excludedCount: 0,
  unknownCount: 0,
  noPayrollCount: 0,
});

function totalsOf(rows: SeveranceRow[]): SeveranceTotals {
  const t = emptyTotals();
  for (const r of rows) {
    if (r.status === "DC") {
      t.dc += r.amount;
      t.dcCount++;
    } else if (r.status === "PROVISION") {
      t.provision += r.amount;
      t.provisionCount++;
    } else if (r.status === "UNKNOWN") t.unknownCount++;
    else t.excludedCount++;
    t.retention += r.retention;
    t.provisionCumulative += r.cumulativeProvision;
    if (r.noPayroll && (r.status === "DC" || r.status === "PROVISION")) t.noPayrollCount++;
  }
  return t;
}

export type SeveranceMonth = Awaited<ReturnType<typeof severanceMonth>>;
