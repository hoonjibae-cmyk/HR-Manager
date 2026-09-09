// 사내 프로그램 접근 권한 — 어느 부서가 어느 프로그램을 쓰는가.
//
// 왜 여기 두는가
// -------------
// 직원의 소속은 여기가 원본이다. 다른 프로그램이 각자 "누구를 들여보낼지" 명단을
// 따로 들고 있으면 반드시 낡는다 — 퇴사자가 몇 달째 로그인되고, 새로 온 사람은
// 한참 뒤에야 계정을 받는다. 부서로 정해 두면 인사 이동 한 번에 접근 권한도 함께
// 움직인다.

/** 프로그램 안에서의 자리. 받는 쪽이 자기 권한 체계로 옮겨 쓴다. */
export type AppRole = "admin" | "user";

/**
 * 프로그램별 부서 → 자리.
 *
 * 여기 없는 부서는 그 프로그램을 쓰지 않는다(조교팀 등). 부서 이름이 바뀌면
 * 여기도 고쳐야 한다 — 안 고치면 그 부서 전원이 조용히 빠지므로, 받는 쪽이
 * 알아챌 수 있게 응답에 기준 부서를 함께 실어 보낸다.
 */
export const APP_ACCESS: Record<string, Record<string, AppRole>> = {
  // 시험지 생성 시스템 — HR 명부를 공유하고 앱별 권한은 별도로 관리한다.
  "exam-generator": {
    교수부: "user",
    교육운영팀: "user",
    경영지원: "admin",
  },
  // 성적표 프로그램(omr-report) — 교수부·교육운영팀은 성적표를 만들고,
  // 경영지원은 계정과 설정까지 본다.
  "omr-report": {
    교수부: "user",
    교육운영팀: "user",
    경영지원: "admin",
  },
};

export function appAccessMap(app: string): Record<string, AppRole> | null {
  return APP_ACCESS[app] ?? null;
}
