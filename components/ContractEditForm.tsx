"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONTRACT_STAGE_LABEL, PAY_SCHEME_LABEL, INCOME_TYPE_LABEL } from "@/lib/constants";

export interface ContractSnapshot {
  id: number;
  stage: string;
  startDate: string;
  endDate: string;
  isProbation: boolean;
  payScheme: string;
  incomeType: string;
  baseWage: number;
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  incThreshold: number | null;
  incPerStudent: number | null;
  ratioPercent: number | null; // 0~1
  note: string;
}

/** 이미 만든 계약의 조건·기간 수정 (오타 정정, 조건 변경) */
export default function ContractEditForm({
  contract,
  deletable,
}: {
  contract: ContractSnapshot;
  deletable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({
    ...contract,
    incThreshold: contract.incThreshold ?? "",
    incPerStudent: contract.incPerStudent ?? "",
    ratioPercent: contract.ratioPercent != null ? contract.ratioPercent * 100 : "",
  });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    const res = await fetch(`/api/contracts/${contract.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: f.stage,
        startDate: f.startDate,
        endDate: f.endDate || null,
        isProbation: f.isProbation,
        payScheme: f.payScheme,
        incomeType: f.incomeType,
        baseWage: f.baseWage,
        positionAllow: f.positionAllow,
        mealAllow: f.mealAllow,
        carAllow: f.carAllow,
        incThreshold: f.incThreshold === "" ? null : Number(f.incThreshold),
        incPerStudent: f.incPerStudent === "" ? null : Number(f.incPerStudent),
        ratioPercent: f.ratioPercent === "" ? null : Number(f.ratioPercent) / 100,
        note: f.note || null,
      }),
    });
    setSaving(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(j.error || "수정에 실패했습니다.");
    if (j.issues?.length) alert("수정했습니다.\n\n확인 필요:\n· " + j.issues.join("\n· "));
    setOpen(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("이 계약을 삭제합니다.\n직전 계약의 기간이 늘어나 빈틈을 메웁니다. 계속할까요?")) return;
    setSaving(true);
    const res = await fetch(`/api/contracts/${contract.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return alert("삭제 실패: " + (j.error || ""));
    if (j.issues?.length) alert("삭제했습니다.\n\n확인 필요:\n· " + j.issues.join("\n· "));
    router.refresh();
  }

  if (!open)
    return (
      <button className="text-xs text-slate-500 font-semibold" onClick={() => setOpen(true)}>
        조건 수정
      </button>
    );

  const isMonthly = f.payScheme === "MONTHLY" || f.payScheme === "INCENTIVE";

  return (
    <form onSubmit={submit} className="w-full border border-slate-200 rounded-lg p-3 mt-1 space-y-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <L label="계약단계">
          <select className="input" value={f.stage} onChange={(e) => set("stage", e.target.value)}>
            {Object.entries(CONTRACT_STAGE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        <L label="수습">
          <select
            className="input"
            value={f.isProbation ? "1" : "0"}
            onChange={(e) => set("isProbation", e.target.value === "1")}
          >
            <option value="0">해당 없음</option>
            <option value="1">수습 2개월</option>
          </select>
        </L>
        <L label="시작일">
          <input type="date" required className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </L>
        <L label="종료일 (공란=기한 없음)">
          <input type="date" className="input" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </L>
        <L label="세무/보험">
          <select className="input" value={f.incomeType} onChange={(e) => set("incomeType", e.target.value)}>
            {Object.entries(INCOME_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        <L label="급여형태">
          <select className="input" value={f.payScheme} onChange={(e) => set("payScheme", e.target.value)}>
            {Object.entries(PAY_SCHEME_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        {f.payScheme !== "RATIO" && (
          <L label={f.payScheme === "HOURLY" ? "시급 (원)" : "월 기본급 (원)"}>
            <input type="number" className="input" value={f.baseWage} onChange={(e) => set("baseWage", e.target.value)} />
          </L>
        )}
        {f.payScheme === "RATIO" && (
          <L label="위탁 비율 (%)">
            <input type="number" step="0.1" className="input" value={f.ratioPercent} onChange={(e) => set("ratioPercent", e.target.value)} />
          </L>
        )}
        {isMonthly && (
          <>
            <L label="직책수당"><input type="number" className="input" value={f.positionAllow} onChange={(e) => set("positionAllow", e.target.value)} /></L>
            <L label="식대(비과세)"><input type="number" className="input" value={f.mealAllow} onChange={(e) => set("mealAllow", e.target.value)} /></L>
            <L label="차량유지비"><input type="number" className="input" value={f.carAllow} onChange={(e) => set("carAllow", e.target.value)} /></L>
          </>
        )}
        {f.payScheme === "INCENTIVE" && (
          <>
            <L label="인센티브 기준 학생수"><input type="number" className="input" value={f.incThreshold} onChange={(e) => set("incThreshold", e.target.value)} /></L>
            <L label="기준 금액 (원)"><input type="number" className="input" value={f.incPerStudent} onChange={(e) => set("incPerStudent", e.target.value)} /></L>
          </>
        )}
        <L label="비고"><input className="input" value={f.note} onChange={(e) => set("note", e.target.value)} /></L>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2 justify-end">
        {deletable && (
          <button type="button" className="btn-ghost text-xs text-red-600" onClick={remove} disabled={saving}>
            계약 삭제
          </button>
        )}
        <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>닫기</button>
        <button className="btn-primary text-xs" disabled={saving}>{saving ? "저장 중…" : "수정 저장"}</button>
      </div>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label text-[11px]">{label}</label>
      {children}
    </div>
  );
}
