// 방학 근무·연차 — 슬랙 화면(Block Kit) 조립. DB 무관 순수 함수(테스트 있음).
//
// 직원 화면의 신원은 **슬랙 계정**이다 — 요청마다 슬랙 서명으로 누가 눌렀는지 서버가 확인하므로
// 관리자·공용 계정이 직원 대신 제출·서명할 길이 없다(관리자 웹에는 제출 경로 자체가 없다).
//
// 원칙: 정상근무·연차 신청을 같은 무게로 두고 **미리 고르지 않는다**(initial_option 은 본인이
// 이미 고른 값을 되살릴 때만). 확인 항목도 언제나 미체크로 시작한다.
import {
  APPLICATION_STATEMENT,
  CHECK_ITEMS,
  CONDITION_FIELDS,
  NOTICE_BODY,
  dayLabel,
  isSelectable,
  skipReason,
  type BalanceCheck,
  type Choices,
  type DateInfo,
  type WorkCondition,
} from "./vacation";

export interface NoticeHead {
  noticeId: number;
  title: string;
  version: number;
  classOffStart: string;
  classOffEnd: string;
  dates: string[];
  deadline: string;
  contactName: string;
  extraNote: string;
}

const md = (text: string) => ({ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } });
const ctx = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text: text.slice(0, 2900) }] });
const pt = (text: string) => ({ type: "plain_text", text: text.slice(0, 150) });

export function datesSummary(dates: string[]): string {
  if (!dates.length) return "-";
  if (dates.length <= 6) return dates.map(dayLabel).join(", ");
  return `${dayLabel(dates[0])} ~ ${dayLabel(dates[dates.length - 1])} 중 ${dates.length}일`;
}

export function conditionText(c: WorkCondition | null): string {
  if (!c) return "_정상근무 조건이 아직 확정되지 않았습니다 — 담당자에게 문의해 주세요._";
  return CONDITION_FIELDS.map((f) => `• *${f.label}*: ${c[f.key] || "-"}`).join("\n");
}

function headLines(h: NoticeHead): string {
  return (
    `*${h.title}* (제${h.version}판)\n` +
    `• 수업 미운영 기간: ${h.classOffStart} ~ ${h.classOffEnd}\n` +
    `• 선택 대상 날짜: ${datesSummary(h.dates)}\n` +
    `• 응답 요청 기한: ${h.deadline} (근무계획 취합용)\n` +
    `• 문의: ${h.contactName}`
  );
}

/* ============================== 안내 DM ============================== */

export type NoticeDmKind = "NEW" | "CHANGED" | "REMIND";

/**
 * 직원 개인 DM — 공고 안내·변경 안내·응답 확인 요청. **팀 채널에는 보내지 않는다.**
 * 확인 요청(REMIND)은 중립 문구다 — 연차 신청을 권하지 않는다.
 */
export function noticeDmBlocks(args: {
  kind: NoticeDmKind;
  head: NoticeHead;
  assignmentId: number;
  changes?: string[];
  needsReconfirm?: boolean;
}): { text: string; blocks: any[] } {
  const { head } = args;
  const lead =
    args.kind === "NEW"
      ? "📋 *근무 선택 및 연차 신청 안내*가 도착했습니다."
      : args.kind === "CHANGED"
        ? `📝 *공고가 변경되었습니다* (제${head.version}판).${
            args.needsReconfirm
              ? "\n이미 제출하신 내용은 그대로 보관되며 확정된 연차도 자동으로 취소되지 않습니다. 바뀐 조건을 확인하고 *다시 확인·제출*해 주세요 — 이전 서명은 새 조건에 적용되지 않습니다."
              : ""
          }`
        : "🔔 *근무 선택 및 연차 신청 응답 확인 요청* — 아직 선택하지 않은 날짜가 있습니다. 날짜별로 정상근무 또는 연차 신청 중 원하는 쪽을 골라 주세요.";
  const blocks: any[] = [md(lead), md(headLines(head))];
  if (args.kind === "CHANGED" && args.changes?.length)
    blocks.push(md(`*바뀐 내용*\n${args.changes.map((c) => `• ${c}`).join("\n")}`));
  if (args.kind !== "REMIND") blocks.push(md(NOTICE_BODY.join("\n")));
  if (head.extraNote && args.kind !== "REMIND") blocks.push(md(head.extraNote));
  blocks.push({
    type: "actions",
    block_id: `vac_dm_${args.assignmentId}`,
    elements: [
      {
        type: "button",
        text: pt("근무 선택 및 연차 신청"),
        action_id: "vac_open",
        value: String(args.assignmentId),
      },
    ],
  });
  blocks.push(ctx("응답 요청 기한은 근무계획을 모으기 위한 일정입니다. 다른 날짜의 연차 신청은 평소대로 할 수 있습니다."));
  const text =
    args.kind === "NEW"
      ? `근무 선택 및 연차 신청 안내: ${head.title}`
      : args.kind === "CHANGED"
        ? `공고 변경 안내: ${head.title}`
        : `근무 선택 응답 확인 요청: ${head.title}`;
  return { text, blocks };
}

