import { describe, expect, it } from "vitest";
import { monthlyOperationMessage } from "./monthly-operation-slack";

describe("monthly operation Slack message", () => {
  it("shows only the completed item and checker", () => {
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
    expect(serialized).not.toContain("<@UOWNER1>");
    expect(serialized).not.toContain("담당자");
    expect(serialized).not.toContain("업무 사이클");
  });
});
