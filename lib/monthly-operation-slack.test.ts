import { describe, expect, it } from "vitest";
import { monthlyOperationMessage } from "./monthly-operation-slack";

describe("monthly operation Slack message", () => {
  it("names the completed item, checker, assignees and cycle", () => {
    const message = monthlyOperationMessage({
      cycle: "2026-09",
      taskTitle: "원비 안내 <2차>",
      completedBy: { name: "박운영", slackUserId: "UCHECKER1" },
      assignees: [
        { name: "김담당", slackUserId: "UOWNER1" },
        { name: "계정없음" },
      ],
    });
    const serialized = JSON.stringify(message.blocks);
    expect(serialized).toContain("원비 안내 &lt;2차&gt;");
    expect(serialized).toContain("<@UCHECKER1>");
    expect(serialized).toContain("<@UOWNER1>, 계정없음");
    expect(serialized).toContain("2026년 9월 15일 ~ 2026년 10월 14일");
  });
});
