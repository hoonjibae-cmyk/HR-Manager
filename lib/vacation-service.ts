// 방학 근무·연차 — DB 어댑터. 판정·문안은 lib/vacation.ts(순수), 슬랙 화면은 lib/vacation-slack.ts.
//
// 연차는 **기존 연차 신청(LeaveRequest)·원장(LeaveTransaction)을 그대로 쓴다** — 이 기능만의
// 잔여 계산기를 두지 않는다(`leaveBalanceOf` · `pendingAnnualDays`). 날짜 하나당 신청 하나로 만들어
// 변경·취소를 날짜 단위로 기존 절차(철회·취소 요청 → 운영진 승인 → 원장 복원)에 태운다.
import { prisma } from "./db";
import { isContractorContract, LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL, parseSchedule } from "./constants";
import { leaveBalanceOf, pendingAnnualDays, ineligibleReason } from "./leave-slack";
import { withEmployeeLeaveLock } from "./leave-lock";
import { preApproverFor } from "./leave-approval";
import { approveLeaveRequest, rejectLeaveRequest } from "./leave-service";
import { getCompany } from "./repo";
import { ymd } from "./format";
import { logActivity } from "./activity";
import { postMessage, slackCall, cancelApprovalBlocks } from "./slack";
import { htmlToPdf } from "./pdf";
import {
  ATTESTATIONS,
  NOTICE_BODY,
  APPLICATION_STATEMENT,
  CHECK_ITEMS,
  assignmentState,
  blockingProblems,
  changeSummary,
  checkBalance,
  choicesKey,
  conditionMissing,
  dateInfo,
  dayLabel,
  diffLeave,
  docNumber,
  emptyContent,
  isMaterialChange,
  isSelectable,
  kstLabel,
  leaveDates,
  parseContent,
  publishProblems,
  remindable,
  renderSubmissionHtml,
  resolveTargets,
  reviewFlagsFor,
  sanitizeChoices,
  signatureNameMatches,
  skipReason,
  unselectedDates,
  ymdOf,
  type BalanceCheck,
  type Choices,
  type DateInfo,
  type ExistingLeave,
  type NoticeContent,
  type SubmissionSnapshot,
  type TargetEmployee,
  type WorkCondition,
} from "./vacation";
import { snapshotHash } from "./vacation-hash";
import {
  groupApprovalBlocks,
  noticeDmBlocks,
  receiptDmBlocks,
  type ChoiceBalance,
  type NoticeDmKind,
  type NoticeHead,
} from "./vacation-slack";

const LIVE = ["PRE_PENDING", "PENDING", "APPROVED", "CANCEL_PENDING"];
const MAX_DATES = 60;

export interface Actor {
  kind: "ADMIN" | "EMPLOYEE" | "SLACK_APPROVER" | "SYSTEM";
  name: string;
}

async function event(
  client: any,
  e: { noticeId: number; assignmentId?: number | null; employeeId?: number | null; type: string; actor: Actor; note?: string | null; detail?: any }
) {
  await client.vacationEvent.create({
    data: {
      noticeId: e.noticeId,
      assignmentId: e.assignmentId ?? null,
      employeeId: e.employeeId ?? null,
      type: e.type,
      actor: e.actor.kind,
      actorName: e.actor.name,
      note: e.note ?? null,
      detail: JSON.stringify(e.detail ?? {}),
    },
  });
}

/* ============================== 공고 작성·발행 ============================== */

export async function createNotice(actor: Actor) {
  return prisma.$transaction(async (tx: any) => {
    const n = await tx.vacationNotice.create({ data: { createdBy: actor.name } });
    await tx.vacationNoticeVersion.create({
      data: { noticeId: n.id, version: 1, content: JSON.stringify(emptyContent()) },
    });
    await event(tx, { noticeId: n.id, type: "CREATED", actor });
    return n;
  });
}

async function draftVersion(noticeId: number) {
  return prisma.vacationNoticeVersion.findFirst({ where: { noticeId, status: "DRAFT" }, orderBy: { version: "desc" } });
}

/** 초안 저장 — 게시한 판은 고치지 않는다(초안만 받는다) */
export async function saveDraft(noticeId: number, content: NoticeContent) {
  const d = await draftVersion(noticeId);
  if (!d) throw new Error("수정할 초안이 없습니다. 게시한 공고를 고치려면 '수정본 만들기'로 새 판을 여세요.");
  const clean = parseContent(JSON.stringify(content));
  if (clean.dates.length > MAX_DATES) throw new Error(`선택 대상 날짜는 ${MAX_DATES}일까지입니다.`);
  await prisma.vacationNoticeVersion.update({ where: { id: d.id }, data: { content: JSON.stringify(clean) } });
  return clean;
}

/** 게시한 공고의 수정본(새 판 초안) — 앞 판 내용을 그대로 복사해 시작한다 */
export async function reviseNotice(noticeId: number, actor: Actor) {
  const existing = await draftVersion(noticeId);
  if (existing) return existing;
  const notice = await prisma.vacationNotice.findUnique({ where: { id: noticeId } });
  if (!notice?.currentVersionId) throw new Error("아직 게시한 판이 없습니다.");
  if (notice.status === "ARCHIVED") throw new Error("보관된 공고는 고칠 수 없습니다.");
  const cur = await prisma.vacationNoticeVersion.findUnique({ where: { id: notice.currentVersionId } });
  const last = await prisma.vacationNoticeVersion.findFirst({ where: { noticeId }, orderBy: { version: "desc" } });
  const v = await prisma.vacationNoticeVersion.create({
    data: { noticeId, version: (last?.version ?? 0) + 1, content: cur!.content },
  });
  await event(prisma, { noticeId, type: "REVISION_STARTED", actor, detail: { version: v.version } });
  return v;
}

/** 초안만 있는(한 번도 게시하지 않은) 공고는 지울 수 있다 */
export async function deleteDraftNotice(noticeId: number) {
  const n = await prisma.vacationNotice.findUnique({ where: { id: noticeId } });
  if (!n) throw new Error("공고 없음");
  if (n.currentVersionId || n.status !== "DRAFT") throw new Error("게시한 공고는 지울 수 없습니다 — 보관하세요.");
  await prisma.$transaction([
    prisma.vacationEvent.deleteMany({ where: { noticeId } }),
    prisma.vacationNoticeVersion.deleteMany({ where: { noticeId } }),
    prisma.vacationNotice.delete({ where: { id: noticeId } }),
  ]);
}

/* ----- 직원·날짜 판정 재료 ----- */

async function holidaysMap(): Promise<Map<string, string>> {
  const rows = await prisma.holiday.findMany();
  return new Map(rows.map((h) => [ymdOf(h.date), h.name]));
}

function isBusinessDay(d: string, holidays: Map<string, string>) {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6 && !holidays.has(d);
}

/** 대상 날짜에 걸친 기존 휴가 — 신청(기간을 근무일로 펼친다)·관리자 직접 반영·평일 휴무 */
async function existingFor(
  client: any,
  employeeIds: number[],
  dates: string[],
  holidays: Map<string, string>,
  ownAssignmentId?: number
) {
  const byEmp = new Map<number, ExistingLeave[]>();
  const dayOffs = new Map<number, Set<string>>();
  if (!dates.length || !employeeIds.length) return { byEmp, dayOffs };
  const lo = new Date(`${dates[0]}T00:00:00Z`);
  const hi = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  const want = new Set(dates);
  const reqs = await client.leaveRequest.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: { in: LIVE },
      startDate: { lte: hi },
      endDate: { gte: lo },
    },
  });
  const push = (id: number, x: ExistingLeave) => {
    if (!byEmp.has(id)) byEmp.set(id, []);
    byEmp.get(id)!.push(x);
  };
  for (const r of reqs) {
    const s = ymdOf(r.startDate);
    const e = ymdOf(r.endDate);
    const own = ownAssignmentId != null && r.vacationAssignmentId === ownAssignmentId;
    const label = `${LEAVE_TYPE_LABEL[r.leaveType] ?? r.leaveType} 신청 (${LEAVE_STATUS_LABEL[r.status] ?? r.status})`;
    for (const d of dates) {
      if (d < s || d > e) continue;
      if (s !== e && !isBusinessDay(d, holidays)) continue;
      push(r.employeeId, { date: d, requestId: r.id, label, own });
    }
  }
  const txns = await client.leaveTransaction.findMany({
    where: { employeeId: { in: employeeIds }, type: "USE", requestId: null, date: { gte: lo, lte: hi } },
  });
  for (const t of txns) {
    const d = ymdOf(t.date);
    if (want.has(d)) push(t.employeeId, { date: d, requestId: null, label: "연차 사용 반영(관리자 직접 반영)", own: false });
  }
  const offs = await client.dayOff.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: lo, lte: hi } } });
  for (const o of offs) {
    if (!dayOffs.has(o.employeeId)) dayOffs.set(o.employeeId, new Set());
    dayOffs.get(o.employeeId)!.add(ymdOf(o.date));
  }
  return { byEmp, dayOffs };
}

