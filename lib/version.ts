// 앱 버전 — 화면에 띄워 **지금 돌고 있는 것이 어느 배포인지** 알 수 있게 한다.
//
// 이게 없으면 "코드를 고쳐 올렸는데 화면이 그대로다" 일 때 배포가 안 된 건지 코드가 잘못된
// 건지 구분할 방법이 없다(실제로 겪었다 — DB 는 암호화됐는데 앱은 옛 코드라 암호문이 보였다).
// 버전과 커밋 해시를 화면에 남겨 두면 눈으로 바로 가려낼 수 있다.

import pkg from "../package.json";

/** package.json 의 version. 기능을 더하면 minor, 고치면 patch 를 올린다 */
export const APP_VERSION: string = pkg.version;

/**
 * 배포된 커밋 — Vercel 이 넣어 주는 값. 로컬에서는 비어 있다.
 * 같은 버전으로 여러 번 배포할 수 있으므로 '어느 커밋인지' 는 이쪽이 정확하다.
 */
export const COMMIT_SHA: string | null =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null;

/** 화면에 짧게 적을 문자열 — `v1.1.0 · a1b2c3d` */
export function versionLabel(): string {
  const sha = COMMIT_SHA ? ` · ${COMMIT_SHA.slice(0, 7)}` : "";
  return `v${APP_VERSION}${sha}`;
}
