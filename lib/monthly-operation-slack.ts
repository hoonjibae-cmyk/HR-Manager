import { slackCall } from "./slack";

const DEFAULT_CHANNEL_NAME = "교육운영팀";
let resolvedChannel: string | null = null;

function slackText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function channelName(value: string) {
  return value.trim().replace(/^#/, "").normalize("NFKC").toLocaleLowerCase("ko");
}

async function findChannelByName(name: string) {
  let lastError = "";
  for (const types of ["public_channel", "private_channel"]) {
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const result = (await slackCall("conversations.list", {
        types,
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      })) as {
        ok?: boolean;
        error?: string;
        channels?: { id?: string; name?: string; is_archived?: boolean }[];
        response_metadata?: { next_cursor?: string };
      };
      if (!result.ok) {
        lastError = result.error || "unknown";
        break;
      }
      const match = result.channels?.find(
        (channel) =>
          !channel.is_archived &&
          channel.id &&
          channelName(channel.name || "") === channelName(name),
      );
      if (match?.id) return match.id;
      cursor = result.response_metadata?.next_cursor?.trim() || "";
      if (!cursor) break;
    }
  }
  if (lastError)
    throw new Error(`Slack 채널을 조회하지 못했습니다 (${lastError}).`);
  return null;
}

async function monthlyOperationsChannel() {
  if (resolvedChannel) return resolvedChannel;
  const configured =
    process.env.SLACK_MONTHLY_OPERATIONS_CHANNEL?.trim() || DEFAULT_CHANNEL_NAME;
  if (/^[CG][A-Z0-9]+$/.test(configured)) {
    resolvedChannel = configured;
    return configured;
  }
  const found = await findChannelByName(configured);
  if (!found)
    throw new Error(
      `Slack '${configured.replace(/^#/, "")}' 채널을 찾지 못했습니다. 봇을 채널에 초대해 주세요.`,
    );
  resolvedChannel = found;
  return found;
}

function cycleLabel(cycle: string) {
  const [year, month] = cycle.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${year}년 ${month}월 15일 ~ ${next.getUTCFullYear()}년 ${next.getUTCMonth() + 1}월 14일`;
}

function accountLabel(person: { name: string; slackUserId?: string | null }) {
  const slackUserId = person.slackUserId?.trim() || "";
  return /^U[A-Z0-9]+$/.test(slackUserId)
    ? `<@${slackUserId}>`
    : slackText(person.name);
}

export function monthlyOperationMessage(args: {
  cycle: string;
  taskTitle: string;
  completedBy: { name: string; slackUserId?: string | null };
  assignees: { name: string; slackUserId?: string | null }[];
}) {
  const actor = accountLabel(args.completedBy);
  const assignees = args.assignees.length
    ? args.assignees.map(accountLabel).join(", ")
    : "담당자 미지정";
  const title = slackText(args.taskTitle);
  return {
    text: `✅ ${args.completedBy.name}님이 '${args.taskTitle}' 업무를 완료했습니다.`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "✅ 월간업무 완료", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*완료 항목*\n${title}` },
          { type: "mrkdwn", text: `*완료 체크*\n${actor}` },
          { type: "mrkdwn", text: `*담당자*\n${assignees}` },
          { type: "mrkdwn", text: `*업무 사이클*\n${cycleLabel(args.cycle)}` },
        ],
      },
    ],
  };
}

export async function postMonthlyOperationCompletion(args: {
  notificationId: string;
  cycle: string;
  taskTitle: string;
  completedBy: { name: string; slackUserId?: string | null };
  assignees: { name: string; slackUserId?: string | null }[];
}) {
  const channel = await monthlyOperationsChannel();
  const message = monthlyOperationMessage(args);
  return slackCall("chat.postMessage", {
    channel,
    client_msg_id: args.notificationId,
    ...message,
  }) as Promise<{ ok?: boolean; error?: string }>;
}
