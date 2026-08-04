import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildBankTransferWorkbook,
  buildTransferRows,
  incomeLabelOf,
  maskAccount,
  normalizeAccountNo,
  normalizeBankName,
  parseBankAccountWorkbook,
  planBankAccounts,
  TRANSFER_HEADER,
  type TransferPayrollRecord,
} from "./bank-transfer";

const rec = (
  o: Partial<TransferPayrollRecord> & {
    name: string;
    net: number;
  } & Partial<TransferPayrollRecord["employee"]>
): TransferPayrollRecord => ({
  net: o.net,
  retentionD: o.retentionD ?? 0,
  incomeType: o.incomeType ?? "EMPLOYEE",
  payScheme: o.payScheme ?? "MONTHLY",
  employee: {
    name: o.name,
    empNo: o.empNo ?? "1",
    isContractor: o.isContractor ?? false,
    bankName: "bankName" in o ? o.bankName : "신한은행",
    bankAccount: "bankAccount" in o ? o.bankAccount : "110503740850",
    bankHolder: o.bankHolder ?? null,
    retentionBank: o.retentionBank ?? null,
    retentionAccount: o.retentionAccount ?? null,
  },
});

const build = (records: TransferPayrollRecord[]) =>
  buildTransferRows({ year: 2026, month: 7, alias: "유쌤", records });

describe("은행명·계좌번호 정리", () => {
  it("약칭·영문 표기를 정식 명칭으로 맞춘다", () => {
    expect(normalizeBankName("국민")).toBe("국민은행");
    expect(normalizeBankName("KB")).toBe("국민은행");
    expect(normalizeBankName(" 하나 ")).toBe("하나은행");
    expect(normalizeBankName("IBK기업")).toBe("기업은행");
    expect(normalizeBankName("카카오")).toBe("카카오뱅크");
    expect(normalizeBankName("우체국")).toBe("우체국");
  });

  it("표에 없는 은행은 임의로 고치지 않는다 — 잘못 고치면 이체가 실패한다", () => {
    expect(normalizeBankName("케이프투자증권")).toBe("케이프투자증권");
    expect(normalizeBankName("")).toBe("");
  });

  it("계좌번호는 구분자를 떼고 숫자만 남긴다", () => {
    expect(normalizeAccountNo("110-503-740850")).toBe("110503740850");
    expect(normalizeAccountNo(" 1002 432 860232 ")).toBe("1002432860232");
    expect(normalizeAccountNo(null)).toBe("");
  });

  it("계좌번호는 뒤 4자리만 보여 준다", () => {
    expect(maskAccount("110503740850")).toBe("••••••••0850");
    expect(maskAccount("850")).toBe("850");
  });
});

describe("입금통장표시 — 받는 사람 통장에 찍히는 문구", () => {
  it("위탁계약(프리랜서)만 '사업소득'", () => {
    expect(incomeLabelOf(rec({ name: "이미라", net: 1, payScheme: "HOURLY", isContractor: true }))).toBe("사업소득");
    expect(incomeLabelOf(rec({ name: "김은진", net: 1, payScheme: "RATIO" }))).toBe("사업소득");
  });

  it("세무구분이 3.3% 여도 근로자면 '급여' — 통장에 사업소득으로 찍히면 근로자성을 스스로 부정한다", () => {
    expect(incomeLabelOf(rec({ name: "박채영", net: 1, incomeType: "FREELANCE" }))).toBe("급여");
  });

  it("문구가 원본 파일과 같다", () => {
    const { rows } = build([rec({ name: "홍경지", net: 3_324_410 })]);
    expect(rows[0].depositMemo).toBe("유쌤_7월급여");
    expect(rows[0].withdrawMemo).toBe("홍경지_7월");
  });
});

