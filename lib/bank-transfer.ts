// 은행 대량이체 파일 (하나은행 파일이체 양식)
//
// 급여 산정·수동 조정이 끝나 **세후 금액이 확정된 뒤**, 그 달 실지급액을 은행 인터넷뱅킹의
// '파일이체' 로 한 번에 올리기 위한 엑셀을 만든다. 학원이 쓰던 양식(HNB 대량이체.xls)을
// 그대로 재현한다 — 양식 안내문에 **"Excel Sheet 의 구조는 절대로 변경하지 마십시오"** 라고
// 적혀 있어 열 9개와 순서를 손대지 않는다.
//
//   입금은행 | 입금계좌번호 | 입금액 | 예상예금주 | 입금통장표시 | 출금통장표시 | 메모 | CMS코드 | 받는분 휴대폰번호
//
// 필수는 앞의 셋(입금은행·입금계좌번호·입금액)이고 나머지는 선택이다.
// 계좌번호는 **구분자(-) 없는 숫자만** 받으므로 저장값이 어떤 표기든 여기서 숫자만 남긴다.
//
// **한 사람이 두 줄이 될 수 있다.** 퇴직유보금은 급여와 섞지 않고 별도 통장으로 따로 송금하므로
// (확인서 제6조) 유보금이 있는 달에는 급여 줄 뒤에 유보금 줄이 따로 붙는다.
// 세무 시트의 `입금액(공제후)` 은 이미 유보액을 뺀 금액이라, 두 줄을 그대로 더하면 맞아떨어진다.
//
// **받는 통장은 셋까지 갈린다** — 급여(근로소득) 계좌 · 퇴직유보금 계좌 · 사업소득용 계좌(v1.62).
// 사업소득용 계좌는 비율제 근로계약의 근로소득 상한 초과분, 곧 **별도 사업장이 보내는 사업소득**을 받는
// 통장이다(`bizIncomeDestination`). 그 돈은 출금 계좌도 달라 별도 사업장 파일(`payer: "BIZ"`)에만 실린다.
//
// 파일 형식은 **.xls(BIFF8)** 로 낸다 — 양식 안내문이 xls/csv/txt 만 받는다고 못박고 있다.

import * as XLSX from "xlsx";
import { isContractorContract, isRatioEmployee } from "./constants";
import { recordSplit } from "./ratio-employee";
import { bizIncomeDestination, maskAccount, normalizeAccountNo, normalizeBankName } from "./bank-account";

export { bizIncomeDestination, maskAccount, normalizeAccountNo, normalizeBankName };
export type { BizIncomeDestination, BizIncomeSource } from "./bank-account";

/* ============================ 은행명·계좌 ============================ */
//
// 은행명·계좌번호 정리와 사업소득용 계좌 판정은 `lib/bank-account.ts` 에 있다(엑셀 라이브러리가 없는 순수
// 모듈 — 직원 폼·직원 상세 화면이 함께 쓴다). 여기서 쓰던 이름 그대로 다시 내보낸다.

/** 머리글 비교용 — 공백을 떼고 소문자로 */
const normKey = (s: unknown) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

/* ============================ 이체 줄 만들기 ============================ */

export interface TransferPayrollRecord {
  net: number; // 입금액(공제후) — 유보액을 이미 뺀 실지급액
  retentionD: number; // 퇴직유보금 (별도 통장)
  incomeType: string;
  payScheme: string;
  /** 비율제 근로계약으로 산정한 기록(스냅샷) — RATIO 여도 '급여' 로 적는다 */
  ratioEmployee?: boolean | null;
  /**
   * 비율제 근로자의 근로소득 상한 초과분 — `net` 안에 들어 있지만 **별도 사업장이 보내는 돈**이다.
   * 이 회사 파일에서는 빼고, 별도 사업장 파일(`payer: "BIZ"`)에 싣는다(출금 계좌가 다르다).
   */
  bizIncomeP?: number | null;
  bizTaxD?: number | null;
  bizLocalTaxD?: number | null;
  employee: {
    name: string;
    empNo: string;
    isContractor?: boolean | null;
    ratioEmployee?: boolean | null;
    bankName?: string | null;
    bankAccount?: string | null;
    bankHolder?: string | null;
    retentionBank?: string | null;
    retentionAccount?: string | null;
    /** 사업소득용 계좌 — 별도 사업장이 보내는 사업소득을 받는 통장. 비면 급여 계좌로 보낸다 */
    bizIncomeBank?: string | null;
    bizIncomeAccount?: string | null;
    bizIncomeHolder?: string | null;
  };
}

