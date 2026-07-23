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
  { "crons": [ { "path": "/api/cron", "schedule": "0 0 * * *" } ] }
  ```
  → 매일 **00:00 UTC = 한국시간 오전 9시** 에 `/api/cron` 이 자동 호출됩니다.
- `CRON_SECRET` 환경변수를 설정하면 Vercel이 자동으로 인증 헤더를 실어 보냅니다(별도 작업 불필요).
- 웹 `설정` 화면에서 **자동발송 사용**을 켜고 **주기(예: 매월 7일)** 를 지정하세요.
  - 크론은 매일 확인하되, 지정한 **주기(날짜/요일)** 에 해당하는 날에만 실제 발송합니다.
  - **발송 시각 자체**를 바꾸려면 `vercel.json` 의 `schedule`(크론식)을 수정 후 다시 push 하세요.
    - 예) 매일 오전 8시(KST) = `0 23 * * *` (UTC 기준)
- 참고: Vercel **Hobby(무료)** 는 크론이 하루 1회 수준 — 매달 급여 발송엔 충분합니다.
  더 잦은 발송이 필요하면 Pro 플랜에서 크론식을 조정하세요.

수동 확인: 배포 주소로 `https://<도메인>/api/cron?secret=<CRON_SECRET>&force=1` 를 열면 즉시 발송을 테스트할 수 있습니다.

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
- **PDF**: Vercel에서는 경량 Chromium(`@sparticuz/chromium`)이 자동 사용됩니다(설정 불필요).
- **DB 백업**: Supabase 대시보드에서 백업/스냅샷을 제공합니다.

## 문제 해결

| 증상 | 확인 |
|---|---|
| 배포 후 로그인해도 데이터 없음 | 2단계(`prisma db push` + `seed`)를 Supabase URL로 실행했는지 |
| `prisma db push` 오류 | `DIRECT_URL`(5432)이 정확한지, DB 비밀번호 맞는지 |
| 빌드 실패(Prisma) | `DATABASE_URL`/`DIRECT_URL` 환경변수 등록 여부 |
| 자동발송 안 됨 | `CRON_SECRET` 설정, `설정`에서 자동발송 ON, 오늘이 지정 주기일인지 |
| 이메일/슬랙 미작동 | docs/SETUP.md 의 SMTP·슬랙 값 등록 및 재배포 |
