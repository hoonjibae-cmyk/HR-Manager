// 연차 초과 사용(잔여 마이너스) 신청 — 판정과 안내 문구.
//
// 연차는 **발생한 범위 안에서만** 쓸 수 있는 권리다(근로기준법 §60). 잔여가 0 이하인데 더 쓰면
// 앞으로 발생할 연차를 미리 당겨 쓰는 셈이고, 그대로 퇴직하면 초과분은 회사가 준 적 없는
// 유급휴가가 된다. 그래서 초과분을 **퇴직월 급여에서 공제한다는 동의**를 신청 시점에 받는다.
// 임금 공제는 §43(전액불) 때문에 근로자의 **명시적 동의**가 근거여야 하므로, 신청마다 체크를
// 받고 그 시각을 신청서에 새긴다(임금공제 동의서의 연차 초과사용 정산 조항과 같은 내용이다).

/** 연차 잔여에서 차감되는 종류 — 대휴(COMP)는 별도 잔여, 병가·경조사는 차감하지 않는다 */
export const OVERDRAFT_TYPES = ["ANNUAL", "HALF", "HALF_AM", "HALF_PM"] as const;

export function affectsAnnualBalance(leaveType: string): boolean {
  return (OVERDRAFT_TYPES as readonly string[]).includes(leaveType);
}

