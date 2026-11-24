// 무급휴직 DB 어댑터 — 판정은 순수 함수가 하고, 여기서는 **조립**이 맞는지 본다:
// 산정에 쓴 휴직과 지금 등록을 견줘 '다시 산정' 을 띄우는가, 지우거나 옮긴 달까지 잡는가.

import { describe, it, expect, vi, beforeEach } from "vitest";

const leaves: any[] = [];
const payrolls: any[] = [];

vi.mock("./db", () => ({
  prisma: {
    unpaidLeave: {
      findMany: async ({ where }: any) =>
        leaves.filter((l) => {
          if (where?.employeeId?.in && !where.employeeId.in.includes(l.employeeId)) return false;
          if (typeof where?.employeeId === "number" && where.employeeId !== l.employeeId) return false;
          if (where?.startDate?.lte && l.startDate > where.startDate.lte) return false;
          if (where?.endDate?.gte && l.endDate < where.endDate.gte) return false;
          return true;
        }),
    },
    payrollRecord: {
      findMany: async ({ where }: any) =>
        payrolls.filter((r) => {
          if (where?.employeeId != null && r.employeeId !== where.employeeId) return false;
          if (where?.breakdown?.contains && !(r.breakdown ?? "").includes(where.breakdown.contains)) return false;
          if (where?.OR && !where.OR.some((m: any) => m.year === r.year && m.month === r.month)) return false;
          return true;
        }),
    },
  },
}));

const {
  unpaidLeavesInMonth,
  unpaidFlagsFor,
  unpaidStaleNames,
  unpaidImpactFor,
  unpaidImpactsOfEmployee,
  monthsTouched,
  impactNotice,
  spansFromMeta,
} = await import("./unpaid-leave-service");
const { monthPayDays, unpaidLeaveMetaOf, settleLeavePay } = await import("./unpaid-leave");

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const HIRE = d("2025-03-04");
const emp = { id: 1, name: "가상직원", hireDate: HIRE, resignDate: null as Date | null };
const leave = (a: string, b: string, employeeId = 1) => ({ employeeId, startDate: d(a), endDate: d(b) });

/** 그 달을 `spans` 의 휴직으로 산정해 둔 급여 기록 */
const record = (year: number, month: number, applied: Array<[string, string]> | null, over: any = {}) => {
  const meta = applied
    ? unpaidLeaveMetaOf(monthPayDays(year, month, HIRE, null, applied.map(([a, b]) => leave(a, b))))
    : null;
  return {
    id: year * 100 + month,
    employeeId: 1,
    year,
    month,
    status: "DRAFT",
    gross: 3_000_000,
    breakdown: JSON.stringify({ notes: [], ...(meta ? { unpaidLeave: meta } : {}) }),
    employee: emp,
    ...over,
  };
};

beforeEach(() => {
  leaves.length = 0;
  payrolls.length = 0;
});

describe("unpaidLeavesInMonth — 그 달에 걸친 휴직만", () => {
  it("직원별로 묶고, 그 달과 무관한 휴직은 뺀다", async () => {
    leaves.push(leave("2026-11-16", "2026-11-30"), leave("2026-10-01", "2026-10-05"), leave("2026-11-03", "2026-11-04", 2));
    const map = await unpaidLeavesInMonth([1, 2, 3], 2026, 11);
    expect(map.get(1)).toHaveLength(1);
    expect(map.get(2)).toHaveLength(1);
    expect(map.has(3)).toBe(false);
  });
  it("달을 걸친 휴직은 양쪽 달 모두에서 잡힌다", async () => {
    leaves.push(leave("2026-11-20", "2026-12-10"));
    expect((await unpaidLeavesInMonth([1], 2026, 11)).get(1)).toHaveLength(1);
    expect((await unpaidLeavesInMonth([1], 2026, 12)).get(1)).toHaveLength(1);
    expect((await unpaidLeavesInMonth([1], 2027, 1)).has(1)).toBe(false);
  });
  it("직원이 없으면 조회하지 않는다", async () => {
    expect((await unpaidLeavesInMonth([], 2026, 11)).size).toBe(0);
  });
});