async function allEmployeesForTargets(): Promise<(TargetEmployee & { schedule: string | null; empNo: string })[]> {
  const rows = await prisma.employee.findMany({
    select: {
      id: true,
      name: true,
      empNo: true,
      department: true,
      active: true,
      hireDate: true,
      resignDate: true,
      slackUserId: true,
      isContractor: true,
      payScheme: true,
      schedule: true,
    },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    empNo: r.empNo,
    department: r.department,
    active: r.active,
    hireDate: r.hireDate,
    resignDate: r.resignDate,
    slackUserId: r.slackUserId,
    contractor: isContractorContract(r as any),
    schedule: r.schedule,
  }));
}

function periodLastDay(summary: any): string | null {
  return summary?.period?.end ? ymdOf(summary.period.end) : null;
}

/**
 * 발행 전 점검 — 대상자와 직원별·날짜별 판정을 한 표로. 관리자가 보고 운영조건 미확인
 * 칸을 표시(unconfirmed)하면 그 날은 신청·차감 대상이 되지 않는다.
 */
export async function previewNotice(noticeId: number) {
  const d = (await draftVersion(noticeId)) ??
    (await prisma.vacationNoticeVersion.findFirst({ where: { noticeId }, orderBy: { version: "desc" } }));
  if (!d) throw new Error("공고 없음");
  const content = parseContent(d.content);
  return previewContent(content);
}

export async function previewContent(content: NoticeContent) {
  const emps = await allEmployeesForTargets();
  const { targets, excluded } = resolveTargets(emps, content);
  const holidays = await holidaysMap();
  const { byEmp, dayOffs } = await existingFor(prisma, targets.map((t) => t.id), content.dates, holidays);
  const unconfirmed = new Set(content.unconfirmed);
  const rows = [];
  for (const t of targets) {
    const e = emps.find((x) => x.id === t.id)!;
    const full = await prisma.employee.findUnique({ where: { id: t.id } });
    const { summary } = await leaveBalanceOf(full as any);
    const cond = t.department ? content.conditions[t.department] : undefined;
    const infos = content.dates.map((date) =>
      dateInfo(date, {
        employee: t,
        schedule: parseSchedule(e.schedule),
        holidays,
        dayOffs: dayOffs.get(t.id) ?? new Set(),
        existing: byEmp.get(t.id) ?? [],
        unconfirmed,
        conditionReady: conditionMissing(cond).length === 0,
        periodLastDay: periodLastDay(summary),
      })
    );
    rows.push({
      employeeId: t.id,
      name: t.name,
      department: t.department,
      slackLinked: !!t.slackUserId,
      remaining: summary.remaining,
      leaveEligible: summary.eligible,
      infos,
    });
  }
  const depts = [...new Set(targets.map((t) => t.department ?? "(부서 미지정)"))];
  const problems = publishProblems(content, depts);
  return {
    content,
    rows,
    excluded: excluded.map((x) => ({ employeeId: x.employee.id, name: x.employee.name, department: x.employee.department, reason: x.reason })),
    problems,
    blocking: blockingProblems(problems),
    targetDepts: depts,
  };
}

export async function publishNotice(
  noticeId: number,
  attest: Record<string, boolean>,
  actor: Actor
) {
  const missingAttest = ATTESTATIONS.filter((a) => attest?.[a.key] !== true);
  if (missingAttest.length)
    throw new Error(`발행 전 확인 항목을 모두 확인해 주세요: ${missingAttest.map((a) => a.label).join(" / ")}`);
  const notice = await prisma.vacationNotice.findUnique({ where: { id: noticeId } });
  if (!notice) throw new Error("공고 없음");
  if (notice.status === "ARCHIVED") throw new Error("보관된 공고입니다.");
  const d = await draftVersion(noticeId);
  if (!d) throw new Error("게시할 초안이 없습니다.");
  const content = parseContent(d.content);
  const pv = await previewContent(content);
  if (pv.blocking.length) throw new Error(pv.blocking.join("\n"));
  if (!pv.rows.length) throw new Error("대상 직원이 없습니다.");

  const prev = notice.currentVersionId
    ? await prisma.vacationNoticeVersion.findUnique({ where: { id: notice.currentVersionId } })
    : null;
  const prevContent = prev ? parseContent(prev.content) : null;
  const material = prevContent ? isMaterialChange(prevContent, content) : false;
  const changes = prevContent ? changeSummary(prevContent, content) : [];
  const now = new Date();

  const result = await prisma.$transaction(async (tx: any) => {
    // 초안이 그새 게시됐으면(두 번 누름) 한 번만 게시된다
    const upd = await tx.vacationNoticeVersion.updateMany({
      where: { id: d.id, status: "DRAFT" },
      data: {
        status: "PUBLISHED",
        publishedAt: now,
        publishedBy: actor.name,
        material,
        changeNote: changes.join("\n") || null,
        attestation: JSON.stringify({
          items: Object.fromEntries(ATTESTATIONS.map((a) => [a.key, a.label])),
          by: actor.name,
          at: now.toISOString(),
          note: "운영 사실 확인이며 법률 검토 완료를 뜻하지 않습니다.",
        }),
        targets: JSON.stringify(pv.rows.map((r) => ({ employeeId: r.employeeId, name: r.name, department: r.department }))),
        excluded: JSON.stringify(pv.excluded),
      },
    });
    if (upd.count !== 1) throw new Error("이미 게시된 초안입니다.");
    if (prev) await tx.vacationNoticeVersion.update({ where: { id: prev.id }, data: { status: "SUPERSEDED" } });
    await tx.vacationNotice.update({
      where: { id: noticeId },
      data: { status: notice.status === "CLOSED" ? "CLOSED" : "PUBLISHED", currentVersionId: d.id },
    });

    const existing = await tx.vacationAssignment.findMany({ where: { noticeId } });
    const sent: { assignmentId: number; kind: NoticeDmKind; needsReconfirm: boolean }[] = [];
    const targetIds = new Set(pv.rows.map((r) => r.employeeId));
    for (const r of pv.rows) {
      const a = existing.find((x: any) => x.employeeId === r.employeeId);
      if (!a) {
        const created = await tx.vacationAssignment.create({
          data: { noticeId, employeeId: r.employeeId, employeeName: r.name, department: r.department, versionId: d.id },
        });
        sent.push({ assignmentId: created.id, kind: "NEW", needsReconfirm: false });
      } else {
        const needsReconfirm = material && a.activeSubmissionId != null;
        await tx.vacationAssignment.update({
          where: { id: a.id },
          data: {
            versionId: d.id,
            removed: false,
            needsReconfirm: needsReconfirm || a.needsReconfirm,
            employeeName: r.name,
            department: r.department,
          },
        });
        sent.push({ assignmentId: a.id, kind: a.removed ? "NEW" : "CHANGED", needsReconfirm });
      }
    }
    for (const a of existing) {
      if (a.employeeId != null && !targetIds.has(a.employeeId) && !a.removed) {
        await tx.vacationAssignment.update({ where: { id: a.id }, data: { removed: true } });
        await event(tx, { noticeId, assignmentId: a.id, employeeId: a.employeeId, type: "REMOVED_FROM_TARGETS", actor, note: "개정판 대상에서 빠짐 — 기존 신청·연차는 그대로 둔다" });
      }
    }
    await event(tx, {
      noticeId,
      type: "PUBLISHED",
      actor,
      detail: { version: d.version, material, targets: pv.rows.length, changes },
    });
    return { sent };
  });

  await logActivity({
    action: "VACATION_PUBLISH",
    actor: "ADMIN",
    actorName: actor.name,
    target: content.title,
    summary: `방학 근무·연차 공고 「${content.title}」 제${d.version}판을 게시했습니다 (대상 ${pv.rows.length}명${material ? ", 재확인 필요 변경" : ""}).`,
    meta: { noticeId, version: d.version },
  });

  const delivery = await deliverNotice(noticeId, result.sent, changes);
  return { version: d.version, targets: pv.rows.length, material, ...delivery };
}

