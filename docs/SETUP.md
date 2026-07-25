# 연동 설정 가이드 (SMTP · 슬랙 · 스케줄러 · 배포)

이 문서는 유쌤에듀 HR 프로그램의 **이메일 자동발송**과 **슬랙 연차 신청/승인**을
실제로 동작시키기 위한 설정 방법을 안내합니다. 모든 설정은 `.env` 파일에 값을 넣는 것으로 끝나며,
코드 수정은 필요하지 않습니다.

---

## 1. 이메일 (SMTP) — 급여명세서 발송

### 1-1. SMTP 정보 준비
사용 중인 메일 서비스의 SMTP 정보를 준비합니다.

| 서비스 | SMTP_HOST | SMTP_PORT | SMTP_SECURE | 비고 |
|---|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | `587` | `false` | **앱 비밀번호** 필요 (2단계 인증 후 발급) |
| 네이버웍스 | `smtp.worksmobile.com` | `587` | `false` | |
| 네이버 메일 | `smtp.naver.com` | `587` | `false` | |
| 다음/카카오 | `smtp.daum.net` | `465` | `true` | |

### 1-2. `.env` 설정
```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="hr@yoossam.edu"
SMTP_PASS="앱비밀번호16자리"
MAIL_FROM="주식회사 유쌤에듀 <hr@yoossam.edu>"
```

> **Gmail 앱 비밀번호**: Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호에서 발급.
> 일반 로그인 비밀번호로는 SMTP 인증이 거부됩니다.

### 1-3. 확인
1. 앱을 재시작합니다.
2. `설정` 화면 → **테스트 메일 발송** 버튼으로 수신 확인.
3. `급여 산정` 화면 → 월 선택 → **급여 일괄 산정** → **명세서 이메일 발송**.
   - 각 직원의 `이메일` 필드로 급여명세서 PDF가 첨부 발송됩니다.
   - 발송 결과(성공/실패)는 `EmailLog` 에 기록됩니다.

---

## 2. 급여명세서 자동(예약) 발송

원하는 **요일·시간**에 자동으로 발송되도록 예약합니다.

### 2-1. 예약 설정
`설정` 화면 → **급여명세서 자동발송 예약**
- **자동발송 사용** 체크
- 주기: `매월` (예: 매월 7일) 또는 `매주` (예: 매주 금요일)
- 시각: 시/분
- 발송 대상 월: `전월분` 또는 `당월분`

### 2-2. 스케줄러 구동 방식 (둘 중 택1)

**(A) 상시 구동 서버 (권장: 자체 서버, VPS, Docker 등)**
```env
ENABLE_SCHEDULER="true"
```
- `npm start` 로 서버를 상시 구동하면 내부 스케줄러가 60초마다 조건을 확인해 자동 발송합니다.
- **서버 시간대를 KST로** 설정하세요: `TZ=Asia/Seoul npm start`

**(B) 서버리스/외부 크론 (Vercel, 방화벽 뒤 배포 등)**
```env
ENABLE_SCHEDULER="false"
CRON_SECRET="충분히-긴-임의문자열"
```
- 외부 크론이 아래 URL을 **매분(또는 매시)** 호출하도록 등록합니다.
  ```
  GET  https://<배포주소>/api/cron?secret=<CRON_SECRET>
  또는  Authorization: Bearer <CRON_SECRET>
  ```
- 예) **cron-job.org**, **GitHub Actions**, **Vercel Cron**(`vercel.json`)
- 강제 실행(테스트): `.../api/cron?secret=...&force=1`

> 자동발송 시 해당 월 급여기록이 없으면 자동으로 산정(DRAFT) 후 발송합니다.

---

## 3. 슬랙 연차 신청/승인

직원이 슬랙에서 `/연차` 로 신청하고, 관리자가 채널에서 버튼으로 승인/반려합니다.

### 3-1. 슬랙 앱 생성
1. https://api.slack.com/apps → **Create New App** → *From scratch* → 워크스페이스 선택.
2. **OAuth & Permissions** → *Bot Token Scopes* 에 다음 추가:
   - `commands` (슬래시 명령)
   - `chat:write` (메시지 전송)
   - `chat:write.public` (미가입 공개채널 전송, 선택)
   - `users:read` (선택)
