import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { leaveSummaryFor } from "@/lib/repo";
import { PageHeader, Pill } from "@/components/ui";
import DocButton from "@/components/DocButton";
import NewContractForm from "@/components/NewContractForm";
import ContractEditForm from "@/components/ContractEditForm";
import {
  INCOME_TYPE_LABEL,
  CONTRACT_STAGE_LABEL,
  PAYROLL_STATUS_LABEL,
  parseSchedule,
  DAY_KO,
  isContractorContract,
  isRatioEmployee,
  paySchemeLabelOf,
} from "@/lib/constants";
import { won, wonUnit, ymd, kstTodayYmd } from "@/lib/format";
import { probationTimeline } from "@/lib/probation";
import {
  governingContract,
  contractIssues,
  paySchemeOf,
  effectiveContractStatus,
} from "@/lib/contracts";
import ContractIssueNotice from "@/components/ContractIssueNotice";
import AttachmentBox from "@/components/AttachmentBox";
import EmployeeDeleteButton from "@/components/EmployeeDeleteButton";
import { nonCompeteRequired, nonCompeteRatioRequired, ratioPctLabel } from "@/lib/non-compete";
import { bizPayerMissing } from "@/lib/ratio-employee";

export const dynamic = "force-dynamic";

export default async function EmployeeDetail({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const emp = await prisma.employee.findUnique({
    where: { id },
    include: {
      contracts: {
        orderBy: { startDate: "desc" },
        // ⚠ 스캔본 **본문(`data`)은 싣지 않는다** — 계약 6건에 수 MB 씩이면 화면이 통째로 느려진다
        include: {
          files: {
            // 올리다 만 파일은 목록에 내지 않는다 (열면 깨진 문서가 나온다)
            where: { complete: true },
            select: { id: true, name: true, mime: true, size: true, note: true, uploadedAt: true },
            orderBy: { uploadedAt: "asc" },
          },
        },
      },
      payrolls: { orderBy: [{ year: "desc" }, { month: "desc" }], take: 6 },
      documents: { orderBy: { createdAt: "desc" }, take: 6 },
      // 직원 서류함 — ⚠ 본문(`data`)은 싣지 않는다(한 화면에 수십 MB 가 딸려 온다)
      attachedFiles: {
        where: { complete: true },
        select: { id: true, name: true, mime: true, size: true, note: true, uploadedAt: true },
        orderBy: { uploadedAt: "asc" },
      },
    },
  });
  if (!emp) notFound();

  const { summary, comp } = await leaveSummaryFor(id);
  const sched = parseSchedule(emp.schedule);
  // 별도 사업장 — 근로소득 상한을 둔 비율제 근로계약은 계약서 발급 때 그 사업장 명의의 용역위탁계약서가
  // 함께 나가고, 정보가 비면 발급이 막힌다. 계약 카드에서 미리 알린다(로고·인감 같은 큰 값은 읽지 않는다)
  const bizPayer = await prisma.company.findFirst({
    where: { id: 1 },
    select: { bizPayerName: true, bizPayerBizNo: true, bizPayerCeo: true, bizPayerAddress: true },
  });
  const bizMissing = bizPayerMissing(bizPayer);

  // 보수조건은 계약이 정한다 — 카드는 '오늘 시점 지배 계약' 을 비추는 읽기 전용 뷰
  const now = new Date();
  const todayYmd = kstTodayYmd(now); // 수습 중 판정 — 계약 날짜와 같은 YYYY-MM-DD 로 비교한다
  const gov = governingContract(emp.contracts, now);
  const issues = contractIssues(emp, emp.contracts, now);
  const terms = gov
    ? {
        payScheme: paySchemeOf(gov.templateKey),
        baseWage: gov.baseWage,
        positionAllow: gov.positionAllow,
        mealAllow: gov.mealAllow,
        carAllow: gov.carAllow,
        incThreshold: gov.incThreshold,
        incPerStudent: gov.incPerStudent,
        incRevenuePercent: gov.incRevenuePercent,
        ratioPercent: gov.ratioPercent,
        incomeType: gov.incomeType ?? emp.incomeType,
        nonCompetePay: gov.nonCompetePay ?? null,
        nonCompeteRatio: gov.nonCompeteRatio ?? null,
        isContractor: gov.isContractor,
        ratioEmployee: gov.ratioEmployee,
        ratioWageCap: gov.ratioWageCap ?? null,
      }
    : {
        payScheme: emp.payScheme,
        baseWage: emp.baseWage,
        positionAllow: emp.positionAllow,
        mealAllow: emp.mealAllow,
        carAllow: emp.carAllow,
        incThreshold: emp.incThreshold,
        incPerStudent: emp.incPerStudent,
        incRevenuePercent: emp.incRevenuePercent,
        ratioPercent: emp.ratioPercent,
        incomeType: emp.incomeType,
        nonCompetePay: emp.nonCompetePay ?? null,
        nonCompeteRatio: emp.nonCompeteRatio ?? null,
        isContractor: emp.isContractor,
        ratioEmployee: emp.ratioEmployee,
        ratioWageCap: emp.ratioWageCap ?? null,
      };
  // 비율제 근로계약(4대보험 근로자) — 같은 '완전비율제' 라도 위탁과 서식·공제·연차가 다르다
  const ratioWorker = isRatioEmployee(terms);
  const isMonthlyScheme = terms.payScheme === "MONTHLY" || terms.payScheme === "INCENTIVE";
  const upcoming = emp.contracts
    .filter((c) => c.startDate > now)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  // 교수부 근로계약(월급제·인센티브)인데 경업금지 보상금이 없는 계약 — 지금 적용 중이거나 발효 예정이고
  // **서명본 스캔이 아직 없는 것만** 짚는다. 서명이 끝난 계약에 보상금을 넣어 다시 뽑으면 서명본과 다른
  // 계약서가 되므로, 그런 계약은 그대로 두고 다음 갱신 때 넣는다(막지는 않는다).
  // 완전비율제는 보상금 비율이 없는 계약을 같은 규칙으로 짚는다 — 위탁은 부서 무관, 비율제 근로계약은 교수부만.
  const ncMissing = emp.contracts.filter((c) => {
    if (!(gov?.id === c.id || c.startDate > now) || c.files.length > 0) return false;
    const shape = {
      payScheme: paySchemeOf(c.templateKey),
      isContractor: c.isContractor,
      ratioEmployee: c.ratioEmployee,
    };
    if (nonCompeteRatioRequired(shape, emp.department)) return !c.nonCompeteRatio;
    return !c.nonCompetePay && nonCompeteRequired(emp.department, shape);
  });

  return (
    <div>
      <PageHeader
        title={emp.name}
        desc={`${emp.empNo} · ${emp.department ?? ""} ${emp.position ?? ""}`}
        action={
          <div className="flex gap-2">
            <Link href="/employees" className="btn-ghost">← 직원 목록</Link>
            <Link href={`/employees/${id}/edit`} className="btn-ghost">정보 수정</Link>
            <DocButton endpoint="/api/documents/newhire" body={{ employeeId: id }} label="신규입사 패키지 발급" className="btn-primary" />
          </div>
        }
      />

      {issues.length > 0 && (
        <div className="mb-6">
          <ContractIssueNotice messages={issues.map((i) => i.message)} />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* 좌: 기본정보 */}
        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="font-bold text-slate-800 mb-3">기본 정보</h2>
            <dl className="text-sm space-y-2">
              <Row k="구분"><Pill kind={emp.incomeType}>{INCOME_TYPE_LABEL[emp.incomeType]}</Pill></Row>
              <Row k="급여형태"><Pill kind={emp.payScheme}>{paySchemeLabelOf(emp)}</Pill></Row>
              <Row k="입사일">{ymd(emp.hireDate)}</Row>
              <Row k="재직상태">{emp.active ? "재직중" : `퇴직 (${ymd(emp.resignDate)})`}</Row>
              <Row k="연락처">{emp.phone ?? "-"}</Row>
              <Row k="업무용 구글메일">{(emp as any).workEmail ?? "-"}</Row>
              <Row k="명세서 발송용">
                {emp.email ?? ((emp as any).workEmail ? <span className="text-slate-400">(업무용으로 발송)</span> : "-")}
              </Row>
              <Row k="슬랙 ID">{emp.slackUserId ?? "-"}</Row>
              <Row k="부양가족">{emp.dependents}명</Row>
            </dl>
          </div>

          <div className="card p-5">
            <div className="flex items-start justify-between mb-1">
              <h2 className="font-bold text-slate-800">보수 (현재 계약 기준)</h2>
              <a href="#contracts" className="text-xs text-brand-600 font-semibold whitespace-nowrap">
                계약 관리 →
              </a>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              {gov
                ? `${ymd(gov.startDate)} ~ ${gov.endDate ? ymd(gov.endDate) : "기한 없음"} 계약 적용 중`
                : "적용 중인 계약이 없어 직원 카드 값을 표시합니다"}
            </p>
            <dl className="text-sm space-y-2">
              <Row k="세무/보험">{INCOME_TYPE_LABEL[terms.incomeType] ?? terms.incomeType}</Row>
              <Row k="급여형태">{paySchemeLabelOf(terms)}</Row>
              {ratioWorker && (
                <Row k="계약 성격">
                  <span className="pill bg-emerald-50 text-emerald-700">비율제 근로계약(4대보험)</span>
                  <span className="block text-[11px] text-slate-500 mt-1 leading-relaxed">
                    매출 × 비율로 받는 근로자 — 4대보험·근로소득세·연차·퇴직급여가 적용됩니다.
                  </span>
                </Row>
              )}
              {isContractorContract(terms) && (
                <Row k="계약 성격">
                  <span className="pill bg-amber-50 text-amber-700">위탁계약(프리랜서)</span>
                  <span className="block text-[11px] text-slate-500 mt-1 leading-relaxed">
                    주휴수당·연차·퇴직금·4대보험을 적용하지 않고 계약서의{" "}
                    {terms.payScheme === "RATIO" ? "위탁 비율" : "시급"}로만 지급합니다.
                  </span>
                </Row>
              )}
              {terms.payScheme === "RATIO" ? (
                <>
                  <Row k={ratioWorker ? "임금 비율" : "위탁비율"}>{((terms.ratioPercent ?? 0) * 100).toFixed(1)}%</Row>
                  {ratioWorker && (
                    <Row k="근로소득 상한(월)">
                      {terms.ratioWageCap ? (
                        <>
                          {wonUnit(terms.ratioWageCap)}
                          <span className="block text-[11px] text-slate-400 mt-0.5">
                            {(terms.nonCompeteRatio ?? 0) > 0
                              ? "비율급 + 경업금지 보상금 합계 기준 — 넘는 만큼 비율급을 별도 사업장이 사업소득(3.3%)으로 지급"
                              : "넘는 비율급은 별도 사업장이 사업소득(3.3%)으로 지급"}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">없음 (비율급 전액 근로소득)</span>
                      )}
                    </Row>
                  )}
                  {(terms.nonCompeteRatio ?? 0) > 0 && (
                    <Row k="경업금지 보상금">
                      매출의 {ratioPctLabel(terms.nonCompeteRatio ?? 0)}
                      <span className="block text-[11px] text-slate-400 mt-0.5">
                        {ratioWorker
                          ? "비율급과 별도 지급 (근로계약서 제8조 · 근로소득 — 근로소득 상한은 비율급과 합쳐 잰다)"
                          : "용역수수료와 별도 지급 (위탁계약서 제5조·제7조)"}
                      </span>
                    </Row>
                  )}
                  {gov?.ratioMinGuarantee ? (
                    <Row k={ratioWorker ? "보장급(월, §47)" : "최저보장(월)"}>{wonUnit(gov.ratioMinGuarantee)}</Row>
                  ) : null}
                </>
              ) : (
                <Row k={terms.payScheme === "HOURLY" ? "시급" : "월 급여 총액"}>{wonUnit(terms.baseWage)}</Row>
              )}
              {terms.payScheme === "HOURLY" && (
                <Row k="휴게 30분">
                  {emp.breakPaid ? (
                    <span className="text-emerald-600">유급 (기록 그대로 인정)</span>
                  ) : (
                    <span className="text-slate-500">무급 (일별 30분 차감)</span>
                  )}
                </Row>
              )}
              {isMonthlyScheme && (terms.mealAllow > 0 || terms.carAllow > 0) && (
                <Row k="└ 과세 기본급">
                  <span className="text-slate-500">
                    {wonUnit(Math.max(terms.baseWage - terms.mealAllow - terms.carAllow, 0))}
                  </span>
                </Row>
              )}
              {terms.mealAllow > 0 && (
                <Row k={isMonthlyScheme ? "└ 식대(비과세)" : "식대(비과세)"}>
                  <span className="text-slate-500">{wonUnit(terms.mealAllow)}</span>
                </Row>
              )}
              {terms.carAllow > 0 && (
                <Row k={isMonthlyScheme ? "└ 차량유지비(비과세)" : "차량유지비(비과세)"}>
                  <span className="text-slate-500">{wonUnit(terms.carAllow)}</span>
                </Row>
              )}
              {terms.positionAllow > 0 && (
                <Row k="직책수당 (별도 가산)">{wonUnit(terms.positionAllow)}</Row>
              )}
              {isMonthlyScheme && (terms.nonCompetePay ?? 0) > 0 && (
                <Row k="└ 경업금지 보상금">
                  <span className="text-slate-500">{wonUnit(terms.nonCompetePay ?? 0)}</span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    총액 안에서 기본급과 구분 (근로계약서 제8조)
                  </span>
                </Row>
              )}
              {isMonthlyScheme && (
                <Row k="총 지급액">
                  <b>{wonUnit(terms.baseWage + terms.positionAllow)}</b>
                </Row>
              )}
              {terms.payScheme === "INCENTIVE" && (terms.incThreshold || terms.incPerStudent) && (
                <Row k="인센티브">학생 {terms.incThreshold}명 초과 시 1명당 {won(terms.incPerStudent)}원</Row>
              )}
              {terms.payScheme === "INCENTIVE" && terms.incRevenuePercent != null && (
                <Row k="인센티브(매출)">
                  담당 원생 수강료 매출의 <b>{(terms.incRevenuePercent * 100).toFixed(2).replace(/\.?0+$/, "")}%</b>
                </Row>
              )}
            </dl>
            {upcoming && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3">
                {ymd(upcoming.startDate)}부터 적용될 새 계약이 등록돼 있습니다. 발효일이 지나면 이 값이 자동으로 바뀝니다.
              </p>
            )}
            <p className="text-[11px] text-slate-400 mt-3">
              보수조건은 계약서가 기준입니다. 바꾸려면 아래 <b>계약 이력</b>에서 계약을 수정하거나 새로 작성하세요.
            </p>
          </div>

          <div className="card p-5">
            <h2 className="font-bold text-slate-800 mb-3">근로시간표</h2>
            <div className="flex flex-wrap gap-1.5">
              {sched.map((d) => (
                <div key={d.day} className={`text-xs rounded-lg px-2 py-1.5 ${d.work ? "bg-brand-50 text-brand-700" : "bg-slate-50 text-slate-300"}`}>
                  <div className="font-bold text-center">{DAY_KO[d.day]}</div>
                  <div>{d.work ? `${d.start}~${d.end}` : "휴무"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 중앙: 연차 + 계약 */}
        <div className="space-y-6">
          {isContractorContract(emp) && emp.payScheme === "RATIO" ? (
            <div className="card p-5">
              <h2 className="font-bold text-slate-800 mb-2">연차 현황</h2>
              <p className="text-sm text-slate-400">
                완전비율제(위탁) 계약 — 프리랜서 계약으로 <b>연차휴가·퇴직금이 적용되지 않습니다.</b>
              </p>
            </div>
          ) : (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-800">연차 현황</h2>
              <Link href={`/leave/${emp.id}`} className="text-xs text-brand-600 font-semibold">상세 내역 →</Link>
            </div>
            <div className="text-xs text-slate-500 mb-2">
              이번 연차기간 <b className="text-slate-700">{ymd(summary.period.start)} ~ {ymd(summary.period.end)}</b>{" "}
              ({summary.period.label})
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Metric
                label="발생"
                value={summary.period.granted + summary.period.carriedOver}
              />
              <Metric label="사용" value={summary.period.used} />
              <Metric label="잔여" value={summary.period.remaining} accent="text-brand-600" />
            </div>
            <div className="text-xs text-slate-400 mt-3 space-y-0.5">
              <div>근속: {summary.serviceLabel}</div>
              {summary.period.carriedOver > 0 && <div>이월: {summary.period.carriedOver}일</div>}
              {summary.period.scheduled > 0 && (
                <div>추가 발생 예정: {summary.period.scheduled}일 (매월 개근 1일)</div>
              )}
              <div>사용기한: {ymd(summary.period.end)} (미사용분 소멸)</div>
              {summary.nextGrantDate && (
                <div>다음 발생: {ymd(summary.nextGrantDate)} ({summary.nextGrantDays}일)</div>
              )}
              <div className="pt-1 text-slate-300">
                입사 후 누계: 발생 {summary.granted} · 사용 {summary.used}
                {summary.expired > 0 && ` · 소멸 ${summary.expired}`}
              </div>
            </div>
            {comp.granted > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-sm flex items-center justify-between">
                <span className="text-slate-500">대휴보상연차</span>
                <span className="tnum">
                  발생 {comp.granted} · 사용 {comp.used} ·{" "}
                  <b className="text-emerald-600">잔여 {comp.remaining}</b>
                </span>
              </div>
            )}
          </div>
          )}

          <div className="card p-5" id="contracts">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">계약 이력</h2>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              보수조건은 여기서만 바꿉니다. 새 계약을 만들면 직전 계약은 <b>시작일 하루 전</b>으로
              자동 종료되어 기간이 빈틈없이 이어집니다.
            </p>
            {ncMissing.length > 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 break-keep">
                <b>경업금지 보상금</b>이 정해지지 않아 계약서에 보상금 조항이 들어가지 않는 계약이
                있습니다 ({ncMissing.map((c) => `${ymd(c.startDate)} 시작`).join(", ")}). 아직 서명
                전이면 <b>조건 수정</b>에서 보상금을 넣고 다시 발급하세요. 이미 서명한 계약이면 그대로
                두고 다음 갱신 계약에 넣으면 됩니다.
              </p>
            )}
            <div className="mb-3">
              <NewContractForm
                emp={{
                  id: emp.id,
                  incomeType: emp.incomeType,
                  payScheme: emp.payScheme,
                  baseWage: emp.baseWage,
                  positionAllow: emp.positionAllow,
                  mealAllow: emp.mealAllow,
                  carAllow: emp.carAllow,
                  incThreshold: emp.incThreshold,
                  incPerStudent: emp.incPerStudent,
                  incRevenuePercent: emp.incRevenuePercent,
                  ratioPercent: emp.ratioPercent,
                  ratioMinGuarantee: emp.ratioMinGuarantee,
                  fixedBaseHours: emp.fixedBaseHours,
                  fixedOtHours: emp.fixedOtHours,
                  fixedNightHours: emp.fixedNightHours,
                  nonCompetePay: emp.nonCompetePay,
                  nonCompeteRatio: emp.nonCompeteRatio,
                  isContractor: emp.isContractor,
                  ratioEmployee: emp.ratioEmployee,
                  ratioWageCap: emp.ratioWageCap ?? null,
                  department: emp.department,
                  schedule: emp.schedule,
                  position: emp.position,
                  duty: emp.duty,
                }}
              />
            </div>
            <ul className="space-y-2">
              {emp.contracts.map((c) => (
                <li
                  key={c.id}
                  className={`border rounded-lg p-3 ${
                    gov?.id === c.id ? "border-brand-300 bg-brand-50/40" : "border-slate-100"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">
                      {CONTRACT_STAGE_LABEL[c.stage]}
                      {gov?.id === c.id && (
                        <span className="ml-2 pill bg-brand-100 text-brand-700">현재 적용</span>
                      )}
                      {c.startDate > now && (
                        <span className="ml-2 pill bg-amber-100 text-amber-700">발효 예정</span>
                      )}
                    </span>
                    {(() => {
                      // 저장된 status 가 아니라 '오늘 기준 실제 상태' 를 보여준다
                      const st = effectiveContractStatus(c, now);
                      return <Pill kind={st}>{st}</Pill>;
                    })()}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {ymd(c.startDate)} ~ {c.endDate ? ymd(c.endDate) : "기한 없음"}
                    {c.isProbation &&
                      (() => {
                        // 개월은 계약에 저장된 값 — 2026-11 이전 계약은 2개월, 이후 3개월
                        const pt = probationTimeline(c.startDate.toISOString().slice(0, 10), c.probationMonths);
                        const ongoing = pt && pt.endYmd >= todayYmd && c.startDate.toISOString().slice(0, 10) <= todayYmd;
                        return (
                          <>
                            {/* 날짜가 '(~2027-02-' / '01)' 로 갈리지 않게 한 덩어리로 묶는다 */}
                            <span className="whitespace-nowrap">
                              {` · 수습 ${c.probationMonths}개월`}
                              {pt && ` (~${pt.endYmd})`}
                            </span>
                            {/* 수습 중이면 본채용 거부를 알릴 마지막 날을 띄운다 — 3개월 수습은 끝나는 날
                                근속이 3개월이라 30일 해고예고 대상이다(§26). 지난 기한은 빨갛게 */}
                            {ongoing && pt.noticeByYmd && (
                              <span
                                className={`ml-1 pill ${
                                  pt.noticeByYmd >= todayYmd ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"
                                }`}
                                title={
                                  "본채용을 하지 않으려면 이날까지 사유를 적어 서면으로 알려야 해고예고수당(30일분 통상임금)이 생기지 않는다 (근로기준법 §26·§27)" +
                                  (c.probationNotifiedAt ? ` · 슬랙 알림 ${ymd(c.probationNotifiedAt)} 보냄` : "")
                                }
                              >
                                본채용 판단 {pt.noticeByYmd}까지
                              </span>
                            )}
                          </>
                        );
                      })()}
                    {c.note ? ` · ${c.note}` : ""}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 tnum">
                    {paySchemeLabelOf({ payScheme: paySchemeOf(c.templateKey), ratioEmployee: c.ratioEmployee })} ·{" "}
                    {c.templateKey === "RATIO"
                      ? `${c.ratioEmployee ? "비율급" : "위탁"} ${((c.ratioPercent ?? 0) * 100).toFixed(1)}%`
                      : `${wonUnit(c.baseWage)}`}
                    {c.templateKey === "RATIO" && c.ratioEmployee && c.ratioWageCap
                      ? ` · 근로소득 상한 ${wonUnit(c.ratioWageCap)}`
                      : ""}
                    {isContractorContract({
                      payScheme: paySchemeOf(c.templateKey),
                      isContractor: c.isContractor,
                      ratioEmployee: c.ratioEmployee,
                    }) && <span className="pill bg-amber-50 text-amber-700 ml-1">위탁</span>}
                    {c.templateKey === "RATIO" && c.ratioEmployee && (
                      <span className="pill bg-emerald-50 text-emerald-700 ml-1">4대보험</span>
                    )}
                    {c.mealAllow > 0 && ` · 식대 ${wonUnit(c.mealAllow)}`}
                    {c.positionAllow > 0 && ` · 직책 ${wonUnit(c.positionAllow)}`}
                    {(c.fixedOtHours || c.fixedNightHours) && (
                      <span className="text-slate-400">
                        {" · 포괄"}
                        {c.fixedOtHours ? ` 시간외 ${c.fixedOtHours}h` : ""}
                        {c.fixedNightHours ? ` 야간 ${c.fixedNightHours}h` : ""}
                      </span>
                    )}
                    {(c.nonCompetePay ?? 0) > 0 && ` · 경업금지 보상금 ${wonUnit(c.nonCompetePay ?? 0)}`}
                    {(c.nonCompeteRatio ?? 0) > 0 && ` · 경업금지 보상금 매출의 ${ratioPctLabel(c.nonCompeteRatio ?? 0)}`}
                  </div>
                  {c.templateKey === "RATIO" && c.ratioEmployee && (c.ratioWageCap ?? 0) > 0 && (
                    <p
                      className={`text-[11px] mt-1 leading-relaxed break-keep ${
                        bizMissing.length ? "text-amber-700" : "text-slate-500"
                      }`}
                    >
                      {bizMissing.length
                        ? `별도 사업장 정보(${bizMissing.join("·")})가 비어 계약서를 발급할 수 없습니다 — 설정 → 회사 정보의 「별도 사업장」을 먼저 채우세요.`
                        : `계약서 발급 때 별도 사업장(${bizPayer?.bizPayerName}) 명의의 용역위탁계약서와 그 사업장 앞 개인사업자 지위 확인서가 함께 나갑니다.`}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-3">
                    <DocButton endpoint="/api/documents/contract" body={{ contractId: c.id }} label="계약서 발급" className="text-xs text-brand-600 font-semibold" />
                    <ContractEditForm
                      contract={{
                        id: c.id,
                        stage: c.stage,
                        startDate: c.startDate.toISOString().slice(0, 10),
                        endDate: c.endDate ? c.endDate.toISOString().slice(0, 10) : "",
                        isProbation: c.isProbation,
                        probationMonths: c.probationMonths,
                        isContractor: (c as any).isContractor ?? false,
                        payScheme: paySchemeOf(c.templateKey),
                        incomeType: c.incomeType ?? emp.incomeType,
                        baseWage: c.baseWage,
                        positionAllow: c.positionAllow,
                        mealAllow: c.mealAllow,
                        carAllow: c.carAllow,
                        incThreshold: c.incThreshold,
                        incPerStudent: c.incPerStudent,
                        incRevenuePercent: c.incRevenuePercent,
                        incScope: (c as any).incScope ?? null,
                        incCountMethod: (c as any).incCountMethod ?? null,
                        ratioPercent: c.ratioPercent,
                        ratioMinGuarantee: c.ratioMinGuarantee,
                        ratioEmployee: c.ratioEmployee,
                        ratioWageCap: c.ratioWageCap ?? null,
                        fixedBaseHours: c.fixedBaseHours,
                        fixedOtHours: c.fixedOtHours,
                        fixedNightHours: c.fixedNightHours,
                        nonCompetePay: c.nonCompetePay ?? null,
                        nonCompeteRatio: c.nonCompeteRatio ?? null,
                        note: c.note ?? "",
                      }}
                      deletable={emp.contracts.length > 1}
                      fileCount={c.files.length}
                      department={emp.department}
                      schedule={emp.schedule}
                    />
                  </div>
                  <AttachmentBox
                    beginUrl={`/api/contracts/${c.id}/files`}
                    title="서명본 스캔"
                    files={c.files.map((f) => ({ ...f, uploadedAt: ymd(f.uploadedAt) }))}
                    emptyHint={
                      <>
                        서명·날인한 원본을 올려 두세요. 위 <b>계약서 발급</b>은 지금 조건으로 새로
                        뽑는 서식이라 조건을 고치면 함께 바뀌지만, 스캔본은 그대로 남습니다.
                      </>
                    }
                  />
                </li>
              ))}
              {emp.contracts.length === 0 && (
                <li className="text-sm text-slate-400">계약 이력이 없습니다.</li>
              )}
            </ul>
          </div>
        </div>

        {/* 우: 급여 + 문서 */}
        <div className="space-y-6">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-800">최근 급여</h2>
              <Link href="/payroll" className="text-xs text-brand-600 font-semibold">급여 산정 →</Link>
            </div>
            {emp.payrolls.length === 0 ? (
              <p className="text-sm text-slate-400">급여 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-2">
                {emp.payrolls.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.year}.{String(p.month).padStart(2, "0")}</span>
                    <span className="tnum font-semibold">{won(p.net)}원</span>
                    <Pill kind={p.status}>{PAYROLL_STATUS_LABEL[p.status] ?? p.status}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5">
            <h2 className="font-bold text-slate-800 mb-3">증명서 발급</h2>
            <div className="flex flex-col gap-2">
              <DocButton endpoint="/api/documents/cert" body={{ employeeId: id, type: "CERT_EMPLOYMENT" }} label="재직증명서" promptPurpose />
              <DocButton endpoint="/api/documents/cert" body={{ employeeId: id, type: "CERT_CAREER" }} label="경력증명서" promptPurpose />
              {/* 해촉증명서는 위탁계약(프리랜서) 전용 — 근로자에게 보이면 잘못 발급된다.
                  서버(genCertificate)도 같은 판정으로 다시 막는다. */}
              {isContractorContract(emp) && (
                <DocButton
                  endpoint="/api/documents/cert"
                  body={{ employeeId: id, type: "CERT_RELEASE" }}
                  label="해촉증명서"
                  promptPurpose
                />
              )}
            </div>
          </div>

          {emp.documents.length > 0 && (
            <div className="card p-5">
              <h2 className="font-bold text-slate-800 mb-3">발급 이력</h2>
              <ul className="text-xs space-y-1.5 text-slate-500">
                {emp.documents.map((d) => (
                  <li key={d.id} className="flex justify-between">
                    <span className="truncate">{d.title}</span>
                    <span className="text-slate-300 shrink-0 ml-2">{ymd(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 인사서류함 — 계약과 무관한 서류를 아무 형식이나 담아 둔다.
              계약 서명본과 **같은 업로드 기계**를 쓴다(조각내 올리기). */}
          <div className="card p-5">
            <AttachmentBox
              beginUrl={`/api/employees/${id}/files`}
              title="인사서류함"
              compact={false}
              files={emp.attachedFiles.map((f) => ({ ...f, uploadedAt: ymd(f.uploadedAt) }))}
              emptyHint={
                <>
                  서명받은 동의서·서약서, 자격증·통장 사본처럼 <b>이 직원에 관한 서류</b>를
                  형식 상관없이 올려 두세요. 계약서 서명본은 왼쪽 <b>계약 이력</b>의 해당 계약에
                  붙이면 어느 계약의 원본인지 함께 남습니다.
                </>
              }
            />
            <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
              파일당 50MB · 큰 파일은 자동으로 나눠 올라갑니다. PDF·JPG·PNG·WEBP 는 눌러서 바로
              열리고, 그 밖의 형식(hwp·docx 등)은 내려받아 봅니다.
            </p>
          </div>
        </div>
      </div>

      {/* 위험 구역 — 눈에 잘 안 띄는 맨 아래 구석에 둔다. 자주 쓸 버튼이 아니고,
          잘 보이는 자리에 두면 '정보 수정' 대신 눌리는 사고가 난다. */}
      <div className="mt-10 pt-4 border-t border-slate-100 text-right">
        <EmployeeDeleteButton employeeId={id} name={emp.name} />
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-slate-700 font-medium text-right">{children}</dd>
    </div>
  );
}
function Metric({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg py-3">
      <div className={`text-xl font-bold tnum ${accent ?? "text-slate-700"}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}
