"use client";

import React, { useEffect, useState, useCallback } from "react";
import { won } from "@/lib/format";
import { PAY_SCHEME_LABEL, INCOME_TYPE_LABEL } from "@/lib/constants";
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
  prorationRatio: number;
  employee: { name: string; empNo: string; department: string | null; position: string | null };
}

const now = new Date();

export default function PayrollClient() {
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [inputs, setInputs] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [openDedId, setOpenDedId] = useState<number | null>(null);
  const [tsResult, setTsResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/payroll?year=${year}&month=${month}`);
    const data = res.ok ? await res.json() : [];
    setRecs(data);
    const map: Record<number, any> = {};
    data.forEach((r: Rec) => {
      map[r.employeeId] = {
        extraHours: r.extraHours || "",
        overtimeHours: r.overtimeHours || "",
        holidayHours: r.holidayHours || "",
        nightHours: r.nightHours || "",
        studentCount: r.studentCount ?? "",
        classRevenue: r.classRevenue ?? "",
        bonus: r.bonus || "",
        unusedLeaveDays: r.unusedLeaveDays || "",
      };
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
      cleanInputs[Number(id)] = {
        extraHours: v.extraHours ? Number(v.extraHours) : 0,
        overtimeHours: v.overtimeHours ? Number(v.overtimeHours) : 0,
        holidayHours: v.holidayHours ? Number(v.holidayHours) : 0,
        nightHours: v.nightHours ? Number(v.nightHours) : 0,
        studentCount: v.studentCount !== "" ? Number(v.studentCount) : null,
        classRevenue: v.classRevenue !== "" ? Number(v.classRevenue) : null,
        bonus: v.bonus ? Number(v.bonus) : 0,
        unusedLeaveDays: v.unusedLeaveDays ? Number(v.unusedLeaveDays) : 0,
      };
    }
    await fetch("/api/payroll/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, inputs: cleanInputs }),
    });
    await load();
    setBusy("");
  }

  async function confirmAll() {
    setBusy("confirm");
    await Promise.all(
      recs.filter((r) => r.status === "DRAFT").map((r) =>
        fetch(`/api/payroll/${r.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "CONFIRMED" }),
        })
      )
    );
    await load();
    setBusy("");
  }

  async function sendEmails() {
    if (!confirm(`${year}년 ${month}월 급여명세서를 전 직원 이메일로 발송하시겠습니까?`)) return;
    setBusy("email");
    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month }),
    });
    const j = await res.json().catch(() => ({}));
    alert(res.ok ? `발송 완료: 성공 ${j.sent ?? 0}건 / 실패 ${j.failed ?? 0}건` : `발송 실패: ${j.error || "SMTP 설정을 확인하세요"}`);
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
        <div className="flex-1" />
        {recs.length > 0 && (
          <>
            <button className="btn-outline" onClick={confirmAll} disabled={!!busy}>전체 확정</button>
            <button className="btn-outline" onClick={sendEmails} disabled={!!busy}>
              {busy === "email" ? "발송 중…" : "명세서 이메일 발송"}
            </button>
          </>
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
                <th className="text-right">실근로</th>
                <th className="text-right">주휴시간</th>
                <th className="text-left pl-3">휴게 30분</th>
                <th className="text-left">주별 (15h 초과 ✓)</th>
              </tr>
            </thead>
            <tbody>
              {tsResult.matched.map((m: any) => (
                <tr key={m.employeeId} className="border-t border-emerald-100">
                  <td className="py-1 font-semibold">{m.name}</td>
                  <td className="text-right tnum">{m.workedDays}일</td>
                  <td className="text-right tnum">{fmtHM(m.workHours)}</td>
                  <td className="text-right tnum font-semibold">{m.weeklyHolidayHours ? fmtHM(m.weeklyHolidayHours) : "-"}</td>
                  <td className="pl-3">{m.breakPaid ? "유급(그대로)" : "무급(−30분/일)"}</td>
                  <td className="text-slate-500">
                    {m.weeks.map((w: any) => `${w.weekStart.slice(5)}주 ${fmtHM(w.hours)}${w.qualified ? "✓" : ""}`).join(" · ")}
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
                    {r.prorationRatio < 1 && (
                      <div className="text-[10px] text-amber-600 mt-0.5">일할 {(r.prorationRatio * 100).toFixed(0)}%</div>
                    )}
                  </td>
                  <td className="td"><Pill kind={r.payScheme}>{PAY_SCHEME_LABEL[r.payScheme]}</Pill></td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {r.payScheme === "INCENTIVE" && (
                        <InlineInput label="학생수" value={inputs[r.employeeId]?.studentCount ?? ""} onChange={(v) => setInput(r.employeeId, "studentCount", v)} />
                      )}
                      {r.payScheme === "RATIO" && (
                        <InlineInput label="매출" value={inputs[r.employeeId]?.classRevenue ?? ""} onChange={(v) => setInput(r.employeeId, "classRevenue", v)} wide />
                      )}
                      <InlineInput label="추가h" value={inputs[r.employeeId]?.extraHours ?? ""} onChange={(v) => setInput(r.employeeId, "extraHours", v)} />
                      <InlineInput label="연장h" value={inputs[r.employeeId]?.overtimeHours ?? ""} onChange={(v) => setInput(r.employeeId, "overtimeHours", v)} />
                      <InlineInput label="휴일h" value={inputs[r.employeeId]?.holidayHours ?? ""} onChange={(v) => setInput(r.employeeId, "holidayHours", v)} />
                      <InlineInput label="야간h" value={inputs[r.employeeId]?.nightHours ?? ""} onChange={(v) => setInput(r.employeeId, "nightHours", v)} />
                      <InlineInput label="상여" value={inputs[r.employeeId]?.bonus ?? ""} onChange={(v) => setInput(r.employeeId, "bonus", v)} wide />
                      <InlineInput label="미사용연차(일)" value={inputs[r.employeeId]?.unusedLeaveDays ?? ""} onChange={(v) => setInput(r.employeeId, "unusedLeaveDays", v)} />
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
                  <td className="td"><Pill kind={r.status}>{r.status}</Pill></td>
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
            ※ 변동입력을 수정한 뒤 <b>급여 일괄 산정</b>을 다시 누르면 반영됩니다. 확정(CONFIRMED)된 기록은 재계산되지 않습니다.
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
    otherD: rec.otherD || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save(nextMode: string) {
    setSaving(true);
    const body: any = { deductMode: nextMode };
    for (const [k, v] of Object.entries(f)) body[k] = v === "" ? 0 : Number(v);
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
        <DedField label="기타공제" v={f.otherD} onChange={(v) => set("otherD", v)} />
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
