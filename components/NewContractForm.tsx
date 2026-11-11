"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONTRACT_STAGE_LABEL, PAY_SCHEME_LABEL, INCOME_TYPE_LABEL, parseSchedule } from "@/lib/constants";
import {
  nonCompetePayApplies,
  nonCompeteRequired,
  nonCompetePayError,
  nonCompeteRatioApplies,
  nonCompeteRatioRequired,
  nonCompeteRatioError,
  NON_COMPETE_REQUIRED_MESSAGE,
  nonCompeteRatioRequiredMessage,
} from "@/lib/non-compete";
import FixedHoursFields from "./FixedHoursFields";
import ContractorField from "./ContractorField";
import RatioContractField from "./RatioContractField";
import NonCompeteField from "./NonCompeteField";
import NonCompeteRatioField from "./NonCompeteRatioField";
import { PROBATION_MONTHS, probationTimeline } from "@/lib/probation";

/** 계약 단계별 수습 기본값 — 신규(단기/파트)만 수습 포함, 갱신·정규는 제외 */
function defaultProbation(stage: string): boolean {
  return stage === "SHORT_TERM_1" || stage === "PART";
}

interface EmpSnapshot {
  id: number;
  incomeType: string;
  payScheme: string;
  baseWage: number;
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  incThreshold: number | null;
  incPerStudent: number | null;
  incRevenuePercent: number | null; // 0~1
  ratioPercent: number | null; // 0~1
  ratioMinGuarantee?: number | null;
  fixedBaseHours?: number | null;
  fixedOtHours?: number | null;
  fixedNightHours?: number | null;
  /** 경업금지 보상금(월) — 카드(지금 계약)의 값. 갱신 계약에 그대로 이어 적는다 */
  nonCompetePay?: number | null;
  /** 경업금지 보상금 비율(위탁, 0.03 = 3%) — 카드(지금 계약)의 값 */
  nonCompeteRatio?: number | null;
  isContractor?: boolean;
  /** 비율제 근로계약(4대보험) — 카드(지금 계약)의 값. 갱신 계약에 그대로 이어 적는다 */
  ratioEmployee?: boolean;
  /** 근로소득 상한(월) — 비율제 근로계약만 */
  ratioWageCap?: number | null;
  /** 교수부면 보상금이 필수다 */
  department?: string | null;
  /** 근로시간표(JSON) — 보상금 미리보기의 기본급 산정시간 환산용 */
  schedule?: string;
  position: string | null;
  duty: string | null;
}

