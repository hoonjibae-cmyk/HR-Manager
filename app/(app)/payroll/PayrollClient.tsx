"use client";

import React, { useEffect, useState, useCallback } from "react";
import { won } from "@/lib/format";
import {
  PAY_SCHEME_LABEL,
  INCOME_TYPE_LABEL,
  PAYROLL_STATUS_LABEL,
  isContractorContract,
} from "@/lib/constants";
import { Pill } from "@/components/ui";
import { resignStatusOf, resignBadgeLabel, resignedSummary } from "@/lib/payroll-roster";
import {
  useTableSort,
  useStoredState,
  normalizeFilterSet,
  matchesFilter,
  anyFilterActive,
  type FilterValues,
  SortTh,
  FilterSelect,
  FilterBar,
} from "@/components/TableTools";

interface Rec {
  id: number;
  employeeId: number;
  year: number;
  month: number;
  incomeType: string;
  payScheme: string;
  gross: number;
  totalDeduct: number;
  net: number;
  incentiveP: number;
  bonusP: number;
  status: string;
  extraHours: number;
  overtimeHours: number;
  holidayHours: number;
  nightHours: number;
  studentCount: number | null;
  studentUnits: number | null;
  incentiveManual: number;
  classRevenue: number | null;
  bonus: number;
  unusedLeaveDays: number;
  hourlyWage: number;
  deductMode: string;
  pensionD: number;
  employmentD: number;
  healthD: number;
  longTermD: number;
  incomeTaxD: number;
  localTaxD: number;
  retentionD: number;
  parkingD: number;
  expenseD: number;
  otherD: number;
  otherItems: string | null;
  prorationRatio: number;
  /** 정정 발급 차수 — 0 이면 정정된 적 없는 원본 */
  reissueCount: number;
  /** 최초 발송 시각 (정정본에 '최초 발급일' 로 찍힌다) */
  firstSentAt: string | null;
  emailedAt: string | null;
  /** 그 달 재직 기간이 없는데 관리자가 직접 올린 행 — 배치 산정이 내리지 않는다 */
  manualAdd?: boolean;
  employee: {
    name: string;
    empNo: string;
    department: string | null;
    position: string | null;
    isContractor?: boolean;
    parkingFee?: number;
    resignDate?: string | null;
  };
}

/** 시트에 없는 직원 — 수동 추가 후보 */
interface Candidate {
  id: number;
  name: string;
  empNo: string;
  department: string | null;
  position: string | null;
  resignDate: string | null;
  hireDate: string;
  employed: boolean;
  reason: string;
  note: string;
}

const now = new Date();

/** 브라우저에 기억해 두는 필터 — 다음에 들어와도 이대로 걸려 있다 */
const FILTER_KEYS = ["scheme", "income", "status"] as const;
const DEFAULT_FILTER: Record<(typeof FILTER_KEYS)[number], FilterValues> = {
  scheme: [],
  income: [],
  status: [],
};

/** 정렬 키 → 비교할 값 */
function pickRec(r: Rec, key: string): any {
  switch (key) {
    case "name":
      return r.employee.name;
    // '형태' 는 급여형태 + 세무구분이 한 칸에 있으므로 보이는 순서대로 이어 붙여 줄 세운다
    case "scheme":
      return `${PAY_SCHEME_LABEL[r.payScheme] ?? r.payScheme} ${INCOME_TYPE_LABEL[r.incomeType] ?? ""}`;
    case "status":
      return PAYROLL_STATUS_LABEL[r.status] ?? r.status;
    default:
      return (r as any)[key];
  }
}

/** 저장된 레코드 → 변동입력 폼 값 */
function rowInputsOf(r: Rec) {
  return {
    extraHours: r.extraHours || "",
    overtimeHours: r.overtimeHours || "",
    holidayHours: r.holidayHours || "",
    nightHours: r.nightHours || "",
    studentCount: r.studentCount ?? "",
    incentiveManual: r.incentiveManual || "",
    classRevenue: r.classRevenue ?? "",
    bonus: r.bonus || "",
    unusedLeaveDays: r.unusedLeaveDays || "",
  };
}

/** 변동입력 폼 값 → API 전송용 숫자 변환 */
function cleanRowInput(v: any) {
  return {
    extraHours: v.extraHours ? Number(v.extraHours) : 0,
    overtimeHours: v.overtimeHours ? Number(v.overtimeHours) : 0,
    holidayHours: v.holidayHours ? Number(v.holidayHours) : 0,
    nightHours: v.nightHours ? Number(v.nightHours) : 0,
    studentCount: v.studentCount !== "" && v.studentCount != null ? Number(v.studentCount) : null,
    incentiveManual: v.incentiveManual ? Number(v.incentiveManual) : 0,
    classRevenue: v.classRevenue !== "" && v.classRevenue != null ? Number(v.classRevenue) : null,
    bonus: v.bonus ? Number(v.bonus) : 0,
    unusedLeaveDays: v.unusedLeaveDays ? Number(v.unusedLeaveDays) : 0,
  };
}

/** 정렬키 → 열 이름 — 여러 단계로 정렬했을 때 순서를 풀어 보여주기 위함 */
const SORT_LABELS: Record<string, string> = {
  name: "직원",
  scheme: "형태",
  gross: "지급액",
  totalDeduct: "공제액",
  net: "실수령",
  status: "상태",
};

