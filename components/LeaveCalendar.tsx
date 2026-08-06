"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  leaveDaysByDate,
  LEAVE_DAY_STATUS_LABEL,
  POOL_LABEL,
  type LeaveDay,
  type LeavePool,
} from "@/lib/leave-calendar";
import { LEAVE_TYPE_LABEL } from "@/lib/constants";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 칩 색 — **연차 주머니에서 깎이는지**를 먼저 가르고, 그다음 결재 상태를 가른다.
 * 실무에서 제일 먼저 궁금한 것이 "이게 연차에서 나가나" 이고, 그다음이 "결재했나" 다.
 */
function chipTone(d: LeaveDay): string {
  if (d.status === "PENDING") return "bg-amber-100 text-amber-800";
  if (d.status === "CANCEL_PENDING") return "bg-slate-100 text-slate-500 line-through";
  const byPool: Record<LeavePool, string> = {
    ANNUAL: "bg-brand-100 text-brand-800",
    COMP: "bg-violet-100 text-violet-800",
    UNPAID_POOL: "bg-teal-100 text-teal-800",
  };
  return byPool[d.pool];
}

const dayLabel = (n: number) => (n === 0.5 ? "반차" : `${n}일`);

/**
 * 연차 달력 — 보강 화면과 같은 월 달력이다.
 *
 * 표는 '사람마다 얼마나 남았나' 를 보는 자리고, 달력은 **'그날 누가 자리에 없나'** 를 보는
 * 자리다. 방학·연휴처럼 여러 사람이 겹치는 날은 표로는 절대 안 보인다.
 *
 * 월 이동을 URL 이 아니라 **브라우저 안에서** 한다 — 한 해치를 다 받아 두기 때문
 * (수십 명 × 십수 일이라 가볍다). 서버를 다시 부르면 넘길 때마다 화면이 끊긴다.
 */
