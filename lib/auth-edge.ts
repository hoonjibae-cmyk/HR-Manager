const DEFAULT_SECRET = process.env.SESSION_SECRET;

export const SESSION_COOKIE_NAME = "yh_session";

export async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function decodeBody(body: string) {
  const base64 = body.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export async function verifySessionEdge(
  signed: string | undefined,
  secret = DEFAULT_SECRET,
  now = Date.now(),
): Promise<Record<string, unknown> | null> {
  if (!signed || !secret || secret.length < 32 || signed.length > 8192) return null;
  const [body, mac, extra] = signed.split(".");
  if (!body || !mac || extra) return null;
  const expected = await hmacHex(body, secret);
  if (mac.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = decodeBody(body);
    if (
      p.kind !== "hr-management" ||
      p.department !== "경영지원" ||
      typeof p.empNo !== "string" || !p.empNo ||
      typeof p.email !== "string" || !p.email ||
      typeof p.slackUserId !== "string" || !p.slackUserId ||
      typeof p.iat !== "number" ||
      typeof p.exp !== "number" ||
      p.iat > now + 30_000 ||
      p.exp <= now
    ) return null;
    return p;
  } catch {
    return null;
  }
}
