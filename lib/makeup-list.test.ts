// '내 신청 내역' 화면 — 확정 버튼이 **수당 대상인 건에만** 붙는지.
//
// 실제로 결시보강을 테스트로 올려 보니 직전보강과 똑같은 확정 버튼·문구가 나왔다.
// 확정 화면은 '적은 시간이 곧 수당' 이라는 전제로 쓰여 있어서, 그대로 두면
// 지급되는 줄 알고 시간을 적게 된다.

import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
const policy: any = { immediateDefault: true, mandatoryDefault: true, absenceDefault: false, otherDefault: false, weekendDefault: true };

vi.mock("./db", () => ({
  prisma: {
    makeupSession: { findMany: async () => rows },
    overtimePolicy: { findUnique: async () => policy },
  },
}));

const { makeupListBlocks } = await import("./makeup-slack");

const t = (s: string) => new Date(`${s}Z`);
const NOW = t("2026-08-20T09:00:00");

const session = (over: any = {}) => ({
  id: 1,
  category: "IMMEDIATE",
  status: "PLANNED",
  // 확정 가능 기간 안(근무 다음날~다음 달 말일)에 들어오는 지난 근무
  planStart: t("2026-08-15T09:00:00"),
  planEnd: t("2026-08-15T16:00:00"),
  targetClass: "은가람중3",
  payEligible: null,
  confirmedBy: null,
  ...over,
});

/** 확정 버튼(accessory)이 붙은 줄 */
const confirmButtons = (blocks: any[]) =>
  blocks.filter((b) => b.accessory?.action_id === "open_makeup_confirm");

const flat = (blocks: any[]) => JSON.stringify(blocks);

beforeEach(() => {
  rows.length = 0;
});

describe("수당 대상인 건 — 확정 버튼이 붙는다", () => {
  it("직전보강(기본 반영)", async () => {
    rows.push(session());
    const { blocks } = await makeupListBlocks(1, "김지연", NOW);
    expect(confirmButtons(blocks)).toHaveLength(1);
    expect(confirmButtons(blocks)[0].accessory.value).toBe("1");
  });

  it("관리자가 반영하기로 정한 결시보강", async () => {
    rows.push(session({ category: "ABSENCE", payEligible: true }));
    expect(confirmButtons((await makeupListBlocks(1, "김지연", NOW)).blocks)).toHaveLength(1);
  });

  it("이미 확정한 건은 '확정 수정' 으로 다시 열린다", async () => {
    rows.push(session({ status: "CONFIRMED", confirmedBy: "EMPLOYEE" }));
    const btn = confirmButtons((await makeupListBlocks(1, "김지연", NOW)).blocks)[0].accessory;
    expect(btn.text.text).toBe("확정 수정");
  });
});

describe("수당 대상이 아닌 건 — 확정을 닫고 사유를 적는다", () => {
  it("결시보강(기본 미반영)에는 버튼이 붙지 않는다", async () => {
    rows.push(session({ category: "ABSENCE" }));
    const { blocks } = await makeupListBlocks(1, "김지연", NOW);
    expect(confirmButtons(blocks)).toHaveLength(0);
  });

  it("관리자가 미반영으로 정한 직전보강도 닫힌다", async () => {
    rows.push(session({ payEligible: false }));
    expect(confirmButtons((await makeupListBlocks(1, "김지연", NOW)).blocks)).toHaveLength(0);
  });

  it("버튼만 없애지 않고 왜 닫혔는지·무엇을 하면 되는지를 그 줄 밑에 적는다", async () => {
    rows.push(session({ category: "ABSENCE" }));
    const { blocks } = await makeupListBlocks(1, "김지연", NOW);
    const i = blocks.findIndex((b) => b.text?.text?.includes("결시보강"));
    const note = blocks[i + 1];
    expect(note.type).toBe("context");
    expect(note.elements[0].text).toContain("관리자에게 문의");
  });

  it("아직 근무 전인 건에는 그 안내를 붙이지 않는다 (확정 시점 자체가 안 왔다)", async () => {
    rows.push(
      session({
        category: "ABSENCE",
        planStart: t("2026-08-25T09:00:00"),
        planEnd: t("2026-08-25T16:00:00"),
      })
    );
    const { blocks } = await makeupListBlocks(1, "김지연", NOW);
    expect(flat(blocks)).not.toContain("관리자에게 문의");
  });
});

describe("목록 안내 문구", () => {
  it("수당 산정을 무조건적으로 단정하지 않는다", async () => {
    rows.push(session({ category: "ABSENCE" }));
    const { blocks } = await makeupListBlocks(1, "김지연", NOW);
    expect(flat(blocks)).toContain("수당 반영 대상인 건에만");
  });

  it("신청이 없으면 안내만 돌려준다", async () => {
    const { blocks } = await makeupListBlocks(1, "김지연", NOW);
    expect(confirmButtons(blocks)).toHaveLength(0);
    expect(flat(blocks)).toContain("등록된 신청이 없습니다");
  });
});