function headOf(noticeId: number, version: number, c: NoticeContent): NoticeHead {
  return {
    noticeId,
    title: c.title,
    version,
    classOffStart: c.classOffStart,
    classOffEnd: c.classOffEnd,
    dates: c.dates,
    deadline: c.deadline,
    contactName: c.contactName,
    extraNote: c.extraNote,
  };
}

/** 개인 DM 발송 — 실패해도 게시는 그대로이고 누가 못 받았는지 기록한다 */
async function deliverNotice(
  noticeId: number,
  list: { assignmentId: number; kind: NoticeDmKind; needsReconfirm: boolean }[],
  changes: string[] = []
) {
  const notice = await prisma.vacationNotice.findUnique({ where: { id: noticeId } });
  const version = await prisma.vacationNoticeVersion.findUnique({ where: { id: notice!.currentVersionId! } });
  const content = parseContent(version!.content);
  const head = headOf(noticeId, version!.version, content);
  let ok = 0;
  const failed: string[] = [];
  for (const item of list) {
    const a = await prisma.vacationAssignment.findUnique({ where: { id: item.assignmentId }, include: { employee: true } });
    if (!a) continue;
    const slack = a.employee?.slackUserId;
    if (!slack) {
      failed.push(`${a.employeeName}(슬랙 미연동)`);
      await prisma.vacationAssignment.update({ where: { id: a.id }, data: { notifyError: "슬랙 미연동 — 배포 불가" } });
      continue;
    }
    const { text, blocks } = noticeDmBlocks({ kind: item.kind, head, assignmentId: a.id, changes, needsReconfirm: item.needsReconfirm });
    const res: any = await postMessage(slack, text, blocks).catch((e) => ({ ok: false, error: String(e?.message ?? e).slice(0, 80) }));
    if (res?.ok) {
      ok++;
      await prisma.vacationAssignment.update({
        where: { id: a.id },
        data: item.kind === "REMIND" ? { lastRemindedAt: new Date(), notifyError: null } : { notifiedAt: new Date(), lastRemindedAt: new Date(), notifyError: null },
      });
    } else {
      const why = `슬랙 발송 실패: ${String(res?.error ?? "원인 모름").slice(0, 80)}`;
      failed.push(`${a.employeeName}(${why})`);
      await prisma.vacationAssignment.update({ where: { id: a.id }, data: { notifyError: why } });
    }
  }
  return { delivered: ok, failed };
}

/** 안내가 닿을 수 있는 사람인가 — 슬랙 미연동이거나 첫 안내부터 발송이 실패했으면 아니다 */
function reachable(a: { employee?: { slackUserId: string | null } | null; notifiedAt: Date | null; notifyError: string | null }) {
  return !!a.employee?.slackUserId && !(a.notifyError && !a.notifiedAt);
}

/** 미응답자에게 중립적인 확인 요청 — 제출한 사람(정상근무 선택 포함)에게는 보내지 않는다 */
export async function remindNonResponders(noticeId: number, actor: Actor) {
  const notice = await prisma.vacationNotice.findUnique({ where: { id: noticeId } });
  if (!notice || !["PUBLISHED", "CLOSED"].includes(notice.status)) throw new Error("게시 중인 공고가 아닙니다.");
  const list = await prisma.vacationAssignment.findMany({ where: { noticeId, removed: false }, include: { employee: true } });
  const targets = list.filter(
    (a) =>
      !!a.employee?.slackUserId &&
      remindable(
        assignmentState({
          removed: a.removed,
          slackLinked: reachable(a),
          firstOpenedAt: a.firstOpenedAt,
          draftSavedAt: a.draftSavedAt,
          hasSubmission: a.activeSubmissionId != null,
          needsReconfirm: a.needsReconfirm,
        })
      )
  );
  // 처음 안내가 닿지 않았던 사람에게는 확인 요청이 아니라 처음 안내를 보낸다
  const res = await deliverNotice(
    noticeId,
    targets.map((a) => ({ assignmentId: a.id, kind: (a.notifiedAt ? "REMIND" : "NEW") as NoticeDmKind, needsReconfirm: false }))
  );
  await event(prisma, { noticeId, type: "REMINDED", actor, detail: { count: res.delivered, failed: res.failed } });
  await logActivity({ action: "VACATION_REMIND", actor: "ADMIN", actorName: actor.name, summary: `방학 근무·연차 공고 미응답자 ${res.delivered}명에게 확인 요청을 보냈습니다.`, meta: { noticeId } });
  return res;
}

export async function setNoticeStatus(noticeId: number, status: "CLOSED" | "ARCHIVED" | "PUBLISHED", actor: Actor) {
  const n = await prisma.vacationNotice.findUnique({ where: { id: noticeId } });
  if (!n?.currentVersionId) throw new Error("게시한 공고가 아닙니다.");
  if (n.status === "ARCHIVED") throw new Error("보관된 공고입니다.");
  await prisma.vacationNotice.update({
    where: { id: noticeId },
    data: {
      status,
      ...(status === "CLOSED" ? { closedAt: new Date() } : {}),
      ...(status === "ARCHIVED" ? { archivedAt: new Date() } : {}),
    },
  });
  await event(prisma, { noticeId, type: status, actor });
  await logActivity({ action: `VACATION_${status}`, actor: "ADMIN", actorName: actor.name, summary: `방학 근무·연차 공고 상태를 ${status} 로 바꿨습니다.`, meta: { noticeId } });
}

/* ============================== 직원 쪽 ============================== */

export interface EmployeeView {
  assignment: any;
  notice: any;
  version: any;
  content: NoticeContent;
  head: NoticeHead;
  employee: any;
  condition: WorkCondition | null;
  infos: DateInfo[];
  balance: ChoiceBalance;
  basis: string;
  summary: any;
  ownByDate: Map<string, any>;
  ownStatus: Record<string, string>;
  active: any | null;
  /** 모달에 되살릴 선택 — 임시저장 > 이전 제출 */
  initialChoices: Choices;
}

/**
 * 슬랙 사용자가 **이 배정의 주인인지** 확인하고 화면 재료를 모은다.
 * 슬랙 사용자 id 는 요청 서명으로 확인된 값이다 — 클라이언트가 보낸 이름·id 를 믿지 않는다.
 */
export async function employeeView(assignmentId: number, slackUserId: string, client: any = prisma): Promise<EmployeeView> {
  const a = await client.vacationAssignment.findUnique({ where: { id: assignmentId }, include: { employee: true, notice: true } });
  if (!a || !a.employee || a.employee.slackUserId !== slackUserId) throw new ForbiddenError("본인에게 배정된 공고만 열 수 있습니다.");
  const notice = a.notice;
  const version = await client.vacationNoticeVersion.findUnique({ where: { id: notice.currentVersionId } });
  const content = parseContent(version.content);
  const emp = a.employee;
  const holidays = await holidaysMap();
  const { byEmp, dayOffs } = await existingFor(client, [emp.id], content.dates, holidays, a.id);
  const { summary, eligibility } = await leaveBalanceOf(emp);
  const pending = await pendingAnnualDays(emp.id, client);
  const cond = emp.department ? content.conditions[emp.department] ?? null : null;
  const infos = content.dates.map((date) =>
    dateInfo(date, {
      employee: emp,
      schedule: parseSchedule(emp.schedule),
      holidays,
      dayOffs: dayOffs.get(emp.id) ?? new Set(),
      existing: byEmp.get(emp.id) ?? [],
      unconfirmed: new Set(content.unconfirmed),
      conditionReady: conditionMissing(cond).length === 0,
      periodLastDay: periodLastDay(summary),
    })
  );
  const own = await client.leaveRequest.findMany({
    where: { vacationAssignmentId: a.id, status: { in: LIVE } },
    orderBy: { startDate: "asc" },
  });
  const ownByDate = new Map<string, any>(own.map((r: any) => [ymdOf(r.startDate), r]));
  const ownStatus = Object.fromEntries(own.map((r: any) => [ymdOf(r.startDate), LEAVE_STATUS_LABEL[r.status] ?? r.status]));
  const active = a.activeSubmissionId
    ? await client.vacationSubmission.findUnique({ where: { id: a.activeSubmissionId } })
    : null;
  let initial: Record<string, any> = {};
  if (a.draftVersionId === version.id) {
    try {
      initial = JSON.parse(a.draft || "{}");
    } catch {}
  } else if (active) {
    for (const c of JSON.parse(active.choices || "[]")) initial[c.date] = c.choice;
  }
  const p = summary.period;
  const basis =
    `입사일 기준 연차기간 ${ymd(p.start)} ~ ${ymd(p.end)} · 발생 ${p.granted}${p.carriedOver ? `(+이월 ${p.carriedOver})` : ""} · 사용 ${p.used}` +
    ` · ${kstLabel(new Date())} 산정`;
  return {
    assignment: a,
    notice,
    version,
    content,
    head: headOf(notice.id, version.version, content),
    employee: emp,
    condition: cond,
    infos,
    balance: {
      remaining: summary.remaining,
      pending,
      scheduled: p.scheduled ?? 0,
      ineligibleNote: summary.eligible
        ? null
        : `연차 미적용: ${ineligibleReason(eligibility)} 관리자가 따로 부여한 잔여 안에서만 연차를 신청할 수 있습니다.`,
    },
    basis,
    summary,
    ownByDate,
    ownStatus,
    active,
    initialChoices: sanitizeChoices(initial, infos),
  };
}

