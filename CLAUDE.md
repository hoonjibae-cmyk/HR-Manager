# CLAUDE.md — 유쌤에듀 HR 프로그램 개발 가이드

Next.js 14 (App Router) + TypeScript + Prisma(PostgreSQL/Supabase) HR 관리 웹앱.
배포: Vercel + Supabase (서버리스). 로컬/Codespaces는 로컬 Postgres. 자세히는 docs/DEPLOY.md.

## 명령어
- `npm run dev` — 개발 서버 (http://localhost:3000)
- `npm run build && npm start` — 프로덕션
- `npm test` — 급여/연차 엔진 단위 테스트 (Vitest)
- `npm run seed` / `npm run db:reset` — 시딩 / DB 초기화+재시딩
- `npm run db:clear-employees` — 직원 데이터 전체 삭제 미리보기 (실제 삭제는 `CONFIRM=DELETE` 필요).
  설정(회사·요율·세액표·공휴일)은 남긴다.
- `npm run db:fix-contracts` — 계약 이력 앞뒤 맞추기 미리보기 (실제 반영은 `APPLY=1`). 멱등.
- `npx tsc --noEmit` — 타입 체크
- 로그인 비밀번호: `.env` 의 `ADMIN_PASSWORD` (기본 `yoossam2025`)

## 아키텍처
- **엔진(순수 함수, DB 무관, 테스트 있음)**: `lib/payroll.ts`(급여), `lib/leave.ts`(연차, 근로기준법 §60),
  `lib/overtime.ts`(보강 오버타임, 근로기준법 §56).
  UI/API 는 이 엔진을 호출만 한다. 계산 로직 변경은 여기서.
- **문서→PDF**: `lib/documents.ts`(계약서/서약서/동의서), `lib/documents-pay.ts`(명세서/증명서) 가
  HTML 을 만들고 `lib/pdf.ts` 가 puppeteer-core 로 PDF 렌더(Vercel=@sparticuz/chromium, 로컬=설치된 Chrome/Edge).
  한글폰트는 `assets/fonts/` 를 base64 임베드(`lib/fonts.ts`).
- **DB 어댑터**: `lib/repo.ts` 가 Prisma 레코드 ↔ 엔진 입력/문서 입력 변환. 회사정보·요율·세액표 로딩.
- **계약 = 보수조건의 단일 진실**: `lib/contracts.ts`. 급여 산정·계약서 발급·화면 표시 모두
  `governingContract(contracts, asOf)` 로 그 시점 계약을 찾아 쓴다.
- **작업 이력**: `lib/activity.ts` 의 `logActivity()` → `AuditLog`. 급여·명세서·계약·직원·문서처럼
  되돌리기 어려운 작업은 여기에 한 줄 남긴다(화면: `/activity`). 기록 실패가 본 작업을 막지 않는다.
- **서비스**: `lib/payroll-service.ts`(월 급여 upsert), `lib/leave-service.ts`(승인/조정),
  `lib/makeup-service.ts`(보강 신청·확인·오버타임 산정), `lib/doc-service.ts`(PDF 생성+저장+기록),
  `lib/email.ts`, `lib/scheduler.ts`, `lib/slack.ts`.
- **API**: `app/api/**` — 모두 `isAuthed()` 가드(슬랙/크론 제외, 자체 서명검증).
- **화면**: `app/(app)/**` — 서버컴포넌트가 데이터 로드, `components/*Client.tsx` 가 상호작용.
  보강 화면(`/makeup`)만 표가 아니라 **월 달력**(`components/MakeupCalendar.tsx`) — 누가 언제 보강하는지가
  날짜 축으로 보여야 하고, 구글 보강캘린더와 같은 그림을 보게 하기 위함.
- **명단 화면의 필터·정렬**: `components/TableTools.tsx`(`useTableSort` / `SortTh` / `FilterSelect` / `FilterBar`).
  수십 건 규모라 서버를 다시 부르지 않고 브라우저에서 거른다 — 서버컴포넌트가 행을 평평한
  값으로 직렬화해 내려주고(`EmployeeRow` / `LeaveRow`) 표 컴포넌트가 걸러 정렬한다.
  열 머리글은 오름차순 → 내림차순 → 원래 순서로 돈다. 날짜는 `YYYY-MM-DD` 문자열로 넘겨
  사전순 = 시간순이 되게 한다. 라벨로 보여주는 값(근속 "1년 6개월")은 정렬용 원시값을 따로 싣는다.

## 규칙/주의
- **보수조건은 계약(Contract)만 고친다.** 직원 카드(Employee)의 기본급·수당·위탁비율·인센티브·
  급여형태·세무구분은 '오늘 시점 지배 계약' 을 비추는 거울일 뿐이라 직접 수정하지 않는다
  (`PATCH /api/employees/[id]` 는 인적사항만 받고 보수 필드는 무시).
  변경 경로는 둘: 신규 계약 작성(`POST /api/contracts`) 또는 기존 계약 수정(`PATCH /api/contracts/[id]`).
  두 경로 모두 끝에 `refreshEmployeeCard()` 로 카드를 다시 맞춘다.
- **계약 기간에 빈틈을 만들지 않는다.** 계약을 만들거나 고치거나 지운 뒤에는 반드시
  `normalizeContractTimeline(employeeId)` 로 그 직원의 이력 전체를 다시 맞춘다 —
  뒤 계약이 시작하면 앞 계약을 '그 전날' 로 닫고, 종료일이 지난 계약은 EXPIRED 로 내린다
  (`planContractTimeline()` 이 순수 함수, 테스트 있음). 신규 계약 하나만 보고 직전 것을 닫는
  방식으로는 이미 끝난 계약의 상태나 과거 날짜로 끼워 넣은 계약이 정리되지 않았다.
  **종료일을 늘리지는 않는다** — 덮이지 않은 빈 기간은 `contractIssues()` 가 화면에 경고로 띄우고
  사람이 판단한다. 화면 표시는 저장된 status 가 아니라 `effectiveContractStatus(c, now)` 를 쓴다
  (시간이 지나면 저장값이 뒤처지므로). 기존 데이터는 `npm run db:fix-contracts` 로 한 번 훑는다.
- 미래 시작 계약을 만들어도 발효일 전까지는 카드·급여에 반영되지 않는다(지배 계약이 아직 이전 계약).
- 이식성을 위해 Prisma **enum 대신 문자열** + `lib/constants.ts` 의 상수/라벨 사용.
- DB는 Postgres. 스키마 변경 시 `npx prisma db push`(DIRECT_URL 사용). 서버리스 런타임은 pgbouncer(DATABASE_URL).
- 서버리스(Vercel)에서는 파일 저장 대신 PDF를 버퍼로 스트리밍/첨부. 예약발송은 Vercel Cron → `/api/cron`.
- 금액은 정수(원). 공제는 10원 절사(`floor10`). 통상시급은 `(주소정+주휴)*4.345` 환산시간 기준.
- **월급제·인센티브의 `baseWage` 는 '월 지급 총액'이고 식대·차량유지비(비과세)가 그 안에 포함**된다.
  엔진은 `baseP = baseWage − 식대 − 차량유지비` 로 과세분만 기본급에 싣고 비과세분을 따로 표시하므로
  합계는 baseWage 그대로다(400만 입력 + 식대 20만 → 지급계 400만, 과세 380만).
  직책수당은 총액에 **가산**되는 별도 항목. 시급제·비율제는 기본급 개념이 달라 식대를 별도 가산으로 둔다.
- **포괄임금(고정OT)은 금액이 아니라 '시간'을 계약에 저장**한다 — `fixedBaseHours`(기본급 산정시간, 예 209),
  `fixedOtHours`(약정 시간외), `fixedNightHours`(약정 야간). 금액은 `inclusiveWageBreakdown()`(lib/payroll.ts)이
  기준급여에서 역산한다: 통상시급 = **기준급여 ÷ (기본급시간 + 1.5×시간외 + 0.5×야간)**,
  시간외 = 통상시급×1.5×시간외시간, 야간 = 통상시급×0.5×야간시간, 기본급 = 기준급여 − 비과세 − 시간외 − 야간(잔액).
  기본급을 잔액으로 두므로 **항목 합계는 항상 기준급여와 일치**한다. 실제 서명된 계약서(하수정·최은희·김지연)를
  원 단위까지 재현하며, 계약서 제4조와 급여명세서가 같은 함수를 쓴다. 월급제·인센티브에만 적용(시급제·비율제는 무시).
  약정시간을 넘긴 실근로만 그 위에 추가 가산된다.
- 공제 기본모드: 4대보험 직원 **MANUAL**(세무사 지정값 직접입력), 사업소득 프리랜서 **AUTO**(3.3%).
  배치 재실행 시 수동값·주차비·실비·기타공제 항목(otherItems) 보존. 퇴직유보금(인센티브×8.3%, 확인서)·일할계산은 모드 무관 자동.
- 완전비율제(RATIO)에 **최저보장(ratioMinGuarantee)** 이 있으면 `max(매출×비율, 보장액)` 으로 지급한다
  (계약서 제5조 — 만근 조건 미충족 시에는 관리자가 조정).
- 완전비율제(RATIO)는 연차·퇴직금 미적용 — 연차 화면/신청/슬랙에서 제외 유지.
- **연차는 1주 소정근로시간 15시간 이상일 때만 발생**한다(근로기준법 §18③ 초단시간근로자 제외).
  판정은 `isLeaveEligible(주소정시간, Employee.leaveEligible)` — 카드의 `leaveEligible` 이
  null 이면 근로시간으로 자동, true/false 면 계약대로 강제. `summarizeLeave(..., {eligible})` 에 넘긴다.
  미적용이어도 관리자가 직접 부여한 분(ADJUST +)은 살아 있다.
  **슬랙도 같은 판정을 쓴다** — `leaveBalanceOf()` 가 스케줄에서 판정해 `eligible` 을 넘기고
  `eligibility`(사유·주 소정시간)를 함께 돌려준다. 여기서 빠뜨리면 화면은 0인데 슬랙만 15일로 보인다.
  미적용 직원이 신청을 시도하면 `leaveBlockNotice()` 가 사유와 함께 막는다 —
  다만 관리자 부여분·대휴가 남아 있으면 그 범위 안에서는 쓸 수 있으므로 막지 않는다.
- **연차 신청은 슬랙으로만 들어온다.** 관리자는 신청서를 만들지 않고 `/api/leave/adjust` 로 바로 반영한다
  (연차 화면의 *+ 연차 반영*). 반영 시 당사자에게 슬랙 DM 을 보낼지 선택할 수 있고, 알림 실패가 반영을 되돌리지 않는다.
  **직원은 여러 명 고른다**(`employeeIds[]`) — 방학처럼 한꺼번에 넣는 일이 잦다. 완전비율제는 자동 제외.
  **사용분을 2일 이상 넣으면 시작일부터 평일 기준으로 하루씩 나눠 기록**한다
  (`businessDaysFrom()`, 주말·공휴일 건너뜀. 부여(+)는 하루에 몰아 넣는다).
  어느 날짜에 들어갈지는 공휴일 표를 봐야 알 수 있어 폼이 `preview:true` 로 같은 API 를 불러 제출 전에 보여준다.
  **구글 캘린더에는 올리지 않는다** — 방학은 전 직원이 같은 날 쉬어 캘린더가 도배된다(슬랙 승인 경로만 올린다).
- **슬랙 잔여 확인에는 사용 내역이 함께 나간다.** `leaveBalanceOf()` 가 트랜잭션을 그대로 돌려주고
  `leaveBalanceText(..., txns)` 가 `leaveUseLines()` 로 이번 연차기간 사용분을 한 줄씩 붙인다.
  최대 12줄이고 넘치면 **오래된 쪽을 접는다**(궁금한 건 방금 쓴 연차). 연차기간이 해를 넘기므로 날짜에 연도를 쓴다.
- **보강계획 사전신청 = 오버타임 수당의 원장**(`MakeupSession`). 직원이 슬랙으로 등록하고(승인 절차 없음)
  관리자가 **실근무 시각을 확정(CONFIRMED)** 해야 비로소 수당이 생긴다. PLANNED 는 0원.
  산정은 `computeOvertime()`(lib/overtime.ts, 순수 함수) 하나가 전담한다:
  ① 평일 소정근로시간 밖·토요일 → **연장, 가산 없음(×1.0)** ② 일요일·공휴일 → **휴일**(8시간까지 ×1.5, 초과 ×2.0)
  ③ 소정근로시간 안은 대상 아님(월급에 이미 포함) ④ 완전비율제는 제외.
  **연장에 1.5배를 붙이지 않는다** — 이 학원은 주 소정근로가 37.5시간(14~22시·휴게 0.5)이라
  주 40시간 안쪽의 추가근로는 법정 가산 대상이 아니다(법내연장). 가산은 휴일근로에만 붙는다.
  1일 8시간·주 40시간 초과분까지 ×1.5 로 올리려면 `applyStatutoryOvertime` 을 켠다(**기본 꺼짐**,
  켜면 그 주의 늦은 시각부터 승격되고 휴일근로시간은 산입하지 않는다).
  **야간(22~06시) +0.5 가산도 기본 꺼짐**(`countNight`) — 지시가 없으면 붙이지 않는다.
  **소정근로시간은 `Employee.schedule` 에서 뺀다** — 시간표가 비어 있으면 전부 연장으로 잡히므로
  화면이 '근로시간표 없음' 경고를 띄운다.
  **내신의무보강은 내신 기간(`ExamPeriod`)당 상한(기본 10시간)** 까지만 인정하고,
  **수당이 큰 조각부터** 채운다(토 7h·일 7h → 일 7h 전부 + 토 3h). 내신 기간을 등록하지 않으면
  분기(연 4회)로 대신 묶어 상한이 새지 않게 한다. **결시보강은 기본 미반영** — `payEligible` 로 건건이 켠다.
  지급 조건은 `OvertimePolicy`(단일 행) 에 있고 화면(보강·오버타임 → 수당 지급 조건)에서 고친다.
- **오버타임은 급여 산정에 자동으로 실린다.** `runPayrollMonth()` 가 `overtimeInputsFor()` 로
  그 달 확정분을 읽어 `extraHours(법내연장 ×1.0)/overtimeHours(법정연장 ×1.5)/holidayHours/holidayOverHours/nightHours` 를 채운다
  (명시적으로 넘긴 값이 있으면 그쪽 우선). 산정 줄은 `breakdown.overtime` 에 남고
  명세서에 「보강 오버타임 산정 내역서」로 첨부된다(`overtimeDetailHtml`).
  내신 상한은 **내신 기간 전체** 기준이라 기간이 달을 걸치면 뒤 달 신청이 앞 달 배분을 바꿀 수 있다 —
  발송(SENT)된 달은 재계산하지 않으므로 확정분이 흔들리지는 않는다.
- **보강은 '보강캘린더' 에 올린다** — 연차 캘린더(`GOOGLE_CALENDAR_ID`)와 **다른 캘린더**
  (`GOOGLE_MAKEUP_CALENDAR_ID`)를 쓰고, 섞이면 안 되므로 없을 때 연차 캘린더로 대체하지 않는다.
  신청·수정 시 동기화하고 취소·미실시면 일정을 내린다(`syncMakeupCalendar`). 캘린더 실패가 신청을 되돌리지 않는다.
- 4대보험/세율은 하드코딩 금지 — `InsuranceRate`(설정 화면에서 수정). 세액표는 `TaxBracket`.
- 계산식 변경 시 `lib/*.test.ts` 를 먼저 갱신하고 `npm test` 로 검증.
- 관리자 로그인은 비밀번호 공유(`ADMIN_PASSWORD`) 방식이라 화면 작업의 '누가' 는 남지 않는다.
  슬랙 경유 작업만 사용자까지 기록된다. 개인 구분이 필요해지면 계정 모델을 도입해야 한다.
- 개인정보(주민번호 등)는 데모상 평문. 실제 운영은 암호화 권장.
- `.env`, `*.db`, `storage/` 는 커밋 금지(.gitignore).

## 자주 하는 작업
- **계약서 문구 수정** → `lib/documents.ts` 의 `contractHtml`.
- **직원 보수조건 변경** → 직원 상세 → 계약 이력 → *조건 수정*(오타 정정) 또는 *신규 계약 작성*(변경 발효일 지정).
- **포괄임금 약정시간 입력** → 계약 폼(신규 계약 작성 / 조건 수정)의 *포괄임금 약정시간* 접이식 영역.
  시간만 넣으면 기본급·시간외·야간 금액이 자동 분해되어 계약서 제4조와 명세서에 함께 반영된다.
- **급여 항목 추가** → `lib/payroll.ts`(계산) + `schema.prisma`(PayrollRecord) + `lib/documents-pay.ts`(명세서 표시).
- **연차 규칙 변경** → `lib/leave.ts`(`annualLeaveDays`, `generateGrants`) + 테스트.
- **직원별 연차 내역 보기** → `/leave/[id]` (연차 화면에서 이름 클릭). 사용·반영 내역을
  "7월 29일 (수) · 연차 1일 사용" 처럼 한 줄씩, 슬랙 신청 이력, 발생 lot 이력을 함께 보여준다.
- **쓰던 연차 관리시트 가져오기** → `/leave` 의 *연차 시트 가져오기* (`lib/leave-import.ts` 파서·계획,
  `/api/leave/import`). **사용 내역만** 가져오고 발생일수는 시스템 계산을 쓴다(시트=회계연도, 시스템=입사일 기준).
  휴가종류 가중치는 시트가 자체 계산한 누적사용일수와 대조해 확정 — 연차 1일·반차 0.5일만 연차를 깎고
  대체휴일은 대휴(COMP), 공가공상·무급휴가는 차감하지 않는다. 같은 날짜 사용분은 다시 넣지 않아 재실행이 안전하다.
- **직원 명단 일괄 등록** → `lib/employee-import.ts`(엑셀 파서·헤더 alias·값 정규화, 테스트 있음)
  + `/api/employees/import`(GET=빈 양식, POST=미리보기/등록). 등록 시 초기 계약도 함께 만든다.
- **이미 등록된 직원의 빈 인적사항 채우기** → 같은 화면의 *정보 채우기* 탭
  (`parseEmployeeWorkbook(buf, {mode:"fill"})` → `planFill()` → `mode=fill-preview|fill-commit`).
  사번→성명 순으로 직원을 찾고, **비어 있는 항목만** 채운다(덮어쓰기는 선택). 채울 수 있는 건
  `FILL_FIELDS`(인적사항)뿐 — 보수조건은 계약이 정하므로 이 경로로 바뀌지 않는다.
  파일에 **없는 열은 건드리지 않는다**(`presentKeys`) — 파서 기본값(부양가족수 1 등)이 새어 들어가면 안 된다.
  주민번호는 `normalizeRRN()` 으로 형식을 통일하고 생년월일을 자동 도출, 화면·이력에는 마스킹해 남긴다.
- **보강 실근무 확인** → `/makeup` 월 달력에서 칩 클릭 → 실근무 시각 기입 → *실근무 확정*.
  결시보강은 *수당 반영* 을 직접 고른다(⚠ 표시가 판단 대기). 확정 후 급여를 다시 산정하면 명세서에 반영된다.
- **오버타임 지급 조건·내신 기간 수정** → `/makeup` 의 *수당 지급 조건* (`OvertimePolicy` / `ExamPeriod`).
  법정 배수보다 낮추면 저장 시 경고가 뜬다.
- **슬랙 명령 추가** → `app/api/slack/command/route.ts`.
- **시간기록표 양식 변경** → `lib/timesheet.ts`(파서·주휴 산정, 테스트 있음) + `/api/payroll/timesheet`.
  주휴 기준: 주(월~일) 실근로 15시간 '초과' 시 min(주근로/5, 8)시간. 휴게 30분은 Employee.breakPaid 로 유급/무급.
- **인센티브 산정 변경** → `lib/incentive.ts`(재원계수·엑셀 명단 파서, 테스트 있음) + `/api/payroll/incentive`.
  월중 입학·전출·퇴원 학생은 정수 1이 아니라 **회차 비례**(재원계수 = 회차÷8, 상한 1)로 계산.
  인센티브 = (Σ재원계수 − 기준인원) × 기준금액. 1회당 단가 = 기준금액÷8(만근 8회).
  명세서에 「인센티브 산정 내역서」가 첨부문서로 자동 첨부(`incentiveDetailHtml`).
