// 은행명·계좌번호 정리와 **사업소득용 계좌** 판정 — 순수 함수.
//
// 엑셀 라이브러리를 끌어오지 않는 가벼운 모듈이다 — 이체 파일(lib/bank-transfer.ts)뿐 아니라 직원 폼
// (클라이언트)과 직원 상세 화면이 함께 쓴다. bank-transfer.ts 에 두면 그 화면들이 xlsx 를 통째로 지게 된다.
//
// **받는 통장은 셋까지 갈린다.**
//   · 급여 계좌(`bankName`·`bankAccount`·`bankHolder`) — 이 회사가 보내는 돈. 근로자는 근로소득, 위탁계약자는 수수료.
//   · 퇴직유보금 계좌(`retentionBank`·`retentionAccount`) — 유보금은 급여와 다른 통장으로 보낸다(확인서 제6조).
//   · 사업소득용 계좌(`bizIncomeBank`·`bizIncomeAccount`·`bizIncomeHolder`, v1.62) — 비율제 근로계약의 근로소득
//     상한 초과분, 곧 **별도 사업장이 보내는 사업소득**을 받는 통장. 근로소득과 사업소득을 한 통장에 섞지 않으려는
//     직원만 넣는다. 비면 급여 계좌로 나가고, 이체 파일을 받을 때 그 사실을 알린다.

/* ============================ 은행명 ============================ */

/**
 * 은행 표기 통일 — 사람이 "국민"/"KB"/"국민은행" 아무렇게나 적어 두므로 정식 명칭으로 맞춘다.
 * 은행은 은행코드("004")나 약칭("국민")도 받지만, 사람이 파일을 눈으로 검토하는 단계가 있어
 * 이름을 다 적어 주는 쪽이 낫다. 표에 없는 값은 **그대로 통과시킨다** — 지방은행·조합처럼
 * 여기 없는 곳을 임의로 고치면 오히려 이체가 실패한다.
 */
const BANK_ALIASES: Record<string, string[]> = {
  국민은행: ["국민", "kb", "kb국민", "국민은행", "kb국민은행"],
  신한은행: ["신한", "신한은행"],
  우리은행: ["우리", "우리은행"],
  하나은행: ["하나", "하나은행", "keb하나", "keb하나은행", "외환", "외환은행"],
  기업은행: ["기업", "ibk", "ibk기업", "기업은행", "ibk기업은행"],
  농협은행: ["농협", "nh", "nh농협", "농협은행", "단위농협", "지역농협"],
  수협은행: ["수협", "수협은행"],
  산업은행: ["산업", "kdb", "산업은행", "kdb산업은행"],
  SC제일은행: ["sc", "sc제일", "제일", "sc제일은행", "스탠다드차타드"],
  한국씨티은행: ["씨티", "citi", "한국씨티", "씨티은행", "한국씨티은행"],
  우체국: ["우체국", "우정사업본부", "우체국은행"],
  카카오뱅크: ["카카오", "카뱅", "카카오뱅크"],
  토스뱅크: ["토스", "토스뱅크"],
  케이뱅크: ["케이뱅크", "k뱅크", "kbank", "케이"],
  새마을금고: ["새마을", "새마을금고", "mg새마을금고", "mg"],
  신협: ["신협", "신용협동조합"],
  부산은행: ["부산", "부산은행", "bnk부산"],
  대구은행: ["대구", "대구은행", "im뱅크", "im"],
  광주은행: ["광주", "광주은행"],
  전북은행: ["전북", "전북은행"],
  경남은행: ["경남", "경남은행", "bnk경남"],
  제주은행: ["제주", "제주은행"],
};

const normKey = (s: unknown) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

/** "국민" / "KB" / " 국민은행 " → "국민은행". 모르는 값은 공백만 정리해 그대로 돌려준다 */
export function normalizeBankName(v: unknown): string {
  const k = normKey(v);
  if (!k) return "";
  for (const [canon, aliases] of Object.entries(BANK_ALIASES)) {
    if (normKey(canon) === k || aliases.some((a) => normKey(a) === k)) return canon;
  }
  return String(v).trim();
}

