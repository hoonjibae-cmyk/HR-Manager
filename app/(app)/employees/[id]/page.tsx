import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { leaveSummaryFor } from "@/lib/repo";
import { PageHeader, Pill } from "@/components/ui";
import DocButton from "@/components/DocButton";
import NewContractForm from "@/components/NewContractForm";
import {
  INCOME_TYPE_LABEL,
  PAY_SCHEME_LABEL,
  CONTRACT_STAGE_LABEL,
  parseSchedule,
  DAY_KO,
} from "@/lib/constants";
import { won, wonUnit, ymd } from "@/lib/format";

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
            <h2 className="font-bold text-slate-800 mb-3">임금</h2>
            <dl className="text-sm space-y-2">
              {emp.payScheme === "RATIO" ? (
                <Row k="위탁비율">{((emp.ratioPercent ?? 0) * 100).toFixed(1)}%</Row>
              ) : (
                <Row k={emp.payScheme === "HOURLY" ? "시급" : "월 기본급"}>{wonUnit(emp.baseWage)}</Row>
              )}
              {emp.payScheme === "HOURLY" && (
                <Row k="휴게 30분">
                  {emp.breakPaid ? (
                    <span className="text-emerald-600">유급 (기록 그대로 인정)</span>
                  ) : (
                    <span className="text-slate-500">무급 (일별 30분 차감)</span>
                  )}
                </Row>
              )}
              {emp.positionAllow > 0 && <Row k="직책수당">{wonUnit(emp.positionAllow)}</Row>}
              {emp.mealAllow > 0 && <Row k="식대(비과세)">{wonUnit(emp.mealAllow)}</Row>}
              {emp.carAllow > 0 && <Row k="차량유지비">{wonUnit(emp.carAllow)}</Row>}
              {emp.payScheme === "INCENTIVE" && (
                <Row k="인센티브">학생 {emp.incThreshold}명 초과 시 1명당 {won(emp.incPerStudent)}원</Row>
              )}
            </dl>
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
            <div className="grid grid-cols-3 gap-3 text-center">
              <Metric label="발생" value={summary.granted} />
              <Metric label="사용" value={summary.used} />
              <Metric label="잔여" value={summary.remaining} accent="text-brand-600" />
            </div>
            <div className="text-xs text-slate-400 mt-3 space-y-0.5">
              <div>근속: {summary.serviceLabel}</div>
              {summary.expired > 0 && <div>소멸: {summary.expired}일</div>}
              {summary.nextGrantDate && (
                <div>다음 발생: {ymd(summary.nextGrantDate)} ({summary.nextGrantDays}일)</div>
              )}
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

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-800">계약 이력</h2>
            </div>
            <div className="mb-3">
              <NewContractForm
                emp={{
                  id: emp.id,
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
                <li key={c.id} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{CONTRACT_STAGE_LABEL[c.stage]}</span>
                    <Pill kind={c.status}>{c.status}</Pill>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {ymd(c.startDate)} ~ {c.endDate ? ymd(c.endDate) : "기한 미기재(공란)"}
                    {c.isProbation && " · 수습 2개월"}
                    {c.note ? ` · ${c.note}` : ""}
                  </div>
                  <div className="mt-2">
                    <DocButton endpoint="/api/documents/contract" body={{ contractId: c.id }} label="계약서 발급" className="text-xs text-brand-600 font-semibold" />
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
                    <Pill kind={p.status}>{p.status}</Pill>
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
