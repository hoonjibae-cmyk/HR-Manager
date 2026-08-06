// 세무사무소 제출용 급여자료 (엑셀)
//
// 학원이 매달 세무대행 업체에 넘기던 시트를 그대로 재현한다. 세무사는 이 표로
// 원천세 신고와 공제를 하므로 **열 관계가 반드시 맞아떨어져야** 한다.
//
//   세전총계   = 세전급여 + 인센티브 + 오버타임수당 + 미사용연차수당 + 상여금
//
// '오버타임수당' 은 **그 달에 새로 생긴 초과근로분만** 담는다(`variableOvertimeOf`).
// 포괄임금 약정분(계약서에 이미 포함된 고정 시간외·야간)은 여기 넣지 않고 세전급여로 보낸다.
//   입금액     = 세전총계 − 공제 − 인센티브유보액 − 월정기주차비(50%)차감 − 실비 − 기타공제
//
// 인센티브는 **기본급과 섞지 않고 열을 따로 둔다** — 세무사가 고정급과 성과급을 갈라 봐야 하고,
// 뒤쪽 '인센티브유보액'(인센티브 × 1/12)과 대조도 이 열이 있어야 된다.
//
// '공제' 열은 **법정공제만**(4대보험·소득세·지방소득세) 담는다. 인센티브유보액·주차비는
// 세무 신고 대상이 아니라 회사가 따로 떼는 돈이라 각자 열로 빠져 있다 — 이걸 '공제' 에
// 섞으면 세무사가 신고할 원천징수액이 틀어진다.
//
// 실비정산·기타공제는 평소 비어 있어 원래 시트에 열이 없다. 값이 있는 달에만 열을 붙여
// **합계가 어긋나지 않게** 한다(조용히 빼면 입금액이 안 맞는다).

import * as XLSX from "xlsx";
import { variableOvertimeOf } from "./payroll";

export interface ExportPayrollRecord {
  incomeType: string;
  baseP: number;
  extraP: number;
  overtimeP: number;
  nightP: number;
  holidayP: number;
  /** 그 달 실제로 입력·확정된 시간 — '오버타임수당' 열은 오직 이 시간에서만 나온다 */
  extraHours: number;
  overtimeHours: number;
  nightHours: number;
  holidayHours: number;
  holidayOverHours: number;
  hourlyWage: number;
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
  expenseD: number;
  otherD: number;
  net: number;
  employee: { name: string; empNo: string; rrn?: string | null };
}

export interface ExportRow {
  name: string; // 김은진선생님
  payDate: string; // 08월 07일
  basePay: number; // 세전급여 (인센티브·오버타임·미사용연차·상여를 뺀 나머지)
  incentive: number; // 인센티브 (기본급과 분리)
  overtimePay: number; // 오버타임수당
  unusedLeavePay: number; // 미사용연차수당
  bonus: number; // 상여금
  grossTotal: number; // 세전총계
  deduction: number; // 공제 (법정공제만)
  netPay: number; // 입금액(공제후)
  retention: number; // 인센티브유보액
  parking: number; // 월정기주차비(50%)차감
  expense: number; // 실비 정산(±)
  otherDeduct: number; // 기타공제
  note: string; // 기타 (원천징수 방식)
  id: string; // 주민등록번호
}

/** 지급일 — 임금은 익월 `payday` 일에 지급한다(계약서 제4조와 같은 규칙) */
export function payDateOf(year: number, month: number, payday: number): string {
  const y = month === 12 ? year + 1 : year;
  const m = month === 12 ? 1 : month + 1;
  // 그 달에 없는 날짜(2월 30일 등)면 말일로 당긴다
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(Math.max(Math.round(payday) || 7, 1), last);
  return `${String(m).padStart(2, "0")}월 ${String(d).padStart(2, "0")}일`;
}

/** 법정공제 합계 — 세무사가 신고하는 원천징수분. 유보금·주차비는 여기 들어가지 않는다 */
export function statutoryDeductionOf(r: ExportPayrollRecord): number {
  return (
    (r.pensionD || 0) +
    (r.employmentD || 0) +
    (r.healthD || 0) +
    (r.longTermD || 0) +
    (r.incomeTaxD || 0) +
    (r.localTaxD || 0)
  );
}

/**
 * 세무 시트의 '오버타임수당' — **그 달에 실제로 생긴 초과근로분만** 담는다.
 * 판정은 엔진(`lib/payroll.ts`)에 두고 여기서는 그대로 쓴다 — **퇴직급여 산정도 같은 함수를
 * 쓰므로**(포괄임금 약정분을 산입기준에 넣기 위해) 둘로 두면 두 문서가 어긋난다.
 * 빠진 포괄임금 약정분은 '세전급여' 로 들어가므로 세전총계는 그대로다.
 */
export { variableOvertimeOf };

export function buildExportRow(r: ExportPayrollRecord, payDate: string): ExportRow {
  const overtimePay = variableOvertimeOf(r);
  const unusedLeavePay = r.unusedLeaveP || 0;
  const bonus = r.bonusP || 0;
  const incentive = r.incentiveP || 0;
  // 세전급여 = 총계에서 따로 열이 있는 항목들을 뺀 나머지
  // (기본급·주휴·직책수당·식대·차량유지비 + **포괄임금 약정분**이 여기 뭉쳐 들어간다.
  //  약정분은 계약된 월 급여의 일부이므로 오버타임이 아니라 급여 쪽에 있어야 맞다 — 원래 시트가 그렇다)
  const basePay = (r.gross || 0) - incentive - overtimePay - unusedLeavePay - bonus;
  return {
    name: `${r.employee.name}선생님`,
    payDate,
    basePay,
    incentive,
    overtimePay,
    unusedLeavePay,
    bonus,
    grossTotal: r.gross || 0,
    deduction: statutoryDeductionOf(r),
    netPay: r.net || 0,
    retention: r.retentionD || 0,
    parking: r.parkingD || 0,
    expense: r.expenseD || 0,
    otherDeduct: r.otherD || 0,
    note: r.incomeType === "FREELANCE" ? "3.3% 적용" : "4대보험(근로소득)",
    id: r.employee.rrn || "",
  };
}

