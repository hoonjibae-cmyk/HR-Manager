"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Emp {
  id: number;
  name: string;
  department: string | null;
  hasSlack: boolean;
  eligible: boolean;
}

/** 반영 유형 — 부호와 구분을 한 번에 고른다. spread=사용분이라 여러 날로 나눌 수 있다 */
const KINDS = [
  { key: "USE", label: "연차 사용 (차감)", sign: -1, category: "STATUTORY", spread: true },
  { key: "GRANT", label: "연차 부여 (가산)", sign: +1, category: "STATUTORY", spread: false },
  { key: "COMP_USE", label: "대휴 사용 (차감)", sign: -1, category: "COMP", spread: true },
  { key: "COMP_GRANT", label: "대휴 부여 (가산)", sign: +1, category: "COMP", spread: false },
] as const;

/**
 * 운영자가 직원의 연차를 직접 반영한다.
 *
 * 방학처럼 여러 직원에게 같은 휴가를 한 번에 넣는 일이 잦아 **다중 선택**이 기본이고,
 * 사용분을 2일 이상 넣으면 서버가 시작일부터 **평일 기준**으로 하루씩 나눠 기록한다
 * (주말·공휴일은 건너뛴다). 어느 날짜에 들어갈지는 제출 전에 미리보기로 보여준다.
 */
