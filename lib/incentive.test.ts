import { describe, it, expect } from "vitest";
import {
  studentWeight,
  summarizeIncentive,
  parseDateSessionCell,
  STANDARD_SESSIONS,
  type RosterStudent,
} from "./incentive";

function full(n: number, from = 1): RosterStudent[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: from + i,
    status: "ENROLLED" as const,
    name: `학생${from + i}`,
    sessions: null,
  }));
}
function partial(
  status: RosterStudent["status"],
  sessions: number[],
  prefix: string
): RosterStudent[] {
  return sessions.map((s, i) => ({
    status,
    name: `${prefix}${i + 1}`,
    sessions: s,
  }));
}

describe("studentWeight — 재원계수", () => {
  it("회차 미기재(만근)는 1.0", () => {
    expect(studentWeight({ status: "ENROLLED", name: "A", sessions: null })).toBe(1);
  });
  it("8회 만근 = 1.0, 4회 = 0.5, 0회 = 0", () => {
    expect(studentWeight({ status: "WITHDRAWN", name: "A", sessions: 8 })).toBe(1);
    expect(studentWeight({ status: "WITHDRAWN", name: "A", sessions: 4 })).toBe(0.5);
    expect(studentWeight({ status: "WITHDRAWN", name: "A", sessions: 0 })).toBe(0);
  });
  it("표준 회차를 넘어도 1.0 으로 상한", () => {
    expect(studentWeight({ status: "ENROLLED", name: "A", sessions: 9 })).toBe(1);
  });
});

describe("summarizeIncentive — 실제 엑셀 양식 재현", () => {
  // 23년 7월 김지연 선생님: 기준 40명 / 기준금액 100,000원 (회당 12,500원)
  it("23년 7월 김지연 — 인센티브 2,162,500원", () => {
    const students: RosterStudent[] = [
      ...full(49), // 1~49 만근 재원
      // 50~63 월중 입학
      ...partial("ENROLLED", [4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 2], "신규"),
      ...partial("TRANSFERRED", [3, 4, 4, 4], "전출"),
      ...partial("WITHDRAWN", [0, 0, 0, 0, 2, 2, 5, 7, 8], "퇴원"),
    ];
    const r = summarizeIncentive(students, { threshold: 40, perStudent: 100_000 });
    expect(r.units).toBeCloseTo(61.625, 6);
    expect(r.over).toBeCloseTo(21.625, 6);
    expect(r.amount).toBe(2_162_500);
    expect(r.perSession).toBe(12_500);
    // 학생별 배분 합계 = 총액
    expect(r.rows.reduce((a, x) => a + x.amount, 0)).toBe(2_162_500);
    // 기준 인원(40명) 이내 만근 학생은 인센티브 0
    expect(r.rows[0].amount).toBe(0);
    expect(r.rows[39].amount).toBe(0);
    // 41번째 만근 학생부터 기준금액 전액
    expect(r.rows[40].amount).toBe(100_000);
    // 4회 학생 = 50,000원, 5회 = 62,500원, 2회 = 25,000원
    expect(r.rows.find((x) => x.name === "신규1")!.amount).toBe(50_000);
    expect(r.rows.find((x) => x.name === "신규3")!.amount).toBe(62_500);
    expect(r.rows.find((x) => x.name === "신규14")!.amount).toBe(25_000);
    // 전출 3회 = 37,500원
    expect(r.rows.find((x) => x.name === "전출1")!.amount).toBe(37_500);
    // 퇴원 0회 = 0원, 7회 = 87,500원, 8회 = 100,000원
    expect(r.rows.find((x) => x.name === "퇴원1")!.amount).toBe(0);
    expect(r.rows.find((x) => x.name === "퇴원8")!.amount).toBe(87_500);
    expect(r.rows.find((x) => x.name === "퇴원9")!.amount).toBe(100_000);
  });

  // 26년 6월 서연승 선생님: 기준 50명 / 기준금액 70,000원
  it("26년 6월 서연승 — 인센티브 420,000원", () => {
    const students: RosterStudent[] = [
      ...full(55),
      ...partial("WITHDRAWN", [0, 0, 8], "퇴원"),
    ];
    const r = summarizeIncentive(students, { threshold: 50, perStudent: 70_000 });
    expect(r.units).toBe(56);
    expect(r.amount).toBe(420_000);
    expect(r.rows.filter((x) => x.amount > 0)).toHaveLength(6); // 51~55 + 퇴원(8회)
    expect(r.rows.reduce((a, x) => a + x.amount, 0)).toBe(420_000);
  });

  it("기준 인원 이하이면 인센티브 0", () => {
    const r = summarizeIncentive(full(30), { threshold: 40, perStudent: 100_000 });
    expect(r.amount).toBe(0);
    expect(r.rows.every((x) => x.amount === 0)).toBe(true);
  });

  it("만근 학생이 기준 인원을 먼저 채운다 (중도학생이 앞에 있어도 동일 총액)", () => {
    const a = summarizeIncentive(
      [...partial("WITHDRAWN", [4], "퇴원"), ...full(41)],
      { threshold: 40, perStudent: 100_000 }
    );
    expect(a.units).toBeCloseTo(41.5, 6);
    expect(a.amount).toBe(150_000);
    expect(a.rows[0].amount).toBe(50_000); // 중도 학생 4회분
  });
});

