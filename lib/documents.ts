// 유쌤에듀 문서 HTML 템플릿 (→ PDF)
// 엑셀의 실제 계약서/서약서/동의서/명세서 법적 문구를 원문 그대로 재현.

import { won, wonUnit, ymd, ymdKo, maskRRN } from "./format";
import { DAY_KO, PAY_SCHEME_LABEL, parseSchedule, type ScheduleDay } from "./constants";
import { computeWeeklyHours, inclusiveWageBreakdown, WEEKS_PER_MONTH } from "./payroll";
import type { DocGroup, PdfOptions } from "./pdf";
import { paySchemeOfTemplate } from "./contracts";

/**
 * 부서가 정하는 서류 정책 — 어떤 서류를 발급할지.
 * 실제 값은 DB(`Department`)에서 오지만, 문서 모듈이 DB 를 끌어오지 않도록 모양만 여기 둔다
 * (구조적 타이핑이라 `lib/departments.ts` 의 DeptRow 가 그대로 들어맞는다).
 */
export interface DeptDocPolicy {
  docPledgeServiceII: boolean;
  docPromotion: boolean;
  docHealth: boolean;
  docNonCompete: boolean;
}

export interface DocCompany {
  name: string;
  ceo: string;
  bizNo: string;
  phone: string;
  address: string;
  payday?: number;
  /** 학원 로고 (data URI). 없으면 문서 머리에 회사명만 나온다 */
  logo?: string | null;
  /** 법인 인감/직인 (data URI). 없으면 `(인)`·`(직인)` 글자만 찍힌다 */
  stamp?: string | null;
}
export interface DocEmployee {
  name: string;
  rrn?: string | null;
  birth?: string | null;
  department?: string | null;
  position?: string | null;
  duty?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  hireDate: Date;
  resignDate?: Date | null;
  incomeType: string;
  payScheme: string;
  baseWage: number;
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  schedule: string;
  breakPaid?: boolean;
  /** 퇴직유보금 전용 통장 — 퇴직유보금 확인서에 적는다 */
  retentionBank?: string | null;
  retentionAccount?: string | null;
}
export interface DocContract {
  stage: string;
  templateKey: string;
  startDate: Date;
  endDate?: Date | null;
  isProbation: boolean;
  probationMonths: number;
  baseWage: number;
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  ratioPercent?: number | null;
  incThreshold?: number | null;
  incPerStudent?: number | null;
  /** 매출 비율 인센티브 (0.15 = 15%) — 인원 기준과 다른 갈래 */
  incRevenuePercent?: number | null;
  /** 위탁계약(프리랜서) — 개인사업자 지위 확인서가 함께 나간다 */
  isContractor?: boolean | null;
  /** 포괄임금 — 기본급 산정시간(월). 없으면 근로시간표에서 환산 */
  fixedBaseHours?: number | null;
  /** 포괄임금 — 약정(고정) 시간외근로시간(월) */
  fixedOtHours?: number | null;
  /** 포괄임금 — 약정(고정) 야간근로시간(월) */
  fixedNightHours?: number | null;
}

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const CIRC = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮"];

/** 빈칸(자필 기재용 밑줄) */
function blank(width = 16): string {
  return `<span class="fill">${"&nbsp;".repeat(width)}</span>`;
}

/** 본문 우측 자필 서명 유도줄 (원문 양식의 '동 의 자 :' / '확 인 자 :') */
function inlineSign(label: string): string {
  return `<p class="inline-sign">${esc(label)} : ${blank(12)} (인)</p>`;
}

/** 로고가 등록돼 있으면 회사명 왼쪽에 함께 찍는다 */
export function logoImg(c: DocCompany): string {
  return c.logo ? `<img class="clogo" src="${c.logo}" alt=""/>` : "";
}

/**
 * 법인 인감(직인) — 등록돼 있으면 `(인)`·`(직인)` 글자 자리에 도장을 찍는다.
 *
 * **자리를 차지하지 않게 절대배치**한다(`.stamp-anchor` 가 0×0). 실물 도장처럼 이름 위에
 * 살짝 겹쳐 찍히면서도 줄 높이를 밀지 않아, 2페이지로 맞춰 둔 계약서가 3페이지로 늘어나지 않는다.
 * 크기는 A4 인쇄 기준 20mm(계약서 축소본 17mm) — 법인인감은 가로·세로 1cm 초과 3cm 이내다
 * (인감증명법 시행령 §11). 없으면 예전처럼 글자만 남아 손도장을 찍을 자리가 된다.
 */
export function stampImg(c: DocCompany, alt = "직인"): string {
  return c.stamp
    ? `<span class="stamp-anchor"><img class="stamp-img" src="${c.stamp}" alt="${esc(alt)}"/></span>`
    : "";
}

/** 회사 날인 자리 — 도장이 있으면 도장, 없으면 `(인)` 글자 */
function companySeal(c: DocCompany, label = "(인)"): string {
  return c.stamp ? stampImg(c) : `<span class="seal">${label}</span>`;
}

function companyHead(c: DocCompany, tag?: string): string {
  return `<div class="company-head">
    <div class="cbrand">${logoImg(c)}
      <div><div class="cname">${esc(c.name)}</div>
        <div class="cmeta">대표 ${esc(c.ceo)} · 사업자등록번호 ${esc(c.bizNo)}<br/>${esc(c.address)} · ${esc(c.phone)}</div>
      </div>
    </div>
    ${tag ? `<div class="doc-tag">${esc(tag)}</div>` : ""}
  </div>`;
}

/**
 * 서명 필드 (라벨 + 값/밑줄).
 * `stamp` 를 주면 `(인)` 자리에 법인 인감을 찍는다 — **"갑"(회사) 쪽에만** 준다.
 * "을"(직원) 칸은 본인이 직접 날인할 자리라 언제나 글자로 남긴다.
 */
function sigField(
  label: string,
  value?: string | null,
  seal = false,
  stamp?: DocCompany | null
): string {
  const mark = seal ? ` ${stamp ? companySeal(stamp) : '<span class="seal">(인)</span>'}` : "";
  if (value) {
    return `<div class="f"><span class="lbl">${esc(label)}</span><b>${esc(value)}</b>${mark}</div>`;
  }
  return `<div class="f"><span class="lbl">${esc(label)}</span><span class="fill">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>${mark}</div>`;
}

/** 계약 당사자 서명 박스 (갑/을 나란히) — 원문 양식 필드 순서 */
function signDuo(c: DocCompany, e: DocEmployee, partyB: string): string {
  return `<div class="sign-area"><div class="sign-duo">
      <div>
        <div class="sign-party">"갑" (사용자)</div>
        <div class="sign-box"><div class="sign-grid one">
          ${sigField("회사명", c.name)}
          ${sigField("주소지", c.address)}
          ${sigField("대표자", c.ceo, true, c)}
          ${sigField("전화번호", c.phone)}
        </div></div>
      </div>
      <div>
        <div class="sign-party">"을" (${esc(partyB)})</div>
        <div class="sign-box"><div class="sign-grid one">
          ${sigField("생년월일", e.birth)}
          ${sigField("주소지", e.address)}
          ${sigField("성명", e.name, true)}
          ${sigField("전화번호", e.phone)}
        </div></div>
      </div>
    </div></div>`;
}

/** 계약서 교부 확인 문구 (원문 말미) */
function handoverConfirm(): string {
  return `<div class="handover">
    <p>계약자 본인 ( ${blank(10)} ) 은/는 상기와 같이 작성된 계약서를 <span class="trace">교부</span> 받았기에 이에 <span class="trace">확인</span>합니다. &nbsp;&nbsp; 확인자 : ${blank(10)} (인)</p>
    <p class="small">** 자필로 회색 글씨를 따라서 기입 후, 날인 요망</p>
  </div>`;
}

function scheduleTable(schedule: ScheduleDay[]): string {
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const byDay: Record<string, ScheduleDay | undefined> = {};
  schedule.forEach((s) => (byDay[s.day] = s));
  const cell = (fn: (s?: ScheduleDay) => string) =>
    days.map((d) => `<td style="text-align:center">${fn(byDay[d])}</td>`).join("");
  const dur = (s?: ScheduleDay) => {
    if (!s || !s.work) return "-";
    const [sh, sm] = s.start.split(":").map(Number);
    const [eh, em] = s.end.split(":").map(Number);
    const h = eh + em / 60 - (sh + sm / 60) - (s.breakH || 0);
    return h > 0 ? h.toFixed(1) : "-";
  };
  return `<table class="kv sched"><tbody>
    <tr><th>구분</th>${days.map((d) => `<td style="text-align:center;font-weight:700;background:#f7f9ff">${DAY_KO[d]}</td>`).join("")}</tr>
    <tr><th>시업시각</th>${cell((s) => (s?.work ? s.start : "-"))}</tr>
    <tr><th>종업시각</th>${cell((s) => (s?.work ? s.end : "-"))}</tr>
    <tr><th>휴게시간</th>${cell((s) => (s?.work ? String(s.breakH ?? 0) : "-"))}</tr>
    <tr><th>소정근로시간</th>${cell(dur)}</tr>
  </tbody></table>`;
}

/** 사직(해지) 통보 기한: 교수부 60일 / 그 외 30일 */
function resignNoticeDays(e: DocEmployee): number {
  return (e.department ?? "").includes("교수부") ? 60 : 30;
}

/**
 * **기간제(계약기간을 정한) 근로계약의 중도해지 통보 기한** — 퇴직 희망일 2개월 전.
 *
 * 부서별로 갈리는 `resignNoticeDays()`(의원사직)와 **별개**다. 기간제 계약은 만료로 끝나는
 * 것이 원칙이고 중도해지는 예외라, 부서와 무관하게 같은 기간을 둔다.
 * (교수부는 어차피 60일이라 같고, 그 외 부서는 30일 → 2개월로 길어진다.)
 */
export const FIXED_TERM_NOTICE_LABEL = "2개월";

/**
 * 기간제 계약의 계약종료·중도해지 조항.
 *
 * 계약기간을 정한 계약은 **만료로 종료함이 원칙**이고, 중도해지는 민법 제661조
 * (고용기간의 약정이 있는 경우에도 부득이한 사유가 있으면 해지할 수 있다)의
 * 부득이한 사유가 있을 때 또는 당사자 합의가 있을 때에 한한다.
 * 학원은 학사일정이 있어 종료 시점을 아무 때나 잡을 수 없으므로 정규·내신 종료일을 원칙으로 둔다.
 */
function fixedTermEndClauses(): string[] {
  return [
    `본 계약은 <b>계약기간 만료로 종료함을 원칙</b>으로 하며, 당사자는 「민법」 제661조에 정한 부득이한 사유가 있는 경우에 한하여 중도해지할 수 있다.`,
    `제①항에도 불구하고 당사자가 합의하는 경우 계약을 중도 종료할 수 있다. 이 경우 종료일은 <b>학사일정을 고려하여 협의</b>로 정하되, 원칙적으로 <b>정규 또는 내신 종료일</b>로 한다.`,
    `제①항·제②항에 따라 계약을 중도 종료하고자 하는 당사자는 <b>퇴직(종료) 희망일의 ${FIXED_TERM_NOTICE_LABEL} 이전</b>에 그 뜻을 서면으로 상대방에게 통지한다. "을"이 사직하고자 하는 경우 같은 기한까지 사직서를 제출한다.`,
    `"을"은 종료일까지 담당 수업을 수행하고, "갑"이 정한 인수인계 기준에 따라 후임자에게 인계한다.`,
  ];
}

