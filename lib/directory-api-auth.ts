import { timingSafeEqual } from "node:crypto";

const APP_KEY_ENV: Record<string, string> = {
  "yussam-voca": "VOCA_DIRECTORY_API_KEY",
};

export function directoryApiKey(app: string) {
  const dedicatedEnv = APP_KEY_ENV[app];
  const dedicatedKey = dedicatedEnv ? (process.env[dedicatedEnv] ?? "").trim() : "";
  return dedicatedKey || (process.env.DIRECTORY_API_KEY ?? "").trim();
}

export function directoryRequestAuthorized(app: string, provided: string) {
  const expected = directoryApiKey(app);
  if (!expected || !provided) return false;
  const actualBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