export default function LeaveCalendar({
  days,
  holidays,
  initialYear,
  initialMonth,
}: {
  days: LeaveDay[];
  holidays: Array<{ date: string; name: string }>;
  initialYear: number;
  initialMonth: number;
}) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [dept, setDept] = useState("");
  const [emp, setEmp] = useState("");
  const [open, setOpen] = useState<LeaveDay | null>(null);

  const holidayMap = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);
  const depts = useMemo(
    () => Array.from(new Set(days.map((d) => d.department).filter(Boolean) as string[])).sort(),
    [days]
  );
  const emps = useMemo(
    () =>
      Array.from(new Map(days.map((d) => [d.employeeId, d.name])).entries()).sort((a, b) =>
        a[1].localeCompare(b[1], "ko")
      ),
    [days]
  );

  const shown = useMemo(
    () => days.filter((d) => (!dept || d.department === dept) && (!emp || String(d.employeeId) === emp)),
    [days, dept, emp]
  );
  const byDate = useMemo(() => leaveDaysByDate(shown), [shown]);

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const out: Array<string | null> = Array(first.getUTCDay()).fill(null);
    for (let d = 1; d <= total; d++)
      out.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [year, month]);

  const move = (delta: number) => {
    const m = month + delta;
    if (m < 1) return (setYear(year - 1), setMonth(12));
    if (m > 12) return (setYear(year + 1), setMonth(1));
    setMonth(m);
  };

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const ofMonth = shown.filter((d) => d.date.startsWith(prefix));
  const usedDays = ofMonth.reduce((a, d) => a + (d.status === "PENDING" ? 0 : d.days), 0);
  const pending = ofMonth.filter((d) => d.status === "PENDING").length;
  const people = new Set(ofMonth.map((d) => d.employeeId)).size;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 월 이동 + 요약 */}
      <div className="card p-3 mb-3 shrink-0 flex flex-wrap items-center gap-3">
        <button className="btn-outline py-1 px-2.5" onClick={() => move(-1)} aria-label="이전 달">
          ←
        </button>
        <span className="font-bold text-lg text-slate-800 tnum">
          {year}년 {month}월
        </span>
        <button className="btn-outline py-1 px-2.5" onClick={() => move(1)} aria-label="다음 달">
          →
        </button>
        <button
          className="btn-outline py-1 px-2.5 text-xs"
          onClick={() => (setYear(initialYear), setMonth(initialMonth))}
        >
          오늘
        </button>

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
          {pending > 0 && (
            <span className="text-amber-600">
              승인 대기 <b>{pending}건</b>
            </span>
          )}
          <span className="text-slate-500">
            이 달 사용 <b className="text-brand-600 tnum">{usedDays}일</b>
            <span className="text-slate-400"> · {people}명</span>
          </span>
        </div>
      </div>

      {/* 달력 — 남은 높이를 채우고 안에서만 스크롤한다 (표 보기와 같은 규칙).
          `auto-rows-fr` 로 주(週) 줄이 남은 높이를 **고르게 나눠 갖는다** — 안 그러면 달마다
          5줄·6줄로 갈리면서 카드 아래에 흰 공백이 남는다. 좁아지면 최소 높이에서 스크롤된다. */}
      <div className="card flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-100 shrink-0">
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
        <div className="grid grid-cols-7 auto-rows-fr flex-1 min-h-0 overflow-auto">
          {cells.map((d, i) => {
            const list = d ? byDate.get(d) ?? [] : [];
            const dow = i % 7;
            const hol = d ? holidayMap.get(d) : undefined;
            return (
              <div
                key={i}
                className={`min-h-[92px] border-b border-r border-slate-100 p-1.5 ${d ? "" : "bg-slate-50/60"}`}
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
                      {list.map((x) => (
                        <button
                          key={x.key}
                          onClick={() => setOpen(x)}
                          className={`w-full text-left rounded px-1.5 py-0.5 text-[11px] leading-tight truncate hover:brightness-95 ${chipTone(x)}`}
                          title={`${x.name} · ${POOL_LABEL[x.pool]} ${dayLabel(x.days)} · ${LEAVE_DAY_STATUS_LABEL[x.status]}${
                            x.span ? ` (${x.span.index}/${x.span.total}일째)` : ""
                          }`}
                        >
                          <span className="font-semibold">{x.name}</span>
                          {x.days === 0.5 && <span> 반차</span>}
                          {x.pool !== "ANNUAL" && <span> {POOL_LABEL[x.pool]}</span>}
                          {x.status === "PENDING" && " ⚠"}
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

      <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 mt-2 shrink-0">
        <span className="pill bg-brand-100 text-brand-800">연차</span>
        <span className="pill bg-violet-100 text-violet-800">대휴</span>
        <span className="pill bg-teal-100 text-teal-800">병가·경조(연차 차감 없음)</span>
        <span className="pill bg-amber-100 text-amber-800">승인 대기 ⚠</span>
        <span className="pill bg-slate-100 text-slate-500 line-through">취소 요청</span>
      </div>

      {open && (
        <div
          className="fixed inset-0 bg-slate-900/30 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(null)}
        >
          <div className="card p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="font-bold text-slate-800">{open.name}</div>
                <div className="text-xs text-slate-400">{open.department ?? "부서 미지정"}</div>
              </div>
              <button className="text-slate-300 hover:text-slate-500" onClick={() => setOpen(null)}>
                ✕
              </button>
            </div>
            <dl className="text-sm space-y-1.5">
              <Row k="날짜" v={open.date + (open.span ? ` (${open.span.index}/${open.span.total}일째)` : "")} />
              <Row k="종류" v={`${LEAVE_TYPE_LABEL[open.leaveType] ?? open.leaveType} · ${dayLabel(open.days)}`} />
              <Row k="차감" v={POOL_LABEL[open.pool] + (open.pool === "UNPAID_POOL" ? " (연차 차감 없음)" : "")} />
              <Row k="상태" v={LEAVE_DAY_STATUS_LABEL[open.status]} />
              {open.note && <Row k="사유" v={open.note} />}
            </dl>
            <Link
              href={`/leave/${open.employeeId}`}
              className="btn-outline w-full mt-4 text-xs justify-center"
            >
              이 직원의 연차 내역 보기 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-slate-400 w-12 shrink-0">{k}</dt>
      <dd className="text-slate-700 flex-1">{v}</dd>
    </div>
  );
}
