import { describe, it, expect } from "vitest";
import { mergeOvertimeHours, ledgerApplied, OT_HOUR_KEYS } from "./overtime-inputs";

const H = (n: number) => ({
  extraHours: n,
  overtimeHours: 0,
  holidayHours: 0,
  holidayOverHours: 0,
  nightHours: 0,
});

describe("mergeOvertimeHours — 명시 입력 > 원장 > 기존 저장값 > 0", () => {
  it("명시 입력이 있으면 원장보다 세다 (0 으로 지우는 것도 명시다)", () => {
    expect(mergeOvertimeHours({ extraHours: 6 }, H(4), H(3)).extraHours).toBe(6);
    expect(mergeOvertimeHours({ extraHours: 0 }, H(4), H(3)).extraHours).toBe(0);
  });

  it("명시 입력이 없으면 원장(확정분)이 채운다 — 옛 저장값 0 이 원장을 막지 않는다", () => {
    // 김수민 8월 케이스: 월초 산정으로 0 이 저장된 뒤 오버타임이 확정된 상황
    const m = mergeOvertimeHours({}, H(2.5), H(0));
    expect(m.extraHours).toBe(2.5);
  });

  it("원장 항목이 있으면 다섯 시간 모두 원장이 정한다 — 취소로 0 이 된 것도 원장의 답", () => {
    // 확정 4h 가 저장된 뒤 미실시(NOSHOW)로 원장이 0 이 된 상황 — 저장값이 되살아나면 안 된다
    const m = mergeOvertimeHours({}, H(0), H(4));
    expect(m.extraHours).toBe(0);
  });

  it("원장 항목 자체가 없는 달은 저장값을 보존한다 (손으로 넣은 시간)", () => {
    const m = mergeOvertimeHours({}, null, { extraHours: 3, nightHours: 1 });
    expect(m.extraHours).toBe(3);
    expect(m.nightHours).toBe(1);
    expect(m.holidayHours).toBe(0);
  });

  it("아무것도 없으면 0", () => {
    const m = mergeOvertimeHours({}, null, null);
    for (const k of OT_HOUR_KEYS) expect(m[k]).toBe(0);
  });

  it("null 명시 입력은 '지정 안 함' 으로 본다", () => {
    expect(mergeOvertimeHours({ extraHours: null }, H(4), null).extraHours).toBe(4);
  });
});

describe("ledgerApplied — 원장 시간을 그대로 썼을 때만 내역서를 붙인다", () => {
  it("모든 시간이 원장과 같으면 참", () => {
    expect(ledgerApplied(H(4), H(4))).toBe(true);
  });
  it("하나라도 다르면 거짓 — 별첨과 지급액이 어긋난 문서를 만들지 않는다", () => {
    expect(ledgerApplied(H(6), H(4))).toBe(false);
    expect(ledgerApplied({ ...H(4), nightHours: 1 }, H(4))).toBe(false);
  });
  it("원장이 없으면 거짓", () => {
    expect(ledgerApplied(H(0), null)).toBe(false);
  });
});
