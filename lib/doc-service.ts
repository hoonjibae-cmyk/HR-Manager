import { prisma } from "./db";
import { htmlToPdf, htmlPagesToPdf } from "./pdf";
import {
  newHirePackageBodies,
  contractBodies,
  pledgeServiceHtml,
  consentPrivacyHtml,
  consentDeductionHtml,
} from "./documents";
import {
  payslipHtml,
  incentiveDetailHtml,
  overtimeDetailHtml,
  certEmploymentHtml,
  certCareerHtml,
  type DocPayroll,
} from "./documents-pay";
import { getCompany, empToDoc, contractToDoc } from "./repo";
import { MAKEUP_CATEGORY_LABEL } from "./constants";
import { incentiveRosterFor, rosterToStudents } from "./payroll-service";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const STORAGE = join(process.cwd(), "storage");
const onServerless =
  !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// PDF 디스크 저장 (best-effort). 서버리스(읽기전용 FS)에서는 생략 — PDF는
// 메모리 버퍼로 다운로드/이메일 첨부되므로 영구 저장이 필수는 아니다.
async function save(buf: Buffer, name: string): Promise<string | null> {
  if (onServerless) return null;
  try {
    if (!existsSync(STORAGE)) await mkdir(STORAGE, { recursive: true });
    const rel = `${Date.now()}_${name}`.replace(/[^\w.\-가-힣]/g, "_");
    await writeFile(join(STORAGE, rel), buf);
    return rel;
  } catch {
    return null;
  }
}

async function record(
  employeeId: number | null,
  type: string,
  title: string,
  filePath: string | null,
  meta: any = {}
) {
  await prisma.document.create({
    data: { employeeId, type, title, filePath, meta: JSON.stringify(meta) },
  });
}

/** 신규입사 패키지 (계약서 + 복무서약서 + 개인정보동의서 + 임금공제동의서) */
export async function genNewHirePackage(employeeId: number, contractId?: number) {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { contracts: { orderBy: { startDate: "desc" } } },
  });
  if (!emp) throw new Error("직원 없음");
  const company = await getCompany();
  const ct = contractId
    ? emp.contracts.find((c) => c.id === contractId)
    : emp.contracts[0];
  const contract = ct
    ? contractToDoc(ct)
    : {
        stage: "SHORT_TERM_1",
        templateKey: emp.payScheme,
        startDate: emp.hireDate,
        endDate: null,
        isProbation: true,
        probationMonths: 2,
        baseWage: emp.baseWage,
        positionAllow: emp.positionAllow,
        mealAllow: emp.mealAllow,
        carAllow: emp.carAllow,
        ratioPercent: emp.ratioPercent,
        incThreshold: emp.incThreshold,
        incPerStudent: emp.incPerStudent,
      };
  const bodies = newHirePackageBodies({ employee: empToDoc(emp), contract, company });
  const pdf = await htmlPagesToPdf(bodies);
  const path = await save(pdf, `신규입사패키지_${emp.name}.pdf`);
  await record(emp.id, "NEWHIRE_PKG", `신규입사 패키지 - ${emp.name}`, path);
  return { pdf, filename: `신규입사패키지_${emp.name}.pdf` };
}

/** 계약서 단독 (재계약 포함) */
export async function genContract(contractId: number) {
  const ct = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { employee: true },
  });
  if (!ct) throw new Error("계약 없음");
  const company = await getCompany();
  // 인센티브 계약은 별지 「인센티브 산정 계약서」가 함께 붙는다
  // 계약서는 본문+별지가 한 건의 계약이라 장 경계에 간인을 찍고 쪽번호를 단다.
  // 신규입사 패키지는 서로 다른 문서 4종의 묶음이라 문서 경계를 넘는 간인은 뜻이 달라져 붙이지 않는다.
  const pdf = await htmlPagesToPdf(
    contractBodies({
      employee: empToDoc(ct.employee),
      contract: contractToDoc(ct),
      company,
    }),
    {
      seamStamp: company.stampSeam ? company.stamp : null,
      initials: company.pageInitials,
      paginate: true,
    }
  );
  const path = await save(pdf, `근로계약서_${ct.employee.name}.pdf`);
  await record(ct.employeeId, "CONTRACT", `계약서 - ${ct.employee.name}`, path, {
    contractId,
  });
  return { pdf, filename: `근로계약서_${ct.employee.name}.pdf` };
}

