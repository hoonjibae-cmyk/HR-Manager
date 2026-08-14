// 서류 문구 중 **법적 효과가 달라지는 두 대목**.
//  ① 기간제 근로계약의 계약종료·중도해지 조항 (계약기간이 있을 때만 붙는다)
//  ② 개인정보의 국외 처리 고지 (실제로 보내는 곳만 적어야 한다)
//
// 둘 다 잘못 나가면 사람이 서명한 뒤에야 드러난다.

import { describe, it, expect } from "vitest";
import {
  contractHtml,
  consentPrivacyHtml,
  consentDeductionHtml,
  deductsInsurance,
  OVERSEAS_PROCESSORS,
  DOMESTIC_REGION_PROCESSORS,
  FIXED_TERM_NOTICE_LABEL,
  type DocCompany,
  type DocContract,
  type DocEmployee,
} from "./documents";

const company: DocCompany = {
  name: "주식회사 유쌤에듀",
  ceo: "유은정",
  bizNo: "418-86-02289",
  phone: "031-794-3306",
  address: "경기도 하남시 미사강변대로 216",
  payday: 7,
  stamp: null,
};

const emp = (over: Partial<DocEmployee> = {}): DocEmployee =>
  ({
    name: "이지우",
    rrn: "900101-1234567",
    birth: "1990-01-01",
    department: "교수부",
    position: "강사",
    duty: "강의",
    address: "경기도 하남시",
    phone: "010-0000-0000",
    email: "a@b.c",
    hireDate: new Date(Date.UTC(2026, 0, 2)),
    resignDate: null,
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    baseWage: 3_000_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    schedule: "[]",
    ...over,
  }) as DocEmployee;

const ct = (over: Partial<DocContract> = {}): DocContract =>
  ({
    stage: "SHORT_TERM_1",
    templateKey: "MONTHLY",
    startDate: new Date(Date.UTC(2026, 0, 2)),
    endDate: null,
    isProbation: true,
    probationMonths: 2,
    baseWage: 3_000_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    ...over,
  }) as DocContract;

const fixedTerm = (over: Partial<DocContract> = {}) =>
  ct({ endDate: new Date(Date.UTC(2026, 11, 31)), ...over });

/** 태그를 걷어낸 본문 — `<b>` 로 끊긴 문장도 통째로 찾을 수 있게 */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

describe("기간제 계약 — 계약종료·중도해지 조항", () => {
  const html = () => text(contractHtml({ employee: emp(), contract: fixedTerm(), company }));

  it("제7조 제목이 '계약의 종료 및 의원사직' 으로 바뀐다", () => {
    expect(html()).toContain("제 7조 (계약의 종료 및 의원사직)");
  });

  it("① 만료 종료가 원칙이고 중도해지는 민법 제661조의 부득이한 사유에 한한다", () => {
    const t = html();
    expect(t).toContain("계약기간 만료로 종료함을 원칙");
    expect(t).toContain("민법」 제661조");
    expect(t).toContain("부득이한 사유가 있는 경우에 한하여 중도해지");
  });

  it("② 합의 중도 종료 — 학사일정을 고려해 정규·내신 종료일을 원칙으로", () => {
    const t = html();
    expect(t).toContain("당사자가 합의하는 경우 계약을 중도 종료");
    expect(t).toContain("학사일정을 고려하여 협의");
    expect(t).toContain("정규 또는 내신 종료일");
  });

  it("③ 중도 종료 통보는 **퇴직 희망일 2개월 전** 서면", () => {
    const t = html();
    expect(FIXED_TERM_NOTICE_LABEL).toBe("2개월");
    expect(t).toContain(`퇴직(종료) 희망일의 ${FIXED_TERM_NOTICE_LABEL} 이전`);
    expect(t).toContain("서면으로 상대방에게 통지");
    // 사직서 제출 의무는 그대로 남는다 — 예전 조항이 통째로 사라지면 안 된다
    expect(t).toContain("사직서를 제출");
  });

  it("④ 종료일까지 수업 수행 + 인수인계", () => {
    const t = html();
    expect(t).toContain("종료일까지 담당 수업을 수행");
    expect(t).toContain("인수인계 기준에 따라 후임자에게 인계");
  });

  it("기존 조항(학기 중 사직 제한·퇴직월 임금 지급)이 뒤에 그대로 남는다", () => {
    const t = html();
    expect(t).toContain("해당 학기 종료 이전에 사직할 수 없다");
    expect(t).toContain("퇴직 월 임금 및 발생 퇴직금은 익월 임금지급일에 일괄 지급");
  });

  it("번호가 ①~⑥ 로 빠짐없이 이어진다 (건너뛰면 조항을 인용할 수 없다)", () => {
    const t = html();
    const art7 = t.slice(t.indexOf("제 7조"), t.indexOf("제 8조"));
    for (const n of ["①", "②", "③", "④", "⑤", "⑥"]) expect(art7).toContain(n);
    expect(art7).not.toContain("⑦");
  });

  it("**부서와 무관하게 2개월**이다 — 의원사직의 60/30일 규칙과 별개", () => {
    for (const dept of ["교수부", "조교팀", "경영지원"]) {
      const t = text(
        contractHtml({ employee: emp({ department: dept }), contract: fixedTerm(), company })
      );
      expect(t).toContain("희망일의 2개월 이전");
    }
  });
});

