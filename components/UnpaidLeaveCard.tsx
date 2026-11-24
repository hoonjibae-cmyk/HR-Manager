"use client";

/**
 * 휴직·휴업 카드 — 직원 상세 화면. 무급휴직·유급휴직·휴업의 기간을 등록·수정·삭제한다.
 * (파일 이름이 `UnpaidLeaveCard` 인 것은 무급휴직만 있던 때(v1.63)의 이름이다.)
 *
 * 등록한 기간만큼 그 달 **정상 급여**가 역일수로 일할된다(lib/unpaid-leave.ts — 월중 입·퇴사와 같은 방식).
 * 유급휴직·휴업은 그 기간의 급여를 **원급여 대비 비율** 또는 **직접 넣은 금액**으로 따로 지급한다.
 * 연차가 아니라 연차 잔여와 무관하고, 연차 발생·근속도 바뀌지 않는다.
 *
 *  · **넣기 전에 얼마가 나가는지 보여 준다** — 달마다 「정상 급여 15/30일(50%) + 휴업수당 1,050,000원」.
 *    서버와 같은 함수로 세므로 미리보기와 실제 산정이 갈리지 않는다. 다만 비율 지급의 금액은 **지금 계약의
 *    월 급여**로 어림한 값이다 — 실제 산정은 그 달의 계약 조건으로 한다(그렇게 적는다).
 *  · **검사도 서버와 같은 함수**(`unpaidLeaveError`) — 화면이 통과시킨 것을 서버가 막거나 그 반대가 없다.
 *  · **급여를 여기서 다시 산정하지 않는다.** 이미 산정한 달이 있으면 그 달을 이름으로 적고 급여 화면으로
 *    잇는다 — 다른 화면에서 급여 기록이 조용히 바뀌면 무엇이 왜 달라졌는지 따라갈 수 없다.
 *    등록 직후에만 알리면 잊으므로 **카드가 늘** 다시 산정할 달을 띄운다(서버가 페이지를 그릴 때 함께 내려준다).
 *  · 휴업수당이 70% 에 못 미치면 알리되 **막지 않는다**(노동위원회 승인·불가항력 휴업이면 정당하다).
 */

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  monthPayDays,
  monthsOfSpan,
  settleLeavePay,
  parseYmd,
  spanDays,
  unpaidLeaveError,
  shutdownRateWarning,
  leavePayTermsLabel,
  isPaidLeaveKind,
  ratePercentLabel,
  LEAVE_KINDS,
  LEAVE_KIND_LABEL,
  LEAVE_PAY_LABEL,
  DEFAULT_SHUTDOWN_RATE,
  DEFAULT_PAID_LEAVE_RATE,
  UNPAID_LEAVE_EFFECT_NOTE,
  LEAVE_WAGE_BASIS_NOTE,
  SHUTDOWN_BASIS_NOTE,
  UNPAID_SEVERANCE_NOTE,
  UNPAID_REASON_MAX,
  type LeaveKind,
  type UnpaidLeaveSpan,
} from "@/lib/unpaid-leave";

export interface UnpaidLeaveRow {
  id: number;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  days: number;
  /** UNPAID | PAID | SHUTDOWN */
  kind: LeaveKind;
  /** 원급여 대비 비율(0.7 = 70%) — 비율 지급일 때 */
  payRate: number | null;
  /** 직접 넣은 금액(원, 기간 전체) — 금액 지정일 때 */
  payAmount: number | null;
  reason: string;
  createdBy: string;
}

export interface UnpaidImpactRow {
  year: number;
  month: number;
  leaveDays: number;
  daysInMonth: number;
  state: "NONE" | "OK" | "STALE" | "SENT";
  gross: number | null;
}

/** 원급여(월 기준액) — 서버가 지금 계약으로 낸 값(`leaveWageBasis`, lib/payroll.ts) */
export interface LeaveBasisProp {
  monthly: number;
  /** 기준액에서 뺀 경업금지 보상금(월) */
  nonCompeteExcluded: number;
  /** 낼 수 없는 까닭 — RATIO(완전비율제) · NO_SCHEDULE(시급제인데 근로시간표 없음) · CONTRACTOR */
  gap: "CONTRACTOR" | "RATIO" | "NO_SCHEDULE" | null;
}

interface Props {
  employeeId: number;
  /** YYYY-MM-DD */
  hireDate: string;
  resignDate: string | null;
  /** 위탁계약(프리랜서) — 새로 등록할 수 없다(이미 있는 기록은 지울 수 있게 보여 준다) */
  contractor: boolean;
  /** 완전비율제 — 매출 기준이라 일할하지 않고, 유급휴직·휴업은 금액 지정만 된다 */
  ratio: boolean;
  /** 원급여(월 기준액) — 비율 지급의 미리보기에 쓴다 */
  basis: LeaveBasisProp;
  leaves: UnpaidLeaveRow[];
  impacts: UnpaidImpactRow[];
}

