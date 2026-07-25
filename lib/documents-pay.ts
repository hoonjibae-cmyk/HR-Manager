// 급여명세서 / 사업소득명세서 / 각종 증명서 템플릿

import { won, wonUnit, ymd, ymdKo } from "./format";
import { INCOME_TYPE_LABEL } from "./constants";
import type { DocCompany, DocEmployee } from "./documents";
import {
  summarizeIncentive,
  STUDENT_STATUS_LABEL,
  type RosterStudent,
} from "./incentive";

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
  otherItems?: string | null; // 기타공제 세부 항목 JSON [{name, amount}]
  totalDeduct: number;
  net: number;
  hourlyWage: number;
  prorationRatio?: number;
  weeklyHolidayHours?: number | null; // 시급제 주휴시간(월 합계, 시간기록표 기반)
  breakdown?: string | null; // 산출 근거 JSON {notes, baseApplied, blend}
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

  // 기타공제: 세부 항목이 있으면 이름별로, 없으면 합계 한 줄로 표시
  let otherDedRows: [string, number][] = p.otherD ? [["기타공제", p.otherD]] : [];
  try {
    const arr = p.otherItems ? JSON.parse(p.otherItems) : null;
    if (Array.isArray(arr) && arr.length) {
      otherDedRows = arr.map(
        (it: any) =>
          [String(it?.name || "기타공제"), Math.round(Number(it?.amount) || 0)] as [string, number]
      );
    }
  } catch {}

  const commonDed: [string, number][] = [
    ["퇴직유보금(별도통장)", p.retentionD],
    ["주차비 공제", p.parkingD],
    ["실비 정산", p.expenseD],
    ...otherDedRows,
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
  let hoursRow = "";
  let holidayNote = "";
  if (isHourly) {
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

    // 주휴수당 계산 과정 표기
    if (p.weeklyHolidayP > 0 && p.hourlyWage > 0) {
      const whHours =
        p.weeklyHolidayHours != null && p.weeklyHolidayHours > 0
          ? p.weeklyHolidayHours
          : p.weeklyHolidayP / p.hourlyWage;
      holidayNote = `<div class="small">· 주휴수당 = 주휴시간 <b>${hm(whHours)}</b> × 시급 ${won(p.hourlyWage)}원 = <b>${won(p.weeklyHolidayP)}원</b>
        &nbsp;(1주 실근로가 15시간을 초과한 주에 한해 부여, 주휴시간 = 해당 주 실근로 ÷ 5, 주당 최대 8시간)</div>`;
    } else if (p.weeklyHolidayP === 0) {
      holidayNote = `<div class="small">· 주휴수당: 실근로 15시간을 초과한 주가 없어 미발생</div>`;
    }
  }

  // ── 기본급 산출 근거 (월중 입·퇴사 일할 / 월중 계약변경 가중) ──
  let bd: any = null;
  try {
    bd = p.breakdown ? JSON.parse(p.breakdown) : null;
  } catch {}
  const blend =
    bd?.blend && Array.isArray(bd.blend.segments) && bd.blend.segments.length >= 2
      ? bd.blend
      : null;
  const baseApplied: number | null =
    typeof bd?.baseApplied === "number" ? bd.baseApplied : null;
  const ratio = p.prorationRatio ?? 1;
  const isMonthlyLike = p.payScheme === "MONTHLY" || p.payScheme === "INCENTIVE";

  const basisLines: string[] = [];
  if (blend && p.payScheme !== "RATIO") {
    const segTxt = blend.segments
      .map((s: any) => `${s.days}일 × ${won(s.baseWage)}원`)
      .join(" &nbsp;+&nbsp; ");
    basisLines.push(
      `<b>월중 계약 변경</b> — 적용 ${isHourly ? "시급" : "월 기본급"}(역일수 가중평균): ( ${segTxt} ) ÷ ${blend.totalDays}일 = <b>${won(blend.baseWage)}원</b>`
    );
  } else if (!blend && p.payScheme !== "RATIO" && Array.isArray(bd?.notes)) {
    // 구조화 데이터가 없는 과거 기록: 산정 당시 남긴 가중 노트를 그대로 표시
    const legacy = bd.notes.find(
      (n: any) => typeof n === "string" && n.startsWith("월중 계약변경")
    );
    if (legacy) {
      basisLines.push(
        `<b>월중 계약 변경</b> — ${esc(String(legacy).replace(/^월중 계약변경 일할가중 적용:\s*/, ""))}`
      );
    }
  }
  if (isMonthlyLike && ratio < 1) {
    // 재직기간 재구성 — 기록 당시 비율과 일치할 때만 일수·기간을 표기
    const monthStart = new Date(Date.UTC(p.year, p.month - 1, 1));
    const monthEnd = new Date(Date.UTC(p.year, p.month, 0));
    const daysInMonth = monthEnd.getUTCDate();
    const hire = new Date(e.hireDate);
    const resign = e.resignDate ? new Date(e.resignDate) : null;
    const from = hire > monthStart ? hire : monthStart;
    const to = resign && resign < monthEnd ? resign : monthEnd;
    const activeDays =
      from <= to ? Math.floor((to.getTime() - from.getTime()) / 86400000) + 1 : 0;
    const matches =
      activeDays > 0 && Math.abs(activeDays / daysInMonth - ratio) < 0.005;
    const baseForCalc = baseApplied ?? (blend ? blend.baseWage : null);
    if (matches) {
      const period = `${p.month}월 ${from.getUTCDate()}일 ~ ${p.month}월 ${to.getUTCDate()}일`;
      basisLines.push(
        baseForCalc != null
          ? `<b>월중 입·퇴사 일할계산</b> — 재직 ${period} (${activeDays}일/${daysInMonth}일): ${blend ? "적용 " : ""}기본급 ${won(baseForCalc)}원 × ${activeDays}/${daysInMonth} = <b>${won(p.baseP)}원</b>`
          : `<b>월중 입·퇴사 일할계산</b> — 재직 ${period} (${activeDays}일/${daysInMonth}일, 재직비율 ${(ratio * 100).toFixed(1)}%) → 기본급 <b>${won(p.baseP)}원</b>`
      );
      basisLines.push(
        `직책수당·식대·차량유지비 등 월 정액 수당도 동일 비율(${activeDays}/${daysInMonth})로 일할 지급됩니다.`
      );
    } else {
      basisLines.push(
        `<b>일할계산 적용</b> — 재직비율 ${(ratio * 100).toFixed(1)}% → 기본급 <b>${won(p.baseP)}원</b> (월 정액 수당 동일 비율 적용)`
      );
    }
  }
  const basisBlock = basisLines.length
    ? `<div style="border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px;margin:8px 0 2px;background:#f8fafc">
        <div class="small" style="color:#334155"><b>◾ 기본급 산출 근거</b></div>
        ${basisLines.map((l) => `<div class="small">· ${l}</div>`).join("\n        ")}
      </div>`
    : "";

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
  ${basisBlock}
  <div class="clause" style="margin-top:10px">
    ${isHourly ? `<div class="small">· 기본급 = 기본 근로시간 × 시급</div>` : ""}
    <div class="small">· 추가근로수당(법내연장) = 추가근로시간 × 통상시급 &nbsp; · 연장근로수당(법정초과) = 연장근로시간 × 통상시급 × 1.5</div>
    <div class="small">· 휴일근로수당 = 휴일근로시간 × 통상시급 × 1.5 &nbsp; · 야간근로수당 = 야간근로시간 × 통상시급 × 0.5</div>
    ${holidayNote}
    ${isFree
      ? `<div class="small">· 사업소득 원천징수: 지급총액의 3.3%(소득세 3% + 지방소득세 0.3%) 공제</div>`
      : `<div class="small">· 4대보험 및 근로소득세는 관계법령·간이세액표(또는 세무대리인 산정액)에 따릅니다.</div>`}
    ${p.retentionD ? `<div class="small">· 퇴직유보금: 인센티브 원천액의 8.3%로, 확인서에 따라 별도 통장으로 송금·적립됩니다.</div>` : ""}
    <div class="small">· 본 명세서는 근로기준법 제48조에 따라 교부됩니다.</div>
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

/* ==================== 인센티브 산정 내역서 (명세서 첨부) ==================== */
/**
 * 월급+인센티브 강사의 학생 명단별 인센티브 산정 근거.
 * 엑셀 '인센티브 계산' 양식과 동일하게 좌·우 2개 블록으로 학생을 나열한다.
 */
export function incentiveDetailHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  year: number;
  month: number;
  students: RosterStudent[];
  threshold: number;
  perStudent: number;
  monthlyPay?: number | null; // 월급여 (교차확인용)
  retention?: number | null; // 퇴직유보금
}): string {
  const { employee: e, company: c, students } = args;
  const s = summarizeIncentive(students, {
    threshold: args.threshold,
    perStudent: args.perStudent,
  });

  const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ""));
  const md = (d?: Date | null) =>
    d ? `${new Date(d).getUTCMonth() + 1}/${new Date(d).getUTCDate()}` : "";
  const sessTxt = (r: (typeof s.rows)[number]) =>
    r.sessions == null ? `${s.standardSessions}회` : `${num(r.sessions)}회`;

  // 좌/우 2개 블록으로 분할 (엑셀 양식과 동일한 배치)
  const half = Math.ceil(s.rows.length / 2);
  const blocks = [s.rows.slice(0, half), s.rows.slice(half)];
  const rowHtml = (r: (typeof s.rows)[number], i: number, offset: number) => {
    const dim = r.amount === 0 && r.weight >= 1; // 기준 인원 이내 만근 학생
    return `<tr class="${dim ? "dim" : ""}">
      <td class="c">${r.seq ?? offset + i + 1}</td>
      <td class="c">${esc(STUDENT_STATUS_LABEL[r.status] ?? "재원")}</td>
      <td>${esc(r.name)}</td>
      <td class="sm">${esc(r.className ?? "")}</td>
      <td class="c sm">${md(r.enrollDate)}</td>
      <td class="c sm">${md(r.withdrawDate)}</td>
      <td class="c">${sessTxt(r)}</td>
      <td class="num">${r.amount ? won(r.amount) : "-"}</td>
    </tr>`;
  };
  const tableHtml = (rows: typeof s.rows, offset: number) =>
    rows.length
      ? `<table class="pay roster">
      <thead><tr><th>번호</th><th>상태</th><th>이름</th><th>반</th><th>입학</th><th>퇴원</th><th>회차</th><th>인센티브</th></tr></thead>
      <tbody>${rows.map((r, i) => rowHtml(r, i, offset)).join("")}</tbody></table>`
      : "";

  const payable = s.amount - (args.retention ?? 0);

  return `<div class="compact">${head(
    c,
    `<div class="small">${args.year}년 ${args.month}월분</div>`
  )}
  <div class="doc-title" style="letter-spacing:0.2em">인센티브 산정 내역서</div>
  <p style="text-align:center" class="muted">${args.year}년 ${args.month}월 · ${esc(e.name)} ${esc(e.position ?? "선생님")}</p>

  <table class="kv">
    <tr><th>기준 인원수</th><td>${s.threshold}명</td><th>1인당 기준금액</th><td>${wonUnit(s.perStudent)}</td></tr>
    <tr><th>1회당 단가</th><td>${wonUnit(s.perSession)} <span class="muted">(기준금액 ÷ ${s.standardSessions}회)</span></td><th>월 표준 수업</th><td>${s.standardSessions}회 (만근)</td></tr>
    <tr><th>학생 인원</th><td>총 ${s.totalCount}명 <span class="muted">(만근 ${s.fullCount}명 · 중도 ${s.partialCount}명)</span></td><th>가중 인원</th><td><b>${num(s.units)}명</b></td></tr>
    <tr><th>기준 초과</th><td><b>${num(s.over)}명</b> <span class="muted">(가중 ${num(s.units)} − 기준 ${s.threshold})</span></td><th>인센티브 합계</th><td><b>${wonUnit(s.amount)}</b></td></tr>
    ${
      args.retention
        ? `<tr><th>퇴직유보금</th><td>${wonUnit(args.retention)} <span class="muted">(인센티브 × 1/12, 별도통장)</span></td><th>인센티브 지급액</th><td><b>${wonUnit(payable)}</b></td></tr>`
        : ""
    }
    ${args.monthlyPay ? `<tr><th>월급여(기본급)</th><td>${wonUnit(args.monthlyPay)}</td><th>급여 + 인센티브</th><td><b>${wonUnit(args.monthlyPay + s.amount)}</b></td></tr>` : ""}
  </table>

  <div class="roster-grid">
    <div>${tableHtml(blocks[0], 0)}</div>
    <div>${tableHtml(blocks[1], half)}</div>
  </div>

  <div class="clause" style="margin-top:8px">
    <div class="small">· 산정식: <b>인센티브 = (가중 인원 − 기준 인원수) × 1인당 기준금액</b></div>
    <div class="small">· 가중 인원 = 학생별 재원계수의 합. 재원계수 = 해당 월 수업 회차 ÷ ${s.standardSessions}회(만근), 최대 1.0</div>
    <div class="small">· 월 중간에 입학·전출·퇴원한 학생은 실제 수업 회차에 비례하여 산정됩니다 (1회당 ${won(s.perSession)}원, 0회는 미산정).</div>
    <div class="small">· 기준 인원수(${s.threshold}명) 이내의 학생은 인센티브가 발생하지 않으며, 만근 학생이 기준 인원을 먼저 채웁니다.</div>
    <div class="small">· 본 내역서는 급여명세서의 <b>인센티브</b> 항목 산출 근거로 첨부됩니다.</div>
  </div>
  </div>`;
}
