"use client";

/**
 * 포괄임금(고정OT) 약정시간 입력 — 월급제·인센티브 계약에서만 쓴다.
 *
 * 계약서 제4조 ① 의 「기본급 (209시간) / 시간외근로(고정) (4.345시간) / 야간근로(고정) (10.8625시간)」
 * 을 만드는 값이다. 금액이 아니라 '시간'을 저장하고, 금액은 기준급여에서 역산한다.
 *   통상시급 = 기준급여 ÷ (기본급 산정시간 + 1.5×시간외 + 0.5×야간)
 * 비워 두면 포괄임금 약정 없이 기본급 하나로만 표기된다(기본급 산정시간은 근로시간표에서 환산).
 */
export default function FixedHoursFields({
  f,
  set,
}: {
  f: any;
  set: (k: string, v: any) => void;
}) {
  const baseWage = Number(f.baseWage) || 0;
  const nonTax = (Number(f.mealAllow) || 0) + (Number(f.carAllow) || 0);
  const bh = Number(f.fixedBaseHours) || 0;
  const ot = Number(f.fixedOtHours) || 0;
  const nt = Number(f.fixedNightHours) || 0;
  const divisor = bh + 1.5 * ot + 0.5 * nt;
  const hourly = divisor > 0 ? baseWage / divisor : 0;
  const otPay = Math.round(hourly * 1.5 * ot);
  const ntPay = Math.round(hourly * 0.5 * nt);
  const basePay = Math.round(Math.max(baseWage - nonTax, 0) - otPay - ntPay);
  const won = (n: number) => n.toLocaleString();

  return (
    <details className="border border-slate-200 rounded-lg p-3" open={ot > 0 || nt > 0}>
      <summary className="text-xs font-semibold text-slate-600 cursor-pointer">
        포괄임금 약정시간 (선택) — 계약서 제4조 임금 항목
      </summary>
      <div className="grid sm:grid-cols-3 gap-2 mt-3">
        <div>
          <label className="label text-[11px]">기본급 산정시간 (월)</label>
          <input
            type="number"
            step="0.001"
            className="input"
            placeholder="비우면 근로시간표 환산"
            value={f.fixedBaseHours}
            onChange={(e) => set("fixedBaseHours", e.target.value)}
          />
        </div>
        <div>
          <label className="label text-[11px]">약정 시간외근로 (월, 시간)</label>
          <input
            type="number"
            step="0.001"
            className="input"
            placeholder="없으면 비움"
            value={f.fixedOtHours}
            onChange={(e) => set("fixedOtHours", e.target.value)}
          />
        </div>
        <div>
          <label className="label text-[11px]">약정 야간근로 (월, 시간)</label>
          <input
            type="number"
            step="0.001"
            className="input"
            placeholder="없으면 비움"
            value={f.fixedNightHours}
            onChange={(e) => set("fixedNightHours", e.target.value)}
          />
        </div>
      </div>
      {divisor > 0 && baseWage > 0 && (
        <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
          통상시급 <b>{won(Math.round(hourly))}원</b> · 기본급 <b>{won(basePay)}원</b>
          {ot > 0 && <> · 시간외근로(고정) <b>{won(otPay)}원</b></>}
          {nt > 0 && <> · 야간근로(고정) <b>{won(ntPay)}원</b></>}
          {nonTax > 0 && <> · 비과세 <b>{won(nonTax)}원</b></>}
          <br />
          합계는 기준급여 {won(baseWage)}원 그대로이며, 약정시간을 넘긴 실근로만 별도 가산됩니다.
        </p>
      )}
    </details>
  );
}
