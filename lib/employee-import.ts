// 직원 명단 일괄 등록 — 엑셀/CSV 파서 (순수 함수, DB 무관)
//
// 헤더 이름은 표기 흔들림을 허용한다("성명"/"이름"/"직원명" 등).
// 값도 사람이 적는 방식 그대로 받는다: 날짜(2025-03-01 / 2025.3.1 / 엑셀 날짜),
// 급여형태("월급제"/"MONTHLY"), 위탁비율("50%" / 50 / 0.5), 금액("3,000,000" / "300만").

import * as XLSX from "xlsx";

export interface ImportRow {
  rowNo: number; // 엑셀 행 번호 (오류 안내용)
  empNo?: string;
  name: string;
  rrn?: string;
  birth?: string;
  department?: string;
  position?: string;
  duty?: string;
  address?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccount?: string;
  hireDate: string; // YYYY-MM-DD
  resignDate?: string;
  incomeType: "EMPLOYEE" | "FREELANCE";
  payScheme: "MONTHLY" | "HOURLY" | "INCENTIVE" | "RATIO";
  baseWage: number;
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  dependents: number;
  incThreshold: number | null;
  incPerStudent: number | null;
  ratioPercent: number | null; // 0~1
  ratioMinGuarantee: number | null;
  // 포괄임금(고정OT) 약정시간 — 계약서 제4조 「기본급 (209시간) / 시간외근로(고정) …」
  fixedBaseHours: number | null;
  fixedOtHours: number | null;
  fixedNightHours: number | null;
  contractStart: string; // 기본값 = 입사일
  contractEnd?: string;
  errors: string[]; // 이 행의 문제 (있으면 등록 제외)
  warnings: string[];
}

/** 템플릿 열 정의 — 순서대로 내보내고, 읽을 때는 alias 로도 인식 */
export const IMPORT_COLUMNS: Array<{ key: string; header: string; alias: string[]; note?: string }> = [
  { key: "empNo", header: "사번", alias: ["사원번호", "직원번호"], note: "비우면 자동 생성" },
  { key: "name", header: "성명", alias: ["이름", "직원명", "성 명"], note: "필수" },
  { key: "department", header: "부서", alias: ["소속", "소속부서"] },
  { key: "position", header: "직책", alias: ["직위", "직급"] },
  { key: "duty", header: "업무", alias: ["담당업무", "직무"] },
  { key: "hireDate", header: "입사일자", alias: ["입사일", "입사년월일"], note: "필수" },
  { key: "resignDate", header: "퇴사일자", alias: ["퇴사일", "퇴직일"], note: "재직자는 비움" },
  { key: "incomeType", header: "세무구분", alias: ["보험구분", "고용형태"], note: "4대보험 / 3.3%" },
  { key: "payScheme", header: "급여형태", alias: ["급여구분", "임금형태"], note: "월급제 / 시급제 / 월급+인센티브 / 완전비율제" },
  {
    key: "baseWage",
    header: "기본급",
    alias: ["월기본급", "시급", "기본급(시급)", "월급여총액", "급여총액"],
    note: "월급제는 식대·차량유지비를 포함한 총액 (시급제는 시급)",
  },
  { key: "positionAllow", header: "직책수당", alias: ["직책 수당"], note: "총액에 더해지는 별도 수당" },
  { key: "mealAllow", header: "식대", alias: ["식대(비과세)", "중식대"], note: "기본급 총액에 포함된 비과세분" },
  { key: "carAllow", header: "차량유지비", alias: ["차량유지비(비과세)", "자가운전보조금"], note: "기본급 총액에 포함된 비과세분" },
  { key: "incThreshold", header: "인센티브 기준인원", alias: ["기준인원", "기준 학생수"] },
  { key: "incPerStudent", header: "인센티브 기준금액", alias: ["기준금액", "1명당 금액"] },
  { key: "ratioPercent", header: "위탁비율", alias: ["비율", "위탁 비율(%)", "수수료율"], note: "예: 50%" },
  {
    key: "ratioMinGuarantee",
    header: "위탁 최저보장",
    alias: ["최저보장", "최저보장액", "보장금액"],
    note: "완전비율제 계약에 최저보장 조항이 있을 때만",
  },
  {
    key: "fixedBaseHours",
    header: "기본급 산정시간",
    alias: ["기본급시간", "소정근로시간(월)", "월 산정시간"],
    note: "포괄임금. 예: 209. 비우면 근로시간표에서 환산",
  },
  {
    key: "fixedOtHours",
    header: "약정 시간외근로시간",
    alias: ["고정연장시간", "약정연장시간", "시간외근로(고정)"],
    note: "포괄임금. 월 급여에 미리 포함된 연장시간. 예: 21.725",
  },
  {
    key: "fixedNightHours",
    header: "약정 야간근로시간",
    alias: ["고정야간시간", "약정야간시간", "야간근로(고정)"],
    note: "포괄임금. 월 급여에 미리 포함된 야간시간. 예: 10.8625",
  },
  { key: "dependents", header: "부양가족수", alias: ["부양가족", "가족수"], note: "본인포함, 기본 1" },
  { key: "rrn", header: "주민등록번호", alias: ["주민번호"] },
  { key: "birth", header: "생년월일", alias: ["생일"] },
  { key: "phone", header: "연락처", alias: ["휴대폰", "전화번호", "핸드폰"] },
  { key: "email", header: "이메일", alias: ["메일", "이메일주소"], note: "명세서 발송·슬랙 연동에 사용" },
  { key: "address", header: "주소", alias: ["거주지"] },
  { key: "bankName", header: "은행", alias: ["은행명"] },
  { key: "bankAccount", header: "계좌번호", alias: ["계좌"] },
  { key: "contractStart", header: "계약시작일", alias: ["계약 시작"], note: "비우면 입사일" },
  { key: "contractEnd", header: "계약종료일", alias: ["계약 종료", "계약만료일"], note: "비우면 기한 없음" },
];

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

