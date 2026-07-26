# 배포 가이드 — Supabase + Vercel

유쌤에듀 HR 프로그램을 **Supabase(데이터베이스) + Vercel(웹앱)** 으로 상시 운영하는 방법입니다.
서버를 직접 관리할 필요가 없고, GitHub에 코드를 올려두면 자동으로 배포됩니다.

> 전체 소요시간 약 20~30분. 순서대로만 따라 하시면 됩니다.

---

## 1단계. Supabase 프로젝트 만들기 (데이터베이스)

1. https://supabase.com 가입 (GitHub 계정으로 로그인 가능) → **New project**
2. 입력:
   - **Name**: `yoossam-hr` (자유)
   - **Database Password**: 강력한 비밀번호 설정 후 **꼭 메모** (연결 문자열에 사용)
   - **Region**: `Northeast Asia (Seoul)` 또는 `(Tokyo)`
3. 생성 완료 후 좌측 **⚙ Project Settings → Database → Connection string** 이동
4. 두 가지 연결 문자열을 복사합니다 (비밀번호 자리에 위에서 정한 비밀번호를 넣으세요):
   - **Connection pooling** (Transaction, 포트 **6543**) → 뒤에 `?pgbouncer=true` 를 붙여 **`DATABASE_URL`** 로 사용
   - **Direct connection** (포트 **5432**) → **`DIRECT_URL`** 로 사용

   예시:
   ```
   DATABASE_URL="postgresql://postgres.abcd:비밀번호@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true"
   DIRECT_URL="postgresql://postgres.abcd:비밀번호@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"
   ```

---

## 2단계. 데이터베이스 스키마 생성 + 초기 데이터 (한 번만)

내 PC(또는 Codespaces) 터미널에서 실행합니다. Supabase에 표·초기데이터를 만드는 과정입니다.

```bash
# 저장소를 받아 폴더로 이동한 뒤
cp .env.example .env
#  → .env 파일을 열어 위 1단계의 DATABASE_URL, DIRECT_URL 을 붙여넣기

npm install
npx prisma db push      # Supabase에 테이블 생성 (DIRECT_URL 사용)
npm run seed            # 회사정보·요율·간이세액표·공휴일·데모직원 시딩
```

> 실제 직원 데이터는 배포 후 웹 화면 `직원 관리`에서 입력/수정하시면 됩니다.
> 데모직원을 지우고 시작하려면 `npm run db:reset` 후 실제 정보를 입력하세요.

---

## 3단계. Vercel에 배포 (웹앱)

1. https://vercel.com 가입 (**GitHub 계정으로 로그인**)
2. **Add New… → Project** → GitHub 저장소 `hoonjibae-cmyk/HR-Manager` **Import**
3. **Framework Preset**: `Next.js` (자동 인식됨) — 빌드 설정은 그대로 두세요.
4. **Environment Variables** 에 아래 값들을 추가합니다 (`.env` 내용과 동일하게):

   | 변수 | 값 |
   |---|---|
   | `DATABASE_URL` | Supabase 풀링(6543) 문자열 + `?pgbouncer=true` |
   | `DIRECT_URL` | Supabase 다이렉트(5432) 문자열 |
   | `ADMIN_PASSWORD` | 관리자 로그인 비밀번호 (변경) |
   | `SESSION_SECRET` | 긴 임의 문자열 |
   | `CRON_SECRET` | 긴 임의 문자열 (자동발송 보안) |
   | `ENABLE_SCHEDULER` | `false` (Vercel은 Cron 사용) |
   | `SMTP_HOST` 등 | 이메일 설정 (docs/SETUP.md) |
   | `SLACK_BOT_TOKEN` 등 | 슬랙 설정 (docs/SETUP.md) |

5. **Deploy** 클릭 → 1~2분 후 배포 완료. `https://hr-manager-xxxx.vercel.app` 주소가 생깁니다.
6. 그 주소로 접속 → `ADMIN_PASSWORD` 로 로그인 → 데이터가 보이면 성공입니다.

> 이후에는 **코드를 GitHub에 push할 때마다 Vercel이 자동 재배포**합니다.
> 스키마(모델)를 변경했을 때만 로컬에서 `npx prisma db push` 를 다시 실행하면 됩니다.

---

## 4단계. 급여명세서 자동발송 (Vercel Cron)

