import { NextResponse } from "next/server";
import { directoryApiKey, directoryRequestAuthorized } from "@/lib/directory-api-auth";
import { listHolidays } from "@/lib/holiday-service";

export const dynamic = "force-dynamic";

/**
 * 휴일 표 — 다른 사내 프로그램이 **쉬는 날**을 얻어 가는 창구.
 *
 * 왜 필요한가
 * ----------
 * 학생 카드(card.yussam.com)는 '오늘의 레벨테스트' 글을 일요일과 공휴일에는 올리지 않는다.
 * 공휴일 표를 두 프로그램이 각각 들고 있으면 반드시 한쪽이 낡는다 — 임시공휴일 하나를 한쪽에만
 * 넣는 식으로. 여기(특일정보 API 로 받은 관공서 공휴일 + 학원이 직접 넣은 휴무일)가 원본이므로
 * 여기서 읽어 가게 한다. 학생 카드는 하루 한 번 받아 자기 표에 둔다.
 *
 * 무엇을 주나
 * ----------
 * 요청한 해(`?year=2026`, 없으면 올해와 내년)의 날짜(`YYYY-MM-DD`)와 이름. 그 이상은 없다 —
 * 휴일근로 · 수당 같은 것은 내보내지 않는다. 표에 아무것도 없는 해는 빈 목록이다
 * (받는 쪽이 "아직 안 채워진 해" 로 알아보고 제 표로 물러설 수 있게).
 *
 * 인증
 * ----
 *   x-api-key: <앱 전용 키 또는 DIRECTORY_API_KEY>   (또는 Authorization: Bearer <키>)
 * `?app=` 으로 어느 프로그램인지 말한다 (기본 student-card). 명부 창구와 같은 열쇠다 —
 * 서버끼리 부르는 창구이고, 키가 없으면 창구를 닫는다.
 */
const DEFAULT_APP = "student-card";
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

/** KST 기준 올해 — 서버는 UTC 로 돌 수 있다 */
function thisYearKst(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(now)
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const app = (url.searchParams.get("app") || DEFAULT_APP).trim();
  const key = directoryApiKey(app);
  if (!key) {
    return NextResponse.json(
      { error: "명부 API가 켜져 있지 않습니다. DIRECTORY_API_KEY를 설정하세요." },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization") || "";
  const provided = req.headers.get("x-api-key") || auth.replace(/^Bearer\s+/i, "");
  if (!directoryRequestAuthorized(app, provided)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const y = url.searchParams.get("year");
  const thisYear = thisYearKst();
  const years = y ? [Number(y)] : [thisYear, thisYear + 1];
  if (years.some((v) => !Number.isInteger(v) || v < YEAR_MIN || v > YEAR_MAX)) {
    return NextResponse.json({ error: "year 는 2000~2100 사이의 연도여야 합니다." }, { status: 400 });
  }

  const items = (await Promise.all(years.map((v) => listHolidays(v)))).flat();
  return NextResponse.json({ items, years });
}
