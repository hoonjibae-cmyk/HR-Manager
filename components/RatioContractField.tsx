"use client";

import { DEFAULT_RATIO_WAGE_CAP, RATIO_SPLIT_RISK_NOTE } from "@/lib/ratio-employee";

/**
 * 완전비율제의 **계약 형태** — 강의위탁계약(사업소득 3.3%) / 근로계약(4대보험).
 * 신규 계약 작성·조건 수정·직원 등록이 같은 것을 쓴다(위탁 체크칸 `ContractorField` 대신 나온다).
 *
 * 근로계약을 고르면 **근로소득 상한**을 둘 수 있다 — 비율급 중 상한까지만 이 회사의 임금(4대보험·근로소득세)이고
 * 넘는 부분은 별도 사업장이 사업소득(3.3%)으로 지급한다(lib/ratio-employee.ts). 상한은 법적 다툼의 소지가
 * 있는 구조라 켤 때 경고를 함께 띄운다.
 */
export default function RatioContractField({
  employee,
  cap,
  onEmployee,
  onCap,
}: {
  employee: boolean;
  cap: number | "";
  onEmployee: (v: boolean) => void;
  onCap: (v: number | "") => void;
}) {
  const capOn = employee && cap !== "";
  return (
    <div
      className={`rounded border px-3 py-2 text-xs space-y-1.5 ${
        employee ? "border-emerald-300 bg-emerald-50/60" : "border-amber-300 bg-amber-50"
      }`}
    >
      <div className="font-bold text-slate-700">계약 형태 (완전비율제)</div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="radio" className="mt-0.5" checked={!employee} onChange={() => onEmployee(false)} />
        <span>
          <b className="text-amber-800">강의위탁계약 — 사업소득 3.3%</b>
          <span className="block text-slate-500 leading-relaxed">
            근로기준법 미적용(주휴·연차·퇴직금·4대보험 없음) · 강의위탁계약서가 나갑니다.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="radio" className="mt-0.5" checked={employee} onChange={() => onEmployee(true)} />
        <span>
          <b className="text-emerald-800">근로계약 — 4대보험 (비율급 근로자)</b>
          <span className="block text-slate-500 leading-relaxed">
            매출 × 비율로 받는 근로자 · 근로계약서가 나가고 4대보험·근로소득세·연차·퇴직급여·연장/휴일 가산이
            적용됩니다. 세무구분은 4대보험(근로자)으로 맞춥니다.
          </span>
        </span>
      </label>
      {employee && (
        // 좁은 자리(직원 상세의 계약 카드)에서도 금액 칸이 잘리지 않게 들여쓰기를 두지 않는다
        <div className="rounded border border-slate-200 bg-white px-2.5 py-2 space-y-1.5">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={capOn}
              onChange={(e) => onCap(e.target.checked ? DEFAULT_RATIO_WAGE_CAP : "")}
            />
            <span>
              <b className="text-slate-700">근로소득 상한 두기</b>
              <span className="block text-slate-500 leading-relaxed">
                비율급 중 상한까지만 이 회사의 임금(4대보험·근로소득세)으로 두고, 넘는 부분은{" "}
                <b>별도 사업장</b>이 사업소득(3.3%)으로 지급합니다. 비워 두면 비율급 전액이 근로소득입니다.
              </span>
            </span>
          </label>
          {capOn && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  className="input w-full max-w-[12rem] min-w-0"
                  value={cap}
                  onChange={(e) => onCap(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <span className="text-slate-500 whitespace-nowrap">원 / 월</span>
              </div>
              <p className="text-amber-700 leading-relaxed break-keep">⚠ {RATIO_SPLIT_RISK_NOTE}</p>
              <p className="text-slate-500 leading-relaxed break-keep">
                계약서를 발급하면 근로계약서와 함께 <b>별도 사업장 명의의 용역위탁계약서</b>(수수료 = 비율급 중 상한
                초과분)가 나갑니다. 별도 사업장 정보(상호·사업자등록번호·대표자·주소)는 설정 → 회사 정보에 넣어야
                이 계약서와 사업소득 지급명세서·이체 파일이 만들어집니다.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
