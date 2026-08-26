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

/**
 * **위탁계약(프리랜서)인가 — 근로기준법 항목을 일절 적용하지 않는 대상인가.**
 *
 * 근로자가 아니라 도급·위탁 관계이므로 주휴수당(§55)·연차(§60)·퇴직(유보)금·4대보험·
 * 법정가산(§56)이 모두 적용되지 않고, **계약서에 적힌 시급 또는 비율로만** 지급한다.
 * 주 15시간을 넘겨도 마찬가지다 — 15시간은 근로자일 때 따지는 기준이다.
 *
 * 완전비율제(RATIO)는 성질상 언제나 위탁계약(위탁계약서 템플릿)이라 플래그와 무관하게 포함한다.
 * 세무구분(`incomeType`)과는 **별개**다 — 사업소득으로 신고해도 실질이 근로자면 근로기준법이
 * 적용되므로, 세금 처리 방식만 보고 자동으로 판단하지 않고 계약에 명시적으로 체크하게 한다.
 *
 * 새 제외 지점을 만들 때는 `payScheme === "RATIO"` 를 직접 쓰지 말고 반드시 이 함수를 쓴다.
 */
export function isContractorContract(
  e: { payScheme?: string | null; isContractor?: boolean | null } | null | undefined
): boolean {
  if (!e) return false;
  return e.isContractor === true || e.payScheme === PAY_SCHEME.RATIO;
}

/**
 * 월 정기주차 공제율 — 직원 정보의 `parkingFee`(월 정기주차 비용) 중 직원이 부담하는 몫.
 * 회사와 절반씩 부담하므로 0.5.
 */
export const PARKING_DEDUCT_RATE = 0.5;

/**
 * 월 정기주차비에서 직원이 부담할 공제액 (다른 공제와 같이 10원 절사).
 *
 * **음수를 허용한다** — 매달 돌려줄 몫이 있으면 주차비를 (−)로 넣어 두면 공제가 (−)로 잡혀
 * 실수령액이 그만큼 늘어난다. 절사는 부호가 아니라 **크기** 기준이라, 환급액이 절사 때문에
 * 되레 커지지 않는다(−17,777.5 → −17,770).
 */
export function parkingDeductionOf(parkingFee?: number | null): number {
  const fee = Math.round(Number(parkingFee) || 0);
  if (fee === 0) return 0;
  const sign = fee < 0 ? -1 : 1;
  return sign * (Math.floor((Math.abs(fee) * PARKING_DEDUCT_RATE) / 10) * 10);
}

/** 위탁계약이라 근로기준법 항목이 빠진다는 안내 문구 (화면·슬랙 공용) */
export const CONTRACTOR_NOTICE =
  "위탁계약(프리랜서)이라 주휴수당·연차·퇴직금·4대보험이 적용되지 않습니다. " +
  "계약서에 정한 시급 또는 비율로만 지급됩니다.";

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
  CERT_RELEASE: "CERT_RELEASE", // 해촉증명서 — 위탁계약(프리랜서) 종료 증명
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
  CERT_RELEASE: "해촉증명서",
  CERT_INCOME: "소득금액증명",
};

/** 급여 기록 상태 — 발송(SENT) 시 자동 잠금(재계산·공제수정 불가) */
export const PAYROLL_STATUS_LABEL: Record<string, string> = {
  DRAFT: "작성중",
  CONFIRMED: "확정(이전)", // 과거 '전체 확정' 기능의 잔여 상태 — 작성중과 동일하게 수정 가능
  SENT: "발송완료",
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

/**
 * 연차 종류.
 * 학원 근무시간이 통상 14~22시라 오전/오후 반차 구분이 무의미해 `HALF`(반차) 하나로 통합했다.
 * HALF_AM/HALF_PM 은 통합 이전에 등록된 기록 표시용으로만 남겨 둔다(신규 선택 불가).
 */
export const LEAVE_TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차",
  HALF: "반차",
  HALF_AM: "오전반차",
  HALF_PM: "오후반차",
  COMP: "대휴(보상)",
  SICK: "병가",
  SPECIAL: "경조사",
};

/** 0.5일로 차감되는 휴가 종류 */
export const HALF_DAY_LEAVE_TYPES = ["HALF", "HALF_AM", "HALF_PM"] as const;
export function isHalfDayLeave(leaveType: string | null | undefined): boolean {
  return HALF_DAY_LEAVE_TYPES.includes(leaveType as any);
}