describe("이체 줄 만들기", () => {
  it("세후 실지급액을 그대로 입금액으로 싣는다", () => {
    const { rows, total } = build([
      rec({ name: "김수민", net: 3_151_830, bankName: "국민", bankAccount: "455-40101-030548" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bank: "국민은행",
      account: "45540101030548",
      amount: 3_151_830,
      holder: "김수민",
      kind: "PAY",
    });
    expect(total).toBe(3_151_830);
  });

  it("퇴직유보금은 급여와 별도 줄로 나간다 (확인서 제6조 — 별도 통장 송금)", () => {
    const { rows } = build([rec({ name: "하수정", net: 9_653_018, retentionD: 401_042 })]);
    expect(rows.map((r) => r.kind)).toEqual(["PAY", "RETENTION"]);
    expect(rows[1].amount).toBe(401_042);
    expect(rows[1].depositMemo).toBe("퇴직유보금_7월");
    expect(rows[1].withdrawMemo).toBe("하수정_7월유보");
  });

  it("유보금 통장이 따로 지정돼 있으면 그 계좌로 보낸다 (안정미: 급여 기업은행 · 유보 우리은행)", () => {
    const { rows } = build([
      rec({
        name: "안정미",
        net: 8_347_120,
        retentionD: 117_919,
        bankName: "기업은행",
        bankAccount: "50003160201010",
        retentionBank: "우리",
        retentionAccount: "1002-833519064",
      }),
    ]);
    expect(rows[0]).toMatchObject({ bank: "기업은행", account: "50003160201010" });
    expect(rows[1]).toMatchObject({ bank: "우리은행", account: "1002833519064" });
  });

  it("유보금 통장이 없으면 급여 계좌로 보낸다 (이서영)", () => {
    const { rows } = build([
      rec({
        name: "이서영",
        net: 4_117_610,
        retentionD: 16_667,
        bankName: "국민은행",
        bankAccount: "52650201200763",
      }),
    ]);
    expect(rows[1].account).toBe("52650201200763");
  });

  it("계좌가 비면 줄을 만들지 않고 누구인지 알린다 — 빈칸이면 파일 전체가 반려된다", () => {
    const { rows, missingAccount } = build([
      rec({ name: "강하은", net: 126_948, bankAccount: "" }),
      rec({ name: "김수민", net: 3_151_830 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(missingAccount).toEqual(["강하은"]);
  });

  it("보낼 금액이 0 이면 건너뛴다", () => {
    const { rows, zeroAmount } = build([rec({ name: "퇴사자", net: 0 })]);
    expect(rows).toHaveLength(0);
    expect(zeroAmount).toEqual(["퇴사자"]);
  });

  it("예금주가 본인과 다르면 그 이름으로 나간다 (미성년 조교의 보호자 명의)", () => {
    const { rows } = build([rec({ name: "박지호", net: 338_573, bankHolder: "박정훈" })]);
    expect(rows[0].holder).toBe("박정훈");
    expect(rows[0].withdrawMemo).toBe("박지호_7월"); // 우리 통장에는 직원 이름으로 남는다
  });

  it("순서는 사업소득(위탁) → 급여 → 퇴직유보금 — 은행 화면에서 눈으로 훑는 순서다", () => {
    const { rows } = build([
      rec({ name: "박채영", net: 3_522_119 }),
      rec({ name: "하수정", net: 9_653_018, retentionD: 401_042 }),
      rec({ name: "김은진", net: 11_299_955, payScheme: "RATIO" }),
    ]);
    expect(rows.map((r) => `${r.name}:${r.kind}`)).toEqual([
      "김은진:PAY",
      "박채영:PAY",
      "하수정:PAY",
      "하수정:RETENTION",
    ]);
  });
});

describe("워크북 출력 — 은행이 읽는 파일", () => {
  const read = (records: TransferPayrollRecord[]) => {
    const { buffer, ...plan } = buildBankTransferWorkbook({
      year: 2026,
      month: 7,
      alias: "유쌤",
      records,
    });
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return {
      plan,
      names: wb.SheetNames,
      aoa: XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, raw: true }),
      ws,
    };
  };

  it("머리글이 양식 그대로다 — 구조를 바꾸면 은행이 읽지 못한다", () => {
    const { aoa } = read([rec({ name: "김수민", net: 3_151_830 })]);
    expect(aoa[0]).toEqual(TRANSFER_HEADER);
  });

  it("계좌번호는 문자로 저장한다 — 숫자면 앞자리 0 이 날아가고 지수 표기가 된다", () => {
    const { ws, aoa } = read([
      rec({ name: "공여진", net: 1_411_050, bankName: "케이뱅크", bankAccount: "0100106357083" }),
    ]);
    expect(ws["B2"].t).toBe("s");
    expect(aoa[1][1]).toBe("0100106357083");
  });

  it("금액은 숫자로 저장한다", () => {
    const { ws } = read([rec({ name: "김수민", net: 3_151_830 })]);
    expect(ws["C2"].t).toBe("n");
    expect(ws["C2"].v).toBe(3_151_830);
  });

  it("작성안내 시트를 함께 담는다", () => {
    const { names } = read([rec({ name: "김수민", net: 3_151_830 })]);
    expect(names).toEqual(["Sheet1", "Sheet2"]);
  });

  it("합계가 급여 + 유보금과 맞는다", () => {
    const { plan } = read([
      rec({ name: "하수정", net: 9_653_018, retentionD: 401_042 }),
      rec({ name: "박채영", net: 3_522_119 }),
    ]);
    expect(plan.total).toBe(9_653_018 + 401_042 + 3_522_119);
  });
});

describe("계좌 일괄 등록 — 같은 양식을 거꾸로 읽는다", () => {
  const sheet = (aoa: any[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  };

  const file = sheet([
    TRANSFER_HEADER,
    ["신한은행", "110503740850", "", "김은진", "유쌤_7월사업소득", "김은진_7월"],
    ["기업은행", "50003160201010", "", "안정미", "유쌤_7월급여", "안정미_7월"],
    ["우리은행", "1002833519064", "", "안정미", "퇴직유보금_7월", "안정미_7월유보"],
  ]);

  it("은행·계좌·예금주를 읽는다", () => {
    const { rows } = parseBankAccountWorkbook(file);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ name: "김은진", bankName: "신한은행", bankAccount: "110503740850", kind: "PAY" });
  });

  it("유보금 줄은 퇴직유보금 통장으로 간다 — 뭉뚱그리면 급여 계좌를 덮어쓴다", () => {
    const { rows } = parseBankAccountWorkbook(file);
    expect(rows[2]).toMatchObject({ name: "안정미", kind: "RETENTION", bankName: "우리은행" });

    const plan = planBankAccounts(rows, [
      { id: 1, name: "김은진" },
      { id: 2, name: "안정미" },
    ]);
    const 안정미 = plan.rows.filter((r) => r.name === "안정미");
    expect(안정미[0].data).toEqual({ bankName: "기업은행", bankAccount: "50003160201010" });
    expect(안정미[1].data).toEqual({ retentionBank: "우리은행", retentionAccount: "1002833519064" });
    expect(plan.changeCount).toBe(6);
  });

  it("계좌가 빈 줄은 조용히 버리지 않고 센다", () => {
    const { rows, skipped } = parseBankAccountWorkbook(
      sheet([TRANSFER_HEADER, ["국민은행", "", "", "강하은"], ["국민은행", "111", "", "김수민"]])
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("이미 값이 있으면 덮어쓰지 않는다 — 계좌를 잘못 덮으면 돈이 남에게 간다", () => {
    const { rows } = parseBankAccountWorkbook(file);
    const target = [{ id: 1, name: "김은진", bankName: "국민은행", bankAccount: "999" }];
    const keep = planBankAccounts(rows, target);
    expect(keep.rows[0].changes).toEqual([]);
    expect(keep.rows[0].kept).toHaveLength(2);

    const over = planBankAccounts(rows, target, { overwrite: true });
    expect(over.rows[0].data).toEqual({ bankName: "신한은행", bankAccount: "110503740850" });
  });

  it("표기만 다르고 같은 계좌면 변경으로 보지 않는다", () => {
    const { rows } = parseBankAccountWorkbook(
      sheet([TRANSFER_HEADER, ["국민", "456-01-030548", "", "김수민"]])
    );
    const plan = planBankAccounts(rows, [
      { id: 1, name: "김수민", bankName: "국민은행", bankAccount: "456-01-030548" },
    ]);
    expect(plan.changeCount).toBe(0);
    expect(plan.rows[0].kept).toEqual([]);
  });

  it("등록되지 않은 이름은 알린다", () => {
    const { rows } = parseBankAccountWorkbook(file);
    const plan = planBankAccounts(rows, [{ id: 1, name: "김은진" }]);
    expect(plan.unmatched).toEqual(["안정미"]);
    expect(plan.matchedCount).toBe(1);
  });

  it("동명이인은 자동으로 넣지 않는다", () => {
    const { rows } = parseBankAccountWorkbook(file);
    const plan = planBankAccounts(rows, [
      { id: 1, name: "김은진" },
      { id: 2, name: "안정미" },
      { id: 3, name: "안정미" },
    ]);
    expect(plan.rows[1].errors[0]).toContain("2명");
    expect(plan.rows[1].data).toEqual({});
  });

  it("내보낸 파일을 그대로 다시 읽어도 같은 계좌가 나온다 (왕복)", () => {
    const { buffer } = buildBankTransferWorkbook({
      year: 2026,
      month: 7,
      alias: "유쌤",
      records: [
        rec({ name: "안정미", net: 8_347_120, retentionD: 117_919, bankName: "기업은행", bankAccount: "50003160201010", retentionBank: "우리은행", retentionAccount: "1002833519064" }),
      ],
    });
    const { rows } = parseBankAccountWorkbook(buffer);
    expect(rows).toEqual([
      { rowNo: 2, name: "안정미", bankName: "기업은행", bankAccount: "50003160201010", kind: "PAY" },
      { rowNo: 3, name: "안정미", bankName: "우리은행", bankAccount: "1002833519064", kind: "RETENTION" },
    ]);
  });
});
