"use client";

import React, { useEffect, useState, useCallback } from "react";
import { won } from "@/lib/format";
import { PAY_SCHEME_LABEL, INCOME_TYPE_LABEL, PAYROLL_STATUS_LABEL } from "@/lib/constants";
import { Pill } from "@/components/ui";

interface Rec {
  id: number;
  employeeId: number;
  year: number;
  month: number;
  incomeType: string;
  payScheme: string;
  gross: number;
  totalDeduct: number;
  net: number;
  incentiveP: number;
  bonusP: number;
  status: string;
  extraHours: number;
  overtimeHours: number;
  holidayHours: number;
  nightHours: number;
  studentCount: number | null;
  studentUnits: number | null;
  classRevenue: number | null;
  bonus: number;
  unusedLeaveDays: number;
  hourlyWage: number;
  deductMode: string;
  pensionD: number;
  employmentD: number;
  healthD: number;
  longTermD: number;
  incomeTaxD: number;
  localTaxD: number;
  retentionD: number;
  parkingD: number;
  expenseD: number;
  otherD: number;
  otherItems: string | null;
  prorationRatio: number;
  employee: { name: string; empNo: string; department: string | null; position: string | null };
}

const now = new Date();

/** 저장된 레코드 → 변동입력 폼 값 */
function rowInputsOf(r: Rec) {
  return {
    extraHours: r.extraHours || "",
    overtimeHours: r.overtimeHours || "",
    holidayHours: r.holidayHours || "",
    nightHours: r.nightHours || "",
    studentCount: r.studentCount ?? "",
    classRevenue: r.classRevenue ?? "",
    bonus: r.bonus || "",
    unusedLeaveDays: r.unusedLeaveDays || "",
  };
}

/** 변동입력 폼 값 → API 전송용 숫자 변환 */
function cleanRowInput(v: any) {
  return {
    extraHours: v.extraHours ? Number(v.extraHours) : 0,
    overtimeHours: v.overtimeHours ? Number(v.overtimeHours) : 0,
    holidayHours: v.holidayHours ? Number(v.holidayHours) : 0,
    nightHours: v.nightHours ? Number(v.nightHours) : 0,
    studentCount: v.studentCount !== "" && v.studentCount != null ? Number(v.studentCount) : null,
    classRevenue: v.classRevenue !== "" && v.classRevenue != null ? Number(v.classRevenue) : null,
    bonus: v.bonus ? Number(v.bonus) : 0,
    unusedLeaveDays: v.unusedLeaveDays ? Number(v.unusedLeaveDays) : 0,
  };
}

