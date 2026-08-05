// 개인정보 컬럼 암호화 — 주민등록번호·계좌번호
//
// ## 왜 앱에서 하나 (DB 기능이 아니라)
// 키가 DB 안에 있으면 DB 를 손에 넣은 사람이 키도 같이 얻는다. 키는 앱 환경변수
// (`ENCRYPTION_KEY`, Vercel 환경변수)에만 두고 DB 에는 암호문만 넣는다 —
// 백업 파일이 새어도, DB 접속이 뚫려도 그것만으로는 읽히지 않는다.
//
// ## 방식
// AES-256-GCM. **값마다 IV 를 새로 뽑고**(같은 주민번호라도 매번 다른 암호문이 된다)
// 인증 태그로 위변조를 잡는다. 저장 형태:
//
//     enc:v1:<iv(base64)>:<tag(base64)>:<ciphertext(base64)>
//
// 앞에 `enc:v1:` 을 붙이는 이유가 둘 있다.
//  1) **이미 암호화된 값인지 한눈에 안다** — 옮기는 작업(scripts/encrypt-pii.mjs)을
//     몇 번 돌려도 두 번 암호화되지 않는다.
//  2) **평문으로 남아 있는 옛 값과 섞여 있어도 된다** — 접두어가 없으면 평문으로 보고
//     그대로 돌려준다. 그래서 배포와 데이터 이전 사이에 화면이 깨지지 않는다.
//
// ## 검색은 못 한다
// IV 가 매번 달라 같은 값이라도 암호문이 달라진다 → `where: { rrn: ... }` 같은 조회는
// 성립하지 않는다. 지금 코드에 그런 조회가 없어서 이 방식을 골랐다.
// 나중에 필요해지면 별도의 결정적 해시 열(blind index)을 두어야 한다.
//
// ## 키를 잃어버리면 복구할 수 없다
// GCM 은 키 없이 못 푼다. `ENCRYPTION_KEY` 를 잃으면 주민번호·계좌번호는 영영 못 읽는다
// (세무 신고에 쓰는 값이다). 키는 반드시 따로 보관한다.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM 권장 96비트
const KEY_BYTES = 32; // AES-256

/** 같은 경고를 로그에 도배하지 않는다 (요청마다 수십 번 불린다) */
const warned = new Set<string>();
function warnOnce(tag: string, msg: string) {
  if (warned.has(tag)) return;
  warned.add(tag);
  console.warn(`[crypto] ${msg}`);
}

let cached: Buffer | null | undefined;

/** `ENCRYPTION_KEY` → 32바이트. base64(44자) 또는 hex(64자) 를 받는다. 없으면 null */
export function encryptionKey(): Buffer | null {
  if (cached !== undefined) return cached;
  const raw = (process.env.ENCRYPTION_KEY ?? "").trim();
  if (!raw) return (cached = null);

  let buf: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
  else {
    try {
      const b = Buffer.from(raw, "base64");
      if (b.length === KEY_BYTES) buf = b;
    } catch {}
  }
  if (!buf || buf.length !== KEY_BYTES) {
    warnOnce(
      "badkey",
      `ENCRYPTION_KEY 가 32바이트가 아닙니다 — 암호화를 적용하지 않습니다. ` +
        `\`openssl rand -base64 32\` 로 새로 만들어 넣으세요.`
    );
    return (cached = null);
  }
  return (cached = buf);
}

/** 테스트에서 키를 바꿔 끼울 때 쓴다 (운영 경로에서는 부르지 않는다) */
export function resetKeyCache() {
  cached = undefined;
  warned.clear();
}

/** 이미 암호화된 값인가 */
export function isEncrypted(v: unknown): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** 암호화 여부와 무관하게 안전한 값인가 — 키가 없으면 평문 그대로 나간다 */
export function encryptionEnabled(): boolean {
  return encryptionKey() !== null;
}

/**
 * 저장할 값으로 바꾼다.
 * 빈 값·이미 암호화된 값은 그대로 둔다(멱등). **키가 없으면 평문 그대로 돌려준다** —
 * 여기서 던지면 키를 안 넣은 배포에서 직원 등록이 통째로 막힌다. 대신 경고를 남긴다.
 */
export function encryptField(plain: string | null | undefined): string | null | undefined {
  if (plain == null || plain === "") return plain;
  if (isEncrypted(plain)) return plain;
  const key = encryptionKey();
  if (!key) {
    warnOnce(
      "nokey-enc",
      "ENCRYPTION_KEY 가 없어 개인정보를 평문으로 저장합니다 — 환경변수를 넣어 주세요."
    );
    return plain;
  }
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return `${PREFIX}${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

/**
 * 화면·문서에 쓸 값으로 되돌린다.
 * 접두어가 없으면 **아직 옮기지 않은 평문**이라 그대로 돌려준다.
 * 풀지 못하면(키가 없거나 다르거나 값이 손상됨) **null 을 돌려준다** — 깨진 문자열을
 * 그대로 흘려보내면 그게 주민번호인 줄 알고 세무 시트에 실린다. 빈 값이면
 * 세무 시트·이체 파일이 이미 "비어 있다" 고 경고하므로 사람이 알아챈다.
 */
export function decryptField(stored: string | null | undefined): string | null | undefined {
  if (stored == null || stored === "") return stored;
  if (!isEncrypted(stored)) return stored; // 옛 평문 — 이전 작업 전까지 섞여 있을 수 있다
  const key = encryptionKey();
  if (!key) {
    warnOnce("nokey-dec", "ENCRYPTION_KEY 가 없어 암호화된 개인정보를 읽지 못합니다.");
    return null;
  }
  try {
    const [, , ivB64, tagB64, ctB64] = stored.split(":");
    const d = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
    d.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([d.update(Buffer.from(ctB64, "base64")), d.final()]).toString("utf8");
  } catch {
    warnOnce(
      "decfail",
      "개인정보를 복호화하지 못했습니다 — ENCRYPTION_KEY 가 바뀌었거나 값이 손상됐습니다."
    );
    return null;
  }
}

/** 암호화 대상 컬럼 (Employee) — 늘리려면 여기와 스키마 주석만 고친다 */
export const ENCRYPTED_EMPLOYEE_FIELDS = ["rrn", "bankAccount", "retentionAccount"] as const;
export type EncryptedEmployeeField = (typeof ENCRYPTED_EMPLOYEE_FIELDS)[number];

/** 쓰기 인자에서 대상 필드만 골라 암호화 (create/update 의 data 객체) */
export function encryptEmployeeData<T extends Record<string, any>>(data: T): T {
  if (!data || typeof data !== "object") return data;
  let out: any = data;
  for (const f of ENCRYPTED_EMPLOYEE_FIELDS) {
    if (!(f in data)) continue;
    const v = (data as any)[f];
    // Prisma 는 `{ set: value }` 형태도 받는다
    if (v && typeof v === "object" && "set" in v) {
      if (out === data) out = { ...data };
      out[f] = { ...v, set: encryptField(v.set) };
    } else if (typeof v === "string" || v === null) {
      if (out === data) out = { ...data };
      out[f] = encryptField(v);
    }
  }
  return out;
}
