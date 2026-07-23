// 급여명세서 / 사업소득명세서 / 각종 증명서 템플릿

import { won, wonUnit, ymd, ymdKo } from "./format";
import { INCOME_TYPE_LABEL } from "./constants";
import type { DocCompany, DocEmployee } from "./documents";

export interface DocPayroll {
  year: number;
  month: number;
  incomeType: string;
  baseP: number;
  overtimeP: number;
  nightP: number;
  holidayP: number;
  weeklyHolidayP: number;
  positionP: number;
  mealP: number;
  carP: number;
  incentiveP: number;
  bonusP: number;
  unusedLeaveP: number;
  gross: number;
  pensionD: number;
  employmentD: number;
  healthD: number;
  longTermD: number;
  incomeTaxD: number;
  localTaxD: number;
  otherD: number;
  totalDeduct: number;
  net: number;
  hourlyWage: number;
}

function esc(s: any): string {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function head(c: DocCompany, extra = ""): string {
  return `<div class="company-head">
    <div><div class="cname">${esc(c.name)}</div>
      <div class="small">대표 ${esc(c.ceo)} · 사업자등록번호 ${esc(c.bizNo)}</div>
      <div class="small">${esc(c.address)} · ${esc(c.phone)}</div></div>
    <div style="text-align:right">${extra}</div>
  </div>`;
}

/* ============================ 급여명세서 / 사업소득명세서 ============================ */
export function payslipHtml(args: {
  employee: DocEmployee;
  payroll: DocPayroll;
  company: DocCompany;
  payDate?: Date;
}): string {
  const { employee: e, payroll: p, company: c } = args;
  const isFree = p.incomeType === "FREELANCE";
  const title = isFree ? "사업소득 지급명세서" : "임금명세서";
  const payDate = args.payDate ?? new Date();

  const payRows = (
    [
      ["기본급", p.baseP],
      ["연장근로수당", p.overtimeP],
      ["야간근로수당", p.nightP],
      ["휴일근로수당", p.holidayP],
      ["주휴수당", p.weeklyHolidayP],
      ["직책수당", p.positionP],
      ["식대(비과세)", p.mealP],
      ["차량유지비(비과세)", p.carP],
      ["인센티브", p.incentiveP],
      ["상여금", p.bonusP],
      ["연차미사용수당", p.unusedLeaveP],
    ] as [string, number][]
  ).filter(([, v]) => v && v !== 0);

  const dedRows: [string, number][] = isFree
    ? [
        ["소득세(3%)", p.incomeTaxD],
        ["지방소득세(0.3%)", p.localTaxD],
      ]
    : (
        [
          ["국민연금", p.pensionD],
          ["건강보험", p.healthD],
          ["장기요양보험", p.longTermD],
          ["고용보험", p.employmentD],
          ["근로소득세", p.incomeTaxD],
          ["지방소득세", p.localTaxD],
          ["기타공제", p.otherD],
        ] as [string, number][]
      ).filter(([, v]) => v && v !== 0);

  const maxRows = Math.max(payRows.length, dedRows.length);
  let bodyRows = "";
  for (let i = 0; i < maxRows; i++) {
    const pr = payRows[i];
    const dr = dedRows[i];
    bodyRows += `<tr>
      <td>${pr ? esc(pr[0]) : ""}</td><td class="num">${pr ? won(pr[1]) : ""}</td>
      <td>${dr ? esc(dr[0]) : ""}</td><td class="num">${dr ? won(dr[1]) : ""}</td></tr>`;
  }

  return `${head(c, `<div class="small">지급일: ${ymdKo(payDate)}</div><div class="badge">${esc(INCOME_TYPE_LABEL[p.incomeType] ?? "")}</div>`)}
  <div class="doc-title" style="letter-spacing:0.2em">${esc(title)}</div>
  <p style="text-align:center" class="muted">${p.year}년 ${p.month}월분</p>
  <table class="kv">
    <tr><th>성명</th><td>${esc(e.name)}</td><th>소속</th><td>${esc(e.department ?? "")}</td></tr>
    <tr><th>직책</th><td>${esc(e.position ?? "")}</td><th>입사일자</th><td>${ymd(e.hireDate)}</td></tr>
    <tr><th>통상시급</th><td>${wonUnit(p.hourlyWage)}</td><th>구분</th><td>${esc(INCOME_TYPE_LABEL[p.incomeType] ?? "")}</td></tr>
  </table>
  <table class="pay">
    <thead><tr><th colspan="2">지 급</th><th colspan="2">공 제</th></tr>
    <tr><th>임금 항목</th><th>지급 금액</th><th>공제 항목</th><th>공제 금액</th></tr></thead>
    <tbody>${bodyRows}
      <tr class="total"><td>지급액 계</td><td class="num">${won(p.gross)}</td><td>공제액 계</td><td class="num">${won(p.totalDeduct)}</td></tr>
      <tr class="total"><td colspan="3" style="text-align:right">실수령액</td><td class="num">${won(p.net)}</td></tr>
    </tbody>
  </table>
  <div class="clause" style="margin-top:10px">
    <div class="small">· 연장근로수당 = 연장근로시간 × 통상시급 × 1.5 &nbsp; · 야간근로수당 = 야간근로시간 × 통상시급 × 0.5</div>
    ${isFree
      ? `<div class="small">· 사업소득 원천징수: 지급총액의 3.3%(소득세 3% + 지방소득세 0.3%) 공제</div>`
      : `<div class="small">· 4대보험 및 근로소득세는 관계법령 및 간이세액표에 따라 산정되었습니다.</div>`}
    <div class="small">· 본 명세서는 근로기준법 제48조에 따라 교부되며, 문의사항은 관리부서로 연락바랍니다.</div>
  </div>`;
}

/* ============================ 재직증명서 ============================ */
export function certEmploymentHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  purpose?: string;
  serial?: string;
  issueDate?: Date;
}): string {
  const { employee: e, company: c } = args;
  const issue = args.issueDate ?? new Date();
  return `${head(c, `<div class="small">발급번호: ${esc(args.serial ?? "-")}</div>`)}
  <div class="doc-title" style="letter-spacing:0.3em">재 직 증 명 서</div>
  <table class="kv" style="margin-top:20px">
    <tr><th>성명</th><td>${esc(e.name)}</td><th>생년월일</th><td>${esc(e.birth ?? "-")}</td></tr>
    <tr><th>소속</th><td>${esc(e.department ?? "-")}</td><th>직책</th><td>${esc(e.position ?? "-")}</td></tr>
    <tr><th>담당업무</th><td colspan="3">${esc(e.duty ?? "-")}</td></tr>
    <tr><th>입사일자</th><td>${ymd(e.hireDate)}</td><th>재직상태</th><td>${e.resignDate ? "퇴직(" + ymd(e.resignDate) + ")" : "재직중"}</td></tr>
    <tr><th>주소</th><td colspan="3">${esc(e.address ?? "-")}</td></tr>
    <tr><th>용도</th><td colspan="3">${esc(args.purpose ?? "제출용")}</td></tr>
  </table>
  <p style="text-align:center;margin:26px 0;font-size:12pt">위 사람은 상기와 같이 <b>${esc(c.name)}</b>에 재직하고 있음을 증명합니다.</p>
  <div class="date-center">${ymdKo(issue)}</div>
  <div style="text-align:center;margin-top:16px;font-size:13pt">
    <div style="font-weight:800;font-size:15pt">${esc(c.name)}</div>
    <div style="margin-top:4px">대표이사 ${esc(c.ceo)} <span class="seal">(직인)</span></div>
    <div class="small" style="margin-top:2px">${esc(c.address)} · ${esc(c.phone)}</div>
  </div>`;
}