/** 헤더 문자열 → 내부 키 */
export function headerKey(header: string): string | null {
  const h = norm(header);
  if (!h) return null;
  for (const col of IMPORT_COLUMNS) {
    if (norm(col.header) === h) return col.key;
    if (col.alias.some((a) => norm(a) === h)) return col.key;
  }
  return null;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** 2025-03-01 / 2025.3.1 / 2025년 3월 1일 / 엑셀 시리얼 / Date → YYYY-MM-DD */
export function toYmd(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000)
    return new Date(EXCEL_EPOCH_MS + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/(\d{4})\s*[-.\/년]\s*(\d{1,2})\s*[-.\/월]\s*(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

/** "3,000,000" / "300만" / 3000000 → 3000000 */
export function toAmount(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Math.round(v);
  const s = String(v).replace(/[,\s원]/g, "");
  const man = s.match(/^(\d+(?:\.\d+)?)만$/);
  if (man) return Math.round(Number(man[1]) * 10000);
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** "209" / "21.725시간" → 209 / 21.725. 비었으면 null (소수점 유지 — 금액과 달리 반올림 금지) */
export function toHoursOrNull(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const n = Number(String(v).replace(/[,\s시간h]/gi, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 주민등록번호 정규화 — "9001011234567" / "900101 - 1234567" → "900101-1234567".
 * 자릿수·생년월일·성별자리만 본다. 2020-10 이후 발급분은 뒤 6자리가 임의값이라
 * 검증번호(checksum)로는 판별할 수 없어 쓰지 않는다.
 */
export function normalizeRRN(v: unknown): { value: string | null; error?: string } {
  const raw = String(v ?? "").trim();
  if (!raw) return { value: null };
  const d = raw.replace(/\D/g, "");
  if (d.length !== 13) return { value: null, error: `주민등록번호 자릿수가 13자리가 아닙니다 (${d.length}자리)` };
  const mm = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  const g = Number(d[6]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31)
    return { value: null, error: "주민등록번호 앞 6자리가 생년월일 형식이 아닙니다" };
  if (g < 1 || g > 8) return { value: null, error: "주민등록번호 뒤 첫 자리(성별)가 올바르지 않습니다" };
  return { value: `${d.slice(0, 6)}-${d.slice(6)}` };
}

/** 주민등록번호 → 생년월일 YYYY-MM-DD (성별자리로 세기 판정) */
export function rrnToBirth(rrn: unknown): string | null {
  const { value } = normalizeRRN(rrn);
  if (!value) return null;
  const d = value.replace("-", "");
  const g = Number(d[6]);
  const century = g === 1 || g === 2 || g === 5 || g === 6 ? 1900 : g === 3 || g === 4 || g === 7 || g === 8 ? 2000 : 1800;
  return `${century + Number(d.slice(0, 2))}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
}

/** 화면·로그에 보일 때는 뒤 6자리를 가린다 */
export function maskSensitive(key: string, v: string): string {
  if (!v) return v;
  if (key === "rrn") return v.replace(/^(\d{6})-?(\d)\d{6}$/, "$1-$2••••••");
  if (key === "bankAccount") return v.length > 4 ? `${"•".repeat(v.length - 4)}${v.slice(-4)}` : v;
  return v;
}

/** "50%" / 50 / 0.5 → 0.5 */
export function toRatio(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).replace(/\s/g, "");
  const hasPercent = s.includes("%");
  const n = Number(s.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  if (hasPercent) return n / 100;
  return n > 1 ? n / 100 : n; // 50 → 0.5, 0.5 → 0.5
}

export function toIncomeType(v: unknown): "EMPLOYEE" | "FREELANCE" | null {
  const s = norm(v);
  if (!s) return null;
  if (/(4대|보험|정규|근로|employee)/.test(s)) return "EMPLOYEE";
  if (/(3\.3|사업|프리|위탁|freelance)/.test(s)) return "FREELANCE";
  return null;
}

export function toPayScheme(v: unknown): ImportRow["payScheme"] | null {
  const s = norm(v);
  if (!s) return null;
  if (/(시급|hourly)/.test(s)) return "HOURLY";
  if (/(비율|위탁|ratio)/.test(s)) return "RATIO";
  if (/(인센|incentive)/.test(s)) return "INCENTIVE";
  if (/(월급|정액|monthly)/.test(s)) return "MONTHLY";
  return null;
}

export interface ParseResult {
  rows: ImportRow[];
  /** 인식하지 못한 헤더 (사용자에게 알려 매핑을 고치게 한다) */
  unknownHeaders: string[];
  /** 인식한 헤더 → 내부 키 */
  mapped: Array<{ header: string; key: string }>;
  /**
   * 파일에 실제로 있던 열의 키.
   * 파서가 기본값을 채워 넣는 항목(부양가족수 등)을 '적어 낸 값'과 구분하는 데 쓴다 —
   * 정보 채우기에서 열도 없는 항목이 덮어써지면 안 된다.
   */
  presentKeys: string[];
}

export interface ParseOptions {
  /**
   * create — 신규 등록용. 입사일·급여형태 등 등록에 필요한 항목을 검사한다.
   * fill   — 이미 등록된 직원의 빈 인적사항을 채우는 용도. 이름(또는 사번)만 있으면 되고
   *          보수·계약 관련 검사는 하지 않는다(그 값은 계약이 정하므로 여기서 건드리지 않는다).
   */
  mode?: "create" | "fill";
}

/** 엑셀/CSV 버퍼 → 직원 행 목록 (첫 시트, 첫 행이 헤더) */
export function parseEmployeeWorkbook(
  buf: Buffer | Uint8Array,
  opts: ParseOptions = {}
): ParseResult {
  const fillMode = opts.mode === "fill";
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], unknownHeaders: [], mapped: [], presentKeys: [] };

  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  if (!grid.length) return { rows: [], unknownHeaders: [], mapped: [], presentKeys: [] };

  // 헤더 행 찾기 — '성명/이름' 이 있는 첫 행
  let headerIdx = grid.findIndex((r) => r.some((c) => headerKey(String(c)) === "name"));
  if (headerIdx < 0) headerIdx = 0;
  const headers = grid[headerIdx].map((c) => String(c ?? "").trim());

  const mapped: Array<{ header: string; key: string }> = [];
  const unknownHeaders: string[] = [];
  const colKey: (string | null)[] = headers.map((h) => {
    const k = headerKey(h);
    if (k) mapped.push({ header: h, key: k });
    else if (h) unknownHeaders.push(h);
    return k;
  });

  const rows: ImportRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i];
    if (!raw || raw.every((c) => String(c ?? "").trim() === "")) continue;

    const get = (key: string) => {
      const idx = colKey.indexOf(key);
      return idx < 0 ? "" : raw[idx];
    };

    const errors: string[] = [];
    const warnings: string[] = [];

    const name = String(get("name") ?? "").trim();
    if (!name) continue; // 이름 없는 줄은 조용히 건너뛴다 (합계행 등)

    const hireDate = toYmd(get("hireDate"));
    if (!hireDate && !fillMode) errors.push("입사일자를 읽을 수 없습니다");

    const payScheme = toPayScheme(get("payScheme"));
    if (!payScheme && !fillMode) {
      warnings.push("급여형태를 알 수 없어 월급제로 등록합니다");
    }
    const incomeType = toIncomeType(get("incomeType"));
    if (!incomeType && !fillMode) {
      warnings.push("세무구분을 알 수 없어 4대보험으로 등록합니다");
    }

    const scheme = payScheme ?? "MONTHLY";
    const ratioPercent = toRatio(get("ratioPercent"));
    const baseWage = toAmount(get("baseWage"));
    const incThresholdRaw = get("incThreshold");
    const incPerStudentRaw = get("incPerStudent");

    if (!fillMode) {
      if (scheme === "RATIO" && ratioPercent == null)
        errors.push("완전비율제인데 위탁비율이 없습니다");
      if (scheme !== "RATIO" && baseWage <= 0) warnings.push("기본급이 0원입니다");
      if (scheme === "INCENTIVE" && (!incThresholdRaw || !incPerStudentRaw))
        warnings.push("인센티브 기준인원·기준금액이 비어 있습니다");
    }

    const resignDate = toYmd(get("resignDate")) ?? undefined;
    const contractStart = toYmd(get("contractStart")) ?? hireDate ?? "";
    const contractEnd = toYmd(get("contractEnd")) ?? undefined;
    if (!fillMode) {
      if (hireDate && contractStart && contractStart < hireDate)
        errors.push("계약시작일이 입사일보다 빠릅니다");
      if (contractEnd && contractStart && contractEnd < contractStart)
        errors.push("계약종료일이 계약시작일보다 빠릅니다");
      if (resignDate && hireDate && resignDate < hireDate)
        errors.push("퇴사일이 입사일보다 빠릅니다");
    }

    // 주민등록번호는 자릿수·형식만 확인하고 하이픈 표기를 통일한다
    const rrnRaw = get("rrn");
    const rrnParsed = normalizeRRN(rrnRaw);
    if (rrnParsed.error) errors.push(rrnParsed.error);

    const str = (k: string) => {
      const v = String(get(k) ?? "").trim();
      return v || undefined;
    };

    rows.push({
      rowNo: i + 1,
      empNo: str("empNo"),
      name,
      rrn: rrnParsed.value ?? undefined,
      // 생년월일이 비어 있으면 주민등록번호에서 끌어온다
      birth: toYmd(get("birth")) ?? str("birth") ?? rrnToBirth(rrnParsed.value) ?? undefined,
      department: str("department"),
      position: str("position"),
      duty: str("duty"),
      address: str("address"),
      phone: str("phone"),
      email: str("email"),
      bankName: str("bankName"),
      bankAccount: str("bankAccount"),
      hireDate: hireDate ?? "",
      resignDate,
      incomeType: incomeType ?? "EMPLOYEE",
      payScheme: scheme,
      baseWage,
      positionAllow: toAmount(get("positionAllow")),
      // 4대보험 '월급제 계열' 직원의 식대 20만원은 이 학원 기본값 — 비어 있을 때만 채운다.
      // 시급제·완전비율제는 식대를 따로 두지 않으므로 자동으로 붙이지 않는다.
      mealAllow:
        String(get("mealAllow") ?? "").trim() === ""
          ? (incomeType ?? "EMPLOYEE") === "EMPLOYEE" &&
            (scheme === "MONTHLY" || scheme === "INCENTIVE")
            ? 200000
            : 0
          : toAmount(get("mealAllow")),
      carAllow: toAmount(get("carAllow")),
      dependents: Math.max(1, toAmount(get("dependents")) || 1),
      incThreshold: incThresholdRaw === "" ? null : toAmount(incThresholdRaw) || null,
      incPerStudent: incPerStudentRaw === "" ? null : toAmount(incPerStudentRaw) || null,
      ratioPercent,
      ratioMinGuarantee:
        String(get("ratioMinGuarantee") ?? "").trim() === ""
          ? null
          : toAmount(get("ratioMinGuarantee")) || null,
      fixedBaseHours: toHoursOrNull(get("fixedBaseHours")),
      fixedOtHours: toHoursOrNull(get("fixedOtHours")),
      fixedNightHours: toHoursOrNull(get("fixedNightHours")),
      contractStart,
      contractEnd,
      errors,
      warnings,
    });
  }

  // 파일 안 중복 검사
  const byName = new Map<string, number[]>();
  const byEmpNo = new Map<string, number[]>();
  rows.forEach((r, i) => {
    byName.set(r.name, [...(byName.get(r.name) ?? []), i]);
    if (r.empNo) byEmpNo.set(r.empNo, [...(byEmpNo.get(r.empNo) ?? []), i]);
  });
  for (const [name, idxs] of byName)
    if (idxs.length > 1)
      idxs.forEach((i) => rows[i].warnings.push(`같은 이름이 ${idxs.length}명 있습니다 (${name})`));
  for (const [empNo, idxs] of byEmpNo)
    if (idxs.length > 1)
      idxs.forEach((i) => rows[i].errors.push(`사번 ${empNo} 가 파일 안에서 중복됩니다`));

  return {
    rows,
    unknownHeaders,
    mapped,
    presentKeys: [...new Set(colKey.filter((k): k is string => !!k))],
  };
}

/**
 * 빈 템플릿 워크북.
 * 첫 시트는 '헤더만' 둔다 — 예시나 안내 문구를 데이터 행에 넣으면
 * 그대로 직원으로 등록될 수 있어, 설명은 두 번째 시트로 분리한다.
 */
export function buildTemplateWorkbook(): Buffer {
  const headers = IMPORT_COLUMNS.map((c) => c.header);
  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(10, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, "직원명단");

  const sample: Record<string, string> = {
    사번: "(비움)",
    성명: "홍길동",
    부서: "교수부",
    직책: "강사",
    업무: "강의(학급관리)",
    입사일자: "2025-03-01",
    퇴사일자: "(재직자는 비움)",
    세무구분: "4대보험",
    급여형태: "월급제",
    기본급: "3,000,000",
    직책수당: "0",
    식대: "200,000",
    차량유지비: "0",
    "인센티브 기준인원": "(해당자만)",
    "인센티브 기준금액": "(해당자만)",
    위탁비율: "(완전비율제만) 50%",
    부양가족수: "1",
    주민등록번호: "900101-1234567",
    생년월일: "1990-01-01",
    연락처: "010-0000-0000",
    이메일: "hong@example.com",
    주소: "",
    은행: "국민",
    계좌번호: "123456-01-123456",
    계약시작일: "(비우면 입사일)",
    계약종료일: "(비우면 기한 없음)",
  };
  const guide = [
    ["작성 안내"],
    ["· 첫 번째 시트 '직원명단' 의 2행부터 직원을 한 줄씩 적어 주세요."],
    ["· 열 순서는 바뀌어도 되고, 쓰지 않는 열은 지워도 됩니다. 열 이름만 맞으면 됩니다."],
    ["· 급여형태: 월급제 / 시급제 / 월급+인센티브 / 완전비율제"],
    ["· 세무구분: 4대보험 / 3.3%"],
    ["· 날짜는 2025-03-01, 2025.3.1 등 어떤 형식이든 됩니다."],
    [],
    ["열 이름", "필수", "설명", "예시"],
    ...IMPORT_COLUMNS.map((c) => [
      c.header,
      c.note === "필수" ? "필수" : "",
      c.note === "필수" ? "" : c.note ?? "",
      sample[c.header] ?? "",
    ]),
  ];
  const gs = XLSX.utils.aoa_to_sheet(guide);
  gs["!cols"] = [{ wch: 18 }, { wch: 6 }, { wch: 40 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, gs, "작성안내");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/* ============================ 기존 직원 정보 채우기 ============================ */
//
// 이미 등록된 직원의 '비어 있는 인적사항' 만 채운다.
// 보수조건(기본급·수당·비율·포괄임금 시간)은 계약이 정하므로 여기서 절대 손대지 않는다
// — 그쪽을 바꾸려면 계약을 수정하거나 신규 계약을 써야 한다(lib/contracts.ts).

/** 채울 수 있는 항목 — 인적사항만 */
export const FILL_FIELDS: Array<{
  key: string;
  label: string;
  kind: "text" | "int";
  sensitive?: boolean;
}> = [
  { key: "rrn", label: "주민등록번호", kind: "text", sensitive: true },
  { key: "birth", label: "생년월일", kind: "text" },
  { key: "department", label: "부서", kind: "text" },
  { key: "position", label: "직책", kind: "text" },
  { key: "duty", label: "업무", kind: "text" },
  { key: "phone", label: "연락처", kind: "text" },
  { key: "email", label: "이메일", kind: "text" },
  { key: "address", label: "주소", kind: "text" },
  { key: "bankName", label: "은행", kind: "text" },
  { key: "bankAccount", label: "계좌번호", kind: "text", sensitive: true },
  { key: "dependents", label: "부양가족수", kind: "int" },
];

export interface FillChange {
  field: string;
  label: string;
  /** 화면 표시용 — 민감항목은 가려서 담는다 */
  from: string;
  to: string;
}

export interface FillPlanRow {
  rowNo: number;
  name: string;
  employeeId: number | null;
  matchedBy: "empNo" | "name" | null;
  /** 실제로 적용될 변경 */
  changes: FillChange[];
  /** 이미 값이 있어 건드리지 않는 항목 (덮어쓰기를 켜면 적용 대상) */
  kept: FillChange[];
  /** 커밋에 쓸 실제 값 (미리보기 응답에는 싣지 않는다) */
  data: Record<string, any>;
  errors: string[];
  warnings: string[];
}

export interface FillPlan {
  rows: FillPlanRow[];
  matchedCount: number;
  changeCount: number;
  unmatched: string[];
}

/** 명단 파일에 담긴 사람을 이미 등록된 직원과 맞춘다 (사번 우선, 없으면 성명) */
export interface FillTarget {
  id: number;
  empNo: string;
  name: string;
  [field: string]: any;
}

const isEmpty = (v: any) => v == null || String(v).trim() === "";

/**
 * 채우기 계획 수립 (순수 함수).
 * overwrite=false(기본)면 대상 직원의 값이 비어 있는 항목만 채운다.
 */
export function planFill(
  rows: ImportRow[],
  employees: FillTarget[],
  opts: {
    overwrite?: boolean;
    /** 파일에 실제로 있던 열만 대상으로 한다 (parseEmployeeWorkbook 의 presentKeys) */
    presentKeys?: string[];
  } = {}
): FillPlan {
  const allowed = opts.presentKeys ? new Set(opts.presentKeys) : null;
  // 주민등록번호 열이 있으면 거기서 뽑아낸 생년월일도 채울 수 있게 한다
  if (allowed?.has("rrn")) allowed.add("birth");
  const byNo = new Map<string, FillTarget>();
  const byName = new Map<string, FillTarget[]>();
  for (const e of employees) {
    if (e.empNo) byNo.set(e.empNo.trim(), e);
    const list = byName.get(e.name.trim()) ?? [];
    list.push(e);
    byName.set(e.name.trim(), list);
  }

  const plan: FillPlanRow[] = [];
  const unmatched: string[] = [];

  for (const r of rows) {
    const errors = [...r.errors];
    const warnings: string[] = [];
    let target: FillTarget | null = null;
    let matchedBy: "empNo" | "name" | null = null;

    if (r.empNo && byNo.has(r.empNo.trim())) {
      target = byNo.get(r.empNo.trim())!;
      matchedBy = "empNo";
    } else {
      const cands = byName.get(r.name.trim()) ?? [];
      if (cands.length === 1) {
        target = cands[0];
        matchedBy = "name";
      } else if (cands.length > 1) {
        errors.push(`'${r.name}' 이름의 직원이 ${cands.length}명입니다 — 사번 열을 넣어 구분해 주세요`);
      } else {
        errors.push("등록된 직원 중 일치하는 사람이 없습니다");
        unmatched.push(r.name);
      }
    }

    const changes: FillChange[] = [];
    const kept: FillChange[] = [];
    const data: Record<string, any> = {};

    if (target && !errors.length) {
      for (const f of FILL_FIELDS) {
        // 파일에 그 열이 없으면 건너뛴다. 파서 기본값(부양가족수 1 등)이 새어 들어오면 안 된다.
        if (allowed && !allowed.has(f.key)) continue;
        const incomingRaw = (r as any)[f.key];
        if (isEmpty(incomingRaw)) continue;
        const incoming = f.kind === "int" ? Number(incomingRaw) : String(incomingRaw).trim();
        const current = target[f.key];
        if (!isEmpty(current) && String(current) === String(incoming)) continue; // 같은 값 — 변경 아님

        const show = (v: any) =>
          isEmpty(v) ? "(비어 있음)" : f.sensitive ? maskSensitive(f.key, String(v)) : String(v);
        const entry: FillChange = {
          field: f.key,
          label: f.label,
          from: show(current),
          to: show(incoming),
        };
        if (isEmpty(current) || opts.overwrite) {
          changes.push(entry);
          data[f.key] = incoming;
        } else {
          kept.push(entry);
        }
      }
      if (!changes.length && !kept.length) warnings.push("채울 내용이 없습니다");
      else if (!changes.length) warnings.push("이미 값이 있어 건너뜁니다 (덮어쓰기 필요)");
    }

    plan.push({
      rowNo: r.rowNo,
      name: r.name,
      employeeId: target?.id ?? null,
      matchedBy,
      changes,
      kept,
      data,
      errors,
      warnings,
    });
  }

  return {
    rows: plan,
    matchedCount: plan.filter((p) => p.employeeId != null && !p.errors.length).length,
    changeCount: plan.reduce((a, p) => a + p.changes.length, 0),
    unmatched,
  };
}

/**
 * 정보 채우기용 빈 양식 — 성명 + 인적사항만.
 * 보수조건 열이 없으니 실수로 급여를 덮어쓸 여지가 없다.
 */
export function buildFillTemplateWorkbook(employees: Array<{ empNo: string; name: string }> = []): Buffer {
  const keys = ["empNo", "name", ...FILL_FIELDS.map((f) => f.key)];
  const headers = keys.map((k) => IMPORT_COLUMNS.find((c) => c.key === k)?.header ?? k);
  const wb = XLSX.utils.book_new();

  // 등록된 직원을 미리 깔아 두면 이름을 다시 적을 필요가 없다
  const body = employees.map((e) => [e.empNo, e.name, ...FILL_FIELDS.map(() => "")]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, "직원정보");

  const guide = [
    ["정보 채우기 안내"],
    ["· 이미 등록된 직원의 '비어 있는 인적사항' 을 채우는 양식입니다."],
    ["· 사번·성명으로 직원을 찾습니다. 동명이인이 있으면 사번을 꼭 적어 주세요."],
    ["· 채울 항목만 적으면 됩니다. 빈 칸은 건드리지 않습니다."],
    ["· 기본급·수당·위탁비율 등 보수조건은 이 양식으로 바꿀 수 없습니다 (계약에서 수정)."],
    ["· 주민등록번호는 900101-1234567 처럼 적어 주세요. 하이픈은 없어도 됩니다."],
    ["· 생년월일을 비워 두면 주민등록번호에서 자동으로 채웁니다."],
  ].map((r) => [r[0]]);
  const gs = XLSX.utils.aoa_to_sheet(guide);
  gs["!cols"] = [{ wch: 70 }];
  XLSX.utils.book_append_sheet(wb, gs, "작성안내");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
