"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONTRACT_STAGE_LABEL, PAY_SCHEME_LABEL, INCOME_TYPE_LABEL } from "@/lib/constants";
import FixedHoursFields from "./FixedHoursFields";
import ContractorField from "./ContractorField";

/** 계약 단계별 수습 기본값 — 신규(단기/파트)만 수습 포함, 갱신·정규는 제외 */
function defaultProbation(stage: string): boolean {
  return stage === "SHORT_TERM_1" || stage === "PART";
}

interface EmpSnapshot {
  id: number;
  incomeType: string;
  payScheme: string;
  baseWage: number;
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  incThreshold: number | null;
  incPerStudent: number | null;
  incRevenuePercent: number | null; // 0~1
  ratioPercent: number | null; // 0~1
  ratioMinGuarantee?: number | null;
  fixedBaseHours?: number | null;
  fixedOtHours?: number | null;
  fixedNightHours?: number | null;
  position: string | null;
  duty: string | null;
}

export default function NewContractForm({ emp }: { emp: EmpSnapshot }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    stage: "RENEWAL_1",
    startDate: today,
    endDate: "",
    isProbation: defaultProbation("RENEWAL_1"),
    incomeType: emp.incomeType,
    payScheme: emp.payScheme,
    baseWage: emp.baseWage,
    positionAllow: emp.positionAllow,
    mealAllow: emp.mealAllow,
    carAllow: emp.carAllow,
    incThreshold: emp.incThreshold ?? "",
    incPerStudent: emp.incPerStudent ?? "",
    incRevenuePercent: emp.incRevenuePercent != null ? emp.incRevenuePercent * 100 : "",
    ratioPercent: emp.ratioPercent != null ? emp.ratioPercent * 100 : "",
    ratioMinGuarantee: emp.ratioMinGuarantee ?? "",
    isContractor: !!(emp as any).isContractor,
    fixedBaseHours: emp.fixedBaseHours ?? "",
    fixedOtHours: emp.fixedOtHours ?? "",
    fixedNightHours: emp.fixedNightHours ?? "",
    position: emp.position ?? "",
    duty: emp.duty ?? "",
    note: "",
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    const res = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: emp.id,
        stage: f.stage,
        startDate: f.startDate,
        endDate: f.endDate || null,
        isProbation: f.isProbation,
        incomeType: f.incomeType,
        payScheme: f.payScheme,
        baseWage: f.baseWage,
        positionAllow: f.positionAllow,
        mealAllow: f.mealAllow,
        carAllow: f.carAllow,
        incThreshold: f.incThreshold === "" ? null : Number(f.incThreshold),
        incPerStudent: f.incPerStudent === "" ? null : Number(f.incPerStudent),
        incRevenuePercent: f.incRevenuePercent === "" ? null : Number(f.incRevenuePercent) / 100,
        ratioPercent: f.ratioPercent === "" ? null : Number(f.ratioPercent) / 100,
        ratioMinGuarantee: f.ratioMinGuarantee === "" ? null : Number(f.ratioMinGuarantee),
        isContractor: f.payScheme === "RATIO" ? true : !!f.isContractor,
        fixedBaseHours: f.fixedBaseHours === "" ? null : Number(f.fixedBaseHours),
        fixedOtHours: f.fixedOtHours === "" ? null : Number(f.fixedOtHours),
        fixedNightHours: f.fixedNightHours === "" ? null : Number(f.fixedNightHours),
        position: f.position,
        duty: f.duty,
        note: f.note || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || "신규 계약 생성에 실패했습니다.");
    }
  }

  if (!open) {
    return (
      <button className="text-xs text-brand-600 font-semibold" onClick={() => setOpen(true)}>
        + 신규 계약 작성
      </button>
    );
  }

  const isMonthly = f.payScheme === "MONTHLY" || f.payScheme === "INCENTIVE";

  return (
    <form onSubmit={submit} className="border border-brand-100 bg-brand-50/40 rounded-xl p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-800">신규 계약 작성</span>
        <button type="button" className="text-xs text-slate-400" onClick={() => setOpen(false)}>닫기 ✕</button>
      </div>
      <p className="text-xs text-slate-500">
        기존 확정 계약서는 이력에 그대로 남고(만료 처리), 아래 조건으로 새 계약이 생성됩니다.
        저장 후 새 계약 행에서 <b>계약서 발급</b>을 누르세요.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <L label="계약 단계">
          <select
            className="input"
            value={f.stage}
            onChange={(e) => {
              const stage = e.target.value;
              setF((p) => ({ ...p, stage, isProbation: defaultProbation(stage) }));
            }}
          >
            {Object.entries(CONTRACT_STAGE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        <L label="급여형태 (변경 가능)">
          <select className="input" value={f.payScheme} onChange={(e) => set("payScheme", e.target.value)}>
            {Object.entries(PAY_SCHEME_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        <L label="세무/보험 구분 (4대보험 · 3.3%)">
          <select
            className="input"
            value={f.incomeType}
            onChange={(e) => {
              const v = e.target.value;
              // 4대보험 직원은 식대 20만원 포함이 기본 규칙 (전환 시 자동 반영, 수정 가능)
              setF((p) => ({ ...p, incomeType: v, mealAllow: v === "EMPLOYEE" ? 200000 : 0 }));
            }}
          >
            {Object.entries(INCOME_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        <L label="계약 시작일 *">
          <input type="date" required className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </L>
        <L label="계약 종료일 (정규직은 공란)">
          <input type="date" className="input" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </L>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" className="w-4 h-4" checked={f.isProbation} onChange={(e) => set("isProbation", e.target.checked)} />
        <span>수습기간 2개월 조항 포함 <span className="text-slate-400">(신규 계약만 — 갱신·정규 계약서에는 제외)</span></span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        {f.payScheme !== "RATIO" && (
          <L label={f.payScheme === "HOURLY" ? "시급 (원)" : "월 급여 총액 (원)"}>
            <input type="number" className="input" value={f.baseWage} onChange={(e) => set("baseWage", e.target.value)} />
          </L>
        )}
        {isMonthly && (
          <>
            <L label="직책수당"><input type="number" className="input" value={f.positionAllow} onChange={(e) => set("positionAllow", e.target.value)} /></L>
            <L label="식대 (비과세)"><input type="number" className="input" value={f.mealAllow} onChange={(e) => set("mealAllow", e.target.value)} /></L>
            <L label="차량유지비 (비과세)"><input type="number" className="input" value={f.carAllow} onChange={(e) => set("carAllow", e.target.value)} /></L>
          </>
        )}
        {f.payScheme === "INCENTIVE" && (
          <>
            <L label="인센티브 기준 학생수"><input type="number" className="input" value={f.incThreshold} onChange={(e) => set("incThreshold", e.target.value)} /></L>
            <L label="초과 1명당 금액 (원)"><input type="number" className="input" value={f.incPerStudent} onChange={(e) => set("incPerStudent", e.target.value)} /></L>
            <L label="매출 비율 인센티브 (%)"><input type="number" step="0.1" className="input" placeholder="없으면 비움" value={f.incRevenuePercent} onChange={(e) => set("incRevenuePercent", e.target.value)} /></L>
          </>
        )}
        {f.payScheme === "RATIO" && (
          <>
            <L label="위탁 비율 (%)"><input type="number" step="0.1" className="input" value={f.ratioPercent} onChange={(e) => set("ratioPercent", e.target.value)} /></L>
            <L label="위탁 최저보장 (월, 원)"><input type="number" className="input" placeholder="없으면 비움" value={f.ratioMinGuarantee} onChange={(e) => set("ratioMinGuarantee", e.target.value)} /></L>
          </>
        )}
        <L label="직책"><input className="input" value={f.position} onChange={(e) => set("position", e.target.value)} /></L>
        <L label="업무내용"><input className="input" value={f.duty} onChange={(e) => set("duty", e.target.value)} /></L>
      </div>

      <ContractorField
        checked={!!f.isContractor}
        payScheme={f.payScheme}
        onChange={(v) => set("isContractor", v)}
      />
      {isMonthly && !f.isContractor && f.payScheme !== "RATIO" && (
        <FixedHoursFields f={f} set={set} />
      )}

      <L label="메모 (선택)">
        <input className="input" placeholder="예: 연봉 조정 재계약" value={f.note} onChange={(e) => set("note", e.target.value)} />
      </L>

      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>취소</button>
        <button className="btn-primary" disabled={saving}>{saving ? "저장 중…" : "신규 계약 생성"}</button>
      </div>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
