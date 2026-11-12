import { describe, it, expect } from "vitest";
import { decodeHeaderJson } from "./header-json";

// 서버(app/api/payroll/*export)가 싣는 방식 그대로
const encode = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64");

describe("decodeHeaderJson — 헤더로 온 경고를 한글 그대로 읽는다", () => {
  it("한글 이름이 깨지지 않는다", () => {
    const w = { missingAccount: ["가상강사", "가상비율강사넷(유보금)"], count: 2, total: 5_000_000 };
    expect(decodeHeaderJson(encode(w))).toEqual(w);
  });

  it("atob 만으로 풀면 깨진다 — 그래서 이 함수를 쓴다", () => {
    const raw = encode({ name: "가상강사" });
    // 예전 방식: 바이트를 Latin-1 글자로 읽어 이름이 못 읽는 글자가 된다
    expect(JSON.parse(atob(raw)).name).not.toBe("가상강사");
    expect(decodeHeaderJson<{ name: string }>(raw).name).toBe("가상강사");
  });

  it("ASCII 만 든 값·중첩 객체·이모지도 그대로다", () => {
    const w = { count: 3, resigned: { count: 1, gross: 1_234_567, names: ["가상퇴직자 (2026-10-31 퇴직)"] }, note: "🏦 별도 사업장" };
    expect(decodeHeaderJson(encode(w))).toEqual(w);
    expect(decodeHeaderJson(encode({ a: 1 }))).toEqual({ a: 1 });
  });

  it("헤더 값 앞뒤 공백은 무시한다", () => {
    expect(decodeHeaderJson(`  ${encode({ ok: true })}\r\n`)).toEqual({ ok: true });
  });

  it("base64 가 아니면 던진다 — 부르는 쪽이 경고 없이 내려받기를 이어 간다", () => {
    expect(() => decodeHeaderJson("이건 base64 가 아님")).toThrow();
  });
});
