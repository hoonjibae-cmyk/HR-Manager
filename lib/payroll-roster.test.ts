// 급여 시트에 누가 오르는가 — 전월 자 퇴직자 자동 제외와 수동 추가.
//
// 실제로 겪은 것: 월초에 급여를 한 번 돌린 뒤 퇴직일을 입력하면
// 그 달 시트에 만근 금액이 그대로 남아 세무 제출자료·은행 이체 파일까지 흘러갔다.
// 산정이 건너뛰는 것만으로는 부족하고 **남은 기록을 내려야** 한다.

import { describe, it, expect } from "vitest";
import {
  employedInMonth,
  rosterVerdict,
  planSheetCleanup,
  cleanupNotice,
  monthSpan,
  ymd,
  resignStatusOf,
  resignBadgeLabel,
  resignedSummary,
  type RosterEmp,
  type SheetRecord,
} from "./payroll-roster";
import { prorationRatioFor } from "./payroll-service";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const emp = (over: Partial<RosterEmp> = {}): RosterEmp => ({
  id: 1,
  name: "김지연",
  hireDate: d("2024-03-01"),
  resignDate: null,
  ...over,
});

const rec = (over: Partial<SheetRecord> = {}): SheetRecord => ({
  id: 100,
  employeeId: 1,
  status: "DRAFT",
  manualAdd: false,
  gross: 3_400_000,
  ...over,
});

describe("employedInMonth — 그 달에 하루라도 재직했는가", () => {
  it("재직 중이면 언제나 참", () => {
    expect(employedInMonth(emp(), 2026, 8)).toBe(true);
  });

  it("전월 말일 퇴직 → 이 달은 거짓", () => {
    expect(employedInMonth(emp({ resignDate: d("2026-07-31") }), 2026, 8)).toBe(false);
  });

  it("전월 말일 퇴직이어도 **그 달(7월)** 은 참 — 마지막 급여는 나가야 한다", () => {
    expect(employedInMonth(emp({ resignDate: d("2026-07-31") }), 2026, 7)).toBe(true);
  });

  it("이 달 1일 퇴직 → 참 (하루라도 재직했다)", () => {
    expect(employedInMonth(emp({ resignDate: d("2026-08-01") }), 2026, 8)).toBe(true);
  });

  it("월중 퇴직 → 참", () => {
    expect(employedInMonth(emp({ resignDate: d("2026-08-15") }), 2026, 8)).toBe(true);
  });

  it("다음 달 입사 → 거짓", () => {
    expect(employedInMonth(emp({ hireDate: d("2026-09-01") }), 2026, 8)).toBe(false);
  });

  it("말일 입사 → 참", () => {
    expect(employedInMonth(emp({ hireDate: d("2026-08-31") }), 2026, 8)).toBe(true);
  });

  it("입·퇴사일에 시각이 붙어 있어도 날짜로만 본다", () => {
    const e = emp({ resignDate: new Date("2026-07-31T23:59:00Z") });
    expect(employedInMonth(e, 2026, 8)).toBe(false);
    const e2 = emp({ hireDate: new Date("2026-08-31T13:00:00Z") });
    expect(employedInMonth(e2, 2026, 8)).toBe(true);
  });

  // 둘이 어긋나면 시트에는 올라오는데 금액이 0 이거나 그 반대가 된다
  it("**일할계산 비율 > 0 과 같은 판정**이어야 한다", () => {
    const cases: RosterEmp[] = [
      emp(),
      emp({ resignDate: d("2026-07-31") }),
      emp({ resignDate: d("2026-08-01") }),
      emp({ resignDate: d("2026-08-15") }),
      emp({ resignDate: d("2026-08-31") }),
      emp({ hireDate: d("2026-08-31") }),
      emp({ hireDate: d("2026-09-01") }),
      emp({ hireDate: d("2026-08-10"), resignDate: d("2026-08-20") }),
    ];
    for (const e of cases) {
      const ratio = prorationRatioFor(2026, 8, e.hireDate, e.resignDate ?? null);
      expect(employedInMonth(e, 2026, 8)).toBe(ratio > 0);
    }
  });
});

describe("monthSpan / ymd", () => {
  it("말일을 정확히 잡는다 (윤년 2월 포함)", () => {
    expect(ymd(monthSpan(2026, 2).end)).toBe("2026-02-28");
    expect(ymd(monthSpan(2028, 2).end)).toBe("2028-02-29");
    expect(ymd(monthSpan(2026, 12).end)).toBe("2026-12-31");
  });
});

