import { describe, it, expect } from "vitest";
import {
  DEFAULT_SEVERANCE_POLICY,
  dcStartsAt,
  severanceVerdict,
  severanceBase,
  monthlyAccrual,
  accrualNote,
  underMinimumWarning,
  type SeverancePayItems,
  type SeveranceSubject,
} from "./severance";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const subject = (over: Partial<SeveranceSubject> = {}): SeveranceSubject => ({
  hireDate: d("2025-03-01"),
  contractor: false,
  weeklyContractual: 37.5,
  hasSchedule: true,
  ...over,
});

const pay = (over: Partial<SeverancePayItems> = {}): SeverancePayItems => ({
  baseP: 3_000_000,
  weeklyHolidayP: 0,
  positionP: 200_000,
  mealP: 200_000,
  carP: 0,
  unusedLeaveP: 0,
  incentiveP: 0,
  bonusP: 0,
  extraP: 0,
  overtimeP: 0,
  nightP: 0,
  holidayP: 0,
  ...over,
});

describe("dcStartsAt — 근속 1년이 되는 날", () => {
  it("입사일 + 12개월", () => {
    expect(dcStartsAt(d("2025-03-01")).toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("전환 시점은 설정으로 바꿀 수 있다", () => {
    const p = { ...DEFAULT_SEVERANCE_POLICY, dcAfterMonths: 6 };
    expect(dcStartsAt(d("2025-03-01"), p).toISOString().slice(0, 10)).toBe("2025-09-01");
  });
});

describe("severanceVerdict — 대상 판정", () => {
  it("근속 1년 전에는 충당금", () => {
    const v = severanceVerdict(subject(), d("2026-02-28"));
    expect(v.status).toBe("PROVISION");
    expect(v.reason).toContain("2026.03.01");
  });

  it("1년이 되는 날부터 DC 부담금", () => {
    expect(severanceVerdict(subject(), d("2026-03-01")).status).toBe("DC");
  });

  it("위탁계약(프리랜서)은 제외 — 근로자가 아니다", () => {
    const v = severanceVerdict(subject({ contractor: true }), d("2027-01-01"));
    expect(v.status).toBe("EXCLUDED");
    expect(v.reason).toContain("위탁계약");
  });

  it("위탁계약은 근속이 아무리 길어도, 근로시간이 많아도 제외다", () => {
    const v = severanceVerdict(
      subject({ contractor: true, hireDate: d("2015-01-01"), weeklyContractual: 40 }),
      d("2026-08-01")
    );
    expect(v.status).toBe("EXCLUDED");
  });

  it("주 소정근로 15시간 미만은 제외 (초단시간)", () => {
    const v = severanceVerdict(subject({ weeklyContractual: 12 }), d("2027-01-01"));
    expect(v.status).toBe("EXCLUDED");
    expect(v.reason).toContain("15시간 미만");
    expect(v.reason).toContain("12시간");
  });

  it("딱 15시간이면 대상이다 (미만이 제외 기준)", () => {
    expect(severanceVerdict(subject({ weeklyContractual: 15 }), d("2027-01-01")).status).toBe("DC");
  });

  it("근로시간표가 없으면 '제외' 가 아니라 '보류' 다", () => {
    // 0시간을 초단시간으로 읽어 조용히 빼면 퇴직급여를 통째로 안 쌓게 된다
    const v = severanceVerdict(subject({ hasSchedule: false, weeklyContractual: 0 }), d("2027-01-01"));
    expect(v.status).toBe("UNKNOWN");
    expect(v.reason).toContain("근로시간표 없음");
  });

  it("위탁 판정이 근로시간표보다 먼저다 (시간표가 없어도 위탁이면 제외)", () => {
    const v = severanceVerdict(subject({ contractor: true, hasSchedule: false }), d("2027-01-01"));
    expect(v.status).toBe("EXCLUDED");
  });
});

describe("severanceBase — 산정기준 임금", () => {
  it("기본급·직책수당·식대가 들어간다", () => {
    const b = severanceBase(pay());
    expect(b.base).toBe(3_400_000);
    expect(b.included.map(([k]) => k)).toEqual(["기본급", "직책수당", "식대"]);
  });

  it("상여·인센티브·오버타임은 기본으로 빠진다", () => {
    const b = severanceBase(
      pay({ bonusP: 1_000_000, incentiveP: 600_000, overtimeP: 150_000, holidayP: 50_000 })
    );
    expect(b.base).toBe(3_400_000);
    const off = Object.fromEntries(b.excluded.map(([k, v]) => [k, v]));
    expect(off).toEqual({ 인센티브: 600_000, 상여: 1_000_000, "오버타임 수당": 200_000 });
  });

  it("인센티브를 뺀 사유는 '퇴직유보금으로 별도 적립 중' 이다", () => {
    // 누락이 아니라 다른 경로로 이미 1/12 을 떼고 있다 (확인서 제6조)
    const b = severanceBase(pay({ incentiveP: 600_000 }));
    expect(b.excluded.find(([k]) => k === "인센티브")![2]).toContain("퇴직유보금");
  });

  it("설정을 켜면 상여·인센티브·오버타임이 들어간다", () => {
    const p = {
      ...DEFAULT_SEVERANCE_POLICY,
      includeBonus: true,
      includeIncentive: true,
      includeOvertime: true,
    };
    const b = severanceBase(pay({ bonusP: 1_000_000, incentiveP: 600_000, overtimeP: 150_000 }), p);
    expect(b.base).toBe(3_400_000 + 1_000_000 + 600_000 + 150_000);
    expect(b.excluded).toHaveLength(0);
  });

  it("식대·차량유지비를 끄면 빠진다", () => {
    const p = { ...DEFAULT_SEVERANCE_POLICY, includeMealCar: false };
    expect(severanceBase(pay({ carP: 100_000 }), p).base).toBe(3_200_000);
  });

  it("연차미사용수당은 기본으로 들어간다", () => {
    expect(severanceBase(pay({ unusedLeaveP: 300_000 })).base).toBe(3_700_000);
  });

  it("시급제의 주휴수당도 임금이라 들어간다", () => {
    const b = severanceBase(pay({ baseP: 1_200_000, positionP: 0, mealP: 0, weeklyHolidayP: 240_000 }));
    expect(b.base).toBe(1_440_000);
  });

  it("0원인 항목은 목록에 싣지 않는다 (근거가 지저분해진다)", () => {
    const b = severanceBase(pay({ carP: 0, bonusP: 0 }));
    expect(b.included.some(([, v]) => v === 0)).toBe(false);
    expect(b.excluded.some(([, v]) => v === 0)).toBe(false);
  });
});

describe("monthlyAccrual — 월 적립액", () => {
  it("산정기준 임금의 1/12", () => {
    expect(monthlyAccrual(3_400_000)).toBe(283_333);
  });

  it("10원 절사를 하지 않는다 — 근로자 몫이라 깎지 않는다", () => {
    expect(monthlyAccrual(2_000_000)).toBe(166_667);
  });

  it("기준 임금이 0이면 0", () => {
    expect(monthlyAccrual(0)).toBe(0);
  });
});

describe("accrualNote — 산정 근거", () => {
  it("단계에 따라 이름이 갈린다", () => {
    const b = severanceBase(pay());
    expect(accrualNote(b, 283_333, "DC")).toContain("DC 부담금");
    expect(accrualNote(b, 283_333, "PROVISION")).toContain("퇴직급여충당금");
  });

  it("뺀 항목과 사유를 함께 적는다", () => {
    const b = severanceBase(pay({ incentiveP: 600_000 }));
    const note = accrualNote(b, 283_333, "DC");
    expect(note).toContain("제외: 인센티브 600,000원(퇴직유보금으로 별도 적립 중)");
  });

  it("뺀 게 없으면 제외 줄을 붙이지 않는다", () => {
    expect(accrualNote(severanceBase(pay()), 283_333, "DC")).not.toContain("제외:");
  });
});

describe("underMinimumWarning — 법정 하한 미달 소지", () => {
  it("오버타임 수당이 실제로 발생한 달에만 경고한다", () => {
    expect(underMinimumWarning(severanceBase(pay()))).toBeNull();
    const w = underMinimumWarning(severanceBase(pay({ overtimeP: 150_000 })));
    expect(w).toContain("150,000원");
    expect(w).toContain("§20①");
  });

  it("상여만 뺀 달은 경고하지 않는다 — 비정기 상여는 평균임금에서 빠지는 경우가 많다", () => {
    expect(underMinimumWarning(severanceBase(pay({ bonusP: 2_000_000 })))).toBeNull();
  });

  it("오버타임을 산입하도록 켜면 경고가 사라진다", () => {
    const p = { ...DEFAULT_SEVERANCE_POLICY, includeOvertime: true };
    expect(underMinimumWarning(severanceBase(pay({ overtimeP: 150_000 }), p), p)).toBeNull();
  });
});
