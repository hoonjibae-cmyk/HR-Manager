// 공휴일 동기화 — DB·네트워크를 갈아 끼우고 흐름만 본다.
//
// 특히 못박아 두는 것 둘:
//  1) 동기화는 **지우지 않는다** (학원이 직접 넣은 휴무일이 사라지면 그날 수당이 준다)
//  2) 한 건도 못 받으면 **성공으로 보고하지 않는다** (조용히 빈 표로 넘어간다)

import { describe, it, expect, vi, beforeEach } from "vitest";

let rows: { date: Date; name: string }[] = [];
const deleted: string[] = [];

vi.mock("./db", () => ({
  prisma: {
    holiday: {
      findMany: async ({ where }: any = {}) => {
        if (!where?.date) return rows;
        return rows.filter((r) => r.date >= where.date.gte && r.date < where.date.lt);
      },
      upsert: async ({ where, create, update }: any) => {
        const i = rows.findIndex((r) => r.date.getTime() === where.date.getTime());
        if (i >= 0) rows[i] = { ...rows[i], ...update };
        else rows.push(create);
        return rows[i >= 0 ? i : rows.length - 1];
      },
      update: async ({ where, data }: any) => {
        const r = rows.find((x) => x.date.getTime() === where.date.getTime())!;
        Object.assign(r, data);
        return r;
      },
      create: async ({ data }: any) => (rows.push(data), data),
      delete: async ({ where }: any) => {
        deleted.push(where.date.toISOString().slice(0, 10));
        rows = rows.filter((r) => r.date.getTime() !== where.date.getTime());
      },
    },
  },
}));
vi.mock("./activity", () => ({ logActivity: async () => {} }));

const { syncHolidayYear, listHolidays, applyBuiltinHolidays } = await import("./holiday-service");

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const body = (items: any) => ({
  response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." }, body: { items } },
});

/** 문자열이면 그대로(XML), 아니면 JSON 으로 굳혀서 돌려준다 */
function reply(payload: any, ok = true) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return { ok, status: ok ? 200 : 500, text: async () => text } as any;
}

beforeEach(() => {
  rows = [];
  deleted.length = 0;
  process.env.HOLIDAY_API_KEY = "test-key";
  vi.restoreAllMocks();
});

describe("한 해 받아 넣기", () => {
  it("빠진 날을 넣고 이름이 다르면 고친다", async () => {
    rows.push({ date: d("2026-01-01"), name: "1월1일" }); // 다듬어지기 전 이름이 들어 있던 경우
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply(
          body({
            item: [
              { locdate: 20260101, dateName: "1월1일", isHoliday: "Y" },
              { locdate: 20261009, dateName: "한글날", isHoliday: "Y" },
            ],
          })
        )
      )
    );

    const r = await syncHolidayYear(2026);
    expect(r.error).toBeUndefined();
    expect(r.added).toBe(1);
    expect(r.renamed).toBe(1); // 1월1일 → 신정
    expect((await listHolidays(2026)).map((h) => h.date)).toContain("2026-10-09");
  });

  it("학원이 직접 넣은 휴무일은 지우지 않고 알리기만 한다", async () => {
    rows.push({ date: d("2026-07-20"), name: "학원 여름휴무" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(body({ item: [{ locdate: 20260101, dateName: "1월1일", isHoliday: "Y" }] }))));

    const r = await syncHolidayYear(2026);
    expect(r.extra).toEqual([{ date: "2026-07-20", name: "학원 여름휴무" }]);
    expect(deleted).toEqual([]);
    expect((await listHolidays()).some((h) => h.date === "2026-07-20")).toBe(true);
  });

  it("두 번 돌려도 더 넣지 않는다 (멱등)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(body({ item: [{ locdate: 20261009, dateName: "한글날", isHoliday: "Y" }] }))));
    expect((await syncHolidayYear(2026)).added).toBe(1);
    expect((await syncHolidayYear(2026)).added).toBe(0);
    expect(rows).toHaveLength(1);
  });

  it("연도만으로 0건이면 달별로 다시 부른다", async () => {
    const f = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (!u.searchParams.get("solMonth")) return reply(body(""));
      return u.searchParams.get("solMonth") === "10"
        ? reply(body({ item: { locdate: 20261009, dateName: "한글날", isHoliday: "Y" } }))
        : reply(body(""));
    });
    vi.stubGlobal("fetch", f);

    const r = await syncHolidayYear(2026);
    expect(r.added).toBe(1);
    expect(f).toHaveBeenCalledTimes(13); // 연 1회 + 달 12회
  });
});

describe("XML 로 와도 · Encoding 키를 넣어도 받아온다", () => {
  const XML = `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
<body><items><item><dateName>한글날</dateName><isHoliday>Y</isHoliday><locdate>20261009</locdate></item></items></body></response>`;

  it("포털 데이터포맷이 XML 이어도 표에 들어간다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(XML)));
    expect((await syncHolidayYear(2026)).added).toBe(1);
    expect((await listHolidays(2026))[0]).toEqual({ date: "2026-10-09", name: "한글날" });
  });

  it("Encoding 인증키를 넣어도 URL 에 이중 인코딩이 남지 않는다", async () => {
    process.env.HOLIDAY_API_KEY = encodeURIComponent("k/hAF+eq==");
    let called = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ((called = url), reply(XML))));
    await syncHolidayYear(2026);
    expect(called).not.toContain("%25"); // %252F 가 남으면 인증이 통째로 실패한다
    expect(new URL(called).searchParams.get("serviceKey")).toBe("k/hAF+eq==");
  });
});

describe("실패는 실패로 보고한다", () => {
  it("한 건도 못 받으면 성공으로 넘기지 않는다 — 빈 표가 '공휴일 없는 해' 로 읽히면 안 된다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(body(""))));
    const r = await syncHolidayYear(2026);
    expect(r.error).toContain("한 건도 받지 못했습니다");
    expect(r.added).toBe(0);
  });

  it("인증 실패(HTTP 200 + 에러 봉투)도 잡는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({ OpenAPI_ServiceResponse: { cmmMsgHeader: { returnAuthMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", returnReasonCode: "30" } } })
      )
    );
    expect((await syncHolidayYear(2026)).error).toContain("SERVICE_KEY");
  });

  it("인증키가 없으면 부르지도 않는다", async () => {
    delete process.env.HOLIDAY_API_KEY;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await syncHolidayYear(2026)).error).toContain("HOLIDAY_API_KEY");
    expect(f).not.toHaveBeenCalled();
  });

  it("실패해도 표를 건드리지 않는다", async () => {
    rows.push({ date: d("2026-01-01"), name: "신정" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({}, false)));
    await syncHolidayYear(2026);
    expect(rows).toHaveLength(1);
    expect(deleted).toEqual([]);
  });
});

describe("인증키 없이 초기 표로 채우기", () => {
  it("빠진 날만 넣고 사람이 고친 이름은 그대로 둔다", async () => {
    rows.push({ date: d("2026-01-01"), name: "신정 (학원 휴무)" });
    const out = await applyBuiltinHolidays();
    expect(out.added).toBeGreaterThan(0);
    expect((await listHolidays()).find((h) => h.date === "2026-01-01")?.name).toBe("신정 (학원 휴무)");
  });

  it("두 번 돌려도 더 넣지 않는다", async () => {
    const first = await applyBuiltinHolidays();
    expect((await applyBuiltinHolidays()).added).toBe(0);
    expect(rows).toHaveLength(first.added);
  });
});
