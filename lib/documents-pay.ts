// 급여명세서 / 사업소득명세서 / 각종 증명서 템플릿

import { won, wonUnit, ymd, ymdKo } from "./format";
import { INCOME_TYPE_LABEL } from "./constants";
import { logoImg, stampImg, type DocCompany, type DocEmployee } from "./documents";
import {
  summarizeIncentive,
  summarizeRevenueShare,
  isRevenueRoster,
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
  holidayOverHours?: number;
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
  /** 직원 정보의 월 정기주차 비용 — 명세서에 '× 50%' 근거를 적기 위해서만 쓴다 */
  parkingFee?: number | null;
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
    <div class="cbrand">${logoImg(c)}
      <div><div class="cname">${esc(c.name)}</div>
        <div class="cmeta">대표 ${esc(c.ceo)} · 사업자등록번호 ${esc(c.bizNo)}<br/>${esc(c.address)} · ${esc(c.phone)}</div></div>
    </div>
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
  let timeNote = "";

  // 산출 근거(breakdown)는 여러 곳에서 쓰므로 한 번만 읽는다
  let bd: any = null;
  try {
    bd = p.breakdown ? JSON.parse(p.breakdown) : null;
  } catch {}

  // 보강 오버타임 — 첨부 내역서를 보기 전에도 몇 시간이 어떤 구분으로 잡혔는지 명세서 1장에서 알 수 있게.
  // 배수를 항목마다 붙여 두면 내역서가 없는 달에도 어떻게 계산됐는지 스스로 설명이 된다.
  const otParts = [
    (p.extraHours ?? 0) > 0 ? `연장 ${p.extraHours}시간(×1.0)` : "",
    (p.overtimeHours ?? 0) > 0 ? `연장(법정가산) ${p.overtimeHours}시간(×1.5)` : "",
    (p.holidayHours ?? 0) > 0 ? `휴일 ${p.holidayHours}시간(×1.5)` : "",
    (p.holidayOverHours ?? 0) > 0 ? `휴일 8시간초과 ${p.holidayOverHours}시간(×2.0)` : "",
    (p.nightHours ?? 0) > 0 ? `야간 ${p.nightHours}시간(+0.5 가산)` : "",
  ].filter(Boolean);
  // **내역서가 실제로 첨부될 때만** 별첨이라고 적는다.
  // 첨부는 보강 신청 → 실근무 확정을 거친 건(breakdown.overtime.lines)에만 붙는다 —
  // 급여 화면에서 관리자가 시간을 직접 넣은 달은 산정 원장이 없어 붙일 내역서가 없다.
  // 예전엔 이 문구가 조건 없이 찍혀 **없는 별첨을 가리켰다**.
  const hasOtDetail = (bd?.overtime?.lines?.length ?? 0) > 0;
  const otRow =
    !isHourly && otParts.length
      ? `<tr><th>오버타임</th><td colspan="3">${otParts.join(" · ")}${
          hasOtDetail
            ? ` <span class="muted">(산정 근거는 별첨 「보강 오버타임 산정 내역서」)</span>`
            : ` <span class="muted">(통상시급 ${won(p.hourlyWage)}원 기준)</span>`
        }</td></tr>`
      : "";
  // 시간기록표 근거 (체류/휴게/순 근로/연차) — 있으면 명세서에 나눠 적는다
  const ts: any = bd?.timesheet ?? null;

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

    // 체류시간과 순 근로시간을 나눠 보여 준다 — 출퇴근 기록과 급여 시간이 왜 다른지가 한눈에 보이게
    if (ts) {
      hoursRow =
        `<tr><th>학원 체류시간</th><td>${hm(ts.stayHours)} <span class="muted">(출근~퇴근 ${ts.workedDays}일)</span></td>` +
        `<th>휴게시간</th><td>− ${hm(ts.breakHours)} <span class="muted">(${ts.breakPaid ? "유급" : "무급"})</span></td></tr>` +
        `<tr><th>순 근로시간</th><td><b>${hm(ts.netHours)}</b> <span class="muted">(체류 − 휴게)</span></td>` +
        `<th>연차 유급시간</th><td>${ts.leaveHours > 0 ? `${hm(ts.leaveHours)} <span class="muted">(${ts.leaveDays}일 × ${hm(ts.dailyContractual)})</span>` : "-"}</td></tr>` +
        hoursRow;

      timeNote =
        `<div class="small">· <b>학원 체류시간</b>은 출근~퇴근 기록 그대로이고, 여기서 휴게시간을 뺀 것이 <b>순 근로시간</b>입니다.</div>` +
        `<div class="small">· 휴게시간은 근무일마다 30분이며, 근로계약에 따라 <b>${
          ts.breakPaid ? "유급(급여에 포함)" : "무급(급여에서 제외)"
        }</b>으로 처리됩니다 — 이 명세서의 기본급은 <b>${
          ts.breakPaid ? "체류시간" : "순 근로시간"
        }</b> 기준으로 산정되었습니다.</div>` +
        (ts.leaveHours > 0
          ? `<div class="small">· 연차를 사용한 날은 출근 기록이 없지만 <b>1일 소정근로시간(${hm(
              ts.dailyContractual
            )})을 근무한 것으로 보아 유급</b>으로 산정합니다 (근로기준법 제60조 — 연차휴가는 유급휴가).</div>`
          : "");
    }

    // 주휴수당 계산 과정 표기
    if (p.weeklyHolidayP > 0 && p.hourlyWage > 0) {
      const whHours =
        p.weeklyHolidayHours != null && p.weeklyHolidayHours > 0
          ? p.weeklyHolidayHours
          : p.weeklyHolidayP / p.hourlyWage;
      holidayNote = `<div class="small">· 주휴수당 = 주휴시간 <b>${hm(whHours)}</b> × 시급 ${won(p.hourlyWage)}원 = <b>${won(p.weeklyHolidayP)}원</b>
        &nbsp;(<b>1주 단위</b>로 판정합니다 — 근로기준법 제55조·시행령 제30조·제18조제3항.
        <b>주5일 계약</b>은 계약서에 정해진 근무요일을 모두 채운 주에, <b>주2~4일 계약</b>은
        그 주 근로시간이 15시간 이상인 주에 부여하며, 어느 쪽이든 그 주 내내 근로관계가 있어야 합니다.
        휴게시간 30분은 유급·무급과 관계없이 소정근로시간에서 제외해 판정하므로 아래 급여 산정시간과
        다를 수 있고, 연차 사용일은 1일 소정근로시간을 채운 것으로 봅니다.
        주휴시간 = 1주 소정근로시간 ÷ 5, 주당 최대 8시간)</div>`;
    } else if (p.weeklyHolidayP === 0) {
      holidayNote = `<div class="small">· 주휴수당: 요건(계약 근무요일 개근 또는 주 15시간 이상 근로 +
        1주간 근로관계 존속)을 갖춘 주가 없어 미발생 — 근로기준법 제55조·시행령 제30조·제18조제3항</div>`;
    }
  }

  // ── 기본급 산출 근거 (월중 입·퇴사 일할 / 월중 계약변경 가중) ──
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
  // 포괄임금(고정OT) — 연장·야간수당 중 얼마가 계약상 약정분인지 밝힌다.
  const fx = bd?.fixed;
  if (isMonthlyLike && fx && (fx.otHours || fx.nightHours)) {
    const hrs = (n: number) => String(Number(n.toFixed(4)));
    const parts = [
      fx.otHours ? `시간외 ${hrs(fx.otHours)}시간` : "",
      fx.nightHours ? `야간 ${hrs(fx.nightHours)}시간` : "",
    ].filter(Boolean);
    basisLines.push(
      `<b>포괄임금(고정) 약정</b> — 근로계약서 제4조에 따라 월 ${parts.join(
        " · "
      )}의 가산수당이 급여에 미리 포함되어 있습니다` +
        (fx.baseHours ? ` (기본급 산정 ${hrs(fx.baseHours)}시간)` : "") +
        `. 약정시간을 초과한 실근로만 통상시급 ${won(p.hourlyWage)}원 기준으로 추가 가산됩니다.`
    );
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
    ${otRow}
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
    <div class="small">· 추가근로수당(연장) = 연장근로시간 × 통상시급 <span class="muted">(주 40시간 이내 — 가산 없음)</span> &nbsp; · 연장근로수당(법정초과) = 1일 8시간·주 40시간 초과시간 × 통상시급 × 1.5</div>
    <div class="small">· 휴일근로수당 = 휴일근로시간 × 통상시급 × 1.5 <span class="muted">(1일 8시간 초과분은 × 2.0)</span> &nbsp; · 야간근로수당 = 야간근로시간 × 통상시급 × 0.5</div>
    ${timeNote}
    ${holidayNote}
    ${isFree
      ? `<div class="small">· 사업소득 원천징수: 지급총액의 3.3%(소득세 3% + 지방소득세 0.3%) 공제</div>`
      : `<div class="small">· 4대보험 및 근로소득세는 관계법령·간이세액표(또는 세무대리인 산정액)에 따릅니다.</div>`}
    ${p.retentionD ? `<div class="small">· 퇴직유보금: 인센티브 원천액의 8.3%(1/12)로, 확인서에 따라 별도 통장으로 송금·적립됩니다.</div>` : ""}
    ${
      p.parkingD > 0
        ? `<div class="small">· 주차비 공제: 월 정기주차 비용의 <b>50%</b>(본인 부담분)입니다${
            p.parkingFee ? ` — 월 ${won(p.parkingFee)}원 × 50% = <b>${won(p.parkingD)}원</b>` : ""
          }. 나머지 50%는 회사가 부담합니다.</div>`
        : p.parkingD < 0
        ? `<div class="small">· 주차비 정산: 앞달 과다공제분 등을 <b>${won(
            Math.abs(p.parkingD)
          )}원</b> 환급하여 공제에서 차감했습니다 — 그만큼 실수령액이 늘어납니다.</div>`
        : ""
    }
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
      <div style="margin-top:6px">대표이사 ${esc(c.ceo)} ${c.stamp ? stampImg(c) : '<span class="seal">(직인)</span>'}</div>
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
      <div style="margin-top:6px">대표이사 ${esc(c.ceo)} ${c.stamp ? stampImg(c) : '<span class="seal">(직인)</span>'}</div>
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

/* ============ 사업소득·인센티브 산정 내역서 (매출 기준, 명세서 첨부) ============ */
/**
 * 완전비율제(사업소득)·매출비율 인센티브의 학생별 산출 근거.
 *
 * 인원 기준 내역서(`incentiveDetailHtml`)와 **같은 골격·같은 2단 배치**를 쓴다 —
 * 자동산정으로 붙는 문서와 엑셀 업로드로 붙는 문서가 서로 다르게 생기면
 * 받는 사람이 같은 회사 문서로 읽지 못한다. 표의 7·8열만 회차·인센티브 대신
 * 수강료 매출·배분액으로 바뀐다.
 *
 * 월중 입·퇴원 비례는 **매출 금액에 이미 반영**돼 있어(신규 6회 → 380,000 이 아니라 266,000)
 * 재원계수를 따로 곱하지 않는다. 회차는 근거로만 함께 적는다.
 */
export function revenueDetailHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  year: number;
  month: number;
  students: RosterStudent[];
  /** 배분율 — **계약**의 값(완전비율제 ratioPercent / 인센티브 incRevenuePercent) */
  percent: number;
  /** 사업소득(완전비율제) 인지 인센티브(월급+인센티브) 인지 */
  kind: "BUSINESS" | "INCENTIVE";
  monthlyPay?: number | null; // 월급여 (인센티브 계약자 교차확인용)
  retention?: number | null; // 퇴직유보금
  /** 명단에 적혀 있던 배분율 — 계약과 다르면 경고를 적는다 */
  sheetPercent?: number | null;
}): string {
  const { employee: e, company: c } = args;
  const s = summarizeRevenueShare(args.students, { percent: args.percent });
  const isBiz = args.kind === "BUSINESS";
  const label = isBiz ? "사업소득" : "인센티브";

  const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ""));
  const md = (d?: Date | null) =>
    d ? `${new Date(d).getUTCMonth() + 1}/${new Date(d).getUTCDate()}` : "";
  const pctTxt = (p: number) => `${(p * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

  const half = Math.ceil(s.rows.length / 2);
  const blocks = [s.rows.slice(0, half), s.rows.slice(half)];
  // 번호는 명단에 적힌 것을 그대로 쓰고, 없으면 '-' 로 둔다 — 관리시트가 퇴원·휴원 학생을
  // 번호 없이 '-' 로 적기 때문. 자리 순번을 지어내면 그 학생이 재원 명부의 몇 번째인 것처럼 보인다.
  const rowHtml = (r: (typeof s.rows)[number]) => {
    const dim = r.revenue <= 0; // 그 달 수업이 없던 학생 (월초 퇴원 등)
    return `<tr class="${dim ? "dim" : ""}">
      <td class="c">${r.seq ?? "-"}</td>
      <td class="c">${esc(STUDENT_STATUS_LABEL[r.status] ?? "재원")}</td>
      <td>${esc(r.name)}</td>
      <td class="sm">${esc(r.className ?? "")}</td>
      <td class="c sm">${md(r.enrollDate)}</td>
      <td class="c sm">${md(r.withdrawDate)}</td>
      <td class="num">${r.revenue ? won(r.revenue) : "-"}</td>
      <td class="num">${r.amount ? won(r.amount) : "-"}</td>
    </tr>`;
  };
  const tableHtml = (rows: typeof s.rows) =>
    rows.length
      ? `<table class="pay roster rev">
      <thead><tr><th>번호</th><th>상태</th><th>이름</th><th>반</th><th>입학</th><th>퇴원</th><th>① 매출</th><th>② ${esc(label)}</th></tr></thead>
      <tbody>${rows.map(rowHtml).join("")}</tbody></table>`
      : "";

  const payable = s.amount - (args.retention ?? 0);
  const mismatch =
    args.sheetPercent != null && Math.abs(args.sheetPercent - args.percent) > 0.0001;

  return `<div class="compact">${head(
    c,
    `<div class="small">${args.year}년 ${args.month}월분</div>`
  )}
  <div class="doc-title" style="letter-spacing:0.2em">${esc(label)} 산정 내역서</div>
  <p style="text-align:center" class="muted">${args.year}년 ${args.month}월 · ${esc(e.name)} ${esc(e.position ?? "선생님")}</p>

  <table class="kv">
    <tr><th>학생 인원</th><td>총 ${s.totalCount}명 <span class="muted">(수업 있음 ${s.activeCount}명 · 없음 ${s.zeroCount}명)</span></td><th>배분율</th><td><b>${pctTxt(s.percent)}</b></td></tr>
    <tr><th>① 수강료 매출 합계</th><td><b>${wonUnit(s.revenue)}</b></td><th>② ${esc(label)}</th><td><b>${wonUnit(s.amount)}</b> <span class="muted">(① × ${pctTxt(s.percent)})</span></td></tr>
    ${
      args.retention
        ? `<tr><th>퇴직유보금</th><td>${wonUnit(args.retention)} <span class="muted">(${esc(label)} × 1/12, 별도통장)</span></td><th>${esc(label)} 지급액</th><td><b>${wonUnit(payable)}</b></td></tr>`
        : ""
    }
    ${args.monthlyPay ? `<tr><th>월급여(기본급)</th><td>${wonUnit(args.monthlyPay)}</td><th>급여 + ${esc(label)}</th><td><b>${wonUnit(args.monthlyPay + s.amount)}</b></td></tr>` : ""}
  </table>

  <div class="roster-grid">
    <div>${tableHtml(blocks[0])}</div>
    <div>${tableHtml(blocks[1])}</div>
  </div>

  <div class="clause" style="margin-top:8px">
    <div class="small">· 산정식: <b>${esc(label)} = Σ 수강료 매출 × ${pctTxt(s.percent)}</b></div>
    <div class="small">· 월 중간에 입학·전출·퇴원한 학생은 <b>실제 수업 회차에 비례한 수강료</b>가 ① 에 잡혀 있습니다 (그 달 수업이 없으면 0원).</div>
    ${
      isBiz
        ? `<div class="small">· 본 내역서는 사업소득 지급명세서의 <b>지급총액</b> 산출 근거로 첨부됩니다. 위탁계약이므로 주휴·연차·퇴직금·4대보험은 적용되지 않습니다.</div>`
        : `<div class="small">· 본 내역서는 급여명세서의 <b>인센티브</b> 항목 산출 근거로 첨부됩니다.</div>`
    }
    ${
      mismatch
        ? `<div class="small" style="color:#b91c1c">· ⚠️ 명단에 적힌 배분율(${pctTxt(args.sheetPercent!)})과 계약상 배분율(${pctTxt(s.percent)})이 다릅니다 — <b>계약 기준</b>으로 산정했습니다.</div>`
        : ""
    }
    <div class="small">· 학생별 금액은 원 단위로 반올림하며, 반올림 잔차는 합계가 <b>① × ${pctTxt(s.percent)}</b> 와 정확히 일치하도록 조정됩니다.</div>
  </div>
  </div>`;
}

/**
 * 명단 모양에 맞는 내역서를 고른다 — 매출 열이 있으면 매출 기준, 없으면 인원 기준.
 * 첨부하는 쪽(doc-service)은 이 함수만 부르면 된다.
 */
export function rosterDetailHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  year: number;
  month: number;
  students: RosterStudent[];
  kind: "BUSINESS" | "INCENTIVE";
  /** 매출 기준 — 계약상 배분율 */
  percent?: number | null;
  sheetPercent?: number | null;
  /** 인원 기준 — 계약상 기준 인원·기준금액 */
  threshold?: number | null;
  perStudent?: number | null;
  monthlyPay?: number | null;
  retention?: number | null;
}): string | null {
  if (!args.students.length) return null;
  if (isRevenueRoster(args.students)) {
    if (!args.percent) return null; // 배분율이 계약에 없으면 산정할 수 없다
    return revenueDetailHtml({
      employee: args.employee,
      company: args.company,
      year: args.year,
      month: args.month,
      students: args.students,
      percent: args.percent,
      kind: args.kind,
      sheetPercent: args.sheetPercent ?? null,
      monthlyPay: args.monthlyPay ?? null,
      retention: args.retention ?? null,
    });
  }
  return incentiveDetailHtml({
    employee: args.employee,
    company: args.company,
    year: args.year,
    month: args.month,
    students: args.students,
    threshold: args.threshold ?? 0,
    perStudent: args.perStudent ?? 0,
    monthlyPay: args.monthlyPay ?? null,
    retention: args.retention ?? null,
  });
}

/* ==================== 보강 오버타임 산정 내역서 ==================== */

/** 산정 결과 한 줄 (lib/overtime.ts 의 OtLine 과 같은 모양) */
export interface OvertimeDetailLine {
  date: string; // YYYY-MM-DD
  timeLabel: string; // "19:00~22:00"
  category: string;
  kind: string; // OVERTIME | HOLIDAY
  night: boolean;
  over?: boolean;
  hours: number;
  countedHours: number;
  multiplier: number;
  reason?: string;
}

const WEEK_KO = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 급여명세서에 첨부되는 「보강 오버타임 산정 내역서」.
 * 어떤 보강이 어떤 구분(연장/휴일)으로 몇 시간 인정됐는지, 왜 깎였는지까지
 * 한 장에 남겨 직원이 명세서만 보고도 확인할 수 있게 한다.
 */
export function overtimeDetailHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  year: number;
  month: number;
  hourlyWage: number;
  lines: OvertimeDetailLine[];
  excluded?: OvertimeDetailLine[];
  categoryLabel: Record<string, string>;
}): string {
  const { employee: e, company: c, hourlyWage } = args;
  const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  const dow = (d: string) => WEEK_KO[new Date(`${d}T00:00:00Z`).getUTCDay()];
  const kindOf = (l: OvertimeDetailLine) =>
    l.kind === "HOLIDAY"
      ? l.over
        ? "휴일(8h초과)"
        : "휴일근로"
      : l.kind === "OVERTIME"
      ? "연장(법정가산)"
      : "연장근로";

  const rowHtml = (l: OvertimeDetailLine) => {
    const amount = Math.round(l.countedHours * hourlyWage * l.multiplier);
    return `<tr>
      <td class="c sm">${esc(l.date.slice(5))}(${dow(l.date)})</td>
      <td class="c sm">${esc(l.timeLabel)}</td>
      <td class="sm">${esc(args.categoryLabel[l.category] ?? l.category)}</td>
      <td class="c sm">${kindOf(l)}${l.night ? " +야간" : ""}</td>
      <td class="c">${num(l.countedHours)}h</td>
      <td class="c">×${l.multiplier}</td>
      <td class="num">${won(amount)}</td>
    </tr>`;
  };

  const total = args.lines.reduce(
    (a, l) => a + Math.round(l.countedHours * hourlyWage * l.multiplier),
    0
  );
  const sumH = (f: (l: OvertimeDetailLine) => boolean) =>
    Math.round(args.lines.filter(f).reduce((a, l) => a + l.countedHours, 0) * 100) / 100;

  const cut = (args.excluded ?? []).filter((l) => l.hours > 0);

  return `<div class="compact">${head(c, `<div class="small">${args.year}년 ${args.month}월분</div>`)}
  <div class="doc-title" style="letter-spacing:0.2em">보강 오버타임 산정 내역서</div>
  <p style="text-align:center" class="muted">${args.year}년 ${args.month}월 · ${esc(e.name)} ${esc(e.position ?? "선생님")}</p>

  <table class="kv">
    <tr><th>통상시급</th><td>${wonUnit(hourlyWage)}</td><th>연장근로</th><td>${num(sumH((l) => l.kind === "EXTRA"))}시간 <span class="muted">(가산 없음)</span>${
      sumH((l) => l.kind === "OVERTIME") > 0
        ? ` · 법정가산 ${num(sumH((l) => l.kind === "OVERTIME"))}시간`
        : ""
    }</td></tr>
    <tr><th>휴일근로</th><td>${num(sumH((l) => l.kind === "HOLIDAY" && !l.over))}시간 <span class="muted">(8시간 초과 ${num(sumH((l) => !!l.over))}시간)</span></td><th>야간근로</th><td>${num(sumH((l) => l.night))}시간 <span class="muted">(가산 +0.5)</span></td></tr>
    <tr><th>수당 합계</th><td colspan="3"><b>${wonUnit(total)}</b></td></tr>
  </table>

  ${
    args.lines.length
      ? `<table class="pay">
      <thead><tr><th>일자</th><th>시간대</th><th>보강종류</th><th>구분</th><th>인정시간</th><th>배수</th><th>금액</th></tr></thead>
      <tbody>${args.lines.map(rowHtml).join("")}
        <tr class="total"><td colspan="6">합계</td><td class="num">${won(total)}</td></tr>
      </tbody></table>`
      : `<p class="muted" style="text-align:center">이 달에 수당으로 인정된 보강 근무가 없습니다.</p>`
  }

  ${
    cut.length
      ? `<div class="clause" style="margin-top:8px">
      <div class="small"><b>수당에 반영되지 않은 근무</b></div>
      ${cut
        .map(
          (l) =>
            `<div class="small">· ${esc(l.date.slice(5))}(${dow(l.date)}) ${esc(l.timeLabel || "")} ${num(
              l.hours
            )}시간 — ${esc(l.reason ?? "수당 대상 아님")}</div>`
        )
        .join("")}
    </div>`
      : ""
  }

  <div class="clause" style="margin-top:8px">
    <div class="small">· <b>연장근로</b>: 평일 소정근로시간 밖 또는 토요일 근무 — 주 소정근로가 40시간 미만이라
      법정 가산 대상이 아니며 통상시급 ×1.0 으로 지급합니다 (1일 8시간·주 40시간을 넘는 부분은 ×1.5).</div>
    <div class="small">· <b>휴일근로</b>: 일요일·공휴일 근무 — 8시간까지 ×1.5, 초과분 ×2.0 (근로기준법 §56②)</div>
    <div class="small">· <b>야간근로</b>: 22시~06시 사이 근무에 +0.5 가산 (해당 항목이 있을 때만 표시)</div>
    <div class="small">· 소정근로시간 안에서 진행된 보강은 월 급여에 이미 포함되어 별도 수당이 발생하지 않습니다.</div>
    <div class="small">· 내신의무보강은 내신 기간별 인정 상한이 있으며, 수당이 큰 근무부터 상한을 채웁니다.</div>
    <div class="small">· 본 내역서는 급여명세서의 <b>연장·휴일·야간근로수당</b> 항목 산출 근거로 첨부됩니다.</div>
  </div>
  </div>`;
}