export class ForbiddenError extends Error {}

export async function markOpened(assignmentId: number) {
  const a = await prisma.vacationAssignment.findUnique({ where: { id: assignmentId } });
  if (!a) return;
  const now = new Date();
  await prisma.vacationAssignment.update({
    where: { id: assignmentId },
    data: { lastOpenedAt: now, ...(a.firstOpenedAt ? {} : { firstOpenedAt: now }) },
  });
  if (!a.firstOpenedAt)
    await event(prisma, { noticeId: a.noticeId, assignmentId, employeeId: a.employeeId, type: "OPENED", actor: { kind: "EMPLOYEE", name: a.employeeName } });
}

/** 임시저장 — 최종 제출과 따로 둔다. 미응답·임시저장은 어떤 선택으로도 처리되지 않는다 */
export async function saveChoiceDraft(assignmentId: number, slackUserId: string, versionId: number, raw: Record<string, string>) {
  const v = await employeeView(assignmentId, slackUserId);
  if (v.version.id !== versionId) return { versionChanged: true };
  const clean = sanitizeChoices(raw, v.infos);
  await prisma.vacationAssignment.update({
    where: { id: assignmentId },
    data: { draft: JSON.stringify(clean), draftVersionId: versionId, draftSavedAt: new Date() },
  });
  return { saved: clean };
}

/** 서명 화면이 보여 줄 잔여 계산 — 제출 때와 같은 식 */
export function balanceFor(v: EmployeeView, choices: Choices): { balance: BalanceCheck; added: string[]; removed: string[] } {
  const inVersion = new Set(v.content.dates);
  const prev = [...v.ownByDate.keys()].filter((d) => inVersion.has(d));
  const diff = diffLeave(prev, leaveDates(choices));
  const releasing = diff.removed.filter((d) => ["PENDING", "PRE_PENDING"].includes(v.ownByDate.get(d)?.status)).length;
  const infoOf = new Map(v.infos.map((i) => [i.date, i]));
  const adding = diff.added.reduce((a, d) => a + (infoOf.get(d)?.leaveDays ?? 1), 0);
  return {
    balance: checkBalance({ remaining: v.balance.remaining, pending: v.balance.pending, adding, releasing }),
    added: diff.added,
    removed: diff.removed,
  };
}

export type SubmitOutcome =
  | { status: "OK" | "DUPLICATE" | "UNCHANGED"; submission: any; dispatch?: Dispatch }
  | { status: "VERSION_CHANGED" }
  | { status: "MISSING"; dates: string[] }
  | { status: "NOT_SELECTABLE"; dates: { date: string; reason: string }[] }
  | { status: "SHORTAGE"; balance: BalanceCheck }
  | { status: "BALANCE_CHANGED"; balance: BalanceCheck }
  | { status: "NEEDS_SIGNATURE" }
  | { status: "SIGNATURE_INVALID"; reason: string }
  | { status: "FORBIDDEN"; reason: string };

export interface Dispatch {
  submissionId: number;
  employeeId: number;
  employeeName: string;
  department: string | null;
  slackUserId: string;
  docNo: string;
  kind: "LEAVE" | "WORK_ONLY";
  title: string;
  assignmentId: number;
  noticeId: number;
  addedRequestIds: number[];
  addedDates: string[];
  cancelRequestIds: number[];
  preApprover: { id: number; name: string; slackUserId: string | null } | null;
  balance: BalanceCheck;
  summaryLine: string;
}

/**
 * 최종 제출 — **직원 단위 잠금 안에서** 대상자·판·날짜 적격성·중복·잔여를 다시 검증하고
 * 제출 원문 + 날짜별 연차 신청을 한 트랜잭션으로 만든다. 같은 서명 화면의 재전송(idemKey)과
 * 같은 내용의 재제출은 새로 만들지 않는다.
 */