/** 급여명세서 */
export async function genPayslip(payrollId: number) {
  const pr = await prisma.payrollRecord.findUnique({
    where: { id: payrollId },
    include: { employee: true },
  });
  if (!pr) throw new Error("급여기록 없음");
  const company = await getCompany();
  const payroll: DocPayroll = { ...(pr as any), parkingFee: (pr.employee as any).parkingFee ?? 0 };
  const employee = empToDoc(pr.employee);
  const pages = [payslipHtml({ employee, payroll, company })];

  // 인센티브 강사: 학생 명단이 있으면 '인센티브 산정 내역서'를 첨부
  if (pr.employee.payScheme === "INCENTIVE") {
    const roster = await incentiveRosterFor(pr.employeeId, pr.year, pr.month);
    if (roster?.length) {
      pages.push(
        incentiveDetailHtml({
          employee,
          company,
          year: pr.year,
          month: pr.month,
          students: rosterToStudents(roster),
          threshold: pr.employee.incThreshold ?? 0,
          perStudent: pr.employee.incPerStudent ?? 0,
          monthlyPay: pr.baseP,
          retention: pr.retentionD,
        })
      );
    }
  }
  // 보강 오버타임이 잡힌 달이면 '보강 오버타임 산정 내역서' 를 첨부
  try {
    const bd = pr.breakdown ? JSON.parse(pr.breakdown) : null;
    if (bd?.overtime?.lines?.length) {
      pages.push(
        overtimeDetailHtml({
          employee,
          company,
          year: pr.year,
          month: pr.month,
          hourlyWage: pr.hourlyWage,
          lines: bd.overtime.lines,
          excluded: bd.overtime.excluded ?? [],
          categoryLabel: MAKEUP_CATEGORY_LABEL,
        })
      );
    }
  } catch {}

  const pdf = pages.length > 1 ? await htmlPagesToPdf(pages) : await htmlToPdf(pages[0]);
  const path = await save(pdf, `급여명세서_${pr.employee.name}_${pr.year}-${pr.month}.pdf`);
  await record(pr.employeeId, "PAYSLIP", `급여명세서 ${pr.year}.${pr.month} - ${pr.employee.name}`, path, {
    payrollId,
  });
  await prisma.payrollRecord.update({ where: { id: payrollId }, data: { pdfPath: path } });
  return { pdf, filename: `급여명세서_${pr.employee.name}_${pr.year}-${pr.month}.pdf` };
}

/** 증명서 (재직/경력) */
export async function genCertificate(
  employeeId: number,
  type: "CERT_EMPLOYMENT" | "CERT_CAREER",
  opts: { purpose?: string } = {}
) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new Error("직원 없음");
  const company = await getCompany();
  const serial = `${new Date().getFullYear()}-${String(emp.id).padStart(4, "0")}`;
  const html =
    type === "CERT_EMPLOYMENT"
      ? certEmploymentHtml({ employee: empToDoc(emp), company, purpose: opts.purpose, serial })
      : certCareerHtml({ employee: empToDoc(emp), company, purpose: opts.purpose, serial });
  const pdf = await htmlToPdf(html);
  const label = type === "CERT_EMPLOYMENT" ? "재직증명서" : "경력증명서";
  const path = await save(pdf, `${label}_${emp.name}.pdf`);
  await record(emp.id, type, `${label} - ${emp.name}`, path, opts);
  return { pdf, filename: `${label}_${emp.name}.pdf` };
}

export function pdfResponse(pdf: Buffer, filename: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