/* ============================== 1단계: 날짜별 선택 ============================== */

export interface ChoiceBalance {
  remaining: number;
  pending: number;
  /** 앞으로 발생 예정 (확정 아님 — 가용량에 넣지 않는다) */
  scheduled: number;
  /** 연차 미적용이면 사유 */
  ineligibleNote: string | null;
}

const WORK_OPTION = { text: { type: "plain_text", text: "정상근무" }, value: "WORK" };
const leaveOption = (days: number) => ({
  text: { type: "plain_text", text: `연차 신청 (${days}일)` },
  value: "LEAVE",
});

export function choiceModalView(args: {
  assignmentId: number;
  versionId: number;
  head: NoticeHead;
  employeeName: string;
  condition: WorkCondition | null;
  infos: DateInfo[];
  choices: Choices;
  balance: ChoiceBalance;
  /** 이 공고로 이미 낸 연차의 처리 상태 (날짜 → 라벨) */
  ownStatus: Record<string, string>;
  banner?: string | null;
  archived?: boolean;
}): any {
  const blocks: any[] = [];
  if (args.banner) blocks.push(md(`⚠️ ${args.banner}`));
  blocks.push(md(headLines(args.head)));
  blocks.push(md(NOTICE_BODY.join("\n")));
  if (args.head.extraNote) blocks.push(md(args.head.extraNote));
  blocks.push({ type: "divider" });
  blocks.push(md(`*${args.employeeName} 님의 정상근무 조건*\n${conditionText(args.condition)}`));
  const b = args.balance;
  blocks.push(
    ctx(
      `현재 확정 잔여 *${b.remaining}일* · 승인 대기 ${b.pending}일` +
        (b.scheduled > 0 ? ` · 앞으로 발생 예정 ${b.scheduled}일(확정 전이라 신청 가능량에 넣지 않습니다)` : "") +
        (b.ineligibleNote ? `\n${b.ineligibleNote}` : "") +
        "\n잔여가 모자라면 제출 단계에서 안내합니다 — 부족분을 마이너스 연차·무급·급여 공제로 바꾸지 않습니다."
    )
  );
  blocks.push({ type: "divider" });
  blocks.push(md("*날짜별 선택* — 날짜마다 정상근무 또는 연차 신청을 골라 주세요. 고른 내용은 바로 임시저장됩니다."));

  for (const i of args.infos) {
    const hours = i.hours ? ` · 근무 ${i.hours}` : "";
    if (!isSelectable(i)) {
      blocks.push(ctx(`*${i.label}*${hours} — 선택 대상 아님: ${skipReason(i)}`));
      continue;
    }
    const chosen = args.choices[i.date];
    const opts = [WORK_OPTION, leaveOption(i.leaveDays)];
    const initial = chosen ? opts.find((o) => o.value === chosen) : undefined;
    blocks.push({
      type: "input",
      block_id: `d_${i.date}`,
      optional: true,
      dispatch_action: true,
      label: pt(`${i.label}${hours}`),
      ...(args.ownStatus[i.date] ? { hint: pt(`이 공고로 낸 연차: ${args.ownStatus[i.date]}`) } : {}),
      element: {
        type: "radio_buttons",
        action_id: "vac_pick",
        options: opts,
        ...(initial ? { initial_option: initial } : {}),
      },
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "actions",
    block_id: "vac_inquiry",
    elements: [
      {
        type: "button",
        text: pt("안내 내용 확인 요청"),
        action_id: "vac_inquiry_open",
        value: String(args.assignmentId),
      },
    ],
  });
  blocks.push(
    ctx(
      "근무 조건이 실제와 다르거나 이해되지 않으면 *안내 내용 확인 요청*을 남겨 주세요. 문의에는 동의나 서명이 필요 없습니다.\n" +
        "연차를 쓰지 않는 이유나 휴가 사유는 적지 않아도 됩니다."
    )
  );

  return {
    type: "modal",
    callback_id: "vac_choice",
    private_metadata: JSON.stringify({ aid: args.assignmentId, vid: args.versionId }),
    title: pt("근무 선택 및 연차 신청"),
    ...(args.archived ? {} : { submit: pt("다음") }),
    close: pt("닫기"),
    blocks: blocks.slice(0, 100),
  };
}

/** 제출값·임시저장 이벤트에서 날짜별 선택을 읽는다 */
export function readChoiceValues(view: any): Record<string, string> {
  const v = view?.state?.values ?? {};
  const out: Record<string, string> = {};
  for (const [blockId, actions] of Object.entries<any>(v)) {
    if (!blockId.startsWith("d_")) continue;
    const val = actions?.vac_pick?.selected_option?.value;
    if (val === "WORK" || val === "LEAVE") out[blockId.slice(2)] = val;
  }
  return out;
}

/**
 * 모달에 그려진 '고를 수 있는 날짜' — 제출값만으로 미선택을 가리려고 쓴다(DB 를 안 거친다).
 * 선택 대상이 아닌 날은 입력칸 없이 안내 줄로만 그리므로 여기 잡히지 않는다.
 */
export function selectableDatesInView(view: any): string[] {
  return (view?.blocks ?? [])
    .filter((b: any) => b?.type === "input" && typeof b.block_id === "string" && b.block_id.startsWith("d_"))
    .map((b: any) => b.block_id.slice(2));
}

/**
 * 처리 중 화면 — 슬랙은 모달 제출 응답을 **3초** 안에 받지 못하면 제출을 버리고 원래 화면에
 * 오류만 띄운다(직원에게는 '눌렀는데 그 화면 그대로' 로 보인다). 무거운 조회·제출은 이 화면을
 * 먼저 띄워 두고 뒤에서 끝낸 뒤 `external_id` 로 갈아 끼운다.
 */
export function waitingView(title: string, text: string, externalId: string): any {
  return {
    type: "modal",
    external_id: externalId,
    title: pt(title.slice(0, 24)),
    close: pt("닫기"),
    blocks: [md(`⏳ ${text}`)],
  };
}

/** 안내만 담은 화면 (닫기 버튼 문구를 고를 수 있다 — 쌓인 화면 위에서는 '뒤로') */
export function noticeView(title: string, text: string, opts: { externalId?: string; close?: string } = {}): any {
  return {
    type: "modal",
    ...(opts.externalId ? { external_id: opts.externalId } : {}),
    title: pt(title.slice(0, 24)),
    close: pt(opts.close ?? "닫기"),
    blocks: [md(text)],
  };
}

export function missingChoiceErrors(dates: string[]): Record<string, string> {
  return Object.fromEntries(
    dates.map((d) => [`d_${d}`, "아직 선택하지 않았습니다. 지금까지 고른 내용은 임시저장되었습니다."])
  );
}

/* ============================== 2단계: 신청서 미리보기·서명 ============================== */

export function signModalView(args: {
  assignmentId: number;
  versionId: number;
  choices: Choices;
  preview: {
    companyName: string;
    employeeName: string;
    department: string | null;
    head: NoticeHead;
    condition: WorkCondition | null;
    rows: { label: string; hours: string | null; choice: string; days: number }[];
    balance: BalanceCheck;
    basis: string;
    supersedesDocNo: string | null;
  };
  banner?: string | null;
}): any {
  const p = args.preview;
  const leaveRows = p.rows.filter((r) => r.choice === "LEAVE");
  const total = leaveRows.reduce((a, r) => a + r.days, 0);
  const blocks: any[] = [];
  if (args.banner) blocks.push(md(`⚠️ ${args.banner}`));
  blocks.push(
    md(
      `*연차유급휴가 신청서 (미리보기)*\n` +
        `• 사업장: ${p.companyName}\n` +
        `• 성명 · 소속: ${p.employeeName} · ${p.department ?? "-"}\n` +
        `• 공고: ${p.head.title} (제${p.head.version}판)` +
        (p.supersedesDocNo ? `\n• 이전 제출 ${p.supersedesDocNo} 을(를) 변경합니다` : "")
    )
  );
  blocks.push(
    md(
      `*날짜별 선택*\n` +
        p.rows
          .map((r) => `• ${r.label}${r.hours ? ` (${r.hours})` : ""} — ${r.choice === "LEAVE" ? `*연차 신청 ${r.days}일*` : "정상근무"}`)
          .join("\n")
    )
  );
  blocks.push(
    md(
      `*신청 총량* ${total}일\n` +
        `현재 확정 잔여 ${p.balance.remaining}일 · 승인 대기 ${p.balance.pending}일` +
        (p.balance.releasing ? ` · 이번 변경으로 철회 ${p.balance.releasing}일` : "") +
        ` → 모두 승인 시 예상 잔여 *${p.balance.after}일*\n_산정 기준: ${p.basis}_`
    )
  );
  blocks.push(md(`*정상근무 안내*\n${conditionText(p.condition)}`));
  blocks.push(md(`*신청 문구*\n${APPLICATION_STATEMENT.join("\n")}`));
  blocks.push({
    type: "input",
    block_id: "checks",
    optional: true,
    label: pt("확인 항목 (모두 직접 확인해 주세요)"),
    element: {
      type: "checkboxes",
      action_id: "v",
      options: CHECK_ITEMS.map((c) => ({ text: { type: "plain_text", text: c.label }, value: c.value })),
    },
  });
  blocks.push({
    type: "input",
    block_id: "signed_name",
    optional: true,
    label: pt("본인 성명 직접 입력 (전자서명)"),
    hint: pt("슬랙 본인 계정으로 제출되며, 입력한 성명·확인 항목·제출 시각이 신청서에 함께 기록됩니다."),
    element: { type: "plain_text_input", action_id: "v", placeholder: pt("성명을 입력하세요") },
  });
  return {
    type: "modal",
    callback_id: "vac_sign",
    private_metadata: JSON.stringify({
      aid: args.assignmentId,
      vid: args.versionId,
      c: args.choices,
      s: [p.balance.remaining, p.balance.pending, p.balance.adding, p.balance.releasing],
    }),
    title: pt("연차 신청서 확인·서명"),
    submit: pt("서명하고 제출"),
    close: pt("뒤로"),
    blocks: blocks.slice(0, 100),
  };
}

export function readSignValues(view: any): { checks: string[]; signedName: string } {
  const v = view?.state?.values ?? {};
  return {
    checks: (v.checks?.v?.selected_options ?? []).map((o: any) => String(o?.value)),
    signedName: String(v.signed_name?.v?.value ?? "").trim(),
  };
}

export function allChecked(checks: string[]): boolean {
  return CHECK_ITEMS.every((c) => checks.includes(c.value));
}

/* ============================== 결과·문의 ============================== */

export function resultView(args: {
  kind: "LEAVE" | "WORK_ONLY";
  docNo: string;
  rows: { label: string; choice: string; days: number }[];
  submissionId: number;
  note?: string | null;
}): any {
  const leave = args.kind === "LEAVE";
  return {
    type: "modal",
    title: pt(leave ? "신청 접수 완료" : "근무 선택 기록 완료"),
    close: pt("닫기"),
    blocks: [
      md(
        leave
          ? `✅ *연차유급휴가 신청이 접수되었습니다.* (문서번호 ${args.docNo})\n접수는 사용 확정이 아닙니다 — 기존 절차대로 결재된 뒤 연차 현황에 반영됩니다.`
          : `✅ *근무 선택이 기록되었습니다.* (문서번호 ${args.docNo})\n연차 신청서는 만들지 않았습니다.`
      ),
      md(args.rows.map((r) => `• ${r.label} — ${r.choice === "LEAVE" ? `연차 신청 ${r.days}일` : "정상근무"}`).join("\n") || "-"),
      ...(args.note ? [ctx(args.note)] : []),
      ctx("신청서(또는 확인 내역)는 DM 의 *문서 받기* 버튼으로 언제든 내려받을 수 있습니다. 내용을 바꾸려면 안내 DM 의 버튼으로 다시 열어 제출하세요."),
    ],
  };
}

/** 제출 영수 DM — 본인에게만 */
export function receiptDmBlocks(args: {
  kind: "LEAVE" | "WORK_ONLY";
  docNo: string;
  title: string;
  submissionId: number;
  assignmentId: number;
  summary: string;
}): { text: string; blocks: any[] } {
  const leave = args.kind === "LEAVE";
  return {
    text: `${leave ? "연차 신청 접수" : "근무 선택 기록"}: ${args.title}`,
    blocks: [
      md(
        `${leave ? "✅ *연차유급휴가 신청이 접수되었습니다*" : "✅ *근무 선택이 기록되었습니다*"} — ${args.title}\n문서번호 ${args.docNo}\n${args.summary}`
      ),
      {
        type: "actions",
        block_id: `vac_receipt_${args.submissionId}`,
        elements: [
          { type: "button", text: pt(leave ? "신청서 받기 (PDF)" : "확인 내역 받기 (PDF)"), action_id: "vac_doc", value: String(args.submissionId) },
          { type: "button", text: pt("선택 변경 · 다시 보기"), action_id: "vac_open", value: String(args.assignmentId) },
        ],
      },
    ],
  };
}

export function inquiryModalView(assignmentId: number): any {
  return {
    type: "modal",
    callback_id: "vac_inquiry_submit",
    private_metadata: JSON.stringify({ aid: assignmentId }),
    title: pt("안내 내용 확인 요청"),
    submit: pt("보내기"),
    close: pt("취소"),
    blocks: [
      md("공고 내용과 실제 근무 가능 여부가 다르거나 이해되지 않는 부분을 적어 주세요. 담당자에게 전달되며, 연차 신청이나 동의로 처리되지 않습니다."),
      {
        type: "input",
        block_id: "msg",
        label: pt("확인하고 싶은 내용"),
        element: { type: "plain_text_input", action_id: "v", multiline: true, max_length: 1000 },
      },
    ],
  };
}

/* ============================== 결재 ============================== */

/**
 * 운영진 승인 카드 — 한 번의 제출에서 나온 날짜별 신청을 한 장으로 묶는다(날짜마다 카드가
 * 올라오면 승인 채널이 도배된다). 버튼은 묶음 전체에 작용하되 **처리는 신청 하나씩**
 * 기존 승인 함수로 한다(차감 규칙이 한 벌로 남는다).
 */
export function groupApprovalBlocks(args: {
  submissionId: number;
  name: string;
  dept: string;
  docNo: string;
  dates: string[];
  remaining: number;
  after: number;
  preApprovedBy?: string | null;
  pre?: boolean;
}): any[] {
  const days = args.dates.length;
  const head = args.pre ? "🧾 연차 중간결재 요청 (방학 근무·연차)" : "🏖️ 연차 신청 (방학 근무·연차)";
  return [
    { type: "header", text: { type: "plain_text", text: head, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*신청자*\n${args.name} (${args.dept})` },
        { type: "mrkdwn", text: `*신청일*\n${datesSummary(args.dates)} · ${days}일` },
        { type: "mrkdwn", text: `*현재 확정 잔여*\n${args.remaining}일` },
        { type: "mrkdwn", text: `*모두 승인 시 예상 잔여*\n${args.after}일` },
      ],
    },
    ctx(
      `공고 선택에 따른 본인 신청 · 문서번호 ${args.docNo}` +
        (args.preApprovedBy ? `\n☑️ 중간결재: ${args.preApprovedBy} 확인` : "") +
        "\n신청일을 바꾸려면 반려 사유로 안내해 주세요 — 신청일을 대신 고치지 않습니다."
    ),
    {
      type: "actions",
      block_id: `vac_grp_${args.submissionId}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: pt(args.pre ? "확인 (운영진 승인으로)" : "승인"),
          action_id: args.pre ? "vac_pre_approve" : "vac_approve",
          value: String(args.submissionId),
        },
        {
          type: "button",
          style: "danger",
          text: pt("반려"),
          action_id: args.pre ? "vac_pre_reject" : "vac_reject",
          value: String(args.submissionId),
        },
      ],
    },
  ];
}

export function rejectReasonModal(args: { submissionId: number; pre: boolean; channel?: string; ts?: string }): any {
  return {
    type: "modal",
    callback_id: "vac_reject_submit",
    private_metadata: JSON.stringify({ sid: args.submissionId, pre: args.pre, ch: args.channel ?? "", ts: args.ts ?? "" }),
    title: pt("연차 신청 반려"),
    submit: pt("반려"),
    close: pt("취소"),
    blocks: [
      md("반려 사유는 신청자에게 그대로 전달되고 처리 이력에 남습니다. 시기 조정이 필요하면 사유에 적어 주세요 — 신청자가 다시 고릅니다."),
      {
        type: "input",
        block_id: "reason",
        label: pt("반려 사유"),
        element: { type: "plain_text_input", action_id: "v", multiline: true, max_length: 500 },
      },
    ],
  };
}