describe("기간의 정함이 없는 계약 — 예전 그대로", () => {
  const html = (dept: string) =>
    text(contractHtml({ employee: emp({ department: dept }), contract: ct(), company }));

  it("제7조는 '의원사직' 이고 계약만료 조항이 붙지 않는다", () => {
    const t = html("교수부");
    expect(t).toContain("제 7조 (의원사직)");
    expect(t).not.toContain("계약기간 만료로 종료함을 원칙");
    expect(t).not.toContain("민법」 제661조");
  });

  it("사직 통보 기한은 부서로 갈린다 (교수부 60일 / 그 외 30일)", () => {
    expect(html("교수부")).toContain("60일 이전");
    expect(html("조교팀")).toContain("30일 이전");
  });

  it("번호가 ①②③ 로 이어진다", () => {
    const t = html("교수부");
    const art7 = t.slice(t.indexOf("제 7조"), t.indexOf("제 8조"));
    expect(art7).toContain("①");
    expect(art7).toContain("③");
    expect(art7).not.toContain("④");
  });
});

describe("개인정보 국외 처리 고지", () => {
  const html = () => text(consentPrivacyHtml({ employee: emp(), company }));

  it("실제로 정보를 보내는 사업자를 모두 적는다", () => {
    const t = html();
    for (const p of [...OVERSEAS_PROCESSORS, ...DOMESTIC_REGION_PROCESSORS]) expect(t).toContain(p.name);
  });

  // 서울 리전에 보관하므로 데이터가 국외로 나가지 않는다. '국외 이전' 으로 적으면 사실과 다르다.
  it("**국내 보관(서울 리전)과 국외 이전을 갈라 적는다**", () => {
    const t = html();
    expect(OVERSEAS_PROCESSORS.map((p) => p.name)).toEqual([
      "Slack Technologies, LLC",
      "Google LLC",
      "Notion Labs, Inc.",
    ]);
    expect(DOMESTIC_REGION_PROCESSORS.map((p) => p.name)).toEqual([
      "Vercel Inc. (미국 법인)",
      "Supabase Inc. (미국 법인)",
    ]);
    expect(t).toContain("가. 개인정보가 국외로 이전되는 경우");
    expect(t).toContain("나. 개인정보를 국내에 보관하는 경우");
    expect(t).toContain("대한민국 내 서버에 보관");
  });

  it("서울 리전을 정확히 적는다 (앱 icn1 · DB ap-northeast-2)", () => {
    const t = html();
    expect(t).toContain("대한민국 서울(icn1)");
    expect(t).toContain("대한민국 서울(AWS ap-northeast-2)");
  });

  // 국내 보관이라고 침묵하면, 수탁자 인력이 국외에서 들여다볼 수 있다는 사실이 가려진다
  it("국내 보관이어도 유지보수 목적의 국외 접근 가능성을 적는다", () => {
    expect(html()).toContain("유지보수 목적");
  });

  // 앱이 연동하는 것(슬랙·캘린더)만이 아니라 **직원이 업무에 쓰는 도구**도 대상이다 —
  // 회사가 위탁한 곳에 개인정보가 있으면 고지 의무에는 차이가 없다.
  it("직원이 업무에 쓰는 도구(구글 드라이브·노션)도 적는다", () => {
    const t = html();
    expect(t).toContain("구글 드라이브");
    expect(t).toContain("Notion Labs, Inc.");
  });

  // 급여명세서 PDF 가 메일로 나가므로 **메일 발송처도 국외 이전**이고, 이전 항목에 급여 내역이
  // 들어간다. 지금 SMTP_HOST 는 지메일이라 Google LLC 한 줄에 함께 적었다 —
  // **메일 업체를 바꾸면 여기도 고쳐야 한다**(환경변수라 코드가 안 바뀌어 조용히 어긋난다).
  it("**메일 발송처와 그리로 나가는 급여 내역을 적는다**", () => {
    const g = OVERSEAS_PROCESSORS.find((p) => p.name === "Google LLC")!;
    expect(g.purpose).toContain("이메일 발송");
    expect(g.items).toContain("급여");
    const t = html();
    expect(t).toContain("지메일");
    expect(t).toContain("급여명세서에 기재된 급여·공제 내역");
  });


  // 이 앱은 어떤 AI API 도 호출하지 않는다. 안 보내는 곳을 적으면 사실과 다른 고지가 된다.
  it("**생성형 AI 사업자는 적지 않는다** — 앱이 그쪽으로 개인정보를 보내지 않는다", () => {
    const t = html();
    for (const name of ["Anthropic", "Claude", "OpenAI", "ChatGPT"]) expect(t).not.toContain(name);
  });

  it("법 제28조의8 제2항의 고지사항을 갖춘다 (항목·국가·목적·시기·기간·거부방법)", () => {
    const t = html();
    expect(t).toContain("제28조의8");
    expect(t).toContain("제26조");
    expect(t).toContain("이전 항목");
    expect(t).toContain("국가");
    expect(t).toContain("이용 목적");
    expect(t).toContain("이전 시기·방법");
    expect(t).toContain("보유·이용 기간");
    expect(t).toContain("거부 방법·효과");
  });

  it("**동의가 아니라 고지**다 — 철회로 실무가 멈추지 않게", () => {
    const t = html();
    expect(t).toContain("동의를 받는 것이 아니라 알려드리는 것");
    expect(t).toContain("고지받아 확인하였습니다");
  });

  it("거부하면 무엇이 달라지는지까지 적는다 (거부의 효과)", () => {
    expect(html()).toContain("수기로 처리");
  });

  it("기존 동의 항목은 그대로 남는다", () => {
    const t = html();
    expect(t).toContain("개인정보 수집에 관한 동의");
    expect(t).toContain("개인정보 이용 및 제공에 관한 동의");
    expect(t).toContain("고유식별정보의 처리에 관한 동의");
  });
});