type PayMode = "RATE" | "AMOUNT";

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const dot = (ymd: string) => ymd.replace(/-/g, ".");
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
/** 고르기 쉬운 비율 — 70% 는 근로기준법 §46 의 숫자다 */
const RATE_PRESETS = [100, 90, 80, 70, 60, 50];

/** 구분별 배지 색 — 무급(주황)·유급(초록)·휴업(파랑) */
const KIND_PILL: Record<LeaveKind, string> = {
  UNPAID: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700",
  SHUTDOWN: "bg-sky-50 text-sky-700",
};

/** `70` · `66.67` → 0.7 · 0.6667. 숫자가 아니면 null */
function rateOfPercentText(t: string): number | null {
  if (t.trim() === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 10000;
}
/** `1,050,000` → 1050000. 비었으면 null, 숫자가 아니면 NaN */
function amountOfText(t: string): number | null {
  const s = t.replace(/[,\s원]/g, "");
  if (s === "") return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

export default function UnpaidLeaveCard(props: Props) {
  const { employeeId, contractor, ratio, leaves, basis } = props;
  const router = useRouter();
  const [impacts, setImpacts] = useState<UnpaidImpactRow[]>(props.impacts);
  // null = 닫힘 · "new" = 새로 등록 · 숫자 = 그 건 수정
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [kind, setKind] = useState<LeaveKind>("UNPAID");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("RATE");
  const [rateText, setRateText] = useState("");
  // 비율 칸을 사람이 직접 고쳤는가 — 안 고쳤으면 구분을 바꿀 때 그 구분의 기본값(휴업 70 · 유급휴직 100)으로 따라간다
  const [rateTouched, setRateTouched] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hire = useMemo(() => parseYmd(props.hireDate)!, [props.hireDate]);
  const resign = useMemo(() => (props.resignDate ? parseYmd(props.resignDate) : null), [props.resignDate]);

  // 서버가 내려준 값이 바뀌면(등록·삭제 뒤 새로 그린 페이지) 그쪽을 따른다
  React.useEffect(() => setImpacts(props.impacts), [props.impacts]);

  const paidKind = isPaidLeaveKind(kind);
  // 완전비율제는 원급여가 없어 비율 지급을 쓸 수 없다 — 금액 지정만
  const mode: PayMode = ratio ? "AMOUNT" : payMode;

  /** 수정 중인 건을 뺀 나머지 — 겹침 검사와 미리보기에 쓴다 */
  const others = useMemo<UnpaidLeaveSpan[]>(
    () =>
      leaves
        .filter((l) => l.id !== editing)
        .map((l) => ({
          startDate: parseYmd(l.startDate)!,
          endDate: parseYmd(l.endDate)!,
          kind: l.kind,
          payRate: l.payRate,
          payAmount: l.payAmount,
        })),
    [leaves, editing]
  );

  /** 폼에 적힌 지급 조건 — 서버에 보내는 모양 그대로(비율은 0.7, 금액은 원) */
  const terms = useMemo(() => {
    if (!paidKind) return { kind, payRate: null as number | null, payAmount: null as number | null };
    return mode === "RATE"
      ? { kind, payRate: rateOfPercentText(rateText), payAmount: null }
      : { kind, payRate: null, payAmount: amountOfText(amountText) };
  }, [kind, paidKind, mode, rateText, amountText]);

  const formError = useMemo(() => {
    if (editing == null || (!startDate && !endDate)) return null;
    return unpaidLeaveError(
      { startDate, endDate, reason, ...terms },
      { hireDate: hire, resignDate: resign, contractor, ratio, others }
    );
  }, [editing, startDate, endDate, reason, terms, hire, resign, contractor, ratio, others]);

  /** 넣으려는 기간이 달마다 급여를 어떻게 바꾸는지 — 서버 산정과 같은 함수 */
  const preview = useMemo(() => {
    const s = parseYmd(startDate);
    const e = parseYmd(endDate);
    if (!s || !e || s > e || formError) return [];
    const mine: UnpaidLeaveSpan = { startDate: s, endDate: e, ...terms };
    return monthsOfSpan(s, e, 12).map(({ year, month }) => {
      // 정상 급여의 지급일수는 다른 건까지 합쳐서, 이 건의 지급액은 이 건만으로 센다
      const all = monthPayDays(year, month, hire, resign, [...others, mine]);
      const own = settleLeavePay(monthPayDays(year, month, hire, resign, [mine]), [], basis.monthly);
      return { year, month, ...all, own };
    });
  }, [startDate, endDate, formError, others, hire, resign, terms, basis.monthly]);

  function open(target: number | "new") {
    setErr(null);
    setEditing(target);
    if (target === "new") {
      setKind("UNPAID");
      setStartDate("");
      setEndDate("");
      setPayMode("RATE");
      setRateText("");
      setRateTouched(false);
      setAmountText("");
      setReason("");
    } else {
      const l = leaves.find((x) => x.id === target)!;
      setKind(l.kind);
      setStartDate(l.startDate);
      setEndDate(l.endDate);
      setPayMode(l.payAmount != null ? "AMOUNT" : "RATE");
      setRateText(l.payRate != null ? String(Math.round(l.payRate * 10000) / 100) : "");
      // 저장돼 있던 비율은 사람이 정한 값이다 — 구분을 바꿔도 덮어쓰지 않는다
      setRateTouched(l.payRate != null);
      setAmountText(l.payAmount != null ? l.payAmount.toLocaleString("ko-KR") : "");
      setReason(l.reason);
    }
  }

  /**
   * 구분을 바꾸면 비율 칸에 그 구분의 기본값을 채운다 — 휴업 70%(근로기준법 §46 의 숫자) · 유급휴직 100%.
   * **사람이 적어 둔 값은 건드리지 않는다.** 손대지 않은 칸만 따라간다 — 휴업(70)을 골랐다가 유급휴직으로
   * 바꿨는데 70 이 남으면 70% 짜리 유급휴직이 모르는 새 등록된다.
   */
  function pickKind(k: LeaveKind) {
    setKind(k);
    if (isPaidLeaveKind(k) && (!rateTouched || rateText.trim() === ""))
      setRateText(String((k === "SHUTDOWN" ? DEFAULT_SHUTDOWN_RATE : DEFAULT_PAID_LEAVE_RATE) * 100));
  }
  /** 비율 칸을 사람이 고쳤다 */
  function typeRate(v: string) {
    setRateText(v);
    setRateTouched(true);
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
        body: JSON.stringify({ startDate, endDate, reason, ...terms }),
      }
    );
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? "저장하지 못했습니다.");
      return;
    }
    setEditing(null);
    const msg = [j.notice, j.warning].filter(Boolean).join("\n\n");
    if (msg) alert(msg);
    router.refresh();
  }

  async function remove(l: UnpaidLeaveRow) {
    const name = LEAVE_KIND_LABEL[l.kind];
    if (
      !confirm(
        `${name} ${dot(l.startDate)} ~ ${dot(l.endDate)} (${l.days}일)을 지울까요?\n\n` +
          `지우면 그 기간의 급여가 다시 정상 지급 대상이 됩니다` +
          (isPaidLeaveKind(l.kind) ? `(${l.kind === "PAID" ? "유급휴직 급여는" : "휴업수당은"} 빠집니다)` : "") +
          `. 이미 산정해 둔 달은 급여 화면에서 다시 산정해야 반영됩니다.`
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

  const rateWarn = paidKind && !formError ? shutdownRateWarning(terms) : null;
  // 비율 지급인데 원급여를 낼 수 없는 경우 — 그대로 두면 0원으로 산정된다
  const noBasis = paidKind && mode === "RATE" && !ratio && basis.gap != null;
  const editingName = LEAVE_KIND_LABEL[kind];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-slate-800">휴직·휴업</h2>
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
            ? "위탁계약(프리랜서)은 근로자가 아니라 휴직·휴업 대상이 아닙니다."
            : "등록된 무급휴직·유급휴직·휴업이 없습니다."}
        </p>
      ) : (
        <ul className="space-y-2">
          {leaves.map((l) => {
            const pay = leavePayTermsLabel(l);
            return (
              <li key={l.id} className="text-sm border border-slate-100 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-700 whitespace-nowrap">
                    {dot(l.startDate)} ~ {dot(l.endDate)}
                  </span>
                  <span className={`pill text-[11px] whitespace-nowrap ${KIND_PILL[l.kind]}`}>
                    {LEAVE_KIND_LABEL[l.kind]} · {l.days}일
                  </span>
                </div>
                {pay && <div className="text-xs text-slate-600 mt-1 break-keep">{pay}</div>}
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
            );
          })}
        </ul>
      )}

      {editing != null && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
          <div className="text-xs font-semibold text-slate-600">
            {editing === "new" ? `${editingName} 등록` : `${editingName} 수정`}
          </div>

          {/* 구분 — 무급휴직은 급여가 없고, 유급휴직·휴업은 그 기간의 급여를 비율이나 금액으로 따로 준다 */}
          <div>
            <span className="text-[11px] text-slate-500">구분</span>
            <div className="mt-0.5 grid grid-cols-3 gap-1">
              {LEAVE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => pickKind(k)}
                  className={`rounded-md border px-2 py-1.5 text-xs font-semibold whitespace-nowrap ${
                    kind === k
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {LEAVE_KIND_LABEL[k]}
                </button>
              ))}
            </div>
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

          {/* 유급휴직·휴업 — 그 기간의 급여를 어떻게 줄지: 원급여 대비 비율 또는 금액 직접 입력 */}
          {paidKind && (
            <div className="rounded-md border border-slate-200 bg-white p-2.5 space-y-2">
              <div className="text-[11px] font-semibold text-slate-600">
                {LEAVE_PAY_LABEL[kind]} — 지급 방식
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                <label className={`flex items-center gap-1.5 ${ratio ? "text-slate-300" : ""}`}>
                  <input
                    type="radio"
                    name="leave-pay-mode"
                    checked={mode === "RATE"}
                    disabled={ratio}
                    onChange={() => setPayMode("RATE")}
                  />
                  원급여 대비 비율(%)
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="leave-pay-mode"
                    checked={mode === "AMOUNT"}
                    onChange={() => setPayMode("AMOUNT")}
                  />
                  금액 직접 입력
                </label>
              </div>

              {mode === "RATE" ? (
                <div className="space-y-1.5">
                  {/* 카드가 좁아 비율 칸과 고르기 버튼을 한 줄에 두면 버튼이 두 줄로 꺾인다 — 줄을 나눈다 */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="flex items-center gap-1.5">
                      <input
                        className="input w-20 text-right tnum"
                        inputMode="decimal"
                        value={rateText}
                        placeholder={kind === "SHUTDOWN" ? "70" : "100"}
                        aria-label="지급 비율(%)"
                        onChange={(e) => typeRate(e.target.value)}
                      />
                      <span className="text-xs text-slate-500">%</span>
                    </span>
                    <span className="flex gap-1">
                      {RATE_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => typeRate(String(p))}
                          className={`rounded border px-1.5 py-0.5 text-[11px] tnum ${
                            Number(rateText) === p
                              ? "border-brand-500 bg-brand-50 text-brand-700"
                              : "border-slate-200 text-slate-500 hover:border-slate-300"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 break-keep leading-relaxed">
                    {basis.gap == null ? (
                      <>
                        원급여 기준 <b className="tnum">월 {won(basis.monthly)}</b>
                        {basis.nonCompeteExcluded > 0 && <> (경업금지 보상금 {won(basis.nonCompeteExcluded)} 제외)</>} —
                        지금 계약 기준입니다. 실제 산정은 그 달의 계약 조건으로 하고, 그 기간의 역일수만큼 나눈
                        금액에 비율을 곱합니다.
                        {/* 보상금이 있는 직원 — 100% 로 넣어도 평소 급여와 같지 않다는 것을 넣는 자리에서 알린다 */}
                        {basis.nonCompeteExcluded > 0 && (
                          <span className="block mt-1 text-amber-700">
                            경업금지 보상금은 근로의 대가가 아니라 원급여에 넣지 않고, 근로계약서 제8조에 따라 근무하지
                            않은 기간만큼 일할로 빠집니다 — 비율이 100% 여도 그 몫만큼 평소보다 적게 나갑니다.
                          </span>
                        )}
                      </>
                    ) : basis.gap === "NO_SCHEDULE" ? (
                      <span className="text-rose-600">
                        근로시간표가 비어 있어 원급여(시급 × 월 소정·주휴시간)를 계산할 수 없습니다 — 직원 정보에
                        근로시간표를 채우거나 금액을 직접 넣으세요. 이대로 두면 0원으로 산정됩니다.
                      </span>
                    ) : (
                      <span className="text-rose-600">
                        원급여를 계산할 수 없는 계약입니다 — 금액을 직접 넣으세요.
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      className="input w-40 text-right tnum"
                      inputMode="numeric"
                      value={amountText}
                      placeholder="예: 1,050,000"
                      aria-label="지급 금액(원)"
                      onChange={(e) => setAmountText(e.target.value)}
                      onBlur={() => {
                        const n = amountOfText(amountText);
                        if (n != null && Number.isFinite(n)) setAmountText(n.toLocaleString("ko-KR"));
                      }}
                    />
                    <span className="text-xs text-slate-500">원</span>
                  </div>
                  <p className="text-[11px] text-slate-500 break-keep leading-relaxed">
                    <b>이 기간 전체</b>에 지급할 금액입니다(세전). 달을 걸치면 날 수(역일수)대로 나눠 달마다 싣습니다.
                    {ratio && " 완전비율제는 급여가 매출에 달려 원급여가 없어 금액으로만 넣습니다."}
                  </p>
                </div>
              )}

              {kind === "SHUTDOWN" && (
                <p className="text-[11px] text-slate-400 break-keep leading-relaxed">{SHUTDOWN_BASIS_NOTE}</p>
              )}
              {rateWarn && <p className="text-[11px] text-amber-700 break-keep leading-relaxed">⚠ {rateWarn}</p>}
            </div>
          )}

          <label className="block">
            <span className="text-[11px] text-slate-500">사유 (내부 기록 — 명세서에 싣지 않습니다)</span>
            <input
              className="input w-full"
              value={reason}
              maxLength={UNPAID_REASON_MAX}
              placeholder={kind === "SHUTDOWN" ? "예: 시설 공사로 휴원" : "예: 개인 사정"}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          {formError && <p className="text-xs text-rose-600 break-keep">{formError}</p>}

          {/* 넣기 전에 얼마가 나가는지 — 달마다. 주말·공휴일도 날 수에 든다(역일수) */}
          {preview.length > 0 && (
            <div className="rounded-md bg-white border border-slate-200 p-2.5 text-xs text-slate-600 space-y-1.5">
              <div className="font-semibold text-slate-700">
                {spanDays(parseYmd(startDate)!, parseYmd(endDate)!)}일 (주말·공휴일 포함 역일수) — 달별 지급
              </div>
              {/* 카드가 좁다 — 달마다 한 덩어리로 세로로 쌓는다(이름은 꺾여도 되고 금액은 한 줄로) */}
              {preview.map((p) => {
                const mine = p.own.spans[0];
                return (
                  <div key={`${p.year}-${p.month}`} className="border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0">
                    <div className="text-slate-700 font-semibold">
                      {p.year}.{String(p.month).padStart(2, "0")}
                      <span className="text-slate-400 font-normal">
                        {" "}
                        · {editingName} {p.own.leaveDays}일
                        {mine ? ` (${mine.from === mine.to ? md(mine.from) : `${md(mine.from)}~${md(mine.to)}`})` : ""}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 mt-0.5">
                      <span className="text-slate-500">정상 급여</span>
                      <span className="tnum font-semibold whitespace-nowrap">
                        {ratio ? "비율급 일할 안 함" : `${p.paidDays}/${p.daysInMonth}일 · ${(p.ratio * 100).toFixed(1)}%`}
                      </span>
                    </div>
                    {paidKind && mine && (
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500 break-keep">
                          {LEAVE_PAY_LABEL[kind as "PAID" | "SHUTDOWN"]}
                          <span className="text-slate-400">
                            {" "}
                            {mine.amount != null
                              ? mine.amountTotal != null && mine.amountTotal !== mine.amount
                                ? `(기간 전체 ${won(mine.amountTotal)} 중 이 달 몫)`
                                : "(지정한 금액)"
                              : `(원급여 ${won(mine.orig ?? 0)} × ${ratePercentLabel(mine.rate ?? 0)})`}
                          </span>
                        </span>
                        <span className="tnum font-semibold text-slate-700 whitespace-nowrap">
                          + {won(p.own.leavePay)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {paidKind && mode === "RATE" && !noBasis && (
                <div className="text-slate-400 break-keep">
                  금액은 지금 계약의 월 급여로 어림한 값입니다 — 그 달에 계약이 바뀌면 실제 산정이 달라질 수 있습니다.
                </div>
              )}
              {ratio && (
                <div className="text-amber-700 break-keep">
                  완전비율제는 매출 기준이라 급여를 일할하지 않습니다
                  {paidKind
                    ? " — 넣은 금액만큼 비율급 위에 따로 지급됩니다."
                    : " — 휴직 기록만 남습니다(최저보장이 있으면 급여 화면에서 조정하세요)."}
                </div>
              )}
              {preview.some((p) => p.employedDays > 0 && p.paidDays === 0) && !ratio && !paidKind && (
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
          <p className="mt-1.5 break-keep">{LEAVE_WAGE_BASIS_NOTE}</p>
          <p className="mt-1.5 break-keep">{SHUTDOWN_BASIS_NOTE}</p>
          <p className="mt-1.5 break-keep">{UNPAID_SEVERANCE_NOTE}</p>
        </details>
      )}
    </div>
  );
}