describe("parseDateSessionCell — '7/17(4회)' 형식", () => {
  it("날짜 + 회차 동시 파싱", () => {
    const r = parseDateSessionCell("7/17(4회)", 2023);
    expect(r.date!.toISOString().slice(0, 10)).toBe("2023-07-17");
    expect(r.sessions).toBe(4);
  });
  it("0회 퇴원", () => {
    const r = parseDateSessionCell("7/3(0회)", 2023);
    expect(r.sessions).toBe(0);
  });
  it("날짜만 있으면 회차 null(만근)", () => {
    expect(parseDateSessionCell("6/30", 2026).sessions).toBeNull();
  });
  it("빈 셀", () => {
    expect(parseDateSessionCell(null, 2026)).toEqual({ date: null, sessions: null });
  });
  it("표준 회차 상수는 8", () => {
    expect(STANDARD_SESSIONS).toBe(8);
  });
});

/* ==================== 매출 기준 산정 (사업소득 · 매출비율 인센티브) ==================== */

import * as XLSX from "xlsx";
import {
  summarizeRevenueShare,
  isRevenueRoster,
  parseRosterWorkbook,
  rostersForMonth,
  parsePercentLabel,
  findMonthBlocks,
} from "./incentive";

describe("summarizeRevenueShare — 매출 × 배분율", () => {
  const rows = (revs: number[]): RosterStudent[] =>
    revs.map((r, i) => ({ status: "ENROLLED" as const, name: `학생${i + 1}`, revenue: r }));

  it("총액은 Σ매출 × 배분율", () => {
    const s = summarizeRevenueShare(rows([380_000, 380_000, 266_000]), { percent: 0.45 });
    expect(s.revenue).toBe(1_026_000);
    expect(s.amount).toBe(461_700);
  });

  it("학생별 금액의 합이 총액과 정확히 일치한다 (반올림 잔차 흡수)", () => {
    // 3원씩 흘리는 값 — 각자 반올림하면 합이 총액과 어긋난다
    const s = summarizeRevenueShare(rows([33_333, 33_333, 33_333]), { percent: 0.333 });
    expect(s.amount).toBe(Math.round(99_999 * 0.333));
    expect(s.rows.reduce((a, r) => a + r.amount, 0)).toBe(s.amount);
  });

  it("매출 0인 학생(월초 퇴원)은 0원이고 인원만 센다", () => {
    const s = summarizeRevenueShare(rows([380_000, 0, 0]), { percent: 0.4 });
    expect(s.amount).toBe(152_000);
    expect(s.activeCount).toBe(1);
    expect(s.zeroCount).toBe(2);
    expect(s.rows[1].amount).toBe(0);
  });

  it("배분율이 없으면 0원 (계약에 율이 안 들어간 경우)", () => {
    expect(summarizeRevenueShare(rows([380_000]), { percent: 0 }).amount).toBe(0);
  });

  it("실제 관리시트 재현 — 김은진 26년7월 매출 25,887,500 × 45% = 11,649,375", () => {
    const s = summarizeRevenueShare(rows([25_887_500]), { percent: 0.45 });
    expect(s.amount).toBe(11_649_375);
  });

  it("isRevenueRoster — 매출 열이 하나라도 있으면 매출 기준", () => {
    expect(isRevenueRoster(rows([380_000]))).toBe(true);
    expect(isRevenueRoster([{ status: "ENROLLED", name: "가", sessions: 8 }])).toBe(false);
  });
});

describe("parsePercentLabel — 열 제목에서 배분율", () => {
  it("① 기호와 산식이 붙어 있어도 읽는다", () => {
    expect(parsePercentLabel("② 사업소득(45%) = ①x45%")).toBe(0.45);
    expect(parsePercentLabel("② 인센티브(15%) = ① x 15%")).toBe(0.15);
    expect(parsePercentLabel("② 사업소득(40%) = ①x40%")).toBe(0.4);
  });
  it("율이 없으면 null", () => {
    expect(parsePercentLabel("인센티브")).toBeNull();
    expect(parsePercentLabel(null)).toBeNull();
  });
  it("100% 를 넘는 값은 배분율이 아니다", () => {
    expect(parsePercentLabel("증가율 150%")).toBeNull();
  });
});

