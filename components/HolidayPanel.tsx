"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HolidayItem, HolidayCoverage } from "@/lib/holidays";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const label = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${ymd} (${DOW[d.getUTCDay()]})`;
};

/**
 * 공휴일 표 — 관공서 공휴일을 받아 두는 곳.
 *
 * 이 표가 하는 일이 눈에 잘 안 띄어 설명을 함께 둔다: 휴일근로 가산(×1.5/×2.0) ·
 * 직전·내신보강 자동 반영 판정 · 시급제 주휴 개근 판정 · 연차 분할 기록.
 * **비어 있으면 조용히 틀린다**(공휴일 근무가 평일로 잡힌다). 그래서 채움 상태를 늘 보여준다.
 */
export default function HolidayPanel({
  items,
  coverage,
  apiConfigured,
}: {
  items: HolidayItem[];
  coverage: HolidayCoverage;
  apiConfigured: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [extra, setExtra] = useState<HolidayItem[]>([]);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");

  const years = Array.from(new Set(items.map((h) => h.date.slice(0, 4)))).sort();
  const [year, setYear] = useState(String(coverage.years[0]?.year ?? new Date().getFullYear()));
  const shown = items.filter((h) => h.date.startsWith(year));

  async function sync() {
    setBusy(true);
    setErr("");
    setMsg("");
    setExtra([]);
    const res = await fetch("/api/settings/holidays/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const j = await res.json().catch(() => ({}) as any);
    setBusy(false);
    const failed = (j.results ?? []).filter((r: any) => r.error);
    if (failed.length) setErr(failed.map((r: any) => `${r.year}년: ${r.error}`).join(" / "));
    if (j.results)
      setMsg(
        `${j.results.map((r: any) => r.year).join("·")}년 — ${j.added}일 추가` +
          (j.renamed ? ` · ${j.renamed}일 이름 정정` : "") +
          (j.added || j.renamed ? "" : " (이미 최신입니다)")
      );
    setExtra((j.results ?? []).flatMap((r: any) => r.extra ?? []));
    router.refresh();
  }

  /** 인증키 없이 — 코드에 든 초기 표(2025~2027)로 빠진 날만 채운다 */
  async function builtin() {
    setBusy(true);
    setErr("");
    setMsg("");
    setExtra([]);
    const res = await fetch("/api/settings/holidays/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ builtin: true }),
    });
    const j = await res.json().catch(() => ({}) as any);
    setBusy(false);
    if (!res.ok) return setErr(j.error || "채우지 못했습니다.");
    setMsg(j.added ? `초기 표에서 ${j.added}일을 채웠습니다.` : "빠진 날이 없습니다.");
    router.refresh();
  }

  async function add() {
    if (!date || !name.trim()) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/settings/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, name: name.trim() }),
    });
    const j = await res.json().catch(() => ({}) as any);
    setBusy(false);
    if (!res.ok) return setErr(j.error || "저장하지 못했습니다.");
    setDate("");
    setName("");
    router.refresh();
  }

  async function remove(d: string, n: string) {
    if (!confirm(`${label(d)} ${n} 을 표에서 지울까요?\n그날 근무는 휴일근로가 아니라 평일로 잡히게 됩니다.`))
      return;
    setBusy(true);
    await fetch(`/api/settings/holidays?date=${d}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-bold text-sm">공휴일</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            휴일근로 가산 · 보강 자동 반영 · 주휴 개근 · 연차 기록에 함께 쓰인다
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {apiConfigured ? (
            <button className="btn btn-primary text-xs" onClick={sync} disabled={busy}>
              {busy ? "받는 중…" : "공휴일 받아오기"}
            </button>
          ) : (
            <button className="btn btn-primary text-xs" onClick={builtin} disabled={busy}>
              {busy ? "채우는 중…" : "초기 표로 채우기"}
            </button>
          )}
          <button className="btn text-xs" onClick={() => setOpen((v) => !v)}>
            {open ? "접기" : "표 보기"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
        {coverage.years.map((y) => (
          <span
            key={y.year}
            className={`px-2 py-0.5 rounded-full border ${
              y.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-800"
            }`}
          >
            {y.year}년 {y.count}일 {y.ok ? "✓" : "⚠"}
          </span>
        ))}
      </div>

      {coverage.warning && (
        <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800 leading-relaxed">
          ⚠ {coverage.warning}
        </div>
      )}

      {!apiConfigured && (
        <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-600 leading-relaxed">
          자동으로 받아오려면 환경변수 <code className="font-mono">HOLIDAY_API_KEY</code> 에 공공데이터포털
          「한국천문연구원_특일 정보」 인증키를 넣으세요. 신청은 무료이고 바로 승인됩니다.
          <b>Encoding·Decoding 어느 쪽을 넣어도 됩니다</b>(앱이 알아서 맞춥니다).
          발급 직후에는 등록까지 1시간쯤 걸립니다.
          넣어 두면 표가 모자랄 때 <b>크론이 알아서 채웁니다</b>. 지금은 <b>초기 표로 채우기</b>(코드에 든
          2025~2027년 표에서 빠진 날만 넣습니다)나 아래 직접 입력을 쓰세요.
          <br />
          <span className="text-slate-400">
            음력 명절·대체공휴일·임시공휴일은 규칙만으로는 나오지 않아 밖에서 받아 오는 편이 맞습니다.
          </span>
        </div>
      )}

      {msg && <div className="mt-2 text-[11px] text-slate-500">{msg}</div>}
      {/* 에러에는 '다음에 뭘 하면 되는지' 가 줄바꿈으로 붙어 온다 (hintFor, lib/holiday-service.ts) */}
      {err && <div className="mt-2 text-[11px] text-rose-600 whitespace-pre-line leading-relaxed">{err}</div>}
      {extra.length > 0 && (
        <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-600">
          표에는 있는데 관공서 공휴일 목록에는 없는 날입니다 —{" "}
          <b>동기화는 지우지 않습니다</b>(학원이 직접 넣은 휴무일일 수 있어서). 필요하면 아래에서 지우세요.
          <div className="mt-1">{extra.map((h) => `${h.date} ${h.name}`).join(" · ")}</div>
        </div>
      )}

      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2 mb-2">
            <select className="input py-1 text-xs w-28" value={year} onChange={(e) => setYear(e.target.value)}>
              {Array.from(new Set([...years, year])).sort().map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-400">{shown.length}일</span>
          </div>

          <div className="max-h-64 overflow-auto rounded-lg border border-slate-100">
            {shown.length === 0 && <div className="p-3 text-xs text-slate-400">등록된 공휴일이 없습니다.</div>}
            {shown.map((h) => (
              <div
                key={h.date}
                className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-slate-50 last:border-0"
              >
                <span className="font-mono text-slate-500">{label(h.date)}</span>
                <span className="flex-1 px-3">{h.name}</span>
                <button className="text-slate-300 hover:text-rose-500" onClick={() => remove(h.date, h.name)} disabled={busy}>
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-2">
            <input type="date" className="input py-1 text-xs w-40" value={date} onChange={(e) => setDate(e.target.value)} />
            <input
              className="input py-1 text-xs flex-1"
              placeholder="휴일 이름 (예: 임시공휴일 · 학원 여름휴무)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn text-xs" onClick={add} disabled={busy || !date || !name.trim()}>
              추가
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