export async function submitChoices(args: {
  assignmentId: number;
  slackUserId: string;
  versionId: number;
  choices: Record<string, string>;
  idempotencyKey: string;
  signature?: { typedName: string; checks: string[] } | null;
  shown?: number[] | null;
}): Promise<SubmitOutcome> {
  const dup = await prisma.vacationSubmission.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
  if (dup) return { status: "DUPLICATE", submission: dup };

  const pre = await prisma.vacationAssignment.findUnique({ where: { id: args.assignmentId }, include: { employee: true, notice: true } });
  if (!pre || !pre.employee || pre.employee.slackUserId !== args.slackUserId)
    return { status: "FORBIDDEN", reason: "본인에게 배정된 공고만 제출할 수 있습니다." };
  if (pre.removed) return { status: "FORBIDDEN", reason: "이 공고의 대상에서 빠졌습니다. 담당자에게 문의해 주세요." };
  if (pre.notice.status === "ARCHIVED") return { status: "FORBIDDEN", reason: "보관된 공고라 더 제출할 수 없습니다. 연차는 평소 신청 경로로 낼 수 있습니다." };
  if (!["PUBLISHED", "CLOSED"].includes(pre.notice.status)) return { status: "FORBIDDEN", reason: "게시 중인 공고가 아닙니다." };

  const empId = pre.employee.id;
  try {
    return await withEmployeeLeaveLock(empId, async (tx) => {
      const again = await tx.vacationSubmission.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
      if (again) return { status: "DUPLICATE", submission: again } as SubmitOutcome;
      const v = await employeeView(args.assignmentId, args.slackUserId, tx);
      if (v.version.id !== args.versionId || v.assignment.versionId !== args.versionId) return { status: "VERSION_CHANGED" } as SubmitOutcome;

      const clean = sanitizeChoices(args.choices, v.infos);
      const lost = Object.keys(args.choices).filter((d) => (args.choices[d] === "WORK" || args.choices[d] === "LEAVE") && !clean[d]);
      if (lost.length)
        return {
          status: "NOT_SELECTABLE",
          dates: lost.map((d) => {
            const info = v.infos.find((i) => i.date === d);
            return { date: d, reason: (info && skipReason(info)) ?? "이 공고의 선택 대상 날짜가 아닙니다" };
          }),
        } as SubmitOutcome;
      const missing = unselectedDates(clean, v.infos);
      if (missing.length) return { status: "MISSING", dates: missing } as SubmitOutcome;

      const kind: "LEAVE" | "WORK_ONLY" = leaveDates(clean).length ? "LEAVE" : "WORK_ONLY";
      if (
        v.active &&
        v.active.versionId === v.version.id &&
        !v.assignment.needsReconfirm &&
        choicesKey(Object.fromEntries(JSON.parse(v.active.choices).map((c: any) => [c.date, c.choice]))) === choicesKey(clean)
      )
        return { status: "UNCHANGED", submission: v.active } as SubmitOutcome;

      if (kind === "LEAVE") {
        if (!args.signature) return { status: "NEEDS_SIGNATURE" } as SubmitOutcome;
        if (!CHECK_ITEMS.every((c) => args.signature!.checks.includes(c.value)))
          return { status: "SIGNATURE_INVALID", reason: "확인 항목 세 가지를 모두 직접 확인해 주세요." } as SubmitOutcome;
        if (!signatureNameMatches(args.signature.typedName, v.employee.name))
          return { status: "SIGNATURE_INVALID", reason: `성명을 정확히 입력해 주세요 (직원 정보의 성명과 같아야 합니다).` } as SubmitOutcome;
      }

      const { balance, added, removed } = balanceFor(v, clean);
      if (balance.shortage > 0) return { status: "SHORTAGE", balance } as SubmitOutcome;
      if (
        args.shown &&
        (args.shown[0] !== balance.remaining ||
          args.shown[1] !== balance.pending ||
          args.shown[2] !== balance.adding ||
          args.shown[3] !== balance.releasing)
      )
        return { status: "BALANCE_CHANGED", balance } as SubmitOutcome;

      const company = await getCompany();
      const seq = (await tx.vacationSubmission.count({ where: { assignmentId: v.assignment.id } })) + 1;
      const docNo = docNumber(v.notice.id, empId, seq);
      const now = new Date();
      const infoOf = new Map(v.infos.map((i) => [i.date, i]));
      const rows = v.content.dates
        .filter((d) => clean[d])
        .map((d) => ({
          date: d,
          label: infoOf.get(d)!.label,
          hours: infoOf.get(d)!.hours,
          choice: clean[d],
          days: clean[d] === "LEAVE" ? infoOf.get(d)!.leaveDays : 0,
        }));
      const skipped = v.infos
        .filter((i) => !isSelectable(i))
        .map((i) => ({ date: i.date, label: i.label, reason: skipReason(i) ?? "" }));
      const snapshot: SubmissionSnapshot = {
        kind,
        docNo,
        companyName: company.name,
        employee: { id: empId, name: v.employee.name, department: v.employee.department, empNo: v.employee.empNo },
        notice: {
          id: v.notice.id,
          title: v.content.title,
          version: v.version.version,
          classOffStart: v.content.classOffStart,
          classOffEnd: v.content.classOffEnd,
          deadline: v.content.deadline,
          contactName: v.content.contactName,
          body: NOTICE_BODY,
          extraNote: v.content.extraNote,
        },
        condition: v.condition,
        rows,
        skipped,
        leaveTotal: rows.reduce((a, r) => a + r.days, 0),
        balance: { ...balance, basis: v.basis, scheduled: v.balance.scheduled },
        statement: kind === "LEAVE" ? APPLICATION_STATEMENT : null,
        checks: kind === "LEAVE" ? CHECK_ITEMS.map((c) => ({ label: c.label, checked: true })) : null,
        signature:
          kind === "LEAVE"
            ? {
                method: "슬랙 본인 계정 인증 + 성명 직접 입력 + 확인 항목 체크 + 서명·제출 버튼",
                typedName: args.signature!.typedName,
                account: `슬랙 사용자 ${args.slackUserId}`,
              }
            : null,
        submittedAt: now.toISOString(),
        supersedesDocNo: v.active?.docNo ?? null,
        afterClose: v.notice.status === "CLOSED",
      };
      const docHtml = renderSubmissionHtml(snapshot);

      const sub = await tx.vacationSubmission.create({
        data: {
          assignmentId: v.assignment.id,
          noticeId: v.notice.id,
          versionId: v.version.id,
          versionNo: v.version.version,
          employeeId: empId,
          docNo,
          kind,
          choices: "[]",
          leaveDays: snapshot.leaveTotal,
          snapshot: JSON.stringify(snapshot),
          docHtml,
          contentHash: snapshotHash(snapshot),
          signMethod: kind === "LEAVE" ? "SLACK_TYPED_NAME" : null,
          signedName: kind === "LEAVE" ? args.signature!.typedName : null,
          submittedBy: args.slackUserId,
          submittedAt: now,
          idempotencyKey: args.idempotencyKey,
          supersedesId: v.active?.id ?? null,
        },
      });
      if (v.active)
        await tx.vacationSubmission.updateMany({ where: { id: v.active.id, status: "ACTIVE" }, data: { status: "SUPERSEDED", supersededAt: now } });

      const actor: Actor = { kind: "EMPLOYEE", name: v.employee.name };
      const reasonTag = `방학 근무·연차 선택 변경 (${docNo})`;
      const cancelRequestIds: number[] = [];
      for (const d of removed) {
        const r = v.ownByDate.get(d);
        if (!r) continue;
        if (r.status === "PENDING" || r.status === "PRE_PENDING") {
          const u = await tx.leaveRequest.updateMany({
            where: { id: r.id, status: { in: ["PENDING", "PRE_PENDING"] } },
            data: { status: "CANCELED", cancelReason: reasonTag, cancelRequestedAt: now, cancelDecidedAt: now },
          });
          if (u.count) await event(tx, { noticeId: v.notice.id, assignmentId: v.assignment.id, employeeId: empId, type: "LEAVE_WITHDRAWN", actor, detail: { requestId: r.id, date: d } });
        } else if (r.status === "APPROVED") {
          // 승인된 연차는 기존 취소 절차(운영진 승인 → 원장 복원 한 번)로 보낸다
          const u = await tx.leaveRequest.updateMany({
            where: { id: r.id, status: "APPROVED" },
            data: { status: "CANCEL_PENDING", cancelReason: reasonTag, cancelRequestedAt: now },
          });
          if (u.count) {
            cancelRequestIds.push(r.id);
            await event(tx, { noticeId: v.notice.id, assignmentId: v.assignment.id, employeeId: empId, type: "LEAVE_CANCEL_REQUESTED", actor, detail: { requestId: r.id, date: d } });
          }
        }
      }
      // 다시 연차로 되돌린 날 — 본인이 낸 취소 요청을 거둔다(원장은 그대로라 복원·차감이 없다)
      for (const d of leaveDates(clean)) {
        const r = v.ownByDate.get(d);
        if (r?.status === "CANCEL_PENDING") {
          const u = await tx.leaveRequest.updateMany({
            where: { id: r.id, status: "CANCEL_PENDING" },
            data: { status: "APPROVED", cancelReason: null, cancelRequestedAt: null },
          });
          if (u.count) await event(tx, { noticeId: v.notice.id, assignmentId: v.assignment.id, employeeId: empId, type: "CANCEL_REQUEST_WITHDRAWN", actor, detail: { requestId: r.id, date: d } });
        }
      }

      const dept = v.employee.department
        ? await tx.department.findUnique({
            where: { name: v.employee.department },
            include: { leaveApprover: { select: { id: true, name: true, active: true, slackUserId: true } } },
          })
        : null;
      const preApprover = preApproverFor(dept?.leaveApprover ?? null, empId);
      const addedIds: number[] = [];
      const reqByDate: Record<string, number> = {};
      for (const d of added) {
        const day = new Date(`${d}T00:00:00Z`);
        const r = await tx.leaveRequest.create({
          data: {
            employeeId: empId,
            startDate: day,
            endDate: day,
            days: infoOf.get(d)!.leaveDays,
            leaveType: "ANNUAL",
            reason: `방학 근무·연차 공고 선택 신청 (${docNo})`,
            status: preApprover ? "PRE_PENDING" : "PENDING",
            source: "VACATION",
            vacationAssignmentId: v.assignment.id,
            vacationSubmissionId: sub.id,
          },
        });
        addedIds.push(r.id);
        reqByDate[d] = r.id;
      }
      for (const d of leaveDates(clean)) if (!reqByDate[d] && v.ownByDate.get(d)) reqByDate[d] = v.ownByDate.get(d).id;
      await tx.vacationSubmission.update({
        where: { id: sub.id },
        data: { choices: JSON.stringify(rows.map((r) => ({ date: r.date, choice: r.choice, days: r.days, requestId: reqByDate[r.date] ?? null }))) },
      });
      await tx.vacationAssignment.update({
        where: { id: v.assignment.id },
        data: { activeSubmissionId: sub.id, needsReconfirm: false, draft: JSON.stringify(clean), draftVersionId: v.version.id, draftSavedAt: now },
      });
      await event(tx, {
        noticeId: v.notice.id,
        assignmentId: v.assignment.id,
        employeeId: empId,
        type: "SUBMITTED",
        actor,
        detail: { submissionId: sub.id, docNo, kind, leave: leaveDates(clean), added, removed, version: v.version.version },
      });

      const summaryLine =
        kind === "LEAVE"
          ? `연차 신청 ${leaveDates(clean).map(dayLabel).join(", ")} (${snapshot.leaveTotal}일)` +
            (added.length ? ` · 새로 신청 ${added.length}일` : "") +
            (removed.length ? ` · 철회·취소 요청 ${removed.length}일` : "")
          : `정상근무 ${rows.length}일${removed.length ? ` · 이전 연차 신청 ${removed.length}일 철회·취소 요청` : ""}`;
      return {
        status: "OK",
        submission: sub,
        dispatch: {
          submissionId: sub.id,
          employeeId: empId,
          employeeName: v.employee.name,
          department: v.employee.department,
          slackUserId: args.slackUserId,
          docNo,
          kind,
          title: v.content.title,
          assignmentId: v.assignment.id,
          noticeId: v.notice.id,
          addedRequestIds: addedIds,
          addedDates: added,
          cancelRequestIds,
          preApprover: preApprover ? { id: preApprover.id, name: preApprover.name, slackUserId: preApprover.slackUserId } : null,
          balance,
          summaryLine,
        },
      } as SubmitOutcome;
    });
  } catch (e: any) {
    // 두 요청이 같은 순간 들어와 유니크(idempotencyKey·docNo)에 걸린 경우 — 먼저 된 것을 돌려준다
    if (e?.code === "P2002") {
      const first = await prisma.vacationSubmission.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
      if (first) return { status: "DUPLICATE", submission: first };
    }
    if (e instanceof ForbiddenError) return { status: "FORBIDDEN", reason: e.message };
    throw e;
  }
}

