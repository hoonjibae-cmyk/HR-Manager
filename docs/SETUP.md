# 연동 설정 가이드 (SMTP · 슬랙 · 스케줄러 · 배포)

이 문서는 유쌤에듀 HR 프로그램의 **이메일 자동발송**과 **슬랙 연차 신청/승인**을
실제로 동작시키기 위한 설정 방법을 안내합니다. 모든 설정은 환경변수 값을 넣는 것으로 끝나며,
코드 수정은 필요하지 않습니다.

> **Vercel 배포를 쓰는 경우** — 아래 예시의 `.env` 대신
> **Vercel → 프로젝트 → Settings → Environment Variables** 에 같은 이름/값을 넣고
> **Redeploy** 하세요. (환경변수는 재배포해야 반영됩니다. 값이 빈 항목은 아예 만들지 마세요.)
> 설정이 끝나면 앱 `설정` 화면의 **외부 연동 상태**가 `연결됨` 으로 바뀝니다.

### 지금 무엇을 설정해야 하나 (요약)

| 항목 | 필수 | 없으면 |
|---|---|---|
| **SMTP** (`SMTP_HOST` 등) | ✅ 필수 | 급여명세서 발송이 **전혀 동작하지 않음** (수동·예약 모두) |
| **슬랙** (`SLACK_BOT_TOKEN` 등) | 선택 | 연차를 슬랙으로 신청·승인할 수 없음. 화면에서 직접 등록·승인은 가능 |
| **CRON_SECRET** | 권장 | 외부에서 `/api/cron` 을 호출해 발송을 트리거할 수 있음(보안) |

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
- 발송 시각: 정시 선택 (한국시간)
- 발송 대상 월: `전월분` 또는 `당월분`
  → 지급일이 익월 7일이면 **매월 7일 + 전월분** (8월 7일에 7월분 발송)

저장하면 **다음 발송 예정** 시각이 표시됩니다.
**발송 대상 확인 → 모의 실행 → 지금 발송** 버튼으로 미리 점검할 수 있습니다.

### 2-2. 스케줄러 구동 방식 (둘 중 택1)

**(A) Vercel 배포 (현재 방식 — 별도 작업 없음)**
- `vercel.json` 에 크론이 이미 설정되어 있어 **매시 정각**에 조건을 확인합니다.
- 권장 환경변수:
  ```env
  CRON_SECRET="충분히-긴-임의문자열"   # 외부에서 임의로 발송 트리거하는 것 차단
  ```
- 자세한 내용은 `docs/DEPLOY.md` 4단계 참고.

**(B) 상시 구동 서버 (자체 서버, VPS, Docker 등)**
```env
ENABLE_SCHEDULER="true"
```
- `npm start` 로 상시 구동하면 내부 스케줄러가 60초마다 확인해 자동 발송합니다.
- 판단은 한국시간 기준으로 처리되므로 서버 시간대와 무관하게 동작합니다.

> 자동발송 시 해당 월 급여기록이 없으면 자동으로 산정 후 발송합니다.
> **이미 발송된 명세서는 자동 제외**되어 중복 발송되지 않습니다.

---

## 3. 슬랙 연차 신청/승인

직원이 슬랙에서 `/연차` 로 신청하고, 관리자가 채널에서 버튼으로 승인/반려합니다.

### 3-1. 슬랙 앱 생성 — 매니페스트로 한 번에 (권장)
1. 저장소의 **`docs/slack-app-manifest.yml`** 을 열어 `<도메인>` 3곳을 실제 배포 주소로 바꿉니다.
   (예: `hr-manager-nine.vercel.app`)
2. https://api.slack.com/apps → **Create New App** → **From an app manifest**
   → 워크스페이스 선택 → **YAML** 탭에 파일 내용을 붙여넣고 생성.
   → 슬래시 명령(`/연차`)·버튼 인터랙티브·권한이 한 번에 설정됩니다.
3. **Install to Workspace** → 권한 허용.
4. **OAuth & Permissions** → **Bot User OAuth Token**(`xoxb-...`) 복사.
5. **Basic Information** → *App Credentials* → **Signing Secret** 복사.

<details>
<summary>수동으로 만들려면 (From scratch)</summary>

1. **OAuth & Permissions** → *Bot Token Scopes*: `commands`, `chat:write`, `chat:write.public`, `users:read`
2. **Slash Commands** → *Create New Command*
   - Command `/연차`, Request URL `https://<배포주소>/api/slack/command`
3. **Interactivity & Shortcuts** → *Interactivity* **ON**
   - Request URL `https://<배포주소>/api/slack/interactivity`
</details>

### 3-4. `.env` 설정
```env
SLACK_BOT_TOKEN="xoxb-..."
SLACK_SIGNING_SECRET="..."
SLACK_APPROVAL_CHANNEL="C0123ABCD"   # 승인 요청이 게시될 관리자 채널 ID
SLACK_APPROVERS="U01ADMIN1,U01ADMIN2" # 승인 권한자 (비우면 채널 누구나 승인)
```
> 채널 ID는 슬랙에서 채널명 우클릭 → *채널 세부정보 보기* 하단, 또는 채널 링크 끝의 `C...` 값입니다.
> 봇을 해당 채널에 **초대**(`/invite @앱이름`)해야 메시지를 게시할 수 있습니다.

### 3-5. 직원-슬랙 연결 — 자동 (별도 작업 불필요)
직원이 처음 `/연차` 를 사용하면, 슬랙 계정의 **이메일**과 직원 카드의 **이메일**을 대조해
자동으로 연결됩니다. (이메일이 없으면 실명으로 보조 매칭 — 동명이인은 제외)

즉 **관리자가 24명의 슬랙 ID를 일일이 입력할 필요가 없습니다.** 다만 직원 카드의
이메일이 슬랙 계정 이메일과 다르면 자동 연결이 안 되고, 실패 시 직원에게
"슬랙 이메일: ○○○" 안내가 표시되므로 그 값으로 직원 카드를 맞춰주면 됩니다.

> 수동으로 연결하려면: `직원 관리` → 직원 편집 → **슬랙 User ID**(`U...`) 입력.
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
