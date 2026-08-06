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

  /** 이 달 산정기준이 아무것도 없으면 true — 금액은 0이고 '급여 미산정' 으로 표시한다 */
  noPayroll: boolean;
  /**
   * 이 달 산정기준 임금이 어디서 왔는가.
   * MANUAL(관리자 지정) > PAYROLL(그 달 급여) > ESTIMATED(계약 추산) > NONE
   */
  baseSource: "MANUAL" | "PAYROLL" | "ESTIMATED" | "NONE";
  /** 지정·추산값의 근거·사유 (급여에서 나온 달은 빈 문자열) */
  baseNote: string;
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
  /** 누계에 섞인 '계약 추산' 달 수 — 실제 급여가 아니라는 것을 화면이 알려야 한다 */
  estimatedMonths: number;
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
  // 누계를 위해 **입사 이후 전체**를 읽는다 (이 달치는 그중 하나)
  const [all, overrides] = await Promise.all([
    prisma.payrollRecord.findMany({
      where: { employeeId: { in: ids } },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    }),
    prisma.severanceMonthlyBase.findMany({ where: { employeeId: { in: ids } } }),
  ]);
  const payrollAt = new Map<string, (typeof all)[number]>();
  for (const r of all) payrollAt.set(`${r.employeeId}:${r.year}:${r.month}`, r);
  const baseAt = new Map<string, (typeof overrides)[number]>();
  for (const o of overrides) baseAt.set(`${o.employeeId}:${o.year}:${o.month}`, o);

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
    const accrues = v.status === "DC" || v.status === "PROVISION";

    /**
     * 한 달의 산정기준 임금 — **MANUAL > 급여 레코드 > ESTIMATED**.
     *
     * 사람이 고친 값이 가장 세고, 실제 급여가 있으면 추산보다 그쪽이 맞다
     * (추산은 '급여가 없을 때 메우는 값' 이므로 실제 급여를 이기면 안 된다).
     */
    const resolve = (
      y: number,
      m: number
    ): {
      base: number;
      source: SeveranceRow["baseSource"];
      note: string;
      rec?: (typeof all)[number];
      breakdown?: ReturnType<typeof severanceBase>;
    } => {
      const key = `${e.id}:${y}:${m}`;
      const rec = payrollAt.get(key);
      const ov = baseAt.get(key);
      if (ov?.source === "MANUAL")
        return { base: ov.base, source: "MANUAL", note: ov.note ?? "", rec };
      if (rec) {
        const b = severanceBase(payItemsOf(rec), policy);
        return { base: b.base, source: "PAYROLL", note: "", rec, breakdown: b };
      }
      if (ov) return { base: ov.base, source: "ESTIMATED", note: ov.note ?? "" };
      return { base: 0, source: "NONE", note: "" };
    };

    // --- 이 달 ---
    const cur = resolve(year, month);
    const b = cur.breakdown ?? severanceBase(payItemsOf(cur.rec ?? {}), policy);
    const amount = accrues && cur.source !== "NONE" ? monthlyAccrual(cur.base, policy) : 0;
    // 경고는 급여 레코드로 산정한 달에만 뜻이 있다 — 지정·추산값은 항목별 내역이 없다
    const warning =
      accrues && cur.source === "PAYROLL" ? underMinimumWarning(b, policy) : null;
    if (warning) warnings.push(`${e.name}: ${warning}`);

    // --- 누계 — 입사한 달부터 이 달까지 **모든 달**을 돈다 ---
    // 급여 레코드만 훑으면 도입 이전(추산으로 메운) 달이 통째로 빠진다.
    // 각 달의 단계는 그 달 기준으로 다시 판정한다. 지금 대상이 아닌 사람(위탁·초단시간)은
    // 과거분도 쌓지 않는다: 판정이 바뀌었다면 화면에서 보고 사람이 처리할 일이다.
    let cumulativeProvision = 0;
    let cumulativeDc = 0;
    let estimatedMonths = 0;
    if (accrues) {
      let y = e.hireDate.getUTCFullYear();
      let m = e.hireDate.getUTCMonth() + 1;
      while (y < year || (y === year && m <= month)) {
        const r = resolve(y, m);
        if (r.source !== "NONE") {
          const rv = severanceVerdict(subject, monthEnd(y, m), policy);
          if (rv.status === "DC" || rv.status === "PROVISION") {
            const amt = monthlyAccrual(r.base, policy);
            if (rv.status === "DC") cumulativeDc += amt;
            else cumulativeProvision += amt;
            if (r.source === "ESTIMATED") estimatedMonths++;
          }
        }
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
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
      noPayroll: cur.source === "NONE",
      payrollSent: cur.rec?.status === "SENT",
      baseSource: cur.source,
      baseNote: cur.note,
      base: cur.base,
      amount,
      note:
        cur.source === "PAYROLL"
          ? accrualNote(b, amount, v.status === "DC" ? "DC" : "PROVISION", policy)
          : cur.note,
      included: cur.source === "PAYROLL" ? b.included : [],
      excluded: cur.source === "PAYROLL" ? b.excluded : [],
      warning,
      retention: cur.rec?.retentionD ?? 0,
      cumulative: cumulativeProvision + cumulativeDc,
      cumulativeProvision,
      cumulativeDc,
      estimatedMonths,
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
  /** 이 달 기준급여가 '계약 추산' 인 인원 — 실제 급여가 아니라는 것을 화면이 알려야 한다 */
  estimatedCount: number;
  /** 이 달 기준급여를 관리자가 직접 지정한 인원 */
  manualCount: number;
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
  estimatedCount: 0,
  manualCount: 0,
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
    if (r.status === "DC" || r.status === "PROVISION") {
      if (r.baseSource === "NONE") t.noPayrollCount++;
      else if (r.baseSource === "ESTIMATED") t.estimatedCount++;
      else if (r.baseSource === "MANUAL") t.manualCount++;
    }
  }
  return t;
}

export type SeveranceMonth = Awaited<ReturnType<typeof severanceMonth>>;
