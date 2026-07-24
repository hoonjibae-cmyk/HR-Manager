"use client";

import { useEffect, useState, useCallback } from "react";
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
  overtimeHours: number;
  studentCount: number | null;
  classRevenue: number | null;
  bonus: number;
  unusedLeaveDays: number;
  hourlyWage: number;
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

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/payroll?year=${year}&month=${month}`);
    const data = res.ok ? await res.json() : [];
    setRecs(data);
    const map: Record<number, any> = {};
    data.forEach((r: Rec) => {
      map[r.employeeId] = {
        overtimeHours: r.overtimeHours || "",
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
        overtimeHours: v.overtimeHours ? Number(v.overtimeHours) : 0,
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
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="td">
                    <div className="font-semibold">{r.employee.name}</div>
                    <div className="text-xs text-slate-400">{r.employee.department} {r.employee.position}</div>
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
                      <InlineInput label="연장h" value={inputs[r.employeeId]?.overtimeHours ?? ""} onChange={(v) => setInput(r.employeeId, "overtimeHours", v)} />
                      <InlineInput label="상여" value={inputs[r.employeeId]?.bonus ?? ""} onChange={(v) => setInput(r.employeeId, "bonus", v)} wide />
                      <InlineInput label="연차정산일" value={inputs[r.employeeId]?.unusedLeaveDays ?? ""} onChange={(v) => setInput(r.employeeId, "unusedLeaveDays", v)} />
                    </div>
                  </td>
                  <td className="td text-right tnum">{won(r.gross)}</td>
                  <td className="td text-right tnum text-slate-500">{won(r.totalDeduct)}</td>
                  <td className="td text-right tnum font-bold">{won(r.net)}</td>
                  <td className="td"><Pill kind={r.status}>{r.status}</Pill></td>
                  <td className="td">
                    <button className="text-xs text-brand-600 font-semibold" onClick={() => openPayslip(r.id)}>PDF</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {recs.length > 0 && (
        <p className="text-xs text-slate-400 mt-3">
          ※ 변동입력(학생수·매출·연장·상여·연차정산)을 수정한 뒤 <b>급여 일괄 산정</b>을 다시 누르면 반영됩니다. 확정(CONFIRMED)된 기록은 재계산되지 않습니다.
        </p>
      )}
    </div>
  );
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