/* ============================ 경력증명서 ============================ */
export function certCareerHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  careers?: { period: string; department: string; position: string; duty: string }[];
  purpose?: string;
  serial?: string;
  issueDate?: Date;
}): string {
  const { employee: e, company: c } = args;
  const issue = args.issueDate ?? new Date();
  const careers =
    args.careers ??
    [
      {
        period: `${ymd(e.hireDate)} ~ ${e.resignDate ? ymd(e.resignDate) : "현재"}`,
        department: e.department ?? "-",
        position: e.position ?? "-",
        duty: e.duty ?? "-",
      },
    ];
  return `${head(c, `<div class="small">발급번호: ${esc(args.serial ?? "-")}</div>`)}
  <div class="doc-title" style="letter-spacing:0.3em">경 력 증 명 서</div>
  <table class="kv" style="margin-top:16px">
    <tr><th>성명</th><td>${esc(e.name)}</td><th>생년월일</th><td>${esc(e.birth ?? "-")}</td></tr>
    <tr><th>주소</th><td colspan="3">${esc(e.address ?? "-")}</td></tr>
  </table>
  <table class="pay" style="margin-top:10px">
    <thead><tr><th>근무기간</th><th>소속</th><th>직책</th><th>담당업무</th></tr></thead>
    <tbody>${careers
      .map(
        (c2) =>
          `<tr><td>${esc(c2.period)}</td><td>${esc(c2.department)}</td><td>${esc(c2.position)}</td><td>${esc(c2.duty)}</td></tr>`
      )
      .join("")}</tbody>
  </table>
  <p style="text-align:center;margin:22px 0;font-size:12pt">위 사람은 상기와 같이 근무하였음을 증명합니다.</p>
  <p class="small" style="text-align:center">용도: ${esc(args.purpose ?? "제출용")}</p>
  <div class="date-center">${ymdKo(issue)}</div>
  <div style="text-align:center;margin-top:16px;font-size:13pt">
    <div style="font-weight:800;font-size:15pt">${esc(c.name)}</div>
    <div style="margin-top:4px">대표이사 ${esc(c.ceo)} <span class="seal">(직인)</span></div>
  </div>`;
}
