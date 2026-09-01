import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildExportRow,
  exportStatusOf,
  buildPayrollExportWorkbook,
  payDateOf,
  reconcileRow,
  statutoryDeductionOf,
  type ExportPayrollRecord,
} from "./payroll-export";

/** 세무사무소에 넘기던 실제 시트의 한 줄을 그대로 만들기 위한 최소 레코드 */
const rec = (o: Partial<ExportPayrollRecord> & { name: string }): ExportPayrollRecord => ({
  incomeType: "FREELANCE",
  baseP: 0,
  extraP: 0,
  overtimeP: 0,
  nightP: 0,
  holidayP: 0,
  extraHours: 0,
  overtimeHours: 0,
  nightHours: 0,
  holidayHours: 0,
  holidayOverHours: 0,
  hourlyWage: 0,
  weeklyHolidayP: 0,
  positionP: 0,
  mealP: 0,
  carP: 0,
  incentiveP: 0,
  bonusP: 0,
  unusedLeaveP: 0,
  gross: 0,
  pensionD: 0,
  employmentD: 0,
  healthD: 0,
  longTermD: 0,
  incomeTaxD: 0,
  localTaxD: 0,
  retentionD: 0,
  parkingD: 0,
  expenseD: 0,
  otherD: 0,
  net: 0,
  ...o,
  // rrn 을 명시적으로 null 로 줄 수 있어야 한다 (?? 를 쓰면 null 이 기본값으로 덮인다)
  employee: {
    name: o.name,
    empNo: "1",
    rrn: "rrn" in (o as any) ? (o as any).rrn : "961003-2951624",
    resignDate: (o as any).resignDate ?? null,
  },
});

describe("payDateOf — 익월 지급일", () => {
  it("7월 급여는 8월 7일에 지급", () => {
    expect(payDateOf(2026, 7, 7)).toBe("08월 07일");
  });
  it("12월 급여는 다음 해 1월", () => {
    expect(payDateOf(2026, 12, 7)).toBe("01월 07일");
  });
  it("그 달에 없는 날짜는 말일로 당긴다", () => {
    expect(payDateOf(2026, 1, 30)).toBe("02월 28일");
  });
});

