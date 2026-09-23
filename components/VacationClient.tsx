"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ATTESTATIONS,
  ASSIGNMENT_STATE_LABEL,
  CONDITION_FIELDS,
  NOTICE_BODY,
  dayLabel,
  emptyContent,
  type NoticeContent,
  type WorkCondition,
} from "@/lib/vacation";

interface NoticeRow {
  id: number;
  status: string;
  title: string;
  version: number;
  hasDraft: boolean;
  dates: number;
  classOff: string;
}
interface Emp {
  id: number;
  name: string;
  department: string | null;
  slack: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "초안",
  PUBLISHED: "게시 중",
  CLOSED: "마감",
  ARCHIVED: "보관",
};
const REQ_LABEL: Record<string, string> = {
  PRE_PENDING: "중간결재 대기",
  PENDING: "승인 대기",
  APPROVED: "승인(차감 반영)",
  CANCEL_PENDING: "취소 요청 중",
  REJECTED: "반려",
  CANCELED: "철회·취소",
};

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `요청 실패 (${res.status})`);
  return j;
}

const kst = (iso: string | null | undefined) =>
  iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 16) + " KST" : "-";

export default function VacationClient({
  notices,
  selectedId,
  employees,
  departments,
}: {
  notices: NoticeRow[];
  selectedId: number | null;
  employees: Emp[];
  departments: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    setBusy(true);
    setErr("");
    try {
      const j = await call("/api/vacation/notices", { method: "POST" });
      router.push(`/vacation?id=${j.id}`);
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <div className="grid lg:grid-cols-[16rem_1fr] gap-4 items-start">
      <aside className="card p-3 space-y-2">
        <button className="btn-primary w-full" onClick={create} disabled={busy}>
          ＋ 새 공고 작성
        </button>
        {err && <p className="text-xs text-red-600" role="alert">{err}</p>}
        {notices.length === 0 && <p className="text-xs text-slate-400 p-2">아직 공고가 없습니다.</p>}
        <nav aria-label="공고 목록" className="space-y-1">
          {notices.map((n) => (
            <a
              key={n.id}
              href={`/vacation?id=${n.id}`}
              className={`block rounded-lg px-3 py-2 text-sm ${n.id === selectedId ? "bg-brand-50 text-brand-700 font-semibold" : "hover:bg-slate-50 text-slate-700"}`}
              aria-current={n.id === selectedId ? "page" : undefined}
            >
              <div className="truncate">{n.title}</div>
              <div className="text-[11px] text-slate-400">
                {STATUS_LABEL[n.status] ?? n.status} · 제{n.version}판{n.hasDraft && n.status !== "DRAFT" ? " · 수정본 작성 중" : ""}
                {n.classOff ? ` · ${n.classOff}` : ""}
              </div>
            </a>
          ))}
        </nav>
      </aside>
      <section>{selectedId ? <NoticePanel key={selectedId} id={selectedId} employees={employees} departments={departments} /> : null}</section>
    </div>
  );
}

function NoticePanel({ id, employees, departments }: { id: number; employees: Emp[]; departments: string[] }) {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<"edit" | "status" | "inquiry" | "history">("status");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const j = await call(`/api/vacation/notices/${id}`);
      setData(j);
      setTab((t) => (j.draft && (!j.dashboard.current || t === "edit") ? "edit" : t));
    } catch (e: any) {
      setErr(e.message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(action: string, confirmText?: string, extra: any = {}) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const j = await call(`/api/vacation/notices/${id}`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
      if (action === "remind") setMsg(`확인 요청을 ${j.delivered}명에게 보냈습니다.${j.failed?.length ? ` 못 보냄: ${j.failed.join(", ")}` : ""}`);
      if (action === "revise") setTab("edit");
      await load();
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  if (!data) return <div className="card p-6 text-sm text-slate-400">{err || "불러오는 중…"}</div>;
  const d = data.dashboard;
  const status = d.notice.status;

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[12rem]">
          <div className="font-bold text-slate-800">{d.content.title}</div>
          <div className="text-xs text-slate-500">
            {STATUS_LABEL[status] ?? status}
            {d.current ? ` · 게시 제${d.current.version}판 (${kst(d.current.publishedAt)}, ${d.current.publishedBy})` : " · 아직 게시하지 않음"}
          </div>
        </div>
        {d.current && status !== "ARCHIVED" && !data.draft && (
          <button className="btn-outline text-xs" onClick={() => act("revise")} disabled={busy}>
            수정본 만들기
          </button>
        )}
        {status === "PUBLISHED" && (
          <>
            <button className="btn-outline text-xs" onClick={() => act("remind", "아직 제출하지 않은 직원에게만 중립적인 확인 요청 DM 을 보냅니다(첫 안내가 닿지 않았던 직원에게는 처음 안내를 다시 보냅니다). 제출한 직원(정상근무 선택 포함)에게는 보내지 않습니다.")} disabled={busy}>
              미응답자 확인 요청
            </button>
            <button className="btn-outline text-xs" onClick={() => act("close", "공고를 마감합니다. 마감 후에도 직원의 변경·문의는 받고 '마감 후 제출'로 기록됩니다. 다른 연차 신청은 막히지 않습니다.")} disabled={busy}>
              마감
            </button>
          </>
        )}
        {status === "CLOSED" && (
          <button className="btn-outline text-xs" onClick={() => act("reopen")} disabled={busy}>
            다시 열기
          </button>
        )}
        {d.current && status !== "ARCHIVED" && (
          <button className="btn-ghost text-xs" onClick={() => act("archive", "공고를 보관합니다. 더는 제출을 받지 않고 기록·신청서는 그대로 남습니다. 되돌릴 수 없습니다.")} disabled={busy}>
            보관
          </button>
        )}
        {!d.current && (
          <button
            className="btn-ghost text-xs text-red-600"
            disabled={busy}
            onClick={async () => {
              if (!confirm("게시하지 않은 초안을 지웁니다.")) return;
              try {
                await call(`/api/vacation/notices/${id}`, { method: "DELETE" });
                router.push("/vacation");
                router.refresh();
              } catch (e: any) {
                setErr(e.message);
              }
            }}
          >
            초안 삭제
          </button>
        )}
      </div>
      {err && <p className="text-sm text-red-600 whitespace-pre-line" role="alert">{err}</p>}
      {msg && <p className="text-sm text-emerald-700" role="status">{msg}</p>}

      <div role="tablist" className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["status", "응답 현황"],
            ...(data.draft ? [["edit", d.current ? `수정본 (제${data.draft.version}판)` : "초안 편집·발행"]] : []),
            ["inquiry", `문의 ${d.inquiries.filter((q: any) => q.status === "OPEN").length || ""}`],
            ["history", "판·처리 이력"],
          ] as [typeof tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? "border-brand-600 text-brand-700 font-semibold" : "border-transparent text-slate-500"}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "edit" && data.draft && (
        <DraftEditor
          id={id}
          initial={data.draft.content}
          version={data.draft.version}
          republish={!!d.current}
          employees={employees}
          departments={departments}
          onPublished={async (m) => {
            setMsg(m);
            setTab("status");
            await load();
            router.refresh();
          }}
        />
      )}
      {tab === "status" && <StatusView id={id} d={d} onChange={load} />}
      {tab === "inquiry" && <Inquiries d={d} onChange={load} />}
      {tab === "history" && <History d={d} />}
    </div>
  );
}

