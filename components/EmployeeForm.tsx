"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  INCOME_TYPE_LABEL,
  PAY_SCHEME_LABEL,
  DEPARTMENTS,
  DAY_KO,
  type ScheduleDay,
} from "@/lib/constants";

const DAYS: ScheduleDay["day"][] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function defaultSchedule(): ScheduleDay[] {
  return DAYS.map((day) => ({
    day,
    work: day !== "sat" && day !== "sun",
    start: "15:00",
    end: "22:00",
    breakH: 0.5,
  }));
}

export default function EmployeeForm({ initial }: { initial?: any }) {
  const router = useRouter();
  const editing = !!initial?.id;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [f, setF] = useState<any>({
    name: initial?.name ?? "",
    rrn: initial?.rrn ?? "",
    birth: initial?.birth ?? "",
    department: initial?.department ?? "교수부",
    position: initial?.position ?? "",
    duty: initial?.duty ?? "",
    address: initial?.address ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    slackUserId: initial?.slackUserId ?? "",
    bankName: initial?.bankName ?? "",
    bankAccount: initial?.bankAccount ?? "",
    hireDate: initial?.hireDate ? String(initial.hireDate).slice(0, 10) : "",
    contractEnd: "", // 신규 등록 시 초기(기간제) 계약 종료일 — 공란이면 계약서에도 공란
    resignDate: initial?.resignDate ? String(initial.resignDate).slice(0, 10) : "",
    active: initial?.active ?? true,
    incomeType: initial?.incomeType ?? "EMPLOYEE",
    payScheme: initial?.payScheme ?? "MONTHLY",
    baseWage: initial?.baseWage ?? 0,
    breakPaid: initial?.breakPaid ?? false,
    // null = 자동(주 소정근로시간 15시간 기준). 폼에서는 ""/"1"/"0" 로 다룬다
    leaveEligible:
      initial?.leaveEligible === true ? "1" : initial?.leaveEligible === false ? "0" : "",
    positionAllow: initial?.positionAllow ?? 0,
    // 신규 등록 기본값: 4대보험 직원은 식대 20만원 포함
    mealAllow: initial ? initial.mealAllow ?? 0 : 200000,
    carAllow: initial?.carAllow ?? 0,
    dependents: initial?.dependents ?? 1,
    nonTaxTotal: initial?.nonTaxTotal ?? 0,
    parkingFee: initial?.parkingFee ?? 0,
    incThreshold: initial?.incThreshold ?? "",
    incPerStudent: initial?.incPerStudent ?? "",
    ratioPercent: initial?.ratioPercent != null ? initial.ratioPercent * 100 : "",
  });
  const [schedule, setSchedule] = useState<ScheduleDay[]>(
    initial?.schedule ? JSON.parse(initial.schedule) : defaultSchedule()
  );

  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const setDay = (i: number, k: keyof ScheduleDay, v: any) =>
    setSchedule((s) => s.map((d, idx) => (idx === i ? { ...d, [k]: v } : d)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    // 보수조건은 계약이 정한다 — 수정 모드에서는 인적사항만 보낸다
    const {
      baseWage, positionAllow, mealAllow, carAllow,
      incThreshold, incPerStudent, ratioPercent, payScheme, incomeType, contractEnd,
      ...personal
    } = f;
    // "" = 자동 판정(null), "1"/"0" = 강제
    const leaveEligible =
      f.leaveEligible === "1" ? true : f.leaveEligible === "0" ? false : null;
    const payload = editing
      ? { ...personal, leaveEligible, schedule: JSON.stringify(schedule) }
      : {
          ...f,
          leaveEligible,
          ratioPercent: f.ratioPercent !== "" ? Number(f.ratioPercent) / 100 : null,
          schedule: JSON.stringify(schedule),
          createContract: true,
        };
    const res = await fetch(
      editing ? `/api/employees/${initial.id}` : "/api/employees",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setSaving(false);
    if (res.ok) {
      const emp = await res.json();
      router.push(`/employees/${editing ? initial.id : emp.id}`);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || "저장에 실패했습니다.");
    }
  }

  const isMonthly = f.payScheme === "MONTHLY" || f.payScheme === "INCENTIVE";

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* 인적사항 */}
      <div className="card p-5">
        <h2 className="font-bold text-slate-800 mb-4">기초 인적사항</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="성명 *"><input className="input" required value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="생년월일"><input type="date" className="input" value={f.birth} onChange={(e) => set("birth", e.target.value)} /></Field>
          <Field label="주민등록번호"><input className="input" placeholder="900101-1234567" value={f.rrn} onChange={(e) => set("rrn", e.target.value)} /></Field>
          <Field label="연락처"><input className="input" placeholder="010-0000-0000" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="이메일 (명세서 발송)"><input type="email" className="input" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="슬랙 User ID (연차신청)"><input className="input" placeholder="U01234ABC" value={f.slackUserId} onChange={(e) => set("slackUserId", e.target.value)} /></Field>
          <Field label="주소" full><input className="input" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="은행"><input className="input" value={f.bankName} onChange={(e) => set("bankName", e.target.value)} /></Field>
          <Field label="계좌번호"><input className="input" value={f.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} /></Field>
        </div>
      </div>

      {/* 소속/근로형태 */}
      <div className="card p-5">
        <h2 className="font-bold text-slate-800 mb-4">소속 및 근로형태</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="부서">
            <select className="input" value={f.department} onChange={(e) => set("department", e.target.value)}>
              {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="직책"><input className="input" placeholder="선임강사 / 조교 / 팀장" value={f.position} onChange={(e) => set("position", e.target.value)} /></Field>
          <Field label="업무"><input className="input" placeholder="강의(학급관리)" value={f.duty} onChange={(e) => set("duty", e.target.value)} /></Field>
          <Field label="입사일자 *"><input type="date" className="input" required value={f.hireDate} onChange={(e) => set("hireDate", e.target.value)} /></Field>
          {!editing && (
            <Field label="계약 종료일자 (초기 계약)">
              <input type="date" className="input" value={f.contractEnd} onChange={(e) => set("contractEnd", e.target.value)} />
              <p className="text-[11px] text-slate-400 mt-1">초기 계약은 기간제 — 공란이면 계약서에도 공란(자필 기재)으로 출력됩니다.</p>
            </Field>
          )}
          <Field label="퇴사일자"><input type="date" className="input" value={f.resignDate} onChange={(e) => set("resignDate", e.target.value)} /></Field>
          <Field label="재직상태">
            <select className="input" value={f.active ? "1" : "0"} onChange={(e) => set("active", e.target.value === "1")}>
              <option value="1">재직중</option>
              <option value="0">퇴직</option>
            </select>
          </Field>
          {!editing && (
          <Field label="세무/보험 구분">
            <select
              className="input"
              value={f.incomeType}
              onChange={(e) => {
                const v = e.target.value;
                // 4대보험 직원은 식대 20만원 포함이 기본 (전환 시 자동 설정)
                setF((p: any) => ({ ...p, incomeType: v, mealAllow: v === "EMPLOYEE" ? 200000 : 0 }));
              }}
            >
              {Object.entries(INCOME_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          )}
          {!editing && (
          <Field label="급여형태">
            <select className="input" value={f.payScheme} onChange={(e) => set("payScheme", e.target.value)}>
              {Object.entries(PAY_SCHEME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          )}
          <Field label="부양가족수(본인포함)"><input type="number" min={1} className="input" value={f.dependents} onChange={(e) => set("dependents", e.target.value)} /></Field>
          <Field label="월 정기주차 비용 (원)">
            {/* (−) 를 허용한다 — 매달 돌려줄 몫이 있으면 음수로 넣어 두면 공제가 (−)로 잡힌다 */}
            <input
              type="number"
              step={1000}
              className="input"
              placeholder="없으면 0 · 환급이면 (−)"
              value={f.parkingFee}
              onChange={(e) => set("parkingFee", e.target.value)}
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {(() => {
                const fee = Math.round(Number(f.parkingFee) || 0);
                const half =
                  fee === 0
                    ? 0
                    : (fee < 0 ? -1 : 1) * (Math.floor((Math.abs(fee) * 0.5) / 10) * 10);
                if (half === 0)
                  return <>급여에서 이 금액의 <b>50%</b>를 <b>주차비 공제</b>로 자동 반영합니다. 0 이면 공제하지 않습니다.</>;
                if (half < 0)
                  return (
                    <>
                      매달 <b className="text-emerald-700">{Math.abs(half).toLocaleString()}원</b>을{" "}
                      <b>주차비 환급</b>(공제 −)으로 자동 반영합니다 — 실수령액이 그만큼 늘어납니다.
                    </>
                  );
                return (
                  <>
                    급여에서 이 금액의 <b>50%</b>(<b className="text-slate-600">{half.toLocaleString()}원</b>)를{" "}
                    <b>주차비 공제</b>로 자동 반영합니다. 나머지 50%는 회사가 부담합니다.
                  </>
                );
              })()}
            </p>
          </Field>
          <Field label="연차 적용">
            <select
              className="input"
              value={f.leaveEligible}
              onChange={(e) => set("leaveEligible", e.target.value)}
            >
              <option value="">자동 — 주 15시간 이상이면 발생</option>
              <option value="1">적용 — 항상 발생</option>
              <option value="0">미적용 — 발생시키지 않음</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              1주 소정근로시간이 15시간 미만이면 연차·주휴가 발생하지 않습니다 (근로기준법 §18③).
              계약에서 달리 정했다면 여기서 바꾸세요.
            </p>
          </Field>

          {f.payScheme === "HOURLY" && (
            <Field label="휴게 30분 처리 (시간기록표)" full>
              <label className="flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-2">
                <input type="checkbox" className="w-4 h-4" checked={f.breakPaid} onChange={(e) => set("breakPaid", e.target.checked)} />
                <span>
                  <b>휴게 30분 유급</b> — 시간기록표의 시간을 그대로 인정
                  <span className="text-slate-400"> (체크 해제 시: 근무일마다 30분씩 차감)</span>
                </span>
              </label>
            </Field>
          )}
        </div>
      </div>

      {/* 임금 — 등록 시에만 입력(초기 계약 조건). 수정은 계약 이력에서. */}
      {editing ? (
        <div className="card p-5">
          <h2 className="font-bold text-slate-800 mb-2">보수 정보</h2>
          <p className="text-sm text-slate-500">
            기본급·수당·위탁비율·인센티브·급여형태·세무구분은 <b>계약서가 기준</b>이므로 여기서 수정하지 않습니다.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            직원 상세 화면의 <b>계약 이력</b>에서 계약을 수정하거나 새 계약을 작성하면 급여 산정과 계약서 발급에 함께 반영됩니다.
          </p>
        </div>
      ) : (
      <div className="card p-5">
        <h2 className="font-bold text-slate-800 mb-1">임금 정보 <span className="text-xs font-normal text-slate-400">(초기 계약 조건)</span></h2>
        <p className="text-xs text-slate-400 mb-4">입사일부터 적용되는 첫 계약의 조건으로 저장됩니다. 이후 변경은 계약 이력에서 합니다.</p>
        <div className="grid md:grid-cols-3 gap-4">
          {f.payScheme !== "RATIO" && (
            <Field label={f.payScheme === "HOURLY" ? "시급 (원)" : "월 급여 총액 (원)"}>
              <input type="number" className="input" value={f.baseWage} onChange={(e) => set("baseWage", e.target.value)} />
              {f.payScheme !== "HOURLY" && (
                <p className="text-[11px] text-slate-400 mt-1">
                  식대·차량유지비를 <b>포함한</b> 금액. 예) 400만 입력 + 식대 20만 → 총 지급액 400만(그 중 20만 비과세)
                </p>
              )}
            </Field>
          )}
          {isMonthly && (
            <>
              <Field label="직책수당 (월 · 총액에 가산)"><input type="number" className="input" value={f.positionAllow} onChange={(e) => set("positionAllow", e.target.value)} /></Field>
              <Field label="식대 (비과세 · 총액에 포함)"><input type="number" className="input" value={f.mealAllow} onChange={(e) => set("mealAllow", e.target.value)} /></Field>
              <Field label="차량유지비 (비과세 · 총액에 포함)"><input type="number" className="input" value={f.carAllow} onChange={(e) => set("carAllow", e.target.value)} /></Field>
            </>
          )}
          {f.payScheme === "INCENTIVE" && (
            <>
              <Field label="인센티브 기준 학생수"><input type="number" className="input" placeholder="40" value={f.incThreshold} onChange={(e) => set("incThreshold", e.target.value)} /></Field>
              <Field label="초과 1명당 금액 (원)"><input type="number" className="input" placeholder="50000" value={f.incPerStudent} onChange={(e) => set("incPerStudent", e.target.value)} /></Field>
            </>
          )}
          {f.payScheme === "RATIO" && (
            <Field label="위탁 비율 (%)"><input type="number" step="0.1" className="input" placeholder="50" value={f.ratioPercent} onChange={(e) => set("ratioPercent", e.target.value)} /></Field>
          )}
        </div>
      </div>
      )}

      {/* 근로시간표 */}
      <div className="card p-5">
        <h2 className="font-bold text-slate-800 mb-4">주간 근로시간표</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">요일</th>
                <th className="th">근로</th>
                <th className="th">시업</th>
                <th className="th">종업</th>
                <th className="th">휴게(h)</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((d, i) => (
                <tr key={d.day} className={!d.work ? "opacity-50" : ""}>
                  <td className="td font-semibold">{DAY_KO[d.day]}</td>
                  <td className="td">
                    <input type="checkbox" checked={d.work} onChange={(e) => setDay(i, "work", e.target.checked)} className="w-4 h-4" />
                  </td>
                  <td className="td"><input type="time" step={1800} className="input py-1" value={d.start} disabled={!d.work} onChange={(e) => setDay(i, "start", e.target.value)} /></td>
                  <td className="td"><input type="time" step={1800} className="input py-1" value={d.end} disabled={!d.work} onChange={(e) => setDay(i, "end", e.target.value)} /></td>
                  <td className="td"><input type="number" step="0.5" className="input py-1 w-20" value={d.breakH} disabled={!d.work} onChange={(e) => setDay(i, "breakH", Number(e.target.value))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={() => router.back()}>취소</button>
        <button className="btn-primary" disabled={saving}>{saving ? "저장 중…" : editing ? "수정 저장" : "직원 등록"}</button>
      </div>
    </form>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-3" : ""}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
