"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface OtPolicyRow {
  extraMultiplier: number;
  overtimeMultiplier: number;
  applyStatutoryOvertime: boolean;
  holidayMultiplier: number;
  holidayOverMultiplier: number;
  holidayOverAfterHours: number;
  nightMultiplier: number;
  nightStartHour: number;
  nightEndHour: number;
  countNight: boolean;
  mandatoryCapHours: number;
  roundingMinutes: number;
  immediateDefault: boolean;
  mandatoryDefault: boolean;
  absenceDefault: boolean;
  otherDefault: boolean;
  weekendDefault: boolean;
}

export interface ExamPeriodRow {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  capHours: number;
}

/** 오버타임 지급 조건 + 내신 기간 — 산정에 직접 쓰이는 값이라 산정 화면 옆에 둔다 */
export default function MakeupPolicyPanel({
  policy,
  examPeriods,
}: {
  policy: OtPolicyRow;
  examPeriods: ExamPeriodRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const [p, setP] = useState<OtPolicyRow>(policy);
  const [exam, setExam] = useState({ name: "", startDate: "", endDate: "", capHours: "10" });

  const set = (k: keyof OtPolicyRow, v: any) => setP((x) => ({ ...x, [k]: v }));

  async function savePolicy() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/makeup/policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error || "저장하지 못했습니다.");
    setWarn(j.warn ?? []);
    router.refresh();
  }

  async function addExam() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/makeup/exam-periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exam),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error || "등록하지 못했습니다.");
    setExam({ name: "", startDate: "", endDate: "", capHours: "10" });
    router.refresh();
  }

  async function delExam(id: number) {
    if (!confirm("이 내신 기간을 삭제할까요? 해당 기간의 내신의무보강은 분기 기준 상한으로 되돌아갑니다."))
      return;
    setBusy(true);
    await fetch(`/api/makeup/exam-periods/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  if (!open)
    return (
      <button className="btn-outline" onClick={() => setOpen(true)}>
        ⚙ 수당 지급 조건
      </button>
    );

  const numField = (label: string, key: keyof OtPolicyRow, step = "0.1", hint?: string) => (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step={step}
        className="input"
        value={String(p[key] ?? "")}
        onChange={(e) => set(key, Number(e.target.value))}
      />
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );

  const check = (label: string, key: keyof OtPolicyRow, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="w-4 h-4 mt-0.5"
        checked={!!p[key]}
        onChange={(e) => set(key, e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="card w-full max-w-3xl my-8 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">오버타임 수당 지급 조건</h2>
            <p className="text-xs text-slate-500 mt-1">
              여기서 정한 조건으로 보강 실근무가 수당으로 환산됩니다. 평일 소정근로시간 밖과
              토요일 근무는 주 40시간 안쪽이라 <b>가산이 붙지 않습니다(×1.0)</b> — 가산은
              휴일근로(일요일·공휴일)에만 붙습니다.
            </p>
          </div>
          <button className="btn-ghost whitespace-nowrap" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-3 mb-4">
          {numField("연장근로 배수", "extraMultiplier", "0.1", "평일 소정 외·토요일 — 가산 없음")}
          {numField("법정 연장 배수", "overtimeMultiplier", "0.1", "1일 8h·주 40h 초과분")}
          {numField("휴일근로 배수", "holidayMultiplier", "0.1", "일요일·공휴일")}
          {numField("휴일 초과 배수", "holidayOverMultiplier", "0.1", "1일 8시간 초과분")}
          {numField("휴일 초과 기준시간", "holidayOverAfterHours", "1")}
          {numField("야간 가산", "nightMultiplier", "0.1")}
          {numField("내신의무보강 상한(시간)", "mandatoryCapHours", "1", "내신 기간별 인정 상한")}
          {numField("야간 시작(시)", "nightStartHour", "1")}
          {numField("야간 종료(시)", "nightEndHour", "1")}
          {numField("인정시간 반올림(분)", "roundingMinutes", "5", "0 = 반올림하지 않음")}
        </div>

        <div className="border-t border-slate-100 pt-3 mb-4 space-y-2">
          {check(
            "1일 8시간·주 40시간 초과분에 법정 가산을 적용한다",
            "applyStatutoryOvertime",
            "끄면 평일 소정 외·토요일 근무는 시간에 관계없이 가산 없이 지급합니다 (기본값)"
          )}
          {check("야간(22~06시) 가산을 산정한다", "countNight", "기본 꺼짐 — 켜면 22~06시 근무에 +0.5 가 더 붙습니다")}
          <div className="text-xs font-bold text-slate-500 pt-2">종류별 수당 반영 기본값</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {check("직전보강", "immediateDefault")}
            {check("내신의무보강 (상한 적용)", "mandatoryDefault")}
            {check("결시보강", "absenceDefault", "끄면 관리자가 건건이 판단합니다 (권장)")}
            {check("주말근무", "weekendDefault", "교수부가 아닌 직원의 주말 근무 신청")}
            {check("기타", "otherDefault")}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            여기서 켜 둔 종류는 근무 다음날 <b>신청자에게 실근무 확정 요청이 자동으로</b> 나갑니다.
            꺼 둔 종류(결시보강 등)는 수당 반영 여부를 먼저 정해야 하므로 달력에서{" "}
            <b>골라서</b> 보냅니다.
          </p>
        </div>

        {warn.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 mb-3">
            {warn.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
          </div>
        )}
        {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

        <div className="flex justify-end mb-6">
          <button className="btn-primary" onClick={savePolicy} disabled={busy}>
            {busy ? "저장 중…" : "조건 저장"}
          </button>
        </div>

        {/* 내신 기간 */}
        <div className="border-t border-slate-100 pt-4">
          <h3 className="font-bold text-slate-800 mb-1">내신 기간 (연 4회)</h3>
          <p className="text-xs text-slate-500 mb-3">
            내신의무보강 상한이 걸리는 단위입니다. 등록하지 않으면 분기 기준으로 대신 묶습니다.
          </p>

          {examPeriods.length > 0 && (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 mb-3">
              {examPeriods.map((e) => (
                <div key={e.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                  <span className="font-semibold text-slate-700">{e.name}</span>
                  <span className="text-xs text-slate-400 tnum">
                    {e.startDate} ~ {e.endDate} · 상한 {e.capHours}시간
                  </span>
                  <button
                    className="ml-auto text-xs text-red-500 hover:underline"
                    onClick={() => delExam(e.id)}
                    disabled={busy}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid sm:grid-cols-4 gap-2">
            <input
              className="input py-1 text-xs sm:col-span-2"
              placeholder="예: 2026년 1학기 중간고사"
              value={exam.name}
              onChange={(e) => setExam((x) => ({ ...x, name: e.target.value }))}
            />
            <input
              type="date"
              className="input py-1 text-xs"
              value={exam.startDate}
              onChange={(e) => setExam((x) => ({ ...x, startDate: e.target.value }))}
            />
            <input
              type="date"
              className="input py-1 text-xs"
              value={exam.endDate}
              onChange={(e) => setExam((x) => ({ ...x, endDate: e.target.value }))}
            />
            <input
              type="number"
              className="input py-1 text-xs"
              placeholder="상한(시간)"
              value={exam.capHours}
              onChange={(e) => setExam((x) => ({ ...x, capHours: e.target.value }))}
            />
            <button className="btn-outline py-1 text-xs sm:col-span-1" onClick={addExam} disabled={busy}>
              + 기간 추가
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
