"use client";

import {
  nonCompeteRatioError,
  nonCompeteRatioPreview,
  ratioPctLabel,
  NON_COMPETE_MONTHS,
  NON_COMPETE_RADIUS_KM,
} from "@/lib/non-compete";

/**
 * 경업금지 보상금 **비율** 입력 — 완전비율제 전용(lib/non-compete.ts). 계약 형태에 따라 갈래가 둘이다.
 *  · 강의위탁계약(`worker` 아님) — 용역수수료와 **별도로** 매출에 비율을 곱해 지급(예: 수수료 40% + 보상금 3%
 *    → 매출의 43%). 위탁계약서 제5조·제7조. 사업소득 3.3% 가 함께 걸린다. 새 위탁계약은 필수.
 *  · 비율제 근로계약(`worker`) — 비율급과 **별도로** 같은 식으로 지급. 근로계약서 제4조·제8조(경업금지 조항은
 *    보상금이 있을 때만 들어간다). 근로소득 상한은 비율급과 보상금의 합에 걸린다(넘는 만큼 비율급이 별도
 *    사업장으로 간다). 교수부만 필수. **세무 처리(과세·비과세)는 이 칸이 단정하지 않는다** — 회사 설정
 *    스위치(설정 → 회사 정보의 「경업금지 보상금 — 세무 처리」, 기본 과세)가 정하고, 여기서는 그 자리만 알려 준다.
 * 근로계약의 월 보상금(월 급여 총액 안에서 떼는 금액, NonCompeteField)과 갈래가 다르다.
 * 새 계약(onSkip 이 있음)에서 필수인데 비워 두려면 '보상금을 두지 않음' 을 직접 체크한다.
 * 검사는 서버와 같은 함수를 쓴다(0~100% 미만, 위탁·임금 비율과 합쳐 100% 이하).
 */
export default function NonCompeteRatioField({
  value,
  onChange,
  required,
  ratioPercent,
  worker = false,
  capped = false,
  skip,
  onSkip,
}: {
  /** 화면 입력값(%) — "3" = 3% */
  value: string | number;
  onChange: (v: string) => void;
  required: boolean;
  /** 같은 폼의 위탁·임금 비율(비율값, 0.4 = 40%) — 합계 검사·미리보기용 */
  ratioPercent: number;
  /** 비율제 근로계약(4대보험) — 근거 조항·과세·필수 문구가 갈린다 */
  worker?: boolean;
  /** 근로소득 상한이 있는가 — 상한이 비율급과 보상금의 합에 걸린다는 것을 함께 적는다 */
  capped?: boolean;
  skip?: boolean;
  onSkip?: (v: boolean) => void;
}) {
  const ratio = value === "" || value == null ? null : Number(value) / 100;
  const error = nonCompeteRatioError(ratio, ratioPercent, worker);
  const p = ratio && ratio > 0 && !error ? nonCompeteRatioPreview(ratioPercent, ratio) : null;
  const won = (n: number) => Math.round(n).toLocaleString();
  const missing = required && !(ratio && ratio > 0);
  const warn = missing && !skip;
  const feeLabel = worker ? "비율급" : "용역수수료";

  return (
    <div
      className={`border rounded-lg p-3 ${
        warn ? "border-amber-300 bg-amber-50/60" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="label text-[11px] mb-0">경업금지 보상금 비율 (%, 매출 기준)</span>
        {required ? (
          <span className="pill bg-brand-100 text-brand-700">{worker ? "교수부 필수" : "위탁 필수"}</span>
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
      {worker ? (
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed break-keep">
          수강료 입금액(매출)에 이 비율을 곱해 비율급과 <b>별도로</b> 지급하고, 근로계약서 제8조에 경업금지 조항
          (재직 중·퇴직 후 {NON_COMPETE_MONTHS}개월 · 반경 {NON_COMPETE_RADIUS_KM}km, 위반하면 받은 보상금 전액 반환)이
          들어갑니다.
          {capped
            ? " 근로소득 상한은 비율급과 이 보상금을 합친 금액에 걸립니다(넘는 만큼 비율급이 별도 사업장으로 가고, 보상금은 이 회사가 지급)."
            : ""}{" "}
          <span className="text-slate-400">
            보상금을 과세·비과세 중 어느 쪽으로 계산할지는 설정 → 회사 정보의 「경업금지 보상금 — 세무 처리」에서
            정합니다(기본: 과세 급여에 넣어 4대보험·소득세를 잽니다).
          </span>
        </p>
      ) : (
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed break-keep">
          수강료 입금액(매출)에 이 비율을 곱해 용역수수료와 <b>별도로</b> 지급하고, 위탁계약서 제5조·제7조에
          보상금 조항(위반하면 받은 보상금 전액 반환, 위약금과 별도로 법적 조치 가능)이 들어갑니다.
          사업소득 3.3% 원천징수가 함께 걸립니다.
        </p>
      )}
      {error && <p className="text-[11px] text-red-600 mt-1 break-keep">{error}</p>}
      {p && (
        <p className="text-[11px] text-slate-600 mt-1 leading-relaxed break-keep">
          매출 {won(p.revenue)}원이면 {feeLabel} {won(p.fee)}원({ratioPctLabel(ratioPercent || 0)}) +
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
            ? worker
              ? "교수부 근로계약서에는 경업금지 보상금 비율이 들어가야 합니다 — 비율을 넣어 주세요."
              : "위탁계약서에는 경업금지 보상금 비율이 들어가야 합니다 — 비율을 넣어 주세요."
            : worker
              ? "비워 두면 이 근로계약서에는 경업금지 조항(제8조)이 들어가지 않습니다."
              : "비워 두면 이 위탁계약서에는 보상금 조항이 들어가지 않습니다."}
        </p>
      )}
    </div>
  );
}
