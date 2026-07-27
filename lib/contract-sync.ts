// 직원 카드 ↔ 계약서 보수조건 동기화
//
// 계약서 PDF 와 급여 산정은 모두 Contract 스냅샷을 읽는다(lib/doc-service, lib/payroll-service).
// 직원 카드만 고치면 문서·급여에 반영되지 않으므로, 카드에서 '실제로 바뀐' 보수조건을
// 진행 중(ACTIVE) 계약에도 반영한다.
//
// 규칙:
//  - 대상은 ACTIVE 계약 하나뿐. 신규계약 생성 시 이전 계약은 EXPIRED 로 넘어가므로
//    ACTIVE = 직원 카드가 비추고 있는 계약이다. (미래 시작 계약도 동일 — 카드가 선반영 상태)
//  - EXPIRED 계약(지난 이력)은 절대 건드리지 않는다.
//  - 요청 본문에 담겨 온 값이 아니라 '기존 직원 값과 달라진 항목'만 반영한다.
//    (폼이 전체 필드를 보내므로, 전화번호만 고쳤는데 임금까지 덮어쓰는 사고를 막는다)

import { prisma } from "./db";

/** 계약서에 스냅샷으로 남는 보수조건 */
export const CONTRACT_TERM_FIELDS = [
  "baseWage",
  "positionAllow",
  "mealAllow",
  "carAllow",
  "ratioPercent",
  "incThreshold",
  "incPerStudent",
] as const;

export type ContractTermField = (typeof CONTRACT_TERM_FIELDS)[number];

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

const eq = (a: any, b: any) => (a ?? null) === (b ?? null);

/**
 * 카드 수정분 중 계약에 반영할 항목 추출.
 * @param patch  employee.update 에 넘길 데이터 (요청 본문에서 뽑아낸 것)
 * @param before 수정 전 직원 레코드
 */
export function contractTermDiff(
  patch: Record<string, any>,
  before: Record<string, any>
): { data: Record<string, any>; changed: string[] } {
  const data: Record<string, any> = {};
  const changed: string[] = [];
  for (const f of CONTRACT_TERM_FIELDS) {
    if (!(f in patch)) continue;
    if (eq(patch[f], before[f])) continue; // 값이 그대로면 건드리지 않는다
    data[f] = patch[f] ?? null;
    changed.push(f);
  }
  // 급여형태가 바뀌면 계약서 서식도 함께 바뀌어야 한다
  if ("payScheme" in patch && !eq(patch.payScheme, before.payScheme)) {
    data.templateKey = templateKeyOf(patch.payScheme);
    changed.push("payScheme");
  }
  return { data, changed };
}

export interface ContractSyncResult {
  synced: boolean;
  changed: string[];
  contractId?: number;
  /** 반영하지 못한 이유 */
  reason?: "no-change" | "no-active-contract";
}

/** 직원 카드 수정분을 진행 중(ACTIVE) 계약에 반영 */
export async function syncActiveContract(
  employeeId: number,
  patch: Record<string, any>,
  before: Record<string, any>
): Promise<ContractSyncResult> {
  const { data, changed } = contractTermDiff(patch, before);
  if (!changed.length) return { synced: false, changed: [], reason: "no-change" };

  const active = await prisma.contract.findFirst({
    where: { employeeId, status: "ACTIVE" },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
  });
  if (!active) return { synced: false, changed, reason: "no-active-contract" };

  await prisma.contract.update({ where: { id: active.id }, data });
  return { synced: true, changed, contractId: active.id };
}

/**
 * 직원 카드 값을 진행 중 계약에 그대로 밀어넣는다 (관리 화면 '계약에 반영' 버튼).
 * 동기화 기능이 없던 시절에 어긋나 있던 기존 데이터를 바로잡는 용도.
 */
export async function forceSyncActiveContract(employeeId: number): Promise<ContractSyncResult> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new Error("직원을 찾을 수 없습니다");
  const active = await prisma.contract.findFirst({
    where: { employeeId, status: "ACTIVE" },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
  });
  if (!active) return { synced: false, changed: [], reason: "no-active-contract" };

  const changed = termMismatches(emp as any, active as any);
  const data: Record<string, any> = {};
  for (const f of changed) data[f] = (emp as any)[f] ?? null;
  const wantKey = templateKeyOf(emp.payScheme);
  if (active.templateKey !== wantKey) {
    data.templateKey = wantKey;
    changed.push("payScheme" as any);
  }
  if (!changed.length) return { synced: false, changed: [], reason: "no-change" };

  await prisma.contract.update({ where: { id: active.id }, data });
  return { synced: true, changed, contractId: active.id };
}

/** 직원 카드와 진행 중 계약의 보수조건이 어긋난 항목 (관리 화면 경고용) */
export function termMismatches(
  emp: Record<string, any>,
  contract: Record<string, any> | null | undefined
): ContractTermField[] {
  if (!contract) return [];
  return CONTRACT_TERM_FIELDS.filter((f) => !eq(emp[f], contract[f]));
}
