import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 이 배포의 실제 공개 주소 (요청 헤더 우선 — 커스텀 도메인도 그대로 반영) */
function publicOrigin(req: Request): string {
  const h = req.headers;
  const forwardedHost = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || (forwardedHost?.startsWith("localhost") ? "http" : "https");
  if (forwardedHost) return `${proto}://${forwardedHost}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * 슬랙 앱 매니페스트를 이 배포 주소가 채워진 상태로 생성한다.
 * docs/slack-app-manifest.yml 의 YOUR-DOMAIN 을 직접 바꾸다 빠뜨리는 사고를 막기 위함.
 * 브라우저로 열어 그대로 복사 → api.slack.com/apps → App Manifest 에 붙여넣으면 된다.
 */
export async function GET(req: Request) {
  if (!(await isAuthed())) return new Response("unauthorized", { status: 401 });

  const origin = publicOrigin(req);
  const company = await prisma.company.findFirst({ where: { id: 1 } });
  const name = company?.name ?? "유쌤에듀";

  const yaml = `# ${name} HR — 슬랙 앱 매니페스트
# 이 배포 주소(${origin})가 이미 채워져 있습니다. 그대로 복사해서
# https://api.slack.com/apps → 앱 선택 → App Manifest → YAML 에 붙여넣고 저장하세요.
# 저장 시 슬랙이 아래 request_url 들을 실제로 호출해 검증하므로 배포가 끝난 뒤 진행합니다.

display_information:
  name: ${name} HR
  description: 연차 신청·승인 및 급여명세서 발송 알림
  background_color: "#1f45f5"

features:
  bot_user:
    # 봇 표시명은 사용자명으로 변환되므로 한글 불가 (앱 이름은 한글 가능)
    display_name: Yussam HR
    always_online: true
  app_home:
    # 사이드바에서 앱을 누르면 나오는 상시 화면 (채널 메시지처럼 위로 밀리지 않음)
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: true
  shortcuts:
    # 메시지 입력창 옆 ⚡ 버튼 → 어디서든 휴가신청서 열기
    - name: 휴가 신청
      type: global
      callback_id: leave_request_shortcut
      description: 휴가신청서 양식을 엽니다
  slash_commands:
    - command: /연차
      url: ${origin}/api/slack/command
      description: 연차 신청 및 잔여 조회
      usage_hint: "10/15 연차 가족행사  |  조회  |  도움말"
      should_escape: false

oauth_config:
  scopes:
    bot:
      - commands # 슬래시 명령 수신
      - chat:write # 승인 요청·결과 메시지 게시
      - chat:write.public # 봇 미초대 채널에도 게시
      - users:read # 신청자 식별
      - users:read.email # 이메일로 직원 카드 자동 연결
      - pins:write # 채널 상단에 '휴가신청서 작성' 버튼 고정

settings:
  interactivity:
    is_enabled: true
    request_url: ${origin}/api/slack/interactivity
  event_subscriptions:
    # 앱 홈을 열 때마다 최신 연차 현황으로 다시 그리기 위해 필요
    request_url: ${origin}/api/slack/events
    bot_events:
      - app_home_opened
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
`;

  return new Response(yaml, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