export type TransferKind = "PAY" | "RETENTION";

export interface TransferRow {
  bank: string; // 입금은행
  account: string; // 입금계좌번호 (숫자만)
  amount: number; // 입금액
  holder: string; // 예상예금주
  depositMemo: string; // 입금통장표시 — 받는 사람 통장에 찍힌다
  withdrawMemo: string; // 출금통장표시 — 학원 통장에 찍힌다
  kind: TransferKind;
  name: string; // 직원 성명 (화면·경고용, 시트에는 나가지 않는다)
}

/**
 * 입금통장표시의 소득 구분 — 받는 사람 통장에 찍히는 문구다.
 *
 * **위탁계약(프리랜서)만 '사업소득'** 이고 나머지는 '급여'다. 세무구분(3.3%)이 아니라
 * 계약의 실질로 가른다 — 3.3% 로 신고하더라도 실질이 근로자면 본인이 받는 돈은 급여이고,
 * 통장에 '사업소득' 으로 찍히면 근로자성을 스스로 부정하는 기록이 남는다.
 */
export function incomeLabelOf(r: TransferPayrollRecord): string {
  return isContractorContract({
    payScheme: r.payScheme,
    isContractor: r.employee.isContractor,
    // 기록에 새긴 값이 우선 — 산정 때 비율제 근로계약이었으면 그 달 돈은 급여다
    ratioEmployee: r.ratioEmployee ?? r.employee.ratioEmployee,
  })
    ? "사업소득"
    : "급여";
}

/** 비율제 근로자의 상한 초과분(별도 사업장 사업소득) 실지급액 — 없으면 0 */
function bizNetOf(r: TransferPayrollRecord): number {
  return recordSplit({ gross: 0, totalDeduct: 0, net: r.net, bizIncomeP: r.bizIncomeP, bizTaxD: r.bizTaxD, bizLocalTaxD: r.bizLocalTaxD })
    .biz?.net ?? 0;
}

export interface BuildTransferArgs {
  year: number;
  month: number;
  /** 통장표시 앞에 붙는 학원 약칭 (Company.transferAlias, 별도 사업장 파일이면 그 사업장 약칭) */
  alias: string;
  records: TransferPayrollRecord[];
  /**
   * 어느 지급처의 파일인가 — 기본은 이 회사. `"BIZ"` 면 별도 사업장이 보내는 사업소득(비율제 근로자의
   * 근로소득 상한 초과분)만 싣는다. 출금 계좌가 다른 사업자라 **한 파일에 섞지 않는다**.
   */
  payer?: "COMPANY" | "BIZ";
}

export interface TransferPlan {
  rows: TransferRow[];
  /** 계좌가 없어 이체 줄을 만들지 못한 사람 */
  missingAccount: string[];
  /** 보낼 금액이 0 이하라 건너뛴 사람 */
  zeroAmount: string[];
  /** 이 회사 파일에서 빠진 별도 사업장 몫이 있는 사람 — 별도 사업장 파일을 따로 받아야 한다 */
  bizExcluded: string[];
  /**
   * 별도 사업장 파일에서 **사업소득용 계좌가 없어 급여 계좌로 보내는** 사람 — 근로소득과 사업소득을 다른
   * 통장으로 가르려면 직원 정보에 사업소득용 계좌를 넣어야 한다. 이 회사 파일에서는 늘 비어 있다.
   */
  bizToSalaryAccount: string[];
  total: number;
}

