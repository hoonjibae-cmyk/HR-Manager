import { describe, it, expect } from "vitest";
import {
  holidayApiUrl,
  locdateToYmd,
  normalizeHolidayName,
  parseHolidayResponse,
  responseError,
  diffHolidays,
  holidayCoverage,
  yearsToSync,
  MIN_HOLIDAYS_PER_YEAR,
  BUILTIN_HOLIDAYS,
} from "./holidays";

const ok = (items: any) => ({
  response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." }, body: { items } },
});

describe("조회 URL", () => {
  it("연도만 주면 그해 전체를 부른다", () => {
    const u = new URL(holidayApiUrl("KEY+/=", 2026));
    expect(u.searchParams.get("solYear")).toBe("2026");
    expect(u.searchParams.get("solMonth")).toBeNull();
    expect(u.searchParams.get("_type")).toBe("json");
    // 인증키에 들어 있는 +/= 가 그대로 실려 나가야 한다 (URLSearchParams 가 한 번만 인코딩)
    expect(u.searchParams.get("serviceKey")).toBe("KEY+/=");
  });

  it("달을 주면 두 자리로 채운다", () => {
    expect(new URL(holidayApiUrl("K", 2026, 3)).searchParams.get("solMonth")).toBe("03");
  });
});

describe("locdate 읽기", () => {
  it("숫자로 와도 문자로 와도 읽는다", () => {
    expect(locdateToYmd(20260817)).toBe("2026-08-17");
    expect(locdateToYmd("20261009")).toBe("2026-10-09");
  });

  it("모양이 아니면 null — 조용히 엉뚱한 날을 만들지 않는다", () => {
    expect(locdateToYmd("2026-08-17")).toBeNull();
    expect(locdateToYmd("202608")).toBeNull();
    expect(locdateToYmd(20261301)).toBeNull(); // 13월
    expect(locdateToYmd(undefined as any)).toBeNull();
  });
});

describe("이름 다듬기", () => {
  it("관보 표기를 흔히 쓰는 이름으로", () => {
    expect(normalizeHolidayName("1월1일")).toBe("신정");
    expect(normalizeHolidayName("기독탄신일")).toBe("성탄절");
  });

  it("모르는 이름은 손대지 않는다 (임시공휴일·선거일이 여기로 온다)", () => {
    expect(normalizeHolidayName("제9회 전국동시지방선거")).toBe("제9회 전국동시지방선거");
    expect(normalizeHolidayName("임시공휴일")).toBe("임시공휴일");
  });

  it("빈 이름이어도 자리는 남긴다", () => {
    expect(normalizeHolidayName("")).toBe("공휴일");
  });
});