describe("열 관계 — 세무사가 이 표로 신고하므로 반드시 맞아야 한다", () => {
  it("세전총계 = 세전급여 + 인센티브 + 오버타임 + 미사용연차 + 상여", () => {
    // 이서영 행 재현: 세전급여 400만 · 오버타임 81,468 · 상여 20만 → 세전총계 4,281,468
    const r = buildExportRow(
      rec({
        name: "이서영",
        baseP: 4_000_000,
        overtimeP: 81_468,
        extraHours: 4,
        hourlyWage: 20_367, // 4h × 20,367 = 81,468
        bonusP: 200_000,
        gross: 4_281_468,
        incomeTaxD: 137_160,
        localTaxD: 4_120,
        retentionD: 16_667,
        net: 4_123_521,
      }),
      "08월 07일"
    );
    expect(r.basePay).toBe(4_000_000);
    expect(r.overtimePay).toBe(81_468);
    expect(r.bonus).toBe(200_000);
    expect(r.grossTotal).toBe(4_281_468);
    expect(r.basePay + r.incentive + r.overtimePay + r.unusedLeavePay + r.bonus).toBe(r.grossTotal);
  });

  it("인센티브는 세전급여에 섞이지 않고 제 열로 빠진다", () => {
    // 월급 350만 + 인센티브 120만 → 세전총계 470만. 세무사가 고정급/성과급을 갈라 봐야 한다.
    const r = buildExportRow(
      rec({
        name: "홍경지",
        baseP: 3_500_000,
        incentiveP: 1_200_000,
        gross: 4_700_000,
        incomeTaxD: 141_000,
        localTaxD: 14_100,
        retentionD: 100_000, // 인센티브 120만 × 1/12
        net: 4_444_900,
      }),
      "08월 07일"
    );
    expect(r.incentive).toBe(1_200_000);
    expect(r.basePay).toBe(3_500_000); // 인센티브가 여기 섞이지 않는다
    expect(r.basePay + r.incentive).toBe(r.grossTotal);
    // 유보액(인센티브 × 1/12)을 인센티브 열과 대조할 수 있어야 한다
    expect(Math.round(r.incentive / 12)).toBe(r.retention);
    expect(reconcileRow(r)).toBe(0);
  });

  it("입금액 = 세전총계 − 공제 − 유보액 − 주차비 (이서영: 유보액이 빠진다)", () => {
    const r = buildExportRow(
      rec({
        name: "이서영",
        gross: 4_281_468,
        overtimeP: 81_468,
        extraHours: 4,
        hourlyWage: 20_367,
        bonusP: 200_000,
        incomeTaxD: 137_160,
        localTaxD: 4_120,
        retentionD: 16_667,
        net: 4_123_521,
      }),
      "08월 07일"
    );
    expect(r.deduction).toBe(141_280);
    expect(r.retention).toBe(16_667);
    expect(r.netPay).toBe(4_123_521);
    expect(reconcileRow(r)).toBe(0);
  });

  it("주차비 환급(−)이면 입금액이 늘어난다 (김은진: −35,000)", () => {
    const r = buildExportRow(
      rec({
        name: "김은진",
        gross: 11_649_375,
        incomeTaxD: 349_480,
        localTaxD: 34_940,
        parkingD: -35_000,
        net: 11_299_955,
      }),
      "08월 07일"
    );
    expect(r.deduction).toBe(384_420);
    expect(r.parking).toBe(-35_000);
    expect(r.netPay).toBe(11_299_955);
    expect(reconcileRow(r)).toBe(0);
  });

  it("주차비 공제(+)는 입금액을 줄인다 (배승희: 75,000)", () => {
    const r = buildExportRow(
      rec({
        name: "배승희",
        gross: 3_426_608,
        overtimeP: 226_608,
        extraHours: 8,
        hourlyWage: 28_326, // 8h × 28,326 = 226,608
        incomeTaxD: 102_780,
        localTaxD: 10_280,
        parkingD: 75_000,
        net: 3_238_548,
      }),
      "08월 07일"
    );
    expect(r.basePay).toBe(3_200_000);
    expect(r.deduction).toBe(113_060);
    expect(r.netPay).toBe(3_238_548);
    expect(reconcileRow(r)).toBe(0);
  });

  it("포괄임금 약정분은 오버타임수당에 넣지 않는다 — 계약에 이미 포함된 돈이다", () => {
    // 하수정 행: 기준급여 500만(식대 20만 포함) + 휴일 8시간(수기 입력) 271,560
    //   연장 147,489 · 야간 122,907 은 계약서 제4조의 포괄임금 약정분이라 매달 고정이다.
    const r = buildExportRow(
      rec({
        name: "하수정",
        baseP: 4_529_604,
        overtimeP: 147_489, // 약정분 (입력 시간 0)
        nightP: 122_907, // 약정분 (입력 시간 0)
        holidayP: 271_560,
        holidayHours: 8,
        hourlyWage: 22_630, // 8h × 22,630 × 1.5 = 271,560
        mealP: 200_000,
        gross: 5_271_560,
        net: 5_271_560,
      }),
      "08월 07일"
    );
    // 수기로 넣은 휴일 8시간분만 오버타임으로 잡힌다
    expect(r.overtimePay).toBe(271_560);
    // 약정분은 세전급여로 들어가 계약 월 급여총액(500만)과 정확히 맞아떨어진다
    expect(r.basePay).toBe(5_000_000);
    expect(r.basePay + r.overtimePay).toBe(r.grossTotal);
  });

  it("시간 입력이 하나도 없으면 오버타임수당은 0 — 약정분만 있는 달", () => {
    const r = buildExportRow(
      rec({
        name: "하수정",
        overtimeP: 147_489,
        nightP: 122_907,
        hourlyWage: 22_630,
        gross: 5_000_000,
        net: 5_000_000,
      }),
      "08월 07일"
    );
    expect(r.overtimePay).toBe(0);
    expect(r.basePay).toBe(5_000_000);
  });

  it("법내연장·연장·야간·휴일·휴일초과가 모두 배수대로 합산된다", () => {
    const r = buildExportRow(
      rec({
        name: "혼합",
        hourlyWage: 10_000,
        extraHours: 1, // ×1.0 = 10,000
        overtimeHours: 2, // ×1.5 = 30,000
        nightHours: 4, // ×0.5 = 20,000
        holidayHours: 3, // ×1.5 = 45,000
        holidayOverHours: 1, // ×2.0 = 20,000
        gross: 3_125_000,
        net: 3_125_000,
      }),
      "-"
    );
    expect(r.overtimePay).toBe(125_000);
    expect(r.basePay).toBe(3_000_000);
  });

  it("'공제' 열에는 법정공제만 담는다 — 유보금·주차비를 섞으면 신고액이 틀어진다", () => {
    const r = rec({
      name: "테스트",
      gross: 3_000_000,
      pensionD: 100_000,
      healthD: 90_000,
      longTermD: 11_000,
      employmentD: 27_000,
      incomeTaxD: 50_000,
      localTaxD: 5_000,
      retentionD: 80_000,
      parkingD: 35_000,
      net: 2_602_000,
    });
    expect(statutoryDeductionOf(r)).toBe(283_000);
    expect(buildExportRow(r, "-").deduction).toBe(283_000);
  });
});

