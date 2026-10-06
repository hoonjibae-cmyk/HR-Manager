// 계약 = 보수조건의 단일 진실(single source of truth).
//
// 원칙
//  1) 계약서 PDF·급여 산정·직원 카드 표시는 모두 '그 시점을 지배하는 계약'을 읽는다.
//  2) 계약은 입사일부터 오늘(또는 퇴사일)까지 날짜 빈틈 없이 이어져야 한다.
//     신규 계약을 만들면 직전 계약의 종료일이 자동으로 '신규 시작일 −1일'로 닫힌다.
//  3) 직원 카드의 보수 필드는 지배 계약을 비추는 거울(mirror)일 뿐, 수정 수단이 아니다.
//     인적사항만 카드에서 수정하고, 보수조건은 계약을 새로 쓰거나 고쳐서 바꾼다.

import { prisma } from "./db";

/** 계약서에 스냅샷으로 남는 보수조건 */
export const CONTRACT_TERM_FIELDS = [
  "baseWage",
  "positionAllow",
  "mealAllow",
  "carAllow",
  "ratioPercent",
  "ratioMinGuarantee",
  "incThreshold",
  "incPerStudent",
  "incRevenuePercent",
  "fixedBaseHours",
  "fixedOtHours",
  "fixedNightHours",
] as const;

/** 직원 카드에서 수정할 수 있는 항목 — 인적사항·소속·근태 설정만 */
export const EMPLOYEE_EDITABLE_FIELDS = [
  "name",
  "rrn",
  "birth",
  "department",
  "position",
  "duty",
  "address",
  "phone",
  "email",
  "slackUserId",
  "bankName",
  "bankAccount",
  "bankHolder",
  "retentionBank",
  "retentionAccount",
  "hireDate",
  "resignDate",
  "active",
  "dependents",
  "nonTaxTotal",
  "breakPaid",
  "leaveEligible",
  "schedule",
] as const;

/** 계약이 정하므로 직원 카드에서는 수정할 수 없는 항목 */
export const CONTRACT_OWNED_FIELDS = [
  ...CONTRACT_TERM_FIELDS,
  "payScheme",
  "incomeType",
] as const;

export function templateKeyOf(payScheme: string): string {
  switch (payScheme) {
    case "HOURLY":
      return "HOURLY";
    case "RATIO":
      return "RATIO";
    case "INCENTIVE":
      return "INCENTIVE";
    default:
      return "MONTHLY";
  }
}

/**
 * templateKey → 급여형태. **모르는 종류면 null** 을 돌려준다.
 *
 * `paySchemeOf` 는 모르는 값을 조용히 MONTHLY 로 떨어뜨린다 — 화면 기본값으로는 쓸 만하지만,
 * 보수를 계산할 때 그러면 시급제 계약이 월급제로 읽혀 금액이 통째로 틀어진다.
 * 계산하는 자리에서는 이쪽을 쓰고 null 이면 직원 카드로 물러난다(`?? employee.payScheme`).
 */
export function paySchemeOfTemplate(templateKey: string): string | null {
  if (templateKey === "INCENTIVE") return "INCENTIVE";
  if (templateKey === "RATIO") return "RATIO";
  if (templateKey === "HOURLY") return "HOURLY";
  if (templateKey === "MONTHLY" || templateKey === "REGULAR") return "MONTHLY";
  return null;
}

/** templateKey → 급여형태 (역변환). 모르는 종류는 MONTHLY 로 본다 */
export function paySchemeOf(templateKey: string): string {
  switch (templateKey) {
    case "HOURLY":
      return "HOURLY";
    case "RATIO":
      return "RATIO";
    case "INCENTIVE":
      return "INCENTIVE";
    default:
      return "MONTHLY";
  }
}

export interface ContractLike {
  id?: number;
  startDate: Date;
  endDate: Date | null;
  templateKey: string;
  incomeType?: string | null;
  baseWage: number;
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  incThreshold: number | null;
  incPerStudent: number | null;
  /** 매출 비율 인센티브 (0.15 = 15%) */
  incRevenuePercent?: number | null;
  ratioPercent: number | null;
  ratioMinGuarantee?: number | null;
  /** 위탁계약(프리랜서) — 근로기준법 항목 일절 미적용 */
  isContractor?: boolean | null;
  fixedBaseHours?: number | null;
  fixedOtHours?: number | null;
  fixedNightHours?: number | null;
}

const DAY = 86400000;
const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const addDays = (d: Date, n: number) => new Date(dayStart(d).getTime() + n * DAY);

/**
 * asOf 시점을 지배하는 계약.
 * 시작일이 asOf 이전인 계약 중 가장 늦게 시작한 것. (빈틈이 없다는 전제 — 빈틈은 contractIssues 가 잡는다)
 */
