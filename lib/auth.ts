import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE = "yh_session";
const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

function sign(value: string): string {
  const mac = createHmac("sha256", SECRET).update(value).digest("hex");
  return `${value}.${mac}`;
}

function verify(signed: string | undefined): boolean {
  if (!signed) return false;
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return false;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = createHmac("sha256", SECRET).update(value).digest("hex");
  try {
    return (
      mac.length === expected.length &&
      timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) &&
      value.startsWith("admin:")
    );
  } catch {
    return false;
  }
}

export function makeSessionCookie(): string {
  return sign(`admin:${Date.now()}`);
}

export function checkPassword(pw: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || "yoossam2025";
  return pw === expected;
}

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  return verify(c.get(COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE;
