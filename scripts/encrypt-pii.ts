/**
 * 이미 저장돼 있는 개인정보(주민등록번호·계좌번호)를 평문 → 암호문으로 옮긴다.
 *
 * 앞으로 저장되는 값은 `lib/db.ts` 의 확장이 알아서 암호화한다. 이 스크립트는
 * **그 전에 들어간 옛 평문**을 한 번 훑을 때만 쓴다.
 *
 * 안전한 성질:
 *   · 멱등하다 — 이미 `enc:v1:` 인 값은 건너뛴다. 몇 번 돌려도 이중 암호화되지 않는다.
 *   · 되돌릴 수 있는지 확인하고 쓴다 — 각 값을 암호화한 뒤 **곧바로 복호화해 원문과
 *     같은지 대조**하고, 다르면 그 행을 건드리지 않는다. 못 읽는 값으로 덮어쓰는 일이 없다.
 *   · 미리보기가 기본이다. 실제 반영은 `APPLY=1`.
 *
 * ⚠️ 옮긴 뒤에는 **ENCRYPTION_KEY 가 없으면 이 값들을 영영 못 읽는다.**
 *    키를 잃으면 세무 신고에 쓸 주민번호도 같이 잃는 것이다. 반드시 따로 보관한다.
 *
 * 사용법:
 *   npm run db:encrypt-pii          → 무엇이 바뀔지 보여주기만 함 (미리보기)
 *   APPLY=1 npm run db:encrypt-pii  → 실제 반영
 */
import { PrismaClient } from "@prisma/client";
import {
  ENCRYPTED_EMPLOYEE_FIELDS,
  encryptField,
  decryptField,
  isEncrypted,
  encryptionKey,
} from "../lib/crypto";

// 확장을 거치지 않은 클라이언트 — 저장된 값 그대로(평문이면 평문) 봐야 한다
const prisma = new PrismaClient();

const LABEL: Record<string, string> = {
  rrn: "주민등록번호",
  bankAccount: "급여계좌",
  retentionAccount: "유보금계좌",
};

/** 화면·로그에 남길 때는 가린다 — 옮기는 작업 로그에 평문을 남기면 하는 일이 무의미해진다 */
function mask(field: string, v: string): string {
  if (field === "rrn") return v.replace(/^(\d{6})-?(\d)\d{6}$/, "$1-$2••••••");
  return v.length > 4 ? `${"•".repeat(Math.min(v.length - 4, 10))}${v.slice(-4)}` : "••••";
}

async function main() {
  const apply = process.env.APPLY === "1";

  if (!encryptionKey()) {
    console.error(
      "\n❌ ENCRYPTION_KEY 가 없습니다 (또는 32바이트가 아닙니다).\n" +
        "   키 없이 옮기면 평문 그대로 다시 쓰게 되므로 아무것도 하지 않았습니다.\n\n" +
        "   키 만들기:  openssl rand -base64 32\n" +
        "   .env 와 Vercel 환경변수에 ENCRYPTION_KEY 로 넣은 뒤 다시 실행하세요.\n" +
        "   ⚠️ 이 키를 잃으면 암호화된 주민번호·계좌번호를 영영 읽지 못합니다.\n"
    );
    process.exit(1);
  }

  const employees = await prisma.employee.findMany({
    orderBy: { empNo: "asc" },
    select: {
      id: true,
      empNo: true,
      name: true,
      rrn: true,
      bankAccount: true,
      retentionAccount: true,
    },
  });

  let people = 0;
  let values = 0;
  let already = 0;
  const failed: string[] = [];

  for (const e of employees) {
    const patch: Record<string, string> = {};
    const shown: string[] = [];

    for (const f of ENCRYPTED_EMPLOYEE_FIELDS) {
      const v = (e as any)[f] as string | null;
      if (!v) continue;
      if (isEncrypted(v)) {
        already++;
        continue;
      }
      const enc = encryptField(v);
      // 쓰기 전에 되돌려 본다 — 못 읽는 값으로 덮어쓰느니 그 행을 건너뛴다
      if (typeof enc !== "string" || decryptField(enc) !== v) {
        failed.push(`${e.name}(${e.empNo}) ${LABEL[f]}`);
        continue;
      }
      patch[f] = enc;
      shown.push(`${LABEL[f]} ${mask(f, v)}`);
    }

    if (!Object.keys(patch).length) continue;
    people++;
    values += Object.keys(patch).length;
    console.log(`  ${e.name} (${e.empNo}) — ${shown.join(" · ")}`);
    if (apply) await prisma.employee.update({ where: { id: e.id }, data: patch });
  }

  console.log("");
  if (already) console.log(`이미 암호화된 값 ${already}개는 건너뛰었습니다.`);
  if (failed.length) {
    console.error(`⚠️ 확인에 실패해 건드리지 않은 값 ${failed.length}개: ${failed.join(", ")}`);
  }
  console.log(
    values === 0
      ? "옮길 평문이 없습니다 — 이미 모두 암호화돼 있습니다."
      : `${people}명 / 값 ${values}개 ${apply ? "암호화했습니다." : "가 대상입니다."}`
  );
  if (!apply && values > 0) {
    console.log("\n실제로 반영하려면:  APPLY=1 npm run db:encrypt-pii");
    console.log("⚠️ 반영 전에 ENCRYPTION_KEY 를 안전한 곳에 보관하세요 — 잃으면 복구할 수 없습니다.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