describe("워크북 출력", () => {
  const records = [
    rec({
      name: "김은진",
      gross: 11_649_375,
      incomeTaxD: 349_480,
      localTaxD: 34_940,
      parkingD: -35_000,
      net: 11_299_955,
    }),
    rec({
      name: "정수진",
      gross: 5_000_000,
      incomeTaxD: 150_000,
      localTaxD: 15_000,
      net: 4_835_000,
    }),
  ];

  const read = () => {
    const { buffer } = buildPayrollExportWorkbook({
      year: 2026,
      month: 7,
      payday: 7,
      companyName: "주식회사 유쌤에듀",
      records,
    });
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });
  };

  it("제목·머리글이 기존 시트와 같은 순서다", () => {
    const aoa = read();
    expect(String(aoa[0][0])).toContain("2026년 7월 급여자료");
    expect(String(aoa[0][0])).toContain("지급일 08월 07일");
    expect(aoa[1]).toEqual([
      "",
      "지급일",
      "세전급여",
      "인센티브",
      "오버타임수당",
      "미사용연차수당",
      "상여금",
      "세전총계",
      "공제",
      "입금액(공제후)",
      "인센티브유보액",
      "월정기주차비(50%)차감",
      "기타",
      "ID",
      "재직 상태",
    ]);
  });

  it("이름에 '선생님' 이 붙고 주민번호가 ID 열에 들어간다", () => {
    const aoa = read();
    expect(aoa[2][0]).toBe("김은진선생님");
    expect(aoa[2][13]).toBe("961003-2951624");
  });

  it("합계 행이 붙는다", () => {
    const aoa = read();
    const last = aoa[aoa.length - 1];
    const at = (label: string) => last[(aoa[1] as any[]).indexOf(label)];
    expect(String(last[0])).toBe("합계 (2명)");
    expect(at("세전총계")).toBe(11_649_375 + 5_000_000);
    expect(at("입금액(공제후)")).toBe(11_299_955 + 4_835_000);
    expect(at("월정기주차비(50%)차감")).toBe(-35_000);
  });

  it("인센티브가 있는 달은 합계에도 따로 잡힌다", () => {
    const { buffer } = buildPayrollExportWorkbook({
      year: 2026,
      month: 7,
      payday: 7,
      companyName: "유쌤에듀",
      records: [
        rec({ name: "가", baseP: 3_000_000, incentiveP: 600_000, gross: 3_600_000, net: 3_600_000 }),
        rec({ name: "나", baseP: 3_000_000, gross: 3_000_000, net: 3_000_000 }),
      ],
    });
    const wb = XLSX.read(buffer, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      blankrows: false,
    });
    const col = (aoa[1] as any[]).indexOf("인센티브");
    expect(aoa[2][col]).toBe(600_000);
    expect(aoa[3][col] ?? "").toBe(""); // 인센티브가 없는 직원은 0 이 아니라 빈칸 (서식용 빈 셀)
    expect(aoa[aoa.length - 1][col]).toBe(600_000);
  });

  it("실비·기타공제가 있는 달에만 그 열이 붙는다 (합계가 어긋나지 않게)", () => {
    const withExpense = buildPayrollExportWorkbook({
      year: 2026,
      month: 7,
      payday: 7,
      companyName: "유쌤에듀",
      records: [
        rec({
          name: "가",
          gross: 3_000_000,
          incomeTaxD: 90_000,
          localTaxD: 9_000,
          expenseD: -20_000,
          net: 2_921_000,
        }),
      ],
    });
    const wb = XLSX.read(withExpense.buffer, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      blankrows: false,
    });
    expect(aoa[1]).toContain("실비 정산(±)");
    expect(aoa[1]).not.toContain("기타공제");
    expect(withExpense.mismatches).toEqual([]);
  });

  it("합계가 어긋나면 시트에 경고를 남긴다", () => {
    const bad = buildPayrollExportWorkbook({
      year: 2026,
      month: 7,
      payday: 7,
      companyName: "유쌤에듀",
      records: [rec({ name: "나", gross: 3_000_000, incomeTaxD: 99_000, net: 2_800_000 })],
    });
    expect(bad.mismatches.length).toBe(1);
    expect(bad.mismatches[0]).toContain("어긋남");
  });

  it("주민번호가 비어 있으면 알린다 — 세무사가 신고할 수 없다", () => {
    const r = buildPayrollExportWorkbook({
      year: 2026,
      month: 7,
      payday: 7,
      companyName: "유쌤에듀",
      records: [
        rec({ name: "다", rrn: null, gross: 1_000_000, incomeTaxD: 30_000, net: 970_000 } as any),
      ],
    });
    expect(r.missingId).toEqual(["다선생님"]);
  });

  it("정상적인 달에는 경고가 없다", () => {
    const { mismatches, missingId } = buildPayrollExportWorkbook({
      year: 2026,
      month: 7,
      payday: 7,
      companyName: "유쌤에듀",
      records,
    });
    expect(mismatches).toEqual([]);
    expect(missingId).toEqual([]);
  });
});

