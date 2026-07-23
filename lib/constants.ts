// 유쌤에듀 HR — 도메인 상수 및 라벨

/** 세무/보험 형태 */
export const INCOME_TYPE = {
  EMPLOYEE: "EMPLOYEE", // 4대보험 (정규 근로자)
  FREELANCE: "FREELANCE", // 사업소득 3.3% (프리랜서)
} as const;
export type IncomeType = keyof typeof INCOME_TYPE;

export const INCOME_TYPE_LABEL: Record<string, string> = {
  EMPLOYEE: "4대보험(근로자)",
  FREELANCE: "사업소득(3.3%)",
};

/** 급여형태 */
export const PAY_SCHEME = {
  MONTHLY: "MONTHLY", // 월 기본급제
  HOURLY: "HOURLY", // 시급제
  INCENTIVE: "INCENTIVE", // 월 기본급 + 인센티브(학생수 초과)
  RATIO: "RATIO", // 완전 비율제 (반 매출액의 %)
} as const;
export type PayScheme = keyof typeof PAY_SCHEME;

export const PAY_SCHEME_LABEL: Record<string, string> = {
  MONTHLY: "월급제",
  HOURLY: "시급제",
  INCENTIVE: "월급+인센티브",
  RATIO: "완전비율제(위탁)",
};

/** 계약 단계 (학원 계약 구조: 1년 단기 → 1년 추가 → 정규, 또는 1년 단기 → 정규) */
export const CONTRACT_STAGE = {
  SHORT_TERM_1: "SHORT_TERM_1", // 1년 단기계약
  RENEWAL_1: "RENEWAL_1", // 1년 추가계약
  REGULAR: "REGULAR", // 정규계약
  FIXED_TERM: "FIXED_TERM", // 촉탁직
  PART: "PART", // 파트/단기근로자
} as const;
export type ContractStage = keyof typeof CONTRACT_STAGE;

export const CONTRACT_STAGE_LABEL: Record<string, string> = {
  SHORT_TERM_1: "1년 단기계약",
  RENEWAL_1: "1년 추가계약",
  REGULAR: "정규계약",
  FIXED_TERM: "촉탁직",
  PART: "파트/단기근로",
};

/** 계약서 템플릿 종류 */
export const CONTRACT_TEMPLATE = {
  MONTHLY: "MONTHLY", // 월급제 근로계약서
  MONTHLY_NEW_PROBATION: "MONTHLY_NEW_PROBATION", // 월급제(신규,수습)
  HOURLY: "HOURLY", // 시급제 근로계약서
  INCENTIVE: "INCENTIVE", // 인센티브 계약(강사)
  RATIO: "RATIO", // 위탁계약서(비율제)
  REGULAR: "REGULAR", // 정규직 근로계약서
  FIXED_TERM: "FIXED_TERM", // 촉탁직 근로계약서
  SUMMER: "SUMMER", // 썸머스쿨
} as const;
export type ContractTemplate = keyof typeof CONTRACT_TEMPLATE;

export const CONTRACT_TEMPLATE_LABEL: Record<string, string> = {
  MONTHLY: "근로계약서(월급제)",
  MONTHLY_NEW_PROBATION: "근로계약서(월급제·신규·수습)",
  HOURLY: "근로계약서(시급제)",
  INCENTIVE: "인센티브계약서(강사)",
  RATIO: "위탁계약서(비율제)",
  REGULAR: "정규직 근로계약서",
  FIXED_TERM: "촉탁직 근로계약서",
  SUMMER: "썸머스쿨 근로계약서",
};

/** 문서 종류 */
export const DOCUMENT_TYPE = {
  NEWHIRE_PKG: "NEWHIRE_PKG", // 신규입사 패키지(계약서+서약서+동의서)
  CONTRACT: "CONTRACT",
  PLEDGE_SERVICE: "PLEDGE_SERVICE", // 복무서약서
  PLEDGE_SECURITY: "PLEDGE_SECURITY", // 보안서약서
  CONSENT_PRIVACY: "CONSENT_PRIVACY", // 개인정보 수집·이용·제공 동의서
  CONSENT_DEDUCTION: "CONSENT_DEDUCTION", // 임금공제 동의서
  PAYSLIP: "PAYSLIP", // 급여명세서 / 사업소득명세서
  CERT_EMPLOYMENT: "CERT_EMPLOYMENT", // 재직증명서
  CERT_CAREER: "CERT_CAREER", // 경력증명서
  CERT_INCOME: "CERT_INCOME", // 소득금액증명(참고용)
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPE;

export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  NEWHIRE_PKG: "신규입사 패키지",
  CONTRACT: "근로/위탁계약서",
  PLEDGE_SERVICE: "복무서약서",
  PLEDGE_SECURITY: "보안서약서",
  CONSENT_PRIVACY: "개인정보 동의서",
  CONSENT_DEDUCTION: "임금공제 동의서",
  PAYSLIP: "급여명세서",
  CERT_EMPLOYMENT: "재직증명서",
  CERT_CAREER: "경력증명서",
  CERT_INCOME: "소득금액증명",
};

/** 연차 신청 상태 */
export const LEAVE_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELED: "CANCELED",
} as const;
export const LEAVE_STATUS_LABEL: Record<string, string> = {
  PENDING: "승인대기",
  APPROVED: "승인",
  REJECTED: "반려",
  CANCELED: "취소",
};

/** 연차 종류 */
export const LEAVE_TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차",
  HALF_AM: "오전반차",
  HALF_PM: "오후반차",
  SICK: "병가",
  SPECIAL: "경조사",
};

export const DAY_KO: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

export const DEPARTMENTS = ["교수부", "학습지원팀", "조교팀", "경영지원"];

/** 근로시간표 한 요일 */
export interface ScheduleDay {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  work: boolean;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  breakH: number; // 휴게(시간)
}

export function parseSchedule(json: string | null | undefined): ScheduleDay[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
