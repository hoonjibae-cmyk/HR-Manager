import { describe, it, expect } from "vitest";
import {
  confirmOpensAt,
  confirmClosesAt,
  canSelfConfirm,
  honestyNotice,
  mandatoryCapNotice,
  underMandatoryCap,
  NOT_PAYABLE_HINT,
  NOT_PAYABLE_NOTICE,
  type ConfirmableSession,
  canSelfCancel,
  cancelNotice,
  canPostHocConfirm,
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

describe("confirmClosesAt — 다음 달 1일까지", () => {
  it("8월 근무는 9월 1일까지 (그날 끝까지)", () => {
    expect(confirmClosesAt(session()).toISOString()).toBe("2026-09-01T23:59:59.000Z");
  });

  it("해를 넘겨도 맞다 (12월 근무 → 이듬해 1월 1일)", () => {
    const s = session({
      planStart: t("2026-12-05T09:00:00"),
      planEnd: t("2026-12-05T12:00:00"),
    });
    expect(confirmClosesAt(s).toISOString()).toBe("2027-01-01T23:59:59.000Z");
  });

  it("2월처럼 짧은 달도 다음 달 1일이다 (말일 계산이 아니다)", () => {
    const s = session({
      planStart: t("2027-02-15T09:00:00"),
      planEnd: t("2027-02-15T12:00:00"),
    });
    expect(confirmClosesAt(s).toISOString()).toBe("2027-03-01T23:59:59.000Z");
  });

  it("**월말 근무는 창이 하루뿐이다** — 열리는 날과 닫히는 날이 같다", () => {
    // 8/31 근무 → 9/1 00:00 에 열리고 9/1 23:59:59 에 닫힌다
    const s = session({
      planStart: t("2026-08-31T19:00:00"),
      planEnd: t("2026-08-31T22:00:00"),
    });
    expect(confirmOpensAt(s).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(confirmClosesAt(s).toISOString()).toBe("2026-09-01T23:59:59.000Z");
    expect(canSelfConfirm(s, t("2026-09-01T10:00:00")).ok).toBe(true);
    expect(canSelfConfirm(s, t("2026-09-02T00:00:00")).ok).toBe(false);
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

describe("canPostHocConfirm — 사후 등록 즉시 확정", () => {
  /*
   * 평일 초과근무는 미리 예측할 수 없어 근무가 끝난 뒤 등록하는 것이 정상 경로다.
   * 여기서 틀리면 ① 당일 밤 사후 등록이 '아직 안 끝났다' 로 막히거나(9시간 시차)
   * ② 마감 지난 달에 조용히 확정돼 '확정했는데 수당이 없다' 가 된다.
   */
  const kstNow = t("2026-08-17T22:30:00"); // 월요일 밤

  it("근무가 끝났고 마감 전이면 바로 확정할 수 있다", () => {
    // 오늘 18~21시 근무를 22:30 에 등록 — confirmOpensAt(다음날 00:00) 전이지만 열린다
    const s1 = session({
      planStart: t("2026-08-17T18:00:00"),
      planEnd: t("2026-08-17T21:00:00"),
      category: "OVERTIME",
    });
    expect(canSelfConfirm(s1, kstNow).ok).toBe(false); // 기존 규칙으로는 내일부터
    expect(canPostHocConfirm(s1, kstNow).ok).toBe(true); // 사후 등록은 지금
  });

  it("근무가 아직 안 끝났으면 확정할 수 없다 (예정 등록으로 남는다)", () => {
    const s1 = session({
      planStart: t("2026-08-17T21:00:00"),
      planEnd: t("2026-08-17T23:30:00"),
      category: "OVERTIME",
    });
    expect(canPostHocConfirm(s1, kstNow).ok).toBe(false);
  });

  // 마감 지난 달을 조용히 확정하면 급여에 닿지 않는 확정이 된다 — 관리자에게 넘긴다
  it("**그 달 급여 마감(다음 달 1일)이 지났으면 확정하지 않고 관리자 안내를 준다**", () => {
    const july = session({
      planStart: t("2026-07-20T18:00:00"),
      planEnd: t("2026-07-20T21:00:00"),
      category: "OVERTIME",
    });
    const v = canPostHocConfirm(july, kstNow); // 8/17 — 7월 마감(8/1)은 지났다
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("관리자");
  });

  it("이미 처리된 건(확정·취소·미실시)은 다시 확정하지 않는다", () => {
    for (const status of ["CONFIRMED", "CANCELED", "NOSHOW"])
      expect(
        canPostHocConfirm(
          session({ status, planStart: t("2026-08-17T18:00:00"), planEnd: t("2026-08-17T21:00:00") }),
          kstNow
        ).ok
      ).toBe(false);
  });

  it("전날 근무를 다음날 등록해도 열린다 (가장 흔한 경우)", () => {
    const s1 = session({
      planStart: t("2026-08-16T18:00:00"),
      planEnd: t("2026-08-16T22:00:00"),
      category: "OVERTIME",
    });
    expect(canPostHocConfirm(s1, kstNow).ok).toBe(true);
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

describe("수당 미반영 건 안내", () => {
  it("왜 닫혔는지와 무엇을 하면 되는지를 함께 적는다", () => {
    // 버튼만 사라져 있으면 시스템이 고장 난 줄 안다
    expect(NOT_PAYABLE_HINT).toContain("수당 반영 대상이 아니");
    expect(NOT_PAYABLE_HINT).toContain("관리자에게 문의");
  });

  it("확정을 시도했을 때 돌려주는 문구도 같은 말을 한다", () => {
    expect(NOT_PAYABLE_NOTICE).toContain(NOT_PAYABLE_HINT);
  });

  it("'수당이 산정된다' 는 단정을 담지 않는다", () => {
    expect(NOT_PAYABLE_HINT).not.toContain("산정됩니다");
  });
});

/* ───────────── 미실시 처리 ───────────── */

describe("근무하지 않은 건을 신청자가 내릴 수 있는가", () => {
  const s = session;

  it("**확정보다 넓게 연다** — 근무 전에도 내릴 수 있다", () => {
    // 확정은 다음날부터인데, 미실시는 미리 알수록 좋다
    expect(canSelfConfirm(s(), t("2026-08-10T12:00:00")).ok).toBe(false);
    expect(canSelfCancel(s(), t("2026-08-10T12:00:00")).ok).toBe(true);
  });

  it("근무가 지난 뒤에도 내릴 수 있다", () => {
    expect(canSelfCancel(s(), t("2026-08-16T12:00:00")).ok).toBe(true);
  });

  it("확정 마감이 지나도 아직 확정 안 한 건은 내릴 수 있다 — 캘린더에 남아 있으면 안 된다", () => {
    expect(canSelfCancel(s(), t("2026-10-01T12:00:00")).ok).toBe(true);
  });

  it("이미 확정한 건은 **마감 전까지** 되돌릴 수 있다", () => {
    const done = s({ status: "CONFIRMED" });
    expect(canSelfCancel(done, t("2026-08-16T12:00:00")).ok).toBe(true);
    const late = canSelfCancel(done, t("2026-10-01T12:00:00"));
    expect(late.ok).toBe(false);
    expect(late.reason).toContain("관리자");
  });

  it("확정된 건이 아직 근무 전이어도 막지 않는다 — '이르다' 는 취소를 막을 이유가 아니다", () => {
    // `canSelfConfirm` 을 그대로 쓰면 여기서 '다음날부터 가능합니다' 로 막혔다
    expect(canSelfCancel(s({ status: "CONFIRMED" }), t("2026-08-10T12:00:00")).ok).toBe(true);
  });

  it("이미 내려간 건은 두 번 내리지 않는다", () => {
    for (const st of ["NOSHOW", "CANCELED"]) {
      const v = canSelfCancel(s({ status: st }), t("2026-08-16T12:00:00"));
      expect(v.ok, st).toBe(false);
      expect(v.reason).toContain("이미");
    }
  });

  it("안내문은 되돌릴 수 있다는 점까지 적는다 — 잘못 눌렀을 때 막막하지 않게", () => {
    const t = cancelNotice({ category: "ABSENCE" });
    expect(t).toContain("미실시");
    expect(t).toContain("수당은 발생하지 않");
    expect(t).toContain("관리자가 되돌릴 수 있");
  });
});
