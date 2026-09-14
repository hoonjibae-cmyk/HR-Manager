import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { postMessage, slackConfigured } from "@/lib/slack";
import { directoryApiKey, directoryRequestAuthorized } from "@/lib/directory-api-auth";

export const dynamic = "force-dynamic";

/**
 * 사내 프로그램 대신 직원에게 슬랙 DM을 보내 주는 창구.
 *
 * 왜 여기서 보내는가
 * -----------------
 * 직원 ↔ 슬랙 아이디를 아는 곳은 여기뿐이다. 다른 프로그램에 슬랙 토큰과 명단을
 * 또 두면, 사람이 슬랙을 새로 만들거나 퇴사할 때마다 두 곳을 맞춰야 한다.
 * 부르는 쪽은 "누구에게, 무슨 말을" 만 정하고 전달은 여기에 맡긴다.
 *
 * 아직 슬랙에 가입하지 않은 사람
 * ----------------------------
 * 신규 입사자는 인사 등록은 됐지만 슬랙 계정이 없을 수 있다. 그때는 **보내지
 * 못했다고 분명히 답한다**(delivered: false, reason: "no-slack"). 부르는 쪽이
 * 그 사람을 '안내 대기'로 남겨 두었다가 나중에 다시 부르면 된다. 여기서 조용히
 * 성공으로 답하면 그 사람은 영영 안내를 못 받는다.
 *
 * 보낼 내용은 부르는 쪽이 정한다
 * ----------------------------
 * 이 창구는 글을 지어내지 않는다. 받은 text 를 그대로 보낸다.
 *
 * 요청:
 *   POST { empNo?: string, email?: string, text: string }
 *   x-app: yussam-voca 등 호출 프로그램 키
 *   x-api-key: <앱 전용 키 또는 DIRECTORY_API_KEY>
 */
export async function POST(req: Request) {
  const app = (req.headers.get("x-app") || "").trim();
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

  if (!slackConfigured()) {
    return NextResponse.json(
      { error: "슬랙이 설정되지 않았습니다. SLACK_BOT_TOKEN을 확인하세요." },
      { status: 503 },
    );
  }

  let body: { empNo?: unknown; email?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 JSON이 아닙니다." }, { status: 400 });
  }

  const empNo = typeof body.empNo === "string" ? body.empNo.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) return NextResponse.json({ error: "보낼 내용(text)이 없습니다." }, { status: 400 });
  if (!empNo && !email) {
    return NextResponse.json({ error: "받는 사람(empNo 또는 email)이 없습니다." }, { status: 400 });
  }

  // 사번이 있으면 사번으로 찾는다 — 이메일은 바뀔 수 있고 사번은 안 바뀐다.
  const employee = empNo
    ? await prisma.employee.findUnique({ where: { empNo } })
    : await prisma.employee.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

  if (!employee) {
    return NextResponse.json(
      { delivered: false, reason: "no-employee", error: "직원을 찾지 못했습니다." },
      { status: 404 },
    );
  }

  const slackUserId = (employee.slackUserId ?? "").trim();
  if (!slackUserId) {
    // 오류가 아니다 — 아직 슬랙에 없을 뿐이고, 나중에 다시 부르면 된다.
    return NextResponse.json({
      delivered: false,
      reason: "no-slack",
      name: employee.name,
      message: `${employee.name} 님은 아직 슬랙 계정이 연결되지 않았습니다. 가입 후 다시 시도하세요.`,
    });
  }

  const res = (await postMessage(slackUserId, text)) as { ok?: boolean; error?: string };
  if (!res?.ok) {
    return NextResponse.json(
      { delivered: false, reason: "slack-error", error: res?.error ?? "슬랙 발송 실패" },
      { status: 502 },
    );
  }

  return NextResponse.json({ delivered: true, name: employee.name });
}
