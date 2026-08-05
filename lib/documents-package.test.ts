// 신규입사 패키지·계약서 세트에 **무엇이 들어가고 무엇이 빠지는지**
// 서류가 잘못 나가면 사람이 서명한 뒤에야 드러나므로 규칙을 못박아 둔다.
import { describe, it, expect } from "vitest";
import {
  newHirePackageBodies,
  contractBodies,
  pledgeSecurityHtml,
  type DocCompany,
  type DocContract,
  type DocEmployee,
  type DeptDocPolicy,
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

function emp(over: Partial<DocEmployee> = {}): DocEmployee {
  return {
    name: "이지우",
    rrn: "900101-1234567",
    birth: "1990-01-01",
    department: "교수부",
    position: "강사",
    duty: "강의",
    address: "경기도 하남시",
    phone: "010-0000-0000",
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
  } as DocEmployee;
}

function ct(over: Partial<DocContract> = {}): DocContract {
  return {
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
  } as DocContract;
}

const POLICY_ALL: DeptDocPolicy = {
  docPledgeServiceII: true,
  docPromotion: true,
  docHealth: true,
  docNonCompete: true,
};
const POLICY_NONE: DeptDocPolicy = {
  docPledgeServiceII: false,
  docPromotion: false,
  docHealth: false,
  docNonCompete: false,
};

/** 묶음 안에 그 제목의 문서가 있는지 */
const has = (bodies: string[], title: string) => bodies.some((b) => b.includes(title));

// 인센티브 '산정 계약서' 에도 「제 6조 (퇴직유보금)」 이 있어서 제목만으로는 구분되지 않는다.
// 확인서에만 있는 문장을 표식으로 쓴다 — 느슨하게 찾으면 확인서가 없어도 테스트가 통과해 버린다.
const RETENTION_DOC = "퇴직금 산정 방식에 관하여";
const findDoc = (bodies: string[], marker: string) => bodies.find((b) => b.includes(marker));

describe("신규입사 패키지 — 전 직원 공통", () => {
  const bodies = newHirePackageBodies({
    employee: emp(),
    contract: ct(),
    company,
    deptPolicy: POLICY_NONE,
  });

  it("복무서약서·보안서약서·괴롭힘 서약서·개인정보 동의서·임금공제 동의서는 항상 들어간다", () => {
    expect(has(bodies, "복 무 서 약 서")).toBe(true);
    expect(has(bodies, "보 안 서 약 서")).toBe(true);
    expect(has(bodies, "직장 내 괴롭힘 근절")).toBe(true);
    expect(has(bodies, "개인정보 수집·이용·제공 동의서")).toBe(true);
    expect(has(bodies, "임 금 공 제 동 의 서")).toBe(true);
  });

  it("근로계약서가 맨 앞에 온다", () => {
    expect(bodies[0]).toContain("근로계약서");
  });
});

describe("부서가 정하는 서류", () => {
  const of = (p: DeptDocPolicy | null) =>
    newHirePackageBodies({ employee: emp(), contract: ct(), company, deptPolicy: p });

  it("교수부(전부 켬)는 복무서약서-II·프로필 홍보·건강서약서를 함께 받는다", () => {
    const b = of(POLICY_ALL);
    expect(has(b, "복무서약서 - II")).toBe(true);
    expect(has(b, "프로필 홍보 활용 동의")).toBe(true);
    expect(has(b, "건강상태 고지")).toBe(true);
  });

  it("조교팀(전부 끔)은 그 셋이 빠진다", () => {
    const b = of(POLICY_NONE);
    expect(has(b, "복무서약서 - II")).toBe(false);
    expect(has(b, "프로필 홍보 활용 동의")).toBe(false);
    expect(has(b, "건강상태 고지")).toBe(false);
  });

  it("건강서약서만 켠 부서는 그것만 붙는다", () => {
    const b = of({ ...POLICY_NONE, docHealth: true });
    expect(has(b, "건강상태 고지")).toBe(true);
    expect(has(b, "복무서약서 - II")).toBe(false);
  });

  it("정책을 못 받으면(부서 미상) 부서 한정 서류가 통째로 빠진다", () => {
    const b = of(null);
    expect(has(b, "복무서약서 - II")).toBe(false);
    expect(has(b, "프로필 홍보 활용 동의")).toBe(false);
    expect(has(b, "건강상태 고지")).toBe(false);
    // 공통 서류는 그대로 — 부서를 몰라도 이건 받아야 한다
    expect(has(b, "복 무 서 약 서")).toBe(true);
  });
});

describe("보안서약서 — 경업금지 조항은 부서에 따라", () => {
  const html = (nonCompete: boolean) => pledgeSecurityHtml({ employee: emp(), company, nonCompete });

  it("켜면 반경 2km 취업·경영 금지가 들어간다", () => {
    expect(html(true)).toContain("회사 반경 2km 내에서 동일직종에 취업 또는 경영");
  });

  it("끄면 그 조항만 빠지고 나머지는 남는다", () => {
    const off = html(false);
    expect(off).not.toContain("반경 2km");
    // 영업비밀·유인 금지는 전 직원 공통이라 그대로 있어야 한다
    expect(off).toContain("근로계약 종료 후 6개월");
    expect(off).toContain("원생을 유인 또는 유혹");
  });
});

describe("세무구분·계약형태가 정하는 서류", () => {
  const pkg = (e: Partial<DocEmployee>, c: Partial<DocContract> = {}) =>
    newHirePackageBodies({
      employee: emp(e),
      contract: ct(c),
      company,
      deptPolicy: POLICY_NONE,
    });

  it("사업소득(3.3%) 직원만 사업소득세 신청 확인서를 받는다", () => {
    expect(has(pkg({ incomeType: "FREELANCE" }), "사업소득세 신청")).toBe(true);
    expect(has(pkg({ incomeType: "EMPLOYEE" }), "사업소득세 신청")).toBe(false);
  });

  it("인센티브 계약자는 퇴직유보금 확인서를 받는다", () => {
    const b = pkg({ payScheme: "INCENTIVE" }, { templateKey: "INCENTIVE" });
    expect(has(b, RETENTION_DOC)).toBe(true);
    expect(has(b, "인센티브 산정 계약서")).toBe(true);
  });

  it("완전비율제는 퇴직유보금 + 개인사업자 지위 확인서를 함께 받는다", () => {
    const b = pkg({ payScheme: "RATIO" }, { templateKey: "RATIO" });
    expect(has(b, RETENTION_DOC)).toBe(true);
    expect(has(b, "개인사업자 지위 확인서")).toBe(true);
  });

  it("월급제 정직원은 둘 다 안 받는다", () => {
    const b = pkg({}, {});
    expect(has(b, RETENTION_DOC)).toBe(false);
    expect(has(b, "개인사업자 지위 확인서")).toBe(false);
  });

  it("시급제라도 위탁계약이면 개인사업자 지위 확인서가 붙는다", () => {
    const b = pkg({ payScheme: "HOURLY" }, { templateKey: "HOURLY", isContractor: true });
    expect(has(b, "개인사업자 지위 확인서")).toBe(true);
    // 위탁이지만 인센티브·비율제가 아니므로 유보금은 없다
    expect(has(b, RETENTION_DOC)).toBe(false);
  });
});

describe("계약서 세트 — 갱신계약에도 확인서가 따라붙는다", () => {
  it("신규 때는 월급제였다가 갱신에서 인센티브가 되면 퇴직유보금 확인서가 나온다", () => {
    const renewed = contractBodies({
      employee: emp({ payScheme: "MONTHLY" }), // 카드는 아직 옛 조건
      contract: ct({ templateKey: "INCENTIVE", stage: "RENEWAL_1" }), // 계약이 진실
      company,
    });
    expect(has(renewed, RETENTION_DOC)).toBe(true);
    expect(has(renewed, "인센티브 산정 계약서")).toBe(true);
  });

  it("갱신에서 위탁계약으로 바뀌면 개인사업자 지위 확인서가 나온다", () => {
    const renewed = contractBodies({
      employee: emp({ payScheme: "HOURLY" }),
      contract: ct({ templateKey: "HOURLY", isContractor: true, stage: "RENEWAL_1" }),
      company,
    });
    expect(has(renewed, "개인사업자 지위 확인서")).toBe(true);
  });

  it("조건이 그대로면 계약서만 나온다 (군더더기를 붙이지 않는다)", () => {
    const b = contractBodies({ employee: emp(), contract: ct(), company });
    expect(b).toHaveLength(1);
    expect(b[0]).toContain("근로계약서");
  });

  it("계약서 세트는 서약서를 포함하지 않는다 — 갱신 때 다시 받지 않는다", () => {
    const b = contractBodies({
      employee: emp({ payScheme: "RATIO" }),
      contract: ct({ templateKey: "RATIO" }),
      company,
    });
    expect(has(b, "복 무 서 약 서")).toBe(false);
    expect(has(b, "보 안 서 약 서")).toBe(false);
  });
});

describe("퇴직유보금 확인서 — 별도 통장", () => {
  it("직원 정보에 유보금 통장이 있으면 적어 준다", () => {
    const b = contractBodies({
      employee: emp({
        payScheme: "INCENTIVE",
        retentionBank: "미래에셋",
        retentionAccount: "010-2875-8252-1",
      }),
      contract: ct({ templateKey: "INCENTIVE" }),
      company,
    });
    const doc = findDoc(b, RETENTION_DOC)!;
    expect(doc).toContain("미래에셋");
    expect(doc).toContain("010-2875-8252-1");
  });

  it("없으면 손으로 적을 빈칸을 남긴다", () => {
    const b = contractBodies({
      employee: emp({ payScheme: "INCENTIVE" }),
      contract: ct({ templateKey: "INCENTIVE" }),
      company,
    });
    const doc = findDoc(b, RETENTION_DOC)!;
    expect(doc).toContain("인센티브 퇴직유보금 납입 통장");
  });
});

describe("주민등록번호는 문서에 마스킹해 찍는다", () => {
  it("개인사업자 지위 확인서에도 전체 번호가 나가지 않는다", () => {
    const b = contractBodies({
      employee: emp({ payScheme: "RATIO", rrn: "900101-1234567" }),
      contract: ct({ templateKey: "RATIO" }),
      company,
    });
    const doc = findDoc(b, "개인사업자 지위 확인서")!;
    expect(doc).not.toContain("900101-1234567");
    expect(doc).toContain("900101-1");
  });
});
