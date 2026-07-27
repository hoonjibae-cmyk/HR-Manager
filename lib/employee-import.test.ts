import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseEmployeeWorkbook,
  buildTemplateWorkbook,
  headerKey,
  toYmd,
  toAmount,
  toRatio,
  toIncomeType,
  toPayScheme,
  IMPORT_COLUMNS,
} from "./employee-import";

function sheet(rows: any[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "명단");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("값 변환 — 사람이 적는 방식 그대로 받는다", () => {
  it("날짜", () => {
    expect(toYmd("2025-03-01")).toBe("2025-03-01");
    expect(toYmd("2025.3.1")).toBe("2025-03-01");
    expect(toYmd("2025년 3월 1일")).toBe("2025-03-01");
    expect(toYmd("20250301")).toBe("2025-03-01");
    expect(toYmd(45717)).toBe("2025-03-01"); // 엑셀 시리얼
    expect(toYmd("")).toBeNull();
    expect(toYmd("미정")).toBeNull();
  });
  it("금액", () => {
    expect(toAmount("3,000,000")).toBe(3_000_000);
    expect(toAmount("300만")).toBe(3_000_000);
    expect(toAmount(3000000)).toBe(3_000_000);
    expect(toAmount("3,000,000원")).toBe(3_000_000);
    expect(toAmount("")).toBe(0);
  });
  it("비율", () => {
    expect(toRatio("50%")).toBe(0.5);
    expect(toRatio(50)).toBe(0.5);
    expect(toRatio(0.5)).toBe(0.5);
    expect(toRatio("40%")).toBeCloseTo(0.4, 10);
    expect(toRatio("")).toBeNull();
  });
  it("세무구분·급여형태", () => {
    expect(toIncomeType("4대보험")).toBe("EMPLOYEE");
    expect(toIncomeType("3.3%")).toBe("FREELANCE");
    expect(toIncomeType("사업소득")).toBe("FREELANCE");
    expect(toPayScheme("월급제")).toBe("MONTHLY");
    expect(toPayScheme("시급제")).toBe("HOURLY");
    expect(toPayScheme("월급+인센티브")).toBe("INCENTIVE");
    expect(toPayScheme("완전비율제")).toBe("RATIO");
    expect(toPayScheme("무엇")).toBeNull();
  });
  it("헤더 표기 흔들림 허용", () => {
    expect(headerKey("성명")).toBe("name");
    expect(headerKey("이 름")).toBe("name");
    expect(headerKey("입사일")).toBe("hireDate");
    expect(headerKey("소속부서")).toBe("department");
    expect(headerKey("없는열")).toBeNull();
  });
});

describe("parseEmployeeWorkbook", () => {
  it("기본 명단을 읽는다", () => {
    const buf = sheet([
      ["성명", "부서", "직책", "입사일자", "세무구분", "급여형태", "기본급", "이메일"],
      ["배지훈", "교수부", "부원장", "2021-01-01", "4대보험", "월급제", "4,500,000", "a@b.com"],
      ["남궁현", "교수부", "강사", "2025-03-01", "3.3%", "완전비율제", "", ""],
    ]);
    const { rows } = parseEmployeeWorkbook(buf);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "배지훈",
      hireDate: "2021-01-01",
      incomeType: "EMPLOYEE",
      payScheme: "MONTHLY",
      baseWage: 4_500_000,
      mealAllow: 200_000, // 4대보험 직원 기본 식대
      email: "a@b.com",
    });
    expect(rows[1].payScheme).toBe("RATIO");
    expect(rows[1].incomeType).toBe("FREELANCE");
    expect(rows[1].mealAllow).toBe(0);
  });

  it("식대 기본값은 4대보험 월급제 계열에만 붙인다", () => {
    const buf = sheet([
      ["성명", "입사일자", "세무구분", "급여형태", "식대"],
      ["월급직원", "2025-03-01", "4대보험", "월급제", ""],
      ["인센강사", "2025-03-01", "4대보험", "월급+인센티브", ""],
      ["시급조교", "2025-03-01", "4대보험", "시급제", ""],
      ["위탁강사", "2025-03-01", "3.3%", "완전비율제", ""],
      ["직접기입", "2025-03-01", "4대보험", "월급제", "150,000"],
    ]);
    const { rows } = parseEmployeeWorkbook(buf);
    expect(rows.map((r) => r.mealAllow)).toEqual([200_000, 200_000, 0, 0, 150_000]);
  });

  it("위탁비율 없는 완전비율제는 오류로 잡는다", () => {
    const buf = sheet([
      ["성명", "입사일자", "급여형태", "위탁비율"],
      ["남궁현", "2025-03-01", "완전비율제", ""],
      ["김강사", "2025-03-01", "완전비율제", "40%"],
    ]);
    const { rows } = parseEmployeeWorkbook(buf);
    expect(rows[0].errors).toContain("완전비율제인데 위탁비율이 없습니다");
    expect(rows[1].errors).toEqual([]);
    expect(rows[1].ratioPercent).toBeCloseTo(0.4, 10);
  });

  it("입사일을 못 읽으면 오류", () => {
    const buf = sheet([
      ["성명", "입사일자"],
      ["홍길동", "미정"],
    ]);
    expect(parseEmployeeWorkbook(buf).rows[0].errors).toContain("입사일자를 읽을 수 없습니다");
  });

  it("계약기간이 뒤집히면 오류", () => {
    const buf = sheet([
      ["성명", "입사일자", "계약시작일", "계약종료일"],
      ["홍길동", "2025-03-01", "2025-03-01", "2024-12-31"],
      ["김직원", "2025-03-01", "2024-01-01", ""],
    ]);
    const { rows } = parseEmployeeWorkbook(buf);
    expect(rows[0].errors).toContain("계약종료일이 계약시작일보다 빠릅니다");
    expect(rows[1].errors).toContain("계약시작일이 입사일보다 빠릅니다");
  });

  it("계약시작일이 없으면 입사일을 쓴다", () => {
    const buf = sheet([
      ["성명", "입사일자"],
      ["홍길동", "2025-03-01"],
    ]);
    expect(parseEmployeeWorkbook(buf).rows[0].contractStart).toBe("2025-03-01");
  });

  it("사번 중복은 오류, 동명이인은 경고", () => {
    const buf = sheet([
      ["사번", "성명", "입사일자"],
      ["E001", "홍길동", "2025-03-01"],
      ["E001", "김철수", "2025-03-01"],
      ["", "홍길동", "2024-01-01"],
    ]);
    const { rows } = parseEmployeeWorkbook(buf);
    expect(rows[0].errors.some((e) => e.includes("중복"))).toBe(true);
    expect(rows[1].errors.some((e) => e.includes("중복"))).toBe(true);
    expect(rows[2].warnings.some((w) => w.includes("같은 이름"))).toBe(true);
  });

  it("빈 줄·합계행은 건너뛴다", () => {
    const buf = sheet([
      ["성명", "입사일자"],
      ["홍길동", "2025-03-01"],
      ["", ""],
      ["", "24명"],
    ]);
    expect(parseEmployeeWorkbook(buf).rows).toHaveLength(1);
  });

  it("헤더가 첫 행이 아니어도 찾아낸다", () => {
    const buf = sheet([
      ["2026년 직원 명단"],
      [],
      ["성명", "입사일자"],
      ["홍길동", "2025-03-01"],
    ]);
    const { rows } = parseEmployeeWorkbook(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNo).toBe(4);
  });

  it("모르는 열은 알려주고 무시한다", () => {
    const buf = sheet([
      ["성명", "입사일자", "혈액형"],
      ["홍길동", "2025-03-01", "A"],
    ]);
    const { unknownHeaders, rows } = parseEmployeeWorkbook(buf);
    expect(unknownHeaders).toEqual(["혈액형"]);
    expect(rows).toHaveLength(1);
  });
});

describe("템플릿", () => {
  it("빈 템플릿에는 데이터 행이 없다 (안내 문구가 직원으로 등록되면 안 된다)", () => {
    const { rows, unknownHeaders, mapped } = parseEmployeeWorkbook(buildTemplateWorkbook());
    expect(rows).toHaveLength(0);
    expect(unknownHeaders).toEqual([]);
    expect(mapped.length).toBe(IMPORT_COLUMNS.length);
  });

  it("템플릿에 직접 적은 행은 정상 인식된다", () => {
    const headers = IMPORT_COLUMNS.map((c) => c.header);
    const row = headers.map((h) =>
      h === "성명" ? "홍길동" : h === "입사일자" ? "2025-03-01" : h === "기본급" ? "3,000,000" : ""
    );
    const { rows } = parseEmployeeWorkbook(sheet([headers, row]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "홍길동", hireDate: "2025-03-01", baseWage: 3_000_000 });
    expect(rows[0].errors).toEqual([]);
  });
});
