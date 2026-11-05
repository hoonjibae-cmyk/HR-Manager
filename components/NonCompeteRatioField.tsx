"use client";

import {
  nonCompeteRatioError,
  nonCompeteRatioPreview,
  ratioPctLabel,
} from "@/lib/non-compete";

/**
 * 경업금지 보상금 **비율** 입력 — 강의위탁계약(완전비율제) 전용(lib/non-compete.ts).
 *
 * 수강료 입금액(매출)에 이 비율을 곱해 용역수수료와 **별도로** 지급한다(예: 수수료 40% + 보상금 3%
 * → 매출의 43%). 근로계약의 보상금(월 급여 총액 안에서 떼는 금액)과 갈래가 다르다.
 * 새 위탁계약은 필수 — 새 계약(onSkip 이 있음)에서 비워 두려면 '보상금을 두지 않음' 을 직접 체크한다.
 * 검사는 서버와 같은 함수를 쓴다(0~100% 미만, 위탁 비율과 합쳐 100% 이하).
 */
export default function NonCompeteRatioField({
  value,
  onChange,
  required,
  ratioPercent,
  skip,
  onSkip,
}: {
  /** 화면 입력값(%) — "3" = 3% */
  value: string | number;
  onChange: (v: string) => void;
  required: boolean;
  /** 같은 폼의 위탁 비율(비율값, 0.4 = 40%) — 합계 검사·미리보기용 */
  ratioPercent: number;
  skip?: boolean;
  onSkip?: (v: boolean) => void;
}) {
  const ratio = value === "" || value == null ? null : Number(value) / 100;
  const error = nonCompeteRatioError(ratio, ratioPercent);
  const p = ratio && ratio > 0 && !error ? nonCompeteRatioPreview(ratioPercent, ratio) : null;
  const won = (n: number) => Math.round(n).toLocaleString();
  const missing = required && !(ratio && ratio > 0);
  const warn = missing && !skip;

  return (
    <div
      className={`border rounded-lg p-3 ${
        warn ? "border-amber-300 bg-amber-50/60" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="label text-[11px] mb-0">경업금지 보상금 비율 (%, 매출 기준)</span>
        {required ? (
          <span className="pill bg-brand-100 text-brand-700">위탁 필수</span>
        ) : (
          <span className="text-[11px] text-slate-400">선택</span>
        )}
      </div>
      <input
        type="number"
        min={0}
        step={0.1}
        className="input mt-1"
        placeholder={required ? "예: 3" : "없으면 비움"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed break-keep">
        수강료 입금액(매출)에 이 비율을 곱해 용역수수료와 <b>별도로</b> 지급하고, 위탁계약서 제5조·제7조에
        보상금 조항(위반하면 받은 보상금 전액 반환, 위약금과 별도로 법적 조치 가능)이 들어갑니다.
        사업소득 3.3% 원천징수가 함께 걸립니다.
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1 break-keep">{error}</p>}
      {p && (
        <p className="text-[11px] text-slate-600 mt-1 leading-relaxed break-keep">
          매출 {won(p.revenue)}원이면 용역수수료 {won(p.fee)}원({ratioPctLabel(ratioPercent || 0)}) +
          경업금지 보상금 <b>{won(p.comp)}원</b>({ratioPctLabel(ratio!)}) = <b>{won(p.total)}원</b>{" "}
          <span className="text-slate-400">(매출의 {ratioPctLabel(p.totalRatio)})</span>
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
            이번 계약에는 경업금지 보상금을 두지 않음{" "}
            <span className="text-slate-400">
              (이미 서명한 옛 계약을 옮겨 적는 경우 등 — 작업 이력에 남습니다)
            </span>
          </span>
        </label>
      )}
      {warn && (
        <p className="text-[11px] text-amber-700 mt-1 break-keep">
          {onSkip
            ? "위탁계약서에는 경업금지 보상금 비율이 들어가야 합니다 — 비율을 넣어 주세요."
            : "비워 두면 이 위탁계약서에는 보상금 조항이 들어가지 않습니다."}
        </p>
      )}
    </div>
  );
}
