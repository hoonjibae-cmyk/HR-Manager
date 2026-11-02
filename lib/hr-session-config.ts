// HR 세션 수치 — node(lib/hr-session.ts)와 엣지(lib/auth-edge.ts, middleware)가 함께 쓴다.
// hr-session.ts 는 node `crypto` 를 불러 엣지 번들에 못 들어가므로 수치만 여기 따로 둔다
// (두 곳에 숫자를 따로 적으면 언젠가 갈라져, 갱신한 쿠키를 node 검증이 거부하게 된다).

/** 세션 수명 — 마지막 갱신으로부터 이만큼 아무 요청이 없으면 끊긴다 */
export const HR_SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * 이보다 오래된(발급 후 10분 넘은) 세션으로 요청이 오면 미들웨어가 새 12시간짜리로 갈아 끼운다.
 * 매 요청마다 갈면 Set-Cookie 만 늘어나고, 너무 드물게 갈면 쓰는 중에도 남은 시간이 줄어든다.
 */
export const HR_SESSION_RENEW_AFTER_MS = 10 * 60 * 1000;
