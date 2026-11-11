// 비율제 근로자 — 완전비율제(매출 × 비율)로 받되 **위탁이 아니라 근로계약(4대보험)** 인 사람.
//
// 완전비율제는 원래 전부 강의위탁계약(사업소득 3.3%)이었고, `isContractorContract` 가 RATIO 를 무조건
// 위탁으로 봤다. 비율제로 받으면서 4대보험에 드는 강사가 생겨 갈래를 연다(2026-11).
// 비율제 근로자는 **근로자**다 — 4대보험·근로소득세·연차(§60)·퇴직급여·연장/휴일/야간 가산이 붙는다.
// 위탁과 다른 것은 서식(근로계약서)과 공제뿐이고, 산정식(매출 × 비율, 최저보장)은 같다.
//
// **근로소득 상한(`ratioWageCap`)** — 비율급 중 상한(기본 월 500만원)까지만 이 회사의 임금(근로소득)으로
// 두고, 넘는 부분은 **별도 사업장**이 사업소득(3.3%)으로 지급한다. 세무대리인 의견: 한 사업장에서 같은
// 사람에게 근로소득과 사업소득을 함께 처리할 수 없으니 사업장을 둘로 나눈다. 그래서 앱은 초과분을
// '이 회사가 주는 임금' 으로 다루지 않는다 — 명세서·세무 시트·이체 파일이 **지급처별로 따로** 낸다
// (`recordSplit`). 상한을 비우면 비율급 전액이 근로소득이다(가장 단순하고 다툼이 없는 형태).
//
// ⚠ **법적 한계** — 같은 강의를 금액으로만 둘로 쪼갠 것이면 실질과세(국세기본법 §14)·근로자성 판단
// (대법원 2004다29736 — 계약 형식이 아니라 실질)에서 하나로 합쳐질 수 있다. 그러면 초과분도 근로소득·
// 임금이 되어 4대보험·근로소득세 추징, 퇴직금(평균임금)·연차수당 차액이 생긴다. 별도 사업장의 계약은
// **실제로 다른 용역**(사업장·업무·지휘감독이 다른 것)이어야 버틴다 — 화면과 CLAUDE.md 가 같은 말을 한다.

/** 근로소득 상한 기본값(월) — 2026-11 요청: 월 500만원에 해당하는 금액만 4대보험 */
export const DEFAULT_RATIO_WAGE_CAP = 5_000_000;
/** 상한 입력의 상한 — 자릿수 오타(0 하나 더)를 잡는 정도 */
export const RATIO_WAGE_CAP_MAX = 100_000_000;

/** 화면·문서가 함께 쓰는 짧은 경고 — 상한을 켤 때 */
export const RATIO_SPLIT_RISK_NOTE =
  "같은 강의를 금액으로만 둘로 나눈 구조는 실질과세·근로자성 판단에서 하나로 합쳐질 수 있습니다 " +
  "(초과분까지 근로소득으로 보아 4대보험·근로소득세 추징, 퇴직금·연차수당 차액). 별도 사업장의 계약은 " +
  "실제로 다른 용역이어야 합니다 — 세무사·노무사와 확인한 뒤 쓰세요.";

/**
 * 상한 입력 검사 — 빈칸은 '상한 없음(전액 근로소득)'. 쉼표가 섞인 문자열도 받는다.
 * 0 이하·숫자 아님·지나치게 큰 값은 거른다(0 원 상한이면 전액이 사업소득이 되어 근로계약의 뜻이 없다).
 */
export function parseRatioWageCap(raw: unknown): { value: number | null; error?: string } {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s원]/g, ""));
  if (!Number.isFinite(n) || n <= 0)
    return { value: null, error: "근로소득 상한은 0보다 큰 금액(원)으로 넣어 주세요. 상한을 두지 않으려면 비워 두세요." };
  if (n > RATIO_WAGE_CAP_MAX)
    return { value: null, error: `근로소득 상한이 너무 큽니다(${RATIO_WAGE_CAP_MAX.toLocaleString()}원 이하).` };
  return { value: Math.round(n) };
}

export interface RatioTermsInput {
  payScheme?: string | null;
  ratioEmployee?: unknown;
  ratioWageCap?: unknown;
  isContractor?: unknown;
}

export interface RatioTerms {
  /** 비율제 근로계약 — RATIO 일 때만 참일 수 있다 */
  ratioEmployee: boolean;
  /** 근로소득 상한 — 비율제 근로자만. 없으면 null(전액 근로소득) */
  ratioWageCap: number | null;
  /** 위탁계약 체크칸의 저장값 — 비율제 근로자는 false, 위탁 비율제는 true(성질상 위탁) */
  isContractor: boolean;
  /** 비율제 근로자는 4대보험이 전제라 세무구분을 근로소득으로 고정한다. 그 밖에는 손대지 않는다 */
  incomeType?: "EMPLOYEE";
  error?: string;
}

/**
 * **계약 저장 직전 정규화** — 신규 계약·조건 수정·직원 등록이 같은 규칙을 쓴다.
 *
 *  · RATIO 가 아니면 비율제 근로 표시와 상한을 지운다(급여형태를 바꾸면 남은 값이 지워진다).
 *  · 위탁 비율제는 상한을 지우고 위탁 체크를 켠다(성질상 위탁 — 지금까지와 같다).
 *  · 비율제 근로자는 위탁 체크를 끄고 세무구분을 근로소득으로 맞춘다 — 4대보험에 드는 것이 이 갈래의 뜻이다.
 *
 * `ratioEmployee` 가 오지 않으면(undefined) `fallback` 을 쓴다 — 조건 수정에서 손대지 않은 칸을 지우지 않게.
 */
