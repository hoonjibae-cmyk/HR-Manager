import { describe, it, expect } from "vitest";
import {
  DEFAULT_SEVERANCE_POLICY,
  dcStartsAt,
  severanceVerdict,
  severanceBase,
  monthlyAccrual,
  accrualNote,
  underMinimumWarning,
  overtimeSplit,
  estimateContractBase,
  type ContractWageTerms,
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
  extraHours: 0,
  overtimeHours: 0,
  nightHours: 0,
  holidayHours: 0,
  holidayOverHours: 0,
  hourlyWage: 0,
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

  it("상여·인센티브는 기본으로 빠진다", () => {
    const b = severanceBase(pay({ bonusP: 1_000_000, incentiveP: 600_000 }));
    expect(b.base).toBe(3_400_000);
    const off = Object.fromEntries(b.excluded.map(([k, v]) => [k, v]));
    expect(off).toEqual({ 인센티브: 600_000, 상여: 1_000_000 });
  });

  it("인센티브를 뺀 사유는 '퇴직유보금으로 별도 적립 중' 이다", () => {
    // 누락이 아니라 다른 경로로 이미 1/12 을 떼고 있다 (확인서 제6조)
    const b = severanceBase(pay({ incentiveP: 600_000 }));
    expect(b.excluded.find(([k]) => k === "인센티브")![2]).toContain("퇴직유보금");
  });

  it("설정을 켜면 상여·인센티브도 들어간다", () => {
    const p = { ...DEFAULT_SEVERANCE_POLICY, includeBonus: true, includeIncentive: true };
    const b = severanceBase(pay({ bonusP: 1_000_000, incentiveP: 600_000 }), p);
    expect(b.base).toBe(3_400_000 + 1_000_000 + 600_000);
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

/**
 * 포괄임금 계약자 — 통상시급 20,000원.
 * 계약서 제4조: 기본급 300만 + 약정 시간외 30만 + 식대 20만 = 월 350만.
 * 이 달은 그 위에 보강 연장 4시간이 확정돼 변동분 120,000원이 더 붙었다
 * (레코드의 overtimeP = 약정 300,000 + 변동 120,000 = 420,000).
 */
const inclusive = (over: Partial<SeverancePayItems> = {}) =>
  pay({
    baseP: 3_000_000,
    positionP: 0,
    mealP: 200_000,
    overtimeP: 300_000,
    hourlyWage: 20_000,
    ...over,
  });

describe("포괄임금 약정분 ↔ 그 달 변동분", () => {
  it("약정분은 계약 월 급여의 일부라 기본으로 들어간다", () => {
    const b = severanceBase(inclusive());
    // 300만 + 식대 20만 + 약정 시간외 30만 = 계약서에 합의된 월 급여총액
    expect(b.base).toBe(3_500_000);
    expect(b.included.map(([k]) => k)).toContain("포괄임금 약정 시간외·야간");
    expect(b.excluded).toHaveLength(0);
  });

  it("금액이 아니라 시간에서 변동분을 다시 세워 가른다", () => {
    const b = severanceBase(inclusive({ overtimeP: 420_000, overtimeHours: 4 }));
    expect(overtimeSplit(inclusive({ overtimeP: 420_000, overtimeHours: 4 }))).toEqual({
      fixed: 300_000, // 420,000 − 120,000
      variable: 120_000, // 4h × 20,000 × 1.5
    });
    // 약정분만 들어가고 그 달 발생분은 빠진다 → 여전히 계약 월 급여와 같다
    expect(b.base).toBe(3_500_000);
    expect(Object.fromEntries(b.excluded.map(([k, v]) => [k, v]))).toEqual({
      "오버타임 수당(그 달 발생분)": 120_000,
    });
  });

  it("포괄임금 계약이 아니면 약정분이 0이라 붙을 게 없다", () => {
    // 지급된 오버타임 전부가 그 달 발생분이다 (같은 시간에서 나온 금액이므로)
    const p = pay({ overtimeP: 120_000, overtimeHours: 4, hourlyWage: 20_000 });
    expect(overtimeSplit(p)).toEqual({ fixed: 0, variable: 120_000 });
    expect(severanceBase(p).base).toBe(3_400_000);
  });

  it("야간은 가산분(×0.5)만 변동분으로 센다", () => {
    const p = inclusive({ nightP: 100_000 + 30_000, nightHours: 3 });
    // 3h × 20,000 × 0.5 = 30,000 이 변동분, 나머지 100,000 이 약정 야간
    expect(overtimeSplit(p)).toEqual({ fixed: 400_000, variable: 30_000 });
  });

  it("약정분을 끄면 계약 월 급여보다 적어진다", () => {
    const p = { ...DEFAULT_SEVERANCE_POLICY, includeFixedOvertime: false };
    const b = severanceBase(inclusive(), p);
    expect(b.base).toBe(3_200_000);
    expect(b.excluded.map(([k]) => k)).toContain("포괄임금 약정 시간외·야간");
  });

  it("반올림 잔차로 약정분이 음수가 되지 않는다", () => {
    // 수기 입력 등으로 변동분이 지급액보다 커도 0에서 자른다
    const p = pay({ overtimeP: 100_000, overtimeHours: 10, hourlyWage: 20_000 });
    expect(overtimeSplit(p).fixed).toBe(0);
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
  /** 그 달 실제로 4시간 연장이 발생한 포괄임금 계약자 */
  const withVariable = () => inclusive({ overtimeP: 420_000, overtimeHours: 4 });

  it("그 달 발생분이 실제로 있을 때만 경고한다", () => {
    // 약정분만 있는 달은 계약 월 급여와 산정기준이 같으니 경고할 것이 없다
    expect(underMinimumWarning(severanceBase(inclusive()))).toBeNull();
    const w = underMinimumWarning(severanceBase(withVariable()))!;
    expect(w).toContain("120,000원");
    expect(w).toContain("§20①");
  });

  it("상여만 뺀 달은 경고하지 않는다 — 비정기 상여는 평균임금에서 빠지는 경우가 많다", () => {
    expect(underMinimumWarning(severanceBase(pay({ bonusP: 2_000_000 })))).toBeNull();
  });

  it("그 달 발생분을 산입하도록 켜면 경고가 사라진다", () => {
    const p = { ...DEFAULT_SEVERANCE_POLICY, includeOvertime: true };
    expect(underMinimumWarning(severanceBase(withVariable(), p), p)).toBeNull();
  });

  it("약정분을 뺀 쪽이 더 무겁다 — 그쪽을 먼저 경고한다", () => {
    // 계약서에 합의된 월 급여보다 적게 쌓이는 것이라 매달 어긋난다
    const p = { ...DEFAULT_SEVERANCE_POLICY, includeFixedOvertime: false };
    const w = underMinimumWarning(severanceBase(withVariable(), p), p)!;
    expect(w).toContain("포괄임금 약정");
    expect(w).toContain("계약 월 급여총액보다 적어지므로");
  });
});

/* ───────────── 계약에서 산정기준 임금 추산 ───────────── */

const terms = (over: Partial<ContractWageTerms> = {}): ContractWageTerms => ({
  payScheme: "MONTHLY",
  baseWage: 3_400_000, // 월 지급 총액 (식대 20만·약정OT 포함)
  positionAllow: 200_000,
  mealAllow: 200_000,
  carAllow: 0,
  isContractor: false,
  ...over,
});

describe("estimateContractBase — 급여 레코드가 없던 달 메우기", () => {
  it("월급제: 월 급여총액 + 직책수당 (식대는 총액 안에 있어 더하지 않는다)", () => {
    const e = estimateContractBase(terms());
    // 식대 20만을 또 더하면 3,800,000 이 되어 계약 총액과 어긋난다
    expect(e.base).toBe(3_600_000);
    expect(e.excluded).toBe(false);
  });

  it("인센티브 계약도 월급제와 같다 (인센티브는 산입 대상이 아니다)", () => {
    expect(estimateContractBase(terms({ payScheme: "INCENTIVE" })).base).toBe(3_600_000);
  });

  it("**실제 급여에서 뽑은 값과 같은 금액이 나온다** — 두 방식이 섞여도 누계가 매끄럽다", () => {
    // 계약: 월 총액 340만(식대 20만 + 약정 시간외 30만 포함) + 직책수당 20만
    const fromContract = estimateContractBase(terms());
    // 같은 계약으로 산정된 급여 레코드
    const fromPayroll = severanceBase(
      pay({
        baseP: 2_900_000, // 340만 − 식대 20만 − 약정 시간외 30만
        mealP: 200_000,
        positionP: 200_000,
        overtimeP: 300_000,
        hourlyWage: 20_000,
      })
    );
    expect(fromPayroll.base).toBe(fromContract.base);
  });

  it("시급제: 시급 × (주 소정 + 주휴) × 4.345 + 식대·차량은 별도 가산", () => {
    const e = estimateContractBase(
      terms({ payScheme: "HOURLY", baseWage: 15_000, positionAllow: 0, mealAllow: 100_000 }),
      { weeklyContractual: 20, weeklyHoliday: 4 }
    );
    // 15,000 × 24 × 4.345 = 1,564,200
    expect(e.base).toBe(1_564_200 + 100_000);
  });

  it("시급제인데 근로시간표가 없으면 추산하지 않고 사유를 남긴다", () => {
    const e = estimateContractBase(terms({ payScheme: "HOURLY", baseWage: 15_000 }), {});
    expect(e.base).toBe(0);
    expect(e.note).toContain("근로시간표가 없어");
    expect(e.excluded).toBe(false); // 대상 제외가 아니라 '지금은 못 구한다'
  });

  it("위탁계약·완전비율제는 추산하지 않는다", () => {
    expect(estimateContractBase(terms({ isContractor: true })).excluded).toBe(true);
    expect(estimateContractBase(terms({ payScheme: "RATIO" })).excluded).toBe(true);
  });

  it("재직비율을 넘기면 일할계산한다 (입·퇴사월)", () => {
    const e = estimateContractBase(terms(), { prorate: 0.5 });
    expect(e.base).toBe(1_800_000);
    expect(e.note).toContain("재직비율 50.0%");
  });

  it("근거를 문장으로 남긴다 — 나중에 왜 이 금액인지 알 수 있어야 한다", () => {
    const e = estimateContractBase(terms());
    expect(e.note).toContain("계약 추산");
    expect(e.note).toContain("3,400,000원");
    expect(e.note).toContain("직책수당 200,000원");
  });

  it("재직비율이 0이나 1을 벗어나면 잘라 낸다", () => {
    expect(estimateContractBase(terms(), { prorate: -1 }).base).toBe(0);
    expect(estimateContractBase(terms(), { prorate: 3 }).base).toBe(3_600_000);
  });
});