/** 제출 뒤 알림 — 응답(3초)을 돌려준 뒤 부른다. 실패해도 제출은 그대로다 */
export async function dispatchAfterSubmit(d: Dispatch) {
  const { text, blocks } = receiptDmBlocks({
    kind: d.kind,
    docNo: d.docNo,
    title: d.title,
    submissionId: d.submissionId,
    assignmentId: d.assignmentId,
    summary: d.summaryLine,
  });
  await postMessage(d.slackUserId, text, blocks).catch(() => {});
  await logActivity({
    action: "VACATION_SUBMIT",
    actor: "SLACK",
    actorName: d.employeeName,
    employeeId: d.employeeId,
    target: d.employeeName,
    summary: `${d.employeeName}님이 방학 근무·연차 공고에 제출했습니다 (${d.kind === "LEAVE" ? "연차 신청 포함" : "정상근무"}, ${d.docNo}).`,
    meta: { submissionId: d.submissionId },
  });

  if (d.addedRequestIds.length) {
    let pre = d.preApprover;
    if (pre?.slackUserId) {
      const res: any = await postMessage(
        pre.slackUserId,
        `연차 중간결재 요청: ${d.employeeName} ${d.addedDates.length}일 (방학 근무·연차)`,
        groupApprovalBlocks({
          submissionId: d.submissionId,
          name: d.employeeName,
          dept: d.department ?? "",
          docNo: d.docNo,
          dates: d.addedDates,
          remaining: d.balance.remaining,
          after: d.balance.after,
          pre: true,
        })
      ).catch(() => null);
      if (res?.ok) {
        await prisma.leaveRequest.updateMany({ where: { id: { in: d.addedRequestIds } }, data: { slackChannel: res.channel, slackTs: res.ts } });
      } else {
        // 결재자에게 못 보냈으면 중간결재에 걸어 두지 않고 운영진 승인으로 바로 보낸다
        await prisma.leaveRequest.updateMany({ where: { id: { in: d.addedRequestIds }, status: "PRE_PENDING" }, data: { status: "PENDING" } });
        pre = null;
      }
    }
    if (!pre) await postGroupApprovalCard(d.submissionId, null);
  }

  for (const id of d.cancelRequestIds) {
    const r = await prisma.leaveRequest.findUnique({ where: { id } });
    const ch = process.env.SLACK_APPROVAL_CHANNEL;
    if (!r || !ch) continue;
    const posted: any = await postMessage(
      ch,
      `휴가 취소 신청: ${d.employeeName} ${ymd(r.startDate)}`,
      cancelApprovalBlocks({
        requestId: id,
        name: d.employeeName,
        dept: d.department ?? "",
        range: ymd(r.startDate),
        days: r.days,
        typeLabel: LEAVE_TYPE_LABEL[r.leaveType] ?? "연차",
        cancelReason: r.cancelReason ?? "방학 근무·연차 선택 변경",
      })
    ).catch(() => null);
    if (posted?.ok) await prisma.leaveRequest.update({ where: { id }, data: { slackChannel: posted.channel, slackTs: posted.ts } });
  }
}

/** 운영진 승인 채널 카드 (묶음) */
export async function postGroupApprovalCard(submissionId: number, preApprovedBy: string | null) {
  const channel = process.env.SLACK_APPROVAL_CHANNEL;
  const sub = await prisma.vacationSubmission.findUnique({ where: { id: submissionId }, include: { employee: true } });
  if (!sub || !channel) return false;
  const reqs = await prisma.leaveRequest.findMany({ where: { vacationSubmissionId: submissionId, status: "PENDING" }, orderBy: { startDate: "asc" } });
  if (!reqs.length) return false;
  const { summary } = await leaveBalanceOf(sub.employee as any);
  const pending = await pendingAnnualDays(sub.employeeId!);
  const res: any = await postMessage(
    channel,
    `연차 신청: ${sub.employee?.name} ${reqs.length}일 (방학 근무·연차)`,
    groupApprovalBlocks({
      submissionId,
      name: sub.employee?.name ?? "",
      dept: sub.employee?.department ?? "",
      docNo: sub.docNo,
      dates: reqs.map((r) => ymdOf(r.startDate)),
      remaining: summary.remaining,
      after: Math.round((summary.remaining - pending) * 100) / 100,
      preApprovedBy,
    })
  ).catch(() => null);
  if (res?.ok) {
    await prisma.leaveRequest.updateMany({ where: { id: { in: reqs.map((r) => r.id) } }, data: { slackChannel: res.channel, slackTs: res.ts } });
    return true;
  }
  return false;
}

/* ============================== 결재 (묶음) ============================== */

async function groupContext(submissionId: number) {
  const sub = await prisma.vacationSubmission.findUnique({ where: { id: submissionId }, include: { employee: true } });
  if (!sub) throw new Error("신청을 찾을 수 없습니다.");
  const reqs = await prisma.leaveRequest.findMany({ where: { vacationSubmissionId: submissionId }, orderBy: { startDate: "asc" } });
  return { sub, reqs };
}

/** 묶음 승인 — 신청 하나씩 기존 승인 함수로(상태 조건부라 두 번 눌러도 차감은 한 번) */
export async function approveGroup(submissionId: number, approver: string) {
  const { sub, reqs } = await groupContext(submissionId);
  const approved: string[] = [];
  const skipped: string[] = [];
  for (const r of reqs.filter((x) => x.status === "PENDING")) {
    try {
      await approveLeaveRequest(r.id, approver);
      approved.push(ymdOf(r.startDate));
    } catch {
      skipped.push(ymdOf(r.startDate));
    }
  }
  if (approved.length)
    await event(prisma, { noticeId: sub.noticeId, assignmentId: sub.assignmentId, employeeId: sub.employeeId, type: "LEAVE_APPROVED", actor: { kind: "SLACK_APPROVER", name: approver }, detail: { submissionId, dates: approved } });
  return { sub, approved, skipped };
}

export async function rejectGroup(submissionId: number, approver: string, reason: string, preOnly: boolean) {
  const { sub, reqs } = await groupContext(submissionId);
  const statuses = preOnly ? ["PRE_PENDING"] : ["PRE_PENDING", "PENDING"];
  const rejected: string[] = [];
  for (const r of reqs.filter((x) => statuses.includes(x.status))) {
    try {
      await rejectLeaveRequest(r.id, approver, reason);
      rejected.push(ymdOf(r.startDate));
    } catch {}
  }
  if (rejected.length)
    await event(prisma, { noticeId: sub.noticeId, assignmentId: sub.assignmentId, employeeId: sub.employeeId, type: "LEAVE_REJECTED", actor: { kind: "SLACK_APPROVER", name: approver }, note: reason, detail: { submissionId, dates: rejected, pre: preOnly } });
  return { sub, rejected };
}

export async function preApproveGroup(submissionId: number, approver: string, deciderName: string) {
  const { sub, reqs } = await groupContext(submissionId);
  const ids = reqs.filter((r) => r.status === "PRE_PENDING").map((r) => r.id);
  const upd = await prisma.leaveRequest.updateMany({
    where: { id: { in: ids }, status: "PRE_PENDING" },
    data: { status: "PENDING", preApproverId: approver, preDecidedAt: new Date() },
  });
  if (upd.count) {
    await event(prisma, { noticeId: sub.noticeId, assignmentId: sub.assignmentId, employeeId: sub.employeeId, type: "LEAVE_PRE_APPROVED", actor: { kind: "SLACK_APPROVER", name: deciderName }, detail: { submissionId, count: upd.count } });
    await postGroupApprovalCard(submissionId, deciderName);
  }
  return { sub, count: upd.count };
}