export function normalizeRatioTerms(
  t: RatioTermsInput,
  fallback: { ratioEmployee?: boolean | null; ratioWageCap?: number | null } = {}
): RatioTerms {
  const isContractor = t.isContractor === true;
  if (t.payScheme !== "RATIO") return { ratioEmployee: false, ratioWageCap: null, isContractor };
  const worker = t.ratioEmployee === undefined ? fallback.ratioEmployee === true : t.ratioEmployee === true;
  if (!worker) return { ratioEmployee: false, ratioWageCap: null, isContractor: true };
  const cap = parseRatioWageCap(t.ratioWageCap === undefined ? fallback.ratioWageCap ?? null : t.ratioWageCap);
  if (cap.error)
    return { ratioEmployee: true, ratioWageCap: null, isContractor: false, incomeType: "EMPLOYEE", error: cap.error };
  return { ratioEmployee: true, ratioWageCap: cap.value, isContractor: false, incomeType: "EMPLOYEE" };
}

/* ───────────── 급여 기록을 지급처별로 가르기 ───────────── */

/** 가를 수 있는 급여 기록의 모양 — PayrollRecord 그대로 넘겨도 된다 */
export interface SplittableRecord {
  gross: number;
  totalDeduct: number;
  net: number;
  bizIncomeP?: number | null;
  bizTaxD?: number | null;
  bizLocalTaxD?: number | null;
}

export interface RecordSplit {
  /** 이 회사(근로소득) 몫 — 임금명세서·세무 시트 본표·이체 파일의 급여 줄 */
  wage: { gross: number; totalDeduct: number; net: number };
  /** 별도 사업장(사업소득) 몫 — 상한을 넘지 않은 달·일반 직원은 null */
  biz: { gross: number; tax: number; local: number; totalDeduct: number; net: number } | null;
}

/**
 * 급여 기록을 **지급처별로** 가른다 — 명세서·세무 시트·이체 파일·급여 화면이 같은 함수를 쓴다.
 *
 * 기록의 `gross`·`totalDeduct`·`net` 은 **그 사람이 그 달 받는 전체**(근로 + 별도 사업장)다 — 합계 카드와
 * 퇴직자 경고처럼 사람 단위로 세는 자리는 그대로 쓰면 된다. 지급처를 가려야 하는 자리만 이걸 거친다.
 * 둘을 더하면 언제나 원래 값으로 돌아온다(테스트로 못박음).
 */
export function recordSplit(r: SplittableRecord): RecordSplit {
  const bizGross = Math.max(Math.round(r.bizIncomeP ?? 0), 0);
  if (!bizGross)
    return { wage: { gross: r.gross, totalDeduct: r.totalDeduct, net: r.net }, biz: null };
  const tax = r.bizTaxD ?? 0;
  const local = r.bizLocalTaxD ?? 0;
  const biz = { gross: bizGross, tax, local, totalDeduct: tax + local, net: bizGross - tax - local };
  return {
    wage: {
      gross: r.gross - biz.gross,
      totalDeduct: r.totalDeduct - biz.totalDeduct,
      net: r.net - biz.net,
    },
    biz,
  };
}

/* ───────────── 별도 사업장(사업소득 지급처) ───────────── */

/** 회사 설정에 담는 별도 사업장 정보 — 사업소득 지급명세서 머리글·이체 적요에 쓴다 */
export interface BizPayerSource {
  bizPayerName?: string | null;
  bizPayerBizNo?: string | null;
  bizPayerCeo?: string | null;
  bizPayerAddress?: string | null;
  bizPayerPhone?: string | null;
  bizPayerAlias?: string | null;
}

export interface BizPayer {
  name: string;
  bizNo: string;
  ceo: string;
  address: string;
  phone: string;
  /** 은행 이체 적요 앞에 붙는 약칭 — 비우면 상호 */
  alias: string;
}

const BIZ_PAYER_REQUIRED: Array<[keyof BizPayerSource, string]> = [
  ["bizPayerName", "상호"],
  ["bizPayerBizNo", "사업자등록번호"],
  ["bizPayerCeo", "대표자"],
  ["bizPayerAddress", "주소"],
];

/** 비어 있는 필수 항목(라벨) — 하나라도 있으면 사업소득 지급명세서를 만들 수 없다 */
export function bizPayerMissing(c: BizPayerSource | null | undefined): string[] {
  return BIZ_PAYER_REQUIRED.filter(([k]) => !String(c?.[k] ?? "").trim()).map(([, label]) => label);
}

/** 필수 항목이 다 있으면 별도 사업장 정보를, 아니면 null 을 준다 */
export function bizPayerOf(c: BizPayerSource | null | undefined): BizPayer | null {
  if (!c || bizPayerMissing(c).length) return null;
  const t = (v: string | null | undefined) => String(v ?? "").trim();
  return {
    name: t(c.bizPayerName),
    bizNo: t(c.bizPayerBizNo),
    ceo: t(c.bizPayerCeo),
    address: t(c.bizPayerAddress),
    phone: t(c.bizPayerPhone),
    alias: t(c.bizPayerAlias) || t(c.bizPayerName),
  };
}

/** 별도 사업장 정보가 비었을 때의 안내 — 명세서 발급·이체 파일·설정 화면이 같은 문구를 쓴다 */
export function bizPayerMissingMessage(missing: string[]): string {
  return (
    `근로소득 상한을 넘은 비율급은 별도 사업장이 사업소득으로 지급합니다 — 설정 → 회사 정보의 ` +
    `「별도 사업장(사업소득 지급처)」에서 빈 항목(${missing.join("·")})을 채워야 사업소득 지급명세서·이체 파일을 만들 수 있습니다.`
  );
}
