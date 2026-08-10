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