3. **Install to Workspace** → 발급된 **Bot User OAuth Token**(`xoxb-...`) 복사.
4. **Basic Information** → *App Credentials* → **Signing Secret** 복사.

### 3-2. 슬래시 명령 등록
**Slash Commands** → *Create New Command*
- Command: `/연차` (원하면 `/leave` 도 별도 등록)
- Request URL: `https://<배포주소>/api/slack/command`
- Short Description: `연차 신청 및 잔여 조회`
- Usage Hint: `8/14 개인사유`

### 3-3. 인터랙티브(버튼) 등록
**Interactivity & Shortcuts** → *Interactivity* **ON**
- Request URL: `https://<배포주소>/api/slack/interactivity`

### 3-4. `.env` 설정
```env
SLACK_BOT_TOKEN="xoxb-..."
SLACK_SIGNING_SECRET="..."
SLACK_APPROVAL_CHANNEL="C0123ABCD"   # 승인 요청이 게시될 관리자 채널 ID
SLACK_APPROVERS="U01ADMIN1,U01ADMIN2" # 승인 권한자 (비우면 채널 누구나 승인)
```
> 채널 ID는 슬랙에서 채널명 우클릭 → *채널 세부정보 보기* 하단, 또는 채널 링크 끝의 `C...` 값입니다.
> 봇을 해당 채널에 **초대**(`/invite @앱이름`)해야 메시지를 게시할 수 있습니다.

### 3-5. 직원-슬랙 연결
`직원 관리` → 각 직원 편집 → **슬랙 User ID**(`U...`) 입력.
> 슬랙 User ID는 프로필 → 더보기 → *멤버 ID 복사*.

### 3-6. 사용법 (직원)
```
/연차                    → 내 잔여연차 조회
/연차 조회                → 내 잔여연차 조회
/연차 8/14 개인사유        → 8월 14일 연차 신청
/연차 8/14~8/16 가족여행    → 기간 연차 신청
/연차 오후반차 8/14 병원    → 반차(0.5일) 신청
/연차 help               → 도움말
```
신청하면 관리자 채널에 **승인/반려 버튼**이 게시되고, 관리자가 승인하면
프로그램 연차 현황에 자동 반영됩니다. 처리 결과는 신청자에게 DM으로 전달됩니다.

---

## 4. 배포 참고

- **자체 서버 / VPS**: `npm run build && TZ=Asia/Seoul ENABLE_SCHEDULER=true npm start`
  (프로세스 관리자 pm2/systemd 권장). SQLite 파일(`prisma/dev.db`)이 유지되는 경로에 두세요.
- **PostgreSQL 전환**: `prisma/schema.prisma` 의 `datasource` provider 를 `postgresql` 로 바꾸고
  `DATABASE_URL` 을 Postgres 로 지정 후 `npm run db:push`. (대규모/다중 인스턴스 운영 시 권장)
- **PDF 렌더링**: 서버에 Chromium 이 필요합니다. `CHROMIUM_PATH` 로 실행파일을 지정하거나,
  `npx playwright install chromium` 로 설치하세요. (한글 폰트는 저장소에 포함되어 별도 설치 불필요)
- **HTTPS 필수**: 슬랙 Request URL 은 공개 HTTPS 주소여야 합니다. 로컬 테스트는 `ngrok` 등으로 터널링하세요.

---

## 5. 문제 해결

| 증상 | 확인 |
|---|---|
| 테스트 메일 실패 | `SMTP_HOST/USER/PASS`, 앱 비밀번호, 포트/보안(465=secure true) |
| 슬랙 `invalid signature` | `SLACK_SIGNING_SECRET` 일치 여부, 서버 시간 동기화 |
| 슬랙 "등록된 직원 정보를 찾을 수 없음" | 직원의 **슬랙 User ID** 미입력 |
| 승인 버튼 무반응 | Interactivity Request URL, 봇 채널 초대 여부 |
| 자동발송 미동작 | `ENABLE_SCHEDULER=true`+상시구동 또는 외부 크론, 서버 시간대(KST) |
| PDF 한글 깨짐 | `assets/fonts/` 존재 여부(저장소 포함), Chromium 설치 |