describe("unpaidFlagsFor — 급여 화면의 행 표시", () => {
  it("휴직과 무관한 행에는 표시가 없다", async () => {
    const flags = await unpaidFlagsFor(2026, 11, [record(2026, 11, null)]);
    expect(flags.size).toBe(0);
  });

  it("★ 산정한 뒤에 휴직을 등록했으면 '다시 산정' — 지금 등록을 함께 알린다", async () => {
    leaves.push(leave("2026-11-16", "2026-11-30"));
    const flag = (await unpaidFlagsFor(2026, 11, [record(2026, 11, null)])).get(202611)!;
    expect(flag).toEqual({
      applied: null,
      appliedDays: 0,
      word: "무급휴직",
      stale: true,
      now: "무급휴직 11/16~11/30(15일)",
      zeroBasis: false,
    });
  });

  it("휴직을 반영해 산정한 행은 그 기간을 보여 주고, 미반영이 아니다", async () => {
    leaves.push(leave("2026-11-16", "2026-11-30"));
    const flag = (await unpaidFlagsFor(2026, 11, [record(2026, 11, [["2026-11-16", "2026-11-30"]])])).get(202611)!;
    expect(flag).toEqual({
      applied: "무급휴직 11/16~11/30(15일)",
      appliedDays: 15,
      word: "무급휴직",
      stale: false,
      now: "무급휴직 11/16~11/30(15일)",
      zeroBasis: false,
    });
  });

  it("★ 산정한 뒤에 휴직을 지웠으면 그 달은 덜 지급된 상태 — 역시 '다시 산정' 이다", async () => {
    const flag = (await unpaidFlagsFor(2026, 11, [record(2026, 11, [["2026-11-16", "2026-11-30"]])])).get(202611)!;
    expect(flag.stale).toBe(true);
    expect(flag.applied).toBe("무급휴직 11/16~11/30(15일)");
    expect(flag.now).toBeNull();
  });

  it("기간을 고쳤으면 일수가 같아도 잡는다", async () => {
    leaves.push(leave("2026-11-01", "2026-11-15"));
    const flag = (await unpaidFlagsFor(2026, 11, [record(2026, 11, [["2026-11-16", "2026-11-30"]])])).get(202611)!;
    expect(flag.stale).toBe(true);
    expect(flag.now).toBe("무급휴직 11/1~11/15(15일)");
  });

  it("재직 기간 밖의 휴직은 세지 않는다 — 퇴직 뒤 수동 추가한 행에 표시가 붙지 않는다", async () => {
    leaves.push(leave("2026-11-16", "2026-11-30"));
    const resigned = { ...emp, resignDate: d("2026-10-31") };
    const flags = await unpaidFlagsFor(2026, 11, [record(2026, 11, null, { employee: resigned })]);
    expect(flags.size).toBe(0);
  });
});

describe("unpaidStaleNames — 내려받기 경고에 싣는 이름", () => {
  it("미반영인 사람만 이름으로 낸다", async () => {
    leaves.push(leave("2026-11-16", "2026-11-30"));
    const names = await unpaidStaleNames(2026, 11, [
      record(2026, 11, null),
      record(2026, 11, null, { id: 2, employeeId: 2, employee: { ...emp, id: 2, name: "가상무관" } }),
    ]);
    expect(names).toEqual(["가상직원"]);
  });
});

describe("unpaidImpactFor — 등록·수정·삭제 뒤 달마다 무엇을 해야 하는가", () => {
  const months = [
    { year: 2026, month: 11 },
    { year: 2026, month: 12 },
  ];

  it("아직 산정하지 않은 달은 NONE — 산정할 때 저절로 반영된다", async () => {
    leaves.push(leave("2026-11-20", "2026-12-10"));
    const out = await unpaidImpactFor(emp, months);
    expect(out.map((i) => [i.month, i.state, i.leaveDays])).toEqual([
      [11, "NONE", 11],
      [12, "NONE", 10],
    ]);
  });

  it("★ 이미 산정해 둔 달은 STALE, 명세서가 나간 달은 SENT 로 갈라 준다", async () => {
    leaves.push(leave("2026-11-20", "2026-12-10"));
    payrolls.push(record(2026, 11, null, { status: "SENT" }), record(2026, 12, null));
    const out = await unpaidImpactFor(emp, months);
    expect(out.map((i) => [i.month, i.state])).toEqual([
      [11, "SENT"],
      [12, "STALE"],
    ]);
    expect(out[1].gross).toBe(3_000_000);
  });

  it("지금 등록대로 산정돼 있으면 OK — 발송된 달이어도 손댈 것이 없다", async () => {
    leaves.push(leave("2026-11-16", "2026-11-30"));
    payrolls.push(record(2026, 11, [["2026-11-16", "2026-11-30"]], { status: "SENT" }));
    const out = await unpaidImpactFor(emp, [{ year: 2026, month: 11 }]);
    expect(out[0].state).toBe("OK");
  });

  it("재직하지 않은 달은 내지 않는다", async () => {
    leaves.push(leave("2026-11-16", "2026-11-30"));
    const out = await unpaidImpactFor({ ...emp, resignDate: d("2026-10-31") }, [{ year: 2026, month: 11 }]);
    expect(out).toEqual([]);
  });
});