- 저장소의 **`vercel.json`** 에 이미 예약 실행이 설정되어 있습니다:
  ```json
  { "crons": [ { "path": "/api/cron", "schedule": "*/10 * * * *" } ] }
  ```
  → **10분마다** `/api/cron` 이 호출되어, 앱 `설정`에 지정한 **시:분(KST)** 에 발송합니다.
  (Vercel **Pro 플랜** 기준. Hobby 플랜은 크론이 하루 1회로 제한되므로
  `"0 0 * * *"`(= 매일 09:00 KST)로 바꾸고 `/api/cron` 호출에 `?loose=1` 을 붙이세요.)
- `CRON_SECRET` 환경변수를 설정하면 Vercel이 자동으로 인증 헤더를 실어 보냅니다(별도 작업 불필요).
- 웹 `설정` 화면에서 **자동발송 사용**을 켜고 **주기(예: 매월 7일 · 전월분)** 를 지정하세요.
  지급일이 익월 7일이면 `매월 7일 + 전월분` → 8월 7일에 7월분이 발송됩니다.
  - 모든 날짜·시각 판단은 **한국시간(KST)** 기준입니다. (Vercel 런타임은 UTC이지만 앱이 KST로 환산)
  - 크론은 매일 확인하되, 지정한 **주기(날짜/요일)** 에 해당하는 날에만 실제 발송합니다.
    매월 31일로 지정하면 2월 등 짧은 달은 **말일**에 발송됩니다.
  - 같은 날 두 번 실행되지 않으며, **이미 발송된 명세서는 자동 제외**되어 중복 발송되지 않습니다.
  - **발송 시각**은 앱 `설정` 화면의 시:분(KST)으로 바꿉니다. (재배포 불필요)
- 함수 실행시간: Pro 플랜 기준 이메일·크론 **300초**, 문서·급여 **120초** (`vercel.json`).
  인원이 많아 한 번에 다 못 보내도, 다음 크론(10분 뒤)이 **이미 보낸 사람은 건너뛰고 이어서** 발송합니다.

수동 확인:
- 설정 화면의 **모의 실행**(발송 없이 대상만 확인) · **지금 발송** 버튼
- 또는 `https://<도메인>/api/cron?secret=<CRON_SECRET>&dry=1` (조건 판단만),
  `…&force=1` (즉시 발송)

---

## 5단계. 슬랙 연차 연동

슬랙 앱의 Request URL을 배포 주소로 설정합니다 (자세한 절차는 **docs/SETUP.md**):
- Slash Command: `https://<도메인>/api/slack/command`
- Interactivity: `https://<도메인>/api/slack/interactivity`

그리고 Vercel 환경변수에 `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APPROVAL_CHANNEL` 등을 넣고 재배포하세요.

---

## 알아두면 좋은 점

- **비용**: Supabase 무료 티어(DB 500MB) + Vercel Hobby(무료)로 시작 가능. 학원 한 곳 규모엔 충분합니다.
  - Supabase 무료 프로젝트는 **1주간 접속이 전혀 없으면 일시정지**되며, 다시 접속하면 자동 재개됩니다.
- **대량 이메일**: 서버리스 함수는 실행시간 제한(무료 60초)이 있습니다. 직원이 아주 많아 한 번에
  수십 명 발송 시 시간이 부족하면 Vercel **Pro** 플랜(최대 300초)을 권장합니다. (PDF는 한 번 뜬
  브라우저를 재사용하므로 수십 명까지는 대체로 무리 없습니다.)
- **PDF / Node 버전**: 문서 PDF는 서버리스 Chromium(`@sparticuz/chromium`)으로 생성됩니다.
  이 라이브러리는 **Node 20 런타임(Amazon Linux 2023)** 에서 NSS 라이브러리(libnss3)를 올바르게
  로드하므로, Vercel **Settings → Node.js Version 은 반드시 `20.x`** 로 두세요(저장소 `engines` 도 20.x 고정).
  코드에서 `AWS_LAMBDA_JS_RUNTIME` 를 자동 설정하여 라이브러리 추출을 트리거합니다(별도 작업 불필요).
- **DB 백업**: Supabase 대시보드에서 백업/스냅샷을 제공합니다.

## 문제 해결

| 증상 | 확인 |
|---|---|
| 배포 후 로그인해도 데이터 없음 | 2단계(`prisma db push` + `seed`)를 Supabase URL로 실행했는지 |
| `prisma db push` 오류 | `DIRECT_URL`(5432)이 정확한지, DB 비밀번호 맞는지 |
| 빌드 실패(Prisma) | `DATABASE_URL`/`DIRECT_URL` 환경변수 등록 여부 |
| 자동발송 안 됨 | `CRON_SECRET` 설정, `설정`에서 자동발송 ON, 오늘이 지정 주기일인지 |
| 이메일/슬랙 미작동 | docs/SETUP.md 의 SMTP·슬랙 값 등록 및 재배포 |