/**
 * 급여 기록 → 이체 줄.
 *
 * 순서는 학원이 쓰던 파일 그대로 **사업소득(위탁) → 급여 → 퇴직유보금**. 은행 화면에서 위에서부터
 * 눈으로 훑으며 확인하는 순서라 섞이면 검토가 어렵다.
 *
 * 계좌가 비어 있으면 **줄을 만들지 않는다** — 빈칸으로 올리면 그 건만 실패하는 게 아니라
 * 파일 전체가 오류로 되돌아온다. 대신 누구인지 돌려주어 화면이 알린다.
 */
export function buildTransferRows(args: BuildTransferArgs): TransferPlan {
  const { month, alias, records } = args;
  const mm = `${month}월`;
  const rows: TransferRow[] = [];
  const missingAccount: string[] = [];
  const zeroAmount: string[] = [];
  const bizExcluded: string[] = [];
  const bizToSalaryAccount: string[] = [];

  // 별도 사업장 파일 — 상한 초과분만, 사업소득으로. 유보금·이 회사 급여는 싣지 않는다.
  // 받는 통장은 사업소득용 계좌가 우선이고, 없으면 급여 계좌다(누가 그랬는지 돌려준다)
  if (args.payer === "BIZ") {
    for (const r of records) {
      const amount = bizNetOf(r);
      if (amount <= 0) continue;
      const e = r.employee;
      const dest = bizIncomeDestination(e);
      if (dest.source === "NONE") {
        missingAccount.push(e.name);
        continue;
      }
      if (dest.source === "INCOMPLETE") {
        missingAccount.push(`${e.name}(사업소득용 계좌 — ${dest.bank ? "계좌번호" : "은행"} 빠짐)`);
        continue;
      }
      if (dest.source === "PAY") bizToSalaryAccount.push(e.name);
      rows.push({
        bank: dest.bank,
        account: dest.account,
        amount,
        holder: dest.holder,
        depositMemo: `${alias}_${mm}사업소득`,
        withdrawMemo: `${e.name}_${mm}`,
        kind: "PAY",
        name: e.name,
      });
    }
    return {
      rows,
      missingAccount,
      zeroAmount,
      bizExcluded,
      bizToSalaryAccount,
      total: rows.reduce((a, r) => a + r.amount, 0),
    };
  }

  const pay: TransferRow[] = [];
  const contractorPay: TransferRow[] = [];
  const retention: TransferRow[] = [];

  for (const r of records) {
    const e = r.employee;
    const holder = (e.bankHolder || "").trim() || e.name;
    const bank = normalizeBankName(e.bankName);
    const account = normalizeAccountNo(e.bankAccount);
    const label = incomeLabelOf(r);
    // 별도 사업장이 보내는 몫은 이 회사 파일에서 뺀다(출금 계좌가 다르다)
    const bizNet = bizNetOf(r);
    if (bizNet > 0) bizExcluded.push(e.name);
    const net = r.net - bizNet;

    if (net > 0) {
      if (!bank || !account) missingAccount.push(e.name);
      else
        (label === "사업소득" ? contractorPay : pay).push({
          bank,
          account,
          amount: net,
          holder,
          depositMemo: `${alias}_${mm}${label}`,
          withdrawMemo: `${e.name}_${mm}`,
          kind: "PAY",
          name: e.name,
        });
    } else {
      zeroAmount.push(e.name);
    }

    // 퇴직유보금 — 별도 통장이 지정돼 있으면 그쪽, 아니면 급여 계좌로
    if (r.retentionD > 0) {
      const rBank = normalizeBankName(e.retentionBank) || bank;
      const rAccount = normalizeAccountNo(e.retentionAccount) || account;
      if (!rBank || !rAccount) missingAccount.push(`${e.name}(유보금)`);
      else
        retention.push({
          bank: rBank,
          account: rAccount,
          amount: r.retentionD,
          holder,
          depositMemo: `퇴직유보금_${mm}`,
          withdrawMemo: `${e.name}_${mm}유보`,
          kind: "RETENTION",
          name: e.name,
        });
    }
  }

  rows.push(...contractorPay, ...pay, ...retention);
  return {
    rows,
    missingAccount,
    zeroAmount,
    bizExcluded,
    bizToSalaryAccount,
    total: rows.reduce((a, r) => a + r.amount, 0),
  };
}

