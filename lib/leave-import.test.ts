import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseLeaveWorkbook,
  planLeaveImport,
  baseName,
  toSheetDate,
  LEAVE_KINDS,
} from "./leave-import";

/** 실제 관리시트와 같은 모양의 시트를 만든다 (2행 = 1직원) */
function sheet(people: Array<{ name: string; used?: number; comp?: [number, number]; entries: Array<[string, string]> }>, year = 2026) {
  const noHeader = ["", "기준일", "", "회계연도기준", "", "잔여연차일수", "대체휴가부여"];
  for (let i = 1; i <= 33; i++) noHeader.push(`No.${i}`);
  noHeader.push("입사일", "지우지마세요!");
  const rows: any[][] = [
    ["", `${String(year).slice(2)}년 직원 연차 관리시트`],
    [],
    noHeader,
    ["직원", "근속일수", "연차 총일수", "누적사용일수", "전년도사용연차", "", "사용일수"],
    ["", "", "", "", "", "", "", "사용일자"],
  ];
  for (const p of people) {
    const top: any[] = [p.name, "1년0개월0일", 15, p.used ?? "", 0, "", p.comp?.[0] ?? 0];
    const bot: any[] = ["", "", "", "", "", "", p.comp?.[1] ?? 0];
    p.entries.forEach(([label, date]) => {
      top.push(label);
      bot.push(date);
    });
    // 항목 영역 오른쪽의 보조 데이터 (입사일·확정연차) — 휴가로 읽히면 안 된다
    while (top.length < 40) top.push("");
    while (bot.length < 40) bot.push("");
    top[40] = "11/2/21";
    top[41] = 15;
    rows.push(top, bot);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), String(year));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("값 변환", () => {
  it("직책 접미사를 뗀다", () => {
    expect(baseName("박영은_지원팀장")).toBe("박영은");
    expect(baseName("하수정")).toBe("하수정");
    expect(baseName(" 김지연_수석 ")).toBe("김지연");
  });
  it("엑셀식 m/d/yy 날짜", () => {
    expect(toSheetDate("7/29/26", 2026)).toBe("2026-07-29");
    expect(toSheetDate("12/1/25", 2026)).toBe("2025-12-01");
    expect(toSheetDate("2026-07-29", 2026)).toBe("2026-07-29");
    expect(toSheetDate("7/29", 2026)).toBe("2026-07-29");
    expect(toSheetDate("", 2026)).toBeNull();
    expect(toSheetDate("15", 2026)).toBeNull();
  });
  it("휴가종류 가중치 — 연차만 깎는다", () => {
    expect(LEAVE_KINDS["연차"]).toMatchObject({ days: 1, deducts: true, category: "STATUTORY" });
    expect(LEAVE_KINDS["반차"]).toMatchObject({ days: 0.5, deducts: true });
    expect(LEAVE_KINDS["대체휴일"]).toMatchObject({ days: 1, category: "COMP" });
    expect(LEAVE_KINDS["공가공상"].deducts).toBe(false);
    expect(LEAVE_KINDS["무급휴가"].deducts).toBe(false);
  });
});

describe("parseLeaveWorkbook", () => {
  it("두 줄이 한 직원 — 휴가종류와 사용일자를 짝지어 읽는다", () => {
    const { rows, year } = parseLeaveWorkbook(
      sheet([
        {
          name: "박영은_지원팀장",
          used: 2.5,
          entries: [
            ["연차", "2/11/26"],
            ["연차", "3/27/26"],
            ["반차", "4/22/26"],
          ],
        },
      ])
    );
    expect(year).toBe(2026);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("박영은");
    expect(rows[0].entries.map((e) => e.date)).toEqual(["2026-02-11", "2026-03-27", "2026-04-22"]);
    expect(rows[0].computedUsed).toBe(2.5);
    expect(rows[0].warnings).toEqual([]);
  });

  it("항목 영역 밖의 입사일·확정연차를 휴가로 읽지 않는다", () => {
    const { rows } = parseLeaveWorkbook(
      sheet([{ name: "하수정", used: 1, entries: [["연차", "2/4/26"]] }])
    );
    expect(rows[0].entries).toHaveLength(1);
    expect(rows[0].warnings).toEqual([]);
  });

  it("연차를 깎지 않는 휴가도 읽되 합계에서 뺀다", () => {
    const { rows } = parseLeaveWorkbook(
      sheet([
        {
          name: "박채영",
          used: 1,
          entries: [
            ["무급휴가", "2/2/26"],
            ["공가공상", "2/3/26"],
            ["연차", "2/9/26"],
          ],
        },
      ])
    );
    expect(rows[0].entries).toHaveLength(3);
    expect(rows[0].computedUsed).toBe(1); // 연차 1일만
    expect(rows[0].warnings).toEqual([]);
  });

  it("대체휴일은 연차가 아니라 대휴에서 나간다", () => {
    const { rows } = parseLeaveWorkbook(
      sheet([
        {
          name: "서연승",
          used: 1,
          comp: [1.5, 1.5],
          entries: [
            ["대체휴일", "6/24/26"],
            ["대체휴일(반)", "6/25/26"],
            ["연차", "6/29/26"],
          ],
        },
      ])
    );
    expect(rows[0].computedUsed).toBe(1);
    expect(rows[0].compGranted).toBe(1.5);
    expect(rows[0].entries.filter((e) => e.category === "COMP")).toHaveLength(2);
  });

  it("시트의 누적사용일수와 다르면 경고한다", () => {
    const { rows } = parseLeaveWorkbook(
      sheet([{ name: "김지연", used: 5, entries: [["연차", "3/16/26"]] }])
    );
    expect(rows[0].warnings.some((w) => w.includes("다릅니다"))).toBe(true);
  });

  it("모르는 휴가종류는 건너뛰고 알려준다", () => {
    const { rows, unknownKinds } = parseLeaveWorkbook(
      sheet([{ name: "홍경지", entries: [["출산휴가", "7/10/26"], ["연차", "7/29/26"]] }])
    );
    expect(unknownKinds).toEqual(["출산휴가"]);
    expect(rows[0].entries).toHaveLength(1);
  });

  it("연도 시트를 골라 읽는다", () => {
    const wb = XLSX.read(sheet([{ name: "박영은", entries: [["연차", "2/11/26"]] }]), {
      type: "buffer",
    });
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, wb.Sheets["2026"], "2026");
    XLSX.utils.book_append_sheet(wb2, wb.Sheets["2026"], "2025");
    XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([["x"]]), "Dashboard");
    const buf = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });
    expect(parseLeaveWorkbook(buf).year).toBe(2026); // 기본 = 가장 최근
    expect(parseLeaveWorkbook(buf, { year: 2025 }).year).toBe(2025);
    expect(parseLeaveWorkbook(buf).availableYears).toEqual([2026, 2025]);
  });
});

