// 직원 본인 문서 내려받기 링크 — 짧게 사는 서명 토큰(테스트 있음).
//
// 직원은 HR 웹에 로그인하지 않는다(관리자 로그인은 경영지원 전용). 그래서 슬랙에서
// *문서 받기* 를 누른 **본인에게만** DM 으로 링크를 주고, 링크에는 제출 id·슬랙 사용자 id·
// 만료 시각을 서명해 넣는다. 서버는 받을 때 서명·만료를 보고, 제출의 주인이 그 슬랙 사용자인지
// **DB 에서 다시 대조**한다(토큰만 믿지 않는다). 공개 URL 로 남지 않게 수명은 15분이다.
import { createHmac, timingSafeEqual } from "crypto";

export const DOC_TOKEN_TTL_SEC = 15 * 60;

const b64 = (s: string) => Buffer.from(s).toString("base64url");

export function signDocToken(
  claims: { sid: number; u: string },
  secret: string,
  now = Date.now()
): string {
  const body = b64(JSON.stringify({ ...claims, exp: Math.floor(now / 1000) + DOC_TOKEN_TTL_SEC }));
  const sig = createHmac("sha256", secret).update(`vacdoc.${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyDocToken(
  token: string | null | undefined,
  secret: string,
  now = Date.now()
): { sid: number; u: string } | null {
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", secret).update(`vacdoc.${body}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof c.sid !== "number" || typeof c.u !== "string" || typeof c.exp !== "number") return null;
    if (c.exp * 1000 < now) return null;
    return { sid: c.sid, u: c.u };
  } catch {
    return null;
  }
}
