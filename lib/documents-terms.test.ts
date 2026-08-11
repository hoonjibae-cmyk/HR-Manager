// 서류 문구 중 **법적 효과가 달라지는 두 대목**.
//  ① 기간제 근로계약의 계약종료·중도해지 조항 (계약기간이 있을 때만 붙는다)
//  ② 개인정보의 국외 처리 고지 (실제로 보내는 곳만 적어야 한다)
//
// 둘 다 잘못 나가면 사람이 서명한 뒤에야 드러난다.

import { describe, it, expect } from "vitest";
import {
  contractHtml,
  consentPrivacyHtml,
  OVERSEAS_PROCESSORS,
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
    for (const p of OVERSEAS_PROCESSORS) expect(t).toContain(p.name);
    expect(OVERSEAS_PROCESSORS.map((p) => p.name)).toEqual(
      expect.arrayContaining(["Vercel Inc.", "Supabase Inc.", "Slack Technologies, LLC", "Google LLC"])
    );
  });

  // 이 앱은 어떤 AI API 도 호출하지 않는다. 안 보내는 곳을 적으면 사실과 다른 고지가 된다.
  it("**생성형 AI 사업자는 적지 않는다** — 앱이 그쪽으로 개인정보를 보내지 않는다", () => {
    const t = html();
    for (const name of ["Anthropic", "Claude", "OpenAI", "ChatGPT"]) expect(t).not.toContain(name);
  });

  it("법 제28조의8 제2항의 고지사항을 갖춘다 (항목·국가·목적·시기·기간·거부방법)", () => {
    const t = html();
    expect(t).toContain("제28조의8");
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