/* ============================== 문의 ============================== */

export async function createInquiry(assignmentId: number, slackUserId: string, message: string) {
  const a = await prisma.vacationAssignment.findUnique({ where: { id: assignmentId }, include: { employee: true, notice: true } });
  if (!a || a.employee?.slackUserId !== slackUserId) throw new ForbiddenError("본인에게 배정된 공고에만 문의할 수 있습니다.");
  const text = message.trim().slice(0, 1000);
  if (!text) throw new Error("내용을 적어 주세요.");
  const q = await prisma.vacationInquiry.create({
    data: { noticeId: a.noticeId, assignmentId, employeeId: a.employeeId, employeeName: a.employeeName, message: text },
  });
  await event(prisma, { noticeId: a.noticeId, assignmentId, employeeId: a.employeeId, type: "INQUIRY", actor: { kind: "EMPLOYEE", name: a.employeeName }, detail: { inquiryId: q.id } });
  // 문의 담당자에게 개인 DM — 공개 채널에 올리지 않는다
  const version = a.notice.currentVersionId ? await prisma.vacationNoticeVersion.findUnique({ where: { id: a.notice.currentVersionId } }) : null;
  const content = version ? parseContent(version.content) : null;
  if (content?.contactEmployeeId) {
    const contact = await prisma.employee.findUnique({ where: { id: content.contactEmployeeId } });
    if (contact?.slackUserId)
      await slackCall("chat.postMessage", {
        channel: contact.slackUserId,
        text: `📨 방학 근무·연차 안내 확인 요청 — ${a.employeeName}\n「${content.title}」\n${text}\n\nHR 프로그램 → 방학 근무·연차 에서 답변을 남길 수 있습니다.`,
      }).catch(() => {});
  }
  return q;
}

export async function answerInquiry(inquiryId: number, answer: string, actor: Actor) {
  const q = await prisma.vacationInquiry.findUnique({ where: { id: inquiryId } });
  if (!q) throw new Error("문의 없음");
  const text = answer.trim().slice(0, 1000);
  if (!text) throw new Error("답변을 적어 주세요.");
  await prisma.vacationInquiry.update({ where: { id: inquiryId }, data: { status: "ANSWERED", answer: text, answeredBy: actor.name, answeredAt: new Date() } });
  await event(prisma, { noticeId: q.noticeId, assignmentId: q.assignmentId, employeeId: q.employeeId, type: "INQUIRY_ANSWERED", actor, detail: { inquiryId } });
  const emp = q.employeeId ? await prisma.employee.findUnique({ where: { id: q.employeeId } }) : null;
  if (emp?.slackUserId)
    await slackCall("chat.postMessage", {
      channel: emp.slackUserId,
      text: `📨 안내 내용 확인 요청에 대한 답변입니다.\n> ${q.message.replace(/\n/g, "\n> ")}\n\n${text}`,
    }).catch(() => {});
}

/* ============================== 사실 확인 ============================== */

export async function recordReview(
  noticeId: number,
  input: { type: "REVIEW_RESOLVED" | "WORK_NOT_PROVIDED"; date: string; employeeId?: number | null; kind?: string; note: string },
  actor: Actor
) {
  if (!input.note?.trim()) throw new Error("확인 내용을 적어 주세요.");
  await event(prisma, {
    noticeId,
    employeeId: input.employeeId ?? null,
    type: input.type,
    actor,
    note: input.note.trim().slice(0, 500),
    detail: { date: input.date, kind: input.kind ?? null },
  });
}

/* ============================== 현황 ============================== */

export async function noticeDashboard(noticeId: number) {
  const notice = await prisma.vacationNotice.findUnique({ where: { id: noticeId } });
  if (!notice) throw new Error("공고 없음");
  const versions = await prisma.vacationNoticeVersion.findMany({ where: { noticeId }, orderBy: { version: "asc" } });
  const current = versions.find((v) => v.id === notice.currentVersionId) ?? null;
  const content = current ? parseContent(current.content) : parseContent(versions[versions.length - 1]?.content);
  const assignments = await prisma.vacationAssignment.findMany({ where: { noticeId }, include: { employee: true }, orderBy: [{ department: "asc" }, { employeeName: "asc" }] });
  const subs = await prisma.vacationSubmission.findMany({
    where: { noticeId },
    select: { id: true, assignmentId: true, docNo: true, kind: true, versionNo: true, submittedAt: true, status: true, choices: true, leaveDays: true, supersedesId: true },
    orderBy: { submittedAt: "asc" },
  });
  const reqs = await prisma.leaveRequest.findMany({ where: { vacationAssignmentId: { in: assignments.map((a) => a.id) } }, orderBy: { startDate: "asc" } });
  const inquiries = await prisma.vacationInquiry.findMany({ where: { noticeId }, orderBy: { createdAt: "desc" } });
  const events = await prisma.vacationEvent.findMany({ where: { noticeId }, orderBy: { createdAt: "desc" }, take: 300 });

  // 사후 대조 재료 — 연차일 근무 기록(시간기록표·보강/근무 신청)과 관리자가 남긴 '정상근무 제공 불가'
  const empIds = assignments.map((a) => a.employeeId).filter((x): x is number => x != null);
  const dates = content.dates;
  const lo = dates.length ? new Date(`${dates[0]}T00:00:00Z`) : new Date();
  const hi = dates.length ? new Date(`${dates[dates.length - 1]}T23:59:59Z`) : new Date();
  const sheets = empIds.length ? await prisma.timesheetDay.findMany({ where: { employeeId: { in: empIds }, date: { gte: lo, lte: hi }, hours: { gt: 0 } } }) : [];
  const makeups = empIds.length
    ? await prisma.makeupSession.findMany({ where: { employeeId: { in: empIds }, planStart: { gte: lo, lte: hi }, status: { notIn: ["CANCELED", "NOSHOW"] } } })
    : [];
  const notProvided = new Map<string, string>();
  const resolved = new Map<number | null, Set<string>>();
  for (const e of events) {
    const det = JSON.parse(e.detail || "{}");
    if (e.type === "WORK_NOT_PROVIDED") notProvided.set(det.date, e.note ?? "");
    if (e.type === "REVIEW_RESOLVED") {
      if (!resolved.has(e.employeeId)) resolved.set(e.employeeId, new Set());
      resolved.get(e.employeeId)!.add(`${det.kind}:${det.date}`);
    }
  }
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  const rows = assignments.map((a) => {
    const active = subs.find((s) => s.id === a.activeSubmissionId) ?? null;
    const choices: Record<string, { choice: string; requestId: number | null }> = {};
    if (active) for (const c of JSON.parse(active.choices || "[]")) choices[c.date] = { choice: c.choice, requestId: c.requestId };
    let draft: Record<string, string> = {};
    try {
      draft = JSON.parse(a.draft || "{}");
    } catch {}
    const myReqs = reqs.filter((r) => r.vacationAssignmentId === a.id);
    const reqByDate: Record<string, { id: number; status: string; label: string }> = {};
    for (const r of myReqs)
      if (["PRE_PENDING", "PENDING", "APPROVED", "CANCEL_PENDING"].includes(r.status) || !reqByDate[ymdOf(r.startDate)])
        reqByDate[ymdOf(r.startDate)] = { id: r.id, status: r.status, label: LEAVE_STATUS_LABEL[r.status] ?? r.status };
    const worked = new Map<string, string>();
    for (const t of sheets.filter((s) => s.employeeId === a.employeeId)) worked.set(ymdOf(t.date), `출퇴근 기록 ${t.hours}h`);
    for (const m of makeups.filter((s) => s.employeeId === a.employeeId)) worked.set(ymdOf(m.planStart), "보강·근무 신청 기록");
    const approvedLeave = myReqs.filter((r) => ["APPROVED", "CANCEL_PENDING"].includes(r.status)).map((r) => ymdOf(r.startDate));
    const workDates = Object.keys(choices).filter((d) => choices[d].choice === "WORK");
    const flags = reviewFlagsFor({
      leaveDates: approvedLeave,
      workedDates: worked,
      workNotProvided: notProvided,
      workDates,
      today,
      resolved: resolved.get(a.employeeId) ?? new Set(),
    });
    const outside = myReqs
      .filter((r) => ["PRE_PENDING", "PENDING", "APPROVED", "CANCEL_PENDING"].includes(r.status) && !dates.includes(ymdOf(r.startDate)))
      .map((r) => ymdOf(r.startDate));
    const state = assignmentState({
      removed: a.removed,
      slackLinked: reachable(a),
      firstOpenedAt: a.firstOpenedAt,
      draftSavedAt: a.draftSavedAt,
      hasSubmission: !!active,
      needsReconfirm: a.needsReconfirm,
    });
    return {
      assignmentId: a.id,
      employeeId: a.employeeId,
      name: a.employeeName,
      department: a.department,
      state,
      notifyError: a.notifyError,
      firstOpenedAt: a.firstOpenedAt?.toISOString() ?? null,
      draftSavedAt: a.draftSavedAt?.toISOString() ?? null,
      active: active ? { id: active.id, docNo: active.docNo, kind: active.kind, versionNo: active.versionNo, submittedAt: active.submittedAt.toISOString() } : null,
      history: subs
        .filter((s) => s.assignmentId === a.id)
        .map((s) => ({ id: s.id, docNo: s.docNo, kind: s.kind, versionNo: s.versionNo, status: s.status, submittedAt: s.submittedAt.toISOString(), leaveDays: s.leaveDays })),
      choices,
      draft,
      requests: reqByDate,
      flags,
      outsideLeave: outside,
      inquiries: inquiries.filter((q) => q.assignmentId === a.id).length,
    };
  });

  const live = rows.filter((r) => r.state !== "REMOVED");
  const byDate = dates.map((d) => ({
    date: d,
    label: dayLabel(d),
    work: live.filter((r) => r.choices[d]?.choice === "WORK").length,
    leave: live.filter((r) => r.choices[d]?.choice === "LEAVE").length,
    none: live.filter((r) => !r.choices[d]).length,
    notProvided: notProvided.get(d) ?? null,
  }));
  const counts: Record<string, number> = {};
  for (const r of live) counts[r.state] = (counts[r.state] ?? 0) + 1;

  return {
    notice: {
      id: notice.id,
      status: notice.status,
      createdAt: notice.createdAt.toISOString(),
      closedAt: notice.closedAt?.toISOString() ?? null,
      archivedAt: notice.archivedAt?.toISOString() ?? null,
    },
    content,
    current: current
      ? { id: current.id, version: current.version, publishedAt: current.publishedAt?.toISOString() ?? null, publishedBy: current.publishedBy, attestation: current.attestation ? JSON.parse(current.attestation) : null }
      : null,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      publishedBy: v.publishedBy,
      material: v.material,
      changeNote: v.changeNote,
      targets: JSON.parse(v.targets || "[]").length,
      excluded: JSON.parse(v.excluded || "[]"),
    })),
    rows,
    byDate,
    counts: { total: live.length, ...counts },
    inquiries: inquiries.map((q) => ({
      id: q.id,
      name: q.employeeName,
      message: q.message,
      status: q.status,
      answer: q.answer,
      answeredBy: q.answeredBy,
      createdAt: q.createdAt.toISOString(),
    })),
    events: events.map((e) => ({ id: e.id, type: e.type, actor: e.actor, actorName: e.actorName, note: e.note, detail: e.detail, createdAt: e.createdAt.toISOString(), employeeId: e.employeeId })),
  };
}

