// 수습기간 — 신규 입사자 기본값과 종료일·본채용 거부 예고 기한 (순수 함수, 화면에서도 쓴다)
//
// 2026-11 부터 신규 입사자의 수습은 **3개월**이다(그 전 2개월).
// 이 값은 **새로 만드는 계약의 기본값**일 뿐이다 — 이미 만든 계약은 저장된
// `Contract.probationMonths` 를 그대로 쓴다. 서명한 계약서와 다시 뽑는 계약서의 수습 개월이
// 달라지면 같은 계약서로 안 보인다(계약서 제1조는 `ct.probationMonths` 를 찍는다).
//
// ⚠ 2개월 → 3개월로 늘면서 **본채용 거부의 시점이 달라진다.** 근로기준법 §26 단서 1호는
// 계속근로 **3개월 미만**만 해고예고에서 뺀다(2019.1.15. 개정 — 예전 §35 '수습 사용 중인 근로자'
// 예외는 삭제됐다). 2개월 수습은 끝나는 날이 근속 2개월이라 예고가 필요 없었지만,
// 3개월 수습은 끝나는 날 근속이 딱 3개월이라 **예고 대상**이다 — 종료일 30일 전까지 서면으로
// 알리지 않으면 30일분 통상임금(해고예고수당)이 생긴다. 그래서 화면이 종료일과 함께 그 기한을 적는다.
// 본채용 거부도 해고라 사유·시기를 **서면**으로 알려야 효력이 있다(§27, 대법원 2015두48136).

/** 신규 입사자 수습기간(개월) — 2026-11 결정. 새 계약의 기본값 */
export const PROBATION_MONTHS = 3;
/** 2026-11 이전 계약의 수습기간 — 옛 계약을 정정할 때 고를 수 있게 남긴다 */
export const LEGACY_PROBATION_MONTHS = 2;
/** 입력으로 받는 범위 — 그 밖은 입력 실수로 본다 */
export const PROBATION_MONTHS_MAX = 6;
/** 근로기준법 §26 — 해고예고 기간(일) */
export const DISMISSAL_NOTICE_DAYS = 30;
/** 근로기준법 §26 단서 1호 — 계속근로가 이 개월 수 **미만**이면 해고예고 예외 */
export const NOTICE_EXEMPT_MONTHS = 3;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const hit = YMD.exec(s ?? "");
  if (!hit) return null;
  const y = +hit[1];
  const m = +hit[2];
  const d = +hit[3];
  const dt = new Date(Date.UTC(y, m - 1, d));
  // 2026-02-30 같은 없는 날짜는 Date 가 다음 달로 넘겨 버리므로 되돌려 대조한다
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

const toYmd = (dt: Date) => dt.toISOString().slice(0, 10);

/**
 * 수습 마지막 날 — 근로 개시일부터 `months` 개월. 민법 §160 대로 센다:
 * 마지막 달에서 개시일에 해당하는 날의 **전일**에 끝나고(11/6 개시 → 2/5),
 * 그 달에 해당일이 없으면 **그 달 말일**에 끝난다(11/30 개시 → 2/28).
 * date-fns `addMonths` 로 더한 뒤 하루를 빼면 말일 개시에서 하루 짧아진다(11/30 → 2/27) — 쓰지 않는다.
 * 날짜를 못 읽거나 개월이 1 미만이면 null.
 */
export function probationEndYmd(startYmd: string, months: number): string | null {
  const s = parseYmd(startYmd);
  if (!s || !Number.isInteger(months) || months < 1) return null;
  const idx = s.m - 1 + months; // 0부터 센 목표 월
  const ty = s.y + Math.floor(idx / 12);
  const tm = idx % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  // 해당일이 없으면 말일, 있으면 그 전일(1일이면 앞달 말일 — Date.UTC 가 0일을 앞달 말일로 푼다)
  const end = s.d > lastDay ? new Date(Date.UTC(ty, tm, lastDay)) : new Date(Date.UTC(ty, tm, s.d - 1));
  return toYmd(end);
}

/**
 * 본채용 거부를 **해고예고수당 없이** 알릴 수 있는 마지막 날 — 수습 마지막 날의 30일 전.
 * 예고일 다음 날부터 마지막 근무일까지 30일이 차야 하므로 마지막 날에서 30일을 뺀다
 * (효력 발생일을 그다음 날로 보는 해석보다 하루 이르다 — 어느 쪽으로 읽어도 맞는 날을 고른다).
 */
export function probationNoticeByYmd(endYmd: string): string | null {
  const e = parseYmd(endYmd);
  if (!e) return null;
  return toYmd(new Date(Date.UTC(e.y, e.m - 1, e.d - DISMISSAL_NOTICE_DAYS)));
}

/**
 * 수습 마지막 날과 예고 기한. 예고 기한은 수습이 **3개월 이상**일 때만 준다 — 그보다 짧으면
 * 끝나는 날의 근속이 3개월 미만이라 §26 예고 예외다(입사일 = 근로 개시일인 보통의 경우).
 * 서면 통지(§27)는 개월과 무관하게 언제나 필요하다.
 */
export function probationTimeline(
  startYmd: string,
  months: number
): { endYmd: string; noticeByYmd: string | null } | null {
  const endYmd = probationEndYmd(startYmd, months);
  if (!endYmd) return null;
  return {
    endYmd,
    noticeByYmd: months >= NOTICE_EXEMPT_MONTHS ? probationNoticeByYmd(endYmd) : null,
  };
}

/**
 * API 입력의 수습 개월. 비어 있으면 `fallback`(새 계약 = PROBATION_MONTHS, 수정 = 저장값),
 * 1~6 의 정수가 아니면 오류. 화면은 고른 값만 보내므로 오류는 API 를 직접 부른 경우다.
 */
export function parseProbationMonths(
  raw: unknown,
  fallback: number
): { value: number; error: string | null } {
  if (raw === undefined || raw === null || raw === "") return { value: fallback, error: null };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > PROBATION_MONTHS_MAX)
    return {
      value: fallback,
      error: `수습기간은 1~${PROBATION_MONTHS_MAX}개월 사이의 정수로 넣어 주세요.`,
    };
  return { value: n, error: null };
}

/**
 * 계약 '조건 수정' 의 수습 선택지 — 현행(3) · 옛 기준(2) · 그 계약에 저장된 값.
 * 옛 기준을 남기는 이유: 2개월로 서명한 옛 계약의 기록을 고칠 때 3개월로 바꿔 버리면
 * 다시 뽑는 계약서가 서명본과 달라진다.
 */
export function probationMonthOptions(current: number | null | undefined): number[] {
  const out = [PROBATION_MONTHS, LEGACY_PROBATION_MONTHS];
  if (current != null && Number.isInteger(current) && current > 0 && !out.includes(current)) out.push(current);
  return out;
}

export function probationOptionLabel(months: number): string {
  if (months === PROBATION_MONTHS) return `수습 ${months}개월 (현행)`;
  if (months === LEGACY_PROBATION_MONTHS) return `수습 ${months}개월 (2026-11 이전 기준)`;
  return `수습 ${months}개월`;
}
