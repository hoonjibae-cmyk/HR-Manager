"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Emp { id: number; name: string; department: string | null }

export default function AddLeaveRequest({ employees }: { employees: Emp[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ employeeId: "", startDate: "", endDate: "", leaveType: "ANNUAL", reason: "" });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/leave/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, endDate: f.endDate || f.startDate }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setF({ employeeId: "", startDate: "", endDate: "", leaveType: "ANNUAL", reason: "" });
      router.refresh();
    } else alert("등록 실패");
  }

  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>+ 연차 신청 등록</button>;

  return (
    <form onSubmit={submit} className="card p-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="label">직원</label>
        <select className="input w-40" required value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
          <option value="">선택</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.department})</option>)}
        </select>
      </div>
      <div><label className="label">시작일</label><input type="date" required className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
      <div><label className="label">종료일</label><input type="date" className="input" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
      <div>
        <label className="label">종류</label>
        <select className="input w-32" value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value })}>
          <option value="ANNUAL">연차</option>
          <option value="HALF">반차</option>
          <option value="COMP">대휴(보상)</option>
          <option value="SICK">병가</option>
          <option value="SPECIAL">경조사</option>
        </select>
      </div>
      <div className="flex-1 min-w-[140px]"><label className="label">사유</label><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      <button className="btn-primary" disabled={busy}>{busy ? "등록 중…" : "등록"}</button>
      <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>취소</button>
    </form>
  );
}
