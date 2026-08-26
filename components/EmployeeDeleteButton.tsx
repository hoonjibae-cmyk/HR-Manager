"use client";

/**
 * 직원 완전 삭제 버튼 + 확인창 — **입사 취소용**.
 *
 * 되돌릴 수 없는 작업이라 두 겹으로 확인한다.
 *  ① 창을 열면 서버가 **무엇이 함께 지워지는지**(계약·급여·연차·첨부 건수)를 먼저 보여준다 —
 *     같은 DELETE 엔드포인트를 확인 문구 없이 불러 미리보기(428)를 받는다. 판정이 서버
 *     한곳에 있으므로 화면이 보여준 것과 실제 지워지는 것이 어긋나지 않는다.
 *  ② 사용자가 **'삭제' 를 직접 타이핑**해야 버튼이 눌린다 — 확인창 버튼을 반사적으로
 *     누르는 실수를 타이핑이 끊는다.
 *
 * 명세서가 발송된 직원은 서버가 409 로 막는다(퇴사 처리로 안내) — 창이 그 사유를 그대로 띄운다.
 */

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteSummary {
  name: string;
  empNo: string;
  contracts: number;
  payroll: number;
  payrollSent: number;
  leaveTxns: number;
  files: number;
  makeups: number;
  timesheets: number;
}

export default function EmployeeDeleteButton({ employeeId, name }: { employeeId: number; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<DeleteSummary | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function openModal() {
    setOpen(true);
    setPhrase("");
    setErr(null);
    setBlocked(null);
    setSummary(null);
    // 확인 문구 없이 부르면 지우지 않고 미리보기만 온다 (428) — 발송 이력이 있으면 409
    const res = await fetch(`/api/employees/${employeeId}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (res.status === 409) setBlocked(j.error ?? "삭제할 수 없습니다.");
    else if (j.summary) setSummary(j.summary);
    else setBlocked(j.error ?? "삭제 정보를 읽지 못했습니다.");
  }

  async function doDelete() {
    if (phrase !== "삭제") return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/employees/${employeeId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "삭제" }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? "삭제하지 못했습니다.");
      return;
    }
    alert(`${name}님의 정보를 삭제했습니다.`);
    router.push("/employees");
    router.refresh();
  }

  const rows = summary
    ? ([
        ["계약", summary.contracts],
        ["급여 기록(작성중)", summary.payroll],
        ["연차 기록", summary.leaveTxns],
        ["첨부 파일(계약 스캔·서류함)", summary.files],
        ["보강·근무 신청", summary.makeups],
        ["시간기록", summary.timesheets],
      ] as const)
    : [];

  return (
    <>
      <button
        className="text-xs text-slate-400 hover:text-rose-600 underline decoration-dotted underline-offset-2"
        onClick={openModal}
      >
        직원 삭제
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card max-w-md w-full p-5 space-y-4">
            <div className="font-bold text-rose-700">⚠ 직원 완전 삭제 — {name}</div>

            {blocked ? (
              <p className="text-sm text-slate-600 leading-relaxed">{blocked}</p>
            ) : !summary ? (
              <p className="text-sm text-slate-400">삭제될 내용을 확인하는 중…</p>
            ) : (
              <>
                <p className="text-sm text-slate-600 leading-relaxed">
                  입사 취소처럼 <b>기록을 남길 이유가 없는 경우에만</b> 사용하세요. 아래 기록이{" "}
                  <b className="text-rose-600">모두 함께 삭제되며 되돌릴 수 없습니다</b>. 근무한 적이
                  있는 직원이라면 삭제하지 말고 퇴사일을 입력하세요.
                </p>
                <ul className="text-sm bg-rose-50/60 border border-rose-100 rounded-lg p-3 space-y-1">
                  {rows.map(([label, n]) => (
                    <li key={label} className="flex justify-between">
                      <span className="text-slate-500">{label}</span>
                      <span className={n > 0 ? "font-bold text-rose-700" : "text-slate-400"}>
                        {n}건
                      </span>
                    </li>
                  ))}
                </ul>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">
                    계속하려면 아래 칸에 <b className="text-rose-600">삭제</b> 를 입력하세요.
                  </label>
                  <input
                    className="input w-full"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder="삭제"
                    autoFocus
                  />
                </div>
                {err && <p className="text-xs text-rose-600">{err}</p>}
              </>
            )}

            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
                취소
              </button>
              {!blocked && summary && (
                <button
                  className="btn-primary bg-rose-600 hover:bg-rose-700 disabled:opacity-40"
                  disabled={phrase !== "삭제" || busy}
                  onClick={doDelete}
                >
                  {busy ? "삭제 중…" : "완전 삭제"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