/** 양식 첫 행 — 순서·글자를 바꾸면 은행이 파일을 읽지 못한다 */
export const TRANSFER_HEADER = [
  "입금은행",
  "입금계좌번호",
  "입금액",
  "예상예금주",
  "입금통장표시",
  "출금통장표시",
  "메모",
  "CMS코드",
  "받는분 휴대폰번호",
];

/** 양식의 '작성안내' 시트 — 원본 파일에 있던 안내문을 그대로 싣는다 */
const GUIDE_LINES = [
  "[필수] 1. 입금은행에는 은행코드 및 은행명을 입력합니다.",
  '          예를들면 하나은행의 경우 "081" 혹은 "하나" 혹은 "하나은행"으로 입력하면 됩니다.',
  "[필수] 2. 입금계좌번호에는 구분자(-)를 제외한 숫자만 입력합니다.",
  "[필수] 3. 입금액에는 이체할 금액을 입력합니다.",
  "[선택] 4. 예상예금주는 입금계좌의 예금주를 입력합니다.",
  "[선택] 5. 입금통장표시내용은 필요한 경우만 입력합니다.",
  "[선택] 6. 출금통장표시내용은 필요한 경우만 입력합니다.",
  "",
  "* Excel Sheet의 구조는 절대로 변경하지 마십시오.",
  "* 입금은행, 입금계좌번호, 입금액은 필수입력사항입니다.",
  "* 파일이체 등록 화면에서 이 파일을 그대로 올리면 됩니다.",
];

export interface TransferWorkbook extends TransferPlan {
  buffer: Buffer;
}

