"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SeverancePolicyRow {
  dcAfterMonths: number;
  divisor: number;
  minWeeklyHours: number;
  includeBonus: boolean;
  includeIncentive: boolean;
  includeFixedOvertime: boolean;
  includeOvertime: boolean;
  includeUnusedLeave: boolean;
  includeMealCar: boolean;
}

/**
 * 퇴직급여 산정 조건 — 산정에 직접 쓰이는 값이라 산정 화면 옆에 둔다.
 *
 * 산입 범위를 화면에서 고칠 수 있게 둔 이유: 무엇을 임금총액에 넣을지는 노무 자문으로
 * 바뀔 수 있는 판단이다. 법정 기준에서 벗어나도 **막지 않고 경고만** 띄운다 —
 * 막아 버리면 DB 를 직접 만지게 되어 오히려 기록이 안 남는다.
 */
export default function SeverancePolicyPanel({ policy }: { policy: SeverancePolicyRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const [p, setP] = useState<SeverancePolicyRow>(policy);

  const set = (k: keyof SeverancePolicyRow, v: any) => setP((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/severance/policy", {
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

  const num = (label: string, k: keyof SeverancePolicyRow, step = "1", hint?: string) => (
    <label className="text-xs">
      <span className="text-slate-500">{label}</span>
      <input
        type="number"
        step={step}
        className="input py-1 text-sm mt-0.5"
        value={String(p[k])}
        onChange={(e) => set(k, e.target.value === "" ? "" : Number(e.target.value))}
      />
      {hint && <span className="text-[11px] text-slate-400 block mt-0.5">{hint}</span>}
    </label>
  );

  const check = (label: string, k: keyof SeverancePolicyRow, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="w-4 h-4 mt-0.5 shrink-0"
        checked={!!p[k]}
        onChange={(e) => set(k, e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="text-[11px] text-slate-400 block">{hint}</span>}
      </span>
    </label>
  );

  if (!open)
    return (
      <button className="btn-outline" onClick={() => setOpen(true)}>
        ⚙ 산정 조건
      </button>
    );

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="card w-full max-w-xl my-8 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">퇴직급여 산정 조건</h2>
            <p className="text-xs text-slate-500 mt-1">
              바꾸면 이 화면의 모든 달이 다시 계산됩니다 (저장된 값이 아니라 그때그때 산정합니다).
            </p>
          </div>
          <button className="btn-ghost" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          {num("DC 전환 근속(개월)", "dcAfterMonths", "1", "이 개월 수가 지나면 부담금")}
          {num("나누는 수", "divisor", "1", "법정 하한 = 1/12")}
          {num("최소 주 소정근로(시간)", "minWeeklyHours", "0.5", "미만이면 대상 제외")}
        </div>

        <div className="border-t border-slate-100 pt-3 mb-4 space-y-2">
          <div className="text-xs font-bold text-slate-500">산정기준 임금에 넣을 항목</div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            기본급·주휴수당·직책수당은 언제나 들어갑니다. 아래는 켜고 끌 수 있는 항목입니다.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {check("식대 · 차량유지비", "includeMealCar", "비과세지만 정기·일률 지급이면 임금")}
            {check("연차미사용수당", "includeUnusedLeave")}
            {check(
              "포괄임금 약정 시간외 · 야간",
              "includeFixedOvertime",
              "계약서 제4조의 고정분 — 켜면 계약 월 급여총액과 맞는다"
            )}
            {check("인센티브", "includeIncentive", "끄면: 퇴직유보금으로 별도 적립 중")}
            {check("상여", "includeBonus", "비정기 특별상여")}
            {check(
              "그 달 발생한 연장 · 야간 · 휴일수당",
              "includeOvertime",
              "보강 확정분·수기 입력분. ⚠ 끄면 법정 하한 미달 소지"
            )}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            오버타임은 <b>두 갈래</b>입니다 — 계약서에 이미 들어 있는 <b>약정분</b>(매달 같은
            금액)과 그 달 새로 생긴 <b>변동분</b>. 급여 레코드에는 섞여 있어, 그 달 입력·확정된
            시간에서 변동분을 다시 세워 가릅니다(세무사무소 제출자료와 같은 방식).
          </p>
        </div>

        {!p.includeFixedOvertime && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 mb-3 leading-relaxed">
            ⚠ <b>포괄임금 약정 시간외·야간</b>을 빼고 있습니다. 계약서에 합의된 월 급여의 일부라
            매달 일률적으로 지급되는 임금이므로, 산정기준이 <b>계약 월 급여총액보다 적어집니다</b>.
            법정 하한(연간 임금총액의 1/12)에 미달할 소지가 큽니다.
          </div>
        )}

        {!p.includeOvertime && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 mb-3 leading-relaxed">
            ⚠ 그 달 발생한 연장·야간·휴일수당을 빼고 있습니다. 근로자퇴직급여보장법 §20① 의 하한은{" "}
            <b>연간 임금총액의 1/12</b> 이고 이들 수당도 근로의 대가인 임금이라, 이 기준으로는
            하한에 미달할 수 있습니다. 노무 자문으로 확인해 주세요.
          </div>
        )}

        {warn.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 mb-3 space-y-1">
            {warn.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
          </div>
        )}
        {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

        <div className="flex justify-end">
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "저장 중…" : "조건 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
