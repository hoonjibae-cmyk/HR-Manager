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
  rosterDetailHtml,
  overtimeDetailHtml,
  certEmploymentHtml,
  certCareerHtml,
  type DocPayroll,
} from "./documents-pay";
import { getCompany, empToDoc, contractToDoc } from "./repo";
import { docPolicyFor, documentBlockReason } from "./departments";
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

/**
 * 신규입사 패키지 — 계약서 세트 + 서약서·동의서 일체.
 *
 * 어떤 서약서가 들어가는지는 **부서**가 정한다(복무서약서-II·프로필 홍보 동의서·건강서약서,
 * 보안서약서의 경업금지 조항). 그래서 부서가 비어 있거나 등록되지 않은 이름이면
 * **발급을 막는다** — 기본값을 지어내면 조교에게 강사용 서약서가 나가거나 그 반대가 된다.
 */
export async function genNewHirePackage(employeeId: number, contractId?: number) {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { contracts: { orderBy: { startDate: "desc" } } },
  });
  if (!emp) throw new Error("직원 없음");
  const blocked = await documentBlockReason(emp);
  if (blocked) throw new Error(blocked);
  const deptPolicy = await docPolicyFor(emp.department);
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
        incRevenuePercent: emp.incRevenuePercent,
        isContractor: emp.isContractor,
      };
  const bodies = newHirePackageBodies({ employee: empToDoc(emp), contract, company, deptPolicy });
  // 각 장 이니셜란 + 쪽번호는 패키지에도 붙인다 — 계약서가 2장을 넘어가는데 세트로 뽑으면
  // 서명란이 사라져 그 장들이 진정성립 추정(민사소송법 §358)을 못 받는 문제가 있었다.
  // 여백에 그리므로 쪽 나눔은 그대로다. 12종이 한 묶음이라 쪽번호도 실제로 쓸모가 있다.
  //
  // **간인(seamStamp)은 붙이지 않는다** — 간인은 장 경계가 이어졌다는 표시인데,
  // 서로 다른 문서가 맞닿는 자리에 찍으면 '이 두 문서가 한 건' 이라는 뜻이 되어 버린다.
  // (계약서 단독 발급 `genContract` 에서는 본문+별지가 한 건의 계약이라 그대로 찍는다.)
  const pdf = await htmlPagesToPdf(bodies, {
    initials: company.pageInitials,
    paginate: true,
  });
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

  // 월급+인센티브·완전비율제: 그 달 학생 명단이 있으면 산정 내역서를 뒤에 붙인다.
  //  · 명단에 매출 열이 있으면 「사업소득/인센티브 산정 내역서」(매출 × 배분율)
  //  · 없으면 「인센티브 산정 내역서」(가중 인원 − 기준 인원)
  // 명단이 없는 달은 **첨부 없이 명세서만** 나간다 — 자동산정을 안 쓰고 금액을 직접 넣는
  // 달에는 붙일 근거가 없다. 그런 달에 내역서를 붙이려면 관리시트를 올리면 된다.
  if (pr.employee.payScheme === "INCENTIVE" || pr.employee.payScheme === "RATIO") {
    const roster = await incentiveRosterFor(pr.employeeId, pr.year, pr.month);
    if (roster?.length) {
      const isRatio = pr.employee.payScheme === "RATIO";
      const detail = rosterDetailHtml({
        employee,
        company,
        year: pr.year,
        month: pr.month,
        students: rosterToStudents(roster),
        kind: isRatio ? "BUSINESS" : "INCENTIVE",
        // 배분율은 계약이 진실이다 — 명단에 적힌 율은 대조용으로만 넘긴다
        percent: isRatio ? pr.employee.ratioPercent : pr.employee.incRevenuePercent,
        sheetPercent: roster.find((r) => r.sharePercent != null)?.sharePercent ?? null,
        threshold: pr.employee.incThreshold ?? 0,
        perStudent: pr.employee.incPerStudent ?? 0,
        // 완전비율제는 기본급이 곧 사업소득이라 '월급여' 로 겹쳐 적지 않는다
        monthlyPay: isRatio ? null : pr.baseP,
        retention: pr.retentionD,
      });
      if (detail) pages.push(detail);
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
