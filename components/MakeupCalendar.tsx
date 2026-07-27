"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MAKEUP_CATEGORY_LABEL, MAKEUP_STATUS_LABEL } from "@/lib/constants";
import type { MakeupRow } from "@/lib/makeup-service";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const won = (n: number) => n.toLocaleString("ko-KR");

export interface MakeupTotal {
  employeeId: number;
  name: string;
  department: string | null;
  payScheme: string;
  excludedByScheme: boolean;
  missingSchedule: boolean;
  hourlyWage: number;
  amount: number;
  result: {
    overtimeHours: number;
    holidayHours: number;
    holidayOverHours: number;
    nightHours: number;
    pendingDecision: number;
  };
}

/** 상태·구분에 따른 칩 색 — 달력에서 한눈에 갈라 보이게 */
function chipTone(r: MakeupRow): string {
  if (r.status === "CANCELED" || r.status === "NOSHOW") return "bg-slate-100 text-slate-400 line-through";
  if (r.needsDecision) return "bg-amber-100 text-amber-800";
  if (r.status !== "CONFIRMED") return "bg-slate-100 text-slate-600";
  if (r.kind?.includes("HOLIDAY")) return "bg-rose-100 text-rose-800";
  if (r.kind?.includes("OVERTIME")) return "bg-indigo-100 text-indigo-800";
  return "bg-emerald-100 text-emerald-800"; // 확정됐지만 수당 대상 아님
}

