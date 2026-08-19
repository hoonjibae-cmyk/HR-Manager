// 명세서 발송 대상 가리기.
//
// 여기서 틀리면 ① 안 고른 사람에게 명세서가 나가거나 ② 화면이 적은 인원과 실제 발송이
// 어긋난다. 둘 다 직원 메일함에 들어간 뒤라 되돌릴 수 없다.

import { describe, it, expect } from "vitest";
import {
  planPayslipSend,
  sendConfirmText,
  nothingToSendNotice,
  type SendCandidate,
} from "./payslip-send";

let seq = 1;
const c = (over: Partial<SendCandidate> = {}): SendCandidate => ({
  id: seq++,
  name: "김지연",
  email: "a@yoossam.edu",
  status: "DRAFT",
  ...over,
});

describe("대상 가리기", () => {
  it("고르지 않으면 그 달 전체를 본다", () => {
    const rows = [c({ id: 1 }), c({ id: 2 }), c({ id: 3 })];
    expect(planPayslipSend(rows).targets).toHaveLength(3);
    expect(planPayslipSend(rows, null).targets).toHaveLength(3);
  });

  it("고르면 그것만 본다", () => {
    const rows = [c({ id: 1, name: "가" }), c({ id: 2, name: "나" }), c({ id: 3, name: "다" })];
    const plan = planPayslipSend(rows, [2]);
    expect(plan.targets.map((r) => r.name)).toEqual(["나"]);
  });

  /*
   * ⚠ 명단 화면의 필터는 `[]` 가 '전체' 지만 여기서는 반대다. 빈 배열을 전체로 읽으면
   * 아무도 안 고르고 누른 실수가 **전 직원 발송**이 된다.
   */
  it("**빈 배열은 '전체' 가 아니라 '아무도 안 고름' 이다**", () => {
    const rows = [c({ id: 1 }), c({ id: 2 })];
    expect(planPayslipSend(rows, []).targets).toHaveLength(0);
    expect(planPayslipSend(rows, undefined).targets).toHaveLength(2);
  });

  it("발송된 기록은 잠겨 있어 빠진다", () => {
    const plan = planPayslipSend([c({ name: "보냄", status: "SENT" }), c({ name: "아직" })]);
    expect(plan.targets.map((r) => r.name)).toEqual(["아직"]);
    expect(plan.alreadySent.map((r) => r.name)).toEqual(["보냄"]);
  });

  // 조용히 빠지면 그 사람만 명세서를 못 받은 것을 아무도 모른다
  it("**메일 주소가 없는 사람은 따로 세어 낸다** (조용히 빼지 않는다)", () => {
    const plan = planPayslipSend([c({ name: "없음", email: null }), c({ name: "빈칸", email: "  " })]);
    expect(plan.targets).toHaveLength(0);
    expect(plan.noEmail.map((r) => r.name)).toEqual(["없음", "빈칸"]);
  });

  it("발송됨이 메일 없음보다 앞선다 — 잠긴 건은 주소가 없어도 '이미 발송'", () => {
    const plan = planPayslipSend([c({ status: "SENT", email: null })]);
    expect(plan.alreadySent).toHaveLength(1);
    expect(plan.noEmail).toHaveLength(0);
  });
});

describe("확인창 문안", () => {
  const opts = { selective: true };

  it("**받는 사람의 이름과 메일 주소를 그대로 적는다**", () => {
    const t = sendConfirmText(planPayslipSend([c({ name: "김지연", email: "kim@x.com" })]), 2026, 8, opts)!;
    expect(t).toContain("김지연");
    expect(t).toContain("kim@x.com");
    expect(t).toContain("고른 1명");
  });

  it("전체 발송이면 '고른' 이라고 적지 않는다", () => {
    const t = sendConfirmText(planPayslipSend([c()]), 2026, 8, { selective: false })!;
    expect(t).not.toContain("고른");
    expect(t).toContain("2026년 8월");
  });

  it("메일 없는 사람 · 이미 보낸 사람을 함께 알린다", () => {
    const plan = planPayslipSend([c({ name: "정상" }), c({ name: "무메일", email: null }), c({ name: "기발송", status: "SENT" })]);
    const t = sendConfirmText(plan, 2026, 8, opts)!;
    expect(t).toContain("무메일");
    expect(t).toContain("기발송");
    expect(t).toContain("잠금 해제");
  });

  it("너무 많으면 줄여 적는다 (창이 화면 밖으로 나가지 않게)", () => {
    const rows = Array.from({ length: 20 }, (_, i) => c({ name: `사람${i}` }));
    const t = sendConfirmText(planPayslipSend(rows), 2026, 8, opts)!;
    expect(t).toContain("외 5명");
  });

  it("보낼 사람이 없으면 확인창을 띄우지 않는다", () => {
    expect(sendConfirmText(planPayslipSend([]), 2026, 8, opts)).toBeNull();
    expect(sendConfirmText(planPayslipSend([c({ status: "SENT" })]), 2026, 8, opts)).toBeNull();
  });
});

describe("보낼 것이 없을 때 안내", () => {
  it("왜 없는지 적는다", () => {
    const plan = planPayslipSend([c({ status: "SENT" }), c({ email: null })]);
    const n = nothingToSendNotice(plan, { selective: true });
    expect(n).toContain("이미 발송됨 1명");
    expect(n).toContain("메일 주소 없음 1명");
  });

  it("아무것도 안 골랐으면 고르라고 한다", () => {
    expect(nothingToSendNotice(planPayslipSend([], []), { selective: true })).toContain("고르세요");
  });

  it("그 달 기록 자체가 없으면 그렇게 적는다", () => {
    expect(nothingToSendNotice(planPayslipSend([]), { selective: false })).toContain("급여 기록이 없습니다");
  });
});
