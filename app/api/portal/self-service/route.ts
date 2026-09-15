import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import {
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  MAKEUP_CATEGORY_LABEL,
  MAKEUP_STATUS_LABEL,
} from "@/lib/constants";
import { leaveBalanceOf, submitLeaveRequest } from "@/lib/leave-slack";
import {
  confirmMakeupActuals,
  createMakeupSession,
  holidayYmds,
  syncMakeupCalendar,
} from "@/lib/makeup-service";
import { makeupDateLabel, parseMakeupInput } from "@/lib/makeup-slack";
import { isPremiumDay } from "@/lib/overtime";
import { authenticatedPortalStaff } from "@/lib/portal-staff-request";

export const dynamic = "force-dynamic";

const leaveKinds = new Set(["ANNUAL", "HALF", "COMP", "SICK", "SPECIAL"]);
const makeupKinds = new Set(["IMMEDIATE", "MANDATORY", "ABSENCE", "OTHER"]);

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function ymdDate(value: unknown) {
  const input = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const date = new Date(`${input}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input
    ? null
    : date;
}

function dateValue(date: Date | null | undefined) {
  return date ? date.toISOString() : null;
}

export async function GET(req: Request) {
  const auth = await authenticatedPortalStaff(req, "hr:self-service");
  if (!auth) return noStoreJson({ error: "직원 권한을 확인할 수 없습니다." }, { status: 401 });
  const { employee } = auth;
  const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const [{ summary, comp, eligibility }, leaveRequests, makeupRequests] = await Promise.all([
    leaveBalanceOf(employee),
    prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.makeupSession.findMany({
      where: { employeeId: employee.id, planStart: { gte: from } },
      orderBy: { planStart: "desc" },
      take: 12,
    }),
  ]);

  return noStoreJson({
    staff: {
      name: employee.name,
      department: employee.department,
      position: employee.position,
    },
    leave: {
      eligible: eligibility.eligible,
      weeklyHours: eligibility.weeklyHours,
      period: {
        start: dateValue(summary.period.start),
        end: dateValue(summary.period.end),
        label: summary.period.label,
        granted: summary.period.granted + summary.period.carriedOver,
        used: summary.period.used,
        remaining: summary.remaining,
        scheduled: summary.period.scheduled,
      },
      comp: {
        granted: comp.granted,
        used: comp.used,
        remaining: comp.remaining,
      },
      requests: leaveRequests.map((row) => ({
        id: row.id,
        start: dateValue(row.startDate),
        end: dateValue(row.endDate),
        days: row.days,
        type: row.leaveType,
        typeLabel: LEAVE_TYPE_LABEL[row.leaveType] || row.leaveType,
        status: row.status,
        statusLabel: LEAVE_STATUS_LABEL[row.status] || row.status,
        reason: row.reason,
        createdAt: dateValue(row.createdAt),
      })),
    },
    makeups: makeupRequests.map((row) => ({
      id: row.id,
      start: dateValue(row.planStart),
      end: dateValue(row.planEnd),
      dateLabel: makeupDateLabel(row.planStart, row.planEnd),
      category: row.category,
      categoryLabel: MAKEUP_CATEGORY_LABEL[row.category] || row.category,
      status: row.status,
      statusLabel: MAKEUP_STATUS_LABEL[row.status] || row.status,
      targetClass: row.targetClass,
      createdAt: dateValue(row.createdAt),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await authenticatedPortalStaff(req, "hr:self-service");
  if (!auth) return noStoreJson({ error: "직원 권한을 확인할 수 없습니다." }, { status: 401 });
  const { employee, claims } = auth;
  const size = Number(req.headers.get("content-length") || 0);
  if (size > 32_768) return noStoreJson({ error: "입력 내용이 너무 깁니다." }, { status: 413 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return noStoreJson({ error: "입력 내용을 확인해 주세요." }, { status: 400 });

  if (body.action === "leave") {
    const leaveType = text(body.leaveType, 20);
    const start = ymdDate(body.start);
    const endInput = text(body.end, 10);
    const end = endInput ? ymdDate(endInput) : start;
    if (!leaveKinds.has(leaveType))
      return noStoreJson({ error: "휴가 종류를 확인해 주세요." }, { status: 400 });
    if (!start || !end)
      return noStoreJson({ error: "휴가 시작일과 종료일을 확인해 주세요." }, { status: 400 });
    const result = await submitLeaveRequest(employee, {
      leaveType,
      start,
      end,
      reason: text(body.reason, 300) || "개인사유",
      halfTimeNote: leaveType === "HALF" ? text(body.halfTimeNote, 80) : "",
      workPlan: text(body.workPlan, 500),
      source: "PORTAL",
    });
    if (!result.ok)
      return noStoreJson({ error: result.error || "휴가 신청을 처리하지 못했습니다." }, { status: 400 });
    if (!result.duplicate && result.notify)
      waitUntil(result.notify().catch((error) => console.error("포털 휴가 알림 실패:", error)));
    if (!result.duplicate)
      await logActivity({
        action: "LEAVE_REQUEST",
        actor: "PORTAL",
        actorName: employee.name,
        employeeId: employee.id,
        target: employee.name,
        summary: `${employee.name}님이 포털에서 ${LEAVE_TYPE_LABEL[leaveType] || leaveType} ${result.days}일을 신청했습니다.`,
        meta: { requestId: result.requestId, slackUserId: claims.slackUserId },
      });
    return noStoreJson({
      ok: true,
      duplicate: Boolean(result.duplicate),
      message: result.duplicate
        ? "같은 기간의 신청이 이미 접수되어 있습니다."
        : `${LEAVE_TYPE_LABEL[leaveType] || "휴가"} ${result.days}일 신청이 접수되었습니다.`,
    });
  }

  if (body.action === "makeup") {
    const mode = body.mode === "work" ? "work" : "makeup";
    const parsed = parseMakeupInput({
      startDate: text(body.startDate, 10) || null,
      startTime: text(body.startTime, 5) || null,
      endDate: text(body.endDate, 10) || null,
      endTime: text(body.endTime, 5) || null,
      category: text(body.category, 20),
      targetClass: text(body.targetClass, 120),
      headcount:
        body.headcount === "" || body.headcount == null ? null : Number(body.headcount),
      detail: text(body.detail, 500),
      note: text(body.note, 500),
    });
    if (!parsed.ok)
      return noStoreJson({ error: parsed.error || "근무 시간을 확인해 주세요." }, { status: 400 });
    if (mode === "makeup" && !makeupKinds.has(text(body.category, 20)))
      return noStoreJson({ error: "보강 종류를 확인해 주세요." }, { status: 400 });
    const headcount =
      body.headcount === "" || body.headcount == null ? null : Number(body.headcount);
    if (headcount !== null && (!Number.isInteger(headcount) || headcount < 0 || headcount > 500))
      return noStoreJson({ error: "예상 인원은 0~500명 사이로 입력해 주세요." }, { status: 400 });

    let category = text(body.category, 20);
    if (mode === "work") {
      const holidays = await holidayYmds();
      category = isPremiumDay(parsed.start!.toISOString().slice(0, 10), holidays)
        ? "WEEKEND"
        : "OVERTIME";
    }
    const { row, duplicate } = await createMakeupSession(
      {
        employeeId: employee.id,
        planStart: parsed.start!,
        planEnd: parsed.end!,
        category,
        targetClass: text(body.targetClass, 120),
        headcount: mode === "makeup" ? headcount : null,
        detail: text(body.detail, 500),
        note: text(body.note, 500),
        source: "PORTAL",
        slackUserId: claims.slackUserId,
      },
      { sync: false },
    );
    if (duplicate)
      return noStoreJson(
        { error: `같은 시간대의 신청이 이미 있습니다 (${makeupDateLabel(row.planStart, row.planEnd)}).` },
        { status: 409 },
      );

    waitUntil(syncMakeupCalendar(row.id).catch(() => null));
    let confirmedNow = false;
    if (mode === "work") {
      const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
      if (parsed.end! <= kstNow) {
        try {
          await confirmMakeupActuals(row.id, {
            actualStart: parsed.start!,
            actualEnd: parsed.end!,
            by: "EMPLOYEE",
            postHoc: true,
            now: kstNow,
          });
          confirmedNow = true;
        } catch {
          // 마감이 지났거나 수당 대상이 아니면 신청 상태로 남겨 관리자가 확인한다.
        }
      }
    }
    await logActivity({
      action: "MAKEUP_CREATE",
      actor: "PORTAL",
      actorName: employee.name,
      employeeId: employee.id,
      target: employee.name,
      summary: `${employee.name}님이 포털에서 ${MAKEUP_CATEGORY_LABEL[category] || category}을 등록했습니다 — ${makeupDateLabel(parsed.start!, parsed.end!)}.`,
      meta: { makeupId: row.id, category, confirmedNow, slackUserId: claims.slackUserId },
    });
    return noStoreJson({
      ok: true,
      message: `${MAKEUP_CATEGORY_LABEL[category] || "근무"} 신청이 등록되었습니다.`,
    });
  }

  return noStoreJson({ error: "지원하지 않는 요청입니다." }, { status: 400 });
}