describe("rosterVerdict — 왜 있는가 / 왜 없는가", () => {
  it("재직자는 사유를 적지 않는다", () => {
    const v = rosterVerdict(emp(), 2026, 8);
    expect(v).toMatchObject({ include: true, reason: "EMPLOYED", note: "" });
  });

  it("전월 퇴직자는 퇴직일을 사유에 적는다", () => {
    const v = rosterVerdict(emp({ resignDate: d("2026-07-31") }), 2026, 8);
    expect(v.include).toBe(false);
    expect(v.reason).toBe("RESIGNED");
    expect(v.note).toContain("2026-07-31");
    expect(v.note).toContain("김지연");
  });

  it("아직 입사 전이면 RESIGNED 가 아니라 NOT_HIRED", () => {
    const v = rosterVerdict(emp({ hireDate: d("2026-09-01") }), 2026, 8);
    expect(v.reason).toBe("NOT_HIRED");
    expect(v.note).toContain("2026-09-01");
  });

  it("수동 추가면 재직 기간이 없어도 포함이고, 그 사실을 적는다", () => {
    const v = rosterVerdict(emp({ resignDate: d("2026-07-31") }), 2026, 8, true);
    expect(v).toMatchObject({ include: true, reason: "MANUAL" });
    expect(v.note).toContain("관리자");
  });

  it("재직자에게 수동 표시가 붙어 있어도 EMPLOYED 로 본다", () => {
    expect(rosterVerdict(emp(), 2026, 8, true).reason).toBe("EMPLOYED");
  });

  it("이름이 없으면 사번 대신 id 로 적는다 (빈칸으로 두지 않는다)", () => {
    const v = rosterVerdict({ id: 7, hireDate: d("2024-01-01"), resignDate: d("2026-01-31") }, 2026, 8);
    expect(v.note).toContain("#7");
  });
});

describe("planSheetCleanup — 남은 기록 내리기", () => {
  it("전월 퇴직자의 작성중 기록은 내린다", () => {
    const e = emp({ resignDate: d("2026-07-31") });
    const plan = planSheetCleanup([rec()], [e], 2026, 8);
    expect(plan.remove.map((x) => x.recordId)).toEqual([100]);
    expect(plan.remove[0].reason).toBe("RESIGNED");
    // 얼마짜리를 지웠는지 남긴다 — 퇴직일 오타 하나로 공제 입력값까지 사라진다
    expect(plan.remove[0].gross).toBe(3_400_000);
  });

  it("재직자의 기록은 건드리지 않는다", () => {
    const plan = planSheetCleanup([rec()], [emp()], 2026, 8);
    expect(plan.remove).toHaveLength(0);
    expect(plan.locked).toHaveLength(0);
    expect(plan.kept).toHaveLength(0);
  });

  it("**수동 추가한 기록은 남긴다** — 배치가 지우면 퇴직 정산을 매번 다시 넣어야 한다", () => {
    const e = emp({ resignDate: d("2026-07-31") });
    const plan = planSheetCleanup([rec({ manualAdd: true })], [e], 2026, 8);
    expect(plan.remove).toHaveLength(0);
    expect(plan.kept.map((x) => x.recordId)).toEqual([100]);
    expect(plan.kept[0].reason).toBe("MANUAL");
  });

  it("**이미 발송된 기록은 지우지 않고 알린다** — 명세서가 직원에게 이미 갔다", () => {
    const e = emp({ resignDate: d("2026-07-31") });
    const plan = planSheetCleanup([rec({ status: "SENT" })], [e], 2026, 8);
    expect(plan.remove).toHaveLength(0);
    expect(plan.locked.map((x) => x.recordId)).toEqual([100]);
  });

  it("CONFIRMED 는 잠긴 상태가 아니므로 내린다", () => {
    const e = emp({ resignDate: d("2026-07-31") });
    const plan = planSheetCleanup([rec({ status: "CONFIRMED" })], [e], 2026, 8);
    expect(plan.remove).toHaveLength(1);
  });

  it("직원 카드를 못 찾은 기록은 건드리지 않는다 (근거 없이 지우지 않는다)", () => {
    const plan = planSheetCleanup([rec({ employeeId: 999 })], [emp()], 2026, 8);
    expect(plan.remove).toHaveLength(0);
    expect(plan.locked).toHaveLength(0);
    expect(plan.kept).toHaveLength(0);
  });

  it("여러 명이 섞여도 각각 제 갈래로 나뉜다", () => {
    const emps = [
      emp({ id: 1, name: "재직자" }),
      emp({ id: 2, name: "전월퇴직", resignDate: d("2026-07-15") }),
      emp({ id: 3, name: "수동추가", resignDate: d("2026-06-30") }),
      emp({ id: 4, name: "발송됨", resignDate: d("2026-05-31") }),
      emp({ id: 5, name: "입사예정", hireDate: d("2026-10-01") }),
    ];
    const recs = [
      rec({ id: 101, employeeId: 1 }),
      rec({ id: 102, employeeId: 2 }),
      rec({ id: 103, employeeId: 3, manualAdd: true }),
      rec({ id: 104, employeeId: 4, status: "SENT" }),
      rec({ id: 105, employeeId: 5 }),
    ];
    const plan = planSheetCleanup(recs, emps, 2026, 8);
    expect(plan.remove.map((x) => x.recordId).sort()).toEqual([102, 105]);
    expect(plan.kept.map((x) => x.recordId)).toEqual([103]);
    expect(plan.locked.map((x) => x.recordId)).toEqual([104]);
  });
});

