import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  parseRosterWorkbook,
  rostersForMonth,
  summarizeIncentive,
  summarizeRevenueShare,
  isRevenueRoster,
  studentWeight,
  type ParsedRosterBlock,
} from "@/lib/incentive";
import { matchEmployee } from "@/lib/timesheet";
import { runPayrollMonth } from "@/lib/payroll-service";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 강사 한 명의 처리 결과 — 화면이 줄줄이 보여준다 */
interface TeacherResult {
  teacherName: string;
  sheetName: string;
  employeeId: number | null;
  name: string | null;
  payScheme: string | null;
  ok: boolean;
  error?: string;
  /** REVENUE(매출 기준) | HEADCOUNT(인원 기준) */
  kind: "REVENUE" | "HEADCOUNT";
  totalCount: number;
  // 매출 기준
  revenue?: number;
  sheetPercent?: number | null;
  contractPercent?: number | null;
  // 인원 기준
  threshold?: number;
  perStudent?: number;
  units?: number;
  over?: number;
  /** 시트가 스스로 적어 둔 인센티브 합계 (대조용) */
  sheetAmount?: number | null;
  /** 산정 금액 (사업소득 또는 인센티브) */
  amount: number;
  /** 시트가 스스로 낸 합계와 어긋나면 남긴다 */
  warnings: string[];
}

