// 급여명세서 / 사업소득명세서 / 각종 증명서 템플릿

import { won, wonUnit, ymd, ymdKo } from "./format";
import { INCOME_TYPE_LABEL } from "./constants";
import type { DocCompany, DocEmployee } from "./documents";

export interface DocPayroll {
  year: number;
  month: number;
  incomeType: string;
  payScheme?: string;
  workedHours?: number | null;
  extraHours?: number;
  overtimeHours?: number;
  nightHours?: number;
  holidayHours?: number;
  baseP: number;
  extraP: number;
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
  retentionD: number;
  parkingD: number;
  expenseD: number;
  otherD: number;
  totalDeduct: number;
  net: number;
  hourlyWage: number;
  prorationRatio?: number;
}

function esc(s: any): string {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function head(c: DocCompany, extra = ""): string {
  return `<div class="company-head">
    <div><div class="cname">${esc(c.name)}</div>
      <div class="cmeta">대표 ${esc(c.ceo)} · 사업자등록번호 ${esc(c.bizNo)}<br/>${esc(c.address)} · ${esc(c.phone)}</div></div>
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
      ["추가근로수당", p.extraP],
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

  const commonDed: [string, number][] = [
    ["퇴직유보금(별도통장)", p.retentionD],
    ["주차비 공제", p.parkingD],
    ["실비 정산", p.expenseD],
    ["기타공제", p.otherD],
  ];
  const dedRows: [string, number][] = (
    isFree
      ? ([
          ["소득세(3%)", p.incomeTaxD],
          ["지방소득세(0.3%)", p.localTaxD],
          ...commonDed,
        ] as [string, number][])
      : ([
          ["국민연금", p.pensionD],
          ["건강보험", p.healthD],
          ["장기요양보험", p.longTermD],
          ["고용보험", p.employmentD],
          ["근로소득세", p.incomeTaxD],
          ["지방소득세", p.localTaxD],
          ...commonDed,
        ] as [string, number][])
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

  // 시급제: 총 근로시간 = 기본(실입력 또는 기본급÷시급 역산) + 추가 + 연장 + 휴일
  //         야간은 타 시간과 중복되는 '가산'이므로 합계에 미포함(참고 표기만)
  const isHourly = p.payScheme === "HOURLY";
  let hoursRow = "";
  if (isHourly) {
    // 소수 시간 → "39시간 30분" 표기 (분은 반올림, 60분 올림 처리)
    const hm = (n: number) => {
      let h = Math.floor(n);
      let m = Math.round((n - h) * 60);
      if (m === 60) {
        h += 1;
        m = 0;
      }
      return m > 0 ? `${h.toLocaleString("ko-KR")}시간 ${m}분` : `${h.toLocaleString("ko-KR")}시간`;
    };
    const baseHours =
      p.workedHours != null && p.workedHours > 0
        ? p.workedHours
        : p.hourlyWage > 0
        ? p.baseP / p.hourlyWage
        : 0;
    const exH = p.extraHours ?? 0;
    const otH = p.overtimeHours ?? 0;
    const holH = p.holidayHours ?? 0;
    const nightH = p.nightHours ?? 0;
    const total = baseHours + exH + otH + holH;
    const parts = [
      `기본 ${hm(baseHours)}`,
      exH ? `추가 ${hm(exH)}` : "",
      otH ? `연장 ${hm(otH)}` : "",
      holH ? `휴일 ${hm(holH)}` : "",
      nightH ? `야간 ${hm(nightH)}(가산)` : "",
    ].filter(Boolean);
    hoursRow = `<tr><th>총 근로시간</th><td colspan="3"><b>${hm(total)}</b> <span class="muted">( ${parts.join(" · ")} )</span></td></tr>`;
  }

  return `${head(c, `<div class="small">지급일: ${ymdKo(payDate)}</div><div class="badge">${esc(INCOME_TYPE_LABEL[p.incomeType] ?? "")}</div>`)}
  <div class="doc-title" style="letter-spacing:0.2em">${esc(title)}</div>
  <p style="text-align:center" class="muted">${p.year}년 ${p.month}월분</p>
  <table class="kv">
    <tr><th>성명</th><td>${esc(e.name)}</td><th>소속</th><td>${esc(e.department ?? "")}</td></tr>
    <tr><th>직책</th><td>${esc(e.position ?? "")}</td><th>입사일자</th><td>${ymd(e.hireDate)}</td></tr>
    <tr><th>${isHourly ? "시급" : "통상시급"}</th><td>${wonUnit(p.hourlyWage)}</td><th>구분</th><td>${esc(INCOME_TYPE_LABEL[p.incomeType] ?? "")}</td></tr>
    ${hoursRow}
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
    ${isHourly ? `<div class="small">· 기본급 = 기본 근로시간 × 시급</div>` : ""}
    <div class="small">· 추가근로수당(법내연장) = 추가근로시간 × 통상시급 &nbsp; · 연장근로수당(법정초과) = 연장근로시간 × 통상시급 × 1.5</div>
    <div class="small">· 휴일근로수당 = 휴일근로시간 × 통상시급 × 1.5 &nbsp; · 야간근로수당 = 야간근로시간 × 통상시급 × 0.5</div>
    ${isFree
      ? `<div class="small">· 사업소득 원천징수: 지급총액의 3.3%(소득세 3% + 지방소득세 0.3%) 공제</div>`
      : `<div class="small">· 4대보험 및 근로소득세는 관계법령·간이세액표(또는 세무대리인 산정액)에 따릅니다.</div>`}
    ${p.retentionD ? `<div class="small">· 퇴직유보금: 인센티브 원천액의 8.3%로, 확인서에 따라 별도 통장으로 송금·적립됩니다.</div>` : ""}
    ${p.prorationRatio != null && p.prorationRatio < 1 ? `<div class="small">· 월중 입·퇴사로 일할계산이 적용되었습니다 (재직비율 ${(p.prorationRatio * 100).toFixed(1)}%).</div>` : ""}
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
  <p style="text-align:center;margin:30px 0;font-size:12pt">위 사람은 상기와 같이 <b>${esc(c.name)}</b>에 재직하고 있음을 증명합니다.</p>
  <div class="doc-foot" style="align-items:center;text-align:center">
    <div class="date-center">${ymdKo(issue)}</div>
    <div style="margin-top:18px;font-size:13pt">
      <div style="font-weight:800;font-size:16pt;letter-spacing:0.02em">${esc(c.name)}</div>
      <div style="margin-top:6px">대표이사 ${esc(c.ceo)} <span class="seal">(직인)</span></div>
      <div class="small" style="margin-top:3px">${esc(c.address)} · ${esc(c.phone)}</div>
    </div>
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
  <p style="text-align:center;margin:26px 0 6px;font-size:12pt">위 사람은 상기와 같이 근무하였음을 증명합니다.</p>
  <p class="small" style="text-align:center">용도: ${esc(args.purpose ?? "제출용")}</p>
  <div class="doc-foot" style="align-items:center;text-align:center">
    <div class="date-center">${ymdKo(issue)}</div>
    <div style="margin-top:18px;font-size:13pt">
      <div style="font-weight:800;font-size:16pt;letter-spacing:0.02em">${esc(c.name)}</div>
      <div style="margin-top:6px">대표이사 ${esc(c.ceo)} <span class="seal">(직인)</span></div>
    </div>
  </div>`;
}
