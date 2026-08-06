"use client";

import { useMemo, useState } from "react";
import { won } from "@/lib/format";
import {
  buildPayrollTrend,
  chartPoints,
  chartTicks,
  niceMax,
  shortWon,
  TREND_MODE_LABEL,
  type TrendMode,
  type TrendRecord,
} from "@/lib/payroll-trend";
import { FilterSelect, type FilterValues } from "@/components/TableTools";

/** 계열 색 — 여덟 가지를 돌려 쓴다. 붉은 계열은 경고와 겹쳐 피한다 */
const COLORS = [
  "#2563eb", // blue
  "#059669", // emerald
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#65a30d", // lime
  "#c026d3", // fuchsia
  "#475569", // slate
];

const W = 720; // 그리기 영역 (viewBox 기준 — 실제 폭은 CSS 가 정한다)
const H = 200;
const PAD = { top: 12, right: 16, bottom: 26, left: 56 };

/**
 * 월별 급여 추이 — 꺾은선.
 *
 * 차트 라이브러리를 넣지 않고 **인라인 SVG** 로 그린다. 점이 많아야 수십 개(월 단위)라
 * 라이브러리를 들일 만큼 복잡하지 않고, 원화 표기·한글 라벨을 그대로 다루기도 쉽다.
 */
export default function PayrollTrendChart({ records }: { records: TrendRecord[] }) {
  const [mode, setMode] = useState<TrendMode>("TOTAL");
  const [only, setOnly] = useState<FilterValues>([]);
  const [hover, setHover] = useState<number | null>(null);

  // 갈래를 바꾸면 이전 갈래의 계열 선택은 뜻이 없어진다
  const changeMode = (m: TrendMode) => {
    setMode(m);
    setOnly([]);
  };

  const all = useMemo(() => buildPayrollTrend(records, mode), [records, mode]);
  const trend = useMemo(() => buildPayrollTrend(records, mode, only), [records, mode, only]);

  const { months, series } = trend;
  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };

  // 세로 눈금은 **보이는 계열의 최댓값**에 맞춘다 — 총계에 맞추면 작은 계열이 바닥에 깔린다.
  // 거기서 조금 위의 깔끔한 수로 올려 선이 천장에 붙지 않고 눈금도 읽을 수 있게 한다.
  const max = useMemo(() => {
    let m = 0;
    for (const mo of months) for (const s of series) m = Math.max(m, mo.values[s.key] ?? 0);
    return niceMax(m);
  }, [months, series]);

  const xs = useMemo(
    () => chartPoints(months.map(() => 0), 1, inner.w, inner.h).map((p) => p.x),
    [months, inner.w, inner.h]
  );

  if (!months.length)
    return (
      <div className="card p-6 text-sm text-slate-400 text-center">
        아직 산정된 급여가 없습니다. 급여를 산정하면 월별 추이가 여기에 나옵니다.
      </div>
    );

  const ticks = chartTicks(max);
  const at = hover != null ? months[hover] : null;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <span className="font-bold text-slate-800">월별 급여 추이</span>
        <span className="text-xs text-slate-400">
          급여가 산정된 {months.length}개월 · 합계 {won(trend.grandTotal)}
        </span>

        <div className="flex items-center gap-1.5 text-xs ml-auto">
          <span className="text-slate-400 whitespace-nowrap">분류</span>
          <select
            className={`input py-1 text-xs w-auto ${mode !== "TOTAL" ? "border-brand-300 text-brand-700" : ""}`}
            value={mode}
            onChange={(e) => changeMode(e.target.value as TrendMode)}
          >
            {(Object.keys(TREND_MODE_LABEL) as TrendMode[]).map((m) => (
              <option key={m} value={m}>
                {TREND_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>

        {mode !== "TOTAL" && all.series.length > 1 && (
          <FilterSelect
            label={TREND_MODE_LABEL[mode].replace("별", "")}
            value={only}
            onChange={setOnly}
            options={all.series.map((s) => ({ value: s.key, label: s.label }))}
            allLabel="전부 보기"
          />
        )}
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[32rem]"
          style={{ height: H }}
          role="img"
          aria-label="월별 급여 추이 꺾은선 그래프"
        >
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {/* 가로 눈금선 + 금액 */}
            {ticks.map((t) => {
              const y = inner.h - (max > 0 ? (t / max) * inner.h : 0);
              return (
                <g key={t}>
                  <line x1={0} x2={inner.w} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
                  <text x={-8} y={y + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
                    {shortWon(t)}
                  </text>
                </g>
              );
            })}

            {/* 마우스가 짚은 달 세로선 */}
            {hover != null && (
              <line
                x1={xs[hover]}
                x2={xs[hover]}
                y1={0}
                y2={inner.h}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {/* 계열마다 한 줄 */}
            {series.map((s, si) => {
              const color = COLORS[si % COLORS.length];
              const pts = chartPoints(
                months.map((m) => m.values[s.key] ?? 0),
                max,
                inner.w,
                inner.h
              );
              const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
              return (
                <g key={s.key}>
                  <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
                  {pts.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={hover === i ? 4 : 2.5}
                      fill="#fff"
                      stroke={color}
                      strokeWidth={2}
                    />
                  ))}
                </g>
              );
            })}

            {/* 달 이름 + 마우스를 받는 넓은 띠 (점만 노리면 짚기 어렵다) */}
            {months.map((m, i) => (
              <g key={m.ym}>
                <text
                  x={xs[i]}
                  y={inner.h + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill={hover === i ? "#334155" : "#94a3b8"}
                  fontWeight={hover === i ? 700 : 400}
                >
                  {m.label}
                </text>
                <rect
                  x={xs[i] - (months.length > 1 ? inner.w / (months.length - 1) / 2 : inner.w / 2)}
                  y={0}
                  width={months.length > 1 ? inner.w / (months.length - 1) : inner.w}
                  height={inner.h}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            ))}
          </g>
        </svg>
      </div>

      {/* 짚은 달의 값 — 그래프 위에 띄우면 선을 가린다 */}
      <div className="mt-3 border-t border-slate-100 pt-3 min-h-[3.5rem]">
        {at ? (
          <div className="text-xs">
            <div className="flex items-baseline gap-2 mb-1.5">
              <b className="text-slate-800 text-sm">
                {at.year}년 {at.month}월
              </b>
              <span className="text-slate-400">{at.count}명</span>
              <span className="ml-auto tnum font-semibold text-slate-700">
                지급액 계 {won(at.total)}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {series.map((s, si) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: COLORS[si % COLORS.length] }}
                  />
                  <span className="text-slate-500">{s.label}</span>
                  <span className="tnum text-slate-700">{won(at.values[s.key] ?? 0)}</span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {series.map((s, si) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: COLORS[si % COLORS.length] }}
                />
                <span className="text-slate-500">{s.label}</span>
                <span className="tnum text-slate-400">{won(s.total)}</span>
              </span>
            ))}
            <span className="text-slate-300 ml-auto">그래프에 마우스를 올리면 그 달 값이 나옵니다</span>
          </div>
        )}
      </div>

      {only.length > 0 && (
        <p className="text-[11px] text-slate-400 mt-2">
          일부 계열만 보고 있습니다 — 위의 <b>지급액 계</b>는 거른 것과 무관하게 그 달 전체입니다.
        </p>
      )}
    </div>
  );
}
