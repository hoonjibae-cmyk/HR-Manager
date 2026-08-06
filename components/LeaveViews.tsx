"use client";

import type { ReactNode } from "react";
import { useStoredState } from "@/components/TableTools";
import LeaveTable, { type LeaveRow } from "@/components/LeaveTable";
import LeaveCalendar from "@/components/LeaveCalendar";
import type { LeaveDay } from "@/lib/leave-calendar";

type View = "table" | "calendar";

/**
 * 표 / 달력 전환.
 *
 * **아래로 이어 붙이지 않고 탭으로 가른 이유**: 이 화면은 창 높이에 맞춰 두 층으로 잡혀 있고
 * (머리글 고정 + 행만 스크롤, CLAUDE.md) 표 밑에 달력을 또 두면 그 구조가 무너져 둘 다
 * 반쯤만 보인다. 둘은 보는 목적도 다르다 — 표는 '누가 얼마나 남았나', 달력은 '그날 누가 없나'.
 *
 * 고른 탭은 브라우저에 기억한다(표의 필터·정렬과 같은 규칙). 서버가 그린 첫 화면은 반드시
 * 기본값(표)이어야 하이드레이션이 어긋나지 않으므로, 저장값은 `useStoredState` 가
 * 마운트 뒤에 얹는다.
 */
export default function LeaveViews({
  rows,
  rangeLabel,
  days,
  holidays,
  year,
  month,
}: {
  rows: LeaveRow[];
  rangeLabel: ReactNode;
  days: LeaveDay[];
  holidays: Array<{ date: string; name: string }>;
  year: number;
  month: number;
}) {
  const [view, setView] = useStoredState<View>("yoossam.table.leave.view", "table", (v) =>
    v === "calendar" ? "calendar" : "table"
  );

  const tab = (v: View, label: string) => (
    <button
      onClick={() => setView(v)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
        view === v ? "bg-brand-50 text-brand-700" : "text-slate-400 hover:text-slate-600"
      }`}
      aria-pressed={view === v}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="flex items-center gap-1 mb-2 shrink-0">
        {tab("table", "표 보기")}
        {tab("calendar", "달력 보기")}
        <span className="text-[11px] text-slate-400 ml-2">
          {view === "table" ? "직원별 발생·사용·잔여" : "그날 누가 자리를 비우는지"}
        </span>
      </div>

      {view === "table" ? (
        <LeaveTable rows={rows} rangeLabel={rangeLabel} />
      ) : (
        <LeaveCalendar days={days} holidays={holidays} initialYear={year} initialMonth={month} />
      )}
    </>
  );
}
