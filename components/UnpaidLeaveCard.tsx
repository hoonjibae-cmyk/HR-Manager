"use client";

/**
 * 무급휴직 카드 — 직원 상세 화면. 기간을 등록·수정·삭제한다.
 *
 * 등록한 기간만큼 그 달 급여가 **역일수**로 일할된다(lib/unpaid-leave.ts — 월중 입·퇴사와 같은 방식).
 * 연차가 아니라 연차 잔여와 무관하고, 연차 발생·근속도 바뀌지 않는다.
 *
 *  · **넣기 전에 얼마나 줄어드는지 보여 준다** — 달마다 「지급 15일/30일(50%)」. 서버와 같은 함수로 세므로
 *    미리보기와 실제 산정이 갈리지 않는다.
 *  · **검사도 서버와 같은 함수**(`unpaidLeaveError`) — 화면이 통과시킨 것을 서버가 막거나 그 반대가 없다.
 *  · **급여를 여기서 다시 산정하지 않는다.** 이미 산정한 달이 있으면 그 달을 이름으로 적고 급여 화면으로
 *    잇는다 — 다른 화면에서 급여 기록이 조용히 바뀌면 무엇이 왜 달라졌는지 따라갈 수 없다.
 *    등록 직후에만 알리면 잊으므로 **카드가 늘** 다시 산정할 달을 띄운다(서버가 페이지를 그릴 때 함께 내려준다).
 */

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  monthPayDays,
  monthsOfSpan,
  parseYmd,
  spanDays,
  unpaidLeaveError,
  UNPAID_LEAVE_EFFECT_NOTE,
  UNPAID_SEVERANCE_NOTE,
  UNPAID_REASON_MAX,
} from "@/lib/unpaid-leave";

export interface UnpaidLeaveRow {
  id: number;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  createdBy: string;
}

export interface UnpaidImpactRow {
  year: number;
  month: number;
  unpaidDays: number;
  daysInMonth: number;
  state: "NONE" | "OK" | "STALE" | "SENT";
  gross: number | null;
}

interface Props {
  employeeId: number;
  /** YYYY-MM-DD */
  hireDate: string;
  resignDate: string | null;
  /** 위탁계약(프리랜서) — 새로 등록할 수 없다(이미 있는 기록은 지울 수 있게 보여 준다) */
  contractor: boolean;
  /** 완전비율제 — 매출 기준이라 일할하지 않는다는 것을 미리 적는다 */
  ratio: boolean;
  leaves: UnpaidLeaveRow[];
  impacts: UnpaidImpactRow[];
}

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const dot = (ymd: string) => ymd.replace(/-/g, ".");