describe("응답 읽기 — 모양이 조용히 바뀌는 API 다", () => {
  it("여러 건", () => {
    const { items } = parseHolidayResponse(
      ok({
        item: [
          { locdate: 20260101, dateName: "1월1일", isHoliday: "Y" },
          { locdate: 20260302, dateName: "대체공휴일", isHoliday: "Y" },
        ],
      })
    );
    expect(items).toEqual([
      { date: "2026-01-01", name: "신정" },
      { date: "2026-03-02", name: "대체공휴일" },
    ]);
  });

  it("한 건이면 item 이 배열이 아니라 객체로 온다", () => {
    const { items } = parseHolidayResponse(ok({ item: { locdate: 20261009, dateName: "한글날", isHoliday: "Y" } }));
    expect(items).toEqual([{ date: "2026-10-09", name: "한글날" }]);
  });

  it("없으면 items 가 빈 문자열이다 — 여기서 터지지 않아야 한다", () => {
    expect(parseHolidayResponse(ok("")).items).toEqual([]);
    expect(parseHolidayResponse({}).items).toEqual([]);
  });

  it("공휴일이 아닌 날(절기·잡절)은 뺀다", () => {
    const { items } = parseHolidayResponse(
      ok({
        item: [
          { locdate: 20260606, dateName: "현충일", isHoliday: "Y" },
          { locdate: 20260805, dateName: "입추", isHoliday: "N" },
        ],
      })
    );
    expect(items.map((h) => h.name)).toEqual(["현충일"]);
  });

  it("못 읽은 항목은 버리지 않고 센다", () => {
    const { items, skipped } = parseHolidayResponse(
      ok({ item: [{ locdate: "이상함", dateName: "?" }, { locdate: 20260101, dateName: "1월1일" }] })
    );
    expect(items).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("같은 날이 두 줄이면 한 줄만 남긴다", () => {
    const { items } = parseHolidayResponse(
      ok({
        item: [
          { locdate: 20260925, dateName: "추석", isHoliday: "Y" },
          { locdate: 20260925, dateName: "추석연휴", isHoliday: "Y" },
        ],
      })
    );
    expect(items).toEqual([{ date: "2026-09-25", name: "추석" }]);
  });
});

describe("에러 봉투 — 인증 실패도 HTTP 200 으로 온다", () => {
  it("정상", () => {
    expect(responseError(ok({ item: [] }))).toBeNull();
  });

  it("서비스 에러코드", () => {
    expect(
      responseError({ response: { header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR" } } })
    ).toContain("30");
  });

  it("인증 실패는 아예 다른 봉투로 온다", () => {
    const e = responseError({
      OpenAPI_ServiceResponse: {
        cmmMsgHeader: { returnAuthMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", returnReasonCode: "30" },
      },
    });
    expect(e).toContain("SERVICE_KEY_IS_NOT_REGISTERED_ERROR");
  });

  it("알아볼 수 없는 응답도 에러로 본다 (조용히 '0건' 으로 넘기지 않는다)", () => {
    expect(responseError({ hello: 1 })).toContain("알아볼 수 없");
  });
});

describe("표 대조 — 지우지 않는다", () => {
  const have = [
    { date: "2026-01-01", name: "신정" },
    { date: "2026-03-01", name: "삼일절" },
    { date: "2026-07-20", name: "학원 여름휴무" }, // 학원이 직접 넣은 날
  ];
  const want = [
    { date: "2026-01-01", name: "신정" },
    { date: "2026-03-01", name: "3·1절" },
    { date: "2026-03-02", name: "대체공휴일" },
  ];

  it("없는 날은 넣고, 이름이 다르면 고치고, 남는 날은 알리기만 한다", () => {
    const d = diffHolidays(have, want);
    expect(d.add).toEqual([{ date: "2026-03-02", name: "대체공휴일" }]);
    expect(d.rename).toEqual([{ date: "2026-03-01", from: "삼일절", to: "3·1절" }]);
    expect(d.extra).toEqual([{ date: "2026-07-20", name: "학원 여름휴무" }]);
  });

  it("학원이 직접 넣은 휴무일이 동기화로 사라지지 않는다", () => {
    // 지우는 목록 자체가 없다 — extra 는 '알림' 이지 '삭제 대상' 이 아니다
    expect(Object.keys(diffHolidays(have, want))).toEqual(["add", "rename", "extra"]);
  });

  it("두 번 돌려도 더 할 일이 없다 (멱등)", () => {
    const once = diffHolidays(want, want);
    expect(once.add).toEqual([]);
    expect(once.rename).toEqual([]);
  });
});

describe("표가 채워져 있나", () => {
  const year = (y: number, n: number) =>
    Array.from({ length: n }, (_, i) => `${y}-01-${String(i + 1).padStart(2, "0")}`);

  it("상반기에는 올해만 본다", () => {
    const c = holidayCoverage(year(2026, MIN_HOLIDAYS_PER_YEAR), new Date("2026-03-01T00:00:00Z"));
    expect(c.years.map((y) => y.year)).toEqual([2026]);
    expect(c.warning).toBeNull();
  });

  it("하반기부터는 내년도 함께 본다 (12월 근무를 1월에 정산한다)", () => {
    const c = holidayCoverage(year(2026, 18), new Date("2026-08-06T00:00:00Z"));
    expect(c.years.map((y) => y.year)).toEqual([2026, 2027]);
    expect(c.warning).toContain("2027년 없음");
  });

  it("얇은 해는 몇 일뿐인지 적는다", () => {
    const c = holidayCoverage(year(2026, 3), new Date("2026-03-01T00:00:00Z"));
    expect(c.warning).toContain("2026년 3일뿐");
    expect(c.warning).toContain("휴일근로 가산");
  });

  it("경고일 뿐 막지는 않는다 — years 는 언제나 돌려준다", () => {
    expect(holidayCoverage([], new Date("2026-03-01T00:00:00Z")).years).toHaveLength(1);
  });

  it("동기화 대상은 올해와 내년", () => {
    expect(yearsToSync(new Date("2026-03-01T00:00:00Z"))).toEqual([2026, 2027]);
  });
});

describe("초기 표", () => {
  it("2025~2027 을 덮고, 해마다 충분히 채워져 있다", () => {
    const byYear = new Map<string, number>();
    for (const h of BUILTIN_HOLIDAYS) {
      const y = h.date.slice(0, 4);
      byYear.set(y, (byYear.get(y) ?? 0) + 1);
    }
    expect([...byYear.keys()].sort()).toEqual(["2025", "2026", "2027"]);
    for (const [y, n] of byYear) expect(n, `${y}년`).toBeGreaterThanOrEqual(MIN_HOLIDAYS_PER_YEAR);
  });

  it("날짜가 겹치지 않고 형식이 온전하다", () => {
    const seen = new Set<string>();
    for (const h of BUILTIN_HOLIDAYS) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.name.length).toBeGreaterThan(0);
      expect(seen.has(h.date), h.date).toBe(false);
      seen.add(h.date);
    }
  });

  it("한 번 겪은 빠짐이 다시 생기지 않게 못박는다 (2026)", () => {
    const has = (d: string) => BUILTIN_HOLIDAYS.some((h) => h.date === d);
    // 통째로 빠져 있던 날들
    expect(has("2026-05-24"), "부처님오신날").toBe(true);
    expect(has("2026-10-09"), "한글날").toBe(true);
    expect(has("2026-09-26"), "추석연휴").toBe(true);
    expect(has("2026-06-03"), "지방선거 — 규칙으로는 못 구한다").toBe(true);
    // 주말과 겹쳐 생긴 대체공휴일 (2026년은 넷)
    for (const d of ["2026-03-02", "2026-05-25", "2026-08-17", "2026-10-05"])
      expect(has(d), `대체공휴일 ${d}`).toBe(true);
  });

  it("명절 연휴는 토요일과 겹쳐도 대체공휴일이 없다 (국경일과 규칙이 다르다)", () => {
    // 2026-09-26 은 토요일 추석연휴 — 대체공휴일 9/28 은 생기지 않는다
    expect(BUILTIN_HOLIDAYS.some((h) => h.date === "2026-09-28")).toBe(false);
  });

  it("정렬돼 있다 (사람이 손으로 고치는 표라 눈으로 찾을 수 있어야 한다)", () => {
    const dates = BUILTIN_HOLIDAYS.map((h) => h.date);
    expect(dates).toEqual([...dates].sort());
  });
});
