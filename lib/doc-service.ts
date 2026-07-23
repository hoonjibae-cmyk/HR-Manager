import { prisma } from "./db";
import { htmlToPdf, htmlPagesToPdf } from "./pdf";
import {
  newHirePackageBodies,
  contractHtml,
  pledgeServiceHtml,
  consentPrivacyHtml,
  consentDeductionHtml,
} from "./documents";
import {
  payslipHtml,
  certEmploymentHtml,
  certCareerHtml,
  type DocPayroll,
} from "./documents-pay";
import { getCompany, empToDoc, contractToDoc } from "./repo";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const STORAGE = join(process.cwd(), "storage");

async function save(buf: Buffer, name: string): Promise<string> {
  if (!existsSync(STORAGE)) await mkdir(STORAGE, { recursive: true });
  const rel = `${Date.now()}_${name}`.replace(/[^\w.\-가-힣]/g, "_");
  await writeFile(join(STORAGE, rel), buf);
  return rel;
}

async function record(
  employeeId: number | null,
  type: string,
  title: string,
  filePath: string,
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
  const pdf = await htmlToPdf(
    contractHtml({
      employee: empToDoc(ct.employee),
      contract: contractToDoc(ct),
      company,
    })
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
  const payroll: DocPayroll = pr as any;
  const pdf = await htmlToPdf(
    payslipHtml({ employee: empToDoc(pr.employee), payroll, company })
  );
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