export default function NewContractForm({ emp }: { emp: EmpSnapshot }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    stage: "RENEWAL_1",
    startDate: today,
    endDate: "",
    isProbation: defaultProbation("RENEWAL_1"),
    incomeType: emp.incomeType,
    payScheme: emp.payScheme,
    baseWage: emp.baseWage,
    positionAllow: emp.positionAllow,
    mealAllow: emp.mealAllow,
    carAllow: emp.carAllow,
    incThreshold: emp.incThreshold ?? "",
    incPerStudent: emp.incPerStudent ?? "",
    incRevenuePercent: emp.incRevenuePercent != null ? emp.incRevenuePercent * 100 : "",
    // 직원 카드에는 없는 계약 전용 값 — 갱신 계약도 여기서 다시 고른다 (기본: 담당 원생 기준)
    incScope: "",
    incCountMethod: "SNAPSHOT15",
    ratioPercent: emp.ratioPercent != null ? emp.ratioPercent * 100 : "",
    ratioMinGuarantee: emp.ratioMinGuarantee ?? "",
    isContractor: !!emp.isContractor,
    ratioEmployee: !!emp.ratioEmployee,
    ratioWageCap: (emp.ratioWageCap ?? "") as number | "",
    fixedBaseHours: emp.fixedBaseHours ?? "",
    fixedOtHours: emp.fixedOtHours ?? "",
    fixedNightHours: emp.fixedNightHours ?? "",
    nonCompetePay: emp.nonCompetePay ?? ("" as number | ""),
    // 위탁 보상금 비율은 %로 다룬다(위탁 비율과 같다). 부동소수 잔차(0.07×100=7.000…1)를 털어 낸다
    nonCompeteRatio:
      emp.nonCompeteRatio != null ? Math.round(emp.nonCompeteRatio * 10000) / 100 : ("" as number | ""),
    skipNonCompete: false,
    position: emp.position ?? "",
    duty: emp.duty ?? "",
    note: "",
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  // 수습 종료일·본채용 거부 예고 기한 — 개월은 보내지 않아 서버도 같은 현행 기본값을 쓴다
  const probation = f.isProbation ? probationTimeline(f.startDate, PROBATION_MONTHS) : null;

  // 경업금지 보상금 — 월급제·인센티브 근로계약만. 교수부는 필수(서버도 같은 함수로 다시 막는다)
  // 완전비율제는 계약 형태(위탁/근로)로, 그 밖은 위탁 체크칸으로 위탁 여부가 정해진다
  const ratioWorker = f.payScheme === "RATIO" && f.ratioEmployee;
  const contractorNow = f.payScheme === "RATIO" ? !f.ratioEmployee : !!f.isContractor;
  const ncShape = { payScheme: f.payScheme, isContractor: contractorNow, ratioEmployee: ratioWorker };
  const ncApplies = nonCompetePayApplies(ncShape);
  const ncRequired = nonCompeteRequired(emp.department, ncShape);
  const ncTerms = {
    baseWage: Number(f.baseWage) || 0,
    positionAllow: Number(f.positionAllow) || 0,
    mealAllow: Number(f.mealAllow) || 0,
    carAllow: Number(f.carAllow) || 0,
    fixedBaseHours: f.fixedBaseHours === "" ? null : Number(f.fixedBaseHours),
    fixedOtHours: f.fixedOtHours === "" ? null : Number(f.fixedOtHours),
    fixedNightHours: f.fixedNightHours === "" ? null : Number(f.fixedNightHours),
    schedule: parseSchedule(emp.schedule ?? "[]"),
  };
  // 완전비율제 — 매출에 곱하는 보상금 비율(위탁·비율제 근로계약 모두). 위탁은 언제나, 비율제 근로계약은
  // 교수부만 필수(서버도 같은 함수로 다시 막는다)
  const ncrApplies = nonCompeteRatioApplies({ payScheme: f.payScheme });
  const ncrRequired = nonCompeteRatioRequired({ payScheme: f.payScheme, ratioEmployee: ratioWorker }, emp.department);
  const ratioFrac = f.ratioPercent === "" ? 0 : Number(f.ratioPercent) / 100;
  const ncrFrac = f.nonCompeteRatio === "" ? null : Number(f.nonCompeteRatio) / 100;
  // 필수 항목이 비었는가 — 월급제(교수부 보상금 금액)와 완전비율제(보상금 비율) 중 이 계약에 해당하는 쪽
  const ncMissing =
    (ncApplies && ncRequired && !(Number(f.nonCompetePay) > 0)) ||
    (ncrApplies && ncrRequired && !(ncrFrac && ncrFrac > 0));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (ncApplies) {
      const ncErr = nonCompetePayError(ncTerms, f.nonCompetePay === "" ? null : f.nonCompetePay);
      if (ncErr) return setErr(ncErr);
    }
    if (ncrApplies) {
      const ncrErr = nonCompeteRatioError(ncrFrac, ratioFrac, ratioWorker);
      if (ncrErr) return setErr(ncrErr);
    }
    if (ncMissing && !f.skipNonCompete)
      return setErr(ncrApplies ? nonCompeteRatioRequiredMessage(ratioWorker) : NON_COMPETE_REQUIRED_MESSAGE);
    setSaving(true);
    const res = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: emp.id,
        stage: f.stage,
        startDate: f.startDate,
        endDate: f.endDate || null,
        isProbation: f.isProbation,
        incomeType: f.incomeType,
        payScheme: f.payScheme,
        baseWage: f.baseWage,
        positionAllow: f.positionAllow,
        mealAllow: f.mealAllow,
        carAllow: f.carAllow,
        incThreshold: f.incThreshold === "" ? null : Number(f.incThreshold),
        incPerStudent: f.incPerStudent === "" ? null : Number(f.incPerStudent),
        incRevenuePercent: f.incRevenuePercent === "" ? null : Number(f.incRevenuePercent) / 100,
        incScope: f.incScope || null,
        incCountMethod: f.incCountMethod || null,
        ratioPercent: f.ratioPercent === "" ? null : Number(f.ratioPercent) / 100,
        ratioMinGuarantee: f.ratioMinGuarantee === "" ? null : Number(f.ratioMinGuarantee),
        isContractor: contractorNow,
        ratioEmployee: ratioWorker,
        // 상한은 비율제 근로계약에서만 뜻이 있다 — 서버도 같은 규칙으로 지운다(normalizeRatioTerms)
        ratioWageCap: ratioWorker && f.ratioWageCap !== "" ? Number(f.ratioWageCap) : null,
        fixedBaseHours: f.fixedBaseHours === "" ? null : Number(f.fixedBaseHours),
        fixedOtHours: f.fixedOtHours === "" ? null : Number(f.fixedOtHours),
        fixedNightHours: f.fixedNightHours === "" ? null : Number(f.fixedNightHours),
        // 대상이 아닌 계약이면 보내지 않는다(금액은 월급제·인센티브 근로계약, 비율은 완전비율제) — 서버도 지운다
        nonCompetePay: ncApplies && f.nonCompetePay !== "" ? Number(f.nonCompetePay) : null,
        nonCompeteRatio: ncrApplies && ncrFrac != null ? ncrFrac : null,
        skipNonCompete: ncMissing ? !!f.skipNonCompete : false,
        position: f.position,
        duty: f.duty,
        note: f.note || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || "신규 계약 생성에 실패했습니다.");
    }
  }

  if (!open) {
    return (
      <button className="text-xs text-brand-600 font-semibold" onClick={() => setOpen(true)}>
        + 신규 계약 작성
      </button>
    );
  }

  const isMonthly = f.payScheme === "MONTHLY" || f.payScheme === "INCENTIVE";

  return (
    <form onSubmit={submit} className="border border-brand-100 bg-brand-50/40 rounded-xl p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-800">신규 계약 작성</span>
        <button type="button" className="text-xs text-slate-400" onClick={() => setOpen(false)}>닫기 ✕</button>
      </div>
      <p className="text-xs text-slate-500">
        기존 확정 계약서는 이력에 그대로 남고(만료 처리), 아래 조건으로 새 계약이 생성됩니다.
        저장 후 새 계약 행에서 <b>계약서 발급</b>을 누르세요.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <L label="계약 단계">
          <select
            className="input"
            value={f.stage}
            onChange={(e) => {
              const stage = e.target.value;
              setF((p) => ({ ...p, stage, isProbation: defaultProbation(stage) }));
            }}
          >
            {Object.entries(CONTRACT_STAGE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        <L label="급여형태 (변경 가능)">
          <select
            className="input"
            value={f.payScheme}
            onChange={(e) => {
              const v = e.target.value;
              // 완전비율제로 바꾸면 기본인 위탁(사업소득)으로 맞추고, 화면에 칸이 없는 식대·수당을 비운다
              // (숨은 값이 비율급 위에 얹히지 않게). 근로계약은 아래 '계약 형태' 에서 고른다
              setF((p) =>
                v === "RATIO" && p.payScheme !== "RATIO"
                  ? { ...p, payScheme: v, ratioEmployee: false, incomeType: "FREELANCE", mealAllow: 0, carAllow: 0, positionAllow: 0 }
                  : { ...p, payScheme: v }
              );
            }}
          >
            {Object.entries(PAY_SCHEME_LABEL).map(([k, v]) => (
              // 완전비율제의 위탁/근로는 아래 '계약 형태' 에서 고른다
              <option key={k} value={k}>{k === "RATIO" ? "완전비율제" : v}</option>
            ))}
          </select>
        </L>
        <L label="세무/보험 구분 (4대보험 · 3.3%)">
          <select
            className="input"
            value={ratioWorker ? "EMPLOYEE" : f.incomeType}
            // 비율제 근로계약은 4대보험이 전제라 고를 것이 없다(서버도 근로소득으로 맞춘다)
            disabled={ratioWorker}
            onChange={(e) => {
              const v = e.target.value;
              // 4대보험 직원은 식대 20만원 포함이 기본 규칙 (전환 시 자동 반영, 수정 가능)
              setF((p) => ({ ...p, incomeType: v, mealAllow: v === "EMPLOYEE" ? 200000 : 0 }));
            }}
          >
            {Object.entries(INCOME_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        <L label="계약 시작일 *">
          <input type="date" required className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </L>
        <L label="계약 종료일 (정규직은 공란)">
          <input type="date" className="input" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </L>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" className="w-4 h-4" checked={f.isProbation} onChange={(e) => set("isProbation", e.target.checked)} />
        <span>수습기간 {PROBATION_MONTHS}개월 조항 포함 <span className="text-slate-400">(신규 계약만 — 갱신·정규 계약서에는 제외)</span></span>
      </label>
      {f.isProbation && probation && (
        <div className="text-xs text-slate-500 -mt-1 ml-6 break-keep space-y-0.5">
          <p>
            수습 종료 <b className="tnum whitespace-nowrap">{probation.endYmd}</b>
            {probation.noticeByYmd && (
              <>
                {" · "}본채용을 하지 않으려면{" "}
                <b className="tnum whitespace-nowrap text-amber-700">{probation.noticeByYmd}</b> 까지 사유를 적어
                서면 통지{" "}
                <span className="text-slate-400">
                  (근속 3개월부터는 수습 중이어도 30일 해고예고 대상 — 늦으면 해고예고수당. 근로기준법 §26·§27)
                </span>
              </>
            )}
          </p>
          {f.endDate && f.endDate <= probation.endYmd && (
            <p className="text-amber-700">
              계약 종료일({f.endDate})이 수습 종료일보다 빠르거나 같아 수습이 계약 전체를 덮습니다 — 수습 조항이
              필요한지 확인하세요.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {f.payScheme !== "RATIO" && (
          <L label={f.payScheme === "HOURLY" ? "시급 (원)" : "월 급여 총액 (원)"}>
            <input type="number" className="input" value={f.baseWage} onChange={(e) => set("baseWage", e.target.value)} />
          </L>
        )}
        {isMonthly && (
          <>
            <L label="직책수당"><input type="number" className="input" value={f.positionAllow} onChange={(e) => set("positionAllow", e.target.value)} /></L>
            <L label="식대 (비과세)"><input type="number" className="input" value={f.mealAllow} onChange={(e) => set("mealAllow", e.target.value)} /></L>
            <L label="차량유지비 (비과세)"><input type="number" className="input" value={f.carAllow} onChange={(e) => set("carAllow", e.target.value)} /></L>
          </>
        )}
        {f.payScheme === "INCENTIVE" && (
          <>
            <L label="인센티브 기준 학생수"><input type="number" className="input" value={f.incThreshold} onChange={(e) => set("incThreshold", e.target.value)} /></L>
            <L label="초과 1명당 금액 (원)"><input type="number" className="input" value={f.incPerStudent} onChange={(e) => set("incPerStudent", e.target.value)} /></L>
            <L label="매출 비율 인센티브 (%)"><input type="number" step="0.1" className="input" placeholder="없으면 비움" value={f.incRevenuePercent} onChange={(e) => set("incRevenuePercent", e.target.value)} /></L>
            {/* 산정 대상 — 교수부장은 담당 원생이 아니라 학원 전체 재원생 기준. 별지 제1·3조 문구가 갈린다 */}
            <L label="인센티브 산정 대상">
              <select className="input" value={f.incScope} onChange={(e) => set("incScope", e.target.value)}>
                <option value="">담당 원생 기준 (강사)</option>
                <option value="ACADEMY">학원 전체 재원생 기준 (교수부장)</option>
              </select>
            </L>
            {f.incScope === "ACADEMY" && (
              <L label="재원생 수 산정 방식">
                <select className="input" value={f.incCountMethod} onChange={(e) => set("incCountMethod", e.target.value)}>
                  <option value="SNAPSHOT15">매월 15일 재원생 기준</option>
                  <option value="WEIGHTED">가중인원 (수업 회차 비례)</option>
                </select>
              </L>
            )}
          </>
        )}
        {f.payScheme === "RATIO" && (
          <>
            <L label={ratioWorker ? "임금 비율 (%) — 수강료 입금액 중" : "위탁 비율 (%)"}><input type="number" step="0.1" className="input" value={f.ratioPercent} onChange={(e) => set("ratioPercent", e.target.value)} /></L>
            <L label={ratioWorker ? "보장급 (월, 원) — 근로기준법 §47" : "위탁 최저보장 (월, 원)"}><input type="number" className="input" placeholder="없으면 비움" value={f.ratioMinGuarantee} onChange={(e) => set("ratioMinGuarantee", e.target.value)} /></L>
          </>
        )}
        <L label="직책"><input className="input" value={f.position} onChange={(e) => set("position", e.target.value)} /></L>
        <L label="업무내용"><input className="input" value={f.duty} onChange={(e) => set("duty", e.target.value)} /></L>
      </div>

      {f.payScheme === "RATIO" ? (
        <RatioContractField
          employee={f.ratioEmployee}
          cap={f.ratioWageCap}
          // 근로계약이면 4대보험(근로소득), 위탁이면 사업소득 — 세무구분을 함께 옮긴다
          onEmployee={(v) => setF((p) => ({ ...p, ratioEmployee: v, incomeType: v ? "EMPLOYEE" : "FREELANCE" }))}
          onCap={(v) => set("ratioWageCap", v)}
        />
      ) : (
        <ContractorField
          checked={!!f.isContractor}
          payScheme={f.payScheme}
          onChange={(v) => set("isContractor", v)}
        />
      )}
      {isMonthly && !f.isContractor && f.payScheme !== "RATIO" && (
        <FixedHoursFields f={f} set={set} />
      )}
      {ncApplies && (
        <NonCompeteField
          value={f.nonCompetePay}
          onChange={(v) => set("nonCompetePay", v)}
          required={ncRequired}
          terms={ncTerms}
          skip={f.skipNonCompete}
          onSkip={(v) => set("skipNonCompete", v)}
        />
      )}
      {ncrApplies && (
        <NonCompeteRatioField
          value={f.nonCompeteRatio}
          onChange={(v) => set("nonCompeteRatio", v)}
          required={ncrRequired}
          ratioPercent={ratioFrac}
          worker={ratioWorker}
          capped={ratioWorker && f.ratioWageCap !== ""}
          skip={f.skipNonCompete}
          onSkip={(v) => set("skipNonCompete", v)}
        />
      )}

      <L label="메모 (선택)">
        <input className="input" placeholder="예: 연봉 조정 재계약" value={f.note} onChange={(e) => set("note", e.target.value)} />
      </L>

      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>취소</button>
        <button className="btn-primary" disabled={saving}>{saving ? "저장 중…" : "신규 계약 생성"}</button>
      </div>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