describe("unpaidImpactsOfEmployee — 카드가 늘 띄우는 달", () => {
  it("★ 휴직을 지우거나 옮겨 더는 걸리지 않는 달도, 휴직으로 일할해 둔 급여가 있으면 잡는다", async () => {
    // 12/1~12/10 로 산정해 둔 뒤 휴직을 11월로 옮김 → 12월 급여는 덜 지급된 채다
    leaves.push(leave("2026-11-01", "2026-11-15"));
    payrolls.push(record(2026, 11, [["2026-11-01", "2026-11-15"]]), record(2026, 12, [["2026-12-01", "2026-12-10"]]));
    const out = await unpaidImpactsOfEmployee(emp, leaves);
    expect(out.map((i) => [i.month, i.state, i.leaveDays])).toEqual([
      [11, "OK", 15],
      [12, "STALE", 0],
    ]);
  });

  it("휴직도 없고 일할해 둔 급여도 없으면 볼 달이 없다", async () => {
    payrolls.push(record(2026, 11, null));
    expect(await unpaidImpactsOfEmployee(emp, [])).toEqual([]);
  });
});

describe("monthsTouched · impactNotice · spansFromMeta", () => {
  it("옛 기간과 새 기간이 걸친 달을 겹치지 않게 합친다", () => {
    expect(monthsTouched([leave("2026-11-20", "2026-12-10"), leave("2026-12-05", "2027-01-03")])).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
    expect(monthsTouched([])).toEqual([]);
  });

  it("다시 산정할 달과 발송된 달을 갈라 이름으로 적는다", () => {
    const base = { leaveDays: 5, daysInMonth: 30, gross: 1 };
    const msg = impactNotice([
      { year: 2026, month: 11, state: "STALE", ...base },
      { year: 2026, month: 12, state: "SENT", ...base },
      { year: 2027, month: 1, state: "NONE", ...base, gross: null },
    ]);
    expect(msg).toContain("이미 산정해 둔 급여가 있습니다 — 2026년 11월");
    expect(msg).toContain("명세서가 이미 발송된 달입니다 — 2026년 12월");
    expect(msg).not.toContain("2027년 1월");
  });

  it("손댈 달이 없으면 안내가 비어 있다", () => {
    expect(impactNotice([{ year: 2026, month: 11, state: "NONE", leaveDays: 5, daysInMonth: 30, gross: null }])).toBe("");
    expect(impactNotice([])).toBe("");
  });

  it("기록에 남긴 구간을 계산용 구간으로 되돌린다 — 공제만 다시 낼 때 산정 때의 휴직을 쓴다", () => {
    const meta = unpaidLeaveMetaOf(monthPayDays(2026, 11, HIRE, null, [leave("2026-11-16", "2026-11-30")]));
    const spans = spansFromMeta(meta);
    expect(spans).toHaveLength(1);
    expect(spans[0].startDate.toISOString().slice(0, 10)).toBe("2026-11-16");
    expect(spans[0].endDate.toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(spansFromMeta(null)).toEqual([]);
  });
});

describe("유급휴직·휴업 — 구분과 지급 조건까지 읽고 견준다", () => {
  const shutdown = (a: string, b: string, payRate: number) => ({ ...leave(a, b), kind: "SHUTDOWN", payRate, payAmount: null });
  /** 그 달을 `ls` 로 산정해 둔 급여 기록 — 서비스가 남기는 근거 그대로(원급여 월 300만) */
  const settledRecord = (ls: any[], over: any = {}) => {
    const pd = settleLeavePay(monthPayDays(2026, 11, HIRE, null, ls), [], 3_000_000);
    return {
      id: 202611,
      employeeId: 1,
      year: 2026,
      month: 11,
      status: "DRAFT",
      gross: 2_550_000,
      breakdown: JSON.stringify({ notes: [], unpaidLeave: unpaidLeaveMetaOf(pd) }),
      employee: emp,
      ...over,
    };
  };

  it("★ 그 달 등록을 구분·비율·금액까지 넘긴다 — 빠지면 유급휴직이 무급으로 계산된다", async () => {
    leaves.push(shutdown("2026-11-16", "2026-11-30", 0.7), { ...leave("2026-11-03", "2026-11-04"), kind: "PAID", payRate: null, payAmount: 200_000 });
    const got = (await unpaidLeavesInMonth([1], 2026, 11)).get(1)!;
    expect(got.map((l) => [l.kind, l.payRate, l.payAmount])).toEqual(
      expect.arrayContaining([
        ["SHUTDOWN", 0.7, null],
        ["PAID", null, 200_000],
      ])
    );
  });

  it("★ 반영된 행 — 산정에 쓴 휴업수당 금액을 보이고, 무엇이라 부를지를 함께 준다", async () => {
    const l = shutdown("2026-11-16", "2026-11-30", 0.7);
    leaves.push(l);
    const flag = (await unpaidFlagsFor(2026, 11, [settledRecord([l])])).get(202611)!;
    expect(flag).toEqual({
      applied: "휴업 11/16~11/30(15일) 휴업수당 1,050,000원(70%)",
      appliedDays: 15,
      word: "휴업",
      stale: false,
      // 지금 등록은 금액이 아니라 조건으로 적는다 — 금액은 산정해야 나온다
      now: "휴업 11/16~11/30(15일) 원급여의 70% 지급",
      zeroBasis: false,
    });
  });

  it("★ 비율 지급인데 원급여가 없어 0원으로 산정된 행을 짚는다 — 0% 휴업은 해당하지 않는다", async () => {
    const zero = (ls: any[]) => {
      const pd = settleLeavePay(monthPayDays(2026, 11, HIRE, null, ls), [], 0);
      return { ...settledRecord(ls), breakdown: JSON.stringify({ notes: [], unpaidLeave: unpaidLeaveMetaOf(pd) }) };
    };
    const rate = shutdown("2026-11-16", "2026-11-30", 0.7);
    leaves.push(rate);
    expect((await unpaidFlagsFor(2026, 11, [zero([rate])])).get(202611)!.zeroBasis).toBe(true);
    leaves.length = 0;
    const none = shutdown("2026-11-16", "2026-11-30", 0);
    leaves.push(none);
    expect((await unpaidFlagsFor(2026, 11, [zero([none])])).get(202611)!.zeroBasis).toBe(false);
  });

  it("★ 날짜는 그대로인데 비율만 고쳐도 '다시 산정' 이다", async () => {
    leaves.push(shutdown("2026-11-16", "2026-11-30", 1));
    const flag = (await unpaidFlagsFor(2026, 11, [settledRecord([shutdown("2026-11-16", "2026-11-30", 0.7)])])).get(202611)!;
    expect(flag.stale).toBe(true);
    expect(flag.now).toBe("휴업 11/16~11/30(15일) 원급여의 100% 지급");
  });

  it("★ 무급휴직으로 산정해 둔 뒤 휴업으로 바꿨으면 잡고, 이름은 섞인 것으로 적는다", async () => {
    leaves.push(shutdown("2026-11-16", "2026-11-30", 0.7));
    const flag = (await unpaidFlagsFor(2026, 11, [record(2026, 11, [["2026-11-16", "2026-11-30"]])])).get(202611)!;
    expect(flag.stale).toBe(true);
    expect(flag.word).toBe("휴직·휴업");
    expect(flag.applied).toBe("무급휴직 11/16~11/30(15일)");
  });

  it("달별 영향 — 유급휴직·휴업일도 쉰 날로 세고, 조건이 바뀐 달을 STALE 로 준다", async () => {
    leaves.push(shutdown("2026-11-16", "2026-11-30", 1));
    payrolls.push(settledRecord([shutdown("2026-11-16", "2026-11-30", 0.7)]));
    const out = await unpaidImpactFor(emp, [{ year: 2026, month: 11 }]);
    expect(out.map((i) => [i.month, i.state, i.leaveDays])).toEqual([[11, "STALE", 15]]);
  });
});