export interface OverdraftCheck {
  /** 이번 신청으로 잔여가 0 밑으로 내려가는가 (이미 마이너스인 경우 포함) */
  overdrawn: boolean;
  /** 지금 잔여 (승인된 사용분만 반영) */
  remaining: number;
  /** 아직 승인되지 않은 연차 신청 일수 — 승인되면 잔여에서 빠진다 */
  pending: number;
  /** 이번 신청 일수 */
  days: number;
  /** 모두 승인되면 남는 잔여 (음수면 초과 사용) */
  after: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 이번 신청이 잔여를 넘는지 판정한다.
 *
 * **승인 대기 중인 신청도 함께 뺀다** — 잔여 1일인 사람이 1일짜리를 두 번 연달아 내면 각각은
 * 잔여 안이지만 둘 다 승인되면 −1일이 된다. 승인 전 잔여만 보면 두 번째 신청에서 동의를
 * 받을 기회가 사라진다.
 */
export function checkOverdraft(input: {
  leaveType: string;
  remaining: number;
  pending: number;
  days: number;
}): OverdraftCheck {
  const remaining = r2(input.remaining);
  const pending = r2(Math.max(0, input.pending));
  const days = r2(input.days);
  const after = r2(remaining - pending - days);
  return {
    overdrawn: affectsAnnualBalance(input.leaveType) && days > 0 && after < 0,
    remaining,
    pending,
    days,
    after,
  };
}

/**
 * 양식을 열 때부터 동의란을 보여 줄지 — 쓸 수 있는 연차가 이미 없으면(0 이하) 어떤 연차
 * 신청이든 초과가 되므로 처음부터 띄운다. 잔여가 남아 있으면 제출 때 판정해 필요할 때만 띄운다.
 */
export function showConsentUpfront(remaining: number, pending: number): boolean {
  return r2(remaining - Math.max(0, pending)) <= 0;
}

const d = (n: number) => `${n}일`;

/** 모달·포털에 띄울 안내 (mrkdwn — `*굵게*`) */
export function overdraftNoticeText(c: Pick<OverdraftCheck, "remaining" | "pending" | "days" | "after">, opts?: { upfront?: boolean }): string {
  const figures = opts?.upfront
    ? `현재 잔여 연차 *${d(c.remaining)}*${c.pending > 0 ? ` (승인 대기 ${d(c.pending)} 반영 시 *${d(r2(c.remaining - c.pending))}*)` : ""}`
    : `현재 잔여 *${d(c.remaining)}*${c.pending > 0 ? ` − 승인 대기 ${d(c.pending)}` : ""} − 이번 신청 ${d(c.days)} → *신청 후 ${d(c.after)}*`;
  return (
    `⚠️ *사용할 수 있는 연차를 초과한 신청입니다*\n${figures}\n\n` +
    `근로기준법상 연차휴가는 이미 발생한 일수 안에서 사용하는 것이 원칙이라, 잔여가 마이너스(−)가 되는 ` +
    `연차는 그대로는 사용할 수 없습니다. 다만 아래 내용에 동의하시면 *앞으로 발생할 연차를 미리 당겨 쓰는 것*으로 처리해 신청할 수 있습니다.\n` +
    `• 이후 발생하는 연차로 초과분이 먼저 채워집니다.\n` +
    `• 퇴직 시점까지 다 채워지지 않은 초과분은 *초과 일수 × 1일 통상임금*으로 계산해 *퇴직월 급여에서 공제*합니다.`
  );
}

/** 동의 체크박스 문구 (plain_text — 슬랙 체크박스 라벨은 150자 이내) */
export const OVERDRAFT_CONSENT_LABEL =
  "위 내용을 확인했으며, 퇴직 시 남은 연차 초과분을 퇴직월 급여에서 공제하는 데 동의합니다.";

/** 동의 없이 제출했을 때 모달 오류칸 한 줄 */
export const OVERDRAFT_CONSENT_REQUIRED =
  "잔여 연차를 초과하는 신청입니다. 안내를 확인하고 동의란에 체크해야 제출할 수 있습니다.";

/** 승인 카드·결재 DM 에 붙는 한 줄 — 승인자가 초과 신청임을 모르고 누르지 않게 */
export function overdraftApprovalLine(after: number): string {
  return `⚠️ *잔여 초과 신청* — 승인 시 잔여 ${d(after)} · 신청자가 퇴직 시 초과분 급여 공제에 동의함`;
}

/* ============================== 동의 기록 ============================== */
//
// 동의는 **나중에 다툼이 생겼을 때 꺼내 보일 수 있어야** 뜻이 있다. 체크 시각만 남기면
// '무엇에 동의했는가' 를 증명할 수 없다 — 그래서 신청 순간 화면에 보인 안내문·동의 문구와
// 그때의 잔여·승인 대기·신청 일수, 어느 경로(본인 슬랙 계정·포털)로 냈는지를 **원문 그대로**
// 신청서에 새기고(`LeaveRequest.overdraftConsent`), 무결성 점검용 지문을 함께 둔다.
// 문구가 나중에 바뀌어도 옛 신청의 기록은 그때 문구로 남는다(다시 만들지 않는다).

export type ConsentChannel = "SLACK_MODAL" | "PORTAL";

export const CONSENT_CHANNEL_LABEL: Record<ConsentChannel, string> = {
  SLACK_MODAL: "슬랙 휴가신청서 (본인 슬랙 계정)",
  PORTAL: "직원 포털 (본인 로그인)",
};

export interface OverdraftConsentRecord {
  v: 1;
  /** 동의(=신청 접수) 시각, ISO */
  agreedAt: string;
  channel: ConsentChannel;
  /** 요청 서명으로 확인된 슬랙 사용자 ID */
  account: string | null;
  employee: { id: number; name: string; department: string | null };
  leave: { type: string; typeLabel: string; start: string; end: string; days: number };
  /** 신청 시점 수치 — 잔여(승인분만) · 승인 대기 · 이번 신청 · 모두 승인 시 잔여 */
  figures: { remaining: number; pending: number; days: number; after: number };
  /** 신청자에게 보인 안내문 (서식 기호를 뺀 평문) */
  notice: string;
  /** 신청자가 체크한 동의 문구 */
  label: string;
}

const ymdOf = (d: Date) => d.toISOString().slice(0, 10);

export function buildConsentRecord(input: {
  check: Pick<OverdraftCheck, "remaining" | "pending" | "days" | "after">;
  channel: ConsentChannel;
  account: string | null;
  employee: { id: number; name: string; department: string | null };
  leave: { type: string; typeLabel: string; start: Date; end: Date; days: number };
  at: Date;
}): OverdraftConsentRecord {
  const { remaining, pending, days, after } = input.check;
  return {
    v: 1,
    agreedAt: input.at.toISOString(),
    channel: input.channel,
    account: input.account,
    employee: { id: input.employee.id, name: input.employee.name, department: input.employee.department ?? null },
    leave: { type: input.leave.type, typeLabel: input.leave.typeLabel, start: ymdOf(input.leave.start), end: ymdOf(input.leave.end), days: input.leave.days },
    figures: { remaining, pending, days, after },
    notice: overdraftNoticeText({ remaining, pending, days, after }).replaceAll("*", ""),
    label: OVERDRAFT_CONSENT_LABEL,
  };
}

export function parseConsentRecord(json: string | null | undefined): OverdraftConsentRecord | null {
  if (!json) return null;
  try {
    const r = JSON.parse(json);
    return r && r.v === 1 && typeof r.agreedAt === "string" && typeof r.label === "string" ? r : null;
  } catch {
    return null;
  }
}

/** 원문 저장 전 신청의 경로 — LeaveRequest.source 를 사람이 읽는 말로 */
export function legacySourceLabel(source: string | null | undefined): string {
  return source === "PORTAL" ? "직원 포털" : source === "SLACK" || !source ? "슬랙" : source;
}

/** 동의 기록을 저장하기 전(v1.43.1 이하)에 접수된 신청 — 시각과 신청 후 잔여만 있다 */
export const LEGACY_CONSENT_NOTE =
  "이 신청은 동의 원문을 저장하기 전에 접수되어 동의 시각과 '승인 시 잔여'만 기록되어 있습니다. " +
  "당시 신청 화면의 동의 문구는 현재와 같습니다(도입 v1.42.0 이후 변경 없음).";

/** 2026-09-28T05:07:09Z → 2026-09-28 14:07:09 (KST) */
export function kstStamp(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} (KST)`;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * 동의 기록 문서(PDF 본문). 저장된 기록을 그대로 옮길 뿐 새로 판정하지 않는다.
 * 기록이 없는 옛 신청은 남은 것(시각·신청 후 잔여)만 적고 그 사실을 밝힌다.
 */
export function consentRecordHtml(args: {
  companyName: string;
  requestId: number;
  status: string;
  record: OverdraftConsentRecord | null;
  hash: string | null;
  legacy?: { agreedAt: Date; after: number | null; employeeName: string; department: string | null; typeLabel: string; start: Date; end: Date; days: number; source: string | null };
  printedAt: Date;
}): string {
  const r = args.record;
  const L = args.legacy;
  const name = r?.employee.name ?? L?.employeeName ?? "";
  const dept = r?.employee.department ?? L?.department ?? null;
  const leave = r
    ? `${r.leave.typeLabel} · ${r.leave.start}${r.leave.end !== r.leave.start ? ` ~ ${r.leave.end}` : ""} (${r.leave.days}일)`
    : L
      ? `${L.typeLabel} · ${ymdOf(L.start)}${L.end.getTime() !== L.start.getTime() ? ` ~ ${ymdOf(L.end)}` : ""} (${L.days}일)`
      : "-";
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const figures = r
    ? row("신청 시점 잔여", `${r.figures.remaining}일 (승인된 사용분만 반영)`) +
      row("승인 대기 중인 연차", `${r.figures.pending}일`) +
      row("이번 신청", `${r.figures.days}일`) +
      row("모두 승인 시 잔여", `<b>${r.figures.after}일</b>`)
    : row("승인 시 잔여", L?.after != null ? `<b>${L.after}일</b>` : "기록 없음");
  return `<div class="doc">
  <h1 class="doc-title">연차 초과사용 급여공제 동의 기록</h1>
  <p class="small muted" style="text-align:right">신청번호 ${args.requestId} · 출력 ${esc(kstStamp(args.printedAt))}</p>
  <table class="kv"><tbody>
    ${row("사업장", esc(args.companyName))}
    ${row("성명 · 소속", `${esc(name)} · ${esc(dept ?? "-")}`)}
    ${row("신청 휴가", esc(leave))}
    ${row("현재 처리 상태", esc(args.status))}
  </tbody></table>