describe("resignStatusOf — 조회 시점 기준 퇴직 여부", () => {
  const TODAY = "2026-09-10";

  it("퇴사일이 없으면 NONE", () => {
    expect(resignStatusOf(null, TODAY)).toBe("NONE");
    expect(resignStatusOf(undefined, TODAY)).toBe("NONE");
  });

  it("지난 퇴사일이면 RESIGNED", () => {
    expect(resignStatusOf("2026-08-15", TODAY)).toBe("RESIGNED");
  });

  it("**오늘이 퇴사일이면 RESIGNED** — 그날까지가 재직이지만 화면은 이미 나간 것으로 알려야 한다", () => {
    expect(resignStatusOf("2026-09-10", TODAY)).toBe("RESIGNED");
  });

  it("아직 오지 않은 퇴사일이면 LEAVING", () => {
    expect(resignStatusOf("2026-09-30", TODAY)).toBe("LEAVING");
  });

  it("ISO 문자열로 와도 날짜만 본다 (API 응답이 그대로 들어온다)", () => {
    expect(resignStatusOf("2026-08-15T00:00:00.000Z", TODAY)).toBe("RESIGNED");
    expect(resignStatusOf("2026-09-30T00:00:00.000Z", TODAY)).toBe("LEAVING");
  });

  // 8월 시트에 8/15 퇴직자가 있는 건 맞는 일이다(마지막 급여). 문제는 9월에 그 화면을
  // 열었을 때 재직자와 구분이 안 되는 것이라, 판정은 '그 달' 이 아니라 '오늘' 로 한다.
  it("그 달 재직 여부와는 별개다 — 8월 시트의 8/15 퇴직자는 8월엔 재직, 9월엔 이미 퇴직", () => {
    const e = emp({ resignDate: d("2026-08-15") });
    expect(employedInMonth(e, 2026, 8)).toBe(true);
    expect(resignStatusOf("2026-08-15", "2026-08-10")).toBe("LEAVING");
    expect(resignStatusOf("2026-08-15", "2026-09-10")).toBe("RESIGNED");
  });
});

describe("resignBadgeLabel — 날짜를 함께 적는다", () => {
  it("퇴직은 날짜 + '퇴직'", () => {
    expect(resignBadgeLabel("2026-08-15", "RESIGNED")).toBe("2026-08-15 퇴직");
  });

  it("예정은 '퇴사 예정' 으로 갈라 적는다 — 같은 말로 적으면 이미 나간 줄 안다", () => {
    expect(resignBadgeLabel("2026-09-30", "LEAVING")).toBe("2026-09-30 퇴사 예정");
  });

  it("ISO 문자열도 날짜만 남긴다", () => {
    expect(resignBadgeLabel("2026-08-15T00:00:00.000Z", "RESIGNED")).toBe("2026-08-15 퇴직");
  });
});

describe("resignedSummary — 지급 전에 걸리게 하는 한 줄", () => {
  const TODAY = "2026-09-10";
  const rows = [
    { name: "재직자", resignDate: null, gross: 3_000_000 },
    { name: "지난달퇴직", resignDate: "2026-08-15", gross: 1_500_000 },
    { name: "퇴사예정", resignDate: "2026-09-30", gross: 4_000_000 },
    { name: "정산분", resignDate: "2026-06-30T00:00:00.000Z", gross: 700_000 },
  ];

  it("이미 퇴직한 사람만 세고 금액을 더한다", () => {
    const s = resignedSummary(rows, TODAY);
    expect(s.count).toBe(2);
    expect(s.gross).toBe(2_200_000);
    expect(s.names).toEqual(["지난달퇴직", "정산분"]);
  });

  it("**퇴사 예정은 세지 않는다** — 아직 재직 중이라 정상 지급이다", () => {
    expect(resignedSummary(rows, TODAY).names).not.toContain("퇴사예정");
  });

  it("아무도 없으면 0 — 경고를 띄우지 않는다", () => {
    expect(resignedSummary([rows[0]], TODAY)).toEqual({ count: 0, gross: 0, names: [] });
  });
});

describe("cleanupNotice — 조용히 사라지지 않게", () => {
  it("제외한 사람과 사유를 함께 적는다", () => {
    const e = emp({ resignDate: d("2026-07-31") });
    const msg = cleanupNotice(planSheetCleanup([rec()], [e], 2026, 8));
    expect(msg).toContain("김지연");
    expect(msg).toContain("2026-07-31");
  });

  it("발송된 건은 무엇을 하면 되는지까지 적는다", () => {
    const e = emp({ resignDate: d("2026-07-31") });
    const msg = cleanupNotice(planSheetCleanup([rec({ status: "SENT" })], [e], 2026, 8));
    expect(msg).toContain("발송 잠금 해제");
  });

  it("내릴 것이 없으면 빈 문자열 — 아무 일 없었는데 창을 띄우지 않는다", () => {
    expect(cleanupNotice(planSheetCleanup([rec()], [emp()], 2026, 8))).toBe("");
  });
});
