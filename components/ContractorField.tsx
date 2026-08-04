"use client";

/**
 * 위탁계약(프리랜서) 체크칸 — 신규 계약 작성·조건 수정 두 폼이 같은 것을 쓴다.
 *
 * 체크하면 급여 산정에서 근로기준법 항목을 **일절 싣지 않는다**:
 * 주휴수당(§55) · 연차(§60) · 퇴직(유보)금 · 4대보험 · 연장/야간/휴일 가산(§56).
 * 주 15시간을 넘겨도 마찬가지다 — 15시간은 '근로자' 일 때 따지는 기준이기 때문.
 *
 * 완전비율제(RATIO)는 성질상 언제나 위탁계약이라 체크칸을 잠그고 항상 켠 것으로 보여 준다.
 */
export default function ContractorField({
  checked,
  onChange,
  payScheme,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  payScheme: string;
}) {
  const forced = payScheme === "RATIO"; // 완전비율제 = 위탁계약서. 끌 수 없다
  const on = forced || checked;
  return (
    <div
      className={`rounded border px-3 py-2 ${
        on ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={on}
          disabled={forced}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-xs">
          <b className={on ? "text-amber-800" : "text-slate-700"}>
            위탁계약(프리랜서) — 근로기준법 미적용
          </b>
          {forced && <span className="text-amber-700"> · 완전비율제는 항상 위탁계약입니다</span>}
          <span className="block text-slate-500 mt-0.5 leading-relaxed">
            체크하면 <b>주휴수당·연차·퇴직금·4대보험·연장/야간/휴일 가산</b>을 일절 산정하지 않고,
            계약서에 정한 <b>시급 또는 비율로만</b> 지급합니다. 주 15시간을 넘겨도 주휴가 붙지 않습니다
            (15시간은 근로자일 때 따지는 기준입니다).
            {on && " 공제는 사업소득 3.3%로 처리되므로 세무구분도 '사업소득(3.3%)'으로 맞춰 주세요."}
          </span>
        </span>
      </label>
    </div>
  );
}