/* ============================== 초안 편집 · 발행 ============================== */

function DraftEditor({
  id,
  initial,
  version,
  republish,
  employees,
  departments,
  onPublished,
}: {
  id: number;
  initial: NoticeContent;
  version: number;
  republish: boolean;
  employees: Emp[];
  departments: string[];
  onPublished: (msg: string) => void;
}) {
  const [c, setC] = useState<NoticeContent>({ ...emptyContent(), ...initial });
  const [saved, setSaved] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [attest, setAttest] = useState<Record<string, boolean>>({});
  const [newDate, setNewDate] = useState("");
  const set = (patch: Partial<NoticeContent>) => {
    setC((p) => ({ ...p, ...patch }));
    setSaved(false);
    setPreview(null);
    setAttest({});
  };

  const targetDeptNames = useMemo(() => {
    const s = new Set(c.targetDepts);
    for (const e of employees) if (c.targetEmployeeIds.includes(e.id) && e.department) s.add(e.department);
    return [...s];
  }, [c.targetDepts, c.targetEmployeeIds, employees]);

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const j = await call(`/api/vacation/notices/${id}`, { method: "PATCH", body: JSON.stringify({ content: c }) });
      setC(j.content);
      setSaved(true);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  async function check() {
    await save();
    setBusy(true);
    try {
      setPreview(await call(`/api/vacation/notices/${id}`, { method: "POST", body: JSON.stringify({ action: "preview" }) }));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  async function publish() {
    if (!confirm(`제${version}판을 게시하고 대상 직원에게 개인 DM 으로 안내합니다.${republish ? "\n이미 제출한 직원은 중요한 조건이 바뀐 경우 '재확인 필요'가 되며, 확정된 연차는 자동으로 취소되지 않습니다." : ""}`)) return;
    setBusy(true);
    setErr("");
    try {
      const j = await call(`/api/vacation/notices/${id}`, { method: "POST", body: JSON.stringify({ action: "publish", attest }) });
      onPublished(`제${j.version}판을 게시했습니다 — 대상 ${j.targets}명, DM ${j.delivered}건 발송${j.failed?.length ? `, 못 보냄: ${j.failed.join(", ")}` : ""}${j.material ? " · 중요 변경(재확인 필요)" : ""}.`);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  function fillWeekdays() {
    if (!c.classOffStart || !c.classOffEnd || c.classOffEnd < c.classOffStart) return setErr("수업 미운영 기간을 먼저 입력하세요.");
    const out: string[] = [];
    for (let t = new Date(`${c.classOffStart}T00:00:00Z`); t <= new Date(`${c.classOffEnd}T00:00:00Z`); t = new Date(t.getTime() + 86400000)) {
      const w = t.getUTCDay();
      if (w !== 0 && w !== 6) out.push(t.toISOString().slice(0, 10));
    }
    set({ dates: [...new Set([...c.dates, ...out])].sort() });
  }

  function toggleUnconfirmed(key: string) {
    const has = c.unconfirmed.includes(key);
    set({ unconfirmed: has ? c.unconfirmed.filter((k) => k !== key) : [...c.unconfirmed, key] });
  }

  const cond = (dept: string): WorkCondition => (c.conditions[dept] ?? { place: "", hours: "", breakTime: "", duties: "", environment: "" }) as WorkCondition;
  const allAttested = ATTESTATIONS.every((a) => attest[a.key]);

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <h2 className="font-semibold text-slate-800">공고 내용 (제{version}판 초안)</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="제목">
            <input className="input" value={c.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="문의 담당자">
            <div className="flex gap-2">
              <select
                className="input"
                aria-label="문의 담당자 직원"
                value={c.contactEmployeeId ?? ""}
                onChange={(e) => {
                  const emp = employees.find((x) => x.id === Number(e.target.value));
                  set({ contactEmployeeId: emp?.id ?? null, contactName: emp ? `${emp.name}${emp.department ? ` (${emp.department})` : ""}` : c.contactName });
                }}
              >
                <option value="">직원 선택 (문의 DM 수신)</option>
                {employees.filter((e) => e.slack).map((e) => (
                  <option key={e.id} value={e.id}>{e.name} · {e.department ?? "-"}</option>
                ))}
              </select>
            </div>
            <input className="input mt-1" placeholder="표시 이름 / 연락처" value={c.contactName} onChange={(e) => set({ contactName: e.target.value })} />
          </Field>
          <Field label="수업 미운영 기간">
            <div className="flex gap-2 items-center">
              <input type="date" className="input" value={c.classOffStart} onChange={(e) => set({ classOffStart: e.target.value })} aria-label="시작" />
              <span>~</span>
              <input type="date" className="input" value={c.classOffEnd} onChange={(e) => set({ classOffEnd: e.target.value })} aria-label="끝" />
            </div>
          </Field>
          <Field label="응답 요청 기한 (근무계획 취합용 — 다른 연차를 막지 않습니다)">
            <input type="date" className="input" value={c.deadline} onChange={(e) => set({ deadline: e.target.value })} />
          </Field>
        </div>

        <Field label={`선택 대상 날짜 (${c.dates.length}일)`}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {c.dates.map((dt) => (
              <span key={dt} className="pill bg-slate-100 text-slate-700 gap-1">
                {dayLabel(dt)}
                <button className="text-slate-400 hover:text-red-600" aria-label={`${dt} 빼기`} onClick={() => set({ dates: c.dates.filter((x) => x !== dt) })}>
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input type="date" className="input w-44" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="추가할 날짜" />
            <button className="btn-outline text-xs" onClick={() => newDate && set({ dates: [...new Set([...c.dates, newDate])].sort() })}>
              날짜 추가
            </button>
            <button className="btn-outline text-xs" onClick={fillWeekdays}>
              기간의 월~금 채우기
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            월~금 채우기는 입력 도우미일 뿐입니다. 직원별 근무일·공휴일·기존 휴가는 발행 전 점검표에서 근무표로 따로 판정합니다.
          </p>
        </Field>

        <Field label="대상 부서">
          <div className="flex flex-wrap gap-3">
            {departments.map((dn) => (
              <label key={dn} className="text-sm flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={c.targetDepts.includes(dn)}
                  onChange={(e) => set({ targetDepts: e.target.checked ? [...c.targetDepts, dn] : c.targetDepts.filter((x) => x !== dn) })}
                />
                {dn}
              </label>
            ))}
          </div>
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="개별 추가">
            <PeoplePicker employees={employees} value={c.targetEmployeeIds} onChange={(v) => set({ targetEmployeeIds: v })} />
          </Field>
          <Field label="개별 제외">
            <PeoplePicker employees={employees} value={c.excludeEmployeeIds} onChange={(v) => set({ excludeEmployeeIds: v })} />
          </Field>
        </div>

        <Field label="추가 안내 (선택 — 권리 포기·간주 동의 표현은 발행이 막힙니다)">
          <textarea className="input" rows={2} value={c.extraNote} onChange={(e) => set({ extraNote: e.target.value })} />
        </Field>
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">직원에게 보이는 고정 안내문</summary>
          <ul className="list-disc ml-5 mt-1 space-y-0.5">{NOTICE_BODY.map((t) => <li key={t}>{t}</li>)}</ul>
        </details>
      </div>

      <div className="card p-4 space-y-4">
        <h2 className="font-semibold text-slate-800">직군(부서)별 정상근무 조건</h2>
        <p className="text-xs text-slate-500">
          정상근무를 고른 직원이 실제로 받을 조건입니다. 예시 문구는 입력 도움말일 뿐이며 자동으로 채우지 않습니다. 비어 있는 부서의 직원은
          「운영조건 확인 필요」로 남아 신청 대상이 되지 않습니다. 직원별 실제 근무시간은 각자의 근무표로 날짜마다 함께 보입니다.
        </p>
        {targetDeptNames.length === 0 && <p className="text-sm text-slate-400">대상 부서를 먼저 고르세요.</p>}
        {targetDeptNames.map((dn) => (
          <fieldset key={dn} className="border border-slate-200 rounded-lg p-3">
            <legend className="text-sm font-semibold px-1">{dn}</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              {CONDITION_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <input
                    className="input"
                    placeholder={f.placeholder}
                    value={cond(dn)[f.key]}
                    onChange={(e) => set({ conditions: { ...c.conditions, [dn]: { ...cond(dn), [f.key]: e.target.value } } })}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <button className="btn-outline" onClick={save} disabled={busy || saved}>
            {saved ? "저장됨" : "초안 저장"}
          </button>
          <button className="btn-primary" onClick={check} disabled={busy}>
            발행 전 점검
          </button>
          {err && <span className="text-sm text-red-600 whitespace-pre-line" role="alert">{err}</span>}
        </div>

        {preview && (
          <div className="space-y-3">
            {preview.problems.length > 0 && (
              <ul className="text-sm space-y-1">
                {preview.problems.map((p: string) => (
                  <li key={p} className={preview.blocking.includes(p) ? "text-red-600" : "text-amber-700"}>
                    {preview.blocking.includes(p) ? "⛔" : "⚠"} {p}
                  </li>
                ))}
              </ul>
            )}
            {preview.excluded.length > 0 && (
              <p className="text-xs text-slate-500">대상에서 빠진 직원: {preview.excluded.map((x: any) => `${x.name}(${x.reason})`).join(", ")}</p>
            )}
            <div className="overflow-auto max-h-[28rem] border border-slate-200 rounded-lg">
              <table className="text-xs">
                <thead className="bg-slate-50 sticky-head">
                  <tr>
                    <th className="th">직원</th>
                    <th className="th">잔여</th>
                    {preview.content.dates.map((dt: string) => (
                      <th key={dt} className="th">{dayLabel(dt)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r: any) => {
                    const allKey = `${r.employeeId}:*`;
                    return (
                      <tr key={r.employeeId}>
                        <td className="td whitespace-nowrap">
                          <div className="font-semibold">{r.name}</div>
                          <div className="text-[11px] text-slate-400">{r.department ?? "-"}{r.slackLinked ? "" : " · 슬랙 미연동(배포 불가)"}</div>
                          <label className="text-[11px] flex items-center gap-1 mt-0.5">
                            <input type="checkbox" checked={c.unconfirmed.includes(allKey)} onChange={() => toggleUnconfirmed(allKey)} />
                            전체 운영조건 확인 필요
                          </label>
                        </td>
                        <td className="td tnum">{r.remaining}일{r.leaveEligible ? "" : " (미적용)"}</td>
                        {r.infos.map((i: any) => {
                          const key = `${r.employeeId}:${i.date}`;
                          const manual = c.unconfirmed.includes(key);
                          const toggleable = i.status === "OPEN" || manual;
                          return (
                            <td key={i.date} className="td text-center">
                              <button
                                className={`rounded px-1.5 py-0.5 ${cellColor(i, manual)}`}
                                title={i.reason ?? i.leaveBlocked ?? `근무 ${i.hours ?? "-"} — 눌러서 '운영조건 확인 필요'로 표시`}
                                disabled={!toggleable}
                                onClick={() => toggleUnconfirmed(key)}
                                aria-label={`${r.name} ${i.date} ${i.reason ?? "선택 가능"}`}
                              >
                                {cellText(i, manual)}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500">
              ○ 선택 가능 · 휴 근무일 아님/공휴일 · 기존 기존 휴가 있음 · ? 운영조건 확인 필요 · △ 연차 산정 확인 필요. 선택 가능한 칸을 누르면 그 직원·날짜를
              「운영조건 확인 필요」로 표시해 신청·차감 대상에서 뺍니다(바꾼 뒤 다시 점검하세요).
            </p>

            <fieldset className="border border-amber-200 bg-amber-50/50 rounded-lg p-3 space-y-2">
              <legend className="text-sm font-semibold px-1">발행 전 운영 사실 확인</legend>
              {ATTESTATIONS.map((a) => (
                <label key={a.key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={!!attest[a.key]} onChange={(e) => setAttest({ ...attest, [a.key]: e.target.checked })} />
                  <span>{a.label}</span>
                </label>
              ))}
              <p className="text-[11px] text-slate-500">확인자와 시각이 기록됩니다. 운영 사실을 확인하는 절차이며 법률 검토를 대신하지 않습니다.</p>
            </fieldset>
            <button className="btn-primary" onClick={publish} disabled={busy || !saved || !allAttested || preview.blocking.length > 0 || preview.rows.length === 0}>
              {republish ? `제${version}판 게시 (변경 안내 발송)` : "게시하고 DM 으로 안내"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function cellText(i: any, manual: boolean) {
  if (manual || i.status === "UNCONFIRMED") return "?";
  if (i.status === "NOT_WORKDAY") return "휴";
  if (i.status === "EXISTING") return "기존";
  if (i.leaveBlocked) return "△";
  return "○";
}
function cellColor(i: any, manual: boolean) {
  if (manual || i.status === "UNCONFIRMED") return "bg-amber-100 text-amber-800";
  if (i.status === "NOT_WORKDAY") return "text-slate-300";
  if (i.status === "EXISTING") return "bg-slate-100 text-slate-600";
  if (i.leaveBlocked) return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
}

function PeoplePicker({ employees, value, onChange }: { employees: Emp[]; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div>
      <select
        className="input"
        value=""
        aria-label="직원 추가"
        onChange={(e) => {
          const idn = Number(e.target.value);
          if (idn && !value.includes(idn)) onChange([...value, idn]);
        }}
      >
        <option value="">직원 선택…</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>{e.name} · {e.department ?? "-"}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1 mt-1">
        {value.map((idn) => {
          const e = employees.find((x) => x.id === idn);
          return (
            <span key={idn} className="pill bg-slate-100 text-slate-700 gap-1">
              {e?.name ?? idn}
              <button aria-label={`${e?.name ?? idn} 빼기`} className="text-slate-400 hover:text-red-600" onClick={() => onChange(value.filter((x) => x !== idn))}>
                ✕
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

/* ============================== 응답 현황 ============================== */

function StatusView({ id, d, onChange }: { id: number; d: any; onChange: () => void }) {
  const [err, setErr] = useState("");
  if (!d.current) return <div className="card p-6 text-sm text-slate-400">아직 게시하지 않은 공고입니다.</div>;
  const c = d.counts;
  const dates: string[] = d.content.dates;

  async function post(body: any) {
    setErr("");
    try {
      await call(`/api/vacation/notices/${id}`, { method: "POST", body: JSON.stringify(body) });
      onChange();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          ["대상", c.total],
          ["미열람", c.UNOPENED ?? 0],
          ["열람·미응답", c.OPENED ?? 0],
          ["임시저장", c.DRAFT ?? 0],
          ["제출", c.SUBMITTED ?? 0],
          ["재확인 필요", c.RECONFIRM ?? 0],
          ["배포 안 됨", c.NOT_SENT ?? 0],
        ].map(([k, v]) => (
          <div key={k as string} className="card p-3">
            <div className="text-[11px] text-slate-500">{k}</div>
            <div className="text-lg font-bold tnum">{v}</div>
          </div>
        ))}
      </div>
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">날짜</th>
              <th className="th">근무 선택</th>
              <th className="th">연차 신청</th>
              <th className="th">미선택·대상 아님</th>
              <th className="th">정상근무 제공</th>
            </tr>
          </thead>
          <tbody>
            {d.byDate.map((b: any) => (
              <tr key={b.date}>
                <td className="td">{b.label}</td>
                <td className="td tnum">{b.work}</td>
                <td className="td tnum">{b.leave}</td>
                <td className="td tnum text-slate-400">{b.none}</td>
                <td className="td text-xs">
                  {b.notProvided ? (
                    <span className="text-red-600">제공 불가로 기록: {b.notProvided}</span>
                  ) : (
                    <button
                      className="text-slate-500 underline"
                      onClick={() => {
                        const note = prompt(`${b.date} 에 정상근무를 실제로 제공하지 못했다면 사유를 적어 주세요. (그날 정상근무를 고른 직원이 '사실 확인 필요'로 표시됩니다)`);
                        if (note) post({ action: "workNotProvided", date: b.date, note });
                      }}
                    >
                      제공 불가 기록
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-auto max-h-[36rem]">
        <table className="text-xs w-full">
          <thead className="bg-slate-50 sticky-head">
            <tr>
              <th className="th">직원</th>
              <th className="th">응답 현황</th>
              {dates.map((dt) => (
                <th key={dt} className="th">{dayLabel(dt)}</th>
              ))}
              <th className="th">제출 문서</th>
              <th className="th">확인 필요</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r: any) => (
              <tr key={r.assignmentId} className={r.state === "REMOVED" ? "opacity-50" : ""}>
                <td className="td whitespace-nowrap">
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-[11px] text-slate-400">{r.department ?? "-"}</div>
                </td>
                <td className="td whitespace-nowrap">
                  {ASSIGNMENT_STATE_LABEL[r.state as keyof typeof ASSIGNMENT_STATE_LABEL]}
                  {r.notifyError && <div className="text-[11px] text-red-600">{r.notifyError}</div>}
                  {r.inquiries > 0 && <div className="text-[11px] text-brand-700">문의 {r.inquiries}건</div>}
                </td>
                {dates.map((dt) => {
                  const ch = r.choices[dt]?.choice;
                  const rq = r.requests[dt];
                  const dr = !ch && r.draft?.[dt];
                  return (
                    <td key={dt} className="td text-center whitespace-nowrap">
                      {ch === "LEAVE" ? (
                        <span className="text-brand-700 font-semibold">연차</span>
                      ) : ch === "WORK" ? (
                        <span className="text-slate-600">근무</span>
                      ) : dr ? (
                        <span className="text-slate-300" title="임시저장 — 제출 전이라 선택으로 보지 않습니다">({dr === "LEAVE" ? "연차" : "근무"})</span>
                      ) : (
                        <span className="text-slate-300">·</span>
                      )}
                      {rq && <div className="text-[10px] text-slate-500">{REQ_LABEL[rq.status] ?? rq.label}</div>}
                    </td>
                  );
                })}
                <td className="td whitespace-nowrap">
                  {r.history.map((h: any) => (
                    <div key={h.id}>
                      <a className="underline text-brand-700" href={`/api/vacation/submissions/${h.id}/pdf`} target="_blank" rel="noreferrer">
                        {h.docNo}
                      </a>{" "}
                      <span className="text-[10px] text-slate-400">
                        {h.kind === "LEAVE" ? `신청서 ${h.leaveDays}일` : "근무 확인"} · 제{h.versionNo}판 · {kst(h.submittedAt)}
                        {h.status === "SUPERSEDED" ? " · 변경됨" : ""}
                      </span>
                    </div>
                  ))}
                </td>
                <td className="td text-[11px]">
                  {r.outsideLeave.length > 0 && <div className="text-amber-700">공고 날짜에서 빠진 연차: {r.outsideLeave.join(", ")} — 확인 필요</div>}
                  {r.flags.map((f: any) => (
                    <div key={f.kind + f.date} className="text-red-600">
                      사실 확인 필요 · {f.date} {f.note}{" "}
                      <button
                        className="underline text-slate-500"
                        onClick={() => {
                          const note = prompt("확인한 내용을 적어 주세요 (예: 오전 근무 후 조퇴 — 반차로 정정 요청함). 시스템은 결론을 내리지 않고 기록만 남깁니다.");
                          if (note) post({ action: "review", date: f.date, employeeId: r.employeeId, kind: f.kind, note });
                        }}
                      >
                        확인 기록
                      </button>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        연차 처리 상태는 기존 연차 결재 흐름을 따릅니다(승인되면 연차 원장에 차감). 신청일을 관리자가 대신 바꾸는 기능은 없습니다 — 조정이 필요하면
        반려 사유로 안내하고 직원이 다시 고릅니다. 사실 확인 필요 표시는 자동으로 차감·무급 처리하지 않으며, 정정은 기존 연차 취소·조정 절차로 합니다.
      </p>
    </div>
  );
}

/* ============================== 문의 · 이력 ============================== */

function Inquiries({ d, onChange }: { d: any; onChange: () => void }) {
  const [ans, setAns] = useState<Record<number, string>>({});
  const [err, setErr] = useState("");
  if (!d.inquiries.length) return <div className="card p-6 text-sm text-slate-400">문의가 없습니다.</div>;
  return (
    <div className="space-y-2">
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      {d.inquiries.map((q: any) => (
        <div key={q.id} className="card p-3 text-sm space-y-1">
          <div className="text-xs text-slate-500">
            {q.name} · {kst(q.createdAt)} · {q.status === "OPEN" ? "답변 대기" : `답변함 (${q.answeredBy})`}
          </div>
          <p className="whitespace-pre-line">{q.message}</p>
          {q.status === "ANSWERED" ? (
            <p className="whitespace-pre-line text-slate-600 border-l-2 border-slate-200 pl-2">{q.answer}</p>
          ) : (
            <div className="flex gap-2">
              <textarea className="input" rows={2} aria-label="답변" value={ans[q.id] ?? ""} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} />
              <button
                className="btn-primary text-xs"
                onClick={async () => {
                  setErr("");
                  try {
                    await call(`/api/vacation/inquiries/${q.id}`, { method: "POST", body: JSON.stringify({ answer: ans[q.id] ?? "" }) });
                    onChange();
                  } catch (e: any) {
                    setErr(e.message);
                  }
                }}
              >
                답변 보내기
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  CREATED: "공고 작성",
  REVISION_STARTED: "수정본 작성 시작",
  PUBLISHED: "게시",
  CLOSED: "마감",
  ARCHIVED: "보관",
  REMINDED: "미응답자 확인 요청",
  OPENED: "직원 열람",
  SUBMITTED: "직원 제출",
  LEAVE_WITHDRAWN: "승인 전 연차 철회(선택 변경)",
  LEAVE_CANCEL_REQUESTED: "승인된 연차 취소 요청(선택 변경)",
  CANCEL_REQUEST_WITHDRAWN: "취소 요청 거둠",
  LEAVE_APPROVED: "연차 승인",
  LEAVE_REJECTED: "연차 반려",
  LEAVE_PRE_APPROVED: "중간결재 확인",
  INQUIRY: "안내 내용 확인 요청",
  INQUIRY_ANSWERED: "문의 답변",
  REMOVED_FROM_TARGETS: "대상에서 빠짐",
  WORK_NOT_PROVIDED: "정상근무 제공 불가 기록",
  REVIEW_RESOLVED: "사실 확인 기록",
};

function History({ d }: { d: any }) {
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="font-semibold text-sm mb-2">판</h3>
        <ul className="text-sm space-y-2">
          {d.versions.map((v: any) => (
            <li key={v.id}>
              제{v.version}판 · {v.status === "DRAFT" ? "초안" : v.status === "PUBLISHED" ? "게시 중" : "이전 판"}
              {v.publishedAt ? ` · ${kst(v.publishedAt)} ${v.publishedBy}` : ""}
              {v.material ? " · 중요 변경(재확인 요청)" : ""}
              {v.publishedAt ? ` · 대상 ${v.targets}명` : ""}
              {v.changeNote && <pre className="text-[11px] text-slate-500 whitespace-pre-wrap mt-0.5">{v.changeNote}</pre>}
            </li>
          ))}
        </ul>
        {d.current?.attestation && (
          <p className="text-[11px] text-slate-500 mt-2">
            게시판 운영 사실 확인: {d.current.attestation.by} · {kst(d.current.attestation.at)} — {d.current.attestation.note}
          </p>
        )}
      </div>
      <div className="card p-4">
        <h3 className="font-semibold text-sm mb-2">처리 이력 (최근 300건)</h3>
        <ul className="text-xs space-y-1">
          {d.events.map((e: any) => (
            <li key={e.id}>
              <span className="text-slate-400">{kst(e.createdAt)}</span> · {EVENT_LABEL[e.type] ?? e.type} · {e.actorName ?? e.actor}
              {e.note ? ` — ${e.note}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
