import { describe, it, expect } from "vitest";
import {
  monthPayDays,
  leaveDaysBetween,
  unpaidLeaveMetaOf,
  readUnpaidLeaveMeta,
  unpaidLeaveStale,
  unpaidSpansLabel,
  unpaidSpansLabelKo,
  unpaidLeaveNote,
  unpaidLeaveCalcNote,
  unpaidLeaveError,
  parseYmd,
  spanDays,
  monthsOfSpan,
  UNPAID_REASON_MAX,
} from "./unpaid-leave";
import { prorationRatioFor } from "./payroll-service";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const leave = (a: string, b: string) => ({ startDate: d(a), endDate: d(b) });
const HIRE = d("2024-03-04");

describe("monthPayDays — 그 달 지급 일수 (역일수)", () => {
  it("무급휴직이 없으면 재직비율과 같다 — 기존 일할계산을 한 푼도 바꾸지 않는다", () => {
    const cases: Array<[number, number, string, string | null]> = [
      [2026, 11, "2024-03-04", null], // 만근
      [2026, 11, "2026-11-16", null], // 월중 입사
      [2026, 11, "2024-03-04", "2026-11-10"], // 월중 퇴사
      [2026, 2, "2026-02-14", "2026-02-20"], // 같은 달 입·퇴사
      [2026, 11, "2026-12-01", null], // 아직 입사 전
      [2026, 11, "2024-03-04", "2026-10-31"], // 전월 퇴사
      [2028, 2, "2028-02-29", null], // 윤년 말일 입사
    ];
    for (const [y, m, hire, resign] of cases) {
      const pd = monthPayDays(y, m, d(hire), resign ? d(resign) : null, []);
      expect(pd.ratio).toBe(prorationRatioFor(y, m, d(hire), resign ? d(resign) : null));
      expect(pd.unpaidDays).toBe(0);
      expect(pd.spans).toEqual([]);
    }
  });

  it("11/16~11/30 무급휴직 → 15일/30일 = 50%", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [leave("2026-11-16", "2026-11-30")]);
    expect(pd).toMatchObject({ daysInMonth: 30, employedDays: 30, unpaidDays: 15, paidDays: 15, ratio: 0.5 });
    expect(pd.spans).toEqual([{ from: "2026-11-16", to: "2026-11-30", days: 15 }]);
  });

  it("★ 역일수 기준 — 11/1~11/15 무급휴직과 11/16 입사는 같은 비율이다", () => {
    const onLeave = monthPayDays(2026, 11, HIRE, null, [leave("2026-11-01", "2026-11-15")]);
    const hired = monthPayDays(2026, 11, d("2026-11-16"), null, []);
    expect(onLeave.ratio).toBe(hired.ratio);
    expect(onLeave.paidDays).toBe(15);
  });

  it("주말·공휴일을 가리지 않는다 — 토·일만 쉬어도 2일이 빠진다", () => {
    // 2026-11-07(토)~11-08(일)
    const pd = monthPayDays(2026, 11, HIRE, null, [leave("2026-11-07", "2026-11-08")]);
    expect(pd.unpaidDays).toBe(2);
    expect(pd.ratio).toBeCloseTo(28 / 30, 12);
  });

  it("달을 걸친 휴직은 그 달 몫만 센다", () => {
    const l = [leave("2026-11-20", "2026-12-10")];
    const nov = monthPayDays(2026, 11, HIRE, null, l);
    const dec = monthPayDays(2026, 12, HIRE, null, l);
    expect(nov.unpaidDays).toBe(11); // 11/20~11/30
    expect(nov.spans).toEqual([{ from: "2026-11-20", to: "2026-11-30", days: 11 }]);
    expect(dec.unpaidDays).toBe(10); // 12/1~12/10
    expect(dec.ratio).toBeCloseTo(21 / 31, 12);
    // 휴직과 무관한 달은 그대로
    expect(monthPayDays(2027, 1, HIRE, null, l).ratio).toBe(1);
  });

  it("한 달을 통째로 쉬면 0% — 그래도 재직일수는 그대로다(시트에서 빠지지 않는다)", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [leave("2026-10-15", "2026-12-15")]);
    expect(pd).toMatchObject({ employedDays: 30, unpaidDays: 30, paidDays: 0, ratio: 0 });
  });

  it("★ 겹쳐 등록돼 있어도 같은 날은 한 번만 센다", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [
      leave("2026-11-10", "2026-11-20"),
      leave("2026-11-15", "2026-11-25"),
    ]);
    expect(pd.unpaidDays).toBe(16); // 11/10~11/25
    expect(pd.spans).toEqual([{ from: "2026-11-10", to: "2026-11-25", days: 16 }]);
  });

  it("맞닿은 두 건은 한 구간으로 합쳐 적는다", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [
      leave("2026-11-11", "2026-11-20"),
      leave("2026-11-03", "2026-11-10"),
    ]);
    expect(pd.spans).toEqual([{ from: "2026-11-03", to: "2026-11-20", days: 18 }]);
  });

  it("떨어진 두 건은 따로 적는다", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [
      leave("2026-11-24", "2026-11-25"),
      leave("2026-11-03", "2026-11-05"),
    ]);
    expect(pd.unpaidDays).toBe(5);
    expect(pd.spans.map((s) => s.from)).toEqual(["2026-11-03", "2026-11-24"]);
  });

  it("월중 입사와 겹치면 재직 기간 안의 휴직만 센다", () => {
    // 11/10 입사, 11/20~11/25 무급 → 재직 21일 − 6일 = 15일
    const pd = monthPayDays(2026, 11, d("2026-11-10"), null, [leave("2026-11-20", "2026-11-25")]);
    expect(pd).toMatchObject({ employedDays: 21, unpaidDays: 6, paidDays: 15, ratio: 0.5 });
  });

  it("퇴사일 뒤로 넘어간 휴직은 퇴사일까지만 센다", () => {
    const pd = monthPayDays(2026, 11, HIRE, d("2026-11-20"), [leave("2026-11-16", "2026-11-30")]);
    expect(pd).toMatchObject({ employedDays: 20, unpaidDays: 5, paidDays: 15 });
    expect(pd.spans).toEqual([{ from: "2026-11-16", to: "2026-11-20", days: 5 }]);
  });

  it("재직 기간이 없는 달은 휴직도 세지 않는다", () => {
    const pd = monthPayDays(2026, 11, d("2026-12-01"), null, [leave("2026-11-01", "2026-11-30")]);
    expect(pd).toMatchObject({ employedDays: 0, unpaidDays: 0, paidDays: 0, ratio: 0, spans: [] });
  });

  it("시작일이 종료일보다 늦은 잘못된 건은 무시한다", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [leave("2026-11-20", "2026-11-10")]);
    expect(pd.unpaidDays).toBe(0);
  });

  it("2월(28일)·윤년 2월(29일)·31일 달의 분모", () => {
    expect(monthPayDays(2026, 2, HIRE, null, [leave("2026-02-01", "2026-02-14")]).ratio).toBe(0.5);
    expect(monthPayDays(2028, 2, HIRE, null, [leave("2028-02-01", "2028-02-29")]).ratio).toBe(0);
    expect(monthPayDays(2026, 12, HIRE, null, [leave("2026-12-31", "2026-12-31")]).ratio).toBeCloseTo(30 / 31, 12);
  });
});

