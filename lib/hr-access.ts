export const HR_ALLOWED_DEPARTMENT = "경영지원";

export interface HrIdentity {
  empNo: string;
  name: string;
  email: string;
  slackUserId: string;
  department: string;
}

export interface HrEmployeeRecord {
  empNo: string;
  name: string;
  email: string | null;
  workEmail: string | null;
  slackUserId: string | null;
  department: string | null;
  active: boolean;
  resignDate: Date | null;
}

function normalizedEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function normalizedSlackUserId(value: string | null | undefined) {
  return String(value || "").trim();
}

/**
 * 포털의 서명만 믿지 않고 HR 원장과 한 번 더 대조한다.
 * 퇴사·부서 변경·Slack 연결 해제는 다음 요청부터 곧바로 접근을 끊는다.
 */
export function matchesHrManagementEmployee(
  identity: HrIdentity,
  employee: HrEmployeeRecord | null,
) {
  if (!employee) return false;
  const employeeEmail = normalizedEmail(employee.workEmail || employee.email);
  return (
    identity.department === HR_ALLOWED_DEPARTMENT &&
    employee.department === HR_ALLOWED_DEPARTMENT &&
    employee.active === true &&
    employee.resignDate === null &&
    employee.empNo === identity.empNo &&
    Boolean(normalizedSlackUserId(employee.slackUserId)) &&
    normalizedSlackUserId(employee.slackUserId) === normalizedSlackUserId(identity.slackUserId) &&
    Boolean(employeeEmail) &&
    employeeEmail === normalizedEmail(identity.email)
  );
}
