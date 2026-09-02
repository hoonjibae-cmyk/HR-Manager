"use client";

// 관리자 직접 반영 기록 한 줄을 지우는 ✕ — 중복 입력·오타 정정용.
// 신청서에 매인 줄에는 이 버튼 자체가 안 붙는다(부모가 requestId 로 거른다).
// 원장을 지우는 일이라 확인창이 무엇을 지우는지 그대로 보여 준다.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LeaveTxnDeleteButton({
  txnId,
  desc,
}: {
  txnId: number;
  /** 확인창에 보여줄 내용 — "2026-04-30 · 연차 1.5일 사용 (전년도 초과 사용 연차)" */
  desc: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (
      !confirm(
        `이 기록을 삭제합니다.\n\n${desc}\n\n삭제하면 잔여 연차가 그만큼 되돌아갑니다. 계속할까요?`
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/leave/txns/${txnId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      alert("삭제 실패: " + ((await res.json().catch(() => ({}))).error || ""));
      return;
    }
    router.refresh();
  }

  return (
    <button
      className="text-slate-300 hover:text-rose-600 disabled:opacity-40 text-sm px-1"
      title="이 기록 삭제 (관리자 직접 반영분만)"
      disabled={busy}
      onClick={remove}
    >
      ✕
    </button>
  );
}