describe("leaveDaysBetween — 구간 안의 무급휴직 일수 (월중 계약 변경 가중용)", () => {
  const l = [leave("2026-11-10", "2026-11-20"), leave("2026-11-18", "2026-11-22")];
  it("구간으로 자르고 겹침은 한 번만", () => {
    expect(leaveDaysBetween(d("2026-11-01"), d("2026-11-15"), l)).toBe(6); // 10~15
    expect(leaveDaysBetween(d("2026-11-16"), d("2026-11-30"), l)).toBe(7); // 16~22
    expect(leaveDaysBetween(d("2026-11-01"), d("2026-11-30"), l)).toBe(13); // 10~22
  });
  it("★ 구간별 합이 그 달 전체와 같다 — 가중의 분모가 지급 일수와 맞아떨어진다", () => {
    const whole = monthPayDays(2026, 11, HIRE, null, l).unpaidDays;
    const a = leaveDaysBetween(d("2026-11-01"), d("2026-11-15"), l);
    const b = leaveDaysBetween(d("2026-11-16"), d("2026-11-30"), l);
    expect(a + b).toBe(whole);
  });
  it("휴직이 없거나 구간이 뒤집혀 있으면 0", () => {
    expect(leaveDaysBetween(d("2026-11-01"), d("2026-11-30"), [])).toBe(0);
    expect(leaveDaysBetween(d("2026-11-30"), d("2026-11-01"), l)).toBe(0);
  });
});

