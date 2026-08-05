import { describe, it, expect } from "vitest";
import {
  confirmOpensAt,
  confirmClosesAt,
  canSelfConfirm,
  honestyNotice,
  mandatoryCapNotice,
  underMandatoryCap,
  type ConfirmableSession,
} from "./makeup-confirm";

/** KST 벽시계 값을 UTC 필드에 담는 앱 규칙 그대로 */
const t = (s: string) => new Date(`${s}Z`);

const session = (over: Partial<ConfirmableSession> = {}): ConfirmableSession => ({
  category: "IMMEDIATE",
  status: "PLANNED",
  planStart: t("2026-08-15T09:00:00"),
  planEnd: t("2026-08-15T16:00:00"),
  ...over,
});

describe("confirmOpensAt — 근무 다음날부터", () => {
  it("근무 종료일의 다음날 00:00 에 열린다", () => {
    expect(confirmOpensAt(session()).toISOString()).toBe("2026-08-16T00:00:00.000Z");
  });

  it("자정을 넘긴 근무는 종료일 기준이라 하루 더 뒤에 열린다", () => {
    const s = session({
      planStart: t("2026-08-15T21:00:00"),
      planEnd: t("2026-08-16T01:00:00"),
    });
    expect(confirmOpensAt(s).toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });

  it("실근무 시각이 이미 있으면 그 값을 기준으로 본다", () => {
    const s = session({
      actualStart: t("2026-08-15T09:00:00"),
      actualEnd: t("2026-08-16T02:00:00"),
    });
    expect(confirmOpensAt(s).toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });
});

describe("confirmClosesAt — 다음 달 말일까지", () => {
  it("8월 근무는 9월 말일까지", () => {
    expect(confirmClosesAt(session()).toISOString()).toBe("2026-09-30T23:59:59.000Z");
  });

  it("해를 넘겨도 맞다 (12월 근무 → 이듬해 1월 말일)", () => {
    const s = session({
      planStart: t("2026-12-05T09:00:00"),
      planEnd: t("2026-12-05T12:00:00"),
    });
    expect(confirmClosesAt(s).toISOString()).toBe("2027-01-31T23:59:59.000Z");
  });
});

describe("canSelfConfirm", () => {
  it("근무 당일에는 아직 막힌다", () => {
    const v = canSelfConfirm(session(), t("2026-08-15T23:00:00"));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("다음날");
    expect(v.reason).toContain("2026.08.16");
  });

  it("다음날 0시부터 열린다", () => {
    expect(canSelfConfirm(session(), t("2026-08-16T00:00:00")).ok).toBe(true);
  });

  it("주말근무는 안내 문구가 '주말근무' 로 나온다", () => {
    const v = canSelfConfirm(session({ category: "WEEKEND" }), t("2026-08-15T20:00:00"));
    expect(v.reason).toContain("주말근무");
  });

  it("확정 기간이 지나면 관리자에게 넘긴다", () => {
    const v = canSelfConfirm(session(), t("2026-10-01T09:00:00"));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("관리자");
  });

  it("취소·미실시 건은 확정할 수 없다", () => {
    expect(canSelfConfirm(session({ status: "CANCELED" }), t("2026-08-20T09:00:00")).ok).toBe(false);
    expect(canSelfConfirm(session({ status: "NOSHOW" }), t("2026-08-20T09:00:00")).ok).toBe(false);
  });

  it("이미 확정한 건도 기간 안이면 다시 고칠 수 있다", () => {
    const s = session({
      status: "CONFIRMED",
      actualStart: t("2026-08-15T09:00:00"),
      actualEnd: t("2026-08-15T15:00:00"),
    });
    expect(canSelfConfirm(s, t("2026-08-20T09:00:00")).ok).toBe(true);
  });
});

describe("honestyNotice", () => {
  it("예정이 아니라 실제 시간을 적으라고 말한다", () => {
    const n = honestyNotice("IMMEDIATE");
    expect(n).toContain("실제로 근무한");
    expect(n).toContain("수당");
  });

  it("주말근무면 '주말근무 · 오버타임 화면' 으로 안내한다", () => {
    expect(honestyNotice("WEEKEND")).toContain("주말근무");
  });
});

describe("mandatoryCapNotice — 내신 10시간 상한", () => {
  it("상한 안이면 붙일 말이 없다", () => {
    expect(mandatoryCapNotice({ capHours: 10, otherHours: 3, thisHours: 4 })).toBeNull();
  });

  it("딱 상한이면 아직 초과가 아니다", () => {
    expect(mandatoryCapNotice({ capHours: 10, otherHours: 3, thisHours: 7 })).toBeNull();
  });

  it("넘기면 상한 범위 안에서 가장 유리하게 산정된다고 알린다", () => {
    const n = mandatoryCapNotice({ capHours: 10, otherHours: 7, thisHours: 7 })!;
    expect(n).toContain("10시간");
    expect(n).toContain("14시간");
    expect(n).toContain("가장 유리한 기준");
    // 초과분이 사라진다고 오해하지 않게 한다
    expect(n).toContain("없어지는 것은 아니고");
  });

  it("이미 확정된 분이 없으면 '이미 확정된' 문구를 빼고 이번 건만 말한다", () => {
    const n = mandatoryCapNotice({ capHours: 10, otherHours: 0, thisHours: 12 })!;
    expect(n).not.toContain("이미 확정된");
    expect(n).toContain("12시간");
  });

  it("내신 기간 이름이 있으면 함께 적는다", () => {
    const n = mandatoryCapNotice({
      capHours: 10,
      otherHours: 6,
      thisHours: 6,
      periodName: "2026년 1학기 기말고사",
    })!;
    expect(n).toContain("2026년 1학기 기말고사");
  });
});

describe("underMandatoryCap", () => {
  it("내신의무보강만 상한을 받는다", () => {
    expect(underMandatoryCap("MANDATORY")).toBe(true);
    expect(underMandatoryCap("IMMEDIATE")).toBe(false);
    expect(underMandatoryCap("WEEKEND")).toBe(false);
  });
});
