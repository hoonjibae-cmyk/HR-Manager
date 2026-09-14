import { describe, expect, it } from "vitest";
import { matchesHrManagementEmployee, type HrIdentity } from "./hr-access";

const identity: HrIdentity = {
  empNo: "E001",
  name: "경영지원",
  email: "manager@yussam.com",
  slackUserId: "U_MANAGER",
  department: "경영지원",
};
const employee = {
  ...identity,
  email: "other@yussam.com",
  workEmail: "MANAGER@yussam.com",
  active: true,
  resignDate: null,
};

describe("HR Manager access", () => {
  it("allows a matching active management employee", () => {
    expect(matchesHrManagementEmployee(identity, employee)).toBe(true);
  });

  it.each([
    [{ ...employee, department: "교수부" }, "department change"],
    [{ ...employee, active: false }, "inactive"],
    [{ ...employee, resignDate: new Date() }, "resigned"],
    [{ ...employee, slackUserId: "U_OTHER" }, "different Slack account"],
    [{ ...employee, workEmail: "other@yussam.com" }, "different email"],
    [{ ...employee, empNo: "E002" }, "different employee number"],
  ])("rejects an ineligible employee: %s", (changed, _reason) => {
    expect(matchesHrManagementEmployee(identity, changed)).toBe(false);
  });

  it("rejects a non-management identity even if the employee row is forged", () => {
    expect(
      matchesHrManagementEmployee(
        { ...identity, department: "교육운영팀" },
        { ...employee, department: "교육운영팀" },
      ),
    ).toBe(false);
  });
});