describe("급여 기록에 남기는 근거", () => {
  const pd = monthPayDays(2026, 11, HIRE, null, [leave("2026-11-16", "2026-11-30")]);

  it("무급휴직이 없는 달은 근거를 남기지 않는다", () => {
    expect(unpaidLeaveMetaOf(monthPayDays(2026, 11, HIRE, null, []))).toBeNull();
  });

  it("남긴 근거를 저장된 breakdown 에서 그대로 읽는다", () => {
    const meta = unpaidLeaveMetaOf(pd)!;
    expect(meta).toEqual({
      days: 15,
      daysInMonth: 30,
      employedDays: 30,
      paidDays: 15,
      spans: [{ from: "2026-11-16", to: "2026-11-30", days: 15 }],
    });
    const stored = JSON.stringify({ notes: [], unpaidLeave: meta });
    expect(readUnpaidLeaveMeta(stored)).toEqual(meta);
    expect(readUnpaidLeaveMeta(JSON.parse(stored))).toEqual(meta);
  });

  it("근거가 없는 옛 기록·깨진 JSON·이상한 모양은 null", () => {
    expect(readUnpaidLeaveMeta(null)).toBeNull();
    expect(readUnpaidLeaveMeta("")).toBeNull();
    expect(readUnpaidLeaveMeta("{깨짐")).toBeNull();
    expect(readUnpaidLeaveMeta(JSON.stringify({ notes: [] }))).toBeNull();
    expect(readUnpaidLeaveMeta(JSON.stringify({ unpaidLeave: null }))).toBeNull();
    expect(readUnpaidLeaveMeta(JSON.stringify({ unpaidLeave: { days: 0, daysInMonth: 30 } }))).toBeNull();
    expect(readUnpaidLeaveMeta(JSON.stringify({ unpaidLeave: { days: "15", daysInMonth: 30 } }))).toBeNull();
  });

  it("구간의 날짜 모양이 다른 항목은 버린다", () => {
    const m = readUnpaidLeaveMeta({
      unpaidLeave: { days: 3, daysInMonth: 30, spans: [{ from: "2026-11-03", to: "2026-11-05", days: 3 }, { from: "x", to: "y" }] },
    })!;
    expect(m.spans).toEqual([{ from: "2026-11-03", to: "2026-11-05", days: 3 }]);
    expect(m.paidDays).toBe(27);
  });
});

describe("unpaidLeaveStale — 산정한 뒤에 휴직이 바뀌었는가", () => {
  const withLeave = monthPayDays(2026, 11, HIRE, null, [leave("2026-11-16", "2026-11-30")]);
  const none = monthPayDays(2026, 11, HIRE, null, []);

  it("산정 때와 지금이 같으면 아니다", () => {
    expect(unpaidLeaveStale(unpaidLeaveMetaOf(withLeave), withLeave)).toBe(false);
    expect(unpaidLeaveStale(null, none)).toBe(false);
  });
  it("★ 산정한 뒤에 휴직을 등록했으면 다시 산정해야 한다", () => {
    expect(unpaidLeaveStale(null, withLeave)).toBe(true);
  });
  it("산정한 뒤에 휴직을 지웠어도 마찬가지다", () => {
    expect(unpaidLeaveStale(unpaidLeaveMetaOf(withLeave), none)).toBe(true);
  });
  it("기간을 고쳤어도 잡는다 — 일수가 같아도 날짜가 다르면", () => {
    const moved = monthPayDays(2026, 11, HIRE, null, [leave("2026-11-01", "2026-11-15")]);
    expect(moved.unpaidDays).toBe(withLeave.unpaidDays);
    expect(unpaidLeaveStale(unpaidLeaveMetaOf(withLeave), moved)).toBe(true);
  });
});

describe("표기", () => {
  const meta = unpaidLeaveMetaOf(
    monthPayDays(2026, 11, HIRE, null, [leave("2026-11-03", "2026-11-03"), leave("2026-11-16", "2026-11-30")])
  )!;

  it("구간 — 하루짜리는 날짜 하나로", () => {
    expect(unpaidSpansLabel(meta.spans)).toBe("11/3, 11/16~11/30");
    expect(unpaidSpansLabelKo(meta.spans)).toBe("11월 3일, 11월 16일 ~ 11월 30일");
  });
  it("세무 자료·화면의 한 줄", () => {
    expect(unpaidLeaveNote(meta)).toBe("무급휴직 11/3, 11/16~11/30(16일)");
  });
  it("산정 근거 — 월급제는 일할 식을 그대로 적는다", () => {
    const note = unpaidLeaveCalcNote(meta, "PRORATED");
    expect(note).toContain("역일수 일할");
    expect(note).toContain("14일 ÷ 30일");
    expect(note).toContain("46.7%");
  });
  it("산정 근거 — 월중 입사와 겹치면 재직일수를 함께 적는다", () => {
    const m = unpaidLeaveMetaOf(
      monthPayDays(2026, 11, d("2026-11-10"), null, [leave("2026-11-20", "2026-11-25")])
    )!;
    expect(unpaidLeaveCalcNote(m, "PRORATED")).toContain("그 달 재직 21일 중");
  });
  it("산정 근거 — 완전비율제는 일할하지 않는다고 적는다", () => {
    const note = unpaidLeaveCalcNote(meta, "RATIO");
    expect(note).toContain("일할하지 않습니다");
    expect(note).toContain("최저보장");
  });
  it("산정 근거 — 시급제(실근로 기록)는 수당만 일할했다고 적는다", () => {
    expect(unpaidLeaveCalcNote(meta, "HOURLY_ACTUAL")).toContain("월 정액 수당만 14/30");
  });
});

