"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ymd } from "@/lib/format";
import { LEAVE_TYPE_LABEL } from "@/lib/constants";
import { Pill } from "@/components/ui";

interface Req {
  id: number;
  startDate: string;
  endDate: string;
  days: number;
  leaveType: string;
  reason: string | null;
  workPlan: string | null;
  source: string;
  employee: { name: string; department: string | null };
}

export default function LeaveApprovals({ requests }: { requests: Req[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  async function decide(id: number, action: "approve" | "reject") {
    if (action === "reject" && !confirm("이 연차 신청을 반려하시겠습니까?")) return;
    setBusy(id);
    const res = await fetch(`/api/leave/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    if (res.ok) router.refresh();
    else alert("처리 실패: " + (await res.json().catch(() => ({}))).error);
  }

  /** 잘못 만든 신청 정리 — 승인 전 신청만 지울 수 있다 */
  async function remove(id: number) {
    if (!confirm("이 신청을 목록에서 지웁니다. 되돌릴 수 없습니다. 계속할까요?")) return;
    setBusy(id);
    const res = await fetch(`/api/leave/requests/${id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) router.refresh();
    else alert("삭제 실패: " + (await res.json().catch(() => ({}))).error);
  }

  if (requests.length === 0)
    return <p className="text-sm text-slate-400 py-6 text-center">승인 대기 중인 연차 신청이 없습니다.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th className="th">직원</th>
          <th className="th">기간</th>
          <th className="th">일수</th>
          <th className="th">종류</th>
          <th className="th">사유</th>
          <th className="th">업무조치사항</th>
          <th className="th">경로</th>
          <th className="th text-right">처리</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => (
          <tr key={r.id}>
            <td className="td font-semibold">{r.employee.name}</td>
            <td className="td tnum">
              {ymd(r.startDate)}
              {r.days > 1 ? ` ~ ${ymd(r.endDate)}` : ""}
            </td>
            <td className="td tnum">{r.days}일</td>
            <td className="td">{LEAVE_TYPE_LABEL[r.leaveType] ?? r.leaveType}</td>
            <td className="td text-slate-500">{r.reason ?? "-"}</td>
            <td className="td text-slate-500 whitespace-pre-line">{r.workPlan || "-"}</td>
            <td className="td"><Pill kind={r.source === "SLACK" ? "INCENTIVE" : "DRAFT"}>{r.source}</Pill></td>
            <td className="td text-right">
              <div className="flex gap-1 justify-end">
                <button className="btn-primary py-1 px-2.5 text-xs" onClick={() => decide(r.id, "approve")} disabled={busy === r.id}>승인</button>
                <button className="btn-ghost py-1 px-2.5 text-xs" onClick={() => decide(r.id, "reject")} disabled={busy === r.id}>반려</button>
                <button className="btn-ghost py-1 px-2.5 text-xs text-red-600" onClick={() => remove(r.id)} disabled={busy === r.id} title="잘못 만든 신청 정리">삭제</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
