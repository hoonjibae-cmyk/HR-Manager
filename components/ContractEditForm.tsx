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
} from "@/lib/non-compete";
import FixedHoursFields from "./FixedHoursFields";
import ContractorField from "./ContractorField";
import RatioContractField from "./RatioContractField";
import { ratioFormSwitch } from "@/lib/ratio-employee";
import NonCompeteField from "./NonCompeteField";
import NonCompeteRatioField from "./NonCompeteRatioField";
import { probationMonthOptions, probationOptionLabel } from "@/lib/probation";

export interface ContractSnapshot {
  id: number;
  stage: string;
  startDate: string;
  endDate: string;
  isProbation: boolean;
  /** 수습 개월 — 계약에 저장된 값(2026-11 이전 계약은 2, 이후 3) */
  probationMonths: number;
  payScheme: string;
  incomeType: string;
  baseWage: number;
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  incThreshold: number | null;
  incPerStudent: number | null;
  incRevenuePercent: number | null; // 0~1
  /** 인원 기준 인센티브 산정 대상 — null/"OWN"=담당 원생, "ACADEMY"=학원 전체 재원생(교수부장) */
  incScope: string | null;
  /** 재원생 수 산정 방식 (ACADEMY) — "SNAPSHOT15" | "WEIGHTED" */
  incCountMethod: string | null;
  ratioPercent: number | null; // 0~1
  ratioMinGuarantee: number | null;
  isContractor: boolean;
  /** 비율제 근로계약(4대보험) — RATIO 일 때만 뜻이 있다 */
  ratioEmployee: boolean;
  /** 근로소득 상한(월) — 비율제 근로계약만 */
  ratioWageCap: number | null;
  fixedBaseHours: number | null;
  fixedOtHours: number | null;
  fixedNightHours: number | null;
  /** 경업금지 보상금(월) — 있으면 근로계약서에 제8조가 들어간다 */
  nonCompetePay: number | null;
  /** 경업금지 보상금 비율(위탁, 0.03 = 3%) — 있으면 위탁계약서 제5조·제7조에 보상금 조항이 들어간다 */
  nonCompeteRatio: number | null;
  note: string;
}