describe("parseYmd · spanDays · monthsOfSpan", () => {
  it("날짜 모양과 실제로 있는 날인지 본다", () => {
    expect(parseYmd("2026-11-16")?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(parseYmd("2026-02-30")).toBeNull();
    expect(parseYmd("2026-13-01")).toBeNull();
    expect(parseYmd("2026/11/16")).toBeNull();
    expect(parseYmd("")).toBeNull();
    expect(parseYmd(null)).toBeNull();
    expect(parseYmd(20261116)).toBeNull();
  });
  it("역일수는 첫날과 마지막 날을 모두 센다", () => {
    expect(spanDays(d("2026-11-16"), d("2026-11-30"))).toBe(15);
    expect(spanDays(d("2026-11-16"), d("2026-11-16"))).toBe(1);
    expect(spanDays(d("2026-11-20"), d("2026-12-10"))).toBe(21);
    expect(spanDays(d("2026-11-20"), d("2026-11-10"))).toBe(0);
  });
  it("걸치는 달을 순서대로 낸다 — 해를 넘겨도", () => {
    expect(monthsOfSpan(d("2026-11-20"), d("2027-01-05"))).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
    expect(monthsOfSpan(d("2026-11-01"), d("2026-11-30"))).toEqual([{ year: 2026, month: 11 }]);
    expect(monthsOfSpan(d("2020-01-01"), d("2030-12-31"), 5)).toHaveLength(5);
  });
});

describe("unpaidLeaveError — 등록 검사 (화면·서버 공용)", () => {
  const ctx = { hireDate: HIRE, resignDate: null, contractor: false, others: [] as any[] };
  const ok = { startDate: "2026-11-16", endDate: "2026-11-30", reason: "개인 사정" };

  it("정상 입력은 통과한다 — 하루짜리도", () => {
    expect(unpaidLeaveError(ok, ctx)).toBeNull();
    expect(unpaidLeaveError({ startDate: "2026-11-16", endDate: "2026-11-16" }, ctx)).toBeNull();
  });
  it("날짜가 빠졌거나 모양이 다르면 막는다", () => {
    expect(unpaidLeaveError({ ...ok, startDate: "" }, ctx)).toContain("날짜");
    expect(unpaidLeaveError({ ...ok, endDate: "2026-02-30" }, ctx)).toContain("날짜");
  });
  it("종료일이 시작일보다 빠르면 막는다", () => {
    expect(unpaidLeaveError({ ...ok, startDate: "2026-12-01" }, ctx)).toContain("빠릅니다");
  });
  it("재직 기간을 벗어나면 막는다", () => {
    expect(unpaidLeaveError({ ...ok, startDate: "2024-03-03" }, ctx)).toContain("입사일(2024-03-04)");
    expect(unpaidLeaveError(ok, { ...ctx, resignDate: d("2026-11-20") })).toContain("퇴사일(2026-11-20)");
    // 퇴사일 당일까지는 된다
    expect(unpaidLeaveError(ok, { ...ctx, resignDate: d("2026-11-30") })).toBeNull();
    // 입사일 당일부터도 된다
    expect(unpaidLeaveError({ startDate: "2024-03-04", endDate: "2024-03-10" }, ctx)).toBeNull();
  });
  it("★ 이미 등록된 휴직과 하루라도 겹치면 막는다", () => {
    const others = [leave("2026-11-01", "2026-11-16")];
    expect(unpaidLeaveError(ok, { ...ctx, others })).toContain("겹칩니다");
    // 맞닿은 것은 겹침이 아니다
    expect(unpaidLeaveError(ok, { ...ctx, others: [leave("2026-11-01", "2026-11-15")] })).toBeNull();
    expect(unpaidLeaveError(ok, { ...ctx, others: [leave("2026-12-01", "2026-12-05")] })).toBeNull();
  });
  it("위탁계약(프리랜서)은 대상이 아니다", () => {
    expect(unpaidLeaveError(ok, { ...ctx, contractor: true })).toContain("위탁계약");
  });
  it("사유가 너무 길거나 글자가 아니면 막는다", () => {
    expect(unpaidLeaveError({ ...ok, reason: "가".repeat(UNPAID_REASON_MAX + 1) }, ctx)).toContain(`${UNPAID_REASON_MAX}자`);
    expect(unpaidLeaveError({ ...ok, reason: "가".repeat(UNPAID_REASON_MAX) }, ctx)).toBeNull();
    expect(unpaidLeaveError({ ...ok, reason: 123 }, ctx)).toContain("글자");
  });
});