/**
 * 학생 명단(엑셀) 업로드 → 그 달 명단 저장 → 해당 강사 급여 재계산.
 *
 * 관리시트는 **탭 하나가 강사 한 명**이고 그 안에서 달이 오른쪽으로 이어 붙는다.
 * 여러 달이 한 파일에 들어 있으므로 대상 월은 **화면에서 고른 연·월**로 정한다
 * (파일에서 자동 감지할 수 없다 — 어느 달이든 다 들어 있다).
 *
 * formData: file(xlsx), year, month
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart form 필요" }, { status: 400 });
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file 이 필요합니다" }, { status: 400 });

  const now = new Date();
  const year = Number(form.get("year")) || now.getFullYear();
  const month = Number(form.get("month")) || now.getMonth() + 1;

  let blocks: ParsedRosterBlock[];
  try {
    blocks = parseRosterWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e: any) {
    return NextResponse.json({ error: "엑셀 파싱 실패: " + e.message }, { status: 400 });
  }
  if (!blocks.length) {
    return NextResponse.json(
      {
        error:
          "명단에서 학생 표를 찾지 못했습니다. 상단에 '○○년 ○월' 제목과 열 제목(이름/반/입학일/퇴원일)이 있는 양식인지 확인하세요.",
      },
      { status: 400 }
    );
  }

  const target = rostersForMonth(blocks, year, month);
  if (!target.length) {
    const months = [...new Set(blocks.map((b) => `${b.year}년 ${b.month}월`))];
    return NextResponse.json(
      {
        error: `파일에 ${year}년 ${month}월 명단이 없습니다. 들어 있는 달: ${months.join(", ")}`,
        availableMonths: months,
      },
      { status: 400 }
    );
  }

  const employees = await prisma.employee.findMany();
  const results: TeacherResult[] = [];
  const touched: number[] = [];

  for (const b of target) {
    const base = {
      teacherName: b.teacherName,
      sheetName: b.sheetName,
      kind: (isRevenueRoster(b.students) ? "REVENUE" : "HEADCOUNT") as "REVENUE" | "HEADCOUNT",
      totalCount: b.students.length,
      warnings: [] as string[],
    };

    const matched = matchEmployee(b.teacherName, employees);
    const emp = matched.emp;
    if (!emp) {
      results.push({
        ...base,
        employeeId: null,
        name: null,
        payScheme: null,
        ok: false,
        amount: 0,
        error: matched.ambiguous?.length
          ? `이름이 겹치는 직원이 여러 명입니다: ${matched.ambiguous.map((e) => e.name).join(", ")}`
          : "직원 카드를 찾지 못했습니다.",
      });
      continue;
    }

    // 대상 계약구조는 완전비율제(사업소득)와 월급+인센티브 둘뿐이다.
    if (emp.payScheme !== "INCENTIVE" && emp.payScheme !== "RATIO") {
      results.push({
        ...base,
        employeeId: emp.id,
        name: emp.name,
        payScheme: emp.payScheme,
        ok: false,
        amount: 0,
        error: `급여형태가 '월급+인센티브' 또는 '완전비율제'가 아닙니다 — 명단 산정 대상이 아닙니다.`,
      });
      continue;
    }

    const isRatio = emp.payScheme === "RATIO";
    const revenueRoster = base.kind === "REVENUE";
    const warnings = base.warnings;

    // 명단 교체 (해당 강사·월)
    await prisma.$transaction([
      prisma.incentiveStudent.deleteMany({ where: { employeeId: emp.id, year, month } }),
      prisma.incentiveStudent.createMany({
        data: b.students.map((s) => ({
          employeeId: emp.id,
          year,
          month,
          seq: s.seq ?? null,
          status: s.status,
          name: s.name,
          className: s.className ?? null,
          school: s.school ?? null,
          enrollDate: s.enrollDate ?? null,
          withdrawDate: s.withdrawDate ?? null,
          sessions: s.sessions ?? null,
          fullSessions: s.fullSessions ?? 8,
          weight: studentWeight(s),
          revenue: s.revenue ?? null,
          sharePercent: s.sharePercent ?? null,
        })),
      }),
    ]);
    touched.push(emp.id);

    let amount = 0;
    const row: TeacherResult = {
      ...base,
      employeeId: emp.id,
      name: emp.name,
      payScheme: emp.payScheme,
      ok: true,
      amount: 0,
    };

    if (revenueRoster) {
      // 배분율은 계약이 진실 — 명단에 적힌 율은 대조만 한다
      const contractPercent = (isRatio ? emp.ratioPercent : emp.incRevenuePercent) ?? null;
      const s = summarizeRevenueShare(b.students, { percent: contractPercent ?? 0 });
      amount = s.amount;
      row.revenue = s.revenue;
      row.sheetPercent = b.sharePercent ?? null;
      row.contractPercent = contractPercent;

      if (contractPercent == null || contractPercent <= 0) {
        warnings.push(
          isRatio
            ? "계약에 비율(%)이 없어 사업소득이 0원으로 잡힙니다 — 계약 이력에서 비율을 넣어주세요."
            : "계약에 매출 배분율이 없어 인센티브가 0원으로 잡힙니다 — 계약 이력에서 '매출 비율 인센티브'를 넣어주세요."
        );
      } else if (b.sharePercent != null && Math.abs(b.sharePercent - contractPercent) > 0.0001) {
        warnings.push(
          `명단의 배분율(${(b.sharePercent * 100).toFixed(1)}%)과 계약(${(contractPercent * 100).toFixed(1)}%)이 다릅니다 — 계약 기준으로 산정했습니다.`
        );
      }
      if (b.sheetTotalRevenue != null && b.sheetTotalRevenue !== s.revenue) {
        warnings.push(
          `시트 합계(${b.sheetTotalRevenue.toLocaleString()}원)와 읽어들인 매출 합계(${s.revenue.toLocaleString()}원)가 다릅니다 — 읽지 못한 행이 있는지 확인하세요.`
        );
      }
    } else {
      if (isRatio) {
        warnings.push(
          "완전비율제인데 명단에 수강료 매출 열이 없습니다 — 사업소득을 산정할 수 없어 명단만 저장했습니다."
        );
      }
      const s = summarizeIncentive(b.students, {
        threshold: emp.incThreshold ?? 0,
        perStudent: emp.incPerStudent ?? 0,
      });
      amount = s.amount;
      row.threshold = s.threshold;
      row.perStudent = s.perStudent;
      row.units = s.units;
      row.over = s.over;
      row.sheetAmount = b.sheetTotalAmount ?? null;

      // 시트가 스스로 낸 금액과 다르면 반드시 알린다.
      // 갈리는 지점은 **기준 인원을 무엇으로 채우느냐** 하나뿐이다 —
      // 시트는 명단 왼쪽 칸에 이름이 기준 인원수만큼 있으면 채운 것으로 보고,
      // 시스템은 재원계수 합에서 기준 인원을 뺀다(계약서 제3조 문언대로).
      // 왼쪽 칸에 중도 입·전입 학생이 섞여 계수가 기준에 못 미치면 그만큼 차이가 난다.
      // 조용히 지나가면 시트보다 적게 지급되므로, 차액을 짚어 사람이 판단하게 한다.
      if (b.sheetTotalAmount != null && b.sheetTotalAmount !== s.amount) {
        const diff = b.sheetTotalAmount - s.amount;
        const shortfall = Math.max(s.threshold - s.units, 0);
        warnings.push(
          `시트에 적힌 인센티브(${b.sheetTotalAmount.toLocaleString()}원)와 시스템 산정액(${s.amount.toLocaleString()}원)이 ` +
            `${diff > 0 ? "" : "−"}${Math.abs(diff).toLocaleString()}원 다릅니다.` +
            (shortfall > 0
              ? ` 명단 전체의 가중 인원(${s.units.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}명)이 ` +
                `기준 인원(${s.threshold}명)에 ${shortfall.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}명 못 미쳐 그만큼 차감됐습니다 ` +
                `— 중도 입학·전입 학생이 기준 인원 안에 섞여 있을 때 생깁니다.`
              : "") +
            ` 시트 금액으로 맞추려면 급여 화면의 '인센티브' 칸에 차액을 직접 넣으세요.`
        );
      }
      if (b.monthlyPay != null && emp.baseWage && b.monthlyPay !== emp.baseWage) {
        warnings.push(
          `파일의 월급여(${b.monthlyPay.toLocaleString()}원)와 직원 카드 기본급(${emp.baseWage.toLocaleString()}원)이 다릅니다.`
        );
      }
    }

    row.amount = amount;
    results.push(row);
  }

  // 반영된 강사만 급여 재계산 (확정·발송된 기록은 서비스에서 보호)
  if (touched.length) await runPayrollMonth(year, month, {}, touched);

  const okCount = results.filter((r) => r.ok).length;
  await logActivity({
    action: "PAYROLL_INCENTIVE",
    summary: `${year}년 ${month}월 학생 명단 반영 — 강사 ${okCount}명${
      results.length > okCount ? ` (실패 ${results.length - okCount}명)` : ""
    }`,
    meta: results.map((r) => ({
      teacher: r.teacherName,
      kind: r.kind,
      ok: r.ok,
      amount: r.amount,
      error: r.error ?? null,
      warnings: r.warnings,
    })),
  });

  return NextResponse.json({
    ok: true,
    year,
    month,
    results,
    okCount,
    failCount: results.length - okCount,
  });
}

/** 명단 조회 (강사·월) */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const employeeId = Number(searchParams.get("employeeId"));
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!employeeId || !year || !month)
    return NextResponse.json({ error: "employeeId/year/month 필요" }, { status: 400 });
  const rows = await prisma.incentiveStudent.findMany({
    where: { employeeId, year, month },
    orderBy: [{ seq: "asc" }, { id: "asc" }],
  });
  return NextResponse.json(rows);
}