/** 이미 만든 계약의 조건·기간 수정 (오타 정정, 조건 변경) */
export default function ContractEditForm({
  contract,
  deletable,
  fileCount = 0,
  department,
  schedule,
}: {
  contract: ContractSnapshot;
  deletable: boolean;
  /** 이 계약에 붙은 서명본 스캔 수 — 삭제 경고에 적는다 */
  fileCount?: number;
  /** 교수부면 경업금지 보상금 안내를 띄운다(수정에서는 막지 않는다 — 옛 계약 오타 정정) */
  department?: string | null;
  /** 근로시간표(JSON) — 보상금 미리보기의 기본급 산정시간 환산용 */
  schedule?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({
    ...contract,
    incThreshold: contract.incThreshold ?? "",
    incPerStudent: contract.incPerStudent ?? "",
    incRevenuePercent: contract.incRevenuePercent != null ? contract.incRevenuePercent * 100 : "",
    incScope: contract.incScope ?? "",
    incCountMethod: contract.incCountMethod ?? "SNAPSHOT15",
    ratioPercent: contract.ratioPercent != null ? contract.ratioPercent * 100 : "",
    ratioMinGuarantee: contract.ratioMinGuarantee ?? "",
    ratioEmployee: !!contract.ratioEmployee,
    ratioWageCap: (contract.ratioWageCap ?? "") as number | "",
    fixedBaseHours: contract.fixedBaseHours ?? "",
    fixedOtHours: contract.fixedOtHours ?? "",
    fixedNightHours: contract.fixedNightHours ?? "",
    nonCompetePay: contract.nonCompetePay ?? "",
    nonCompeteRatio:
      contract.nonCompeteRatio != null ? Math.round(contract.nonCompeteRatio * 10000) / 100 : "",
  });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  // 완전비율제는 계약 형태(위탁/근로)로, 그 밖은 위탁 체크칸으로 위탁 여부가 정해진다
  const ratioWorker = f.payScheme === "RATIO" && !!f.ratioEmployee;
  const contractorNow = f.payScheme === "RATIO" ? !f.ratioEmployee : !!f.isContractor;
  // 보상금 비율 — 완전비율제 전부(위탁·비율제 근로계약). 위탁 ↔ 근로를 바꿔도 값은 그대로 간다
  const ncrApplies = nonCompeteRatioApplies({ payScheme: f.payScheme });
  const ratioFrac = f.ratioPercent === "" ? 0 : Number(f.ratioPercent) / 100;
  const ncrFrac = f.nonCompeteRatio === "" ? null : Number(f.nonCompeteRatio) / 100;

  const ncShape = { payScheme: f.payScheme, isContractor: contractorNow, ratioEmployee: ratioWorker };
  const ncApplies = nonCompetePayApplies(ncShape);
  const ncTerms = {
    baseWage: Number(f.baseWage) || 0,
    positionAllow: Number(f.positionAllow) || 0,
    mealAllow: Number(f.mealAllow) || 0,
    carAllow: Number(f.carAllow) || 0,
    fixedBaseHours: f.fixedBaseHours === "" ? null : Number(f.fixedBaseHours),
    fixedOtHours: f.fixedOtHours === "" ? null : Number(f.fixedOtHours),
    fixedNightHours: f.fixedNightHours === "" ? null : Number(f.fixedNightHours),
    schedule: parseSchedule(schedule ?? "[]"),
  };

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
    setSaving(true);
    const res = await fetch(`/api/contracts/${contract.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: f.stage,
        startDate: f.startDate,
        endDate: f.endDate || null,
        isProbation: f.isProbation,
        // 고른 때만 보낸다 — 손대지 않은 옛 계약의 저장값이 범위 검사에 걸려 수정이 막히지 않게
        ...(f.probationMonths !== contract.probationMonths ? { probationMonths: f.probationMonths } : {}),
        payScheme: f.payScheme,
        incomeType: f.incomeType,
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
        ratioWageCap: ratioWorker && f.ratioWageCap !== "" ? Number(f.ratioWageCap) : null,
        fixedBaseHours: f.fixedBaseHours === "" ? null : Number(f.fixedBaseHours),
        fixedOtHours: f.fixedOtHours === "" ? null : Number(f.fixedOtHours),
        fixedNightHours: f.fixedNightHours === "" ? null : Number(f.fixedNightHours),
        nonCompetePay: ncApplies && f.nonCompetePay !== "" ? Number(f.nonCompetePay) : null,
        nonCompeteRatio: ncrApplies && ncrFrac != null ? ncrFrac : null,
        note: f.note || null,
      }),
    });
    setSaving(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(j.error || "수정에 실패했습니다.");
    if (j.issues?.length) alert("수정했습니다.\n\n확인 필요:\n· " + j.issues.join("\n· "));
    setOpen(false);
    router.refresh();
  }

  async function remove() {
    // 계약을 지우면 딸린 서명본 스캔도 함께 사라진다(cascade). 종이 원본을 다시 스캔하지 않으면
    // 복구되지 않으므로 **몇 건이 함께 지워지는지 먼저 적는다**.
    const scanWarn = fileCount
      ? `\n\n⚠ 첨부된 서명본 스캔 ${fileCount}건도 함께 삭제되며 되돌릴 수 없습니다.`
      : "";
    if (
      !confirm(
        `이 계약을 삭제합니다.\n직전 계약의 기간이 늘어나 빈틈을 메웁니다.${scanWarn}\n\n계속할까요?`
      )
    )
      return;
    setSaving(true);
    const res = await fetch(`/api/contracts/${contract.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return alert("삭제 실패: " + (j.error || ""));
    if (j.issues?.length) alert("삭제했습니다.\n\n확인 필요:\n· " + j.issues.join("\n· "));
    router.refresh();
  }

  if (!open)
    return (
      <button className="text-xs text-slate-500 font-semibold" onClick={() => setOpen(true)}>
        조건 수정
      </button>
    );

  const isMonthly = f.payScheme === "MONTHLY" || f.payScheme === "INCENTIVE";

  return (
    <form onSubmit={submit} className="w-full border border-slate-200 rounded-lg p-3 mt-1 space-y-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <L label="계약단계">
          <select className="input" value={f.stage} onChange={(e) => set("stage", e.target.value)}>
            {Object.entries(CONTRACT_STAGE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        <L label="수습">
          {/* 개월은 그 계약에 저장된 값을 보여 준다 — 2개월로 서명한 옛 계약을 현행(3개월)으로 바꾸면
              다시 뽑는 계약서가 서명본과 달라진다. 서명 전 계약만 현행으로 바꾼다. */}
          <select
            className="input"
            value={f.isProbation ? String(f.probationMonths) : "0"}
            onChange={(e) => {
              const v = Number(e.target.value);
              setF((p: any) => (v === 0 ? { ...p, isProbation: false } : { ...p, isProbation: true, probationMonths: v }));
            }}
          >
            <option value="0">해당 없음</option>
            {probationMonthOptions(contract.probationMonths).map((m) => (
              <option key={m} value={String(m)}>
                {probationOptionLabel(m)}
              </option>
            ))}
          </select>
        </L>
        <L label="시작일">
          <input type="date" required className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </L>
        <L label="종료일 (공란=기한 없음)">
          <input type="date" className="input" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </L>
        <L label="세무/보험">
          <select
            className="input"
            value={ratioWorker ? "EMPLOYEE" : f.incomeType}
            // 비율제 근로계약은 4대보험이 전제다(서버도 근로소득으로 맞춘다)
            disabled={ratioWorker}
            onChange={(e) => set("incomeType", e.target.value)}
          >
            {Object.entries(INCOME_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </L>
        <L label="급여형태">
          <select
            className="input"
            value={f.payScheme}
            onChange={(e) => {
              const v = e.target.value;
              // 완전비율제로 바꾸면 기본인 위탁(사업소득)으로 맞추고, 화면에 칸이 없는 식대·수당을 비운다
              setF((p: any) =>
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
        {f.payScheme !== "RATIO" && (
          <L label={f.payScheme === "HOURLY" ? "시급 (원)" : "월 급여 총액 (원)"}>
            <input type="number" className="input" value={f.baseWage} onChange={(e) => set("baseWage", e.target.value)} />
          </L>
        )}
        {f.payScheme === "RATIO" && (
          <>
            <L label={ratioWorker ? "임금 비율 (%) — 수강료 입금액 중" : "위탁 비율 (%)"}>
              <input type="number" step="0.1" className="input" value={f.ratioPercent} onChange={(e) => set("ratioPercent", e.target.value)} />
            </L>
            <L label={ratioWorker ? "보장급 (월, 원) — 근로기준법 §47" : "위탁 최저보장 (월, 원)"}>
              <input type="number" className="input" placeholder="없으면 비움" value={f.ratioMinGuarantee} onChange={(e) => set("ratioMinGuarantee", e.target.value)} />
            </L>
          </>
        )}
        {isMonthly && (
          <>
            <L label="직책수당"><input type="number" className="input" value={f.positionAllow} onChange={(e) => set("positionAllow", e.target.value)} /></L>
            <L label="식대(비과세·총액 포함)"><input type="number" className="input" value={f.mealAllow} onChange={(e) => set("mealAllow", e.target.value)} /></L>
            <L label="차량유지비(비과세·총액 포함)"><input type="number" className="input" value={f.carAllow} onChange={(e) => set("carAllow", e.target.value)} /></L>
          </>
        )}
        {f.payScheme === "INCENTIVE" && (
          <>
            <L label="인센티브 기준 학생수"><input type="number" className="input" value={f.incThreshold} onChange={(e) => set("incThreshold", e.target.value)} /></L>
            <L label="기준 금액 (원)"><input type="number" className="input" value={f.incPerStudent} onChange={(e) => set("incPerStudent", e.target.value)} /></L>
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
        <L label="비고"><input className="input" value={f.note} onChange={(e) => set("note", e.target.value)} /></L>
      </div>
      {f.payScheme === "RATIO" ? (
        <RatioContractField
          employee={!!f.ratioEmployee}
          cap={f.ratioWageCap}
          // 근로계약이면 4대보험(근로소득) + 식대(비과세·비율급에 포함) 기본값, 위탁이면 사업소득 + 식대 비움
          onEmployee={(v) => setF((p: any) => ({ ...p, ...ratioFormSwitch(v, p) }))}
          onCap={(v) => set("ratioWageCap", v)}
          meal={f.mealAllow}
          car={f.carAllow}
          onMeal={(v) => set("mealAllow", v)}
          onCar={(v) => set("carAllow", v)}
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
          required={nonCompeteRequired(department, ncShape)}
          terms={ncTerms}
        />
      )}
      {ncrApplies && (
        <NonCompeteRatioField
          value={f.nonCompeteRatio}
          onChange={(v) => set("nonCompeteRatio", v)}
          required={nonCompeteRatioRequired({ payScheme: f.payScheme, ratioEmployee: ratioWorker }, department)}
          ratioPercent={ratioFrac}
          worker={ratioWorker}
          capped={ratioWorker && f.ratioWageCap !== ""}
        />
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2 justify-end">
        {deletable && (
          <button type="button" className="btn-ghost text-xs text-red-600" onClick={remove} disabled={saving}>
            계약 삭제
          </button>
        )}
        <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>닫기</button>
        <button className="btn-primary text-xs" disabled={saving}>{saving ? "저장 중…" : "수정 저장"}</button>
      </div>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label text-[11px]">{label}</label>
      {children}
    </div>
  );
}