export default function MakeupCalendar({
  year,
  month,
  rows,
  totals,
  holidays,
  examPeriods,
  calendarSynced,
}: {
  year: number;
  month: number;
  rows: MakeupRow[];
  totals: MakeupTotal[];
  holidays: Array<{ date: string; name: string }>;
  examPeriods: Array<{ id: number; name: string; startDate: string; endDate: string; capHours: number }>;
  calendarSynced: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<MakeupRow | null>(null);
  const [dept, setDept] = useState("");
  const [emp, setEmp] = useState("");

  const holidayMap = useMemo(
    () => new Map(holidays.map((h) => [h.date, h.name])),
    [holidays]
  );
  const depts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter(Boolean) as string[])).sort(),
    [rows]
  );
  const emps = useMemo(
    () =>
      Array.from(new Map(rows.map((r) => [r.employeeId, r.name])).entries()).sort((a, b) =>
        a[1].localeCompare(b[1], "ko")
      ),
    [rows]
  );

  const shown = useMemo(
    () =>
      rows.filter(
        (r) => (!dept || r.department === dept) && (!emp || String(r.employeeId) === emp)
      ),
    [rows, dept, emp]
  );

  const byDate = useMemo(() => {
    const m = new Map<string, MakeupRow[]>();
    for (const r of shown) (m.get(r.date) ?? m.set(r.date, []).get(r.date)!).push(r);
    return m;
  }, [shown]);

  // 달력 격자 (일요일 시작, 앞뒤 빈칸 포함)
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lead = first.getUTCDay();
    const out: Array<string | null> = Array(lead).fill(null);
    for (let d = 1; d <= days; d++)
      out.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [year, month]);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  const pending = totals.reduce((a, t) => a + t.result.pendingDecision, 0);
  const unconfirmed = shown.filter((r) => r.status === "PLANNED").length;
  const totalAmount = totals.reduce((a, t) => a + t.amount, 0);
  const examOfMonth = examPeriods.filter(
    (e) => e.startDate.slice(0, 7) <= `${year}-${String(month).padStart(2, "0")}` &&
      e.endDate.slice(0, 7) >= `${year}-${String(month).padStart(2, "0")}`
  );

  return (
    <div>
      {/* 월 이동 + 요약 */}
      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <Link href={`/makeup?year=${prev.y}&month=${prev.m}`} className="btn-outline py-1 px-2.5">
          ←
        </Link>
        <span className="font-bold text-lg text-slate-800 tnum">
          {year}년 {month}월
        </span>
        <Link href={`/makeup?year=${next.y}&month=${next.m}`} className="btn-outline py-1 px-2.5">
          →
        </Link>

        <div className="flex items-center gap-2 ml-2">
          <select className="input py-1 text-xs w-28" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">부서 전체</option>
            {depts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select className="input py-1 text-xs w-32" value={emp} onChange={(e) => setEmp(e.target.value)}>
            <option value="">직원 전체</option>
            {emps.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-4 text-sm">
          {unconfirmed > 0 && (
            <span className="text-slate-500">
              실근무 미확인 <b className="text-slate-700">{unconfirmed}건</b>
            </span>
          )}
          {pending > 0 && (
            <span className="text-amber-600">
              수당 판단 필요 <b>{pending}건</b>
            </span>
          )}
          <span className="text-slate-500">
            이 달 오버타임 <b className="text-brand-600 tnum">{won(totalAmount)}원</b>
          </span>
        </div>
      </div>

      {examOfMonth.length > 0 && (
        <p className="text-xs text-slate-500 mb-3">
          📌 이 달의 내신 기간:{" "}
          {examOfMonth.map((e) => `${e.name} (${e.startDate} ~ ${e.endDate}, 상한 ${e.capHours}시간)`).join(" · ")}
        </p>
      )}

      {/* 달력 */}
      <div className="card overflow-hidden mb-6">
        <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-100">
          {WEEK.map((w, i) => (
            <div
              key={w}
              className={`px-2 py-2 text-xs font-bold text-center ${
                i === 0 ? "text-rose-500" : i === 6 ? "text-indigo-500" : "text-slate-500"
              }`}
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const list = d ? byDate.get(d) ?? [] : [];
            const dow = i % 7;
            const hol = d ? holidayMap.get(d) : undefined;
            return (
              <div
                key={i}
                className={`min-h-[104px] border-b border-r border-slate-100 p-1.5 ${
                  d ? "" : "bg-slate-50/60"
                }`}
              >
                {d && (
                  <>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span
                        className={`text-xs font-bold tnum ${
                          hol || dow === 0 ? "text-rose-500" : dow === 6 ? "text-indigo-500" : "text-slate-500"
                        }`}
                      >
                        {Number(d.slice(8))}
                      </span>
                      {hol && <span className="text-[10px] text-rose-400 truncate">{hol}</span>}
                    </div>
                    <div className="space-y-0.5">
                      {list.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setOpen(r)}
                          className={`w-full text-left rounded px-1.5 py-0.5 text-[11px] leading-tight truncate hover:brightness-95 ${chipTone(r)}`}
                          title={`${r.name} · ${MAKEUP_CATEGORY_LABEL[r.category]} · ${r.targetClass}`}
                        >
                          <span className="font-semibold">{r.name}</span>{" "}
                          <span className="tnum">{r.startTime}</span>
                          {r.status === "CONFIRMED" && r.countedHours > 0 && (
                            <span className="tnum"> · {r.countedHours}h</span>
                          )}
                          {r.needsDecision && " ⚠"}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 mb-6">
        <span className="pill bg-slate-100 text-slate-600">신청됨(미확인)</span>
        <span className="pill bg-indigo-100 text-indigo-800">연장근로</span>
        <span className="pill bg-rose-100 text-rose-800">휴일근로</span>
        <span className="pill bg-emerald-100 text-emerald-800">확정·수당 없음</span>
        <span className="pill bg-amber-100 text-amber-800">수당 판단 필요 ⚠</span>
        {!calendarSynced && (
          <span className="text-amber-600">
            · 보강캘린더가 연결되지 않았습니다 (GOOGLE_MAKEUP_CALENDAR_ID)
          </span>
        )}
      </div>

      {/* 직원별 집계 */}
      <div className="card">
        <div className="px-5 py-3 border-b border-slate-100 font-bold text-slate-800">
          직원별 오버타임 수당 산출{" "}
          <span className="text-xs font-normal text-slate-400">
            (실근무 확정분만 · 급여를 다시 산정하면 명세서에 자동 반영됩니다)
          </span>
        </div>
        {totals.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">이 달 보강 신청이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">직원</th>
                  <th className="th text-right">통상시급</th>
                  <th className="th text-right">연장</th>
                  <th className="th text-right">휴일</th>
                  <th className="th text-right">휴일(8h초과)</th>
                  <th className="th text-right">야간</th>
                  <th className="th text-right">수당</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.employeeId} className="hover:bg-slate-50">
                    <td className="td">
                      <span className="font-semibold text-slate-700">{t.name}</span>
                      <div className="text-xs text-slate-400">{t.department}</div>
                      {t.excludedByScheme && (
                        <span className="pill bg-slate-100 text-slate-500">완전비율제 · 수당 대상 아님</span>
                      )}
                      {t.missingSchedule && !t.excludedByScheme && (
                        <span className="pill bg-amber-50 text-amber-700">근로시간표 없음</span>
                      )}
                      {t.result.pendingDecision > 0 && (
                        <span className="pill bg-amber-100 text-amber-800 ml-1">
                          판단 필요 {t.result.pendingDecision}
                        </span>
                      )}
                    </td>
                    <td className="td text-right tnum text-slate-500">{won(t.hourlyWage)}</td>
                    <td className="td text-right tnum">{t.result.overtimeHours || "-"}</td>
                    <td className="td text-right tnum">{t.result.holidayHours || "-"}</td>
                    <td className="td text-right tnum">{t.result.holidayOverHours || "-"}</td>
                    <td className="td text-right tnum text-slate-500">{t.result.nightHours || "-"}</td>
                    <td className="td text-right tnum font-bold text-brand-600">
                      {t.amount ? `${won(t.amount)}원` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && <DetailModal row={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); router.refresh(); }} />}
    </div>
  );
}

/* ───────────── 상세 · 실근무 확인 ───────────── */

/** ISO(UTC 필드에 담긴 KST 벽시계) → <input type="datetime-local"> 값 */
const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");

function DetailModal({
  row,
  onClose,
  onSaved,
}: {
  row: MakeupRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({
    actualStart: toLocalInput(row.actualStart ?? row.planStart),
    actualEnd: toLocalInput(row.actualEnd ?? row.planEnd),
    reviewNote: row.reviewNote ?? "",
    payEligible: row.payEligible === null ? "" : String(row.payEligible),
    notify: false,
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function send(status?: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/makeup/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        actualStart: f.actualStart ? `${f.actualStart}:00.000Z` : null,
        actualEnd: f.actualEnd ? `${f.actualEnd}:00.000Z` : null,
        reviewNote: f.reviewNote,
        payEligible: f.payEligible === "" ? null : f.payEligible === "true",
        notify: f.notify,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error || "저장하지 못했습니다.");
    onSaved();
  }

  async function remove() {
    if (!confirm("이 보강 신청을 삭제할까요? 보강캘린더 일정도 함께 삭제됩니다.")) return;
    setBusy(true);
    const res = await fetch(`/api/makeup/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setErr("삭제하지 못했습니다.");
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="card w-full max-w-xl my-8 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">
              {row.name} · {MAKEUP_CATEGORY_LABEL[row.category] ?? row.category}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {row.date} {row.startTime}~{row.endTime} ({row.hours}시간) ·{" "}
              {MAKEUP_STATUS_LABEL[row.status] ?? row.status}
              {row.hasGcal && " · 보강캘린더 등록됨"}
            </p>
          </div>
          <button className="btn-ghost" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1 mb-4">
          <div>
            <span className="text-slate-400 text-xs">대상반</span> {row.targetClass}
            {row.headcount ? <span className="text-slate-400"> · 예상 {row.headcount}명</span> : null}
          </div>
          {row.detail && (
            <div className="whitespace-pre-line">
              <span className="text-slate-400 text-xs">세부 보강내역</span>
              <div className="text-slate-600">{row.detail}</div>
            </div>
          )}
          {row.note && (
            <div className="whitespace-pre-line">
              <span className="text-slate-400 text-xs">기타 특이사항</span>
              <div className="text-slate-600">{row.note}</div>
            </div>
          )}
        </div>

        {row.status === "CONFIRMED" && (
          <div className="rounded-lg bg-brand-50 border border-brand-100 p-3 text-sm mb-4">
            산정 결과:{" "}
            {row.countedHours > 0 ? (
              <>
                <b>{row.countedHours}시간</b> 인정 · <b className="text-brand-700">{won(row.amount)}원</b>
              </>
            ) : (
              <span className="text-slate-500">수당 없음</span>
            )}
            {row.reason && <div className="text-xs text-amber-700 mt-1">· {row.reason}</div>}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">실근무 시작</label>
              <input
                type="datetime-local"
                className="input"
                value={f.actualStart}
                onChange={(e) => set("actualStart", e.target.value)}
              />
            </div>
            <div>
              <label className="label">실근무 종료</label>
              <input
                type="datetime-local"
                className="input"
                value={f.actualEnd}
                onChange={(e) => set("actualEnd", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">
              수당 반영{" "}
              {row.needsDecision && <span className="text-amber-600">— 판단이 필요합니다</span>}
            </label>
            <select
              className="input"
              value={f.payEligible}
              onChange={(e) => set("payEligible", e.target.value)}
            >
              <option value="">보강 종류 기본값 따르기</option>
              <option value="true">수당 반영</option>
              <option value="false">수당 미반영</option>
            </select>
          </div>

          <div>
            <label className="label">관리자 메모 (선택)</label>
            <input
              className="input"
              placeholder="예: 학생 3명 실제 참석 확인"
              value={f.reviewNote}
              onChange={(e) => set("reviewNote", e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={f.notify}
              onChange={(e) => set("notify", e.target.checked)}
            />
            직원에게 슬랙 DM 으로 알리기
          </label>

          {err && <p className="text-xs text-red-600">{err}</p>}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost text-red-500" onClick={remove} disabled={busy}>
              삭제
            </button>
            <button type="button" className="btn-outline" onClick={() => send("NOSHOW")} disabled={busy}>
              미실시 처리
            </button>
            <button type="button" className="btn-outline" onClick={() => send()} disabled={busy}>
              저장만
            </button>
            <button className="btn-primary" onClick={() => send("CONFIRMED")} disabled={busy}>
              {busy ? "저장 중…" : "실근무 확정"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
