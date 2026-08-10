import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  encryptField,
  decryptField,
  isEncrypted,
  encryptionEnabled,
  encryptEmployeeData,
  resetKeyCache,
  ENCRYPTED_EMPLOYEE_FIELDS,
} from "./crypto";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const RRN = "900101-1234567";

function withKey(k: string | undefined) {
  if (k === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = k;
  resetKeyCache();
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  withKey(KEY_A);
});
afterEach(() => {
  vi.restoreAllMocks();
  withKey(undefined);
});

describe("encryptField / decryptField — 왕복", () => {
  it("암호화한 값을 그대로 되돌린다", () => {
    expect(decryptField(encryptField(RRN))).toBe(RRN);
  });

  it("암호문에 평문이 남지 않는다", () => {
    const enc = encryptField(RRN) as string;
    expect(enc).not.toContain("900101");
    expect(enc).not.toContain("1234567");
  });

  it("계좌번호처럼 숫자만 있는 값도 왕복한다", () => {
    expect(decryptField(encryptField("1002345678901"))).toBe("1002345678901");
  });

  it("한글·긴 문자열도 왕복한다", () => {
    const v = "가나다".repeat(200);
    expect(decryptField(encryptField(v))).toBe(v);
  });

  it("빈 값·null·undefined 는 건드리지 않는다", () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeUndefined();
    expect(encryptField("")).toBe("");
    expect(decryptField(null)).toBeNull();
    expect(decryptField("")).toBe("");
  });

  it("같은 값이라도 매번 다른 암호문이 된다 (IV 를 새로 뽑는다)", () => {
    expect(encryptField(RRN)).not.toBe(encryptField(RRN));
  });
});

describe("멱등성 — 여러 번 돌려도 이중 암호화되지 않는다", () => {
  it("이미 암호화된 값은 그대로 둔다", () => {
    const once = encryptField(RRN) as string;
    expect(encryptField(once)).toBe(once);
    expect(encryptField(encryptField(once))).toBe(once);
    expect(decryptField(once)).toBe(RRN);
  });

  it("isEncrypted 로 구분한다", () => {
    expect(isEncrypted(encryptField(RRN))).toBe(true);
    expect(isEncrypted(RRN)).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });
});

describe("옛 평문과 섞여 있어도 된다", () => {
  it("접두어가 없으면 아직 안 옮긴 평문으로 보고 그대로 돌려준다", () => {
    // 배포와 데이터 이전 사이에는 두 형태가 한 표에 섞여 있다
    expect(decryptField(RRN)).toBe(RRN);
    expect(decryptField("1002345678901")).toBe("1002345678901");
  });
});

describe("키가 없을 때 — 앱이 멈추지 않는다", () => {
  it("키가 없으면 평문 그대로 저장한다 (직원 등록이 막히면 더 나쁘다)", () => {
    withKey(undefined);
    expect(encryptField(RRN)).toBe(RRN);
    expect(encryptionEnabled()).toBe(false);
  });

  it("키가 없으면 암호화된 값은 못 읽고 null 을 돌려준다", () => {
    const enc = encryptField(RRN);
    withKey(undefined);
    expect(decryptField(enc)).toBeNull();
  });

  it("키가 32바이트가 아니면 없는 것으로 본다", () => {
    withKey("too-short");
    expect(encryptionEnabled()).toBe(false);
    expect(encryptField(RRN)).toBe(RRN);
  });

  it("hex 64자 키도 받는다", () => {
    withKey("a".repeat(64));
    expect(encryptionEnabled()).toBe(true);
    expect(decryptField(encryptField(RRN))).toBe(RRN);
  });
});

describe("키가 다르거나 값이 손상됐을 때", () => {
  it("다른 키로는 못 읽고 null 을 돌려준다 (깨진 문자열을 흘리지 않는다)", () => {
    const enc = encryptField(RRN);
    withKey(KEY_B);
    expect(decryptField(enc)).toBeNull();
  });

  it("암호문이 한 바이트라도 바뀌면 거부한다 (GCM 인증 태그)", () => {
    const enc = encryptField(RRN) as string;
    // **base64 의 마지막 글자를 바꾸는 것으로는 부족하다** — 끝자락의 남는 비트는
    // 디코딩에서 버려져 바이트열이 그대로일 때가 있다. IV 가 매번 새로 뽑혀
    // 암호문 길이·끝자락이 실행마다 달라지므로 이 테스트가 이따금 통과해 버렸다
    // (스무 번에 한두 번 꼴로 붉어졌다). 바이트를 직접 뒤집어 확실히 훼손한다.
    const [p, v, iv, tag, ct] = enc.split(":");
    const buf = Buffer.from(ct, "base64");
    buf[0] ^= 0xff;
    const tampered = [p, v, iv, tag, buf.toString("base64")].join(":");
    expect(tampered).not.toBe(enc);
    expect(decryptField(tampered)).toBeNull();
  });

  it("형식이 깨진 값도 던지지 않고 null", () => {
    expect(decryptField("enc:v1:부서진값")).toBeNull();
    expect(decryptField("enc:v1:::")).toBeNull();
  });
});

describe("encryptEmployeeData — 쓰기 인자 훑기", () => {
  it("대상 필드만 암호화하고 나머지는 그대로 둔다", () => {
    const out = encryptEmployeeData({
      name: "이지우",
      rrn: RRN,
      bankAccount: "1234567890",
      retentionAccount: "9998887776",
      phone: "010-0000-0000",
      baseWage: 3_000_000,
    });
    expect(out.name).toBe("이지우");
    expect(out.phone).toBe("010-0000-0000");
    expect(out.baseWage).toBe(3_000_000);
    for (const f of ENCRYPTED_EMPLOYEE_FIELDS) expect(isEncrypted((out as any)[f])).toBe(true);
    expect(decryptField(out.rrn)).toBe(RRN);
  });

  it("없는 필드는 만들어 내지 않는다 (부분 수정에서 다른 값이 지워지면 안 된다)", () => {
    const out = encryptEmployeeData({ phone: "010-1111-2222" });
    expect(Object.keys(out)).toEqual(["phone"]);
  });

  it("null 을 넣어 지우는 것은 그대로 통과시킨다", () => {
    expect(encryptEmployeeData({ rrn: null }).rrn).toBeNull();
  });

  it("Prisma 의 { set: … } 형태도 암호화한다", () => {
    const out = encryptEmployeeData({ rrn: { set: RRN } } as any);
    expect(isEncrypted(out.rrn.set)).toBe(true);
    expect(decryptField(out.rrn.set)).toBe(RRN);
  });

  it("원본 객체를 건드리지 않는다", () => {
    const src = { rrn: RRN };
    const out = encryptEmployeeData(src);
    expect(src.rrn).toBe(RRN);
    expect(out).not.toBe(src);
  });

  it("이미 암호화된 값을 다시 넣어도 이중 암호화되지 않는다", () => {
    const enc = encryptField(RRN) as string;
    expect(encryptEmployeeData({ rrn: enc }).rrn).toBe(enc);
  });
});
