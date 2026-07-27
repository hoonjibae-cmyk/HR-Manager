"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const LABEL: Record<string, string> = {
  baseWage: "기본급(시급)",
  positionAllow: "직책수당",
  mealAllow: "식대",
  carAllow: "차량유지비",
  ratioPercent: "위탁비율",
  incThreshold: "인센티브 기준인원",
  incPerStudent: "인센티브 기준금액",
  payScheme: "급여형태",
};

/**
 * 직원 카드와 진행 중 계약서의 보수조건이 어긋났을 때 경고.
 * 계약서 PDF·급여 산정은 계약 스냅샷을 읽으므로, 반영하지 않으면 옛 조건으로 발급된다.
 */
export default function ContractSyncNotice({
  employeeId,
  fields,
  detail,
}: {
  employeeId: number;
  fields: string[];
  detail: Array<{ field: string; card: string; contract: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!fields.length) return null;

  async function apply() {
    if (!confirm("직원 카드의 조건을 진행 중 계약서에 반영합니다.\n이후 발급하는 계약서와 급여 산정에 적용됩니다."))
      return;
    setBusy(true);
    const res = await fetch(`/api/employees/${employeeId}/sync-contract`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return alert("반영 실패: " + (j.error || ""));
    if (!j.synced && j.reason === "no-active-contract")
      return alert("진행 중(ACTIVE) 계약이 없습니다. 계약 이력에서 신규계약을 생성하세요.");
    alert("계약서에 반영했습니다.");
    router.refresh();
  }

  return (
    <div className="card p-4 border border-amber-200 bg-amber-50">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <p className="font-bold text-amber-800">직원 카드와 계약서 조건이 다릅니다</p>
          <p className="text-xs text-amber-700 mt-1">
            계약서 발급·급여 산정은 <b>계약서에 저장된 조건</b>을 사용합니다. 반영하지 않으면 아래 왼쪽 값이 아니라
            오른쪽 값으로 발급됩니다.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-amber-900">
            {detail.map((d) => (
              <li key={d.field}>
                · {LABEL[d.field] ?? d.field} — 카드 <b>{d.card}</b> / 계약서 <b>{d.contract}</b>
              </li>
            ))}
          </ul>
        </div>
        <button className="btn-outline whitespace-nowrap" onClick={apply} disabled={busy}>
          {busy ? "반영 중…" : "계약서에 반영"}
        </button>
      </div>
    </div>
  );
}