/* ==================== 보강 · 주말근무 사전신청 / 오버타임 ==================== */

/**
 * 신청 종류 — 슬랙 신청 양식의 '어떤 보강인가요?' 선택지 + 주말근무.
 *
 * **주말근무(WEEKEND)를 별도 컬럼이 아니라 이 카테고리로 둔다.** 한 건의 신청은
 * 어차피 오버타임 원장의 한 줄이고, 카테고리가 이미 ① 수당 반영 기본값 ② 내신 상한
 * 적용 여부를 가르는 자리다. 컬럼을 따로 두면 둘이 어긋날 수 있다 —
 * '보강이냐 주말근무냐' 는 `isWeekendWork(category)` 하나로 판정한다.
 */
export const MAKEUP_CATEGORY = {
  IMMEDIATE: "IMMEDIATE", // 직전보강 — 수당 산출 대상
  MANDATORY: "MANDATORY", // 내신의무보강 — 내신기간당 상한(기본 10시간)까지만
  ABSENCE: "ABSENCE", // 결시보강 — 관리자가 건건이 판단
  OTHER: "OTHER", // 기타 보강/근무
  WEEKEND: "WEEKEND", // 주말근무 — 교수부가 아닌 직원의 토·일·공휴일 근무
  OVERTIME: "OVERTIME", // 평일 초과근무 — 교수부가 아닌 직원의 평일 늦은 근무 (사후 등록이 보통)
} as const;
export type MakeupCategory = keyof typeof MAKEUP_CATEGORY;

export const MAKEUP_CATEGORY_LABEL: Record<string, string> = {
  IMMEDIATE: "직전보강",
  MANDATORY: "내신의무보강",
  ABSENCE: "결시보강",
  OTHER: "기타",
  WEEKEND: "주말근무",
  OVERTIME: "평일 초과근무",
};

/**
 * 직원(비교수부) 근무 신청인가 — **보강이 아니다**.
 *
 * 주말근무와 평일 초과근무는 같은 입구(슬랙 «주말·초과근무 신청»)로 들어오고
 * **근무 날짜가 토·일·공휴일인지로만 갈린다** — 신청자가 고르는 값이 아니다.
 * 구글 보강캘린더에는 보강만 올리고, 대상반/수강인원 대신 담당 업무를 묻는 것도 이 갈래다.
 */
export function isStaffWork(category: string | null | undefined): boolean {
  return category === MAKEUP_CATEGORY.WEEKEND || category === MAKEUP_CATEGORY.OVERTIME;
}

/**
 * 주말근무 신청인가.
 * ⚠ 캘린더 제외·모달 갈래처럼 '보강이냐 직원 근무냐' 를 가르는 자리는 이게 아니라
 * `isStaffWork()` 를 쓴다 — 여기에 걸면 평일 초과근무가 보강으로 잘못 분류된다.
 */
export function isWeekendWork(category: string | null | undefined): boolean {
  return category === MAKEUP_CATEGORY.WEEKEND;
}

/** 신청 종류에 따른 화면 명칭 — "보강" / "주말근무" / "초과근무" */
export function makeupKindLabel(category: string | null | undefined): string {
  if (category === MAKEUP_CATEGORY.OVERTIME) return "초과근무";
  return isWeekendWork(category) ? "주말근무" : "보강";
}

/** 보강 신청 상태 */
export const MAKEUP_STATUS_LABEL: Record<string, string> = {
  PLANNED: "신청됨",
  CONFIRMED: "실근무 확정",
  NOSHOW: "미실시",
  CANCELED: "취소",
};

/** 실근무를 누가 확정했는가 — 신청자 본인 / 관리자 */
export const MAKEUP_CONFIRMED_BY_LABEL: Record<string, string> = {
  EMPLOYEE: "신청자 확정",
  ADMIN: "관리자 확정",
};

/** 오버타임 구분 */
export const OT_KIND_LABEL: Record<string, string> = {
  OVERTIME: "연장근로",
  HOLIDAY: "휴일근로",
  NONE: "수당 대상 아님",
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

// 부서 — 노션 조직도 기준 (교수부 고등·중등은 '교수부'로 통일, 원장·부원장만 경영지원)
export const DEPARTMENTS = ["교수부", "조교팀", "교육운영팀", "경영지원"];

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
