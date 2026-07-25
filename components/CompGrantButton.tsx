"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 대휴보상연차 수동 부여/차감 (운영자) */
export default function CompGrantButton({
  employeeId,
  employeeName,
}: {
  employeeId: number;
  employeeName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = Number(days);
    if (!n || isNaN(n)) return alert("일수를 입력하세요 (예: 1, 0.5, -1)");
    setBusy(true);
    const res = await fetch("/api/leave/comp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, days: n, note }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setDays("1");
      setNote("");
      router.refresh();
    } else {
      alert("실패: " + ((await res.json().catch(() => ({}))).error || ""));
    }
  }

  if (!open)
    return (
      <button
        className="text-xs text-emerald-600 font-semibold whitespace-nowrap"
        onClick={() => setOpen(true)}
        title="대휴보상연차 부여/차감"
      >
        +대휴
      </button>
    );

  return (
    <div className="flex items-center gap-1 justify-end">
      <input
        type="number"
        step="0.5"
        className="border border-slate-300 rounded px-1.5 py-0.5 text-xs w-16"
        value={days}
        onChange={(e) => setDays(e.target.value)}
        title="일수 (+부여 / -차감, 0.5 단위)"
        autoFocus
      />
      <input
        className="border border-slate-300 rounded px-1.5 py-0.5 text-xs w-28"
        placeholder="사유 (예: 8/15 근무)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="btn-primary py-0.5 px-2 text-xs" disabled={busy} onClick={submit}>
        {busy ? "…" : "저장"}
      </button>
      <button className="btn-ghost py-0.5 px-1.5 text-xs" onClick={() => setOpen(false)}>✕</button>
    </div>
  );
}