/** "110-503-740850" / "110 503 740850" → "110503740850" (은행이 구분자를 받지 않는다) */
export function normalizeAccountNo(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** 계좌번호는 화면·이력에 뒤 4자리만 남긴다 */
export function maskAccount(v: string): string {
  return v.length > 4 ? `${"•".repeat(v.length - 4)}${v.slice(-4)}` : v;
}

/* ============================ 사업소득용 계좌 ============================ */

/**
 * 별도 사업장이 보내는 사업소득이 **어느 통장으로 가는가**.
 *
 *  · `BIZ` — 사업소득용 계좌(은행·계좌번호가 **둘 다** 있을 때). 예금주는 그 계좌의 예금주, 비면 성명.
 *    급여 계좌의 예금주(`bankHolder`)를 빌리지 않는다 — 다른 통장이라 명의도 다를 수 있다.
 *  · `PAY` — 사업소득용 계좌가 없어 급여 계좌로 간다(예전 동작 그대로). 부르는 쪽이 그 사실을 알린다 —
 *    근로소득과 사업소득을 가르려던 사람은 조용히 한 통장에 섞인 것을 모르고 지나간다.
 *  · `INCOMPLETE` — 사업소득용 계좌가 **반만** 들어 있다(은행만, 또는 계좌번호만). 급여 계좌로 넘겨짚지
 *    않는다 — 따로 받으려던 뜻은 분명한데 어느 통장인지 모르는 상태라, 줄을 만들지 않고 알린다.
 *  · `NONE` — 급여 계좌도 없다.
 */
export type BizIncomeSource = "BIZ" | "PAY" | "INCOMPLETE" | "NONE";

export interface BizIncomeDestination {
  source: BizIncomeSource;
  bank: string;
  account: string;
  holder: string;
}

export function bizIncomeDestination(e: {
  name: string;
  bankName?: string | null;
  bankAccount?: string | null;
  bankHolder?: string | null;
  bizIncomeBank?: string | null;
  bizIncomeAccount?: string | null;
  bizIncomeHolder?: string | null;
}): BizIncomeDestination {
  const bizBank = normalizeBankName(e.bizIncomeBank);
  const bizAccount = normalizeAccountNo(e.bizIncomeAccount);
  if (bizBank && bizAccount)
    return { source: "BIZ", bank: bizBank, account: bizAccount, holder: (e.bizIncomeHolder || "").trim() || e.name };
  if (bizBank || bizAccount) return { source: "INCOMPLETE", bank: bizBank, account: bizAccount, holder: e.name };
  const bank = normalizeBankName(e.bankName);
  const account = normalizeAccountNo(e.bankAccount);
  const holder = (e.bankHolder || "").trim() || e.name;
  return { source: bank && account ? "PAY" : "NONE", bank, account, holder };
}

/**
 * 사업소득용 계좌 입력 검사 — **은행과 계좌번호는 함께** 있어야 한다. 화면·서버가 같은 함수를 쓴다.
 *
 * 한쪽만 있으면 어느 통장인지 알 수 없다. 이체 파일은 그런 계좌로 보내지 않고(`INCOMPLETE` — 줄을 만들지 않고
 * 알린다), 그러면 그 달 사업소득이 파일에서 빠진 것을 내려받을 때에야 알게 되므로 **넣을 때** 거른다.
 * 셋 다 비우면 '사업소득용 계좌 없음' 이다 — 별도 사업장 지급분도 급여 계좌로 나간다.
 */
export function bizIncomeAccountError(a: { bank?: unknown; account?: unknown; holder?: unknown }): string | null {
  const bank = String(a.bank ?? "").trim();
  const account = String(a.account ?? "").trim();
  const holder = String(a.holder ?? "").trim();
  if (!bank && !account)
    return holder
      ? "사업소득용 계좌의 예금주만 있고 은행·계좌번호가 없습니다 — 함께 넣거나 예금주를 비워 주세요."
      : null;
  if (!bank || !account)
    return (
      `사업소득용 계좌는 은행과 계좌번호를 함께 넣어 주세요(${!bank ? "은행이" : "계좌번호가"} 비어 있습니다). ` +
      `따로 두지 않으려면 둘 다 비워 두세요 — 그러면 급여 계좌로 나갑니다.`
    );
  // 숫자가 하나도 없는 계좌번호는 이체 파일에서 '빈 계좌' 가 된다(구분자를 떼고 숫자만 남긴다)
  if (!normalizeAccountNo(account)) return "사업소득용 계좌번호에 숫자가 없습니다.";
  return null;
}
