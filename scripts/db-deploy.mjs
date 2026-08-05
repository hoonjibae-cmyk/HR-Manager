#!/usr/bin/env node
// 배포 시 DB 스키마 자동 반영 — Vercel 빌드(vercel-build) 앞단에서 돈다.
//
// 이 프로젝트는 마이그레이션 파일 대신 `prisma db push` 로 스키마를 맞춘다(CLAUDE.md).
// 그동안은 스키마가 바뀔 때마다 사람이 로컬에서 한 번 더 돌려야 했고, 잊으면 배포된 화면이
// "column does not exist" 로 죽었다. 그래서 빌드가 대신 돌려 준다.
//
// 안전장치 — 이 셋 중 하나라도 걸리면 아무것도 하지 않고 그냥 통과한다(지금과 동일 동작).
//   1) DIRECT_URL·DATABASE_URL 이 없음      → 연결할 DB 가 없으니 건너뜀
//   2) Vercel 의 preview/development 배포    → 운영 DB 를 미완성 스키마로 밀지 않기 위함
//   3) SKIP_DB_PUSH=1                        → 수동 탈출구
//
// 데이터가 지워질 수 있는 변경(열 삭제·타입 축소 등)이면 prisma 가 --accept-data-loss 를
// 요구하며 실패한다. 그 플래그는 **일부러 넣지 않았다** — 조용히 지우느니 배포를 멈추는 게 낫다.
// 그럴 땐 로컬에서 직접 확인하고 돌려야 한다.

import { spawnSync } from "node:child_process";

const skip = (why) => {
  console.log(`[db-deploy] 건너뜀 — ${why}`);
  process.exit(0);
};

if (process.env.SKIP_DB_PUSH === "1") skip("SKIP_DB_PUSH=1");

const vercelEnv = process.env.VERCEL_ENV; // production | preview | development (Vercel 에서만 설정됨)
if (vercelEnv && vercelEnv !== "production")
  skip(`Vercel ${vercelEnv} 배포 (운영 배포에서만 반영한다)`);

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL)
  skip("DIRECT_URL·DATABASE_URL 이 없음");

console.log("[db-deploy] prisma db push — DB 스키마를 코드에 맞춥니다…");
const r = spawnSync(
  "npx",
  ["prisma", "db", "push", "--skip-generate"],
  { stdio: "inherit", env: process.env }
);

// RLS 켜기 — `prisma db push` 는 RLS 를 모르므로 모델을 추가하면 그 테이블이
// Supabase 의 공개 API(PostgREST)에 무방비로 열린다. 스키마를 밀 때마다 훑는다.
//
// **스키마 반영이 실패해도 이건 돌린다.** 보안 잠금이 스키마 동기화 성공에 매달려 있으면,
// 관계없는 이유로 push 가 막힌 사이 데이터가 계속 공개된 채로 남는다.
// 실패해도 배포를 멈추지는 않는다(스키마는 이미 반영된 뒤라 여기서 세우면 더 나쁘다) — 대신 크게 알린다.
const rls = () => spawnSync("node", ["scripts/db-rls.mjs"], { stdio: "inherit", env: process.env });

if (r.status !== 0) {
  rls();
  console.error(
    "\n[db-deploy] ❌ 스키마 반영에 실패해 배포를 중단합니다.\n" +
      "  · 'data loss' 경고라면 지워질 수 있는 변경입니다 — 로컬에서 확인 후 직접 반영하세요.\n" +
      "  · 연결 오류라면 Vercel 환경변수의 DIRECT_URL(5432 다이렉트 연결)을 확인하세요.\n" +
      "  · 이번 배포만 건너뛰려면 환경변수 SKIP_DB_PUSH=1 을 넣고 다시 배포하세요.\n"
  );
  process.exit(r.status ?? 1);
}
console.log("[db-deploy] ✅ 스키마 반영 완료");
rls();