export function governingContract<T extends { startDate: Date; id?: number }>(
  contracts: T[],
  asOf: Date
): T | null {
  const at = dayStart(asOf).getTime();
  const started = contracts.filter((c) => dayStart(c.startDate).getTime() <= at);
  if (!started.length) return null;
  return started.reduce((best, c) => {
    const a = dayStart(c.startDate).getTime();
    const b = dayStart(best.startDate).getTime();
    if (a !== b) return a > b ? c : best;
    return (c.id ?? 0) > (best.id ?? 0) ? c : best;
  });
}

export type IssueKind = "before-first" | "between" | "after-last" | "overlap" | "none";

export interface ContractIssue {
  kind: IssueKind;
  from: Date;
  to: Date;
  message: string;
}

const fmt = (d: Date) => dayStart(d).toISOString().slice(0, 10);

/**
 * 계약 이력의 날짜 빈틈·중복 점검.
 * 재직 중이면 오늘까지, 퇴사자면 퇴사일까지 덮여 있어야 한다.
 */
export function contractIssues(
  emp: { hireDate: Date; resignDate?: Date | null; active?: boolean },
  contracts: Array<{ startDate: Date; endDate: Date | null }>,
  asOf: Date = new Date()
): ContractIssue[] {
  const coverTo = emp.resignDate ? dayStart(emp.resignDate) : dayStart(asOf);
  const hire = dayStart(emp.hireDate);
  if (coverTo.getTime() < hire.getTime()) return [];

  const list = [...contracts].sort(
    (a, b) => dayStart(a.startDate).getTime() - dayStart(b.startDate).getTime()
  );
  const issues: ContractIssue[] = [];

  if (!list.length) {
    return [
      {
        kind: "before-first",
        from: hire,
        to: coverTo,
        message: `계약이 없습니다 — ${fmt(hire)} ~ ${fmt(coverTo)} 구간을 덮는 계약을 만들어 주세요.`,
      },
    ];
  }

  const first = dayStart(list[0].startDate);
  if (first.getTime() > hire.getTime()) {
    issues.push({
      kind: "before-first",
      from: hire,
      to: addDays(first, -1),
      message: `입사일부터 첫 계약 시작 전까지 계약이 없습니다 (${fmt(hire)} ~ ${fmt(addDays(first, -1))}).`,
    });
  }

  for (let i = 0; i < list.length - 1; i++) {
    const cur = list[i];
    const next = dayStart(list[i + 1].startDate);
    if (!cur.endDate) {
      // 기한 없는 계약 뒤에 새 계약이 있으면 종료일이 닫히지 않은 것 — 중복 구간
      issues.push({
        kind: "overlap",
        from: next,
        to: next,
        message: `${fmt(dayStart(cur.startDate))} 계약의 종료일이 비어 있어 다음 계약(${fmt(next)})과 겹칩니다.`,
      });
      continue;
    }
    const end = dayStart(cur.endDate);
    const gapFrom = addDays(end, 1);
    if (gapFrom.getTime() < next.getTime()) {
      issues.push({
        kind: "between",
        from: gapFrom,
        to: addDays(next, -1),
        message: `계약 사이에 빈 기간이 있습니다 (${fmt(gapFrom)} ~ ${fmt(addDays(next, -1))}).`,
      });
    } else if (end.getTime() >= next.getTime()) {
      issues.push({
        kind: "overlap",
        from: next,
        to: end,
        message: `계약 기간이 겹칩니다 (${fmt(next)} ~ ${fmt(end)}).`,
      });
    }
  }

  const last = list[list.length - 1];
  if (last.endDate) {
    const end = dayStart(last.endDate);
    if (end.getTime() < coverTo.getTime()) {
      issues.push({
        kind: "after-last",
        from: addDays(end, 1),
        to: coverTo,
        message: `마지막 계약이 ${fmt(end)} 에 끝났습니다 — 이후 ${fmt(
          addDays(end, 1)
        )} ~ ${fmt(coverTo)} 구간의 계약이 없습니다.`,
      });
    }
  }

  return issues;
}

/** 지배 계약 → 직원 카드에 비출 값 */
export function mirrorFromContract(c: ContractLike): Record<string, any> {
  return {
    payScheme: paySchemeOf(c.templateKey),
    ...(c.incomeType ? { incomeType: c.incomeType } : {}),
    baseWage: c.baseWage,
    positionAllow: c.positionAllow,
    mealAllow: c.mealAllow,
    carAllow: c.carAllow,
    incThreshold: c.incThreshold ?? null,
    incPerStudent: c.incPerStudent ?? null,
    incRevenuePercent: c.incRevenuePercent ?? null,
    ratioPercent: c.ratioPercent ?? null,
    ratioMinGuarantee: c.ratioMinGuarantee ?? null,
    // 위탁계약 여부도 계약이 진실 — 완전비율제는 성질상 언제나 위탁이다
    isContractor: c.isContractor === true || paySchemeOf(c.templateKey) === "RATIO",
    fixedBaseHours: c.fixedBaseHours ?? null,
    fixedOtHours: c.fixedOtHours ?? null,
    fixedNightHours: c.fixedNightHours ?? null,
  };
}

