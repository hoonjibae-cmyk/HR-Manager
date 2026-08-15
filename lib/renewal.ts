/**
 * **재계약 · 연봉협의 알림** — 순수 함수(DB 무관).
 *
 * 대시보드가 "이 사람 계약을 곧 손봐야 한다" 를 띄우는 자리다. 갈래가 둘이다.
 *
 *  ① **재계약**(`RENEW`) — 기간이 정해진 계약의 만료가 다가온다.
 *  ② **연봉협의**(`SALARY_REVIEW`) — 기한 없는 계약이라 재계약은 안 하지만, **1년마다
 *     연봉을 다시 정해야** 한다. 계약이 안 끝나므로 아무도 짚어 주지 않으면 그대로 흘러간다.
 *
 * ⚠ **알림을 끄는 조건은 '새 계약을 만들었나' 가 아니라 '서명본 스캔이 올라왔나' 다.**
 * 재계약서를 뽑아 둔 것만으로는 아무것도 합의된 게 아니다 — 양쪽이 서명한 원본이 들어와야
 * 비로소 합의가 끝난 것이고, 그 증거가 계약 카드에 붙은 스캔본이다. 새 계약이 생겼다고
 * 알림을 끄면 **준비만 해 놓고 서명을 못 받은 상태**가 조용히 넘어간다.
 *
 * ⚠ **기한이 지났다고 알림을 내리지 않는다.** 만료일이 지나도 서명본이 없으면 계약 공백이
 * 진행 중이라는 뜻이라 더 급하다. 지난 건은 `overdue` 로 표시해 위로 올린다.
 */

import { governingContract } from "./contracts";

/** 며칠 전부터 알릴지 */
export const RENEWAL_LEAD_DAYS = 60;

/**
 * **연봉협의 알림에서 빼는 부서.**
 *
 * 조교팀은 기한 없는 계약이라도 해마다 연봉을 다시 정하지 않는다.
 * 부서 **이름**으로 가르므로 설정에서 부서 이름을 바꾸면 여기도 함께 고쳐야 한다
 * (부서 이름을 바꾸면 직원의 department 문자열도 함께 옮겨진다 — lib/departments.ts).
 */
export const SALARY_REVIEW_EXEMPT_DEPTS = ["조교팀"];

export type RenewalKind = "RENEW" | "SALARY_REVIEW";

export interface RenewalContract {
  id: number;
  startDate: Date;
  endDate: Date | null;
  status?: string | null;
  /** 이 계약에 **완성된** 서명본 스캔이 붙어 있는가 */
  hasScan: boolean;
}

export interface RenewalEmployee {
  id: number;
  name: string;
  department: string | null;
  payScheme: string;
  contracts: RenewalContract[];
}

export interface RenewalAlert {
  employeeId: number;
  name: string;
  department: string | null;
  payScheme: string;
  kind: RenewalKind;
  /** 만료일(재계약) 또는 연봉협의 기준일(계약 시작일의 N주년) — `YYYY-MM-DD` */
  dueDate: string;
  /** 남은 일수. **음수면 이미 지났다** */
  daysLeft: number;
  overdue: boolean;
}

const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * N년 뒤 같은 날. **2월 29일은 평년에 2월 28일로 당긴다** —
 * 그냥 더하면 3월 1일이 되어 기념일이 달을 넘어간다.
 */
