# CLAUDE.md — 유쌤에듀 HR 프로그램 개발 가이드

Next.js 14 (App Router) + TypeScript + Prisma(PostgreSQL/Supabase) HR 관리 웹앱.
배포: Vercel + Supabase (서버리스). 로컬/Codespaces는 로컬 Postgres. 자세히는 docs/DEPLOY.md.

## 명령어
- `npm run dev` — 개발 서버 (http://localhost:3000)
- `npm run build && npm start` — 프로덕션
- `npm test` — 급여/연차 엔진 단위 테스트 (Vitest)
- `npm run seed` / `npm run db:reset` — 시딩 / DB 초기화+재시딩
- `npx tsc --noEmit` — 타입 체크
- 로그인 비밀번호: `.env` 의 `ADMIN_PASSWORD` (기본 `yoossam2025`)

## 아키텍처
- **엔진(순수 함수, DB 무관, 테스트 있음)**: `lib/payroll.ts`(급여), `lib/leave.ts`(연차, 근로기준법 §60).
  UI/API 는 이 엔진을 호출만 한다. 계산 로직 변경은 여기서.
- **문서→PDF**: `lib/documents.ts`(계약서/서약서/동의서), `lib/documents-pay.ts`(명세서/증명서) 가
  HTML 을 만들고 `lib/pdf.ts` 가 puppeteer-core 로 PDF 렌더(Vercel=@sparticuz/chromium, 로컬=설치된 Chrome/Edge).
  한글폰트는 `assets/fonts/` 를 base64 임베드(`lib/fonts.ts`).
- **DB 어댑터**: `lib/repo.ts` 가 Prisma 레코드 ↔ 엔진 입력/문서 입력 변환. 회사정보·요율·세액표 로딩.
- **서비스**: `lib/payroll-service.ts`(월 급여 upsert), `lib/leave-service.ts`(승인/조정),
  `lib/doc-service.ts`(PDF 생성+저장+기록), `lib/email.ts`, `lib/scheduler.ts`, `lib/slack.ts`.
- **API**: `app/api/**` — 모두 `isAuthed()` 가드(슬랙/크론 제외, 자체 서명검증).
- **화면**: `app/(app)/**` — 서버컴포넌트가 데이터 로드, `components/*Client.tsx` 가 상호작용.

## 규칙/주의
- 이식성을 위해 Prisma **enum 대신 문자열** + `lib/constants.ts` 의 상수/라벨 사용.
- DB는 Postgres. 스키마 변경 시 `npx prisma db push`(DIRECT_URL 사용). 서버리스 런타임은 pgbouncer(DATABASE_URL).
- 서버리스(Vercel)에서는 파일 저장 대신 PDF를 버퍼로 스트리밍/첨부. 예약발송은 Vercel Cron → `/api/cron`.
- 금액은 정수(원). 공제는 10원 절사(`floor10`). 통상시급은 `(주소정+주휴)*4.345` 환산시간 기준.
- 공제 기본모드: 4대보험 직원 **MANUAL**(세무사 지정값 직접입력), 사업소득 프리랜서 **AUTO**(3.3%).
  배치 재실행 시 수동값·주차비·실비 보존. 퇴직유보금(인센티브×8.3%, 확인서)·일할계산은 모드 무관 자동.
- 완전비율제(RATIO)는 연차·퇴직금 미적용 — 연차 화면/신청/슬랙에서 제외 유지.
- 4대보험/세율은 하드코딩 금지 — `InsuranceRate`(설정 화면에서 수정). 세액표는 `TaxBracket`.
- 계산식 변경 시 `lib/*.test.ts` 를 먼저 갱신하고 `npm test` 로 검증.
- 개인정보(주민번호 등)는 데모상 평문. 실제 운영은 암호화 권장.
- `.env`, `*.db`, `storage/` 는 커밋 금지(.gitignore).

## 자주 하는 작업
- **계약서 문구 수정** → `lib/documents.ts` 의 `contractHtml`.
- **급여 항목 추가** → `lib/payroll.ts`(계산) + `schema.prisma`(PayrollRecord) + `lib/documents-pay.ts`(명세서 표시).
- **연차 규칙 변경** → `lib/leave.ts`(`annualLeaveDays`, `generateGrants`) + 테스트.
- **슬랙 명령 추가** → `app/api/slack/command/route.ts`.
- **시간기록표 양식 변경** → `lib/timesheet.ts`(파서·주휴 산정, 테스트 있음) + `/api/payroll/timesheet`.
  주휴 기준: 주(월~일) 실근로 15시간 '초과' 시 min(주근로/5, 8)시간. 휴게 30분은 Employee.breakPaid 로 유급/무급.
