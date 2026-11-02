// 로그인 만료(401)를 화면에서 알아듣게 — 순수 함수(브라우저·DB 무관, 테스트 있음).
//
// API 는 세션이 없으면 `{ error: "unauthorized" }` 로 401 을 낸다(60여 개 라우트). 그 문구가
// 그대로 「업로드 실패: unauthorized」 로 뜨면 무엇을 해야 할지 알 수 없다 — 2026-11 학생 명단
// 업로드에서 실제로 겪었다. 화면 쪽(components/SessionGuard.tsx)이 같은 출처 /api/ 의 401 을
// 잡아 이 문구로 바꾸고 화면 위에 다시 로그인 안내를 띄운다.

/** 각 버튼의 실패 알림(「업로드 실패: …」)에 들어가는 문구 */
export const SESSION_EXPIRED_MESSAGE =
  "로그인이 만료되었습니다. 화면 위 안내대로 새 탭에서 다시 로그인한 뒤, 이 화면에서 다시 시도하세요.";

/** HR 세션 쿠키로 인증하는 API 인가 — 같은 출처 /api/ (로그인·로그아웃 API 제외) */
export function isSessionApi(requestUrl: string, pageHref: string): boolean {
  let url: URL;
  let page: URL;
  try {
    page = new URL(pageHref);
    url = new URL(requestUrl, page);
  } catch {
    return false;
  }
  if (url.origin !== page.origin) return false;
  return url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/");
}

/** 응답이 '내 HR 세션이 끊겼다' 는 뜻인가 — 세션 API 의 401 만 */
export function isSessionExpiry(requestUrl: string, status: number, pageHref: string): boolean {
  return status === 401 && isSessionApi(requestUrl, pageHref);
}

/**
 * 알아듣는 문구로 바꾼 응답 본문. JSON 이면 원래 필드를 살리고 `error` 만 갈아 끼운다
 * (`res.json()` 으로 읽는 화면), 아니면 문구만 보낸다(`res.text()` 로 읽는 화면).
 */
export function sessionExpiredBody(
  originalText: string,
  contentType: string | null
): { body: string; contentType: string } {
  if ((contentType ?? "").includes("application/json")) {
    let orig: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(originalText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) orig = parsed;
    } catch {
      // 원문이 깨졌으면 문구만 싣는다
    }
    return {
      body: JSON.stringify({ ...orig, error: SESSION_EXPIRED_MESSAGE, code: "SESSION_EXPIRED" }),
      contentType: "application/json",
    };
  }
  return { body: SESSION_EXPIRED_MESSAGE, contentType: "text/plain; charset=utf-8" };
}
