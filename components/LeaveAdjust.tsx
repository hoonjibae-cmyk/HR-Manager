"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Emp {
  id: number;
  name: string;
  department: string | null;
  hasSlack: boolean;
  eligible: boolean;
}

/** 반영 유형 — 부호와 구분을 한 번에 고른다 */
const KINDS = [
  { key: "USE", label: "연차 사용 (차감)", sign: -1, category: "STATUTORY" },
  { key: "GRANT", label: "연차 부여 (가산)", sign: +1, category: "STATUTORY" },
  { key: "COMP_USE", label: "대휴 사용 (차감)", sign: -1, category: "COMP" },
  { key: "COMP_GRANT", label: "대휴 부여 (가산)", sign: +1, category: "COMP" },
] as const;

/**
 * 운영자가 직원의 연차를 직접 반영한다.
 * 신청·승인 절차 없이 바로 기록되며, 원하면 당사자에게 슬랙 DM 으로 알린다.
 */
export default function LeaveAdjust({ employees }: { employees: Emp[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<any>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    employeeId: "",
    kind: "USE" as (typeof KINDS)[number]["key"],
    date: today,
    days: "1",
    note: "",
    notify: true,
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const emp = employees.find((e) => String(e.id) === f.employeeId);
  const kind = KINDS.find((k) => k.key === f.kind)!;
  const canNotify = !!emp?.hasSlack;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/leave/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: Number(f.employeeId),
        kind: f.kind,
        date: f.date,
        days: Number(f.days),
        note: f.note || null,
        notify: f.notify && canNotify,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error || "반영에 실패했습니다.");
    setResult(j);
    router.refresh();
  }

  function close() {
    setOpen(false);
    setResult(null);
    setErr("");
    setF({ employeeId: "", kind: "USE", date: today, days: "1", note: "", notify: true });
  }

  if (!open)
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + 연차 반영
      </button>
    );

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="card w-full max-w-lg my-8 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">연차 반영</h2>
            <p className="text-xs text-slate-500 mt-1">
              운영자가 직원의 연차를 직접 기록합니다. 신청·승인 절차 없이 바로 반영됩니다.
            </p>
          </div>
          <button className="btn-ghost" onClick={close}>
            닫기
          </button>
        </div>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm">
              <b>{result.name}</b> 님에게 반영했습니다 — {result.kindLabel} {result.days}일 (
              {result.date})
            </p>
            <p className="text-sm text-slate-500">
              반영 후 잔여: <b className="text-brand-600">연차 {result.remaining}일</b>
              {result.compRemaining != null && <> · 대휴 {result.compRemaining}일</>}
            </p>
            <p className="text-xs text-slate-400">
              {result.notified === true
                ? "슬랙 DM 을 보냈습니다."
                : result.notified === false
                ? `슬랙 DM 을 보내지 못했습니다${result.notifyError ? ` (${result.notifyError})` : ""}.`
                : "슬랙 알림은 보내지 않았습니다."}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-outline" onClick={() => setResult(null)}>
                계속 반영
              </button>
              <button className="btn-primary" onClick={close}>
                완료
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label">직원 *</label>
              <select
                className="input"
                required
                value={f.employeeId}
                onChange={(e) => set("employeeId", e.target.value)}
              >
                <option value="">선택</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.department ?? "-"}){e.eligible ? "" : " · 연차 미적용"}
                  </option>
                ))}
              </select>
              {emp && !emp.eligible && kind.category === "STATUTORY" && (
                <p className="text-[11px] text-amber-600 mt-1">
                  이 직원은 법정 연차 발생 대상이 아닙니다. 부여로 반영하면 그만큼만 쓸 수 있습니다.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">유형 *</label>
                <select className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
                  {KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">일수 *</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  required
                  className="input"
                  value={f.days}
                  onChange={(e) => set("days", e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label">{kind.sign < 0 ? "사용일 *" : "부여일 *"}</label>
              <input
                type="date"
                required
                className="input"
                value={f.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </div>

            <div>
              <label className="label">사유 (선택)</label>
              <input
                className="input"
                placeholder="예: 관리자 직접 반영 · 시트 정리분"
                value={f.note}
                onChange={(e) => set("note", e.target.value)}
              />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="w-4 h-4 mt-0.5"
                checked={f.notify && canNotify}
                disabled={!canNotify}
                onChange={(e) => set("notify", e.target.checked)}
              />
              <span className={canNotify ? "" : "text-slate-400"}>
                직원에게 슬랙 DM 으로 알리기
                {!canNotify && emp && (
                  <span className="block text-xs text-slate-400">
                    이 직원은 슬랙 계정이 연결돼 있지 않습니다 (설정 → 슬랙 연동)
                  </span>
                )}
              </span>
            </label>

            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-ghost" onClick={close}>
                취소
              </button>
              <button className="btn-primary" disabled={busy || !f.employeeId}>
                {busy ? "반영 중…" : "반영"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