/** 시간 표기 — 209 / 4.345 / 172.062 처럼 불필요한 0 없이 */
function hoursText(h: number): string {
  const s = h.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${s}시간`;
}

/* ============================ 근로/위탁 계약서 ============================ */
export function contractHtml(args: {
  employee: DocEmployee;
  contract: DocContract;
  company: DocCompany;
}): string {
  const { employee: e, contract: ct, company: c } = args;
  const isRatio = ct.templateKey === "RATIO" || e.payScheme === "RATIO";
  if (isRatio) return ratioContractHtml(args);

  const sched = parseSchedule(e.schedule);
  const workDays = sched.filter((s) => s.work).length;
  const isHourly = ct.templateKey === "HOURLY" || e.payScheme === "HOURLY";
  const isIncentive = ct.templateKey === "INCENTIVE" || e.payScheme === "INCENTIVE";
  const title = `근로계약서 (${PAY_SCHEME_LABEL[e.payScheme] ?? "월급제"})`;
  const payday = c.payday ?? 7;
  const resignDays = resignNoticeDays(e);

  // 제1조 — 계약기간. 종료일 미지정 시 공란(자필 기재)으로 출력.
  const endPart = ct.endDate ? `<b>${ymdKo(ct.endDate)}</b>` : blank(18);
  const art1: string[] = [
    `<b>${ymdKo(ct.startDate)}</b> 부터 ${endPart} 까지 근로계약을 체결한 것으로 한다. <span class="muted">(정규직 근로자의 경우 입사일만 기재)</span>`,
    `"을"의 근로조건이 변경된 경우 새로이 근로계약서를 체결하여 변경된 근로조건을 고지하기로 한다.`,
    `상기 근로계약기간이 종료되는 경우 근로계약은 자동 종료되는 것으로 한다. 다만 계약종료 전 30일 이전에 당사자 간의 합의로 그 기간을 연장할 수 있다.`,
  ];
  // 제7조 — 계약기간을 정한 계약(기간제)이면 '만료가 원칙, 중도해지는 예외' 를 앞세운다.
  // 기간의 정함이 없는 계약(정규직)에는 만료도 중도해지도 없으므로 예전 그대로 의원사직만 둔다.
  const isFixedTerm = !!ct.endDate;
  const art7Title = isFixedTerm ? "계약의 종료 및 의원사직" : "의원사직";
  const art7Head: string[] = isFixedTerm
    ? fixedTermEndClauses()
    : [
        `"을"이 사직하고자 할 경우 사직하고자 하는 날의 <b>${resignDays}일 이전</b>에 사직서를 제출하고, 후임자를 선임할 때까지 업무의 인수인계를 비롯하여 성실히 근로한다.`,
      ];

  // 수습 조항 — 신규 계약서에만 포함(갱신 계약은 isProbation=false 로 제외)
  if (ct.isProbation) {
    art1.push(
      `최초 근로 개시일로부터 <b>${ct.probationMonths}개월간</b> 수습기간으로 하며, 수습기간 중 업무 적격성을 판단하여 부족하다고 판단되면 계약을 해지할 수 있다. (수습기간 중 급여는 100% 지급한다.)`
    );
  }

  // 제3조 — 근로시간·휴게시간 (시급제는 토요일 당번제·재택근무 조항 제외)
  const art3Pre: string[] = [
    `"을"의 소속은 <b>${esc(e.department ?? "")}</b> (으)로 한다.`,
    `"을"의 근로일은 1주 <b>${workDays}일</b>로 하며 근로일 및 근로시간의 변경이 필요한 경우 근로일 중 "을"의 소정근로시간은 1일 8시간 1주 40시간 범위 내로 한다.`,
  ];
  const art3Post: string[] = [];
  // 조교팀: 스케줄이 수시로 변경되므로, 통보된 스케줄이 근로시간표를 갈음함을
  // 명시해 스케줄 변경 근무가 초과근무로 해석될 소지를 차단한다.
  if ((e.department ?? "").includes("조교")) {
    art3Post.push(
      `근로일 및 근로시간의 변경이 필요한 경우 "갑"은 1일 8시간, 1주 40시간 범위 내에서 변경된 스케줄을 사전에 "을"에게 통보하며, 통보된 스케줄은 본 계약서 제2항의 근로시간표를 갈음한다.`
    );
  }
  if (!isHourly) {
    art3Post.push(
      `상기 근로시간에 표기되어 있지 않은 토요일 근무의 경우 당번제로 실시하며 토요일 근무시간은 오전 10시 ~ 오후 4시까지로 한다. 토요일 근무 시 해당 주 수요일 근무는 면제된다.`,
      `"을"의 상기 표시된 근로시간은 학원에 출근하여 근로하는 시간에 해당하며 그 외의 시간은 1일 8시간, 1주 40시간 범위 내에서 재택에서 근무할 수 있도록 한다.`
    );
  }
  art3Post.push(
    `"을"의 상기 휴게시간은 식사시간으로 하며, "을"은 해당 시간 범위 내에서 자유롭게 운영하기로 한다.`,
    `"갑"은 제2항에 따른 근로시간 외 연장, 야간, 무급휴무일 근로를 지시할 수 있으며, "을"은 성실히 이행할 것에 동의한다.`
  );
  const art3Html =
    art3Pre.map((t, i) => `<p class="sub">${CIRC[i]} ${t}</p>`).join("\n    ") +
    scheduleTable(sched) +
    art3Post.map((t, i) => `<p class="sub">${CIRC[art3Pre.length + i]} ${t}</p>`).join("\n    ");

  // 제4조 — 임금
  let wageClause = "";
  if (isHourly) {
    const breakLine = e.breakPaid
      ? "유급으로 하여 근로시간에 포함한다"
      : "무급으로 하여 근로시간에서 제외한다";
    wageClause = `<div class="clause"><h3>제 4조 (임금)</h3>
    <p class="sub">① "을"의 시간급 임금은 <b>${wonUnit(ct.baseWage)}</b>으로 하며, 실근로시간(30분 단위 포함)에 따라 산정하여 지급한다.</p>
    <p class="sub">② 1일 근로 중 휴게시간 30분을 부여하며, 휴게시간은 ${breakLine}.</p>
    <p class="sub">③ 주휴수당은 1주 실근로시간(휴게시간 제외)이 15시간을 초과하는 주에 대하여 지급한다. 계약상 소정근로시간이 1주 15시간 미만인 경우에도 실근로시간이 15시간을 초과한 주는 주휴수당을 지급한다.</p>
    <p class="sub">④ 제③항에 따라 주휴수당이 지급되는 경우, 계약상 소정근로시간을 초과한 근로에 대한 별도의 초과(가산)수당은 지급하지 아니하며 해당 근로는 시급(100%)으로 산정한다. 다만 1일 8시간 또는 1주 40시간을 초과하는 근로 및 야간(22~06시)·휴일근로에는 근로기준법에 따른 가산수당을 지급한다.</p>
    <p class="sub">⑤ "을"의 임금은 매월 초일부터 말일까지 기산하여, 익월 ${payday}일에 "을"의 통장으로 법정 공제액을 공제한 후 지급한다. (휴일 전일 당일 지급)</p>
    <p class="sub">⑥ "을"의 퇴직 시 근속기간 중 1주 평균 근로시간이 15시간 이상인 주가 1년 이상인 경우 퇴직급여보장법에 따른 법정 퇴직금을 지급한다.</p></div>`;
  } else {
    // 식대·차량유지비(비과세)는 기본급 총액 '안에' 포함된 금액이라 따로 더하지 않는다.
    const totalWage = ct.baseWage + ct.positionAllow;
    // 포괄임금 분해 — 급여 엔진과 같은 함수를 써서 계약서·명세서 금액이 어긋나지 않게 한다.
    const { weeklyContractual, weeklyHoliday } = computeWeeklyHours(sched);
    const baseHours =
      ct.fixedBaseHours ||
      Math.max(weeklyContractual + weeklyHoliday, 0) * WEEKS_PER_MONTH;
    const iw = inclusiveWageBreakdown({
      baseWage: ct.baseWage,
      mealAllow: ct.mealAllow,
      carAllow: ct.carAllow,
      baseHours,
      otHours: ct.fixedOtHours,
      nightHours: ct.fixedNightHours,
    });

    // 임금 항목 표 — 약정 시간외·야간이 있으면 시간과 함께 별도 행으로 표기한다.
    const rows: Array<[string, number]> = [
      [`기본급 <span class="muted">(${hoursText(iw.baseHours)})</span>`, iw.basePay],
    ];
    if (iw.otHours > 0)
      rows.push([
        `시간외근로(고정) <span class="muted">(${hoursText(iw.otHours)})</span>`,
        iw.overtimePay,
      ]);
    if (iw.nightHours > 0)
      rows.push([
        `야간근로(고정) <span class="muted">(${hoursText(iw.nightHours)})</span>`,
        iw.nightPay,
      ]);
    rows.push(["직책수당", ct.positionAllow]);
    rows.push(["식대(비과세)", ct.mealAllow]);
    rows.push(["차량유지비(비과세)", ct.carAllow]);
    const cells: string[] = [];
    for (let i = 0; i < rows.length; i += 2) {
      const a = rows[i];
      const b = rows[i + 1];
      cells.push(
        `<tr><th>${a[0]}</th><td>${wonUnit(a[1])}</td>` +
          (b ? `<th>${b[0]}</th><td>${wonUnit(b[1])}</td>` : `<th></th><td></td>`) +
          `</tr>`
      );
    }

    // 포괄임금 합의 조항 — 약정시간이 있을 때만.
    const fixedParts = [
      iw.otHours > 0 ? `시간외근로 ${hoursText(iw.otHours)}` : "",
      iw.nightHours > 0 ? `야간근로 ${hoursText(iw.nightHours)}` : "",
    ].filter(Boolean);
    const fixedLabel = [
      iw.otHours > 0 ? "시간외근로수당" : "",
      iw.nightHours > 0 ? "야간근로수당" : "",
    ]
      .filter(Boolean)
      .join("·");
    const inclusiveClause = iw.hasFixed
      ? `제①항의 ${fixedLabel}은 월 ${fixedParts.join(
          " · "
        )}의 약정근로에 대한 근로기준법 제56조의 가산수당을 미리 포함하여 지급하는 것으로 하며, "을"은 이에 동의한다. 위 약정시간을 초과하여 실제 근로한 시간에 대하여는 통상시급 <b>${won(
          iw.hourlyWage
        )}원</b>을 기준으로 법정 가산수당을 별도 지급한다.`
      : "";

    const items: string[] = [];
    if (inclusiveClause) items.push(inclusiveClause);
    items.push(
      `위 급여는 제2, 3조에 따라 책정된 임금이며, 이에 관한 사항이 변경 시 변경된 업무, 직책, 근무장소 및 근로시간 등에 따라 급여가 변경됨에 동의한다.`,
      `"을"의 임금은 매월 초일부터 말일까지 기산하여, 익월 ${payday}일에 "을"의 통장으로 법정 공제액을 공제한 후 지급한다. (휴일 전일 당일 지급)`,
      `"을"의 퇴직 시 근속기간 중 1주 평균 근로시간이 15시간 이상인 주가 1년 이상인 경우 퇴직급여보장법에 따른 법정 퇴직금을 지급한다.`,
      `"갑"은 "을"이 복무서약에 따라 성실하게 근무한 경우 "을"에게 인센티브를 지급할 수 있으며, 이는 호혜적인 금품에 해당하므로 근로기준법상 임금에 해당하지 아니한다.`,
      `직책수당의 경우 해당 임금 산정기간 중 5일 이상 근무한 자에 한하여 이를 일할지급하며, 통상임금 산정 시 제외한다.`
    );
    if (isIncentive)
      items.push(
        `"을"의 인센티브 산정·지급 및 퇴직유보금에 관한 세부 사항은 별지 「인센티브 산정 계약서」에 따른다.`
      );

    const nonTaxNote =
      ct.mealAllow + ct.carAllow > 0
        ? `<p class="footnote">※ 식대·차량유지비는 위 기준급여에 포함된 금액이며, 소득세법상 비과세 항목으로 구분하여 지급한다.</p>`
        : "";

    wageClause = `<div class="clause"><h3>제 4조 (임금)</h3>
    <p class="sub">① "을"의 급여 산정 및 지급은 <b>${wonUnit(totalWage)}</b>을 기준급여로 하여 아래와 같은 임금 항목으로 포괄하여 지급한다.</p>
    <table class="kv">${cells.join("\n    ")}</table>
    ${nonTaxNote}
    ${items
      .map((t, i) => `<p class="sub">${CIRC[i + 1]} ${t}</p>`)
      .join("\n    ")}</div>`;
  }

  // 제5조 — 휴일 (시급제는 주휴 요건을 '실근로 15시간 초과' 기준으로 표기)
  const holidayNo1 = isHourly
    ? `1. 주휴일 (1주 실근로시간이 15시간을 초과하는 주에 유급 부여)`
    : `1. 주휴일 (해당 주 소정근로일 만근 및 소정근로시간 15시간 이상인 경우 유급 부여)`;

  return `<div class="compact">${companyHead(c)}
  <div class="doc-title">근 로 계 약 서</div>
  <p class="doc-sub">${esc(title)}</p>
  <p><b>${esc(c.name)}</b> (이하 "갑"이라 한다) 과(와) 근로자 <b>${esc(e.name)}</b> (이하 "을"이라 한다) 은(는) 다음과 같은 조건으로 근로계약을 체결하고, 상호 신의의 원칙 하에 성실하게 이행, 준수할 것을 합의한다.</p>
  <p style="text-align:center" class="muted">- 다&nbsp;&nbsp;음 -</p>

  <div class="clause"><h3>제 1조 (근로계약기간)</h3>
    ${art1.map((t, i) => `<p class="sub">${CIRC[i]} ${t}</p>`).join("\n    ")}</div>

  <div class="clause"><h3>제 2조 (근무장소 및 종사할 업무)</h3>
    <p class="sub">① 근무장소: "갑"의 사업장 및 관할 장소 (${esc(c.address)})</p>
    <p class="sub">② 직책 / 업무내용: <b>${esc(e.position ?? "")}</b> / <b>${esc(e.duty ?? "")}</b></p>
    <div class="avoid"><p class="sub">③ 제1항 및 제2항에 따른 근무장소, 직책, 업무내용, 임금 등 근로조건은 "갑"의 업무상 필요성에 따라 변경이 가능함을 확인하며, 성실히 이행할 것에 동의한다.</p>
    ${inlineSign("동 의 자")}</div></div>

  <div class="clause"><h3>제 3조 (근로시간 및 휴게시간)</h3>
    ${art3Html}</div>

  ${wageClause}

  <div class="clause"><h3>제 5조 (휴일)</h3>
    <p class="sub">① 다음 각 호의 날 중 주휴일과 중복되지 아니하는 날을 유급휴일로 한다.</p>
    <p class="hosub">${holidayNo1}</p>
    <p class="hosub">2. 근로자의 날 &nbsp;&nbsp; 3. 관공서 공휴일 (일요일 제외)</p>
    <p class="sub">② 제①항의 주휴일은 근로자의 해당 주 첫 번째 비번일로 한다. 단, 업무사정에 따라 주휴일은 변경할 수 있다.</p></div>

  <div class="clause"><h3>제 6조 (연차휴가)</h3>
    <p class="sub">① "을"의 소정근로시간이 1주 15시간을 초과하는 경우 연차유급휴가를 <b>입사일 기준</b>으로 산정 및 부여한다.</p>
    <p class="sub">② "을"이 연차유급휴가를 사용하는 경우 적절한 업무 분장을 위하여 사용 희망일로부터 1주일 전 "갑"에게 사용 사실을 알리고 이에 대한 승인을 득한다.</p>
    <p class="sub">③ "갑" 사업장의 방학, 휴원 등 "갑"이 지정한 휴무일의 경우 해당 일을 연차사용으로 대체함에 동의한다.</p></div>

  <div class="clause"><h3>제 7조 (${art7Title})</h3>
    ${art7Head.map((t, i) => `<p class="sub">${CIRC[i]} ${t}</p>`).join("\n    ")}
    <p class="sub">${CIRC[art7Head.length]} "을"은 본인이 담당하는 반의 해당 학기 수업이 종료될 때까지 근무를 지속하여야 하며, "갑"이 서면으로 인정하는 불가피한 사유가 없는 한 해당 학기 종료 이전에 사직할 수 없다.</p>
    <div class="avoid"><p class="sub">${CIRC[art7Head.length + 1]} "을"이 퇴직하는 경우 퇴직 월 임금 및 발생 퇴직금은 익월 임금지급일에 일괄 지급하기로 한다.</p>
    ${inlineSign("동 의 자")}</div></div>

  <div class="clause"><h3>제 8조 (기타사항)</h3>
    <p class="sub">① "을"은 맡은 바 임무를 수행함에 있어 근면, 성실, 친절과 공정을 기하여야 한다.</p>
    <p class="sub">② "을"은 근무기간 중은 물론 근로계약종료 후에도 업무상 취득한 "갑"의 기밀을 유지하여야 한다.</p>
    <div class="avoid"><p class="sub">③ "을"은 급여액을 포함한 근로조건을 누설하지 아니하며 이를 위반할 경우 인사상 불이익을 받을 수 있음을 확인한다.</p>
    ${inlineSign("확 인 자")}</div>
    <p class="sub">④ "을"이 본 계약기간 동안 생산한 교재, 수업자료, 동영상 자료 등에 대한 지적재산권은 "갑"에게 귀속된다.</p>
    <p class="sub">⑤ "을"의 개인 사정으로 인해 영업일 기준 5일 이상 연속적으로 정상적인 수업이 불가하고, 이로 인해 "갑"이 "을"을 대체할 새로운 계약을 체결한 경우 "갑"은 본 계약을 해지할 수 있다.</p>
    <p class="sub">⑥ "을"이 고의 또는 과실로 "을"에게 할당된 수업을 진행하지 않았을 경우, 이로 인해 발생되는 모든 비용 및 손해에 대한 책임은 "을"에게 있다.</p>
    <div class="avoid"><p class="sub">⑦ 급여명세서를 이메일(${esc(e.email ?? "")})로 교부 받는 것에 동의한다.</p>
    ${inlineSign("동 의 자")}</div></div>

  <div class="doc-foot">
    <p style="text-align:center">"갑"과 "을"은 상기와 같이 근로계약을 체결하고, 계약서 2부를 작성하여 '사용자'와 '근로자' 각 1부씩 보관한다.</p>
    <div class="date-center">${ymdKo(ct.startDate)}</div>
    ${signDuo(c, e, "근로자")}
    ${handoverConfirm()}
  </div></div>`;
}

/* ===================== 강의위탁계약서 (비율제) — 원문 전문 ===================== */
function ratioContractHtml(args: {
  employee: DocEmployee;
  contract: DocContract;
  company: DocCompany;
}): string {
  const { employee: e, contract: ct, company: c } = args;
  const payday = c.payday ?? 7;
  const pctNum = (ct.ratioPercent ?? 0) * 100;
  const pct = pctNum % 1 === 0 ? pctNum.toFixed(0) : pctNum.toFixed(1);
  const noticeDays = resignNoticeDays(e);

  const sched = parseSchedule(e.schedule).filter((s) => s.work);
  const dayLabel = sched.length ? sched.map((s) => DAY_KO[s.day]).join("·") : null;
  const timeLabel = sched.length ? `${sched[0].start} ~ ${sched[0].end}` : null;
  const svcSlot = `[요일 : ${dayLabel ?? "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"}] [시간 : ${timeLabel ?? "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"}]`;

  const endPart = ct.endDate ? `<b>${ymdKo(ct.endDate)}</b>` : blank(18);

  return `<div class="compact">${companyHead(c)}
  <div class="doc-title">강의위탁계약서</div>
  <p class="doc-sub">강의위탁계약서 (비율제)</p>
  <p><b>${esc(c.name)}</b> (이하 "갑"이라 한다) 과 <b>${esc(e.name)}</b> (이하 "을"이라 한다) 은(는) 다음과 같은 조건으로 강의 위탁 계약을 체결하고, 상호 신의의 원칙 하에 성실하게 이행, 준수할 것을 합의한다.</p>
  <p style="text-align:center" class="muted">- 다&nbsp;&nbsp;음 -</p>

  <div class="clause"><h3>제 1조 (위탁계약기간)</h3>
    <p class="sub">① <b>${ymdKo(ct.startDate)}</b> 부터 ${endPart} 까지 강의 위탁 계약을 체결한 것으로 한다.</p>
    <p class="sub">② "을"의 용역조건이 변경된 경우 새로이 위탁계약서를 체결하여 변경된 용역조건을 고지하기로 한다.</p>
    <p class="sub">③ 상기 위탁 계약기간이 종료되는 경우 위탁 계약은 자동 종료되는 것으로 하며 계약 종료일 1개월 내에 쌍방이 합의함으로써 추가 연장할 수 있다.</p>
    <p class="sub">④ "갑" 또는 "을"이 제①항의 계약 유효 기간 중 본 용역 계약을 해지하려는 경우 정당한 사유와 절차에 따라야 한다. 또한, 해지성립일 <b>${noticeDays}일 전</b>에 서면으로 그 뜻을 상대방에게 통지하여야 한다.</p></div>

  <div class="clause"><h3>제 2조 (용역내용)</h3>
    <p class="sub">① "갑"은 "을"에게 강의와 수강생 유지에 필요한 상담업무 및 학사 운영에 있어 필요한 각종 제반 업무를 일괄 용역하고, "을"은 이를 신의와 성실로써 수행한다.</p>
    <p class="sub">② 원활한 서비스 제공과 용역의 수행 및 완료를 위해 "갑"과 "을"이 상호 협의하에 결정한 "용역 서비스 제공 일정 및 시간"은 다음과 같다. &nbsp;<b>${svcSlot}</b></p>
    <p class="sub">③ 용역 서비스 중 "강의"와 관련된 내용에 대한 서비스 시간은 다음과 같다. &nbsp;<b>${svcSlot}</b></p>
    <p class="sub">④ 상기 협의된 요일과 시간은 "갑"과 "을"의 상호 협의에 따라 변동될 수 있다.</p>
    <p class="sub">⑤ "을"은 "갑"으로부터 위탁받은 업무를 수행하는 독립된 사업자(Freelance)로서 근로기준법상 근로자의 지위에 해당되지 않는다. 이에 따라 "갑"의 임직원을 위한 취업 규칙 및 기타 인사/복지 관련 규정 적용을 받지 아니하며, 기타 근로자에 대한 제반 법령상 책임(가) 및 위 법령에서 정하는 보험(나)에 가입하는 비용 등은 "을"의 부담 및 책임으로 한다.</p>
    <p class="footnote">(가) : 근로기준법, 산업안전보건법, 산업재해보상보호법, 직업안정법, 고용보험법, 국민건강보험법, 기타 근로자에 대한 제반 법령상의 책임 및 위 법령</p>
    <p class="footnote">(나) : 국민건강보험, 국민연금, 고용보험, 산재보험</p></div>

  <div class="clause"><h3>제 3조 (상호약정)</h3>
    <p class="sub">① "갑"과 "을"은 본 용역 계약을 함에 있어 학생의 성적 향상, 재원생의 증대 그리고 교육서비스의 질을 높이기 위한 노력이라는 공동의 목표를 가진 수평적 관계로 규정한다.</p>
    <p class="sub">② "갑"과 "을"은 ①항에 명시한 공동의 목표를 달성하기 위해 상호 간에 활발한 소통과 건설적 제안을 통해 서로의 발전을 도모하는 관계를 유지한다.</p>
    <p class="sub">③ "갑"은 "을"이 위탁 업무 수행에 필요한 교육 시설(교실 및 교구) 제공, 사무 행정 담당, 시설 유지와 보수 관리 및 냉난방, 청소, 소모품, 공과금 등을 지원하고, "을"은 "갑"에게 원활한 서비스 제공을 위한 업무 협조를 해야 한다.</p>
    <p class="sub">④ "을"의 용역 제공 장소는 "갑"의 사업장 및 관할장소로 한정하며 상황에 따라 용역 제공 장소는 변동될 수 있다.</p>
    <p class="sub">⑤ "갑"과 "을"은 상호 협의하에 강의 방법과 강의 내용을 구성하며, "을"의 교재와 연간 강의 커리큘럼을 바탕으로 학생 및 학부모에게 "을"의 강좌를 원활하게 안내한다.</p>
    <p class="sub">⑥ "갑"은 "을"의 강의 및 교재 구성에 필요한 자료들을 합리적인 선에서 지원하며, ⑤항에 의거하여 "갑"은 "을"의 계약 기간 동안 강좌의 연간 강의 커리큘럼을 유지하기 위해 "을"의 수업 교재와 커리큘럼을 함께 공유한다.</p>
    <p class="sub">⑦ "갑"은 "을"이 담당할 수업에 대한 결정 권한을 갖고 있다.</p>
    <p class="sub">⑧ "갑"은 학원의 신입생 배정 업무에 대한 권한을 가지되 "을"에게 상호 신뢰할 수 있을 만한 공정하고, 합리적 기준으로 배정을 진행한다.</p></div>

  <div class="clause"><h3>제 4조 (의무)</h3>
    <p class="sub">① "을"은 본 계약에서 정한 용역 내용을 성실히 이행하여야 한다.</p>
    <p class="sub">② "을"은 해당 계약서 상에 기재된 "[제7조] 기밀유지 및 경업금지" 조항을 반드시 엄수해야 한다.</p></div>

  <div class="clause"><h3>제 5조 (용역수수료)</h3>
    <p class="sub">① 계약기간동안 "을"의 용역 제공 완료에 따라 지급되는 용역수수료로 "을"이 담당하는 학생의 수강료(가) 입금액을 기준으로 지급함을 원칙으로 한다.</p>
    <p class="sub">② "을"의 수수료는 수강료 입금액에서 (월) <b>${pct}%</b>를 적용한다.</p>
    <p class="sub">③ "갑"은 매월 01일부터 말일까지의 용역위탁수수료를 다음 달 ${payday}일에 사업소득세(3.0%)와 주민세(0.3%)를 공제한 후 "을"에게 지급한다.</p>
    <p class="sub">④ "을"은 독립된 자격으로 강의용역을 제공하는 것이므로 본 계약에 따른 용역위탁수수료 외 수당, 퇴직금 등을 "갑"에게 요구할 수 없으며, "갑" 또한 이를 제공할 의무가 없다.</p>
    <p class="footnote">(가) : 수강료는 D.C를 통해 공제된 금액 기준이며, D.C의 경우 쌍둥이 및 세자녀 5%, 직원 30% 할인을 기본 원칙으로 하며, 그 외 할인은 사전에 미리 협의한다. 카드수수료는 별도로 공제하지 아니한다.</p></div>

  <div class="clause"><h3>제 6조 (계약해지)</h3>
    <p class="sub">① 아래 사항에 해당 시 "갑"은 용역위탁계약을 해지할 수 있으며, "을"은 일체 이의를 제기하지 아니한다.</p>
    <p class="hosub">㉮ "을"이 제공한 용역서비스로 인해 "갑"의 고객들로부터 심각한 불만사항이 제기된 경우</p>
    <p class="hosub">㉯ "을"이 용역제공과 관련한 "갑"의 정당한 요구사항을 합의 없이 거부 또는 위반한 경우</p>
    <p class="hosub">㉰ "을"이 용역서비스를 제공하면서 "갑"의 고객 및 잠재 고객을 타 학원으로 유인 및 개인교습을 한 경우</p>
    <p class="hosub">㉱ "을"의 비행(폭행, 폭언, 성추행, 범죄 등), 질병, 사생활 문제, 기타 일신상의 사유로 "을"이 용역서비스제공자로서 해당 업무를 수행하기 곤란하다 인정될 경우</p>
    <p class="sub">② 해지 사유 중 "을"이 고의나, 중대한 과실 또는 과도한 체벌, 성추행 등으로 "갑"이 운영하는 학원에 손해를 끼쳤을 경우 "갑"은 "을"에게 계약해지 및 손해배상을 청구할 수 있다.</p></div>

  <div class="clause"><h3>제 7조 (기밀유지 및 경업금지)</h3>
    <p class="sub">① "을"은 계약 기간 중 또는 기간 만료 후에도 '계약 기간 중 취득한 업무상 비밀'을 일체 누설하지 아니한다. 이때 '계약 기간 중 취득한 업무상 비밀'은 영업에 즉시 활용 가능한 세부정보 및 누설 시 "갑"의 영업장에 직·간접적으로 피해를 끼칠 수 있는 정보로서 용역 계약 내용 및 수입, 원생의 학교, 학년, 학업수준, 지금까지 수강한 강좌 내용 등 원생 정보, 학부모 연락처, 상담 내용 및 이에 준하는 정보 일체를 의미한다.</p>
    <p class="sub">② "을"은 계약상의 의무를 준수하고, 다음 각호의 행위를 해서는 안된다.</p>
    <p class="hosub">㉮ '계약 기간 중 취득한 업무상 비밀'을 제3자에게 "갑"의 동의 없이 유출 또는 제공(유/무상 불문)하거나, 이용하여 "갑"의 학원생을 타 학원 또는 과외 수강생으로 모집 유인하는 행위</p>
    <p class="hosub">㉯ "갑"의 교육, 영업 컨텐츠(유/무형 자료 일체 포함)를 도용하여 타 학원 등에서 활용하는 행위</p>
    <p class="sub">③ "갑"의 영업권 보호를 위하여 "을"은 계약 종료 직후 6개월 간 하남시 미사지구에서 학원(교습소)을 개원(운영)하거나 다른 학원에서 근무를 하지 않아야 한다. "갑"의 영업권 보호 근거로 제7조 ①, ②항을 제시한다.</p>
    <p class="sub">④ 만약 "을"이 제7조 ①, ②, ③항 위반 시 "갑"의 영업권을 침해하는 것으로 보며, 위약금과 위약벌로 "갑"에게 3,000만원을 지급하여야 한다.</p></div>

  <div class="clause"><h3>제 8조 (기타사항)</h3>
    <p class="sub">① "을"은 맡은 바 임무를 수행함에 있어 근면, 성실, 친절과 공정을 기하여야 한다.</p>
    <p class="sub">② "을"은 본 위탁계약내용을 누설하지 아니하며 이를 위반하여 "갑"의 사업장 내에 분쟁을 일으킬 경우 "갑"은 "을"에게 손해배상을 청구할 수 있다.</p>
    <p class="sub">③ "을"이 본 계약기간 동안 생산한 교재 및 수업 자료 등에 대한 관리 주체는 "갑"에게 있다.</p></div>

  <div class="doc-foot">
    <p style="text-align:center">"갑"과 "을"은 상기와 같이 강의위탁계약을 체결하고, 계약서 2부를 작성하여 각각 서명 날인 후 각 1부씩 보관한다.</p>
    <div class="date-center">${ymdKo(ct.startDate)}</div>
    ${signDuo(c, e, "수탁자")}
    ${handoverConfirm()}
  </div></div>`;
}

/* ================== 인센티브 산정 계약서 (강사) — 별지, 원문 전문 ================== */
export function incentiveContractHtml(args: {
  employee: DocEmployee;
  contract: DocContract;
  company: DocCompany;
}): string {
  const { employee: e, contract: ct, company: c } = args;
  const payday = c.payday ?? 7;
  const threshold = ct.incThreshold ?? null;
  const perStudent = ct.incPerStudent ?? null;
  // 매출 비율 인센티브 — 인원 기준과 다른 갈래라 정해져 있을 때만 조항을 붙인다
  const revPct = ct.incRevenuePercent ?? null;
  const revPctTxt = revPct != null ? `${(revPct * 100).toFixed(2).replace(/\.?0+$/, "")}%` : null;

  return `<div class="compact">${companyHead(c)}
  <div class="doc-title">인센티브 산정 계약서</div>
  <p><b>${esc(c.name)}</b> (이하 "갑"이라 한다) 과 근로자 <b>${esc(e.name)}</b> (이하 "을"이라 한다) 은 다음과 같은 조건으로 인센티브 계약을 체결하고, 상호 신의의 원칙 하에 성실하게 이행, 준수할 것을 합의한다.</p>
  <p style="text-align:center" class="muted">- 다&nbsp;&nbsp;음 -</p>

  <div class="clause"><h3>제 1조 (목적)</h3>
    <p class="sub">이 규정은 "을"의 인센티브에 관한 사항을 정함을 목적으로 한다.</p></div>

  <div class="clause"><h3>제 2조 (인센티브 약정 기간)</h3>
    <p class="sub"><b>${ymdKo(ct.startDate)}</b> 부터 신규 계약 체결일 까지로 한다.</p></div>

  <div class="clause"><h3>제 3조 (인센티브의 산정방법)</h3>
    <p class="sub">① "을"이 담당한 원생 중 "갑"과 "을"의 협의에 따라 정한 기준 인원수를 초과한 경우 초과 원생수 1인당 기준금액을 곱한 금액에서 퇴직금 귀속분을 제외한 나머지 금액을 인센티브로 지급한다.</p>
    <table class="kv"><tr><th>기준 인원수</th><td>${threshold != null ? `${threshold}명` : blank(8)}</td><th>기준 금액</th><td>${perStudent != null ? `${won(perStudent)}원` : blank(10)}</td></tr></table>
    ${
      revPctTxt
        ? `<p class="sub">② "을"이 담당한 원생의 해당 월 수강료 매출에 아래 배분율을 곱한 금액을 인센티브로 지급한다. 월 중간에 입학·전출·퇴원한 원생의 수강료는 실제 수업 회차에 비례하여 산정한다.</p>
    <table class="kv"><tr><th>매출 배분율</th><td colspan="3"><b>${esc(revPctTxt)}</b> <span class="muted">(담당 원생 수강료 매출 × ${esc(revPctTxt)})</span></td></tr></table>
    <p class="sub">③ 상기 인센티브 측정 단가는 "갑"과 "을"의 합의에 따라 변경될 수 있으며, 인센티브 변경 시 본 계약서를 갱신 작성하기로 한다.</p>`
        : `<p class="sub">② 상기 인센티브 측정 단가는 "갑"과 "을"의 합의에 따라 변경될 수 있으며, 인센티브 변경 시 본 계약서를 갱신 작성하기로 한다.</p>`
    }</div>

  <div class="clause"><h3>제 4조 (인센티브의 지급방법)</h3>
    <p class="sub">① "갑"은 "을"에게 제3조 제1항에 따라 산정된 인센티브를 매월 초일부터 말일까지 기산하여, 익월 ${payday}일에 "을" 명의의 통장으로 지급한다. 단, 해당 지급일이 휴일인 경우 지급일 전일에 지급하기로 한다.</p>
    <div class="avoid"><p class="sub">② "을"이 월 도중 퇴사하는 경우 해당 월 인센티브는 지급하지 아니한다.</p>
    ${inlineSign("동 의 자")}</div></div>

  <div class="clause"><h3>제 5조 (비밀유지)</h3>
    <p class="sub">"을"은 자신의 보수를 타인에게 알려주거나, 타인의 보수를 알려고 하는 행위를 하지 아니한다. "을"이 이를 위반할 경우 "갑"은 "을"에 대하여 징계 처분할 수 있다.</p></div>

  <div class="clause"><h3>제 6조 (퇴직유보금)</h3>
    <p class="sub">① "갑"은 "을"에게 지급한 인센티브 원천액의 <b>8.3%</b>를 퇴직유보금으로 별도 지급하며, 이는 "을"이 1년 이상 근무하고 퇴직하는 경우 지급 받게 될 본 인센티브 계약에 대한 퇴직금을 대체한다.</p>
    <p class="sub">② "을"이 1년 미만 근무함에 따라 퇴직금 및 퇴직연금 지급 대상에 해당하지 아니하는 경우에도 "을"에게 기 지급한 퇴직유보금을 회수하지 아니한다.</p>
    <div class="avoid"><p class="sub">③ 제6조 제1항에 따라 "갑"이 "을"의 근무 기간 중 분할 지급한 퇴직유보금은 본 인센티브 계약에 대한 퇴직금과 동일한 효력을 지닌다.</p>
    ${inlineSign("동 의 자")}</div></div>

  <div class="doc-foot">
    <p style="text-align:center">"갑"과 "을"은 상기와 같이 인센티브 지급계약을 체결하고, 2부를 작성하여 '사용자'와 '근로자' 각 1부씩 보관한다.</p>
    <div class="date-center">${ymdKo(ct.startDate)}</div>
    <p class="small" style="text-align:right">본 계약서를 서면으로 교부받았기에 아래와 같이 서명합니다.</p>
    ${signDuo(c, e, "근로자")}
  </div></div>`;
}

/** 계약서 본문 페이지 목록 (인센티브 계약은 별지 「인센티브 산정 계약서」 포함) */
/**
 * 계약서 세트 — 계약서 + 그 계약의 성질상 함께 받아야 하는 확인서.
 *
 * **갱신계약에서도 그대로 붙는다.** 신규입사 때는 해당이 없다가 갱신하면서 인센티브·비율제나
 * 위탁계약으로 바뀌는 일이 있는데, 그때 확인서를 따로 챙기지 않으면 근거 없이 유보금을 떼거나
 * 위탁으로 처리하게 된다. 그래서 계약 조건을 보고 그 자리에서 함께 낸다.
 *
 * **서로 다른 서류라 묶음(DocGroup)으로 나눠 돌려준다** — 쪽번호·이니셜란·간인은 한 건의
 * 서류 안에서만 뜻이 있기 때문이다. 근로계약서와 별지는 한 건이지만, 확인서는 을이 혼자
 * 내는 별개 서류다.
 */
export function contractGroups(args: {
  employee: DocEmployee;
  contract: DocContract;
  company: DocCompany;
  /** 양자 서명 서류에 줄 조판 옵션 (간인·각 장 이니셜란·쪽번호) */
  bilateralOpts?: PdfOptions;
}): DocGroup[] {
  const { employee, company, contract, bilateralOpts } = args;
  const scheme = paySchemeOfTemplate(contract.templateKey) ?? employee.payScheme;

  // ① 양자가 서명하는 서류 — **각각이 별개의 서명 문서**라 묶음을 따로 둔다.
  //    한 묶음으로 합치면 근로계약서의 마지막 장(양자 서명란이 있는 장)에도 이니셜란이 붙고
  //    쪽번호가 별지까지 이어져 `2 / 3` 처럼 매겨진다.
  const groups: DocGroup[] = [{ bodies: [contractHtml(args)], opts: bilateralOpts ?? {} }];
  if (scheme === "INCENTIVE")
    groups.push({ bodies: [incentiveContractHtml(args)], opts: bilateralOpts ?? {} });

  // ② 확인서 — 을이 혼자 내는 서류라 갑의 서명이 없다. 이니셜란·쪽번호를 붙이지 않는다.
  const solo: string[] = [];
  // 퇴직유보금 확인서 — 인센티브·비율제. 유보금을 떼는 근거가 이 확인서다.
  if (scheme === "INCENTIVE" || scheme === "RATIO")
    solo.push(confirmRetentionHtml({ employee, company }));
  // 개인사업자 지위 확인서 — 위탁계약(프리랜서). 완전비율제는 성질상 언제나 위탁이다.
  if (contract.isContractor === true || scheme === "RATIO")
    solo.push(confirmSoleProprietorHtml({ employee, company }));
  if (solo.length) groups.push({ bodies: solo });

  return groups;
}

/** 계약서 세트의 본문만 평평하게 (묶음 구분이 필요 없는 곳·테스트용) */
export function contractBodies(args: {
  employee: DocEmployee;
  contract: DocContract;
  company: DocCompany;
}): string[] {
  return contractGroups(args).flatMap((g) => g.bodies);
}

/* ============================ 복무서약서 ============================ */
export function pledgeServiceHtml(args: { employee: DocEmployee; company: DocCompany; date?: Date }): string {
  const { employee: e, company: c } = args;
  const items = [
    "회사의 제반 규정을 준수하고 상사의 정당한 명령에 복종하며 담당 직무를 성실히 수행하겠습니다.",
    "교육자로서 사명감을 가지고 안전사고에 유의하며, 학생을 성실하게 지도하겠습니다.",
    "학생 지도 중 폭력이나 부적절한 언행 등을 하지 않겠습니다.",
    "학생 상담 시 원생들의 가치관에 영향을 미칠 수 있는 업무상 필요 외의 사담을 하지 않겠습니다.",
    "담당 학생을 상대로 개인 교습행위를 하지 아니하겠습니다.",
    "경쟁영업 행위 또는 회사의 허락 없는 부업 행위를 하지 않겠습니다.",
    "동료 강사나 원을 비방하는 행위를 하지 아니하겠습니다.",
    "동료 강사나 수강생에게 성추행·성폭력·성희롱·괴롭힘을 하지 아니하겠습니다.",
    "업무상 또는 업무 외로 습득한 회사의 기밀을 함부로 누설하여 회사에 손해를 끼치지 않겠습니다.",
    "회사의 금전·물품을 사사로이 이용하거나 회사 업무를 빙자하여 개인의 이익을 도모하는 등 일체의 부정행위를 하지 않겠습니다.",
    "학생·학부모 상담 시 정확한 내용만을 적절한 어휘로 전달하겠습니다.",
    "학원에서 개인별로 지정한 횟수 이상 담당 원생의 학부모와 유선상담을 수행하겠습니다.",
    "학원의 연간 이벤트를 준비하는 데 적극적으로 협조하겠습니다.",
    "수업시간 중 업무 외 목적으로 개인 핸드폰을 사용하지 않겠습니다.",
    "정해진 레슨플랜을 준수하고 효율적인 교수를 위한 그룹대화 및 직원회의에 적극 참여하겠습니다.",
    "위 사항을 고의나 중대한 과실로 위반하여 회사에 손해를 끼치는 등 사규에 위배되는 행위를 하였을 때는 민·형사상 어떠한 처벌이나 배상 책임도 이의 없이 감수하겠습니다.",
  ];
  const date = args.date ?? new Date();
  return `${companyHead(c)}
  <div class="doc-title">복 무 서 약 서</div>
  <p><b>${esc(e.name)}</b> (이하 "을") 은(는) 재직기간 중 아래 사항을 준수할 것을 서약합니다.</p>
  <p style="text-align:center" class="muted">- 아 래 -</p>
  <div class="clause">
    ${items.map((t, i) => `<p class="list-num">${i + 1}. ${esc(t)}</p>`).join("")}
  </div>
  <div class="doc-foot">
    <div class="date-center">${ymdKo(date)}</div>
    <div class="sign-area">
      <div class="sign-box"><div class="sign-grid">
        ${sigField("서약자", e.name, true)}${sigField("생년월일", e.birth)}
        <div class="full">${sigField("주소", e.address)}</div>
        ${sigField("연락처", e.phone)}
      </div></div>
      <div style="text-align:right;margin-top:12px;font-weight:700"><b>${esc(c.name)}</b> 대표 ${esc(c.ceo)} 귀하</div>
    </div>
  </div>`;
}

/**
 * **개인정보를 국외에서 처리(위탁·보관)하는 사업자.**
 *
 * 인사 시스템이 실제로 개인정보를 보내는 곳만 적는다 — 안 보내는 곳을 적으면
 * 사실과 다른 고지가 되고, 보내는 곳을 빠뜨리면 고지 의무를 지키지 못한다.
 * 새 연동을 붙이면 **여기에 함께 적어야 한다**.
 *
 * ⚠ 생성형 AI(Claude·ChatGPT 등)는 여기 없다 — 이 앱은 어떤 AI API 도 호출하지 않는다.
 * 코드를 사람이 AI 의 도움으로 작성한 것과, 앱이 직원 정보를 AI 에 보내는 것은 다른 이야기다.
 * 다만 **담당자가 직원 정보를 직접 AI 서비스에 입력한다면** 그건 별도의 국외 이전이므로
 * 그때는 이 표에 추가하고 이용 방침을 따로 정해야 한다.
 */
export const OVERSEAS_PROCESSORS: Array<{
  name: string;
  country: string;
  purpose: string;
  items: string;
}> = [
  {
    name: "Vercel Inc.",
    country: "미국",
    purpose: "인사 시스템(웹) 운영·호스팅",
    items: "시스템 이용 과정에서 처리되는 인사정보 일체",
  },
  {
    name: "Supabase Inc.",
    country: "미국(데이터베이스 소재 리전에 따름)",
    purpose: "인사정보 데이터베이스 보관",
    items: "인사기록·급여·계약 정보(주민등록번호·계좌번호는 암호화 보관)",
  },
  {
    name: "Slack Technologies, LLC",
    country: "미국",
    purpose: "연차·보강 신청 및 안내 메시지 발송",
    items: "성명, 소속, 연차·보강 신청 내역, 잔여 연차",
  },
  {
    name: "Google LLC",
    country: "미국",
    purpose: "연차·보강 일정 공유(구글 캘린더)",
    items: "성명, 휴가·보강 일자",
  },
];

/**
 * 국외 처리(위탁·보관) 안내.
 *
 * **동의가 아니라 '고지' 다.** 「개인정보 보호법」 제28조의8 제1항 제3호는 계약의 체결·이행을
 * 위해 개인정보의 **처리위탁·보관**이 필요한 경우, 같은 조 제2항의 사항을 알리면 별도 동의
 * 없이 국외 이전을 할 수 있게 한다. 동의를 근거로 삼으면 직원이 동의를 철회했을 때
 * 그 사람만 슬랙·캘린더에서 빼야 하는데, 그건 실무가 돌아가지 않는다.
 * 대신 **고지받았다는 확인**을 받아 알린 사실을 남긴다.
 */
function overseasNoticeBox(): string {
  const rows = OVERSEAS_PROCESSORS.map(
    (p) =>
      `<tr><td>${esc(p.name)}</td><td>${esc(p.country)}</td><td>${esc(p.purpose)}</td><td>${esc(p.items)}</td></tr>`
  ).join("");
  // `avoid` — 상자가 쪽 경계에 걸리면 테두리가 두 쪽으로 잘려 한 항목으로 안 읽힌다.
  // 통째로 다음 장으로 넘어가는 편이 낫다(동의서는 원래도 서명란까지 두 장이 된다).
  return `<div class="avoid" style="border:1px solid #999;padding:8px 10px;margin:8px 0;">
    <div style="font-weight:700;margin-bottom:4px">□ 개인정보의 국외 처리(위탁·보관)에 관한 안내</div>
    <div class="small" style="margin-bottom:4px">회사는 인사·급여 업무를 전산으로 처리하기 위하여 아래 사업자에게 개인정보의 처리를 위탁하며, 그 과정에서 개인정보가 국외에 보관될 수 있습니다. 「개인정보 보호법」 제28조의8 제1항 제3호에 따라 아래와 같이 알려드립니다.</div>
    <table class="kv" style="margin:0;font-size:11px">
      <thead><tr><th>이전받는 자</th><th>국가</th><th>이용 목적</th><th>이전 항목</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="small" style="margin-top:4px">· <b>이전 시기·방법</b>: 인사 시스템 이용 시 정보통신망을 통하여 수시로 이전<br>
    · <b>보유·이용 기간</b>: 위탁계약 종료 시 또는 회사의 개인정보 보유기간 종료 시까지<br>
    · <b>거부 방법·효과</b>: 회사에 서면으로 요구하여 거부할 수 있으나, 이 경우 전산 인사·급여 처리가 제한되어 급여명세서 교부·연차 신청 등 일부 업무를 수기로 처리하게 됩니다.<br>
    · 이 항목은 <b>동의를 받는 것이 아니라 알려드리는 것</b>이며, 위 사항은 「개인정보 보호법」 제28조의8 제2항에 따른 고지사항입니다.</div>
    <div class="small" style="margin-top:4px">※ 위 사항을 고지받아 확인하였습니다. ( 확인 : ______ )</div>
  </div>`;
}

/* ======================= 개인정보 수집·이용·제공 동의서 ======================= */
export function consentPrivacyHtml(args: { employee: DocEmployee; company: DocCompany; date?: Date }): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  const box = (title: string) => `<div style="border:1px solid #999;padding:8px 10px;margin:8px 0;">
    <div style="font-weight:700;margin-bottom:4px">□ ${title}</div>
    <table class="kv" style="margin:0">
      <tr><th>수집·이용 목적</th><td>회사 업무상 필요(인사관리, 관계관청 제출 등)에 사용</td></tr>
      <tr><th>정보 항목</th><td>주민등록번호, 주소, 핸드폰번호, 전자우편, 학력, 경력, 가족사항, 병역사항</td></tr>
      <tr><th>보유·이용 기간</th><td>수집 동의일부터 수집·이용 목적을 달성한 날까지</td></tr>
      <tr><th>수집·이용하는 자</th><td>회사 대표자</td></tr>
    </table>
    <div class="small" style="margin-top:4px">※ 위 사항에 대하여 설명을 받고 이해하였으며, 회사가 위 개인정보를 처리하는 것에 동의합니다. ( 동의 : ______ )</div>
  </div>`;
  return `${companyHead(c)}
  <div class="doc-title">개인정보 수집·이용·제공 동의서</div>
  <p><b>${esc(c.name)}</b> (이하 "갑") 와 <b>${esc(e.name)}</b> (이하 "을") 은(는) 개인정보 수집 및 이용에 관하여 다음 사항에 동의합니다.</p>
  <p class="list-num">1. 본인은 회사가 「개인정보보호법」 제15조·제17조·제18조 규정 등에 따라 본인에 관한 정보자료를 인사관리에 활용하고 업무상 필요에 따라 관계기관에 제공하는 데 동의하며, 본 동의서가 근무기간뿐 아니라 퇴직 후 일정기간 적용·보관될 수 있음을 확인합니다.</p>
  <p class="list-num">2. 서명날인한 동의서의 복사본은 원본과 동일하게 유효함을 확인합니다.</p>
  <p class="list-num">3. 동의를 거부할 권리가 있으며, 동의 거부에 따른 불이익(채용 거부, 인사고과, 복리후생 제외 등)이 있을 수 있음을 확인합니다.</p>
  ${box("개인정보 수집에 관한 동의")}
  ${box("개인정보 이용 및 제공에 관한 동의")}
  <div style="border:1px solid #999;padding:8px 10px;margin:8px 0;">
    <div style="font-weight:700;margin-bottom:4px">□ 고유식별정보의 처리에 관한 동의</div>
    <div class="small">회사가 본인의 고유식별정보(주민등록번호, 운전면허번호, 외국인등록번호, 여권번호)를 「개인정보보호법」 제24조에 따라 수집·이용·제공 등 처리하는 데 동의합니다. ( 동의 : ______ )</div>
  </div>
  ${overseasNoticeBox()}
  <div class="doc-foot">
    <div class="date-center">${ymdKo(date)}</div>
    <div class="sign-area">
      <div class="sign-box"><div class="sign-grid">
        ${sigField("동의자", e.name, true)}${sigField("주민등록번호", maskRRN(e.rrn) || null)}
        <div class="full">${sigField("주소", e.address)}</div>
        ${sigField("연락처", e.phone)}
      </div></div>
    </div>
  </div>`;
}

/* ============================ 임금공제 동의서 ============================ */
export function consentDeductionHtml(args: { employee: DocEmployee; company: DocCompany; date?: Date }): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  return `${companyHead(c)}
  <div class="doc-title">임 금 공 제 동 의 서</div>
  <p><b>${esc(e.name)}</b> (이하 "을") 은(는) 아래 항목에 대하여 매월 임금에서 공제하는 것에 동의합니다.</p>
  <table class="kv">
    <tr><th>공제 항목</th><td>4대보험(국민연금·건강보험·고용보험·장기요양) 근로자 부담분, 근로소득세 및 지방소득세 (사업소득자의 경우 원천징수 3.3%)</td></tr>
    <tr><th>공제 사유</th><td>법령에 따른 원천징수 및 사회보험료 납부</td></tr>
    <tr><th>정산</th><td>과·오납 발생 시 익월 임금에서 정산함에 동의</td></tr>
  </table>
  <p class="small">※ 본 동의는 근로기준법 제43조(임금 전액지급의 원칙)의 예외로서, 법령에 근거하지 않은 임의공제에는 적용되지 아니합니다.</p>
  <div class="doc-foot">
    <div class="date-center">${ymdKo(date)}</div>
    <div class="sign-area">
      <div class="sign-box"><div class="sign-grid">
        ${sigField("동의자", e.name, true)}${sigField("생년월일", e.birth)}
      </div></div>
      <div style="text-align:right;margin-top:12px;font-weight:700"><b>${esc(c.name)}</b> 대표 ${esc(c.ceo)} 귀하</div>
    </div>
  </div>`;
}

/* ========================== 복무서약서-II (강의 운영) ========================== */
/**
 * 강의 시간표·반 배정·교재 선정 등 **강의 운영에 관한 회사 권한**을 확인하는 서약.
 * 강의를 맡지 않는 부서에는 뜻이 없으므로 부서 정책(`docPledgeServiceII`)으로 가른다.
 */
export function pledgeServiceIIHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  date?: Date;
}): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  const sub = (items: string[]) =>
    items.map((t, i) => `<p class="sub-item">${"가나다라마바사아자차".charAt(i)}. ${esc(t)}</p>`).join("");

  // 조항이 많아 한 장을 넘기기 쉬우므로 compact 로 조판한다 (계약서와 같은 방식)
  return `<div class="compact">${companyHead(c)}
  <div class="doc-title">복무서약서 - II</div>
  <p><b>${esc(c.name)}</b> (이하 "회사") 와 <b>${esc(e.name)}</b> (이하 "본인") 은(는) 재직기간 중 아래 사항을 준수할 것을 서약합니다.</p>
  <p style="text-align:center" class="muted">- 아 래 -</p>

  <div class="clause">
    <p class="list-num">1. 본인은 근로계약서 정해진 근로계약범위 내에서 진행되는 강의와 관련한 아래의 모든 사항들은 <b>회사의 고유 권한</b>임에 동의하며, 정당한 사유 없이 회사가 정한 내용에 대해 불복하지 아니한다.</p>
    ${sub([
      "강의 시간표 (강의 시간, 강의 대상 학교, 강의 대상 학년, 강의 대상 레벨 등 반구성과 관련된 일체)",
      "기존 수강생의 반 배정 및 반 이동",
      "신규 등록 수강생의 반 배정",
      "회사 내 신규반의 개설 혹은 기존반의 폐지에 따른 본인 담당 수강생의 전출 및 전입",
      "강의 시간표의 변동 (정기적 혹은 비정기적 변동 모두 포함)",
    ])}

    <p class="list-num">2. 본인은 아래의 사항들은 회사의 고유 권한에 동의하며 정당한 사유 없이 회사가 정한 내용에 대해 불복하지 아니한다. 단, 회사의 요청 또는 필요에 의해 그 내용의 일부 또는 전부를 본인에게 위임할 수 있음을 동의한다.</p>
    ${sub(["강의 교재의 선정", "강의의 커리큘럼 구성", "강의 내 각 영역별 시간 배분 및 휴식시간 부여"])}

    <p class="list-num">3. 본인은 회사의 발전과 담당 학생의 성적 향상을 위해 회사 또는 상사가 지시하는 정당한 업무지시를 반드시 따를 것이며, 그 지시의 이행이 본인의 이득에 부합되지 않는다는 이유만으로 불복하지 아니한다.</p>
    <p class="list-num">4. 본인은 회사가 지정한 직원으로서의 역할과 업무를 성실히 수행하여야 한다. 다만 업무상 필요성이 인정되는 경우 회사는 본인의 직무내용을 변경할 수 있으며 본인은 정당한 이유 없이 이를 거부하지 아니한다.</p>
    <p class="list-num">5. 본인은 회사의 절차서 및 운영 지침 등에 의거하여 정해진 업무를 성실히 수행하여야 하며 회사의 업무지시 및 취업규칙에 정한 사항을 성실히 이행한다.</p>

    <p class="list-num">6. 본인은 회사 내 원생수가 부족하거나 기타 다른 사유로 인해 상호 합의된 정규 수업 시수를 채우지 못하고, 공강이 발생될 수 있음을 인지하고 있으며 이 경우 아래와 같은 조치가 이뤄질 수 있고, 그 어떠한 조치에 대해서도 동의하고 따른다.</p>
    ${sub([
      "수업 및 교재 연구",
      "담임으로써 담당하는 학생에 대한 개별 상담, 보강 및 관리",
      "정규 수업 외 재원생 홀딩 및 신규생 유치를 위한 목적의 특강 (이 경우 해당 특강을 수강하는 학생은 담당학생 수에 카운팅되지 아니한다)",
    ])}

    <p class="list-num">7. 본인은 회사의 교직원으로서 품위유지와 함께 언행에 신중하며 아래의 사항을 지키도록 한다.</p>
    ${sub([
      "회사의 운영방침 및 학사행정에 적극 협조한다.",
      "수업시간을 반드시 준수하고, 수업준비를 철저히 한다.",
      "수업 중 특별한 사유 없이 강의실을 이탈하지 아니한다.",
      "신체적으로 특별히 불편한 증세가 없는 한 수업은 서서하는 것을 원칙으로 한다.",
      "회사에서 실시하는 회의는 특별한 사유가 없는 한 반드시 참여한다.",
      "교재연구와 수업 외에 회사의 교육과 운영의 발전에 관한 업무가 있을 시 최선을 다해 참여한다.",
      "업의 특성에 맞도록 개개인의 개성을 고려하되 선생님으로서의 품위와 예의를 갖춘 근무복장을 착용한다.",
      "강사 또는 직원간의 모함 및 비방으로 분쟁을 일으키지 아니한다.",
      "강사 또는 직원과 연합하여 회사, 상사 또는 타 동료 강사 및 직원을 모함하거나 비방하는 행위를 하지 아니한다.",
    ])}

    <p class="list-num">8. 본인이 본 서약서에 정한 행위를 고의 또는 과실로 이행하지 아니할 경우 징계 대상이 될 수 있으며 인사 고과 및 급여 책정 등에서 불이익을 당할 수 있다.</p>
  </div>

  ${pledgeSignFoot(e, c, date, "서약자")}</div>`;
}

/* ============================== 보안 서약서 ============================== */
/**
 * 영업비밀 보호 서약. **전 직원**이 쓰되, 제3조의 **경업금지(반경 2km 취업·운영 금지)** 만
 * 부서 정책(`docNonCompete`)으로 가른다 — 직업선택의 자유를 제한하는 조항이라
 * 고객·원생 관계를 실제로 쥐는 자리에만 붙이는 것이 법적으로도 안전하다.
 */
export function pledgeSecurityHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  /** 경업금지(반경 2km) 조항을 넣을지 — 부서 정책 */
  nonCompete: boolean;
  date?: Date;
}): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  const sub = (items: string[]) =>
    items.map((t, i) => `<p class="sub-item">${"가나다라마바사아자차".charAt(i)}. ${esc(t)}</p>`).join("");

  const afterTerm = [
    "제2조 각 호에 해당하는 행위",
    "회사 소속 원생 또는 원생이었던 자 및 이들의 학부모에게 영업활동을 하여 원생을 유인 또는 유혹하여 본인 또는 제3자의 이익을 취득하는 행위",
    "회사 소속 강사 또는 강사이었던 자들에게 영업활동을 하여 원생을 유인 또는 유혹하여 본인 또는 제3자의 이익을 취득하는 행위",
  ];
  if (args.nonCompete) afterTerm.push("회사 반경 2km 내에서 동일직종에 취업 또는 경영하는 행위");

  // 9개 조항 + 하위 항목이라 기본 조판으로는 한 장을 넘겨 서명란만 2장으로 밀린다
  return `<div class="compact">${companyHead(c)}
  <div class="doc-title">보 안 서 약 서</div>
  <p><b>${esc(c.name)}</b> (이하 "회사") 와 <b>${esc(e.name)}</b> (이하 "본인") 은(는) 회사의 발전과 본인의 성장을 위해 최선을 다해 근무하며, 회사의 경영상 비밀을 보호하기 위하여 다음과 같은 사항을 준수할 것을 서약합니다.</p>

  <div class="clause">
    <p class="list-num">1. 본인은 업무를 수행함에 있어서 지득한 고객 혹은 제3자에 관한 정보, 고객관리 방법, 시스템 개발 방법, 판매방법 그 밖에 영업활동에 유용한 기술상 또는 경영상 정보(이하 "영업비밀") 등 산업재산권 제반규정 전반 및 이와 관계된 사항을 취급·보안 등을 행하는 영업비밀담당자(영업비밀 준수 의무자)임을 확인한다.</p>

    <p class="list-num">2. 본인은 회사 재직기간 중 다음 각 호의 행위를 하지 아니한다.</p>
    ${sub([
      "본인의 소관 업무 이외의 회사의 영업비밀을 기망 등의 부정한 수단으로 취득하는 행위",
      "영업비밀을 본인 또는 제3자의 이익을 위하여 사용하는 행위",
      "영업비밀을 제3자에게 공개하는 행위 (본인 또는 제3자 이익 취득 불문)",
      "자격 없는 자에게 영업비밀을 관리하게 하는 행위",
      "자격 없는 자가 영업비밀을 취득하려고 하거나 공개하는 행위를 과실로 막지 못한 행위",
      "영업비밀을 제3자의 이익을 위하여 사용하는 행위",
    ])}

    <p class="list-num">3. 본인은 <b>근로계약 종료 후 6개월</b> 동안 다음 각 호의 행위를 하지 아니한다.</p>
    ${sub(afterTerm)}

    <p class="list-num">4. 본인은 업무 수행에 따라 사용하던 서적, 메모, 각서, 매뉴얼, 노트북, 외장하드, USB, 도안, 산출내역, 각종 기록 및 문서 등에 기재된 정보(사본을 포함한다)는 회사의 독점적인 재산임에 동의하고 회사가 이를 요구할 경우에는 언제든지 이를 제출하여야 한다. 이 경우 정보가 기재된 노트북, 서류 등이 개인 소유인 경우에도 회사의 요청이 있는 경우 이를 제출한다.</p>
    <p class="list-num">5. 회사내 E-mail 사용과 관련하여 회사에 손해를 끼칠 수 있는 기술 및 경영정보의 유출을 방지하기 위하여 회사의 메일 통제 및 검열에 동의한다.</p>
    <p class="list-num">6. 업무상 사용하던 노트북, 외장하드, USB 등의 전자기록 장치의 기록을 임의로 삭제, 변경, 수정 등의 행위를 하여서는 아니 된다.</p>
    <p class="list-num">7. 본인이 본 서약서에 정한 행위를 고의 또는 과실로 이행하지 아니할 경우 「민법」, 「상법」, 「부정경쟁방지 및 영업비밀보호 등에 관한 법률」 등 관계 법령에 의한 손해배상 책임을 부담한다.</p>
    <p class="list-num">8. 상기 행위가 「형법」, 「부정경쟁방지 및 영업비밀보호 등에 관한 법률」 등 관계 법령에 의한 범죄의 구성요건에 해당할 경우 위법성 조각 사유를 주장하지 아니한다.</p>
    <p class="list-num">9. 상기 행위에 대하여 회사가 본인을 상대로 민/형사상 소송을 제기할 경우 해당 소의 반소 또는 수사기관에 진정 및 고소 등 회사의 조치에 이의를 제기하지 아니한다.</p>
  </div>

  ${pledgeSignFoot(e, c, date, "서약자")}</div>`;
}

/* ========================== 프로필 홍보 동의서 ========================== */
export function consentPromotionHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  date?: Date;
}): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  return `${companyHead(c)}
  <div class="doc-title">확 인 서</div>
  <p style="text-align:center" class="muted">(프로필 홍보 활용 동의)</p>
  <p><b>${esc(c.name)}</b> (이하 "갑") 과 근로자 <b>${esc(e.name)}</b> 은(는) 아래와 같이 확인, 확약합니다.</p>
  <p style="text-align:center" class="muted">- 아 래 -</p>

  <div class="clause">
    <p class="list-num">1. 본인 <b>${esc(e.name)}</b> 은(는) 아래의 개인정보가 학원 홍보용 자료로 사용되는 것에 동의합니다.</p>
    <p class="sub-item">· 출신학교 및 전공</p>
    <p class="sub-item">· 강사 경력</p>
    <p class="sub-item">· 프로필 사진</p>
    <p class="list-num">2. 위의 정보가 포함된 학원 홍보용 자료는 온라인(블로그, 인스타그램, 맘까페 등), 오프라인(학원 내부 및 옥외 게시물, 가이던스 자료, 브로셔 자료 등) 등에 활용됨에 동의합니다.</p>
    <p class="list-num">3. 홍보자료의 특성 상 <b>퇴사 후에라도 일정기간(최대 1년)</b> 지속적으로 위의 정보가 게시될 수 있음을 인지하고 있으며 이에 대해 동의합니다.</p>
  </div>

  ${pledgeSignFoot(e, c, date, "동의자", { rrn: true })}`;
}

/* ============================== 건강 서약서 ============================== */
export function pledgeHealthHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  date?: Date;
}): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  return `${companyHead(c)}
  <div class="doc-title">서 약 서</div>
  <p style="text-align:center" class="muted">(건강상태 고지)</p>
  <p>상기 본인은 채용과 관련하여 아래와 같은 사항을 서약합니다.</p>
  <p style="text-align:center" class="muted">- 아 래 -</p>

  <div class="clause">
    <p class="list-num">1. 채용 절차 당시 기저질환 관련 병력, 복용약 등 본인의 건강상태에 대하여 사실대로 고지하였으며, 채용 이후 해당 내용을 거짓으로 고지하여 발생하는 불이익에 대한 책임은 본인에게 있음을 확인합니다.</p>
    <p class="list-num">2. 채용 이후 본인은 향후 지속적으로 건강관리 할 것을 약속하며, 본인의 관리 잘못 등으로 업무외 상병이 발생 또는 악화되더라도 이에 대한 책임은 본인에게 있음을 인정합니다.</p>
    <p class="list-num">3. 채용 이후 의사의 소견이나 본인 생각에 건강상 문제가 있을 경우 사전에 반드시 회사에 그 사실을 알려 문제가 발생하지 않도록 협의를 진행하도록 하겠습니다.</p>
    <p class="list-num">4. 상기 서약 내용에 대하여 성실히 이행할 것을 확인합니다.</p>
  </div>

  ${pledgeSignFoot(e, c, date, "서약자", { rrn: true })}`;
}

/* ===================== 직장 내 괴롭힘 근절 서약서 ===================== */
/**
 * 근로기준법 §76조의2·3 은 괴롭힘 금지와 신고 시 조사·조치 의무를 정할 뿐
 * **서약서 징구를 요구하지는 않는다.** 그래도 넣는 이유는 ① 지금까지 실제로 받아 온 서류이고
 * ② 분쟁이 생겼을 때 사용자가 예방 노력을 했다는 정황이 되기 때문이다.
 * 복무서약서 8항(성희롱·괴롭힘 금지)과 겹치므로, 여기서는 **예방·신고자 보호** 쪽에 무게를 둔다.
 */
export function pledgeHarassmentHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  date?: Date;
}): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  return `${companyHead(c)}
  <div class="doc-title">서 약 서</div>
  <p style="text-align:center" class="muted">(직장 내 괴롭힘 근절)</p>

  <table class="kv">
    <tr><th>성명</th><td>${esc(e.name)}</td><th>업무부서</th><td>${esc(e.department ?? "")}</td></tr>
    <tr><th>입사일</th><td>${ymd(e.hireDate)}</td><th>생년월일</th><td>${esc(e.birth ?? "")}</td></tr>
    <tr><th>주소</th><td colspan="3">${esc(e.address ?? "")}</td></tr>
  </table>

  <p style="margin-top:10px">상기 본인은 직장 내 괴롭힘을 근절하고 상호 존중하는 직장 분위기 조성을 위해 모범이 될 것을 다짐하며 각 호와 같이 서약한다.</p>
  <div class="clause">
    <p class="list-num">1. 우리는 '상호 존중하고 배려'하는 마음으로 건강한 직장문화 조성을 위해 노력한다.</p>
    <p class="list-num">2. 우리는 직무수행 시 인격적인 불이익이나 처우를 하지 아니하며, '동료 근로자 등 이해 관계자'의 인권을 존중한다.</p>
    <p class="list-num">3. 우리는 공정한 직무수행을 저해하는 부당한 업무 및 사적 지시를 하지 않으며, 자신에게 부여된 지위와 권한을 남용하지 않는다.</p>
    <p class="list-num">4. 우리는 직장 내 괴롭힘 행위를 예방하는 활동에 적극 참여하고, 신고자와 피해자 보호에 앞장선다.</p>
  </div>
  <p class="small">※ 근로기준법 제76조의2(직장 내 괴롭힘의 금지) 및 제76조의3(발생 시 조치)에 따라, 회사는 신고를 접수하면 지체 없이 조사하고 피해자 보호조치를 취합니다. 신고를 이유로 한 불이익 처우는 금지됩니다.</p>

  ${pledgeSignFoot(e, c, date, "서약자")}`;
}

/* ==================== 사업소득세(3.3%) 신청 확인서 ==================== */
/**
 * 4대보험 취득신고 대신 사업소득 원천징수를 **본인이 요청**했음을 남기는 서류.
 * 사업소득(FREELANCE) 로 신고하는 직원에게만 나간다.
 */
export function confirmBusinessIncomeHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  date?: Date;
}): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  return `${companyHead(c)}
  <div class="doc-title">확 인 서</div>
  <p style="text-align:center" class="muted">(사업소득세 신청)</p>
  <p><b>${esc(c.name)}</b> (이하 "갑") 과 근로자 <b>${esc(e.name)}</b> 은(는) 아래와 같이 확인, 확약합니다.</p>
  <p style="text-align:center" class="muted">- 아 래 -</p>

  <div class="clause">
    <p class="list-num">1. 본인 <b>${esc(e.name)}</b> 은(는) 개인사정으로 입사 시 4대보험(국민연금, 건강보험, 고용보험, 산재보험) 취득 신고를 하지 않고 <b>사업소득세(3.3%)를 원천징수</b>하여 줄 것을 갑에게 요청하였음을 확인한다.</p>
    <p class="list-num">2. 이는 본인의 자발적인 요청에 기한 것으로 근로계약관계 중 또는 계약 종료 후에도 근로자격 취득 및 급여 수급과 관련하여 행정적, 민·형사상 이의 제기를 일체하지 아니하며 회사에 어떠한 불이익이 없도록 한다.</p>
    <p class="list-num">3. 만일 향후 갑에 자의 또는 타의에 의한 불이익이 발생하는 경우 모든 책임을 본인이 부담하며 지금까지 납부하지 아니한 4대보험료 일체(사업주 부담분 포함)를 본인이 납부하겠습니다.</p>
  </div>

  ${pledgeSignFoot(e, c, date, "확인자", { rrn: true })}`;
}

/* ======================== 퇴직유보금 확인서 ======================== */
/**
 * 인센티브·비율제 계약자에게 나가는 서류. 인센티브 원천액의 8.3%(1/12)를 퇴직유보금으로
 * 미리 지급하고, 그것이 그 계약에 대한 퇴직금을 갈음한다는 확인.
 * 급여와 **다른 통장**으로 보내므로 통장 기재란을 함께 둔다.
 */
export function confirmRetentionHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  date?: Date;
}): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  const acct = [e.retentionBank, e.retentionAccount].filter(Boolean).join(" ");
  return `${companyHead(c)}
  <div class="doc-title">확 인 서</div>
  <p style="text-align:center" class="muted">(퇴직유보금)</p>

  <table class="kv">
    <tr><th>성명</th><td>${esc(e.name)}</td><th>직무</th><td>${esc(e.duty ?? e.position ?? "")}</td></tr>
    <tr><th>생년월일</th><td>${esc(e.birth ?? "")}</td><th>핸드폰</th><td>${esc(e.phone ?? "")}</td></tr>
    <tr><th>주소</th><td colspan="3">${esc(e.address ?? "")}</td></tr>
  </table>

  <p style="margin-top:10px">상기 본인은 퇴직금 산정 방식에 관하여 아래와 같은 사실을 확인합니다.</p>
  <p style="text-align:center" class="muted">- 아 래 -</p>

  <div class="clause">
    <p class="list-num">1. 본인은 회사가 지급한 <b>인센티브 원천액의 8.3%</b>가 퇴직유보금에 해당하며 이는 인센티브 계약에 따라 발생하는 퇴직금분에 해당함을 확인합니다.</p>
    <p class="list-num">2. 따라서 본인은 퇴직 시 회사에서 산정하여 지급할 퇴직금액에서 인센티브 계약에 따라 발생하는 퇴직금에 대한 추가적인 지급을 요구하지 아니하겠습니다.</p>
    <p class="list-num">3. 인센티브로 인하여 발생한 퇴직금분은 기존 급여통장이 아닌 <b>별도 통장</b>으로 지급해줄 것으로 요청합니다.</p>
    <table class="kv" style="margin:4px 0 8px">
      <tr><th>인센티브 퇴직유보금 납입 통장</th><td>${acct ? esc(acct) : blank(34)}</td></tr>
    </table>
    <p class="list-num">4. 만일, 퇴직 시 회사에서 지급하는 퇴직금액 이외 인센티브에 따른 퇴직금 지급을 추가로 요구하는 경우 기 지급받은 인센티브 퇴직유보금은 <b>부당이득</b>에 해당함을 확인합니다.</p>
  </div>

  ${pledgeSignFoot(e, c, date, "작성자")}`;
}

/* ====================== 개인사업자 지위 확인서 ====================== */
/**
 * 위탁계약(프리랜서)에게만 나간다. 사업자등록증 없이 위탁 용역을 수행할 수 있는 근거와,
 * 근로기준법상 법정수당·퇴직금을 받을 수 없음을 인지했다는 확인.
 */
export function confirmSoleProprietorHtml(args: {
  employee: DocEmployee;
  company: DocCompany;
  date?: Date;
}): string {
  const { employee: e, company: c } = args;
  const date = args.date ?? new Date();
  return `${companyHead(c)}
  <div class="doc-title">개인사업자 지위 확인서</div>

  <table class="kv">
    <tr><th>성명</th><td>${esc(e.name)}</td></tr>
    <tr><th>주민번호</th><td>${maskRRN(e.rrn) || blank(20)}</td></tr>
    <tr><th>연락처</th><td>${esc(e.phone ?? "")}</td></tr>
  </table>

  <p style="margin-top:12px">상기 본인은 위탁 용역을 수행하기 위하여 입사함에 있어서, 본인 명의의 사업자등록증을 작성하여 제출하여야 하나, <u>인적용역을 제공하는 개인사업자로서 사업자등록증 발급이 면제되고, 부가가치세 신고 및 납부의 의무 역시 면제되는 "강사" 서비스 분야에 종사</u>하므로 별도의 사업자등록증 발급 없이 본 위탁 용역을 수행할 수 있기에 본 확인서를 제출합니다.</p>
  <p>본 확인서를 제출하는 이유는 본인의 진실한 의사에 따라 위탁계약을 체결하기 위함입니다. 위탁계약 체결 시, 향후 <b>${esc(c.name)}</b> 와 관계하여 <b>근로기준법상 발생되는 각종 법정수당 및 퇴직금을 지급받을 수 없다</b>는 사실을 분명하게 인지하였습니다.</p>

  ${pledgeSignFoot(e, c, date, "확인자")}`;
}

/* ---------------------- 서약서·확인서 공통 서명란 ---------------------- */
/** 서약서류의 아래 서명란 — 문서마다 조금씩 다르던 것을 한곳으로 모은다 */
function pledgeSignFoot(
  e: DocEmployee,
  c: DocCompany,
  date: Date,
  label: string,
  opts: { rrn?: boolean } = {}
): string {
  return `<div class="doc-foot">
    <div class="date-center">${ymdKo(date)}</div>
    <div class="sign-area">
      <div class="sign-box"><div class="sign-grid">
        ${sigField(label, e.name, true)}${
          opts.rrn ? sigField("주민등록번호", maskRRN(e.rrn) || null) : sigField("생년월일", e.birth)
        }
        <div class="full">${sigField("주소", e.address)}</div>
        ${sigField("연락처", e.phone)}
      </div></div>
      <div style="text-align:right;margin-top:12px;font-weight:700"><b>${esc(c.name)}</b> 대표 ${esc(c.ceo)} 귀하</div>
    </div>
  </div>`;
}

/* ============================ 신규입사 패키지 ============================ */
export function newHirePackageGroups(args: {
  employee: DocEmployee;
  contract: DocContract;
  company: DocCompany;
  /** 부서가 정하는 서류 정책. **없으면 부서 한정 서류가 통째로 빠진다** */
  deptPolicy?: DeptDocPolicy | null;
  /** 계약서(양자 서명)에 줄 조판 옵션 — 간인·각 장 이니셜란·쪽번호 */
  bilateralOpts?: PdfOptions;
}): DocGroup[] {
  const { employee, company, deptPolicy } = args;
  const one = { employee, company };

  // 서약서·동의서는 **을이 회사에 내는 일방 서류**라 갑의 서명란이 없다.
  // 그래서 각 장 이니셜란(갑·을 상호 서명)도, 쪽번호도 붙이지 않는다.
  const pledges = [
    pledgeServiceHtml(one),
    pledgeSecurityHtml({ ...one, nonCompete: !!deptPolicy?.docNonCompete }),
    pledgeHarassmentHtml(one),
    consentPrivacyHtml(one),
    consentDeductionHtml(one),
  ];
  if (deptPolicy?.docPledgeServiceII) pledges.push(pledgeServiceIIHtml(one));
  if (deptPolicy?.docPromotion) pledges.push(consentPromotionHtml(one));
  if (deptPolicy?.docHealth) pledges.push(pledgeHealthHtml(one));
  if (employee.incomeType === "FREELANCE") pledges.push(confirmBusinessIncomeHtml(one));

  return [...contractGroups(args), { bodies: pledges }];
}

/** 패키지의 본문만 평평하게 (묶음 구분이 필요 없는 곳·테스트용) */
export function newHirePackageBodies(args: Parameters<typeof newHirePackageGroups>[0]): string[] {
  return newHirePackageGroups(args).flatMap((g) => g.bodies);
}