/**
 * 행의 합계가 어긋나지 않는지 확인한다 — 어긋난 채로 세무사에게 넘어가면
 * 원천징수 신고가 틀어지므로, 맞지 않는 행은 시트 아래에 경고로 적는다.
 */
export function reconcileRow(row: ExportRow): number {
  const expected =
    row.grossTotal -
    row.deduction -
    row.retention -
    row.parking -
    row.expense -
    row.otherDeduct;
  return row.netPay - expected; // 0 이면 정상
}

const MONEY = "#,##0;-#,##0"; // 음수는 앞에 - (환급/상계)

/** 급여 기록 목록 → 세무사무소 제출용 워크북 버퍼 */
export function buildPayrollExportWorkbook(args: {
  year: number;
  month: number;
  payday: number;
  companyName: string;
  records: ExportPayrollRecord[];
}): { buffer: Buffer; rows: ExportRow[]; mismatches: string[]; missingId: string[] } {
  const payDate = payDateOf(args.year, args.month, args.payday);
  const rows = args.records.map((r) => buildExportRow(r, payDate));

  // 평소 0 인 열은 원래 시트에 없다 — 값이 있는 달에만 붙여 합계가 맞게 한다
  const hasExpense = rows.some((r) => r.expense !== 0);
  const hasOther = rows.some((r) => r.otherDeduct !== 0);

  const header = [
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
    ...(hasExpense ? ["실비 정산(±)"] : []),
    ...(hasOther ? ["기타공제"] : []),
    "기타",
    "ID",
  ];

  const body = rows.map((r) => [
    r.name,
    r.payDate,
    r.basePay,
    r.incentive || null,
    r.overtimePay || null,
    r.unusedLeavePay || null,
    r.bonus || null,
    r.grossTotal,
    r.deduction,
    r.netPay,
    r.retention || null,
    r.parking || null,
    ...(hasExpense ? [r.expense || null] : []),
    ...(hasOther ? [r.otherDeduct || null] : []),
    r.note,
    r.id,
  ]);

  // 합계 행 — 세무사가 총액을 대조할 수 있게
  const sum = (pick: (r: ExportRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const total = [
    `합계 (${rows.length}명)`,
    "",
    sum((r) => r.basePay),
    sum((r) => r.incentive),
    sum((r) => r.overtimePay),
    sum((r) => r.unusedLeavePay),
    sum((r) => r.bonus),
    sum((r) => r.grossTotal),
    sum((r) => r.deduction),
    sum((r) => r.netPay),
    sum((r) => r.retention),
    sum((r) => r.parking),
    ...(hasExpense ? [sum((r) => r.expense)] : []),
    ...(hasOther ? [sum((r) => r.otherDeduct)] : []),
    "",
    "",
  ];

  const title = `${args.companyName} · ${args.year}년 ${args.month}월 급여자료 (지급일 ${payDate})`;
  const aoa: any[][] = [[title], header, ...body, total];

  // 합계가 어긋난 행은 시트 안에 남긴다 (조용히 넘기면 신고가 틀어진다)
  const mismatches = rows
    .map((r) => ({ r, diff: reconcileRow(r) }))
    .filter((x) => x.diff !== 0)
    .map((x) => `${x.r.name}: 입금액이 ${x.diff > 0 ? "+" : ""}${x.diff}원 어긋남`);
  if (mismatches.length) {
    aoa.push([]);
    aoa.push(["⚠️ 합계가 맞지 않는 행이 있습니다 — 확인 후 전달하세요"]);
    for (const m of mismatches) aoa.push([m]);
  }
  // 주민번호가 없으면 세무사가 원천징수 신고를 할 수 없다 — 빈칸으로 넘기지 않고 알린다
  const missingId = rows.filter((r) => !r.id).map((r) => r.name);
  if (missingId.length) {
    aoa.push([]);
    aoa.push([
      `⚠️ 주민등록번호(ID)가 비어 있는 직원 ${missingId.length}명 — 직원 정보에 입력한 뒤 다시 받으세요`,
    ]);
    aoa.push([missingId.join(", ")]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 숫자 열에 천단위 서식 (제목 1행 + 머리글 1행 이후부터 합계행까지)
  const firstNumCol = 2;
  const lastNumCol = header.length - 3; // '기타'·'ID' 앞까지
  for (let r = 2; r < 2 + body.length + 1; r++) {
    for (let c = firstNumCol; c <= lastNumCol; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") cell.z = MONEY;
    }
  }
  ws["!cols"] = [
    { wch: 14 }, // 이름
    { wch: 10 }, // 지급일
    ...Array.from({ length: lastNumCol - firstNumCol + 1 }, () => ({ wch: 13 })),
    { wch: 15 }, // 기타
    { wch: 17 }, // ID
  ];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${args.year}년 ${args.month}월`);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buffer, rows, mismatches, missingId };
}