export async function listNotices() {
  const rows = await prisma.vacationNotice.findMany({ orderBy: { createdAt: "desc" }, include: { versions: { orderBy: { version: "desc" } } } });
  return rows.map((n) => {
    const cur = n.versions.find((v) => v.id === n.currentVersionId) ?? n.versions[0];
    const c = parseContent(cur?.content);
    return {
      id: n.id,
      status: n.status,
      title: c.title,
      version: cur?.version ?? 1,
      hasDraft: n.versions.some((v) => v.status === "DRAFT"),
      dates: c.dates.length,
      classOff: c.classOffStart ? `${c.classOffStart} ~ ${c.classOffEnd}` : "",
      createdAt: n.createdAt.toISOString(),
    };
  });
}

export async function draftContent(noticeId: number) {
  const d = await draftVersion(noticeId);
  return d ? { versionId: d.id, version: d.version, content: parseContent(d.content) } : null;
}

/* ============================== 문서(PDF) ============================== */

/**
 * 신청서 PDF — **저장된 제출 원문(docHtml)을 그대로** 렌더하고, 처리 이력은 원문과 구분된
 * 부록으로 뒤에 붙인다. 렌더가 실패해도 제출·차감에는 아무 영향이 없다(다시 누르면 된다).
 */
export async function submissionPdf(submissionId: number): Promise<{ pdf: Buffer; filename: string }> {
  const s = await prisma.vacationSubmission.findUnique({ where: { id: submissionId } });
  if (!s) throw new Error("문서 없음");
  const snap = JSON.parse(s.snapshot) as SubmissionSnapshot;
  const choices = JSON.parse(s.choices || "[]");
  const reqIds = choices.map((c: any) => c.requestId).filter(Boolean);
  const reqs = reqIds.length ? await prisma.leaveRequest.findMany({ where: { id: { in: reqIds } } }) : [];
  const later = await prisma.vacationSubmission.findFirst({ where: { supersedesId: s.id }, select: { docNo: true, submittedAt: true } });
  const esc = (x: any) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const appendix = `<div class="compact" style="margin-top:14px;border-top:2px dashed #999;padding-top:8px">
    <h3>부록 — 처리 이력 (원문과 별개, ${esc(kstLabel(new Date()))} 기준)</h3>
    <p class="small muted">위 원문은 제출 시점 그대로이며 고치지 않습니다. 아래는 그 뒤의 처리 상태입니다. 「접수」는 사용 확정이 아니고, 「승인」은 연차 원장에 차감이 반영된 상태입니다.</p>
    <p class="small">문서 상태: ${s.status === "ACTIVE" ? "현재 유효한 제출" : `변경됨 — 뒤 제출 ${esc(later?.docNo ?? "")}${later ? ` (${esc(kstLabel(later.submittedAt))})` : ""}`}</p>
    ${
      reqs.length
        ? `<table class="grid"><thead><tr><th>날짜</th><th>연차 처리 상태</th><th>처리 시각</th><th>비고</th></tr></thead><tbody>${reqs
            .map(
              (r) =>
                `<tr><td>${esc(ymd(r.startDate))}</td><td>${esc(LEAVE_STATUS_LABEL[r.status] ?? r.status)}</td><td>${esc(
                  (r.cancelDecidedAt ?? r.decidedAt) ? kstLabel((r.cancelDecidedAt ?? r.decidedAt)!) : "-"
                )}</td><td>${esc(r.decidedNote ?? r.cancelReason ?? "")}</td></tr>`
            )
            .join("")}</tbody></table>`
        : `<p class="small">연결된 연차 신청이 없습니다.</p>`
    }
    <p class="small muted">무결성 점검값(SHA-256): ${esc(s.contentHash)} — 원문이 제출 이후 바뀌지 않았는지 점검하는 용도이며 법적 효력을 보증하지 않습니다.</p>
  </div>`;
  const pdf = await htmlToPdf(s.docHtml + appendix);
  const name = snap.kind === "LEAVE" ? "연차유급휴가신청서" : "근무선택확인내역";
  return { pdf, filename: `${name}_${snap.employee.name}_${s.docNo}.pdf` };
}

export function pdfHeaders(filename: string, disposition: "inline" | "attachment" = "inline"): HeadersInit {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

/* ============================== 서명 화면 재료 ============================== */

export async function signPreview(v: EmployeeView, clean: Choices) {
  const company = await getCompany();
  const { balance } = balanceFor(v, clean);
  const infoOf = new Map(v.infos.map((i) => [i.date, i]));
  const rows = v.content.dates
    .filter((d) => clean[d])
    .map((d) => ({ label: infoOf.get(d)!.label, hours: infoOf.get(d)!.hours, choice: clean[d], days: clean[d] === "LEAVE" ? infoOf.get(d)!.leaveDays : 0 }));
  return {
    balance,
    preview: {
      companyName: company.name,
      employeeName: v.employee.name,
      department: v.employee.department,
      head: v.head,
      condition: v.condition,
      rows,
      balance,
      basis: v.basis,
      supersedesDocNo: v.active?.docNo ?? null,
    },
  };
}

/** 제출 결과 화면에 쓸 줄 */
export function resultRows(sub: any): { label: string; choice: string; days: number }[] {
  return JSON.parse(sub.choices || "[]").map((c: any) => ({ label: dayLabel(c.date), choice: c.choice, days: c.days }));
}
