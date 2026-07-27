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
}

/** 엑셀/CSV 버퍼 → 직원 행 목록 (첫 시트, 첫 행이 헤더) */
export function parseEmployeeWorkbook(buf: Buffer | Uint8Array): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], unknownHeaders: [], mapped: [] };

  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  if (!grid.length) return { rows: [], unknownHeaders: [], mapped: [] };

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
    if (!hireDate) errors.push("입사일자를 읽을 수 없습니다");

    const payScheme = toPayScheme(get("payScheme"));
    if (!payScheme) {
      warnings.push("급여형태를 알 수 없어 월급제로 등록합니다");
    }
    const incomeType = toIncomeType(get("incomeType"));
    if (!incomeType) {
      warnings.push("세무구분을 알 수 없어 4대보험으로 등록합니다");
    }

    const scheme = payScheme ?? "MONTHLY";
    const ratioPercent = toRatio(get("ratioPercent"));
    const baseWage = toAmount(get("baseWage"));
    const incThresholdRaw = get("incThreshold");
    const incPerStudentRaw = get("incPerStudent");

    if (scheme === "RATIO" && ratioPercent == null)
      errors.push("완전비율제인데 위탁비율이 없습니다");
    if (scheme !== "RATIO" && baseWage <= 0)
      warnings.push("기본급이 0원입니다");
    if (scheme === "INCENTIVE" && (!incThresholdRaw || !incPerStudentRaw))
      warnings.push("인센티브 기준인원·기준금액이 비어 있습니다");

    const resignDate = toYmd(get("resignDate")) ?? undefined;
    const contractStart = toYmd(get("contractStart")) ?? hireDate ?? "";
    const contractEnd = toYmd(get("contractEnd")) ?? undefined;
    if (hireDate && contractStart && contractStart < hireDate)
      errors.push("계약시작일이 입사일보다 빠릅니다");
    if (contractEnd && contractStart && contractEnd < contractStart)
      errors.push("계약종료일이 계약시작일보다 빠릅니다");
    if (resignDate && hireDate && resignDate < hireDate)
      errors.push("퇴사일이 입사일보다 빠릅니다");

    const str = (k: string) => {
      const v = String(get(k) ?? "").trim();
      return v || undefined;
    };

    rows.push({
      rowNo: i + 1,
      empNo: str("empNo"),
      name,
      rrn: str("rrn"),
      birth: toYmd(get("birth")) ?? str("birth"),
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

  return { rows, unknownHeaders, mapped };
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