export default function UnpaidLeaveCard(props: Props) {
  const { employeeId, contractor, ratio, leaves } = props;
  const router = useRouter();
  const [impacts, setImpacts] = useState<UnpaidImpactRow[]>(props.impacts);
  // null = 닫힘 · "new" = 새로 등록 · 숫자 = 그 건 수정
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hire = useMemo(() => parseYmd(props.hireDate)!, [props.hireDate]);
  const resign = useMemo(() => (props.resignDate ? parseYmd(props.resignDate) : null), [props.resignDate]);

  // 서버가 내려준 값이 바뀌면(등록·삭제 뒤 새로 그린 페이지) 그쪽을 따른다
  React.useEffect(() => setImpacts(props.impacts), [props.impacts]);

  /** 수정 중인 건을 뺀 나머지 — 겹침 검사와 미리보기에 쓴다 */
  const others = useMemo(
    () =>
      leaves
        .filter((l) => l.id !== editing)
        .map((l) => ({ startDate: parseYmd(l.startDate)!, endDate: parseYmd(l.endDate)! })),
    [leaves, editing]
  );

  const formError = useMemo(() => {
    if (editing == null || (!startDate && !endDate)) return null;
    return unpaidLeaveError(
      { startDate, endDate, reason },
      { hireDate: hire, resignDate: resign, contractor, others }
    );
  }, [editing, startDate, endDate, reason, hire, resign, contractor, others]);

  /** 넣으려는 기간이 달마다 급여를 얼마나 줄이는지 — 서버 산정과 같은 함수 */
  const preview = useMemo(() => {
    const s = parseYmd(startDate);
    const e = parseYmd(endDate);
    if (!s || !e || s > e || formError) return [];
    const all = [...others, { startDate: s, endDate: e }];
    return monthsOfSpan(s, e, 12).map(({ year, month }) => ({
      year,
      month,
      ...monthPayDays(year, month, hire, resign, all),
    }));
  }, [startDate, endDate, formError, others, hire, resign]);

  function open(target: number | "new") {
    setErr(null);
    setEditing(target);
    if (target === "new") {
      setStartDate("");
      setEndDate("");
      setReason("");
    } else {
      const l = leaves.find((x) => x.id === target)!;
      setStartDate(l.startDate);
      setEndDate(l.endDate);
      setReason(l.reason);
    }
  }

  async function save() {
    if (formError || !startDate || !endDate) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(
      editing === "new"
        ? `/api/employees/${employeeId}/unpaid-leaves`
        : `/api/employees/${employeeId}/unpaid-leaves/${editing}`,
      {
        method: editing === "new" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, reason }),
      }
    );
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? "저장하지 못했습니다.");
      return;
    }
    setEditing(null);
    if (j.notice) alert(j.notice);
    router.refresh();
  }

  async function remove(l: UnpaidLeaveRow) {
    if (
      !confirm(
        `무급휴직 ${dot(l.startDate)} ~ ${dot(l.endDate)} (${l.days}일)을 지울까요?\n\n` +
          `지우면 그 기간의 급여가 다시 지급 대상이 됩니다. 이미 산정해 둔 달은 급여 화면에서 다시 산정해야 반영됩니다.`
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/employees/${employeeId}/unpaid-leaves/${l.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      alert(j.error ?? "지우지 못했습니다.");
      return;
    }
    if (j.notice) alert(j.notice);
    router.refresh();
  }

  // 다시 산정해야 하는 달 — 등록 직후에만 알리면 잊는다. 카드가 늘 띄운다
  const stale = impacts.filter((i) => i.state === "STALE");
  const sent = impacts.filter((i) => i.state === "SENT");
  const ym = (i: UnpaidImpactRow) => `${i.year}년 ${i.month}월`;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-slate-800">무급휴직</h2>
        {!contractor && editing == null && (
          <button className="text-xs text-brand-600 font-semibold" onClick={() => open("new")}>
            ＋ 기간 등록
          </button>
        )}
      </div>

      {(stale.length > 0 || sent.length > 0) && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-900 mb-3 leading-relaxed break-keep">
          {stale.length > 0 && (
            <div>
              <b>⚠ 급여에 아직 반영되지 않았습니다</b> — {stale.map(ym).join(", ")} 급여가 이미 산정돼 있습니다.{" "}
              <Link href="/payroll" className="underline font-semibold">
                급여 화면
              </Link>
              에서 그 달의 <b>급여 일괄 산정</b>을 다시 누르세요.
            </div>
          )}
          {sent.length > 0 && (
            <div className={stale.length ? "mt-1.5" : ""}>
              <b>⚠ 명세서가 이미 발송된 달입니다</b> — {sent.map(ym).join(", ")}. <b>발송 잠금 해제</b> 후 다시
              산정하고 정정 명세서를 보내야 합니다.
            </div>
          )}
        </div>
      )}

      {leaves.length === 0 ? (
        <p className="text-sm text-slate-400 break-keep">
          {contractor
            ? "위탁계약(프리랜서)은 근로자가 아니라 무급휴직 대상이 아닙니다."
            : "등록된 무급휴직이 없습니다."}
        </p>
      ) : (
        <ul className="space-y-2">
          {leaves.map((l) => (
            <li key={l.id} className="text-sm border border-slate-100 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-700 whitespace-nowrap">
                  {dot(l.startDate)} ~ {dot(l.endDate)}
                </span>
                <span className="pill bg-amber-50 text-amber-700 text-[11px] whitespace-nowrap">{l.days}일</span>
              </div>
              {l.reason && <div className="text-xs text-slate-500 mt-1 break-keep">{l.reason}</div>}
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] text-slate-300">{l.createdBy ? `등록 ${l.createdBy}` : ""}</span>
                <span className="flex gap-3">
                  {!contractor && (
                    <button
                      className="text-[11px] text-slate-400 hover:text-brand-600"
                      disabled={busy}
                      onClick={() => open(l.id)}
                    >
                      수정
                    </button>
                  )}
                  <button
                    className="text-[11px] text-slate-400 hover:text-rose-600"
                    disabled={busy}
                    onClick={() => remove(l)}
                  >
                    삭제
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing != null && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
          <div className="text-xs font-semibold text-slate-600">
            {editing === "new" ? "무급휴직 등록" : "무급휴직 수정"}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-slate-500">첫날</span>
              <input
                type="date"
                className="input w-full"
                value={startDate}
                min={props.hireDate}
                max={props.resignDate ?? undefined}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">마지막 날 (복귀 전날)</span>
              <input
                type="date"
                className="input w-full"
                value={endDate}
                min={startDate || props.hireDate}
                max={props.resignDate ?? undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] text-slate-500">사유 (내부 기록 — 명세서에 싣지 않습니다)</span>
            <input
              className="input w-full"
              value={reason}
              maxLength={UNPAID_REASON_MAX}
              placeholder="예: 개인 사정"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          {formError && <p className="text-xs text-rose-600 break-keep">{formError}</p>}

          {/* 넣기 전에 얼마나 줄어드는지 — 달마다. 주말·공휴일도 날 수에 든다(역일수) */}
          {preview.length > 0 && (
            <div className="rounded-md bg-white border border-slate-200 p-2.5 text-xs text-slate-600 space-y-1">
              <div className="font-semibold text-slate-700">
                {spanDays(parseYmd(startDate)!, parseYmd(endDate)!)}일 (주말·공휴일 포함 역일수) — 달별 지급
              </div>
              {preview.map((p) => (
                <div key={`${p.year}-${p.month}`} className="flex justify-between gap-2">
                  <span className="whitespace-nowrap">
                    {p.year}.{String(p.month).padStart(2, "0")}
                    <span className="text-slate-400">
                      {" "}
                      · 무급 {p.unpaidDays}일
                      {p.spans.length ? ` (${p.spans.map((s) => (s.from === s.to ? md(s.from) : `${md(s.from)}~${md(s.to)}`)).join(", ")})` : ""}
                    </span>
                  </span>
                  <span className="tnum font-semibold whitespace-nowrap">
                    {ratio ? "일할 안 함" : `지급 ${p.paidDays}/${p.daysInMonth}일 · ${(p.ratio * 100).toFixed(1)}%`}
                  </span>
                </div>
              ))}
              {ratio && (
                <div className="text-amber-700 break-keep">
                  완전비율제는 매출 기준이라 급여를 일할하지 않습니다 — 휴직 기록만 남습니다(최저보장이 있으면 급여
                  화면에서 조정하세요).
                </div>
              )}
              {preview.some((p) => p.employedDays > 0 && p.paidDays === 0) && !ratio && (
                <div className="text-amber-700 break-keep">
                  한 달을 통째로 쉬는 달은 급여 시트에 <b>0원 행</b>으로 남습니다(재직자라 빠지지 않습니다).
                </div>
              )}
            </div>
          )}

          {err && <p className="text-xs text-rose-600 break-keep">{err}</p>}

          <div className="flex justify-end gap-2 pt-0.5">
            <button className="btn-ghost text-xs" disabled={busy} onClick={() => setEditing(null)}>
              취소
            </button>
            <button
              className="btn-primary text-xs"
              disabled={busy || !!formError || !startDate || !endDate}
              onClick={save}
            >
              {busy ? "저장 중…" : editing === "new" ? "등록" : "저장"}
            </button>
          </div>
        </div>
      )}

      {!contractor && (
        <details className="mt-3 text-[11px] text-slate-400 leading-relaxed">
          <summary className="cursor-pointer hover:text-slate-600">무엇이 바뀌나요?</summary>
          <p className="mt-1.5 break-keep">{UNPAID_LEAVE_EFFECT_NOTE}</p>
          <p className="mt-1.5 break-keep">{UNPAID_SEVERANCE_NOTE}</p>
        </details>
      )}
    </div>
  );
}
