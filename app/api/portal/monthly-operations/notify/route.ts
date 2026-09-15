import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { postMonthlyOperationCompletion } from "@/lib/monthly-operation-slack";
import { authenticatedPortalStaff } from "@/lib/portal-staff-request";
import { slackConfigured } from "@/lib/slack";

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(req: Request) {
  const auth = await authenticatedPortalStaff(req, "hr:monthly-operations");
  if (!auth) return noStoreJson({ error: "직원 권한을 확인할 수 없습니다." }, 401);
  if (
    !auth.employee.department ||
    !["교육운영팀", "경영지원"].includes(auth.employee.department)
  )
    return noStoreJson({ error: "교육운영 월간업무 권한이 없습니다." }, 403);
  if (!slackConfigured())
    return noStoreJson({ error: "HR Manager의 Slack 봇 설정을 확인해 주세요." }, 503);

  const size = Number(req.headers.get("content-length") || 0);
  if (size > 8_192) return noStoreJson({ error: "입력 내용이 너무 깁니다." }, 413);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return noStoreJson({ error: "입력 내용을 확인해 주세요." }, 400);

  const notificationId = text(body.notificationId, 80);
  const cycle = text(body.cycle, 7);
  const taskTitle = text(body.taskTitle, 160);
  const completedByEmpNo = text(body.completedByEmpNo, 80);
  const assigneeEmpNos = Array.isArray(body.assigneeEmpNos)
    ? [
        ...new Set(
          body.assigneeEmpNos.flatMap((value) =>
            typeof value === "string" && value.trim() && value.length <= 80
              ? [value.trim()]
              : [],
          ),
        ),
      ].slice(0, 10)
    : [];
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      notificationId,
    ) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle) ||
    !taskTitle ||
    !completedByEmpNo
  )
    return noStoreJson({ error: "완료 알림 내용을 확인해 주세요." }, 400);
  if (completedByEmpNo !== auth.employee.empNo)
    return noStoreJson({ error: "완료 처리 계정이 로그인 계정과 다릅니다." }, 403);

  const employees = assigneeEmpNos.length
    ? await prisma.employee.findMany({
        where: {
          empNo: { in: assigneeEmpNos },
          active: true,
          department: "교육운영팀",
        },
      })
    : [];
  const employeeByEmpNo = new Map(employees.map((employee) => [employee.empNo, employee]));
  const assignees = assigneeEmpNos.flatMap((empNo) => {
    const employee = employeeByEmpNo.get(empNo);
    return employee ? [employee] : [];
  });

  try {
    const result = await postMonthlyOperationCompletion({
      notificationId,
      cycle,
      taskTitle,
      completedBy: auth.employee,
      assignees,
    });
    if (!result.ok)
      return noStoreJson(
        { error: `Slack 알림을 보내지 못했습니다 (${result.error || "unknown"}).` },
        502,
      );
    return noStoreJson({ delivered: true });
  } catch (cause) {
    return noStoreJson(
      {
        error:
          cause instanceof Error ? cause.message : "Slack 알림을 보내지 못했습니다.",
      },
      502,
    );
  }
}