/** 이체 줄 → 은행 업로드용 워크북(.xls) */
export function buildBankTransferWorkbook(args: BuildTransferArgs): TransferWorkbook {
  const plan = buildTransferRows(args);

  const aoa: any[][] = [
    TRANSFER_HEADER,
    ...plan.rows.map((r) => [
      r.bank,
      r.account,
      r.amount,
      r.holder,
      r.depositMemo,
      r.withdrawMemo,
      "",
      "",
      "",
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 계좌번호는 반드시 **문자**여야 한다 — 숫자로 두면 앞자리 0 이 날아가고
  // 자릿수가 길면 지수 표기(1.1E+11)로 저장돼 은행이 읽지 못한다.
  for (let i = 0; i < plan.rows.length; i++) {
    const addr = XLSX.utils.encode_cell({ r: i + 1, c: 1 });
    ws[addr] = { t: "s", v: plan.rows[i].account, w: plan.rows[i].account };
  }
  ws["!cols"] = [
    { wch: 12 }, // 입금은행
    { wch: 18 }, // 입금계좌번호
    { wch: 13 }, // 입금액
    { wch: 12 }, // 예상예금주
    { wch: 18 }, // 입금통장표시
    { wch: 16 }, // 출금통장표시
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const gs = XLSX.utils.aoa_to_sheet(GUIDE_LINES.map((l) => [l]));
  gs["!cols"] = [{ wch: 72 }];
  XLSX.utils.book_append_sheet(wb, gs, "Sheet2");

  // 은행 업로드 화면이 받는 형식은 xls/csv/txt 뿐이라 BIFF8 로 쓴다
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer;
  return { ...plan, buffer };
}

/* ============================ 계좌 일괄 등록 ============================ */
//
// 같은 양식을 **거꾸로 읽어** 직원 정보의 은행·계좌를 채운다. 학원이 매달 손으로 채워 쓰던
// 파일에 이미 전 직원의 계좌가 들어 있어, 그 파일을 그대로 올리면 옮겨 적을 일이 없다.
//
// 유보금 줄(입금통장표시가 '퇴직유보금…')은 **퇴직유보금 통장**으로 따로 넣는다 — 같은 사람이
// 두 줄인데 계좌가 다를 수 있어(급여는 기업은행, 유보금은 우리은행) 뭉뚱그리면 덮어써 버린다.
//
// '사업소득' 줄도 같은 이유로 가린다(v1.62) — **비율제 근로자(4대보험)의 사업소득 줄은 별도 사업장이 보내는
// 몫**이라 사업소득용 계좌로 들어간다. 이 회사가 그 사람에게 보내는 돈은 '급여' 로 찍히기 때문이다
// (`incomeLabelOf`). 급여 계좌로 뭉뚱그리면 별도 사업장 이체 파일을 올렸을 때 급여 계좌가 사업소득용 계좌로
// 덮인다. 위탁계약자의 사업소득 줄은 그것이 곧 그 사람의 (하나뿐인) 급여 계좌다 — 예전 그대로.

/** 양식 한 줄이 가리키는 통장 — 입금통장표시로 가린다. 어느 칸에 넣을지는 직원을 보고 정한다 */
export type BankAccountKind = TransferKind | "BIZ_INCOME";

export interface BankAccountRow {
  rowNo: number;
  name: string; // 예상예금주 = 직원 성명
  bankName: string;
  bankAccount: string;
  kind: BankAccountKind;
}

const HEADER_ALIAS: Record<string, string[]> = {
  bank: ["입금은행", "은행", "은행명"],
  account: ["입금계좌번호", "계좌번호", "계좌"],
  holder: ["예상예금주", "예금주", "성명", "이름", "직원명"],
  depositMemo: ["입금통장표시", "입금통장표시내용", "입금통장표시내용(선택)"],
};

function columnIndexes(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => {
    const k = normKey(h);
    if (!k) return;
    for (const [key, aliases] of Object.entries(HEADER_ALIAS)) {
      if (idx[key] == null && aliases.some((a) => normKey(a) === k)) idx[key] = i;
    }
  });
  return idx;
}

/** 은행 이체 양식(.xls/.xlsx/.csv) → 계좌 행 목록 */
export function parseBankAccountWorkbook(buf: Buffer | Uint8Array): {
  rows: BankAccountRow[];
  /** 계좌가 비어 읽지 못한 줄 수 — 조용히 버리지 않고 화면에 알린다 */
  skipped: number;
} {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], skipped: 0 };
  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  if (!grid.length) return { rows: [], skipped: 0 };

  // 머리글 행 찾기 — '입금은행/은행' 이 있는 첫 행
  let headerIdx = grid.findIndex((r) => {
    const idx = columnIndexes(r.map((c) => String(c ?? "")));
    return idx.bank != null && idx.account != null;
  });
  if (headerIdx < 0) headerIdx = 0;
  const col = columnIndexes(grid[headerIdx].map((c) => String(c ?? "")));
  if (col.bank == null || col.account == null) return { rows: [], skipped: 0 };

  const rows: BankAccountRow[] = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i];
    if (!raw || raw.every((c) => String(c ?? "").trim() === "")) continue;
    const name = String(raw[col.holder ?? -1] ?? "").trim();
    const bankName = normalizeBankName(raw[col.bank]);
    const bankAccount = normalizeAccountNo(raw[col.account]);
    if (!name || !bankName || !bankAccount) {
      skipped++;
      continue;
    }
    const memo = String(raw[col.depositMemo ?? -1] ?? "");
    rows.push({
      rowNo: i + 1,
      name,
      bankName,
      bankAccount,
      kind: memo.includes("유보") ? "RETENTION" : memo.includes("사업소득") ? "BIZ_INCOME" : "PAY",
    });
  }
  return { rows, skipped };
}

export interface BankAccountTarget {
  id: number;
  name: string;
  bankName?: string | null;
  bankAccount?: string | null;
  retentionBank?: string | null;
  retentionAccount?: string | null;
  bizIncomeBank?: string | null;
  bizIncomeAccount?: string | null;
  /** '사업소득' 줄을 어느 칸에 넣을지 가린다 — 비율제 근로자면 사업소득용 계좌, 아니면 급여 계좌 */
  payScheme?: string | null;
  ratioEmployee?: boolean | null;
}

