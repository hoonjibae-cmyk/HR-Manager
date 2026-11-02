# Google Calendar → 유쌤알리미

- 유쌤에듀_학사일정 → `C056VGMNKLP` (`#알림-업데이트`)
- 목동유샘영어_관리자 → `C057NN63VFT` (`#알림-운영진`)

Vercel Cron이 매분 `/api/calendar-alerts`를 호출한다. 기존 HR 서버의
`GOOGLE_SERVICE_ACCOUNT_JSON` (또는 개별 서비스 계정 변수), `SLACK_BOT_TOKEN`,
`CRON_SECRET`을 사용한다. Google 서비스 계정은 두 캘린더를 읽을 수 있어야 한다.
봇은 두 채널에 참가해야 하며 `chat:write`가 필요하다. 키/토큰을 코드에 넣지 않는다.

## 동작

처음에는 전체 일정을 기준값으로 저장하고 채널마다 연결 확인 메시지만 한 번 보낸다.
그 뒤에는 Google `nextSyncToken`으로 추가·수정·취소를 읽는다.
`singleEvents=false`로 반복 시리즈를 회차별로 무한 확장하지 않는다.
일부 회차 수정·취소는 해당 날짜를 따로 표시한다. 메타데이터만 달라진 경우에는
알리지 않는다. 조회 시각에 이미 덮어쓴 중간 수정까지 모두 보존하는 감사 로그는 아니다.

메시지에는 제목·일시·장소·내용·원래 등록자를 표시한다. Google의
`creator.displayName`/`creator.email`을 사용하고, 이메일로 HR 직원 이름을 찾을 수 있으면
이름도 붙인다. Google이 생성자 정보를 제공하지 않으면 확인 불가로 표시한다.
Calendar API는 마지막 수정자를 제공하지 않으므로 등록자를 수정자로 표시하지 않는다.
일반 주/월/일/년 반복은 한국어로, 복잡한 규칙은 원래 규칙을 보존해 표시한다.
COUNT 규칙은 종료일을 추측하지 않고 총 횟수를 표시한다. 외국 시간대의 반복은
그 시간대의 현지 시각으로 표시하며, 개별 일정 일시는 한국시간으로 표시한다.

`CalendarAlertState`는 토큰/페이지 진행/잠금, `CalendarAlertEvent`는 직전 내용,
`CalendarAlertDelivery`는 발송함이다. 스냅샷·발송함·토큰을 같은 DB 트랜잭션에
저장하므로 발송 실패 때 변경이 사라지지 않는다. HTTP 429는 Retry-After를 따르고
그 외 실패는 점차 간격을 늘려 재시도한다. 캘린더별 DB lease로 중복 실행을 막는다.
Slack이 메시지를 받은 직후 서버가 종료되면 DB에 성공 기록을 남기지 못해 재전송될
가능성이 있으며, 안정적인 `client_msg_id`를 보조 중복 방지값으로 보낸다.
410 토큰 만료는 기존 기준값을 보존한 전체 재조회로 복구한다.

## 운영 확인

`vercel crons run /api/calendar-alerts --scope yussam-s-projects`로 즉시 실행할 수 있다.
로그의 `[calendar-alerts]`에 캘린더별 initialized/scanned/queued/sent/pending/error가
출력된다. 일정 본문·개인 키·Slack 토큰은 로그에 출력하지 않는다.
인증은 `Authorization: Bearer <CRON_SECRET>`만 허용한다.

기존 Slack ‘캘린더봇’의 별도 구독 설정은 이 기능과 독립적이다. 이전 구독이 남으면
기존 알림과 유쌤알리미 알림이 함께 올 수 있다.

## 검증

`npm test -- lib/calendar-alerts.test.ts lib/calendar-alert-service.test.ts`

반복 규칙·한국시간·종일 종료일·등록자·수정 전후·회차 취소·최초 전체 조회·페이지 처리·
변경 없는 재조회·발송 재시도·410 복구·트랜잭션 실패·동시 실행을 검사한다.

참고: [Google 증분 동기화](https://developers.google.com/calendar/api/guides/sync),
[Calendar events.list](https://developers.google.com/calendar/api/v3/reference/events/list),
[Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/).
