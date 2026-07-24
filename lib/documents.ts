// 유쌤에듀 문서 HTML 템플릿 (→ PDF)
// 엑셀의 실제 계약서/서약서/동의서/명세서 법적 문구를 재현.

import { won, wonUnit, ymd, ymdKo, maskRRN } from "./format";
import { DAY_KO, PAY_SCHEME_LABEL, parseSchedule, type ScheduleDay } from "./constants";

export interface DocCompany {
  name: string;
  ceo: string;
  bizNo: string;
  phone: string;
  address: string;
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
}

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function companyHead(c: DocCompany, tag?: string): string {
  return `<div class="company-head">
    <div><div class="cname">${esc(c.name)}</div>
      <div class="cmeta">대표 ${esc(c.ceo)} · 사업자등록번호 ${esc(c.bizNo)}<br/>${esc(c.address)} · ${esc(c.phone)}</div>
    </div>
    ${tag ? `<div class="doc-tag">${esc(tag)}</div>` : ""}
  </div>`;
}

/** 서명 필드 (라벨 + 값/밑줄) */
function sigField(label: string, value?: string | null, seal = false): string {
  if (value) {
    return `<div class="f"><span class="lbl">${esc(label)}</span><b>${esc(value)}</b>${seal ? ' <span class="seal">(인)</span>' : ""}</div>`;
  }
  return `<div class="f"><span class="lbl">${esc(label)}</span><span class="fill">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>${seal ? ' <span class="seal">(인)</span>' : ""}</div>`;
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
  return `<table class="kv"><tbody>
    <tr><th>구분</th>${days.map((d) => `<td style="text-align:center;font-weight:700;background:#f7f9ff">${DAY_KO[d]}</td>`).join("")}</tr>
    <tr><th>시업</th>${cell((s) => (s?.work ? s.start : "-"))}</tr>
    <tr><th>종업</th>${cell((s) => (s?.work ? s.end : "-"))}</tr>
    <tr><th>휴게(시간)</th>${cell((s) => (s?.work ? String(s.breakH ?? 0) : "-"))}</tr>
    <tr><th>근로시간</th>${cell(dur)}</tr>
  </tbody></table>`;
}