describe("임금공제 동의서 — 3.3% 대상자에게는 4대보험을 적지 않는다", () => {
  const html = (over: Partial<DocEmployee>) =>
    text(consentDeductionHtml({ employee: emp(over), company }));

  it("근로소득자: 4대보험 + 근로소득세", () => {
    const t = html({ incomeType: "EMPLOYEE" });
    expect(t).toContain("4대보험(국민연금·건강보험·고용보험·장기요양)");
    expect(t).toContain("근로소득세 및 지방소득세");
    expect(t).not.toContain("3.3%");
  });

  it("사업소득자: 3.3% 만 적고 **4대보험은 빠진다**", () => {
    const t = html({ incomeType: "FREELANCE" });
    expect(t).not.toContain("4대보험");
    expect(t).not.toContain("국민연금");
    expect(t).toContain("사업소득세 및 지방소득세 (원천징수 3.3%)");
  });

  // 급여 엔진은 위탁이면 세무구분이 EMPLOYEE 라도 보험료를 떼지 않고 3.3% 로 처리한다.
  // 문서만 4대보험을 적으면 떼지도 않는 것을 동의받는 셈이다.
  it("위탁계약자는 세무구분이 근로소득이어도 4대보험을 적지 않는다", () => {
    expect(deductsInsurance(emp({ incomeType: "EMPLOYEE", isContractor: true } as any))).toBe(false);
    expect(html({ incomeType: "EMPLOYEE", isContractor: true } as any)).not.toContain("4대보험");
  });

  it("완전비율제도 위탁이라 빠진다 (payScheme 만 봐도 위탁)", () => {
    expect(deductsInsurance(emp({ incomeType: "EMPLOYEE", payScheme: "RATIO" } as any))).toBe(false);
  });

  it("공제 사유·각주도 함께 갈린다", () => {
    expect(html({ incomeType: "EMPLOYEE" })).toContain("근로기준법 제43조");
    const f = html({ incomeType: "FREELANCE" });
    expect(f).toContain("「소득세법」 제127조");
    expect(f).not.toContain("근로기준법 제43조");
  });

  it("'임금' 이 아니라 '지급액' 으로 적는다 (위탁은 임금이 아니다)", () => {
    expect(html({ incomeType: "FREELANCE" })).toContain("매월 지급액에서 공제");
    expect(html({ incomeType: "EMPLOYEE" })).toContain("매월 임금에서 공제");
  });
});