export default function PayrollClient() {
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [inputs, setInputs] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [openDedId, setOpenDedId] = useState<number | null>(null);
  const [tsResult, setTsResult] = useState<any>(null);
  const [incResult, setIncResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/payroll?year=${year}&month=${month}`);
    const data = res.ok ? await res.json() : [];
    setRecs(data);
    const map: Record<number, any> = {};
    data.forEach((r: Rec) => {
      map[r.employeeId] = rowInputsOf(r);
    });
    setInputs(map);
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function run() {
    setBusy("calc");
    const cleanInputs: Record<number, any> = {};
    for (const [id, v] of Object.entries(inputs)) {
      cleanInputs[Number(id)] = cleanRowInput(v);
    }
    await fetch("/api/payroll/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, inputs: cleanInputs }),
    });
    await load();
    setBusy("");
  }

  /** 한 직원만 변동입력 저장 + 재산정 (다른 행의 입력 중인 값은 유지) */
  async function saveRow(employeeId: number) {
    setBusy(`row-${employeeId}`);
    const res = await fetch("/api/payroll/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year,
        month,
        inputs: { [employeeId]: cleanRowInput(inputs[employeeId] ?? {}) },
        employeeIds: [employeeId],
      }),
    });
    if (!res.ok) {
      alert("저장 실패: " + ((await res.json().catch(() => ({}))).error || ""));
      setBusy("");
      return;
    }
    // 해당 행만 서버 값으로 갱신 — 다른 행에 입력해 둔 값은 지우지 않는다
    const r2 = await fetch(`/api/payroll?year=${year}&month=${month}`);
    const data: Rec[] = r2.ok ? await r2.json() : [];
    setRecs(data);
    const fresh = data.find((x) => x.employeeId === employeeId);
    if (fresh) setInputs((p) => ({ ...p, [employeeId]: rowInputsOf(fresh) }));
    setBusy("");
  }

  async function sendEmails() {
    if (!confirm(`${year}년 ${month}월 급여명세서를 이메일로 발송하시겠습니까?\n발송된 기록은 자동으로 잠기며(발송완료), 이후 재계산·공제 수정이 불가합니다.`)) return;
    setBusy("email");
    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month }),
    });
    const j = await res.json().catch(() => ({}));
    alert(
      res.ok
        ? `발송 완료: 성공 ${j.sent ?? 0}건 / 실패 ${j.failed ?? 0}건` +
          (j.skippedSent ? `\n(이미 발송되어 제외: ${j.skippedSent}건)` : "")
        : `발송 실패: ${j.error || "SMTP 설정을 확인하세요"}`
    );
    setBusy("");
    await load();
  }

  async function uploadTimesheet(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("ts");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("year", String(year));
    fd.append("month", String(month));
    const res = await fetch("/api/payroll/timesheet", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (res.ok) {
      setTsResult(j);
      // 파일에서 감지한 연·월로 화면 전환 (다르면 자동 재조회됨)
      if (j.year === year && j.month === month) await load();
      else {
        setYear(j.year);
        setMonth(j.month);
      }
    } else {
      alert(
        "업로드 실패: " + (j.error || "") +
        (j.unmatched?.length ? "\n\n[직원 카드 없음]\n" + j.unmatched.join(", ") : "") +
        (j.noRecords?.length ? "\n\n[해당 월 기록 없음]\n" + j.noRecords.join(", ") : "")
      );
    }
  }

  async function uploadIncentive(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("inc");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("year", String(year));
    fd.append("month", String(month));
    const res = await fetch("/api/payroll/incentive", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (res.ok) {
      setIncResult(j);
      if (j.year === year && j.month === month) await load();
      else {
        setYear(j.year);
        setMonth(j.month);
      }
    } else {
      alert("업로드 실패: " + (j.error || ""));
    }
  }

  function openPayslip(id: number) {
    fetch("/api/documents/payslip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payrollId: id }),
    }).then(async (res) => {
      if (!res.ok) return alert("생성 실패: " + (await res.text()));
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    });
  }

  const setInput = (id: number, k: string, v: any) =>
    setInputs((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));

  const totalNet = recs.reduce((s, r) => s + r.net, 0);
  const totalGross = recs.reduce((s, r) => s + r.gross, 0);

  return (
    <div>
      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select className="input w-24" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
        <button className="btn-primary" onClick={run} disabled={!!busy}>
          {busy === "calc" ? "산정 중…" : "급여 일괄 산정"}
        </button>
        <label className={`btn-outline cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          {busy === "ts" ? "처리 중…" : "📤 시간기록표 업로드"}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={uploadTimesheet} />
        </label>
        <label className={`btn-outline cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          {busy === "inc" ? "처리 중…" : "📤 인센티브 명단 업로드"}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={uploadIncentive} />
        </label>
        <div className="flex-1" />
        {recs.length > 0 && (
          <button className="btn-outline" onClick={sendEmails} disabled={!!busy}>
            {busy === "email" ? "발송 중…" : "명세서 이메일 발송"}
          </button>
        )}
      </div>

      {tsResult && (
        <div className="card p-4 mb-5 border-emerald-200 bg-emerald-50/40">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-emerald-800 text-sm">
              ✅ 시간기록표 반영 완료 — {tsResult.year}년 {tsResult.month}월
              {tsResult.periodDetected && <span className="font-normal text-emerald-600"> (파일에서 자동 감지)</span>}
              {" "}· {tsResult.matched.length}명
            </span>
            <button className="text-xs text-slate-400" onClick={() => setTsResult(null)}>닫기 ✕</button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left py-1">직원</th>
                <th className="text-right">근무일</th>
                <th className="text-right">체류</th>
                <th className="text-right">순 근로</th>
                <th className="text-right">연차</th>
                <th className="text-right">산정시간</th>
                <th className="text-right">주휴시간</th>
                <th className="text-left pl-3">휴게 30분</th>
                <th className="text-left">주별 주휴 판정</th>
              </tr>
            </thead>
            <tbody>
              {tsResult.matched.map((m: any) => (
                <tr key={m.employeeId} className="border-t border-emerald-100">
                  <td className="py-1 font-semibold">{m.name}</td>
                  <td className="text-right tnum">{m.workedDays}일</td>
                  <td className="text-right tnum text-slate-500">{fmtHM(m.stayHours)}</td>
                  <td className="text-right tnum">{fmtHM(m.netHours)}</td>
                  <td className="text-right tnum text-slate-500">
                    {m.leaveHours ? `${fmtHM(m.leaveHours)} (${m.leaveDays}일)` : "-"}
                  </td>
                  <td className="text-right tnum font-semibold">{fmtHM(m.workHours)}</td>
                  <td className="text-right tnum font-semibold">{m.weeklyHolidayHours ? fmtHM(m.weeklyHolidayHours) : "-"}</td>
                  <td className="pl-3">{m.breakPaid ? "유급(그대로)" : "무급(−30분/일)"}</td>
                  <td className="text-slate-500">
                    {m.noSchedule && (
                      <div className="text-amber-700 mb-0.5">
                        ⚠️ 근로시간표 없음 — 개근 여부를 판정하지 못해 실근로 기준으로 갈음했습니다
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {m.weeks.map((w: any) => (
                        <div key={w.weekStart}>
                          <span className="tnum">{w.weekStart.slice(5)}~{w.weekEnd.slice(5)}</span>{" "}
                          <span className="tnum">
                            {w.requiredDays > 0 ? `${w.attendedDays}/${w.requiredDays}일` : fmtHM(w.hours)}
                          </span>{" "}
                          {w.qualified ? (
                            w.carriedToNextMonth ? (
                              <span className="text-slate-400">
                                주휴 {fmtHM(w.holidayHours)} → 다음 달에 반영
                              </span>
                            ) : (
                              <span className="text-emerald-700 font-semibold">
                                ✓ 주휴 {fmtHM(w.holidayHours)}
                              </span>
                            )
                          ) : (
                            <span className="text-slate-400">✕ {w.reason}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tsResult.unmatched?.length > 0 && (
            <p className="text-xs text-amber-700 mt-2">
              ⚠️ <b>직원 카드 없음</b>: {tsResult.unmatched.join(", ")} — 직원 관리에서 시급제로 등록하면 다음 업로드부터 자동 반영됩니다.
            </p>
          )}
          {tsResult.noRecords?.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              ℹ️ 해당 월 기록 없음: {tsResult.noRecords.join(", ")}
            </p>
          )}
        </div>
      )}

      {incResult && (
        <div className="card p-4 mb-5 border-indigo-200 bg-indigo-50/40">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-indigo-900 text-sm">
              ✅ 인센티브 명단 반영 — {incResult.year}년 {incResult.month}월 · {incResult.name} 선생님
            </span>
            <button className="text-xs text-slate-400" onClick={() => setIncResult(null)}>닫기 ✕</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-2">
            <Stat k="학생 인원" v={`총 ${incResult.totalCount}명 (만근 ${incResult.fullCount} · 중도 ${incResult.partialCount})`} />
            <Stat k="가중 인원" v={`${Number(incResult.units).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}명`} />
            <Stat k="기준 초과" v={`${Number(incResult.over).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}명 (기준 ${incResult.threshold}명)`} />
            <Stat k="인센티브" v={`${won(incResult.amount)}원`} accent />
          </div>
          <p className="text-[11px] text-slate-500 mb-2">
            1인당 기준금액 {won(incResult.perStudent)}원 · 1회당 {won(incResult.perSession)}원 (÷8회 만근 기준)
            {incResult.monthlyPayInFile && incResult.monthlyPayInFile !== incResult.baseWage && (
              <span className="text-amber-700 font-semibold">
                {" "}· ⚠️ 파일의 월급여({won(incResult.monthlyPayInFile)}원)와 직원 카드 기본급({won(incResult.baseWage)}원)이 다릅니다
              </span>
            )}
          </p>
          {incResult.partials?.length > 0 && (
            <div className="text-xs text-slate-600 max-h-40 overflow-y-auto">
              <table className="w-full">
                <thead className="text-slate-400">
                  <tr><th className="text-left py-0.5">학생</th><th className="text-left">상태</th><th className="text-right">회차</th><th className="text-right">계수</th><th className="text-right">인센티브</th></tr>
                </thead>
                <tbody>
                  {incResult.partials.map((p: any, i: number) => (
                    <tr key={i} className="border-t border-indigo-100">
                      <td className="py-0.5">{p.name}</td>
                      <td>{p.status === "WITHDRAWN" ? "퇴원" : p.status === "TRANSFERRED" ? "전출" : "재원"}</td>
                      <td className="text-right tnum">{p.sessions == null ? "만근" : `${p.sessions}회`}</td>
                      <td className="text-right tnum">{p.weight}</td>
                      <td className="text-right tnum font-semibold">{won(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {recs.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="card p-4"><div className="text-xs text-slate-500">지급 인원</div><div className="stat-num">{recs.length}명</div></div>
          <div className="card p-4"><div className="text-xs text-slate-500">지급총액</div><div className="stat-num">{won(totalGross)}원</div></div>
          <div className="card p-4"><div className="text-xs text-slate-500">실지급액</div><div className="stat-num text-brand-600">{won(totalNet)}원</div></div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="text-center text-slate-400 py-12">불러오는 중…</div>
        ) : recs.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            {year}년 {month}월 급여 기록이 없습니다. <b>급여 일괄 산정</b>을 눌러 계산하세요.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">직원</th>
                <th className="th">형태</th>
                <th className="th">변동입력</th>
                <th className="th text-right">지급액</th>
                <th className="th text-right">공제액</th>
                <th className="th text-right">실수령</th>
                <th className="th">상태</th>
                <th className="th">명세서</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => (
                <React.Fragment key={r.id}>
                <tr className="hover:bg-slate-50">
                  <td className="td">
                    <div className="font-semibold">{r.employee.name}</div>
                    <div className="text-xs text-slate-400">{r.employee.department} {r.employee.position}</div>
                    {r.prorationRatio < 1 && (r.payScheme === "MONTHLY" || r.payScheme === "INCENTIVE") && (
                      <div className="text-[10px] text-amber-600 mt-0.5">일할 {(r.prorationRatio * 100).toFixed(0)}%</div>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex flex-col items-start gap-1">
                      <Pill kind={r.payScheme}>{PAY_SCHEME_LABEL[r.payScheme]}</Pill>
                      <Pill kind={r.incomeType}>{r.incomeType === "FREELANCE" ? "사업소득" : "근로소득"}</Pill>
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {r.payScheme === "INCENTIVE" &&
                        (r.studentUnits != null ? (
                          <span
                            className="text-[11px] bg-indigo-50 text-indigo-700 rounded px-2 py-1 self-end"
                            title="인센티브 명단(회차 비례) 기준 가중 인원 — 명단 업로드로 자동 산정됩니다"
                          >
                            명단 {Number(r.studentUnits).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}명
                          </span>
                        ) : (
                          <InlineInput label="학생수" value={inputs[r.employeeId]?.studentCount ?? ""} onChange={(v) => setInput(r.employeeId, "studentCount", v)} />
                        ))}
                      {r.payScheme === "RATIO" && (
                        <InlineInput label="매출" value={inputs[r.employeeId]?.classRevenue ?? ""} onChange={(v) => setInput(r.employeeId, "classRevenue", v)} wide />
                      )}
                      <InlineInput label="추가h" value={inputs[r.employeeId]?.extraHours ?? ""} onChange={(v) => setInput(r.employeeId, "extraHours", v)} />
                      <InlineInput label="연장h" value={inputs[r.employeeId]?.overtimeHours ?? ""} onChange={(v) => setInput(r.employeeId, "overtimeHours", v)} />
                      <InlineInput label="휴일h" value={inputs[r.employeeId]?.holidayHours ?? ""} onChange={(v) => setInput(r.employeeId, "holidayHours", v)} />
                      <InlineInput label="야간h" value={inputs[r.employeeId]?.nightHours ?? ""} onChange={(v) => setInput(r.employeeId, "nightHours", v)} />
                      <InlineInput label="상여" value={inputs[r.employeeId]?.bonus ?? ""} onChange={(v) => setInput(r.employeeId, "bonus", v)} wide />
                      <InlineInput label="미사용연차(일)" value={inputs[r.employeeId]?.unusedLeaveDays ?? ""} onChange={(v) => setInput(r.employeeId, "unusedLeaveDays", v)} />
                      <button
                        className="btn-primary py-1 px-2.5 text-xs self-end disabled:opacity-40"
                        disabled={!!busy || r.status === "SENT"}
                        title={r.status === "SENT" ? "명세서가 발송된 기록은 잠겨 있어 재계산되지 않습니다" : "이 직원만 저장하고 재산정"}
                        onClick={() => saveRow(r.employeeId)}
                      >
                        {busy === `row-${r.employeeId}` ? "저장 중…" : "저장"}
                      </button>
                    </div>
                  </td>
                  <td className="td text-right tnum">{won(r.gross)}</td>
                  <td className="td text-right">
                    <button
                      className="tnum text-slate-600 underline decoration-dotted underline-offset-2 hover:text-brand-600"
                      onClick={() => setOpenDedId(openDedId === r.id ? null : r.id)}
                      title="공제 편집"
                    >
                      {won(r.totalDeduct)}
                    </button>
                    <div className={`text-[10px] ${r.deductMode === "AUTO" ? "text-emerald-600" : "text-amber-600"}`}>
                      {r.deductMode === "AUTO" ? "자동" : "수동"} ▾
                    </div>
                  </td>
                  <td className="td text-right tnum font-bold">{won(r.net)}</td>
                  <td className="td"><Pill kind={r.status}>{PAYROLL_STATUS_LABEL[r.status] ?? r.status}</Pill></td>
                  <td className="td">
                    <button className="text-xs text-brand-600 font-semibold" onClick={() => openPayslip(r.id)}>PDF</button>
                  </td>
                </tr>
                {openDedId === r.id && (
                  <tr>
                    <td colSpan={8} className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                      <DeductionEditor rec={r} onSaved={async () => { setOpenDedId(null); await load(); }} onClose={() => setOpenDedId(null)} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {recs.length > 0 && (
        <div className="text-xs text-slate-400 mt-3 space-y-1">
          <p>
            ※ 변동입력은 각 행의 <b>저장</b> 버튼(해당 직원만 즉시 반영) 또는 상단 <b>급여 일괄 산정</b>(전체 반영)으로 저장·재계산됩니다.
            명세서 <b>이메일 발송이 완료된 기록은 자동으로 잠겨</b>(발송완료) 재계산·공제 수정이 되지 않으며, 재발송 시에도 제외됩니다.
          </p>
          <p>
            · <b>추가h</b>: 평일 소정근로 외·토요일 근무 중 <b>1일 8h·주 40h 이내</b>(법내연장) → 가산 없음(통상시급×1.0) &nbsp;
            · <b>연장h</b>: 1일 8시간·주 40시간 <b>초과분</b> → 연장근로수당(×1.5)
          </p>
          <p>
            · <b>휴일h</b>: 일요일(주휴일)·공휴일 근무시간 → 휴일근로수당(×1.5) &nbsp;
            · <b>야간h</b>: 22시~06시 근무시간 → 야간가산(+0.5)
          </p>
          <p>
            · <b>주휴수당(시급제)</b>: ① 주 소정근로 15시간 이상 ② <b>그 주 근무일수를 채움(개근)</b>
            ③ 1주(월~일) 근로관계 존속 — 셋을 모두 갖춘 주에만 발생한다 (근로기준법 §55·시행령 §30).
            개근은 <b>요일이 아니라 일수</b>로 본다 — 계약 주3일이면 어느 요일이든 3일 이상 나오면 개근.
            연차 사용일은 출근으로 세고, 그 주 공휴일수만큼 채울 일수가 줄어든다. 지각·조퇴는 결근이 아니다.
            주휴일(일요일) 전에 퇴사하면 그 주는 미발생.
          </p>
          <p>
            · <b>체류 / 순 근로 / 산정시간</b>: 체류는 출근~퇴근 기록 그대로, 순 근로는 휴게 30분을 뺀 시간.
            급여는 휴게가 <b>유급이면 체류</b>, <b>무급이면 순 근로</b> 기준으로 산정하며, 여기에
            <b>연차 유급시간</b>(연차 일수 × 1일 소정근로시간)을 더한 것이 산정시간이다.
          </p>
          <p>
            · <b>상여</b>: 특별상여 금액(원) &nbsp;
            · <b>미사용연차(일)</b>: 소멸 예정 연차를 수당으로 정산할 일수 — 연차미사용수당 = 일수 × 통상시급 × 8시간
          </p>
          <p>
            · <b>공제</b>: 공제액 숫자를 클릭하면 편집창이 열립니다. 기본은 <b>수동입력</b>(세무사 지정값)이며,
            "자동 산출"로 전환하면 4대보험·간이세액표 기준으로 자동 계산됩니다.
            퇴직유보금(인센티브×8.3%)·주차비·실비(±)·기타공제도 편집창에서 입력합니다.
            &nbsp;· 월중 입·퇴사자는 <b>일할계산</b>이 자동 적용됩니다.
          </p>
        </div>
      )}
    </div>
  );
}

interface OtherItem {
  name: string;
  amount: string; // 입력 중 문자열 유지
}

function parseOtherItems(rec: Rec): OtherItem[] {
  try {
    const arr = rec.otherItems ? JSON.parse(rec.otherItems) : null;
    if (Array.isArray(arr) && arr.length) {
      return arr.map((it: any) => ({ name: String(it.name ?? ""), amount: String(it.amount ?? 0) }));
    }
  } catch {}
  // 과거 데이터: 합계만 있으면 단일 항목으로 노출
  return rec.otherD ? [{ name: "기타공제", amount: String(rec.otherD) }] : [];
}

function DeductionEditor({ rec, onSaved, onClose }: { rec: Rec; onSaved: () => Promise<void>; onClose: () => void }) {
  const [mode, setMode] = useState<string>(rec.deductMode || "MANUAL");
  const [f, setF] = useState({
    pensionD: rec.pensionD || "",
    healthD: rec.healthD || "",
    longTermD: rec.longTermD || "",
    employmentD: rec.employmentD || "",
    incomeTaxD: rec.incomeTaxD || "",
    localTaxD: rec.localTaxD || "",
    retentionD: rec.retentionD || "",
    parkingD: rec.parkingD || "",
    expenseD: rec.expenseD || "",
  });
  const [items, setItems] = useState<OtherItem[]>(() => parseOtherItems(rec));
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const setItem = (i: number, k: keyof OtherItem, v: string) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const otherSum = items.reduce((a, it) => a + (Number(it.amount) || 0), 0);

  async function save(nextMode: string) {
    setSaving(true);
    const body: any = { deductMode: nextMode };
    for (const [k, v] of Object.entries(f)) body[k] = v === "" ? 0 : Number(v);
    body.otherItems = items
      .map((it) => ({ name: it.name.trim(), amount: Number(it.amount) || 0 }))
      .filter((it) => it.name !== "" || it.amount !== 0);
    const res = await fetch(`/api/payroll/${rec.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) await onSaved();
    else alert("저장 실패: " + ((await res.json().catch(() => ({}))).error || ""));
  }

  const isFree = rec.incomeType === "FREELANCE";
  const manual = mode === "MANUAL";

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm font-bold text-slate-700">{rec.employee.name} — 공제 편집</span>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="radio" checked={manual} onChange={() => setMode("MANUAL")} /> 수동입력(세무사 값)
        </label>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="radio" checked={!manual} onChange={() => setMode("AUTO")} /> 자동 산출
        </label>
        <div className="flex-1" />
        <button className="btn-ghost py-1 px-2.5 text-xs" onClick={onClose}>닫기</button>
        <button className="btn-primary py-1 px-3 text-xs" disabled={saving} onClick={() => save(mode)}>
          {saving ? "저장 중…" : manual ? "저장" : "자동 산출 적용"}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {!isFree && (
          <>
            <DedField label="국민연금" v={f.pensionD} onChange={(v) => set("pensionD", v)} disabled={!manual} />
            <DedField label="건강보험" v={f.healthD} onChange={(v) => set("healthD", v)} disabled={!manual} />
            <DedField label="장기요양" v={f.longTermD} onChange={(v) => set("longTermD", v)} disabled={!manual} />
            <DedField label="고용보험" v={f.employmentD} onChange={(v) => set("employmentD", v)} disabled={!manual} />
          </>
        )}
        <DedField label={isFree ? "소득세(3%)" : "근로소득세"} v={f.incomeTaxD} onChange={(v) => set("incomeTaxD", v)} disabled={!manual} />
        <DedField label="지방소득세" v={f.localTaxD} onChange={(v) => set("localTaxD", v)} disabled={!manual} />
        {rec.payScheme === "INCENTIVE" && (
          <DedField label="퇴직유보금(8.3%)" v={f.retentionD} onChange={(v) => set("retentionD", v)} />
        )}
        <DedField label="주차비 공제" v={f.parkingD} onChange={(v) => set("parkingD", v)} />
        <DedField label="실비 정산(±)" v={f.expenseD} onChange={(v) => set("expenseD", v)} allowNegative />
      </div>
      {/* 기타공제 — 이름을 직접 기입하는 항목 리스트 */}
      <div className="mt-2 border border-slate-200 rounded-lg p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-slate-500">기타공제 항목</span>
          {items.length > 0 && (
            <span className="text-[11px] text-slate-500 tnum">
              합계 <b>{otherSum.toLocaleString()}원</b>
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input py-1 text-xs flex-1"
                placeholder="공제 이름 (예: 가불 상환, 동호회비)"
                value={it.name}
                onChange={(e) => setItem(i, "name", e.target.value)}
              />
              <input
                type="number"
                step={10}
                className="input py-1 text-xs w-36"
                placeholder="금액(원)"
                value={it.amount}
                onChange={(e) => setItem(i, "amount", e.target.value)}
              />
              <button
                type="button"
                className="text-slate-400 hover:text-red-500 text-sm px-1"
                title="항목 삭제"
                onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-brand-600 font-semibold"
            onClick={() => setItems((arr) => [...arr, { name: "", amount: "" }])}
          >
            + 항목 추가
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        {manual
          ? "수동입력: 4대보험·소득세는 세무사 지정값을 입력하세요. 저장 시 실수령액이 재계산됩니다."
          : "자동 산출: 4대보험·소득세를 요율·간이세액표로 재계산합니다. 회색 칸은 자동으로 채워집니다."}
        &nbsp;실비 정산은 음수(-) 입력 시 환급(지급 증가)으로 처리됩니다.
        {rec.payScheme === "INCENTIVE" && " 퇴직유보금 기본값은 인센티브 원천액의 8.3%입니다(확인서 기준)."}
      </p>
    </div>
  );
}

function DedField({ label, v, onChange, disabled, allowNegative }: { label: string; v: any; onChange: (v: string) => void; disabled?: boolean; allowNegative?: boolean }) {
  return (
    <label className="text-[11px] text-slate-500">
      {label}
      <input
        type="number"
        step={10}
        min={allowNegative ? undefined : 0}
        className={`input py-1 mt-0.5 text-xs ${disabled ? "bg-slate-100 text-slate-400" : ""}`}
        value={v}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="bg-white/70 rounded-lg px-2.5 py-1.5">
      <div className="text-[10px] text-slate-400">{k}</div>
      <div className={`font-semibold tnum ${accent ? "text-indigo-700" : "text-slate-700"}`}>{v}</div>
    </div>
  );
}

function fmtHM(n: number): string {
  let h = Math.floor(n);
  let m = Math.round((n - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

function InlineInput({ label, value, onChange, wide }: { label: string; value: any; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <label className="inline-flex items-center gap-1 text-[10px] text-slate-400">
      {label}
      <input
        className={`border border-slate-200 rounded px-1 py-0.5 text-xs ${wide ? "w-20" : "w-12"}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
