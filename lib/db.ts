import { PrismaClient } from "@prisma/client";
import { ENCRYPTED_EMPLOYEE_FIELDS, decryptField, encryptEmployeeData } from "./crypto";

/**
 * 개인정보(주민번호·계좌번호)를 **DB 경계에서** 자동으로 암·복호화한다.
 * 부르는 쪽은 평문을 쓰고 평문을 받으며, DB 에는 암호문만 들어간다.
 *
 * · 읽기 — `result` 확장. **중첩 include 에도 적용된다**
 *   (`payrollRecord.findMany({ include: { employee: true } })` 처럼 다른 모델을 통해
 *   딸려 나온 직원도 풀린다). 실측으로 확인했다.
 *   호출부가 그 열을 select 하지 않으면 아예 계산되지 않는다.
 * · 쓰기 — `query` 확장. create/update/upsert/createMany/updateMany 의 data 를 훑는다.
 *
 * 한곳에 모아 두는 이유: 읽는 자리는 수십 군데라 하나만 빠뜨려도 화면에 암호문이 뜨고,
 * 쓰는 자리는 하나만 빠뜨리면 **평문이 조용히 저장된다**(이쪽이 더 나쁘다).
 */
function withEncryption(raw: PrismaClient) {
  return raw
    .$extends({
      query: {
        employee: {
          async $allOperations({ args, query }) {
            const a: any = args;
            if (a && typeof a === "object") {
              if (a.data) {
                a.data = Array.isArray(a.data)
                  ? a.data.map(encryptEmployeeData) // createMany
                  : encryptEmployeeData(a.data);
              }
              // upsert 는 create/update 를 따로 받는다
              if (a.create) a.create = encryptEmployeeData(a.create);
              if (a.update) a.update = encryptEmployeeData(a.update);
            }
            return query(a);
          },
        },
      },
    })
    .$extends({
      result: {
        employee: Object.fromEntries(
          ENCRYPTED_EMPLOYEE_FIELDS.map((f) => [
            f,
            { needs: { [f]: true }, compute: (e: any) => decryptField(e[f]) },
          ])
        ) as any,
      },
    });
}

// Next.js dev 모드에서 HMR 시 PrismaClient 중복 생성을 방지하기 위한 싱글턴
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof withEncryption>;
  prismaRaw?: PrismaClient;
};

const raw =
  globalForPrisma.prismaRaw ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

export const prisma = globalForPrisma.prisma ?? withEncryption(raw);

/**
 * 확장을 거치지 않은 클라이언트 — **저장된 값 그대로**(암호문이면 암호문) 다룬다.
 * 개인정보를 옮기는 작업(`scripts/encrypt-pii.ts`)처럼 암호문 자체를 봐야 하는 데만 쓴다.
 * 평소 코드에서는 쓰지 않는다.
 */
export const prismaRaw = raw;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaRaw = raw;
}
