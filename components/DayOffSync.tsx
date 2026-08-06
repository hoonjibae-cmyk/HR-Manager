"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 구글 연차 캘린더의 `(휴무)홍길동` 일정을 끌어오는 버튼.
 *
 * **연차가 아니다** — 운영팀이 그 주 토요일 당번 근무 대신 평일 하루를 쉬는 것이라
 * 연차 잔여를 깎지 않는다. 달력에 '그날 자리에 없다' 만 표시한다.
 *
 * 결과를 그냥 '완료' 로 끝내지 않고 **못 들어온 것을 함께 띄운다** — 캘린더 제목 오타나
 * 퇴사자 이름은 조용히 빠지는데, 그러면 그 사람 휴무가 달력에서 사라진 것을 아무도 모른다.
 */
export default function DayOffSync({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [warn, setWarn] = useState("");
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true);
    setMsg("");
    setWarn("");
    setErr("");
    const res = await fetch("/api/leave/dayoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const j = await res.json().catch(() => ({}) as any);
    setBusy(false);
    if (!res.ok || j.error) return setErr(j.error || "가져오지 못했습니다.");
    setMsg(
      `휴무 ${j.total}건 (추가 ${j.added}${j.removed ? ` · 삭제 ${j.removed}` : ""}) · ` +
        `${j.window?.from} ~ ${j.window?.to}`
    );
    if (j.warning) setWarn(j.warning);
    router.refresh();
  }

  if (!configured)
    return (
      <span className="text-[11px] text-slate-400">
        구글 캘린더가 연결되지 않아 휴무를 가져올 수 없습니다
      </span>
    );

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="btn text-xs whitespace-nowrap" onClick={run} disabled={busy} title="구글 연차 캘린더의 (휴무)○○○ 일정을 가져옵니다">
        {busy ? "가져오는 중…" : "휴무 가져오기"}
      </button>
      {msg && <span className="text-[11px] text-slate-400 max-w-xs text-right">{msg}</span>}
      {warn && <span className="text-[11px] text-amber-600 max-w-md text-right">⚠ {warn}</span>}
      {err && <span className="text-[11px] text-rose-600">{err}</span>}
    </div>
  );
}
