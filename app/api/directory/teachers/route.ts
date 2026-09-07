import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 선생님 명부 — 다른 사내 프로그램이 **이름 ↔ 슬랙 아이디**를 얻어 가는 창구.
 *
 * 왜 필요한가
 * ----------
 * 학생 카드(card.yussam.com)가 "이 반에 신입생이 들어왔다"를 **담임 선생님 DM**으로
 * 보내려면 그 선생님의 슬랙 아이디를 알아야 한다. 사람이 두 프로그램에 각각 적어 두면
 * 반드시 한쪽이 낡는다. 직원 정보는 여기가 원본이므로 여기서 읽어 가게 한다.
 *
 * 누구를 주나 — **교수부** 재직자 중 슬랙 아이디가 있는 사람
 * ---------------------------------------------------------
 * 직책(`position`)은 자유 입력이라("선임강사", "조교", "팀장" …) 그걸로 "선생님"을
 * 판정하면 글자 하나 다를 때마다 조용히 빠진다. 부서가 훨씬 안정적이다.
 * 누가 어느 반 담임인지는 받는 쪽이 자기 담임 명단과 **이름으로** 맞춘다.
 * (학생 카드는 이미 담임 이름을 알고 있다)
 *
 * 무엇을 안 주나
 * -------------
 * 주민번호·연락처·급여·계좌 같은 것은 **내보내지 않는다.** 받는 쪽이 쓸 일이 없다.
 * 이름·부서·직책·슬랙 아이디까지만 준다.
 *
 * 인증
 * ----
 *   x-api-key: <DIRECTORY_API_KEY>   (또는 Authorization: Bearer <키>)
 * 로그인 세션이 아니라 **서버끼리** 부르는 창구다. 키가 설정되지 않았으면 창구를 닫는다
 * (열어 두면 아무나 직원 명부를 가져갈 수 있으므로).
 */
/** 선생님이 속한 부서. 부서명이 바뀌면 여기만 고치면 된다. */
const TEACHER_DEPT = "교수부";

export async function GET(req: Request) {
  const key = process.env.DIRECTORY_API_KEY || "";
  if (!key) {
    return NextResponse.json(
      { error: "명부 API가 켜져 있지 않습니다. DIRECTORY_API_KEY를 설정하세요." },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization") || "";
  const provided = req.headers.get("x-api-key") || auth.replace(/^Bearer\s+/i, "");
  if (provided !== key) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await prisma.employee.findMany({
    where: {
      active: true,
      resignDate: null,
      department: TEACHER_DEPT,
      NOT: { slackUserId: null },
    },
    select: {
      name: true,
      slackUserId: true,
      department: true,
      position: true,
      duty: true,
    },
    orderBy: { name: "asc" },
  });

  // 슬랙 아이디 칸이 빈 문자열인 경우도 걸러 낸다 (null 만으로는 부족하다)
  const items = rows
    .filter((r) => (r.slackUserId ?? "").trim() !== "")
    .map((r) => ({
      name: r.name,
      slackUserId: (r.slackUserId ?? "").trim(),
      department: r.department ?? "",
      position: r.position ?? "",
      duty: r.duty ?? "",
    }));

  // 부서명이 바뀌었거나 슬랙 아이디를 아무도 안 적어 두면 0명이 나간다.
  // 받는 쪽이 "왜 비었지?"를 알 수 있도록 조건을 함께 돌려준다.
  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    department: TEACHER_DEPT,
    count: items.length,
    items,
  });
}
