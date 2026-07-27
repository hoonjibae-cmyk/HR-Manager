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
  "hireDate",
  "resignDate",
  "active",
  "dependents",
  "nonTaxTotal",
  "breakPaid",
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

/** templateKey → 급여형태 (역변환) */
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
  ratioPercent: number | null;
  ratioMinGuarantee?: number | null;
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
    ratioPercent: c.ratioPercent ?? null,
    ratioMinGuarantee: c.ratioMinGuarantee ?? null,
    fixedBaseHours: c.fixedBaseHours ?? null,
    fixedOtHours: c.fixedOtHours ?? null,
    fixedNightHours: c.fixedNightHours ?? null,
  };
}

/**
 * 직원 카드의 보수 필드를 '오늘 시점 지배 계약' 값으로 맞춘다.
 * 계약을 만들거나 고친 뒤 호출한다. (미래 시작 계약은 발효일 전까지 반영되지 않는다)
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
 * 새 계약 시작일에 맞춰 직전 계약의 종료일을 닫는다 (빈틈·중복 방지).
 * 반환: 닫은 계약 id 목록
 */
export async function closePrecedingContracts(employeeId: number, newStart: Date) {
  const cutoff = addDays(newStart, -1);
  const prior = await prisma.contract.findMany({
    where: {
      employeeId,
      status: { not: "DRAFT" },
      startDate: { lt: dayStart(newStart) },
    },
  });
  const closed: number[] = [];
  for (const c of prior) {
    const needsClose = !c.endDate || dayStart(c.endDate).getTime() > cutoff.getTime();
    if (!needsClose) continue;
    await prisma.contract.update({
      where: { id: c.id },
      data: { endDate: cutoff, status: "EXPIRED" },
    });
    closed.push(c.id);
  }
  return closed;
}
