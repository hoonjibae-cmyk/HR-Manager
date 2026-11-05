"use client";

import {
  NON_COMPETE_MONTHS,
  NON_COMPETE_RADIUS_KM,
  nonCompetePayError,
  nonCompetePreview,
  type NonCompeteTerms,
} from "@/lib/non-compete";

/**
 * 경업금지 보상금 입력 — 월급제·인센티브 근로계약에서만 쓴다(lib/non-compete.ts).
 *
 * 금액을 넣으면 월 급여 총액 **안에서** 그만큼 떼어 근로계약서 제4조에 따로 적고, 제8조
 * 「경업금지 및 경업금지 보상금」이 들어간다. 지급 총액은 그대로이고 기본급이 줄어든다.
 * 교수부는 필수다 — 새 계약(onSkip 이 있음)에서 비워 두려면 '조항을 넣지 않음' 을 직접 체크해야 한다.
 * 계산(미리보기·검사)은 서버와 같은 함수를 쓴다 — 화면이 통과시킨 값을 서버가 거절하지 않게.
 */
export default function NonCompeteField({
  value,
  onChange,
  required,
  terms,
  skip,
  onSkip,
}: {
  value: string | number;
  onChange: (v: string) => void;
  /** 교수부 월급제·인센티브 근로계약 */
  required: boolean;
  terms: NonCompeteTerms;
  /** 새 계약만 — 조항 없이 저장(이미 서명한 옛 계약을 옮겨 적는 경우 등) */
  skip?: boolean;
  onSkip?: (v: boolean) => void;
}) {
  const amount = Number(value) || 0;
  const error = nonCompetePayError(terms, value === "" ? null : value);
  const p = amount > 0 && !error ? nonCompetePreview(terms, amount) : null;
  const won = (n: number) => Math.round(n).toLocaleString();
  const missing = required && !(amount > 0);
  const warn = missing && !skip;

  return (
    <div
      className={`border rounded-lg p-3 ${
        warn ? "border-amber-300 bg-amber-50/60" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="label text-[11px] mb-0">경업금지 보상금 (월, 원)</span>
        {required ? (
          <span className="pill bg-brand-100 text-brand-700">교수부 필수</span>
        ) : (
          <span className="text-[11px] text-slate-400">선택 — 비우면 조항이 들어가지 않습니다</span>
        )}
      </div>
      <input
        type="number"
        min={0}
        step={10000}
        className="input mt-1"
        placeholder={required ? "예: 300000" : "없으면 비움"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed break-keep">
        월 급여 총액 <b>안에서</b> 떼어 근로계약서 제4조에 따로 적고, 제8조 「경업금지 및 경업금지
        보상금」(재직 중·퇴직 후 {NON_COMPETE_MONTHS}개월 · 반경 {NON_COMPETE_RADIUS_KM}km — 위반하면
        받은 보상금 전액 반환, 별도 법적 조치 가능)이 들어갑니다. 지급 총액은 그대로이고 그만큼 기본급이
        줄어듭니다.
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1 break-keep">{error}</p>}
      {p && (
        <p className="text-[11px] text-slate-600 mt-1 leading-relaxed break-keep">
          기본급 {won(p.basePayBefore)}원 → <b>{won(p.basePayAfter)}원</b> · 임금 {won(p.wageTotal)}원 +
          보상금 {won(amount)}원 = 월 {won(p.monthlyTotal)}원
          <br />
          최저임금 비교용 시간당 임금 약 <b>{won(p.minWageHourly)}원</b>{" "}
          <span className="text-slate-400">
            (기본급·직책수당·식대·차량유지비 ÷ {Number(p.baseHours.toFixed(2))}시간)
          </span>{" "}
          — 보상금을 뺀 임금만으로 그해 최저임금 이상이어야 합니다.
        </p>
      )}
      {missing && onSkip && (
        <label className="flex items-start gap-2 text-[11px] text-slate-600 mt-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!skip}
            onChange={(e) => onSkip(e.target.checked)}
          />
          <span className="break-keep">
            이번 계약에는 경업금지 조항을 넣지 않음{" "}
            <span className="text-slate-400">
              (이미 서명한 옛 계약을 옮겨 적는 경우 등 — 작업 이력에 남습니다)
            </span>
          </span>
        </label>
      )}
      {warn && (
        <p className="text-[11px] text-amber-700 mt-1 break-keep">
          {onSkip
            ? "교수부 근로계약서에는 경업금지 조항과 보상금이 들어가야 합니다 — 금액을 넣어 주세요."
            : "비워 두면 이 계약서에는 경업금지 조항이 들어가지 않습니다 — 교수부 계약이면 금액을 넣으세요."}
        </p>
      )}
    </div>
  );
}