/**
 * 그 달 급여 조건을 정하는 기준일 — 그 달 **마지막 재직일**(말일, 그 전에 퇴사했으면 퇴사일).
 * 월중에 조건이 바뀌면 바뀐 뒤 조건을 쓴다(기본급·수당의 일할가중은 따로 한다 — wageSegmentsFor).
 */
export function monthTermsDate(
  emp: { resignDate?: Date | null },
  year: number,
  month: number
): Date {
  const monthEnd = new Date(Date.UTC(year, month, 0));
  return emp.resignDate && emp.resignDate < monthEnd ? emp.resignDate : monthEnd;
}

/**
 * 직원 카드에 'asOf 시점 지배 계약' 의 보수조건을 덮어씌운 **사본** (순수 함수).
 *
 * 카드는 '오늘' 을 비추는 거울이라 **그 달** 급여에 그대로 쓰면 틀린다 —
 * 발효일 전에 미리 만든 계약(8월에 작성한 9/1 계약)은 만들 때 카드에 반영되지 않고,
 * 발효일이 지나도 카드를 다시 맞추는 일이 없어 9월 급여가 옛 조건(기준인원 40명)으로
 * 산정됐다(김지연 9월 — 계약은 37명). 거꾸로 지난달을 다시 산정할 때는 카드가 이미
 * 새 조건이라 옛 달에 새 조건이 들어간다. 그래서 급여는 **그 달 계약**을 읽는다.
 * 계약이 없으면 카드 그대로 둔다(계약 도입 전 직원).
 */
export function withContractTerms<T extends Record<string, any>>(
  emp: T,
  contracts: Array<ContractLike & { status?: string }>,
  asOf: Date
): T {
  const gov = governingContract(
    contracts.filter((c) => c.status !== "DRAFT"),
    asOf
  );
  if (!gov) return emp;
  const m = mirrorFromContract(gov);
  // 모르는 templateKey 를 월급제로 떨어뜨리지 않는다 — 카드의 급여형태로 물러난다
  m.payScheme = paySchemeOfTemplate(gov.templateKey) ?? emp.payScheme;
  m.isContractor = gov.isContractor === true || m.payScheme === "RATIO";
  return { ...emp, ...m };
}

/** 직원들에게 그 달(year·month) 계약 조건을 덮어씌운 사본 — 급여 산정·명단 반영·명세서용 */
export async function employeesWithMonthTerms<
  T extends { id: number; resignDate?: Date | null } & Record<string, any>
