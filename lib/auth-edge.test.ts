// 엣지(Web Crypto) 구현이 node crypto 구현과 같은 답을 내는지 못박는다 —
// 미들웨어(엣지)가 갈아 끼운 쿠키를 API 라우트(node, lib/auth.ts)가 못 읽으면
// 갱신되는 순간 전원이 로그아웃된다.
import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { hmacHex, verifySessionEdge, makeSessionEdge } from "./auth-edge";

const SECRET = "test-secret";
const nodeSign = (value: string) =>
  `${value}.${createHmac("sha256", SECRET).update(value).digest("hex")}`;

describe("auth-edge — node crypto 와 서명 호환", () => {
  it("HMAC-SHA256/hex 가 node createHmac 과 같다", async () => {
    const v = "admin:1725400000000";
    expect(await hmacHex(v, SECRET)).toBe(
      createHmac("sha256", SECRET).update(v).digest("hex")
    );
  });

  it("node 가 서명한 쿠키를 엣지가 검증한다 (발급 시각을 돌려준다)", async () => {
    expect(await verifySessionEdge(nodeSign("admin:1725400000000"), SECRET)).toBe(1725400000000);
  });

  it("엣지가 만든 쿠키를 node 방식 검증이 통과한다", async () => {
    const cookie = await makeSessionEdge(SECRET);
    const idx = cookie.lastIndexOf(".");
    const value = cookie.slice(0, idx);
    expect(cookie.slice(idx + 1)).toBe(createHmac("sha256", SECRET).update(value).digest("hex"));
    expect(value.startsWith("admin:")).toBe(true);
  });

  it("서명이 다르거나 모양이 아니면 null", async () => {
    expect(await verifySessionEdge(nodeSign("admin:123").replace(/.$/, "0"), SECRET)).toBeNull();
    expect(await verifySessionEdge("user:123.deadbeef", SECRET)).toBeNull();
    expect(await verifySessionEdge(undefined, SECRET)).toBeNull();
    expect(await verifySessionEdge("아무거나", SECRET)).toBeNull();
  });
});
