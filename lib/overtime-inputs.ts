// 급여 산정 입력의 오버타임 시간 병합 — 어느 값이 이기는지 한 곳에서 정한다.
//
// 우선순위: **명시 입력 > 원장(보강·주말근무 실근무 확정분) > 기존 저장값 > 0**.
// - 명시 입력은 '관리자가 이번에 직접 고친 값' 이다. 화면은 고친 항목만 싣는다
//   (PayrollClient 의 dirtyRowInput) — 저장된 값을 그대로 되돌려 보내면 여기서
//   '지정' 으로 읽혀, 나중에 확정된 원장 시간이 옛 0 에 눌려 영영 반영되지 않았다
//   (김수민 8월: 별첨 내역서에는 나오는데 지급액에는 없던 원인).
// - 원장 항목이 있으면(그 달 신청이 한 건이라도 있으면) 다섯 시간 모두 원장이 정한다 —
//   취소·미실시로 시간이 0 이 된 것도 원장의 답이므로 옛 저장값으로 되살리지 않는다.
// - 원장 항목 자체가 없는 달(신청 없이 관리자가 손으로 넣는 달)은 저장값을 보존한다 —
//   비우고 재산정했다고 손으로 넣은 시간이 0 으로 지워지면 안 된다.

export const OT_HOUR_KEYS = [
  "extraHours",
  "overtimeHours",
  "holidayHours",
  "holidayOverHours",
  "nightHours",
] as const;
export type OtHourKey = (typeof OT_HOUR_KEYS)[number];
export type OtHours = Record<OtHourKey, number>;

export function mergeOvertimeHours(
  explicit: Partial<Record<OtHourKey, number | null | undefined>>,
  ledger: OtHours | null | undefined,
  existing: Partial<Record<OtHourKey, number | null | undefined>> | null | undefined
): OtHours {
  const out = {} as OtHours;
  for (const k of OT_HOUR_KEYS) {
    const ex = explicit[k];
    out[k] =
      ex !== undefined && ex !== null
        ? ex
        : ledger
          ? ledger[k]
          : (existing?.[k] ?? 0);
  }
  return out;
}

/**
 * 산정에 실제로 쓴 시간이 원장과 같은가 — 같을 때만 명세서에
 * 「보강 오버타임 산정 내역서」를 붙인다. 관리자가 시간을 직접 고쳐 원장과 다르게
 * 산정한 달에 원장 내역서를 붙이면, **별첨에는 나오는데 지급액에는 없는**(또는 그 반대)
 * 문서가 나간다. 다르면 별첨 없이 통상시급·배수 표기로 스스로 설명하게 둔다.
 */
export function ledgerApplied(used: OtHours, ledger: OtHours | null | undefined): boolean {
  if (!ledger) return false;
  return OT_HOUR_KEYS.every((k) => (used[k] ?? 0) === ledger[k]);
}
