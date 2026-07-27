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
  PAY_SCHEME_LABEL,
  CONTRACT_STAGE_LABEL,
  PAYROLL_STATUS_LABEL,
  parseSchedule,
  DAY_KO,
} from "@/lib/constants";
import { won, wonUnit, ymd } from "@/lib/format";
import { governingContract, contractIssues, paySchemeOf } from "@/lib/contracts";
import ContractIssueNotice from "@/components/ContractIssueNotice";

export const dynamic = "force-dynamic";

export default async function EmployeeDetail({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const emp = await prisma.employee.findUnique({
    where: { id },
    include: {
      contracts: { orderBy: { startDate: "desc" } },
      payrolls: { orderBy: [{ year: "desc" }, { month: "desc" }], take: 6 },
      documents: { orderBy: { createdAt: "desc" }, take: 6 },
    },
  });
  if (!emp) notFound();

  const { summary, comp } = await leaveSummaryFor(id);
  const sched = parseSchedule(emp.schedule);

  // 보수조건은 계약이 정한다 — 카드는 '오늘 시점 지배 계약' 을 비추는 읽기 전용 뷰
  const now = new Date();
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
        ratioPercent: gov.ratioPercent,
        incomeType: gov.incomeType ?? emp.incomeType,
      }
    : {
        payScheme: emp.payScheme,
        baseWage: emp.baseWage,
        positionAllow: emp.positionAllow,
        mealAllow: emp.mealAllow,
        carAllow: emp.carAllow,
        incThreshold: emp.incThreshold,
        incPerStudent: emp.incPerStudent,
        ratioPercent: emp.ratioPercent,
        incomeType: emp.incomeType,
      };
  const isMonthlyScheme = terms.payScheme === "MONTHLY" || terms.payScheme === "INCENTIVE";
  const upcoming = emp.contracts
    .filter((c) => c.startDate > now)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

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
              <Row k="급여형태"><Pill kind={emp.payScheme}>{PAY_SCHEME_LABEL[emp.payScheme]}</Pill></Row>
              <Row k="입사일">{ymd(emp.hireDate)}</Row>
              <Row k="재직상태">{emp.active ? "재직중" : `퇴직 (${ymd(emp.resignDate)})`}</Row>
              <Row k="연락처">{emp.phone ?? "-"}</Row>
              <Row k="이메일">{emp.email ?? "-"}</Row>
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
              <Row k="급여형태">{PAY_SCHEME_LABEL[terms.payScheme] ?? terms.payScheme}</Row>
              {terms.payScheme === "RATIO" ? (
                <Row k="위탁비율">{((terms.ratioPercent ?? 0) * 100).toFixed(1)}%</Row>
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
              {isMonthlyScheme && (
                <Row k="총 지급액">
                  <b>{wonUnit(terms.baseWage + terms.positionAllow)}</b>
                </Row>
              )}
              {terms.payScheme === "INCENTIVE" && (
                <Row k="인센티브">학생 {terms.incThreshold}명 초과 시 1명당 {won(terms.incPerStudent)}원</Row>
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
          {emp.payScheme === "RATIO" ? (
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
              <Link href="/leave" className="text-xs text-brand-600 font-semibold">관리 →</Link>
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
                  ratioPercent: emp.ratioPercent,
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
                    <Pill kind={c.status}>{c.status}</Pill>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {ymd(c.startDate)} ~ {c.endDate ? ymd(c.endDate) : "기한 없음"}
                    {c.isProbation && " · 수습 2개월"}
                    {c.note ? ` · ${c.note}` : ""}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 tnum">
                    {PAY_SCHEME_LABEL[paySchemeOf(c.templateKey)]} ·{" "}
                    {c.templateKey === "RATIO"
                      ? `위탁 ${((c.ratioPercent ?? 0) * 100).toFixed(1)}%`
                      : `${wonUnit(c.baseWage)}`}
                    {c.mealAllow > 0 && ` · 식대 ${wonUnit(c.mealAllow)}`}
                    {c.positionAllow > 0 && ` · 직책 ${wonUnit(c.positionAllow)}`}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <DocButton endpoint="/api/documents/contract" body={{ contractId: c.id }} label="계약서 발급" className="text-xs text-brand-600 font-semibold" />
                    <ContractEditForm
                      contract={{
                        id: c.id,
                        stage: c.stage,
                        startDate: c.startDate.toISOString().slice(0, 10),
                        endDate: c.endDate ? c.endDate.toISOString().slice(0, 10) : "",
                        isProbation: c.isProbation,
                        payScheme: paySchemeOf(c.templateKey),
                        incomeType: c.incomeType ?? emp.incomeType,
                        baseWage: c.baseWage,
                        positionAllow: c.positionAllow,
                        mealAllow: c.mealAllow,
                        carAllow: c.carAllow,
                        incThreshold: c.incThreshold,
                        incPerStudent: c.incPerStudent,
                        ratioPercent: c.ratioPercent,
                        note: c.note ?? "",
                      }}
                      deletable={emp.contracts.length > 1}
                    />
                  </div>
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
        </div>
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
