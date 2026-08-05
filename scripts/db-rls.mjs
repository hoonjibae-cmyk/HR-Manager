#!/usr/bin/env node
// public 스키마의 모든 테이블에 RLS(행 수준 보안)를 켠다 — 정책은 하나도 만들지 않는다.
//
// ## 왜 필요한가
// Supabase 는 프로젝트를 만들면 `public` 스키마를 **PostgREST 로 자동 공개**한다
// (`https://<ref>.supabase.co/rest/v1/...`). 그 문을 여는 열쇠가 `anon` 키인데,
// 이 키는 원래 브라우저에 심으라고 주는 **공개 키**다. 테이블에 RLS 가 꺼져 있으면
// 그 키를 가진 사람은 누구나 전 직원의 주민등록번호·급여·계좌번호를 읽고 고치고 지울 수 있다.
// (Supabase 보안 점검의 `rls_disabled_in_public` 경고가 이것이다.)
//
// 이 앱은 supabase-js 를 쓰지 않고 **Prisma 로 직접 접속**하므로 anon 키를 쓸 일이 전혀 없다.
// 그러니 그 문은 닫아 두는 것이 맞다.
//
// ## 왜 정책을 안 만드나 — 앱이 막히지 않는 이유
// **테이블 주인은 RLS 를 통과한다**(Postgres 기본 동작. `FORCE ROW LEVEL SECURITY` 를
// 걸어야만 주인도 막힌다). 테이블은 `prisma db push` 가 만들었고 그때 접속한 역할이
// 곧 이 앱의 접속 역할이라 주인이 같다. 그래서 정책 없이 RLS 만 켜면
//   · anon / authenticated(PostgREST) → 아무것도 못 함 (정책이 없으니 전부 거부)
//   · 앱(Prisma)                      → 그대로 (주인이라 통과)
// 가 된다. 나중에 supabase-js 로 무언가를 열어 줄 일이 생기면 그때 정책을 만들면 된다.
//
// ## 왜 db push 뒤에 매번 도는가
// `prisma db push` 는 RLS 를 모른다. 모델을 새로 만들면 그 테이블은 **다시 무방비**가 된다.
// 그래서 한 번 고치고 끝내지 않고 배포 때마다 훑는다. 이미 켜진 테이블은 건너뛰므로 멱등하다.
//
// 단독 실행: `npm run db:rls`

import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.log("[db-rls] 건너뜀 — DIRECT_URL·DATABASE_URL 이 없음");
  process.exit(0);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

/** 식별자를 안전하게 감싼다 (카탈로그에서 온 이름이라도 그대로 이어붙이지 않는다) */
const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function main() {
  // 1) 사전 점검 — 이 역할이 RLS 를 통과할 수 있는지 먼저 확인한다.
  //    통과하지 못하는 역할로 RLS 를 켜면 **앱이 자기 데이터에 못 들어간다.**
  //    그런 상태를 만드느니 아무것도 하지 않고 멈추는 편이 낫다.
  const [me] = await prisma.$queryRawUnsafe(`
    SELECT current_user AS role,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls
  `);

  const tables = await prisma.$queryRawUnsafe(`
    SELECT c.relname AS name,
           c.relrowsecurity AS rls,
           pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     ORDER BY c.relname
  `);

  if (!tables.length) {
    console.log("[db-rls] public 스키마에 테이블이 없습니다 — 건너뜁니다");
    return;
  }

  const notMine = tables.filter((t) => t.owner !== me.role);
  if (!me.bypassrls && notMine.length) {
    console.error(
      `\n[db-rls] ⚠️ 건너뜁니다 — 접속 역할(${me.role})이 RLS 를 통과하지 못할 수 있습니다.\n` +
        `  주인이 다른 테이블: ${notMine.map((t) => `${t.name}(${t.owner})`).join(", ")}\n` +
        `  이대로 켜면 앱이 자기 데이터를 못 읽게 되므로 아무것도 하지 않았습니다.\n` +
        `  Supabase SQL 편집기에서 테이블 주인 역할로 직접 켜세요.\n`
    );
    return;
  }

  // 2) 아직 안 켜진 테이블만 켠다 (멱등)
  const todo = tables.filter((t) => !t.rls);
  if (!todo.length) {
    console.log(`[db-rls] ✅ 이미 모두 켜져 있습니다 (테이블 ${tables.length}개)`);
    return;
  }

  for (const t of todo) {
    await prisma.$executeRawUnsafe(`ALTER TABLE public.${q(t.name)} ENABLE ROW LEVEL SECURITY`);
  }
  console.log(`[db-rls] RLS 를 켰습니다 — ${todo.length}개: ${todo.map((t) => t.name).join(", ")}`);

  // 3) 사후 확인 — 켠 뒤에도 앱이 읽을 수 있는지 실제로 한 번 확인한다.
  //    주인 통과를 믿고 넘어갔다가 못 읽는 상태로 배포되면 화면이 통째로 빈다.
  const [check] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM public.${q(todo[0].name)}`);
  console.log(
    `[db-rls] ✅ 확인 — 앱 접속 역할(${me.role})은 그대로 읽습니다 ` +
      `(${todo[0].name} ${check.n}건). anon·authenticated 는 이제 막힙니다.`
  );
}

main()
  .catch((e) => {
    // 여기서 배포를 멈추지는 않는다 — 스키마 반영은 이미 끝난 뒤라 중간에 세우면
    // 새 스키마에 옛 코드가 물린 상태가 되어 더 나쁘다. 대신 크게 알린다.
    console.error(`\n[db-rls] ❌ RLS 설정에 실패했습니다: ${e.message}`);
    console.error("  데이터가 공개된 채로 남아 있을 수 있습니다 — `npm run db:rls` 로 다시 시도하거나");
    console.error("  Supabase SQL 편집기에서 직접 켜세요.\n");
  })
  .finally(() => prisma.$disconnect());