  <h3>동의 당시 수치</h3>
  <table class="kv"><tbody>${figures}</tbody></table>

  <h3>신청자에게 보인 안내문</h3>
  ${
    r
      ? r.notice
          .split("\n")
          .filter((t) => t.trim())
          .map((t) => `<p class="small">${esc(t)}</p>`)
          .join("")
      : `<p class="small muted">${esc(LEGACY_CONSENT_NOTE)}</p>`
  }

  <h3>동의 문구 (신청자가 직접 체크)</h3>
  <p><b>☑ ${esc(r?.label ?? OVERDRAFT_CONSENT_LABEL)}</b></p>

  <h3>동의 확인</h3>
  <table class="kv"><tbody>
    ${row("동의 시각", esc(kstStamp(r?.agreedAt ?? L!.agreedAt)))}
    ${row("신청 경로", esc(r ? CONSENT_CHANNEL_LABEL[r.channel] ?? r.channel : legacySourceLabel(L?.source)))}
    ${r?.account ? row("신청 계정", `슬랙 사용자 ${esc(r.account)}`) : ""}
    ${args.hash ? row("무결성 점검값", `<span style="font-size:8pt;word-break:break-all">SHA-256 ${esc(args.hash)}</span>`) : ""}
  </tbody></table>
  <p class="small muted">이 문서는 신청 시점에 저장한 기록을 그대로 옮긴 것입니다. 무결성 점검값은 기록이 저장 뒤 바뀌지 않았는지 대조하는 용도이며 법적 효력을 보증하지 않습니다.
  공제의 근거는 이 동의와 임금공제 동의서의 연차 초과사용 정산 조항이며, 실제 공제액은 퇴직 시점의 초과 일수 × 1일 통상임금으로 산정합니다.</p>
</div>`;
}