export default function LeaveAdjust({ employees }: { employees: Emp[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const today = new Date().toISOString().slice(0, 10);

  const [sel, setSel] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [f, setF] = useState({
    kind: "USE" as (typeof KINDS)[number]["key"],
    date: today,
    days: "1",
    note: "",
    notify: true,
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const kind = KINDS.find((k) => k.key === f.kind)!;
  const depts = useMemo(
    () =>
      Array.from(new Set(employees.map((e) => e.department).filter(Boolean) as string[])).sort(
        (a, b) => a.localeCompare(b, "ko")
      ),
    [employees]
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (needle && !`${e.name}${e.department ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [employees, q, dept]);

  const selected = useMemo(
    () => employees.filter((e) => sel.includes(e.id)),
    [employees, sel]
  );
  const noSlack = selected.filter((e) => !e.hasSlack);
  const canNotify = selected.some((e) => e.hasSlack);
  const ineligible = selected.filter((e) => !e.eligible);

  const amount = Number(f.days);
  const willSpread = kind.spread && Number.isInteger(amount) && amount >= 2;

  const toggle = (id: number) =>
    setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const selectShown = () => setSel((p) => Array.from(new Set([...p, ...shown.map((e) => e.id)])));
  const clearShown = () => setSel((p) => p.filter((id) => !shown.some((e) => e.id === id)));

  // 실제로 어느 날짜에 들어갈지는 공휴일 표를 봐야 알 수 있어 서버에 물어본다.
  // 입력이 잠잠해진 뒤에만 부른다 (타이핑 중 매번 부르지 않게).
  useEffect(() => {
    if (!open || result) return;
    if (!sel.length || !f.date || !(amount > 0)) return setPreview(null);
    const body = {
      employeeIds: sel,
      kind: f.kind,
      date: f.date,
      days: amount,
      preview: true,
    };
    const ac = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch("/api/leave/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      }).catch(() => null);
      if (ac.signal.aborted || !res) return;
      const j = await res.json().catch(() => null);
      setPreview(res.ok ? j : null);
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [open, result, sel, f.kind, f.date, amount]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/leave/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeIds: sel,
        kind: f.kind,
        date: f.date,
        days: amount,
        note: f.note || null,
        notify: f.notify && canNotify,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error || "반영에 실패했습니다.");
    setResult(j);
    router.refresh();
  }

  function reset() {
    setResult(null);
    setPreview(null);
    setErr("");
    setSel([]);
    setQ("");
    setDept("");
    setF({ kind: "USE", date: today, days: "1", note: "", notify: true });
  }

  function close() {
    setOpen(false);
    reset();
  }

  if (!open)
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + 연차 반영
      </button>
    );

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="card w-full max-w-3xl my-8 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">연차 반영</h2>
            <p className="text-xs text-slate-500 mt-1">
              운영자가 직원의 연차를 직접 기록합니다. 신청·승인 절차 없이 바로 반영되며,
              구글 캘린더에는 올리지 않습니다.
            </p>
          </div>
          <button className="btn-ghost" onClick={close}>
            닫기
          </button>
        </div>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm">
              <b>{result.results.length}명</b>에게 반영했습니다 — {result.kindLabel}{" "}
              {result.totalDays}일 ({result.dateText})
            </p>
            <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100">
              {result.results.map((r: any) => (
                <div key={r.name} className="px-3 py-2 text-sm flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{r.name}</span>
                  <span className="text-xs text-slate-500 tnum">
                    반영 후 잔여 연차 <b className="text-brand-600">{r.remaining}일</b> · 대휴{" "}
                    {r.compRemaining}일
                  </span>
                </div>
              ))}
            </div>
            {!!result.excluded?.length && (
              <p className="text-xs text-amber-600">
                완전비율제(위탁) {result.excluded.length}명 제외: {result.excluded.join(", ")}
              </p>
            )}
            <p className="text-xs text-slate-400">
              {result.notified == null
                ? "슬랙 알림은 보내지 않았습니다."
                : `슬랙 DM ${result.notified}명 발송` +
                  (result.notifyFailed
                    ? ` · ${result.notifyFailed}명 실패${
                        result.notifyError ? ` (${result.notifyError})` : ""
                      }`
                    : "")}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-outline" onClick={reset}>
                계속 반영
              </button>
              <button className="btn-primary" onClick={close}>
                완료
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="grid md:grid-cols-2 gap-5">
            {/* 왼쪽 — 대상 직원 다중선택 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">
                  대상 직원 * <span className="text-brand-600">{sel.length}명 선택</span>
                </label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="text-xs text-brand-600 hover:underline"
                    onClick={selectShown}
                  >
                    {dept || q ? "이 목록 전체" : "전체 선택"}
                  </button>
                  <span className="text-slate-300 text-xs">|</span>
                  <button
                    type="button"
                    className="text-xs text-slate-400 hover:underline"
                    onClick={clearShown}
                  >
                    해제
                  </button>
                </div>
              </div>

              <div className="flex gap-2 mb-2">
                <input
                  className="input py-1 text-xs flex-1"
                  placeholder="이름 검색"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <select
                  className="input py-1 text-xs w-32"
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                >
                  <option value="">부서 전체</option>
                  {depts.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border border-slate-200 rounded-lg h-72 overflow-y-auto divide-y divide-slate-50">
                {shown.length === 0 ? (
                  <p className="text-xs text-slate-400 p-3">조건에 맞는 직원이 없습니다.</p>
                ) : (
                  shown.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={sel.includes(e.id)}
                        onChange={() => toggle(e.id)}
                      />
                      <span className="font-semibold text-slate-700">{e.name}</span>
                      <span className="text-xs text-slate-400">{e.department ?? "-"}</span>
                      {!e.eligible && (
                        <span className="pill bg-slate-100 text-slate-500 ml-auto">연차 미적용</span>
                      )}
                      {e.eligible && !e.hasSlack && (
                        <span className="pill bg-amber-50 text-amber-600 ml-auto">슬랙 미연결</span>
                      )}
                    </label>
                  ))
                )}
              </div>
              {ineligible.length > 0 && kind.category === "STATUTORY" && (
                <p className="text-[11px] text-amber-600 mt-1">
                  연차 미적용 {ineligible.length}명 포함 ({ineligible.map((e) => e.name).join(", ")})
                  — 부여로 반영하면 그만큼만 쓸 수 있습니다.
                </p>
              )}
            </div>

            {/* 오른쪽 — 반영 내용 */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">유형 *</label>
                  <select
                    className="input"
                    value={f.kind}
                    onChange={(e) => set("kind", e.target.value)}
                  >
                    {KINDS.map((k) => (
                      <option key={k.key} value={k.key}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">일수 *</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    required
                    className="input"
                    value={f.days}
                    onChange={(e) => set("days", e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label">{kind.sign < 0 ? "시작일 *" : "부여일 *"}</label>
                <input
                  type="date"
                  required
                  className="input"
                  value={f.date}
                  onChange={(e) => set("date", e.target.value)}
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  {kind.spread
                    ? "일수가 2일 이상이면 시작일부터 평일 기준으로 하루씩 나눠 반영합니다 (주말·공휴일 제외)."
                    : "부여는 이 날짜 하루에 몰아서 기록합니다."}
                </p>
              </div>

              {preview && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
                  <div className="font-semibold text-slate-700 mb-1">
                    반영 예정 — {preview.targets.length}명 × {preview.perDay}일 ×{" "}
                    {preview.dates.length}일자
                  </div>
                  <div className="text-slate-600 tnum leading-relaxed">{preview.dateText}</div>
                  {preview.spread && (
                    <div className="text-slate-400 mt-1">
                      주말·공휴일을 건너뛴 평일 {preview.dates.length}일입니다.
                    </div>
                  )}
                  {!!preview.excluded?.length && (
                    <div className="text-amber-600 mt-1">
                      완전비율제(위탁) 제외: {preview.excluded.join(", ")}
                    </div>
                  )}
                </div>
              )}
              {willSpread && !preview && (
                <p className="text-[11px] text-slate-400">반영 날짜를 계산하는 중…</p>
              )}

              <div>
                <label className="label">사유 (선택)</label>
                <input
                  className="input"
                  placeholder="예: 여름방학 일괄 부여"
                  value={f.note}
                  onChange={(e) => set("note", e.target.value)}
                />
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-0.5"
                  checked={f.notify && canNotify}
                  disabled={!canNotify}
                  onChange={(e) => set("notify", e.target.checked)}
                />
                <span className={canNotify ? "" : "text-slate-400"}>
                  직원에게 슬랙 DM 으로 알리기
                  {noSlack.length > 0 && (
                    <span className="block text-xs text-slate-400">
                      슬랙 미연결 {noSlack.length}명은 알림이 가지 않습니다
                      {canNotify ? "" : " (설정 → 슬랙 연동)"}
                    </span>
                  )}
                </span>
              </label>

              {err && <p className="text-xs text-red-600">{err}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-ghost" onClick={close}>
                  취소
                </button>
                <button className="btn-primary" disabled={busy || !sel.length}>
                  {busy ? "반영 중…" : `${sel.length || ""}명 반영`}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