>(emps: T[], year: number, month: number): Promise<T[]> {
  if (!emps.length) return emps;
  const contracts = await prisma.contract.findMany({
    where: { employeeId: { in: emps.map((e) => e.id) }, status: { not: "DRAFT" } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  const byEmp = new Map<number, typeof contracts>();
  for (const c of contracts) {
    const arr = byEmp.get(c.employeeId) ?? [];
    arr.push(c);
    byEmp.set(c.employeeId, arr);
  }
  return emps.map((e) =>
    withContractTerms(e, (byEmp.get(e.id) ?? []) as any, monthTermsDate(e, year, month))
  );
}

/**
 * 발효일이 지난 계약을 카드에 반영한다 — 카드가 지배 계약과 다른 직원만 고친다.
 * 크론이 매시 부른다. 미래 시작 계약은 만들 때 카드에 안 들어가고, 그 뒤로 카드를 다시
 * 맞추는 길이 없어 발효일이 지나도 카드(그리고 카드를 읽는 화면·연차수당·퇴직급여)가
 * 옛 조건에 머물렀다.
 */
export async function refreshStaleEmployeeCards(asOf: Date = new Date()) {
  const emps = await prisma.employee.findMany({
    where: { contracts: { some: { status: { not: "DRAFT" } } } },
    include: {
      contracts: {
        where: { status: { not: "DRAFT" } },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
      },
    },
  });
  const fixed: Array<{ id: number; name: string; fields: string[] }> = [];
  for (const e of emps) {
    const gov = governingContract(e.contracts, asOf);
    if (!gov) continue;
    const want = mirrorFromContract(gov as ContractLike);
    const diff = Object.keys(want).filter((k) => (e as any)[k] !== want[k]);
    if (!diff.length) continue;
    await prisma.employee.update({ where: { id: e.id }, data: want });
    fixed.push({ id: e.id, name: e.name, fields: diff });
  }
  return { fixed };
}

/**
 * 직원 카드의 보수 필드를 '오늘 시점 지배 계약' 값으로 맞춘다.
 * 계약을 만들거나 고친 뒤 호출한다. (미래 시작 계약은 발효일 전까지 반영되지 않는다 —
 * 발효일이 지나면 크론의 refreshStaleEmployeeCards 가 맞춘다)
 */
export async function refreshEmployeeCard(employeeId: number, asOf: Date = new Date()) {
  const contracts = await prisma.contract.findMany({
    where: { employeeId, status: { not: "DRAFT" } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  const gov = governingContract(contracts, asOf);
  if (!gov) return { updated: false as const };
  await prisma.employee.update({
    where: { id: employeeId },
    data: mirrorFromContract(gov as ContractLike),
  });
  return { updated: true as const, contractId: gov.id };
}

/**
 * 계약의 '지금 실제 상태'.
 * 저장된 status 는 마지막으로 손댄 시점의 값이라 시간이 지나면 뒤처진다
 * (어제 끝난 계약이 화면에 ACTIVE 로 남는다). 화면은 항상 이 값을 쓴다.
 */
export function effectiveContractStatus(
  c: { endDate: Date | null; status: string },
  asOf: Date = new Date()
): string {
  // 사람이 명시적으로 정한 상태는 날짜로 뒤집지 않는다
  if (c.status === "DRAFT" || c.status === "TERMINATED") return c.status;
  if (c.endDate && dayStart(c.endDate).getTime() < dayStart(asOf).getTime()) return "EXPIRED";
  return "ACTIVE";
}

export interface TimelineFix {
  id: number;
  /** 다음 계약이 덮는 만큼 잘라낸 종료일 */
  endDate?: Date;
  /** 날짜에 맞춰 다시 매긴 상태 */
  status?: string;
}

/**
 * 계약 이력을 앞뒤가 맞게 정리한다 (순수 함수 — DB 무관).
 *
 *  1) 뒤 계약이 시작하면 앞 계약은 그 전날로 닫는다. 종료일이 비어 있어도 닫는다.
 *  2) 종료일이 지난 계약은 EXPIRED, 아직 유효하면 ACTIVE.
 *
 * 종료일을 늘리지는 않는다 — 덮이지 않은 빈 기간은 contractIssues() 가 알리고
 * 사람이 판단할 몫이다. 여기서 임의로 늘리면 없던 계약기간이 생겨버린다.
 */
export function planContractTimeline<
  T extends { id: number; startDate: Date; endDate: Date | null; status: string }
>(contracts: T[], asOf: Date = new Date()): TimelineFix[] {
  const list = [...contracts]
    .filter((c) => c.status !== "DRAFT")
    .sort(
      (a, b) =>
        dayStart(a.startDate).getTime() - dayStart(b.startDate).getTime() || a.id - b.id
    );
  const today = dayStart(asOf).getTime();
  const fixes: TimelineFix[] = [];

  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const next = list[i + 1];
    const fix: TimelineFix = { id: c.id };
    let endDate = c.endDate;

    if (next) {
      const cutoff = addDays(next.startDate, -1);
      if (!endDate || dayStart(endDate).getTime() > cutoff.getTime()) {
        endDate = cutoff;
        fix.endDate = cutoff;
      }
    }

    const shouldBe =
      c.status === "TERMINATED"
        ? "TERMINATED"
        : endDate && dayStart(endDate).getTime() < today
        ? "EXPIRED"
        : "ACTIVE";
    if (shouldBe !== c.status) fix.status = shouldBe;

    if (fix.endDate !== undefined || fix.status !== undefined) fixes.push(fix);
  }
  return fixes;
}

/**
 * 위 계획을 실제로 적용한다. 계약을 만들거나 고치거나 지운 뒤에 호출한다.
 *
 * 신규 계약 하나만 보고 직전 계약을 닫는 방식으로는 부족했다 —
 *  · 이미 끝난 계약은 종료일을 손댈 필요가 없어 상태가 ACTIVE 로 남았고,
 *  · 과거 날짜로 계약을 나중에 끼워 넣으면 그 뒤 계약과의 관계가 정리되지 않았다.
 * 그래서 매번 그 직원의 이력 전체를 다시 맞춘다.
 */
export async function normalizeContractTimeline(
  employeeId: number,
  asOf: Date = new Date()
): Promise<TimelineFix[]> {
  const list = await prisma.contract.findMany({
    where: { employeeId, status: { not: "DRAFT" } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  const fixes = planContractTimeline(list, asOf);
  for (const { id, ...data } of fixes) {
    await prisma.contract.update({ where: { id }, data });
  }
  return fixes;
}