describe("재직 상태 열 — 그 달 퇴직자 표시", () => {
  it("퇴사일이 그 달 안이면 '퇴직'", () => {
    expect(exportStatusOf(new Date(Date.UTC(2026, 7, 15)), 2026, 8)).toBe("퇴직");
    expect(exportStatusOf("2026-08-31", 2026, 8)).toBe("퇴직");
  });
  it("그 전에 퇴직한 사람(정산분 수동 추가)도 '퇴직'", () => {
    expect(exportStatusOf("2026-07-31", 2026, 8)).toBe("퇴직");
  });
  it("퇴사 예정(다음 달 이후)이거나 퇴사일이 없으면 빈칸 — 그 달은 아직 재직", () => {
    expect(exportStatusOf("2026-09-01", 2026, 8)).toBe("");
    expect(exportStatusOf(null, 2026, 8)).toBe("");
  });
  it("시트 마지막 열에 '퇴직' 이 적히고 합계 행에 인원이 잡힌다", () => {
    const { buffer, rows } = buildPayrollExportWorkbook({
      year: 2026,
      month: 7,
      payday: 7,
      companyName: "주식회사 유쌤에듀",
      records: [
        rec({ name: "재직자", gross: 1_000_000, net: 1_000_000 }),
        { ...rec({ name: "퇴직자", gross: 500_000, net: 500_000 }), employee: { name: "퇴직자", empNo: "2", rrn: "1", resignDate: new Date(Date.UTC(2026, 6, 15)) } },
      ],
    });
    expect(rows.map((r) => r.status)).toEqual(["", "퇴직"]);
    const wb = XLSX.read(buffer, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
    const col = (aoa[1] as any[]).indexOf("재직 상태");
    expect(col).toBe(aoa[1].length - 1); // 마지막 열
    expect(aoa[3][col]).toBe("퇴직");
    expect(aoa[4][col]).toBe("퇴직 1명"); // 합계 행
  });
});