/* --------------------------- 엑셀 파서 --------------------------- */

const REV_HEAD = [
  "번호",
  "상태",
  "이름",
  "반",
  "학교/학년",
  "입학일",
  "퇴원일",
  "① 수강료 매출(+)",
  "② 사업소득(45%) = ①x45%",
  "비고",
];
const HEAD_HEAD = ["번호", "상태", "이름", "반", "학교/학년", "입학일", "퇴원일", "인센티브"];

/** 가로로 이어 붙인 월 블록 시트 만들기 */
function sheetOf(rows: any[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}
function wbOf(sheets: Record<string, any[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(wb, sheetOf(rows), name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseRosterWorkbook — 탭=강사, 가로로 이어진 월 블록", () => {
  // 6월 블록(A~J)과 7월 블록(L~U)이 나란히 있는 시트
  const twoMonths = [
    ["사업소득 상세 내역 - 26년6월", ...Array(9).fill(null), "사업소득 상세 내역 - 26년7월"],
    ["김은진 선생님", ...Array(9).fill(null), "김은진 선생님"],
    [...REV_HEAD, null, ...REV_HEAD],
    [1, "재원", "유월생", "A반", "미사고", null, null, 100_000, 45_000, null, null,
     1, "재원", "칠월생", "B반", "미사고", null, null, 380_000, 171_000, null],
    ["-", "퇴원", "유월퇴", "A반", "미사고", null, "6/2(0회)", 0, 0, null, null,
     2, "신규", "칠월신", "B반", "미사고", "7/9(6회)", null, 266_000, 119_700, null],
    ["TOTAL", ...Array(6).fill(null), 100_000, 45_000, null, null,
     "TOTAL", ...Array(6).fill(null), 646_000, 290_700, null],
  ];

  it("한 시트의 두 달을 각각 다른 블록으로 읽는다", () => {
    const blocks = parseRosterWorkbook(wbOf({ 김은진: twoMonths }));
    expect(blocks.map((b) => `${b.year}-${b.month}`)).toEqual(["2026-6", "2026-7"]);
    expect(blocks[0].students.map((s) => s.name)).toEqual(["유월생", "유월퇴"]);
    expect(blocks[1].students.map((s) => s.name)).toEqual(["칠월생", "칠월신"]);
  });

  it("연·월로 대상 달만 고른다 — 파일에 늘 여러 달이 들어 있다", () => {
    const jul = rostersForMonth(parseRosterWorkbook(wbOf({ 김은진: twoMonths })), 2026, 7);
    expect(jul).toHaveLength(1);
    expect(jul[0].students).toHaveLength(2);
    expect(jul[0].sheetTotalRevenue).toBe(646_000);
    expect(jul[0].sheetTotalAmount).toBe(290_700);
  });

  it("매출·배분율·상태·회차를 학생마다 읽는다", () => {
    const [b] = rostersForMonth(parseRosterWorkbook(wbOf({ 김은진: twoMonths })), 2026, 7);
    expect(b.sharePercent).toBe(0.45);
    expect(b.titleKind).toBe("BUSINESS");
    const [s1, s2] = b.students;
    expect(s1.revenue).toBe(380_000);
    expect(s2.revenue).toBe(266_000);
    expect(s2.status).toBe("NEW");
    expect(s2.sessions).toBe(6);
    expect(s2.enrollDate!.toISOString().slice(0, 10)).toBe("2026-07-09");
  });

  it("TOTAL 행은 학생으로 세지 않는다", () => {
    const [b] = rostersForMonth(parseRosterWorkbook(wbOf({ 김은진: twoMonths })), 2026, 7);
    expect(b.students.every((s) => s.name !== "TOTAL")).toBe(true);
  });

  it("탭마다 강사가 다르고 한 번에 다 읽는다", () => {
    const buf = wbOf({ 김은진: twoMonths, 정수진: twoMonths });
    const jul = rostersForMonth(parseRosterWorkbook(buf), 2026, 7);
    expect(jul).toHaveLength(2);
    expect(jul.map((b) => b.sheetName)).toEqual(["김은진", "정수진"]);
  });

  it("「○○○ 선생님」이 없으면 탭 이름을 강사명으로 쓴다", () => {
    const noName = twoMonths.map((r, i) => (i === 1 ? Array(21).fill(null) : r));
    const [b] = rostersForMonth(parseRosterWorkbook(wbOf({ 안정미: noName })), 2026, 7);
    expect(b.teacherName).toBe("안정미");
  });

  it("제목이 「인센티브 상세 내역」이면 titleKind 가 INCENTIVE", () => {
    const rows = twoMonths.map((r) =>
      r.map((c) => (typeof c === "string" ? c.replace("사업소득 상세", "인센티브 상세") : c))
    );
    const [b] = rostersForMonth(parseRosterWorkbook(wbOf({ 안정미: rows })), 2026, 7);
    expect(b.titleKind).toBe("INCENTIVE");
  });
});

describe("parseRosterWorkbook — 인원 기준 양식(좌·우 두 벌)", () => {
  // 좌(A~H) · 우(I~P) 로 같은 표를 두 벌 늘어놓은 「26년 7월」 양식
  const headcount = [
    ["26년 7월"],
    ["하수정 선생님"],
    [...HEAD_HEAD, ...HEAD_HEAD],
    [1, "재원", "왼쪽만근", "A반", "미사고", null, null, 0,
     51, "재원", "오른쪽만근", "B반", "미사고", null, null, 100_000],
    [2, "재원", "왼쪽둘", "A반", "미사고", null, null, null,
     52, "전입", "오른쪽전입", "B반", "미사고", "7/6(7회)", null, 87_500],
    [null, null, null, null, null, null, null, null,
     "-", "퇴원", "오른쪽퇴원", "B반", "미사고", null, "7/8(1회)", 12_500],
    [null, null, null, null, null, null, null, null,
     "-", "퇴원", "회차없는퇴원", "B반", "미사고", null, null, 0],
  ];

  it("좌·우 두 벌을 모두 읽는다", () => {
    const [b] = rostersForMonth(parseRosterWorkbook(wbOf({ 하수정: headcount })), 2026, 7);
    expect(b.students.map((s) => s.name)).toEqual([
      "왼쪽만근",
      "왼쪽둘",
      "오른쪽만근",
      "오른쪽전입",
      "오른쪽퇴원",
      "회차없는퇴원",
    ]);
    expect(isRevenueRoster(b.students)).toBe(false);
  });

  it("뒤 벌이 앞 벌의 퇴원일을 집어 들지 않는다 (열 경계는 제목이 되풀이되는 자리)", () => {
    const [b] = rostersForMonth(parseRosterWorkbook(wbOf({ 하수정: headcount })), 2026, 7);
    const 퇴원 = b.students.find((s) => s.name === "오른쪽퇴원")!;
    expect(퇴원.sessions).toBe(1); // 우측 블록 자기 퇴원일(7/8(1회))
    expect(퇴원.withdrawDate!.toISOString().slice(0, 10)).toBe("2026-07-08");
  });

  it("퇴원인데 회차가 없으면 만근이 아니라 0회로 본다", () => {
    const [b] = rostersForMonth(parseRosterWorkbook(wbOf({ 하수정: headcount })), 2026, 7);
    const s = b.students.find((x) => x.name === "회차없는퇴원")!;
    expect(s.sessions).toBe(0);
    expect(studentWeight(s)).toBe(0);
  });

  it("재원 학생의 빈 회차 칸은 그대로 만근", () => {
    const [b] = rostersForMonth(parseRosterWorkbook(wbOf({ 하수정: headcount })), 2026, 7);
    expect(studentWeight(b.students.find((x) => x.name === "왼쪽만근")!)).toBe(1);
  });

  it("입학·퇴원에 회차가 둘 다 있으면 큰 쪽이 그 달 실제 회차", () => {
    const rows = headcount.map((r) => [...r]);
    rows[5][13] = "7/16(0회)"; // 입학일
    rows[5][14] = "7/21(1회)"; // 퇴원일
    const [b] = rostersForMonth(parseRosterWorkbook(wbOf({ 하수정: rows })), 2026, 7);
    expect(b.students.find((s) => s.name === "오른쪽퇴원")!.sessions).toBe(1);
  });
});

describe("findMonthBlocks — 제목 줄 찾기", () => {
  it("제목이 가장 많이 잡힌 줄을 제목 줄로 본다 (제목이 2행에 있는 시트)", () => {
    const grid = [
      ["김지연 인센티브 관리", null, null, null],
      ["23년 1월", null, "23년 2월", null],
      ["번호", "이름", "번호", "이름"],
    ];
    const blocks = findMonthBlocks(grid);
    expect(blocks.map((b) => `${b.year}-${b.month}`)).toEqual(["2023-1", "2023-2"]);
    expect(blocks[0]).toMatchObject({ c0: 0, c1: 1 });
    expect(blocks[1]).toMatchObject({ c0: 2, c1: 3 });
  });
  it("제목이 없으면 빈 배열", () => {
    expect(findMonthBlocks([["이름", "반"]])).toEqual([]);
  });
});
