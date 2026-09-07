// 엣지(미들웨어)용 세션 서명·검증 — lib/auth.ts 와 **같은 HMAC-SHA256/hex** 다.
//
// 미들웨어는 엣지 런타임이라 node `crypto` 를 못 쓰고 Web Crypto(`crypto.subtle`)만 있다.
// 그래서 같은 알고리즘을 이쪽 말로 한 번 더 적었다 — 두 구현이 같은 답을 내는지
// 테스트(lib/auth-edge.test.ts)가 node crypto 와 대조해 못박는다. 알고리즘·쿠키 모양을
// 바꾸려면 **양쪽을 함께** 바꿔야 한다 (한쪽만 바꾸면 전원이 로그아웃된다).

const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

/** lib/auth.ts 의 COOKIE 와 같은 이름 — node 쪽은 crypto import 때문에 엣지에서 못 불러온다 */
export const SESSION_COOKIE_NAME = "yh_session";

export async function hmacHex(value: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 서명이 맞으면 발급 시각(ms)을, 아니면 null 을 돌려준다 */
export async function verifySessionEdge(
  signed: string | undefined,
  secret = SECRET
): Promise<number | null> {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  if (!value.startsWith("admin:")) return null;
  const expected = await hmacHex(value, secret);
  if (mac.length !== expected.length) return null;
  // 상수시간 비교 — 길이가 같을 때 문자별 XOR 누적
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  const ts = Number(value.slice("admin:".length));
  return Number.isFinite(ts) ? ts : null;
}

/** 새 세션 쿠키 값 — lib/auth.ts 의 makeSessionCookie 와 같은 모양 */
export async function makeSessionEdge(secret = SECRET): Promise<string> {
  const value = `admin:${Date.now()}`;
  return `${value}.${await hmacHex(value, secret)}`;
}