/* ============================ 근로/위탁 계약서 ============================ */
export function contractHtml(args: {
  employee: DocEmployee;
  contract: DocContract;
  company: DocCompany;
}): string {
  const { employee: e, contract: ct, company: c } = args;
  const sched = parseSchedule(e.schedule);
  const workDays = sched.filter((s) => s.work).length;
  const isRatio = ct.templateKey === "RATIO" || e.payScheme === "RATIO";
  const isHourly = ct.templateKey === "HOURLY" || e.payScheme === "HOURLY";
  const title = isRatio ? "위탁계약서 (비율제)" : `근로계약서 (${PAY_SCHEME_LABEL[e.payScheme] ?? "월급제"})`;
  const partyB = isRatio ? "수탁자" : "근로자";

  const period = ct.endDate
    ? `${ymdKo(ct.startDate)} 부터 ${ymdKo(ct.endDate)} 까지`
    : `${ymdKo(ct.startDate)} (정규직 — 입사일 기재)`;

  const probationClause = ct.isProbation
    ? `<p class="sub">④ 최초 근로 개시일로부터 ${ct.probationMonths}개월간을 수습기간으로 하며, 수습기간 중 업무 적격성을 판단하여 부족하다고 판단되면 계약을 해지할 수 있다. (수습기간 중 급여는 100% 지급한다.)</p>`
    : "";

  // 임금 조항
  let wageClause = "";
  if (isRatio) {
    const pct = ((ct.ratioPercent ?? e.baseWage ? ct.ratioPercent : 0) ?? 0) * 100;
    wageClause = `<div class="clause"><h3>제 4조 (위탁수수료)</h3>
      <p class="sub">① "${partyB}"이 담당하는 반(강좌)의 월 매출액의 <b>${pct.toFixed(1)}%</b>를 위탁수수료로 지급한다.</p>
      <p class="sub">② 수수료는 사업소득으로서 지급 시 원천징수세액(3.3%)을 공제한 후 지급한다.</p>
      <p class="sub">③ 지급일은 매월 ${"익월 7일"}로 하며, 정산 내역은 명세서로 교부한다.</p></div>`;
  } else if (isHourly) {
    wageClause = `<div class="clause"><h3>제 4조 (임금)</h3>
      <p class="sub">① "${partyB}"의 시간급 임금은 <b>${wonUnit(ct.baseWage)}</b>으로 하며, 실근로시간에 따라 산정하여 지급한다.</p>
      <p class="sub">② 소정근로시간이 주 15시간 이상인 경우 주휴수당을 별도 지급한다.</p>
      <p class="sub">③ 임금은 매월 초일부터 말일까지 기산하여 익월 7일에 "${partyB}"의 통장으로 법정 공제액을 공제한 후 지급한다.</p>
      <p class="sub">④ 연장·야간·휴일근로 시 근로기준법에 따른 가산수당(연장·휴일 1.5배, 야간 0.5배 가산)을 지급한다.</p></div>`;
  } else {
    const incClause =
      ct.templateKey === "INCENTIVE" && ct.incThreshold != null
        ? `<p class="sub">⑦ 담당 학생수가 ${ct.incThreshold}명을 초과하는 경우, 초과 1명당 ${wonUnit(ct.incPerStudent ?? 0)}의 인센티브를 지급한다. 인센티브는 호혜적 금품으로 근로기준법상 임금에 해당하지 아니한다.</p>
      <p class="sub">⑧ 인센티브 원천액의 8.3%는 퇴직유보금(인센티브분 퇴직금)으로 매월 별도 통장에 송금·적립하며, 인센티브는 법정 퇴직급여 산정의 기초임금에 포함하지 아니한다. 세부 사항은 별도 확인서에 따른다.</p>`
        : "";
    wageClause = `<div class="clause"><h3>제 4조 (임금)</h3>
      <p class="sub">① "${partyB}"의 급여는 <b>${wonUnit(ct.baseWage)}</b>을 기준급여로 하여 아래 임금 항목으로 포괄하여 지급한다.</p>
      <table class="kv"><tr><th>기본급</th><td>${wonUnit(ct.baseWage)}</td><th>직책수당</th><td>${wonUnit(ct.positionAllow)}</td></tr>
      <tr><th>식대(비과세)</th><td>${wonUnit(ct.mealAllow)}</td><th>차량유지비(비과세)</th><td>${wonUnit(ct.carAllow)}</td></tr></table>
      <p class="sub">② 위 급여는 제2·3조에 따라 책정된 임금이며, 업무·직책·근무장소·근로시간 변경 시 급여가 변경됨에 동의한다.</p>
      <p class="sub">③ "${partyB}"의 임금은 매월 초일부터 말일까지 기산하여 익월 7일에 "${partyB}"의 통장으로 법정 공제액을 공제한 후 지급한다.</p>
      <p class="sub">④ "${partyB}"의 퇴직 시 계속근로기간 1년 이상(주 평균 15시간 이상)인 경우 퇴직급여보장법에 따른 법정 퇴직금을 지급한다.</p>
      <p class="sub">⑤ "갑"은 "${partyB}"이 복무서약에 따라 성실히 근무한 경우 인센티브를 지급할 수 있으며, 이는 호혜적 금품으로 근로기준법상 임금에 해당하지 아니한다.</p>
      <p class="sub">⑥ 직책수당은 해당 임금 산정기간 중 5일 이상 근무한 자에 한하여 일할지급하며, 통상임금 산정 시 제외한다.</p>
      ${incClause}</div>`;
  }

  return `${companyHead(c)}
  <div class="doc-title">${title.includes("위탁") ? "위 탁 계 약 서" : "근 로 계 약 서"}</div>
  <p style="text-align:center" class="muted">${esc(title)}</p>
  <p><b>${esc(c.name)}</b> (이하 "갑") 와 <b>${esc(e.name)}</b> (이하 "${partyB}", "을") 은(는) 다음과 같은 조건으로 계약을 체결하고, 상호 신의성실의 원칙 하에 이를 이행·준수할 것을 합의한다.</p>

  <div class="clause"><h3>제 1조 (계약기간)</h3>
    <p class="sub">① ${period} 로 한다.</p>
    <p class="sub">② "을"의 근로조건이 변경된 경우 새로이 계약서를 체결하여 변경된 근로조건을 고지한다.</p>
    <p class="sub">③ 계약기간이 종료되는 경우 계약은 자동 종료된다. 다만 종료 30일 이전 당사자 합의로 기간을 연장할 수 있다.</p>
    ${probationClause}</div>

  <div class="clause"><h3>제 2조 (근무장소 및 업무)</h3>
    <p class="sub">① 근무장소: "갑"의 사업장 및 관할 장소 (${esc(c.address)})</p>
    <p class="sub">② 소속 / 직책 / 업무: ${esc(e.department ?? "")} / ${esc(e.position ?? "")} / ${esc(e.duty ?? "")}</p>
    <p class="sub">③ 근무장소·직책·업무내용·근로조건은 "갑"의 업무상 필요에 따라 변경될 수 있으며 이에 성실히 이행할 것에 동의한다.</p></div>

  <div class="clause"><h3>제 3조 (근로시간 및 휴게시간)</h3>
    <p class="sub">① "을"의 근로일은 1주 ${workDays}일로 하며, 소정근로시간은 1일 8시간·1주 40시간 범위 내로 한다.</p>
    ${scheduleTable(sched)}
    <p class="sub">② 휴게시간은 식사시간으로 하며 "을"은 해당 시간 범위 내에서 자유롭게 운영한다.</p>
    <p class="sub">③ "갑"은 근로시간 외 연장·야간·휴일근로를 지시할 수 있으며 "을"은 성실히 이행할 것에 동의한다.</p></div>

  ${wageClause}

  ${isRatio
    ? `<div class="clause"><h3>제 5조 (계약의 성격)</h3>
    <p class="sub">① 본 계약은 위탁(도급) 계약으로서 근로기준법상 근로계약에 해당하지 아니한다.</p>
    <p class="sub">② 따라서 퇴직급여, 연차유급휴가, 주휴수당 등 근로기준법상 제도는 본 계약에 적용되지 아니한다.</p>
    <p class="sub">③ 수수료는 사업소득으로 처리하며, 지급 시 원천징수세액(3.3%)을 공제한다.</p></div>

  <div class="clause"><h3>제 6조 (계약해지)</h3>
    <p class="sub">① 계약을 해지하고자 할 경우 해지 예정일 30일 이전에 상대방에게 서면으로 통지한다.</p>
    <p class="sub">② "을"은 담당 반의 해당 학기 수업 종료 시까지 위탁업무를 수행하여야 하며, "갑"이 서면 인정하는 불가피한 사유가 없는 한 학기 종료 이전에 해지할 수 없다.</p></div>

  <div class="clause"><h3>제 7조 (기타사항)</h3>`
    : `<div class="clause"><h3>제 5조 (휴일)</h3>
    <p class="sub">① 주휴일(해당 주 소정근로일 개근 및 주 15시간 이상 시 유급), 근로자의 날, 관공서 공휴일(일요일 제외)을 유급휴일로 한다.</p>
    <p class="sub">② 주휴일은 근로자의 해당 주 첫 번째 비번일로 하며, 업무사정에 따라 변경할 수 있다.</p></div>

  <div class="clause"><h3>제 6조 (연차유급휴가)</h3>
    <p class="sub">① 소정근로시간이 1주 15시간을 초과하는 경우 연차유급휴가를 <b>입사일 기준</b>으로 산정·부여한다.</p>
    <p class="sub">② 연차 사용 시 적절한 업무분장을 위해 사용 희망일 1주일 전 "갑"에게 알리고 승인을 득한다.</p>
    <p class="sub">③ "갑"이 지정한 방학·휴원 등 휴무일은 연차사용으로 대체함에 동의한다.</p></div>

  <div class="clause"><h3>제 7조 (의원사직)</h3>
    <p class="sub">① 사직하고자 할 경우 사직일 30일 이전에 사직서를 제출하고, 후임자 선임 시까지 인수인계 등 성실히 근로한다.</p>
    <p class="sub">② "을"은 담당 반의 해당 학기 수업 종료 시까지 근무하여야 하며, "갑"이 서면 인정하는 불가피한 사유가 없는 한 학기 종료 이전에 사직할 수 없다.</p></div>

  <div class="clause"><h3>제 8조 (기타사항)</h3>`}
    <p class="sub">① "을"은 근면·성실·친절·공정을 기하며, 근무 중은 물론 계약종료 후에도 업무상 취득한 "갑"의 기밀을 유지한다.</p>
    <p class="sub">② "을"은 급여액을 포함한 근로조건을 누설하지 아니한다.</p>
    <p class="sub">③ "을"이 계약기간 중 생산한 교재·수업자료·동영상 등의 지적재산권은 "갑"에게 귀속된다.</p>
    <p class="sub">④ 급여명세서를 이메일(${esc(e.email ?? "")})로 교부받는 것에 동의한다. ( 동의 : ______ )</p></div>

  <div class="doc-foot">
    <p style="text-align:center">"갑"과 "을"은 상기와 같이 계약을 체결하고, 계약서 2부를 작성하여 각 1부씩 보관한다.</p>
    <div class="date-center">${ymdKo(ct.startDate)}</div>
    <div class="sign-area"><div class="sign-duo">
      <div>
        <div class="sign-party">"갑" (사용자)</div>
        <div class="sign-box"><div class="sign-grid one">
          ${sigField("회사명", c.name)}
          ${sigField("대표자", c.ceo, true)}
          ${sigField("주소", c.address)}
          ${sigField("전화", c.phone)}
        </div></div>
      </div>
      <div>
        <div class="sign-party">"을" (${partyB})</div>
        <div class="sign-box"><div class="sign-grid one">
          ${sigField("성명", e.name, true)}
          ${sigField("생년월일", e.birth)}
          ${sigField("주소", e.address)}
          ${sigField("연락처", e.phone)}
        </div></div>
      </div>
    </div></div>
  </div>`;
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

/* ============================ 신규입사 패키지 ============================ */
export function newHirePackageBodies(args: {
  employee: DocEmployee;
  contract: DocContract;
  company: DocCompany;
}): string[] {
  return [
    contractHtml(args),
    pledgeServiceHtml({ employee: args.employee, company: args.company }),
    consentPrivacyHtml({ employee: args.employee, company: args.company }),
    consentDeductionHtml({ employee: args.employee, company: args.company }),
  ];
}
