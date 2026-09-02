import { describe, it, expect } from "vitest";
import { preApproverFor, canPreDecide } from "./leave-approval";

const 박영은 = { id: 7, name: "박영은", active: true, slackUserId: "U_PARK" };

describe("preApproverFor — 어느 신청이 중간결재를 거치는가", () => {
  it("부서에 결재자가 지정돼 있으면 그 사람을 거친다", () => {
    expect(preApproverFor(박영은, 12)?.name).toBe("박영은");
  });
  it("지정이 없는 부서는 직행 (예전 그대로)", () => {
    expect(preApproverFor(null, 12)).toBeNull();
  });
  it("결재자 본인 신청은 건너뛴다 — 자기 결재가 되고, 운영진 승인은 어차피 거친다", () => {
    expect(preApproverFor(박영은, 7)).toBeNull();
  });
  it("퇴사했거나 슬랙 연동이 없는 결재자는 없는 것으로 본다 — DM 못 받는 사람에게 걸면 신청이 멈춘다", () => {
    expect(preApproverFor({ ...박영은, active: false }, 12)).toBeNull();
    expect(preApproverFor({ ...박영은, slackUserId: null }, 12)).toBeNull();
  });
});

describe("canPreDecide — 중간결재 버튼을 누를 수 있는 사람", () => {
  it("지정된 결재자 본인", () => {
    expect(canPreDecide("U_PARK", "U_PARK", false)).toBe(true);
  });
  it("운영진은 결재자 부재 시 대행할 수 있다", () => {
    expect(canPreDecide("U_ADMIN", "U_PARK", true)).toBe(true);
  });
  it("그 밖의 사람은 못 누른다", () => {
    expect(canPreDecide("U_OTHER", "U_PARK", false)).toBe(false);
  });
});