export function addYears(d: Date, n: number): Date {
  const y = d.getUTCFullYear() + n;
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

/** 두 날짜 사이 일수 (today 기준으로 target 이 며칠 뒤인가) */
const daysBetween = (target: Date, today: Date) =>
  Math.round((dayStart(target).getTime() - dayStart(today).getTime()) / DAY);

/**
 * 지배 계약 **이후에 시작하는 계약 중 서명본이 붙은 것**이 있는가.
 *
 * 있으면 상호 합의가 끝난 것으로 보고 알림을 내린다. 해지된 계약은 세지 않는다.
 */
function settledBySuccessor(emp: RenewalEmployee, gov: RenewalContract): boolean {
  const govStart = dayStart(gov.startDate).getTime();
  return emp.contracts.some(
    (c) =>
      c.id !== gov.id &&
      c.status !== "TERMINATED" &&
      dayStart(c.startDate).getTime() > govStart &&
      c.hasScan
  );
}

/**
 * **연봉협의 기준일** — 계약 시작일의 N주년 중 지금 짚어야 할 날.
 *
 * 이미 지난 주년이 있으면 **가장 최근에 지난 주년**을 준다(그날 이후로 협의가 안 됐다는 뜻).
 * 아직 첫 주년 전이면 다가오는 주년을 준다.
 */
export function salaryReviewDue(startDate: Date, today: Date): { date: Date; overdue: boolean } {
  const start = dayStart(startDate);
  let k = 1;
  // 오늘을 넘는 첫 주년을 찾는다 (100년이면 어떤 계약이든 넘는다)
  while (k < 100 && daysBetween(addYears(start, k), today) < 0) k++;
  const next = addYears(start, k);
  const prev = k > 1 ? addYears(start, k - 1) : null;
  // 지난 주년이 있으면 그쪽이 지금 짚어야 할 날이다
  if (prev) return { date: prev, overdue: true };
  return { date: next, overdue: daysBetween(next, today) < 0 };
}

/**
 * 대시보드에 띄울 재계약·연봉협의 목록.
 *
 * 재직자만 본다. 지금 시점의 **지배 계약**을 기준으로 판정하고,
 * 뒤에 서명본이 붙은 계약이 있으면 뺀다.
 */
export function renewalAlerts(
  employees: RenewalEmployee[],
  today: Date,
  leadDays = RENEWAL_LEAD_DAYS
): RenewalAlert[] {
  const out: RenewalAlert[] = [];

  for (const emp of employees) {
    const gov = governingContract(
      emp.contracts.filter((c) => c.status !== "TERMINATED"),
      today
    );
    if (!gov) continue; // 오늘을 덮는 계약이 없다 — 그건 contractIssues 가 따로 경고한다
    if (settledBySuccessor(emp, gov)) continue;

    const base = {
      employeeId: emp.id,
      name: emp.name,
      department: emp.department,
      payScheme: emp.payScheme,
    };

    if (gov.endDate) {
      // 기간제 — 만료가 창 안이거나 이미 지났으면 알린다
      const daysLeft = daysBetween(gov.endDate, today);
      if (daysLeft <= leadDays)
        out.push({ ...base, kind: "RENEW", dueDate: ymd(gov.endDate), daysLeft, overdue: daysLeft < 0 });
      continue;
    }

    // 기한 없음 — 재계약은 없지만 1년마다 연봉을 다시 정한다
    if (SALARY_REVIEW_EXEMPT_DEPTS.includes(emp.department ?? "")) continue;
    const due = salaryReviewDue(gov.startDate, today);
    const daysLeft = daysBetween(due.date, today);
    if (daysLeft <= leadDays)
      out.push({
        ...base,
        kind: "SALARY_REVIEW",
        dueDate: ymd(due.date),
        daysLeft,
        overdue: due.overdue,
      });
  }

  // 지난 것이 가장 급하다 — 위로 올리고, 그 안에서는 오래 지난 순
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, "ko"));
}

/** 남은 일수 표기 — 지난 건은 '지남' 으로 적는다(음수 일수는 읽기 어렵다) */
export function daysLabel(a: RenewalAlert): string {
  if (a.daysLeft < 0) return `${-a.daysLeft}일 지남`;
  if (a.daysLeft === 0) return "오늘";
  return `${a.daysLeft}일`;
}

export const RENEWAL_KIND_LABEL: Record<RenewalKind, string> = {
  RENEW: "재계약",
  SALARY_REVIEW: "연봉협의",
};