describe("planLeaveImport", () => {
  const emps = [
    { id: 1, name: "박영은", payScheme: "MONTHLY" },
    { id: 2, name: "김지연", payScheme: "MONTHLY" },
    { id: 3, name: "김은진", payScheme: "RATIO" },
  ];
  const parse = (people: any[]) => parseLeaveWorkbook(sheet(people)).rows;

  it("직책 접미사가 붙어 있어도 이름으로 찾는다", () => {
    const plan = planLeaveImport(parse([{ name: "박영은_지원팀장", used: 1, entries: [["연차", "2/11/26"]] }]), emps);
    expect(plan.rows[0].employeeId).toBe(1);
    expect(plan.addCount).toBe(1);
    expect(plan.rows[0].txns[0]).toMatchObject({
      employeeId: 1,
      date: "2026-02-11",
      days: -1,
      type: "USE",
      category: "STATUTORY",
    });
  });

  it("사용은 음수로 넣는다 — 반차는 -0.5", () => {
    const plan = planLeaveImport(parse([{ name: "김지연", used: 0.5, entries: [["반차", "3/16/26"]] }]), emps);
    expect(plan.rows[0].txns[0].days).toBe(-0.5);
  });

  it("같은 날짜에 이미 기록이 있으면 건너뛴다 (두 번 올려도 안전)", () => {
    const rows = parse([
      { name: "박영은", used: 2, entries: [["연차", "2/11/26"], ["연차", "3/27/26"]] },
    ]);
    const existing = [{ employeeId: 1, date: "2026-02-11", category: "STATUTORY" }];
    const plan = planLeaveImport(rows, emps, existing);
    expect(plan.addCount).toBe(1);
    expect(plan.skipCount).toBe(1);
    expect(plan.rows[0].adds[0].date).toBe("2026-03-27");
  });

  it("대체휴일은 부여도 함께 넣어 잔고가 맞는다", () => {
    const rows = parse([
      { name: "김지연", used: 0, comp: [1, 1], entries: [["대체휴일", "4/28/26"]] },
    ]);
    const plan = planLeaveImport(rows, emps);
    const grant = plan.rows[0].txns.find((t) => t.type === "GRANT")!;
    const use = plan.rows[0].txns.find((t) => t.type === "USE")!;
    expect(grant).toMatchObject({ days: 1, category: "COMP" });
    expect(use).toMatchObject({ days: -1, category: "COMP" });
  });

  it("연차를 깎지 않는 휴가는 등록하지 않고 따로 보여준다", () => {
    const rows = parse([
      { name: "박영은", used: 1, entries: [["무급휴가", "2/2/26"], ["연차", "2/9/26"]] },
    ]);
    const plan = planLeaveImport(rows, emps);
    expect(plan.rows[0].adds).toHaveLength(1);
    expect(plan.rows[0].nonDeducting.map((e) => e.label)).toEqual(["무급휴가"]);
    expect(plan.rows[0].txns).toHaveLength(1);
  });

  it("등록되지 않은 사람과 완전비율제는 제외한다", () => {
    const rows = parse([
      { name: "없는사람", used: 1, entries: [["연차", "2/11/26"]] },
      { name: "김은진", used: 1, entries: [["연차", "2/11/26"]] },
    ]);
    const plan = planLeaveImport(rows, emps);
    expect(plan.rows[0].errors[0]).toContain("일치하는 사람이 없습니다");
    expect(plan.unmatched).toEqual(["없는사람"]);
    expect(plan.rows[1].errors[0]).toContain("완전비율제");
    expect(plan.addCount).toBe(0);
  });

  it("동명이인은 등록하지 않는다", () => {
    const dup = [...emps, { id: 4, name: "박영은", payScheme: "MONTHLY" }];
    const plan = planLeaveImport(
      parse([{ name: "박영은_지원팀장", used: 1, entries: [["연차", "2/11/26"]] }]),
      dup
    );
    expect(plan.rows[0].errors[0]).toContain("2명");
    expect(plan.addCount).toBe(0);
  });

  it("발생(부여)은 절대 넣지 않는다 — 연차 총일수는 시스템이 계산한다", () => {
    const plan = planLeaveImport(
      parse([{ name: "박영은", used: 1, entries: [["연차", "2/11/26"]] }]),
      emps
    );
    // COMP 부여를 빼면 GRANT 트랜잭션이 없어야 한다
    expect(plan.rows[0].txns.filter((t) => t.type === "GRANT" && t.category === "STATUTORY")).toEqual([]);
  });
});
