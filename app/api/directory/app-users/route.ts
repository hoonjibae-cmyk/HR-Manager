import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appAccessMap } from "@/lib/app-access";
import { directoryApiKey, directoryRequestAuthorized } from "@/lib/directory-api-auth";
import { autoLinkEmployeeBySlack } from "@/lib/slack";

export const dynamic = "force-dynamic";

/**
 * 사내 프로그램 접근 명단 — 다른 프로그램이 **누구를 들여보낼지** 얻어 가는 창구.
 *
 * 왜 필요한가
 * ----------
 * 성적표 프로그램(omr-report)이 계정을 따로 관리하면 반드시 낡는다. 퇴사자가
 * 몇 달째 로그인되고, 새로 온 선생님은 한참 뒤에야 계정을 받는다. 소속은 여기가
 * 원본이므로 여기서 읽어 가게 한다.
 *
 * 무엇을 주나
 * ----------
 * 재직자 중 그 프로그램을 쓰는 부서에 속한 사람. 이름·부서·이메일·슬랙 아이디와
 * 프로그램 안에서의 자리(admin/user)까지다.
 *
 * **주민번호·급여·계좌·연락처는 내보내지 않는다.** 받는 쪽이 쓸 일이 없다.
 *
 * 이메일은 **업무용 구글메일(workEmail)** 을 준다. 이것이 슬랙·구글 로그인
 * 신원이다. 급여명세서 발송용 이메일(email)은 개인 메일인 경우가 많아 로그인
 * 신원이 아니고, 그것을 보내면 슬랙 계정과 대조되지 않아 아무도 못 들어온다.
 *
 * 슬랙 아이디는 주지 않는다 — 안내는 이 프로그램이 대신 보낸다(/api/slack/notify).
 * 대신 **슬랙 계정이 연결돼 있는지 여부(slackLinked)** 만 알려, 받는 쪽이
 * "아직 안내를 못 보낸 사람"을 셀 수 있게 한다.
 *
 * 인증
 * ----
 *   x-api-key: <앱 전용 키 또는 DIRECTORY_API_KEY>   (또는 Authorization: Bearer <키>)
 * 서버끼리 부르는 창구다. 키가 없으면 창구를 닫는다.
 */
export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const app = requestUrl.searchParams.get("app") || "";
  const slackUserId = (requestUrl.searchParams.get("slackUserId") || "").trim();
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

  const access = appAccessMap(app);
  if (!access) {
    return NextResponse.json(
      { error: `'${app}' 은(는) 등록되지 않은 프로그램입니다. lib/app-access.ts 를 보세요.` },
      { status: 400 },
    );
  }

  const departments = Object.keys(access);
  const loadRows = () => prisma.employee.findMany({
    where: {
      active: true,
      resignDate: null,
      department: { in: departments },
      ...(slackUserId ? { slackUserId } : {}),
    },
    select: {
      empNo: true,
      name: true,
      department: true,
      // 로그인 신원은 업무용 구글메일이다. 급여명세서용(email)이 아니다.
      workEmail: true,
      slackUserId: true,
    },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });
  let rows = await loadRows();
  if (slackUserId && rows.length === 0) {
    await autoLinkEmployeeBySlack(slackUserId);
    rows = await loadRows();
  }

  const items = rows.map((r) => ({
    empNo: r.empNo,
    name: r.name,
    department: r.department ?? "",
    // 로그인 신원(업무용 구글메일). 비어 있으면 받는 쪽이 계정을 만들 수 없으므로
    // 그대로 넘겨 그쪽 화면에서 "이메일이 없어 계정을 못 만든 사람"으로 보이게 한다.
    email: (r.workEmail ?? "").trim().toLowerCase(),
    role: access[r.department ?? ""] ?? "user",
    // 슬랙 안내를 지금 보낼 수 있는지. 신규 입사자는 아직 슬랙에 가입하지
    // 않았을 수 있고, 그러면 가입한 뒤에 보내야 한다.
    slackLinked: (r.slackUserId ?? "").trim() !== "",
  }));

  // 부서명이 바뀌면 그 부서 전원이 조용히 빠진다. 받는 쪽이 "왜 갑자기
  // 줄었지?"를 스스로 답할 수 있도록 기준을 함께 돌려준다.
  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    app,
    departments,
    count: items.length,
    items,
  });
}