export default function PayrollClient({ today }: { today: string }) {
  // 마지막으로 보던 연·월을 기억한다 — 급여 작업은 한 달을 며칠에 걸쳐 여러 번 드나들며 한다
  const [period, setPeriod] = useStoredState("payroll.period", {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const { year, month } = period;
  const setYear = (y: number) => setPeriod((p) => ({ ...p, year: y }));
  const setMonth = (m: number) => setPeriod((p) => ({ ...p, month: m }));
  const [recs, setRecs] = useState<Rec[]>([]);
  const [inputs, setInputs] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [openDedId, setOpenDedId] = useState<number | null>(null);
  const [unlockRec, setUnlockRec] = useState<Rec | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [tsResult, setTsResult] = useState<any>(null);
  const [incResult, setIncResult] = useState<any>(null);
  // 이름 검색은 기억하지 않는다 — 그때그때 한 사람 찾는 동작이지 기본값이 아니다
  const [q, setQ] = useState("");
  // 옛 단일 선택 저장값을 배열 형식으로 받아 준다
  const [filter, setFilter, clearFilter] = useStoredState("payroll.filter", DEFAULT_FILTER, (v) =>
    normalizeFilterSet(FILTER_KEYS, v)
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/payroll?year=${year}&month=${month}`);
    const data = res.ok ? await res.json() : [];
    setRecs(data);
    const map: Record<number, any> = {};
    data.forEach((r: Rec) => {
      map[r.employeeId] = rowInputsOf(r);
    });
    setInputs(map);
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function run() {
    setBusy("calc");
    const cleanInputs: Record<number, any> = {};
    for (const [id, v] of Object.entries(inputs)) {
      cleanInputs[Number(id)] = cleanRowInput(v);
    }
    const res = await fetch("/api/payroll/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, inputs: cleanInputs }),
    });
    const j = await res.json().catch(() => ({}));
    await load();
    setBusy("");
    // 시트에서 빠진 사람은 반드시 알린다 — 조용히 사라지면 왜 없어졌는지 알 수 없고,
    // 퇴직일 오타 하나로 멀쩡한 행이 지워진 것을 알아챌 길이 없다.
    const msgs: string[] = [];
    if (j.removed?.length)
      msgs.push(
        `퇴직·미입사로 시트에서 제외한 ${j.removed.length}명\n` +
          j.removed.map((e: any) => `· ${e.note}`).join("\n") +
          `\n\n실제로는 지급할 몫이 남았다면 «＋ 직원 추가» 로 다시 올릴 수 있습니다.` +
          `\n퇴직일이 잘못 입력된 것이라면 직원 정보를 고친 뒤 다시 산정하세요.`
      );
    if (j.locked?.length)
      msgs.push(
        `⚠️ 재직 기간이 없는데 이미 명세서가 발송돼 그대로 둔 ${j.locked.length}건\n` +
          j.locked.map((e: any) => `· ${e.note}`).join("\n") +
          `\n→ 잘못된 발송이면 상태 필터를 '발송완료' 로 좁혀 «🔓 발송 잠금 해제» 후 다시 산정하세요.`
      );
    if (msgs.length) alert(msgs.join("\n\n"));
  }

  /** 시트에서 내리기 — 직접 추가한 행만 (재직자 행은 다음 산정에서 도로 생긴다) */
  async function dropRow(r: Rec) {
    if (!confirm(`${r.employee.name}의 ${year}년 ${month}월 급여 기록을 시트에서 내릴까요?\n직접 추가했던 행이라 되돌리려면 다시 추가해야 합니다.`))
      return;
    setBusy(`drop-${r.id}`);
    const res = await fetch(`/api/payroll/${r.id}`, { method: "DELETE" });
    setBusy("");
    if (!res.ok) return alert("내리기 실패: " + ((await res.json().catch(() => ({}))).error || ""));
    await load();
  }

  /** 한 직원만 변동입력 저장 + 재산정 (다른 행의 입력 중인 값은 유지) */
  async function saveRow(employeeId: number) {
    setBusy(`row-${employeeId}`);
    const res = await fetch("/api/payroll/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year,
        month,
        inputs: { [employeeId]: cleanRowInput(inputs[employeeId] ?? {}) },
        employeeIds: [employeeId],
      }),
    });
    if (!res.ok) {
      alert("저장 실패: " + ((await res.json().catch(() => ({}))).error || ""));
      setBusy("");
      return;
    }
    // 해당 행만 서버 값으로 갱신 — 다른 행에 입력해 둔 값은 지우지 않는다
    const r2 = await fetch(`/api/payroll?year=${year}&month=${month}`);
    const data: Rec[] = r2.ok ? await r2.json() : [];
    setRecs(data);
    const fresh = data.find((x) => x.employeeId === employeeId);
    if (fresh) setInputs((p) => ({ ...p, [employeeId]: rowInputsOf(fresh) }));
    setBusy("");
  }

  /** 세무사무소 제출용 급여자료(엑셀) 내려받기 */
  async function exportForTax() {
    setBusy("export");
    try {
      const res = await fetch(`/api/payroll/export?year=${year}&month=${month}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert("내려받기 실패: " + (j.error || res.statusText));
        return;
      }
      // 세무사에게 넘기기 전에 확인해야 할 것이 있으면 먼저 알린다
      try {
        const raw = res.headers.get("X-Export-Warnings");
        if (raw) {
          const w = JSON.parse(atob(raw));
          const msgs = [
            w.missingId?.length
              ? `주민등록번호(ID)가 비어 있는 직원 ${w.missingId.length}명: ${w.missingId.join(", ")}\n→ 직원 정보에 입력한 뒤 다시 받으세요.`
              : "",
            w.mismatches?.length ? `합계가 맞지 않는 행 ${w.mismatches.length}건:\n${w.mismatches.join("\n")}` : "",
          ].filter(Boolean);
          if (msgs.length) alert("⚠️ 확인이 필요합니다\n\n" + msgs.join("\n\n"));
        }
      } catch {}
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `급여자료_${year}-${String(month).padStart(2, "0")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy("");
    }
  }

  /** 은행 파일이체(대량이체)용 파일 — 세후 실지급액이 그대로 돈이 되어 나간다 */
  async function exportForBank() {
    setBusy("bank");
    try {
      const res = await fetch(`/api/payroll/bank-export?year=${year}&month=${month}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert("내려받기 실패: " + (j.error || res.statusText));
        return;
      }
      try {
        const raw = res.headers.get("X-Export-Warnings");
        if (raw) {
          const w = JSON.parse(atob(raw));
          const msgs = [
            w.missingAccount?.length
              ? `계좌가 없어 빠진 ${w.missingAccount.length}건: ${w.missingAccount.join(", ")}\n→ 직원 정보에 은행·계좌번호를 넣은 뒤 다시 받으세요.`
              : "",
            w.zeroAmount?.length ? `지급액이 0원이라 빠진 직원: ${w.zeroAmount.join(", ")}` : "",
            // 돈이 실제로 나가는 파일이라 여기서 한 번 더 걸리게 한다 (막지는 않는다)
            w.resigned?.count
              ? `오늘 기준 이미 퇴직한 직원 ${w.resigned.count}명이 이체 파일에 있습니다 (실지급 ${Number(
                  w.resigned.gross
                ).toLocaleString()}원)\n${w.resigned.names.join(", ")}\n→ 마지막 급여·퇴직 정산이면 정상입니다. 아니라면 올리기 전에 확인하세요.`
              : "",
          ].filter(Boolean);
          if (msgs.length) alert("⚠️ 확인이 필요합니다\n\n" + msgs.join("\n\n"));
        }
      } catch {}
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `이체_${year}-${String(month).padStart(2, "0")}.xls`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy("");
    }
  }

  async function sendEmails() {
    if (
      !confirm(
        `${year}년 ${month}월 급여명세서를 이메일로 발송하시겠습니까?\n` +
          `발송된 기록은 자동으로 잠겨(발송완료) 재계산·공제 수정이 되지 않습니다.\n\n` +
          `뒤늦게 잘못이 드러나면 상태 필터를 '발송완료' 로 좁힌 뒤 '🔓 발송 잠금 해제'로 되돌릴 수 있습니다 (사유 입력 필요).\n` +
          `다만 직원이 받은 메일은 되돌릴 수 없어 정정본을 다시 보내게 되므로, 보내기 전에 확인하는 편이 낫습니다.`
      )
    )
      return;
    setBusy("email");
    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month }),
    });
    const j = await res.json().catch(() => ({}));
    alert(
      res.ok
        ? `발송 완료: 성공 ${j.sent ?? 0}건 / 실패 ${j.failed ?? 0}건` +
          (j.skippedSent ? `\n(이미 발송되어 제외: ${j.skippedSent}건)` : "")
        : `발송 실패: ${j.error || "SMTP 설정을 확인하세요"}`
    );
    setBusy("");
    await load();
  }

  async function uploadTimesheet(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("ts");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("year", String(year));
    fd.append("month", String(month));
    const res = await fetch("/api/payroll/timesheet", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (res.ok) {
      setTsResult(j);
      // 파일에서 감지한 연·월로 화면 전환 (다르면 자동 재조회됨)
      if (j.year === year && j.month === month) await load();
      else {
        setYear(j.year);
        setMonth(j.month);
      }
    } else {
      alert(
        "업로드 실패: " + (j.error || "") +
        (j.unmatched?.length ? "\n\n[직원 카드 없음]\n" + j.unmatched.join(", ") : "") +
        (j.noRecords?.length ? "\n\n[해당 월 기록 없음]\n" + j.noRecords.join(", ") : "")
      );
    }
  }

  async function uploadIncentive(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("inc");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("year", String(year));
    fd.append("month", String(month));
    const res = await fetch("/api/payroll/incentive", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (res.ok) {
      setIncResult(j);
      await load();
    } else {
      alert("업로드 실패: " + (j.error || ""));
    }
  }

  function openPayslip(id: number) {
    fetch("/api/documents/payslip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payrollId: id }),
    }).then(async (res) => {
      if (!res.ok) return alert("생성 실패: " + (await res.text()));
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    });
  }

  const setInput = (id: number, k: string, v: any) =>
    setInputs((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));

  // 합계 카드는 **거른 것과 무관하게 그 달 전체**를 보여 준다 — 은행·세무로 나가는 실제 총액이라
  // 화면을 걸렀다고 줄어들면 안 된다. 대신 필터가 걸려 있으면 카드에 '전체 기준' 을 붙인다.
  const totalNet = recs.reduce((s, r) => s + r.net, 0);
  const totalGross = recs.reduce((s, r) => s + r.gross, 0);

  // 조회 시점 기준 이미 퇴직한 사람 — 합계 카드와 같은 원칙으로 **거른 것과 무관하게**
  // 그 달 전체를 센다. 화면을 걸렀다고 경고가 사라지면 경고가 아니게 된다.
  const resigned = React.useMemo(
    () =>
      resignedSummary(
        recs.map((r) => ({ name: r.employee.name, resignDate: r.employee.resignDate, gross: r.gross })),
        today
      ),
    [recs, today]
  );

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return recs.filter((r) => {
      if (!matchesFilter(filter.scheme, r.payScheme)) return false;
      if (!matchesFilter(filter.income, r.incomeType)) return false;
      if (!matchesFilter(filter.status, r.status)) return false;
      if (
        needle &&
        ![r.employee.name, r.employee.department, r.employee.position]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      )
        return false;
      return true;
    });
  }, [recs, q, filter]);

  const { sorted, sort, toggle, resetSort, hasSort } = useTableSort(filtered, pickRec, "payroll.sort");

  /**
   * 지금 보이는 행의 소계 — 표 맨 아래에 붙여 둔다.
   * 필터를 걸면 그 묶음의 합이 되므로(예: 사업소득만 31명) 위 합계 카드(그 달 전체)와
   * 나란히 놓고 볼 수 있다. 열 밑에 그대로 정렬돼야 읽히므로 카드가 아니라 표 안에 둔다.
   */
  const sub = React.useMemo(
    () =>
      sorted.reduce(
        (a, r) => ({
          gross: a.gross + r.gross,
          deduct: a.deduct + r.totalDeduct,
          net: a.net + r.net,
        }),
        { gross: 0, deduct: 0, net: 0 }
      ),
    [sorted]
  );
  // 정렬도 기억하므로 '되돌릴 게 있는지' 판단에 함께 넣는다
  const dirty = !!q || anyFilterActive(filter) || hasSort;
  const resetView = () => {
    setQ("");
    clearFilter();
    resetSort();
  };
  const setF = (k: keyof typeof DEFAULT_FILTER) => (v: FilterValues) =>
    setFilter((p) => ({ ...p, [k]: v }));

  return (
    /* 화면을 두 층으로 나눈다 — 연·월 선택과 합계는 늘 붙어 있고 **표만 안에서 스크롤**한다.
       47명을 넘어가면 아래로 내려갈수록 어느 입력칸인지 분간이 안 돼 잘못 적기 쉬웠다.
       창이 짧으면 min-h 가 걸려 예전처럼 페이지째 스크롤된다. */
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100dvh-9rem)] min-h-[28rem]">
      <div className="shrink-0">
      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select className="input w-24" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
        <button className="btn-primary" onClick={run} disabled={!!busy}>
          {busy === "calc" ? "산정 중…" : "급여 일괄 산정"}
        </button>
        <button
          className="btn-outline"
          onClick={() => setAddOpen(true)}
          disabled={!!busy}
          title="퇴직자에게 남은 지급분(보강 수당·미사용 연차수당·인센티브 정산)을 이 달 시트에 올립니다"
        >
          ＋ 직원 추가
        </button>
        <label className={`btn-outline cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          {busy === "ts" ? "처리 중…" : "📤 시간기록표 업로드"}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={uploadTimesheet} />
        </label>
        <label
          className={`btn-outline cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}
          title="강사별 탭이 있는 관리시트를 그대로 올리면 됩니다. 선택한 연·월의 명단만 반영하고, 명세서 뒤에 산정 내역서가 따라붙습니다."
        >
          {busy === "inc" ? "처리 중…" : "📤 학생 명단 업로드"}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={uploadIncentive} />
        </label>
        <div className="flex-1" />
        {/* 산정이 끝난 뒤에 쓰는 것들 — 좁아져도 셋이 함께 줄바꿈되게 묶어 둔다 */}
        {recs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-outline"
              onClick={exportForTax}
              disabled={!!busy}
              title="세무대행 업체에 넘기는 급여자료 양식 그대로 엑셀로 받습니다"
            >
              {busy === "export" ? "만드는 중…" : "📊 세무사무소 제출자료"}
            </button>
            <button
              className="btn-outline"
              onClick={exportForBank}
              disabled={!!busy}
              title="세후 실지급액을 은행 파일이체(대량이체)에 올릴 수 있는 엑셀로 받습니다"
            >
              {busy === "bank" ? "만드는 중…" : "🏦 은행 이체 파일"}
            </button>
            <button className="btn-outline" onClick={sendEmails} disabled={!!busy}>
              {busy === "email" ? "발송 중…" : "명세서 이메일 발송"}
            </button>
          </div>
        )}
      </div>

      {tsResult && (
        <div className="card p-4 mb-5 border-emerald-200 bg-emerald-50/40 max-h-[38vh] overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-emerald-800 text-sm">
              ✅ 시간기록표 반영 완료 — {tsResult.year}년 {tsResult.month}월
              {tsResult.periodDetected && <span className="font-normal text-emerald-600"> (파일에서 자동 감지)</span>}
              {" "}· {tsResult.matched.length}명
            </span>
            <button className="text-xs text-slate-400" onClick={() => setTsResult(null)}>닫기 ✕</button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left py-1">직원</th>
                <th className="text-right">근무일</th>
                <th className="text-right">체류</th>
                <th className="text-right">순 근로</th>
                <th className="text-right">연차</th>
                <th className="text-right">산정시간</th>
                <th className="text-right">주휴시간</th>
                <th className="text-left pl-3">휴게 30분</th>
                <th className="text-left">주별 주휴 판정</th>
              </tr>
            </thead>
            <tbody>
              {tsResult.matched.map((m: any) => (
                <tr key={m.employeeId} className="border-t border-emerald-100">
                  <td className="py-1 font-semibold">{m.name}</td>
                  <td className="text-right tnum">{m.workedDays}일</td>
                  <td className="text-right tnum text-slate-500">{fmtHM(m.stayHours)}</td>
                  <td className="text-right tnum">{fmtHM(m.netHours)}</td>
                  <td className="text-right tnum text-slate-500">
                    {m.leaveHours ? `${fmtHM(m.leaveHours)} (${m.leaveDays}일)` : "-"}
                  </td>
                  <td className="text-right tnum font-semibold">{fmtHM(m.workHours)}</td>
                  <td className="text-right tnum font-semibold">{m.weeklyHolidayHours ? fmtHM(m.weeklyHolidayHours) : "-"}</td>
                  <td className="pl-3">{m.breakPaid ? "유급(그대로)" : "무급(−30분/일)"}</td>
                  <td className="text-slate-500">
                    {m.noSchedule && m.leaveDays > 0 && (
                      <div className="text-amber-700 mb-0.5">
                        ⚠️ 근로시간표 없음 — 연차 사용일의 유급 시간을 환산하지 못했습니다
                      </div>
                    )}
                    {m.skippedRows > 0 && (
                      <div className="text-rose-700 mb-0.5">
                        ⚠️ 근무시간을 못 읽은 행 {m.skippedRows}건 — 그날 근로시간이 통째로 빠져
                        그 주 15시간 판정이 틀어질 수 있습니다.
                        해당 칸이 <code>4:47:55</code> 같은 시간 값인지 확인하세요.
                      </div>
                    )}
                    <div className="mb-0.5">
                      {m.weekMode === "fixed" ? (
                        <span className="pill bg-sky-50 text-sky-700">
                          계약 근무요일 개근 판정 (주{m.weeks[0]?.requiredDays ?? 5}일 · {fmtHM(m.contractualHours)})
                        </span>
                      ) : (
                        <span className="pill bg-slate-100 text-slate-500">주 실근로 15시간 판정</span>
                      )}
                    </div>
                    <div className="space-y-0.5">
                      {m.weeks.map((w: any) => (
                        <div key={w.weekStart}>
                          <span className="tnum">{w.weekStart.slice(5)}~{w.weekEnd.slice(5)}</span>{" "}
                          <span
                            className={`tnum ${w.eligible ? "font-semibold text-slate-600" : ""}`}
                            title={w.attendedDates?.length ? `출근·연차: ${w.attendedDates.map((d: string) => d.slice(5)).join(", ")}` : undefined}
                          >
                            {fmtHM(w.actualHours)}
                          </span>
                          <span className="text-slate-300">
                            {" "}· {w.mode === "fixed" ? `${w.attendedDays}/${w.requiredDays}일` : `${w.attendedDays}일`}
                          </span>{" "}
                          {w.qualified ? (
                            w.carriedToNextMonth ? (
                              <span className="text-slate-400">
                                주휴 {fmtHM(w.holidayHours)} → 다음 달에 반영
                              </span>
                            ) : (
                              <span className="text-emerald-700 font-semibold">
                                ✓ 주휴 {fmtHM(w.holidayHours)}
                              </span>
                            )
                          ) : (
                            <span className={w.partial ? "text-amber-700" : "text-slate-400"}>
                              {w.partial ? "⏸" : "✕"} {w.reason}
                            </span>
                          )}
                          {w.attendedDates?.length > 0 && (
                            <span className="text-slate-300 tnum">
                              {" "}({w.attendedDates.map((d: string) => d.slice(8)).join("·")}일)
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tsResult.unmatched?.length > 0 && (
            <p className="text-xs text-amber-700 mt-2">
              ⚠️ <b>직원 카드 없음</b>: {tsResult.unmatched.join(", ")} — 직원 관리에서 시급제로 등록하면 다음 업로드부터 자동 반영됩니다.
            </p>
          )}
          {tsResult.noRecords?.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              ℹ️ 해당 월 기록 없음: {tsResult.noRecords.join(", ")}
            </p>
          )}
        </div>
      )}

      {incResult && (
        <div className="card p-4 mb-5 border-indigo-200 bg-indigo-50/40 max-h-[38vh] overflow-auto">
          <div className="flex items-center justify-between mb-2 sticky top-0 bg-indigo-50/95 -mx-4 px-4 py-1">
            <span className="font-bold text-indigo-900 text-sm">
              ✅ 학생 명단 반영 — {incResult.year}년 {incResult.month}월 · 강사 {incResult.okCount}명
              {incResult.failCount > 0 && (
                <span className="text-rose-700"> · 반영 못 함 {incResult.failCount}명</span>
              )}
            </span>
            <button className="text-xs text-slate-400" onClick={() => setIncResult(null)}>닫기 ✕</button>
          </div>
          <p className="text-[11px] text-slate-500 mb-2">
            명단이 반영된 강사는 급여명세서 뒤에 <b>산정 내역서</b>가 자동으로 따라붙습니다.
            명단이 없는 달은 명세서만 나갑니다.
          </p>
          <div className="space-y-1.5">
            {(incResult.results ?? []).map((r: any, i: number) => (
              <div
                key={i}
                className={`rounded border px-2.5 py-1.5 text-xs ${
                  r.ok ? "border-indigo-100 bg-white" : "border-rose-200 bg-rose-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800">
                    {r.name ?? r.teacherName} 선생님
                    <span className="ml-1.5 font-normal text-[10px] text-slate-400">
                      {r.kind === "REVENUE" ? "매출 기준" : "인원 기준"} · 학생 {r.totalCount}명
                    </span>
                  </span>
                  {r.ok ? (
                    <span className="tnum font-bold text-indigo-800">
                      {r.kind === "REVENUE"
                        ? `매출 ${won(r.revenue)}원 × ${((r.contractPercent ?? 0) * 100).toFixed(1)}% = ${won(r.amount)}원`
                        : `초과 ${Number(r.over ?? 0).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}명 × ${won(r.perStudent)}원 = ${won(r.amount)}원`}
                    </span>
                  ) : (
                    <span className="text-rose-700 font-semibold">{r.error}</span>
                  )}
                </div>
                {r.warnings?.map((w: string, k: number) => (
                  <div key={k} className="text-[11px] text-amber-700 mt-0.5">
                    ⚠️ {w}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-5">
          {([
            ["지급 인원", `${recs.length}명`, ""],
            ["지급총액", `${won(totalGross)}원`, ""],
            ["실지급액", `${won(totalNet)}원`, "text-brand-600"],
          ] as Array<[string, string, string]>).map(([label, value, cls]) => (
            <div className="card p-4" key={label}>
              <div className="text-xs text-slate-500">
                {label}
                {/* 걸러 보는 중이라도 카드는 그 달 전체 금액이다 — 오해하지 않게 밝혀 둔다 */}
                {dirty && <span className="text-slate-300 ml-1">· 전체 기준</span>}
              </div>
              <div className={`stat-num ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 지급 전에 한 번 걸리게 하는 줄 — 행마다 붙은 표시는 스크롤해야 보이지만
          이 줄은 늘 위에 있다. 몇 명이 얼마짜리인지까지 적어야 실제로 확인하게 된다. */}
      {resigned.count > 0 && (
        <div className="card p-3 mb-5 border-rose-200 bg-rose-50/60 text-sm text-rose-900">
          <b>⚠️ 오늘 기준 이미 퇴직한 직원 {resigned.count}명</b>이 이 달 시트에 있습니다 · 지급액{" "}
          <b>{won(resigned.gross)}원</b>
          <div className="text-xs text-rose-700 mt-1">
            {resigned.names.join(", ")}
          </div>
          <div className="text-xs text-rose-700/80 mt-1">
            그 달에 재직한 마지막 급여이거나 직접 올린 정산분이면 정상입니다. 아니라면
            이체 전에 <b>직원 정보의 퇴사일</b>을 확인하고 <b>급여 일괄 산정</b>을 다시 누르세요.
          </div>
        </div>
      )}

      </div>

      {/* 표 — 남은 높이를 채우고 여기 안에서만 스크롤한다(필터 줄과 머리글은 붙어 있다) */}
      <div className="card flex flex-col flex-1 min-h-0">
        {recs.length > 0 && (
          <FilterBar
            shown={sorted.length}
            total={recs.length}
            dirty={dirty}
            onReset={resetView}
            sort={sort}
            sortLabels={SORT_LABELS}
          >
            <input
              className="input py-1 text-xs w-40"
              placeholder="이름·부서·직책 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <FilterSelect
              label="급여형태"
              value={filter.scheme}
              onChange={setF("scheme")}
              options={Object.entries(PAY_SCHEME_LABEL).map(([v, l]) => ({ value: v, label: l }))}
            />
            <FilterSelect
              label="세무/보험"
              value={filter.income}
              onChange={setF("income")}
              options={Object.entries(INCOME_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))}
            />
            <FilterSelect
              label="상태"
              value={filter.status}
              onChange={setF("status")}
              options={Object.entries(PAYROLL_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))}
            />
          </FilterBar>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="text-center text-slate-400 py-12">불러오는 중…</div>
        ) : recs.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            {year}년 {month}월 급여 기록이 없습니다. <b>급여 일괄 산정</b>을 눌러 계산하세요.
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center text-slate-400 py-12">조건에 맞는 직원이 없습니다.</div>
        ) : (
          <table className="w-full min-w-[1180px] text-sm [&_td]:px-2 [&_th]:px-2">
            {/* 머리글 고정 — th 마다 걸어야 한다(thead 만으로는 안 붙는 브라우저가 있다).
                아래 경계선은 border 가 아니라 inset shadow 로 그린다 — sticky 인 셀의 border 는
                스크롤할 때 같이 밀려 사라진다. */}
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-[inset_0_-1px_0_#e2e8f0]">
              <tr>
                <SortTh label="직원" sortKey="name" sort={sort} onSort={toggle} />
                <SortTh label="형태" sortKey="scheme" sort={sort} onSort={toggle} />
                <th className="th">
                  {/* 입력칸 라벨은 여기 한 번만 — 행마다 반복하면 폭이 두 배가 되고 값도 라벨에 밀린다.
                      아래 각 행의 그리드와 **같은 열 정의**를 써야 위아래가 맞는다. */}
                  <div className="grid grid-cols-[4.25rem_4.5rem_repeat(4,2.6rem)_4.5rem_2.75rem_auto] items-center gap-x-1.5 font-normal normal-case tracking-normal text-[10px] text-slate-400">
                    <span className="truncate" title="인센티브=학생수 · 완전비율제=반 매출">학생/매출</span>
                    <span
                      className="truncate"
                      title="인센티브 금액을 직접 넣습니다. 학생수 자동산정을 쓰는 달이면 그 위에 더해집니다."
                    >
                      인센티브
                    </span>
                    <span title="평일 소정근로 외·토요일 중 1일 8h·주 40h 이내 (가산 없음)">추가h</span>
                    <span title="1일 8시간·주 40시간 초과분 (×1.5)">연장h</span>
                    <span title="일요일·공휴일 근무 (×1.5)">휴일h</span>
                    <span title="22시~06시 근무 (+0.5)">야간h</span>
                    <span>상여</span>
                    <span title="미사용연차(일)">미사용</span>
                    <span />
                  </div>
                </th>
                <SortTh label="지급액" sortKey="gross" sort={sort} onSort={toggle} align="right" />
                <SortTh label="공제액" sortKey="totalDeduct" sort={sort} onSort={toggle} align="right" />
                <SortTh label="실수령" sortKey="net" sort={sort} onSort={toggle} align="right" />
                <SortTh label="상태" sortKey="status" sort={sort} onSort={toggle} />
                <th className="th">명세서</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                // 근로기준법 항목(가산·연차)을 다루는 행인가 — 위탁계약이면 아니다
                const statutory = !isContractorContract({
                  payScheme: r.payScheme,
                  isContractor: r.employee?.isContractor,
                });
                // **조회 시점** 기준 퇴직 여부 — 이 달 시트에 있는 것은 맞아도(마지막 급여)
                // 지금은 이미 나간 사람일 수 있다. 이름만 봐서는 구분이 안 돼 엉뚱한 사람에게
                // 급여가 나갈 수 있으므로 행째로 다르게 그린다.
                const resign = resignStatusOf(r.employee.resignDate, today);
                return (
                <React.Fragment key={r.id}>
                <tr
                  className={
                    resign === "RESIGNED"
                      ? "bg-rose-50/50 hover:bg-rose-50"
                      : resign === "LEAVING"
                        ? "bg-amber-50/40 hover:bg-amber-50"
                        : "hover:bg-slate-50"
                  }
                >
                  <td className="td">
                    <div className="font-semibold whitespace-nowrap flex items-center gap-1.5">
                      <span className={resign === "RESIGNED" ? "text-rose-900" : undefined}>
                        {r.employee.name}
                      </span>
                      {resign !== "NONE" && r.employee.resignDate && (
                        <span
                          className={`pill text-[10px] whitespace-nowrap ${
                            resign === "RESIGNED"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                          title={
                            resign === "RESIGNED"
                              ? "오늘 기준 이미 퇴직한 직원입니다. 이 달 마지막 급여가 맞는지 확인하고 이체하세요."
                              : "퇴사일이 잡혀 있습니다. 이 달이 마지막 급여가 될 수 있습니다."
                          }
                        >
                          {resignBadgeLabel(r.employee.resignDate, resign)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 whitespace-nowrap">
                      {r.employee.department} {r.employee.position}
                    </div>
                    {r.prorationRatio < 1 && (r.payScheme === "MONTHLY" || r.payScheme === "INCENTIVE") && (
                      <div className="text-[10px] text-amber-600 mt-0.5">일할 {(r.prorationRatio * 100).toFixed(0)}%</div>
                    )}
                    {/* 재직 기간이 없는데 올라와 있는 행 — 왜 여기 있는지가 행에 드러나야 한다 */}
                    {r.manualAdd && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span
                          className="pill bg-violet-50 text-violet-700 text-[10px]"
                          title={`${r.employee.resignDate ? r.employee.resignDate.slice(0, 10) + " 퇴직 — " : ""}재직 기간이 없지만 직접 올린 행입니다. 기본급은 0원이고 직접 넣은 항목만 지급됩니다.`}
                        >
                          직접 추가
                        </span>
                        {r.status !== "SENT" && (
                          <button
                            className="text-[10px] text-slate-400 hover:text-rose-600"
                            onClick={() => dropRow(r)}
                            disabled={!!busy}
                            title="이 행을 시트에서 내립니다"
                          >
                            내리기 ✕
                          </button>
                        )}
                      </div>
                    )}
                    {/* 인센티브 칸이 없던 시절 상여 칸에 인센티브를 넣던 흔적 —
                        그대로 두면 퇴직유보금(인센티브×1/12)이 잡히지 않는다 */}
                    {r.payScheme === "INCENTIVE" && r.bonusP > 0 && r.incentiveP === 0 && (
                      <div
                        className="text-[10px] text-amber-700 mt-0.5"
                        title="퇴직유보금은 인센티브 금액에만 붙습니다. 상여 칸에 넣은 인센티브는 유보 대상에서 빠집니다."
                      >
                        ⚠️ 상여만 있고 인센티브 0 — 인센티브 칸으로 옮기세요
                      </div>
                    )}
                  </td>
                  <td className="td w-px">
                    <div className="flex flex-col items-start gap-1">
                      <Pill kind={r.payScheme}>{PAY_SCHEME_LABEL[r.payScheme]}</Pill>
                      <Pill kind={r.incomeType}>{r.incomeType === "FREELANCE" ? "사업소득" : "근로소득"}</Pill>
                      {!statutory && (
                        <span
                          className="pill bg-amber-50 text-amber-700"
                          title="위탁계약(프리랜서) — 주휴수당·연차·퇴직금·4대보험·법정가산을 적용하지 않습니다."
                        >
                          위탁
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    {/* 급여형태마다 필요한 입력이 달라도 **같은 열에 서도록** 고정폭 그리드로 둔다.
                        예전엔 flex-wrap 이라 인센티브 행만 두 줄로 접히고 위탁 행은 텅 비어
                        행 높이와 라벨 위치가 제각각이었다. 안 쓰는 칸은 빈 칸으로 자리만 지킨다. */}
                    <div className="grid grid-cols-[4.25rem_4.5rem_repeat(4,2.6rem)_4.5rem_2.75rem_auto] items-center gap-x-1.5">
                      {/* ① 학생수(인센티브) / 매출(비율제) */}
                      <div>
                        {r.payScheme === "INCENTIVE" &&
                          (r.studentUnits != null ? (
                            <span
                              className="text-[11px] bg-indigo-50 text-indigo-700 rounded px-2 py-1 whitespace-nowrap"
                              title="인센티브 명단(회차 비례) 기준 가중 인원 — 명단 업로드로 자동 산정됩니다"
                            >
                              명단 {Number(r.studentUnits).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}명
                            </span>
                          ) : (
                            <InlineInput label="" title="학생수" value={inputs[r.employeeId]?.studentCount ?? ""} onChange={(v) => setInput(r.employeeId, "studentCount", v)} />
                          ))}
                        {r.payScheme === "RATIO" && (
                          <InlineInput label="" title="매출" value={inputs[r.employeeId]?.classRevenue ?? ""} onChange={(v) => setInput(r.employeeId, "classRevenue", v)} />
                        )}
                      </div>

                      {/* ② 인센티브 금액 직접 입력 (월급+인센티브 계약자만) */}
                      <div>
                        {r.payScheme === "INCENTIVE" && (
                          <InlineInput
                            label=""
                            title="인센티브 금액 (학생수 자동산정분이 있으면 그 위에 더해집니다)"
                            value={inputs[r.employeeId]?.incentiveManual ?? ""}
                            onChange={(v) => setInput(r.employeeId, "incentiveManual", v)}
                          />
                        )}
                      </div>

                      {/* ③~⑥ 법정가산 시간 — 위탁계약은 대상이 아니라 칸 자체를 비운다 */}
                      {statutory ? (
                        <>
                          <InlineInput label="" title="추가h (법내연장)" value={inputs[r.employeeId]?.extraHours ?? ""} onChange={(v) => setInput(r.employeeId, "extraHours", v)} />
                          <InlineInput label="" title="연장h (법정 초과 ×1.5)" value={inputs[r.employeeId]?.overtimeHours ?? ""} onChange={(v) => setInput(r.employeeId, "overtimeHours", v)} />
                          <InlineInput label="" title="휴일h (×1.5)" value={inputs[r.employeeId]?.holidayHours ?? ""} onChange={(v) => setInput(r.employeeId, "holidayHours", v)} />
                          <InlineInput label="" title="야간h (+0.5)" value={inputs[r.employeeId]?.nightHours ?? ""} onChange={(v) => setInput(r.employeeId, "nightHours", v)} />
                        </>
                      ) : (
                        <div
                          className="col-span-4 text-[10px] text-slate-300 whitespace-nowrap"
                          title="위탁계약(프리랜서)은 연장·야간·휴일 가산과 연차 대상이 아닙니다"
                        >
                          가산·연차 항목 없음
                        </div>
                      )}

                      {/* ⑥ 상여 (모든 형태 공통) */}
                      <InlineInput label="" title="상여" value={inputs[r.employeeId]?.bonus ?? ""} onChange={(v) => setInput(r.employeeId, "bonus", v)} />

                      {/* ⑦ 미사용연차 */}
                      <div>
                        {statutory && (
                          <InlineInput label="" title="미사용연차(일)" value={inputs[r.employeeId]?.unusedLeaveDays ?? ""} onChange={(v) => setInput(r.employeeId, "unusedLeaveDays", v)} />
                        )}
                      </div>

                      <button
                        className="btn-primary justify-self-start py-1 px-2.5 text-xs whitespace-nowrap disabled:opacity-40"
                        disabled={!!busy || r.status === "SENT"}
                        title={r.status === "SENT" ? "명세서가 발송된 기록은 잠겨 있어 재계산되지 않습니다" : "이 직원만 저장하고 재산정"}
                        onClick={() => saveRow(r.employeeId)}
                      >
                        {busy === `row-${r.employeeId}` ? "저장 중…" : "저장"}
                      </button>
                    </div>
                  </td>
                  <td className="td text-right tnum whitespace-nowrap">{won(r.gross)}</td>
                  <td className="td text-right whitespace-nowrap">
                    <button
                      className="tnum text-slate-600 underline decoration-dotted underline-offset-2 hover:text-brand-600"
                      onClick={() => setOpenDedId(openDedId === r.id ? null : r.id)}
                      title="공제 편집 (클릭)"
                    >
                      {won(r.totalDeduct)}
                    </button>
                    <div
                      className={`text-[10px] ${r.deductMode === "AUTO" ? "text-emerald-600" : "text-amber-600"}`}
                    >
                      {r.deductMode === "AUTO" ? "자동" : "수동"} ▾
                    </div>
                  </td>
                  <td className="td text-right tnum font-bold whitespace-nowrap">{won(r.net)}</td>
                  <td className="td w-px whitespace-nowrap">
                    <Pill kind={r.status}>{PAYROLL_STATUS_LABEL[r.status] ?? r.status}</Pill>
                    {r.reissueCount > 0 && (
                      <div
                        className="text-[10px] text-rose-600 font-semibold"
                        title="발송 잠금을 풀고 고쳐 다시 발급한 건입니다. 명세서에 '정정 발급' 이 찍힙니다."
                      >
                        정정 {r.reissueCount}차
                      </div>
                    )}
                    {/* 발송된 기록은 잠긴다. 되돌리기 어려운 작업이라 평소에는 버튼을 숨기고,
                        상태 필터를 '발송완료' 로 좁혀 **정정하러 들어왔을 때만** 보여준다. */}
                    {r.status === "SENT" && filter.status.includes("SENT") && (
                      <button
                        className="mt-0.5 block text-[10px] text-slate-400 hover:text-rose-600 underline decoration-dotted underline-offset-2"
                        onClick={() => setUnlockRec(r)}
                        title="사유를 남기고 잠금을 풀면 수정·재발송할 수 있습니다"
                      >
                        🔓 발송 잠금 해제
                      </button>
                    )}
                  </td>
                  <td className="td w-px">
                    <button
                      className="text-xs text-brand-600 font-semibold whitespace-nowrap"
                      onClick={() => openPayslip(r.id)}
                    >
                      PDF
                    </button>
                  </td>
                </tr>
                {openDedId === r.id && (
                  <tr>
                    <td colSpan={8} className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                      <DeductionEditor rec={r} onSaved={async () => { setOpenDedId(null); await load(); }} onClose={() => setOpenDedId(null)} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
            {/* 소계 — 지금 보이는 행의 합. 스크롤해도 바닥에 붙어 금액 열 밑에 그대로 정렬된다.
                열은 8개(직원·형태·변동입력·지급액·공제액·실수령·상태·명세서)라 3 + 3 + 2 로 나눈다. */}
            <tfoot className="sticky-foot">
              <tr>
                <td className="td" colSpan={3}>
                  {dirty ? (
                    <>
                      <span className="text-brand-700">거른 {sorted.length}명 소계</span>
                      <span className="font-normal text-slate-400"> · 전체 {recs.length}명</span>
                    </>
                  ) : (
                    `합계 ${recs.length}명`
                  )}
                </td>
                <td className="td text-right tnum">{won(sub.gross)}</td>
                <td className="td text-right tnum">{won(sub.deduct)}</td>
                <td className="td text-right tnum text-brand-700">{won(sub.net)}</td>
                <td className="td" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
        </div>
      </div>
      {/* 계산 규칙 설명 — 표 높이를 뺏지 않게 접어 둔다. 표가 화면에 고정된 뒤로는
          400px 짜리 설명이 늘 펼쳐져 있으면 정작 볼 행이 두 줄밖에 남지 않는다. */}
      {recs.length > 0 && (
        <details className="shrink-0 mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700 select-none">
            표 보는 법 · 계산 규칙
          </summary>
        <div className="text-xs text-slate-400 mt-2 space-y-1 max-h-[40vh] overflow-auto">
          <p>
            ※ 변동입력은 각 행의 <b>저장</b> 버튼(해당 직원만 즉시 반영) 또는 상단 <b>급여 일괄 산정</b>(전체 반영)으로 저장·재계산됩니다.
            명세서 <b>이메일 발송이 완료된 기록은 자동으로 잠겨</b>(발송완료) 재계산·공제 수정이 되지 않으며, 재발송 시에도 제외됩니다.
          </p>
          <p>
            · 발송 뒤에 잘못이 드러났다면 <b>상태 필터를 '발송완료' 로 좁힌 뒤</b> 그 행의
            <b> 🔓 발송 잠금 해제</b>로 되돌릴 수 있습니다. <b>사유를 반드시 남겨야</b> 하고 작업 이력에 기록됩니다.
            푼 뒤에 고쳐 다시 보내면 메일 제목에 <b>[정정]</b>이, 명세서에 <b>정정 발급</b>과 최초 발급일이 찍혀
            직원이 받은 두 통 중 어느 것이 최종본인지 드러납니다.
            세무사무소 제출자료·은행 이체 파일을 이미 넘겼다면 <b>그쪽도 다시 받아 전달</b>해야 합니다.
          </p>
          <p>
            · <b>추가h</b>: 평일 소정근로 외·토요일 근무 중 <b>1일 8h·주 40h 이내</b>(법내연장) → 가산 없음(통상시급×1.0) &nbsp;
            · <b>연장h</b>: 1일 8시간·주 40시간 <b>초과분</b> → 연장근로수당(×1.5)
          </p>
          <p>
            · <b>휴일h</b>: 일요일(주휴일)·공휴일 근무시간 → 휴일근로수당(×1.5) &nbsp;
            · <b>야간h</b>: 22시~06시 근무시간 → 야간가산(+0.5)
          </p>
          <p>
            · <b>주휴수당(시급제)</b>은 <b>1주 단위</b>로 판정하고, 근무 형태에 따라 기준이 갈린다
            (근로기준법 §55·시행령 §30·§18③). 어느 쪽이든 그 주(월~일) 내내 근로관계가 있어야 하며,
            주휴일(일요일) 전에 퇴사하면 그 주는 미발생.
          </p>
          <p>
            · <b className="text-sky-700">주5일 계약</b> — 근무 요일이 바뀔 이유가 없으므로
            <b> 계약서에 정해진 근무요일을 다 채웠는지(개근)</b>로 본다. 그 주 공휴일은 채울 날에서 빠지고,
            연차 사용일은 출근으로 센다. 주휴시간 = 계약 주 소정근로시간 ÷ 5 (상한 8h).
          </p>
          <p>
            · <b>주2~4일 계약</b> — <b>매월 학원이 짜서 공지하는 근로계획표가 그 달의 소정근로</b>라
            계약 요일로는 판정할 수 없다. <b>그 주 실제 근로시간이 15시간 이상</b>이면 그 주에 한해 발생하며,
            다른 주가 미달이어도 무관하다. 주휴시간 = 그 주 근로시간 ÷ 5 (상한 8h).
          </p>
          <p>
            · <b>15시간을 잴 때는 휴게 30분을 유급·무급과 관계없이 항상 뺀다</b> — 휴게가 유급이라는 건
            그 시간도 돈을 준다는 뜻이지 소정근로시간이라는 뜻이 아니기 때문(§18③).
            그래서 <b>주휴 판정에 쓰는 시간은 위 산정시간과 다를 수 있다</b>.
            연차 사용일은 1일 소정근로시간(계약 주 시간 ÷ 주 근무일수)을 채운 것으로 센다.
          </p>
          <p>
            · <b>시급제에는 연장·휴일 가산을 붙이지 않는다</b> — 15시간을 넘긴 주마다 주휴를 인정하는 것이
            그 자리를 대신해 왔고, 1일 4.5시간 내외라 법정 가산 요건(1일 8h·주 40h 초과)에 닿지 않는다.
            보강 근무분만 <b>보강·오버타임</b> 화면에서 따로 산정된다.
          </p>
          <p>
            · <b>달을 걸친 주</b>는 <b>주휴일(일요일)이 속한 달</b>에서 한 번만 지급된다 —
            그 달 화면에 "다음 달에 반영"으로 뜨고, 다음 달을 산정할 때 그 주의 주휴가 실제로 붙는다.
            업로드한 일별 기록은 저장돼 있어서 <b>다음 달 파일에 앞달 며칠이 없어도</b> 개근을 판정할 수 있다.
          </p>
          <p>
            · <b>⏸ 판정 보류</b>: 그 주의 일부 날짜가 아직 한 번도 업로드된 적이 없어 그 주를 다 알 수
            없는 경우다. 모르는 날을 0시간·결근으로 깔면 주휴가 부당하게 빠지므로 추측하지 않고
            보류한다 — 그 주가 포함된 앞달 기록표를 한 번 올리면 자동으로 확정된다.
          </p>
          <p>
            · <b>체류 / 순 근로 / 산정시간</b>: 체류는 출근~퇴근 기록 그대로, 순 근로는 휴게 30분을 뺀 시간.
            급여는 휴게가 <b>유급이면 체류</b>, <b>무급이면 순 근로</b> 기준으로 산정하며, 여기에
            <b>연차 유급시간</b>(연차 일수 × 1일 소정근로시간)을 더한 것이 산정시간이다.
          </p>
          <p>
            · <b>상여</b>: 특별상여 금액(원) &nbsp;
            · <b>미사용연차(일)</b>: 소멸 예정 연차를 수당으로 정산할 일수 — 연차미사용수당 = 일수 × 통상시급 × 8시간
          </p>
          <p>
            · <b>공제</b>: 공제액 숫자를 클릭하면 편집창이 열립니다. 기본은 <b>수동입력</b>(세무사 지정값)이며,
            "자동 산출"로 전환하면 4대보험·간이세액표 기준으로 자동 계산됩니다.
            <b>퇴직유보금</b>(인센티브×8.3%)과 <b>주차비</b>(직원 정보의 월 정기주차×50%)는
            <b>기본값이 자동으로 채워지고</b>, 편집창에서 그 달만 다르게 고칠 수 있습니다.
            실비(±)·기타공제도 편집창에서 입력합니다.
            &nbsp;· 월중 입·퇴사자는 <b>일할계산</b>이 자동 적용됩니다.
          </p>
        </div>
        </details>
      )}
      {unlockRec && (
        <UnlockModal
          rec={unlockRec}
          onClose={() => setUnlockRec(null)}
          onDone={async () => {
            setUnlockRec(null);
            await load();
          }}
        />
      )}
      {addOpen && (
        <AddEmployeeModal
          year={year}
          month={month}
          onClose={() => setAddOpen(false)}
          onDone={async () => {
            setAddOpen(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

/**
 * 시트에 없는 직원을 이 달 시트에 올리는 창.
 *
 * 쓰는 자리는 대개 **퇴직자 정산**이다 — 마지막 급여를 보낸 뒤에 보강 수당이 확정되거나,
 * 미사용 연차수당·인센티브 정산이 남았을 때. 그래서 퇴직자를 목록 맨 위에 세우고,
 * **기본급이 0원이라는 사실을 미리 적는다** — 그걸 모르고 올리면 '왜 0원이냐' 가 되고,
 * 반대로 만근 금액이 나올 줄 알고 그대로 발송하면 되돌리기 어렵다.
 */
function AddEmployeeModal({
  year,
  month,
  onClose,
  onDone,
}: {
  year: number;
  month: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/payroll/add?year=${year}&month=${month}`)
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((j) => setList(j.candidates ?? []))
      .catch(() => setList([]));
  }, [year, month]);

  const shown = (list ?? []).filter((c) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [c.name, c.empNo, c.department, c.position]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function submit() {
    if (!picked.length) return;
    setSaving(true);
    const res = await fetch("/api/payroll/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, employeeIds: picked }),
    });
    setSaving(false);
    if (res.ok) await onDone();
    else alert("추가 실패: " + ((await res.json().catch(() => ({}))).error || ""));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl p-5 bg-white flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-slate-800 mb-1">
          ＋ 급여 시트에 직원 추가 — {year}년 {month}월
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          이 달 시트에 없는 직원입니다. 퇴직자가 먼저 나옵니다.
        </p>

        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1 mb-3">
          <div className="font-semibold">퇴직자를 올릴 때 알아두세요</div>
          <div>
            · 그 달 재직 기간이 없으므로 <b>일할계산 0% — 기본급·수당은 0원</b>입니다.
            보강 수당·미사용 연차수당·인센티브 정산처럼 <b>직접 넣는 항목만</b> 지급됩니다.
          </div>
          <div>
            · 올린 행은 <b>직접 추가</b> 표시가 붙어 다음 일괄 산정에서 사라지지 않습니다.
            잘못 올렸으면 행의 <b>내리기 ✕</b> 로 뺍니다.
          </div>
          <div>
            · 실제로는 그 달에도 재직한 것이라면 여기가 아니라 <b>직원 정보의 퇴사일</b>을
            고친 뒤 일괄 산정하세요 — 그래야 기본급이 제대로 잡힙니다.
          </div>
        </div>

        <input
          className="input mb-2"
          placeholder="이름·사번·부서로 찾기"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded">
          {list === null ? (
            <div className="text-center text-slate-400 py-10 text-sm">불러오는 중…</div>
          ) : shown.length === 0 ? (
            <div className="text-center text-slate-400 py-10 text-sm">
              {list.length === 0 ? "모든 직원이 이미 시트에 있습니다." : "조건에 맞는 직원이 없습니다."}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.map((c) => (
                <li key={c.id}>
                  <label className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked.includes(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <b className="text-sm">{c.name}</b>
                        <span className="text-xs text-slate-400">{c.empNo}</span>
                        <span className="text-xs text-slate-400">
                          {c.department} {c.position}
                        </span>
                        {c.reason === "RESIGNED" && (
                          <span className="pill bg-rose-50 text-rose-700 text-[10px]">
                            {c.resignDate} 퇴직
                          </span>
                        )}
                        {c.reason === "NOT_HIRED" && (
                          <span className="pill bg-slate-100 text-slate-600 text-[10px]">
                            {c.hireDate} 입사 예정
                          </span>
                        )}
                        {c.employed && (
                          <span className="pill bg-emerald-50 text-emerald-700 text-[10px]">재직 중</span>
                        )}
                      </span>
                      <span className="block text-[11px] text-slate-400 mt-0.5">
                        {c.employed
                          ? "재직 중인데 시트에 없습니다 — 일괄 산정을 돌리면 정상적으로 올라옵니다."
                          : "재직 기간 없음 — 기본급 0원, 직접 넣은 항목만 지급됩니다."}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-3">
          <span className="text-xs text-slate-500 mr-auto">
            {picked.length ? `${picked.length}명 선택` : "추가할 직원을 고르세요"}
          </span>
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving || !picked.length}>
            {saving ? "추가 중…" : "시트에 추가"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 발송 잠금 해제 창.
 *
 * 되돌리기 어려운 작업이라 confirm 한 줄로 끝내지 않는다 — **사유를 받아야** 하고,
 * 푼 뒤에 무엇을 더 해야 하는지(재산정 → 재발송, 세무·은행 자료 재전달)를 함께 알려야
 * '풀어만 놓고 잊는' 상태가 생기지 않는다.
 */
function UnlockModal({
  rec,
  onClose,
  onDone,
}: {
  rec: Rec;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const ok = reason.trim().length >= 2;

  async function submit() {
    if (!ok) return;
    setSaving(true);
    const res = await fetch(`/api/payroll/${rec.id}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setSaving(false);
    if (res.ok) await onDone();
    else alert("잠금 해제 실패: " + ((await res.json().catch(() => ({}))).error || ""));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg p-5 bg-white max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-slate-800 mb-1">
          🔓 발송 잠금 해제 — {rec.employee.name} · {rec.year}년 {rec.month}월
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          발송일 {rec.emailedAt ? new Date(rec.emailedAt).toLocaleDateString("ko-KR") : "-"} · 실수령{" "}
          {won(rec.net)}원
          {rec.reissueCount > 0 && (
            <span className="text-rose-600 font-semibold"> · 이미 {rec.reissueCount}차 정정된 기록입니다</span>
          )}
        </p>

        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1 mb-3">
          <div className="font-semibold">풀기 전에 알아두세요</div>
          <div>
            · <b>직원이 받은 메일은 되돌릴 수 없습니다.</b> 고친 뒤 다시 보내면 메일 제목에 <b>[정정]</b>,
            명세서에 <b>정정 발급</b>과 최초 발급일이 찍혀 어느 것이 최종본인지 드러납니다.
          </div>
          <div>
            · 푼 뒤에는 <b>재산정 → 이메일 재발송</b>까지 마쳐야 끝납니다. 풀어만 두면 그 달이
            '작성중' 으로 남습니다.
          </div>
          <div>
            · <b>세무사무소 제출자료·은행 이체 파일</b>을 이미 넘겼다면 금액이 바뀌므로
            <b> 다시 받아 전달</b>해야 합니다.
          </div>
          <div>· 누가·언제·왜 풀었는지 작업 이력에 남습니다.</div>
        </div>

        <label className="block text-xs font-semibold text-slate-600 mb-1">
          잠금 해제 사유 <span className="text-rose-600">*</span>
          <span className="font-normal text-slate-400"> — 작업 이력에만 남고 직원에게는 나가지 않습니다</span>
        </label>
        <textarea
          className="input w-full h-20 resize-none"
          placeholder="예) 7월 보강 오버타임 3시간이 누락되어 재산정 필요"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />

        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button
            className="btn-primary disabled:opacity-40"
            onClick={submit}
            disabled={!ok || saving}
            title={ok ? "" : "사유를 입력해야 풀 수 있습니다"}
          >
            {saving ? "해제 중…" : "잠금 해제"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface OtherItem {
  name: string;
  amount: string; // 입력 중 문자열 유지
}

function parseOtherItems(rec: Rec): OtherItem[] {
  try {
    const arr = rec.otherItems ? JSON.parse(rec.otherItems) : null;
    if (Array.isArray(arr) && arr.length) {
      return arr.map((it: any) => ({ name: String(it.name ?? ""), amount: String(it.amount ?? 0) }));
    }
  } catch {}
  // 과거 데이터: 합계만 있으면 단일 항목으로 노출
  return rec.otherD ? [{ name: "기타공제", amount: String(rec.otherD) }] : [];
}

function DeductionEditor({ rec, onSaved, onClose }: { rec: Rec; onSaved: () => Promise<void>; onClose: () => void }) {
  const [mode, setMode] = useState<string>(rec.deductMode || "MANUAL");
  const [f, setF] = useState({
    pensionD: rec.pensionD || "",
    healthD: rec.healthD || "",
    longTermD: rec.longTermD || "",
    employmentD: rec.employmentD || "",
    incomeTaxD: rec.incomeTaxD || "",
    localTaxD: rec.localTaxD || "",
    retentionD: rec.retentionD || "",
    parkingD: rec.parkingD || "",
    expenseD: rec.expenseD || "",
  });
  const [items, setItems] = useState<OtherItem[]>(() => parseOtherItems(rec));
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const setItem = (i: number, k: keyof OtherItem, v: string) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const otherSum = items.reduce((a, it) => a + (Number(it.amount) || 0), 0);

  async function save(nextMode: string) {
    setSaving(true);
    const body: any = { deductMode: nextMode };
    for (const [k, v] of Object.entries(f)) body[k] = v === "" ? 0 : Number(v);
    body.otherItems = items
      .map((it) => ({ name: it.name.trim(), amount: Number(it.amount) || 0 }))
      .filter((it) => it.name !== "" || it.amount !== 0);
    const res = await fetch(`/api/payroll/${rec.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) await onSaved();
    else alert("저장 실패: " + ((await res.json().catch(() => ({}))).error || ""));
  }

  const isFree = rec.incomeType === "FREELANCE";
  const manual = mode === "MANUAL";

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm font-bold text-slate-700">{rec.employee.name} — 공제 편집</span>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="radio" checked={manual} onChange={() => setMode("MANUAL")} /> 수동입력(세무사 값)
        </label>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="radio" checked={!manual} onChange={() => setMode("AUTO")} /> 자동 산출
        </label>
        <div className="flex-1" />
        <button className="btn-ghost py-1 px-2.5 text-xs" onClick={onClose}>닫기</button>
        <button className="btn-primary py-1 px-3 text-xs" disabled={saving} onClick={() => save(mode)}>
          {saving ? "저장 중…" : manual ? "저장" : "자동 산출 적용"}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {!isFree && (
          <>
            <DedField label="국민연금" v={f.pensionD} onChange={(v) => set("pensionD", v)} disabled={!manual} />
            <DedField label="건강보험" v={f.healthD} onChange={(v) => set("healthD", v)} disabled={!manual} />
            <DedField label="장기요양" v={f.longTermD} onChange={(v) => set("longTermD", v)} disabled={!manual} />
            <DedField label="고용보험" v={f.employmentD} onChange={(v) => set("employmentD", v)} disabled={!manual} />
          </>
        )}
        <DedField label={isFree ? "소득세(3%)" : "근로소득세"} v={f.incomeTaxD} onChange={(v) => set("incomeTaxD", v)} disabled={!manual} />
        <DedField label="지방소득세" v={f.localTaxD} onChange={(v) => set("localTaxD", v)} disabled={!manual} />
        {rec.payScheme === "INCENTIVE" &&
          !isContractorContract({
            payScheme: rec.payScheme,
            isContractor: rec.employee?.isContractor,
          }) && (
            <DedField label="퇴직유보금 (인센티브 × 1/12)" v={f.retentionD} onChange={(v) => set("retentionD", v)} />
          )}
        <DedField
          label={
            !rec.employee?.parkingFee
              ? "주차비 공제(±)"
              : rec.employee.parkingFee < 0
              ? `주차비 환급(±) (월 ${Math.abs(rec.employee.parkingFee).toLocaleString()}원 × 50%)`
              : `주차비 공제(±) (월 ${rec.employee.parkingFee.toLocaleString()}원 × 50%)`
          }
          v={f.parkingD}
          onChange={(v) => set("parkingD", v)}
          allowNegative
        />
        <DedField label="실비 정산(±)" v={f.expenseD} onChange={(v) => set("expenseD", v)} allowNegative />
      </div>
      {/* 기타공제 — 이름을 직접 기입하는 항목 리스트 */}
      <div className="mt-2 border border-slate-200 rounded-lg p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-slate-500">기타공제 항목</span>
          {items.length > 0 && (
            <span className="text-[11px] text-slate-500 tnum">
              합계 <b>{otherSum.toLocaleString()}원</b>
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input py-1 text-xs flex-1"
                placeholder="공제 이름 (예: 가불 상환, 동호회비)"
                value={it.name}
                onChange={(e) => setItem(i, "name", e.target.value)}
              />
              <input
                type="number"
                step={10}
                className="input py-1 text-xs w-36"
                placeholder="금액(원)"
                value={it.amount}
                onChange={(e) => setItem(i, "amount", e.target.value)}
              />
              <button
                type="button"
                className="text-slate-400 hover:text-red-500 text-sm px-1"
                title="항목 삭제"
                onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-brand-600 font-semibold"
            onClick={() => setItems((arr) => [...arr, { name: "", amount: "" }])}
          >
            + 항목 추가
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        {manual
          ? "수동입력: 4대보험·소득세는 세무사 지정값을 입력하세요. 저장 시 실수령액이 재계산됩니다."
          : "자동 산출: 4대보험·소득세를 요율·간이세액표로 재계산합니다. 회색 칸은 자동으로 채워집니다."}
        &nbsp;<b>주차비·실비 정산은 음수(−)</b> 입력 시 환급(지급 증가)으로 처리됩니다 — 앞달 과다공제분을 되돌릴 때 씁니다.
        {rec.payScheme === "INCENTIVE" && " 퇴직유보금 기본값은 인센티브 원천액의 8.3%(1/12)입니다(확인서 기준) — 상여금은 대상이 아니므로 인센티브는 '인센티브' 칸에 넣으세요."}
        {rec.employee?.parkingFee
          ? ` 주차비 기본값은 직원 정보의 월 정기주차 ${rec.employee.parkingFee.toLocaleString()}원의 50%입니다 — 0 으로 비우면 다음 재산정 때 기본값이 다시 채워지니, 그 달만 빼려면 (−)로 상계하세요.`
          : " 주차비를 매달 자동으로 넣으려면 직원 정보에 '월 정기주차 비용' 을 입력하세요."}
      </p>
    </div>
  );
}

function DedField({ label, v, onChange, disabled, allowNegative }: { label: string; v: any; onChange: (v: string) => void; disabled?: boolean; allowNegative?: boolean }) {
  return (
    <label className="text-[11px] text-slate-500">
      {label}
      <input
        type="number"
        step={10}
        min={allowNegative ? undefined : 0}
        className={`input py-1 mt-0.5 text-xs ${disabled ? "bg-slate-100 text-slate-400" : ""}`}
        value={v}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="bg-white/70 rounded-lg px-2.5 py-1.5">
      <div className="text-[10px] text-slate-400">{k}</div>
      <div className={`font-semibold tnum ${accent ? "text-indigo-700" : "text-slate-700"}`}>{v}</div>
    </div>
  );
}

function fmtHM(n: number): string {
  let h = Math.floor(n);
  let m = Math.round((n - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

function InlineInput({
  label,
  value,
  onChange,
  title,
}: {
  /** 보통 빈 문자열 — 라벨은 표 머리글에 한 번만 둔다 */
  label: string;
  value: any;
  onChange: (v: string) => void;
  /** 마우스를 올렸을 때 뜨는 항목 이름 */
  title?: string;
}) {
  return (
    <label
      className="inline-flex items-center gap-1 text-[10px] text-slate-400 whitespace-nowrap"
      title={title ?? label}
    >
      {label}
      <input
        className="w-full min-w-0 border border-slate-200 rounded px-1 py-0.5 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