export interface BankAccountChange {
  label: string;
  from: string;
  to: string;
}

export interface BankAccountPlanRow {
  rowNo: number;
  name: string;
  employeeId: number | null;
  changes: BankAccountChange[];
  kept: BankAccountChange[];
  data: Record<string, string>;
  errors: string[];
  warnings: string[];
}

export interface BankAccountPlan {
  rows: BankAccountPlanRow[];
  matchedCount: number;
  changeCount: number;
  unmatched: string[];
}

/**
 * 계좌 채우기 계획 (순수 함수).
 * `overwrite=false`(기본)면 비어 있는 항목만 채운다 — 계좌를 잘못 덮어쓰면 돈이 남에게 간다.
 */
export function planBankAccounts(
  rows: BankAccountRow[],
  employees: BankAccountTarget[],
  opts: { overwrite?: boolean } = {}
): BankAccountPlan {
  const byName = new Map<string, BankAccountTarget[]>();
  for (const e of employees) {
    const list = byName.get(e.name.trim()) ?? [];
    list.push(e);
    byName.set(e.name.trim(), list);
  }

  const plan: BankAccountPlanRow[] = [];
  const unmatched: string[] = [];

  for (const r of rows) {
    const errors: string[] = [];
    const cands = byName.get(r.name.trim()) ?? [];
    let target: BankAccountTarget | null = null;
    if (cands.length === 1) target = cands[0];
    else if (cands.length > 1)
      errors.push(`'${r.name}' 이름의 직원이 ${cands.length}명입니다 — 직접 입력해 주세요`);
    else {
      errors.push("등록된 직원 중 일치하는 사람이 없습니다");
      unmatched.push(r.name);
    }

    const changes: BankAccountChange[] = [];
    const kept: BankAccountChange[] = [];
    const data: Record<string, string> = {};

    if (target) {
      const fields: Array<[string, string, string]> =
        r.kind === "RETENTION"
          ? [
              ["retentionBank", "유보금 은행", r.bankName],
              ["retentionAccount", "유보금 계좌", r.bankAccount],
            ]
          : r.kind === "BIZ_INCOME" && isRatioEmployee(target)
          ? [
              // 근로자의 '사업소득' 줄 = 별도 사업장이 보내는 몫 (이 회사 몫은 '급여' 로 찍힌다)
              ["bizIncomeBank", "사업소득용 은행", r.bankName],
              ["bizIncomeAccount", "사업소득용 계좌", r.bankAccount],
            ]
          : [
              ["bankName", "은행", r.bankName],
              ["bankAccount", "계좌번호", r.bankAccount],
            ];
      for (const [key, label, incoming] of fields) {
        const current = String((target as any)[key] ?? "").trim();
        const currentCmp = key.toLowerCase().includes("account")
          ? normalizeAccountNo(current)
          : normalizeBankName(current);
        if (current && currentCmp === incoming) continue; // 같은 값
        const show = (v: string) =>
          !v ? "(비어 있음)" : key.toLowerCase().includes("account") ? maskAccount(v) : v;
        const entry = { label, from: show(current), to: show(incoming) };
        if (!current || opts.overwrite) {
          changes.push(entry);
          data[key] = incoming;
        } else kept.push(entry);
      }
    }

    const warnings: string[] = [];
    if (target && !changes.length)
      warnings.push(kept.length ? "이미 다른 계좌가 있습니다 (덮어쓰기 필요)" : "이미 같은 계좌가 등록돼 있습니다");

    plan.push({
      rowNo: r.rowNo,
      name: r.name,
      employeeId: target?.id ?? null,
      changes,
      kept,
      data,
      errors,
      warnings,
    });
  }

  return {
    rows: plan,
    matchedCount: plan.filter((p) => p.employeeId != null).length,
    changeCount: plan.reduce((a, p) => a + p.changes.length, 0),
    unmatched: Array.from(new Set(unmatched)),
  };
}
