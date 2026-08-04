// 연차 관리시트(엑셀) → 연차 사용 내역 일괄 등록 (순수 함수, DB 무관)
//
// 학원에서 쓰던 '직원 연차 관리시트' 는 한 직원이 두 줄을 차지한다.
//   윗줄: 이름 | 근속일수 | 연차 총일수 | 누적사용일수 | 전년도사용 | 잔여 | 대체휴가부여 | 휴가종류 ...
//   아랫줄:                                                        | 대체휴가사용 | 사용일자 ...
// 휴가종류와 사용일자가 같은 열에서 위아래로 짝을 이룬다.
//
// 발생(부여) 정보는 읽지 않는다 — 시트는 회계연도(1/1) 기준이고 이 시스템은 입사일 기준이라
// 총일수가 서로 다르다. 발생은 시스템이 근로기준법대로 계산하고, 여기서는 '사용 내역'만 가져온다.

import * as XLSX from "xlsx";
import { isContractorContract } from "./constants";

/** 시트의 휴가종류 → 시스템 표기 */
export interface LeaveKind {
  /** 시스템 leaveType (LEAVE_TYPE_LABEL) */
  type: string;
  /** 하루치 차감 일수 */
  days: number;
  /** 연차(STATUTORY) 인지 대체휴가(COMP) 인지 */
  category: "STATUTORY" | "COMP";
  /** 잔여에서 차감하는지 — 공가공상·무급휴가는 차감하지 않는다 */
  deducts: boolean;
}

/**
 * 시트에 실제로 등장하는 휴가종류만 다룬다.
 * 가중치는 시트가 스스로 계산해 둔 '누적사용일수' 와 대조해 확정했다
 * (2023~2026 4개 시트 83명 전원 일치) — 대체휴일·공가공상·무급휴가는 연차를 깎지 않는다.
 */
export const LEAVE_KINDS: Record<string, LeaveKind> = {
  연차: { type: "ANNUAL", days: 1, category: "STATUTORY", deducts: true },
  반차: { type: "HALF", days: 0.5, category: "STATUTORY", deducts: true },
  대체휴일: { type: "COMP", days: 1, category: "COMP", deducts: true },
  "대체휴일(반)": { type: "COMP", days: 0.5, category: "COMP", deducts: true },
  공가공상: { type: "SPECIAL", days: 1, category: "STATUTORY", deducts: false },
  무급휴가: { type: "UNPAID", days: 1, category: "STATUTORY", deducts: false },
  "무급휴가(반)": { type: "UNPAID", days: 0.5, category: "STATUTORY", deducts: false },
};

export interface LeaveEntry {
  /** YYYY-MM-DD */
  date: string;
  /** 시트에 적힌 그대로 */
  label: string;
  type: string;
  days: number;
  category: "STATUTORY" | "COMP";
  deducts: boolean;
}

export interface LeaveSheetRow {
  rowNo: number;
  /** 시트 표기 그대로 (예: "박영은_지원팀장") */
  rawName: string;
  /** 직책 접미사를 뗀 이름 */
  name: string;
  entries: LeaveEntry[];
  /** 시트가 계산해 둔 누적사용일수 — 검산용 */
  sheetUsed: number | null;
  /** 시트가 계산해 둔 연차 총일수 (회계연도 기준) — 참고용. 등록하지 않는다 */
  sheetTotal: number | null;
  /** 위 entries 로 다시 계산한 연차 차감 합계 */
  computedUsed: number;
  /** 시트의 대체휴가 부여 / 사용 */
  compGranted: number;
  compUsed: number;
  errors: string[];
  warnings: string[];
}

export interface LeaveParseResult {
  year: number;
  sheetName: string;
  rows: LeaveSheetRow[];
  /** 파일에 있던 연도 시트 목록 */
  availableYears: number[];
  unknownKinds: string[];
}

/** "박영은_지원팀장" → "박영은". 직책은 시스템의 직원 카드가 갖고 있다. */
export function baseName(raw: string): string {
  return String(raw ?? "")
    .split("_")[0]
    .replace(/\s+/g, "")
    .trim();
}

/** "7/29/26" / "2026-07-29" / 엑셀 시리얼 → YYYY-MM-DD */
export function toSheetDate(v: unknown, year: number): string | null {
  if (v == null || String(v).trim() === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // m/d/yy (엑셀 기본 표기)
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const [, mo, d, y] = us;
    const yy = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    return `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // 월/일만 적힌 경우 시트 연도를 붙인다
  const md = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) return `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  return null;
}

const num = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** 연차 관리시트 파싱. year 를 주면 그 연도 시트를, 없으면 가장 최근 연도를 읽는다. */
export function parseLeaveWorkbook(
  buf: Buffer | Uint8Array,
  opts: { year?: number } = {}
): LeaveParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const years = wb.SheetNames.filter((n) => /^\d{4}$/.test(n.trim()))
    .map((n) => Number(n.trim()))
    .sort((a, b) => b - a);
  const year = opts.year ?? years[0];
  const sheetName = wb.SheetNames.find((n) => n.trim() === String(year));
  if (!sheetName)
    return { year, sheetName: "", rows: [], availableYears: years, unknownKinds: [] };

  const grid: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: "",
  });

  // 헤더( '직원' 이 있는 행 ) 다음 두 줄부터 직원이 시작한다.
  let headerIdx = grid.findIndex((r) => String(r?.[0] ?? "").trim() === "직원");
  if (headerIdx < 0) headerIdx = 3;

  // 휴가 항목 영역은 'No.1' ~ 'No.N' 열까지. 그 오른쪽에는 입사일·확정연차 같은
  // 보조 데이터가 있어서, 끝까지 훑으면 그것들을 휴가종류로 오해한다.
  const noHeader = grid
    .slice(0, headerIdx)
    .find((r) => (r ?? []).some((c) => /^No\.\d+$/.test(String(c ?? "").trim())));
  const noCols = (noHeader ?? [])
    .map((c, i) => [i, String(c ?? "").trim()] as [number, string])
    .filter(([, v]) => /^No\.\d+$/.test(v))
    .map(([i]) => i);
  const FIRST_ENTRY_COL = noCols[0] ?? 7; // No.1 이 시작하는 열
  const LAST_ENTRY_COL = noCols[noCols.length - 1] ?? Number.MAX_SAFE_INTEGER;

  const rows: LeaveSheetRow[] = [];
  const unknownKinds = new Set<string>();

  for (let i = headerIdx + 2; i < grid.length; i++) {
    const top = grid[i] ?? [];
    const rawName = String(top[0] ?? "").trim();
    if (!rawName) continue;
    const bottom = grid[i + 1] ?? [];
    i++; // 두 줄이 한 직원

    const errors: string[] = [];
    const warnings: string[] = [];
    const entries: LeaveEntry[] = [];

    const endCol = Math.min(Math.max(top.length, bottom.length), LAST_ENTRY_COL + 1);
    for (let c = FIRST_ENTRY_COL; c < endCol; c++) {
      const label = String(top[c] ?? "").trim();
      const dateRaw = bottom[c];
      if (!label && !String(dateRaw ?? "").trim()) continue;
      const date = toSheetDate(dateRaw, year);
      if (!label) continue; // 날짜만 있고 종류가 없으면 무시
      if (!date) {
        warnings.push(`'${label}' 의 사용일자를 읽을 수 없습니다 (${String(dateRaw)})`);
        continue;
      }
      const kind = LEAVE_KINDS[label];
      if (!kind) {
        unknownKinds.add(label);
        warnings.push(`모르는 휴가종류 '${label}' (${date}) — 건너뜁니다`);
        continue;
      }
      if (!date.startsWith(String(year)))
        warnings.push(`${date} 는 ${year}년이 아닙니다 — 그대로 등록합니다`);
      entries.push({ date, label, ...kind });
    }

    const computedUsed = entries
      .filter((e) => e.deducts && e.category === "STATUTORY")
      .reduce((a, e) => a + e.days, 0);
    const sheetUsed = num(top[3]);
    if (sheetUsed != null && Math.abs(sheetUsed - computedUsed) > 0.001)
      warnings.push(
        `시트의 누적사용일수(${sheetUsed})와 읽어들인 합계(${computedUsed})가 다릅니다`
      );

    rows.push({
      rowNo: i, // 아랫줄 기준 (사용일자가 있는 줄)
      rawName,
      name: baseName(rawName),
      entries,
      sheetUsed,
      sheetTotal: num(top[2]),
      computedUsed,
      compGranted: num(top[6]) ?? 0,
      compUsed: num(bottom[6]) ?? 0,
      errors,
      warnings,
    });
  }

  return { year, sheetName, rows, availableYears: years, unknownKinds: [...unknownKinds] };
}

/* ============================ 등록 계획 ============================ */

export interface LeaveTarget {
  id: number;
  name: string;
  payScheme?: string;
}

/** 이미 등록돼 있는 사용 트랜잭션 (중복 등록 방지용) */
export interface ExistingUse {
  employeeId: number;
  /** YYYY-MM-DD */
  date: string;
  category: string;
}

export interface PlannedTxn {
  employeeId: number;
  date: string;
  /** 음수 = 사용 */
  days: number;
  type: "USE" | "GRANT";
  category: "STATUTORY" | "COMP";
  note: string;
}

export interface LeavePlanRow {
  rowNo: number;
  rawName: string;
  name: string;
  employeeId: number | null;
  /** 실제로 등록될 항목 */
  adds: LeaveEntry[];
  /** 이미 같은 날짜로 등록돼 있어 건너뛰는 항목 */
  skipped: LeaveEntry[];
  /** 시트 안에서 같은 날짜가 두 번 적힌 항목 — 오기입일 가능성이 높아 따로 알린다 */
  duplicates: LeaveEntry[];
  /** 연차를 깎지 않아 기록만 하고 넘어가는 항목 (공가공상·무급휴가) */
  nonDeducting: LeaveEntry[];
  /** 새로 부여할 대체휴가 (시트의 '대체휴가 부여') */
  compGrant: number;
  txns: PlannedTxn[];
  errors: string[];
  warnings: string[];
}

export interface LeavePlan {
  year: number;
  rows: LeavePlanRow[];
  matchedCount: number;
  addCount: number;
  skipCount: number;
  /** 시트 안에서 날짜가 겹쳐 한 번만 등록한 항목 수 */
  duplicateCount: number;
  unmatched: string[];
}

/**
 * 시트 행을 등록된 직원과 맞추고, 넣을 트랜잭션을 만든다.
 *
 * - 이름으로 찾는다(직책 접미사는 뗀다). 동명이인은 오류로 남기고 건너뛴다.
 * - 같은 직원·같은 날짜·같은 구분의 사용 기록이 이미 있으면 건너뛴다 — 두 번 올려도 안전하다.
 * - 대체휴가는 '부여'도 함께 넣는다. 시트에서 부여량과 사용량이 같아 잔고가 0으로 맞는다.
 * - 발생(연차 총일수)은 넣지 않는다. 시스템이 입사일 기준으로 계산한다.
 */
export function planLeaveImport(
  rows: LeaveSheetRow[],
  employees: LeaveTarget[],
  existing: ExistingUse[] = [],
  opts: { note?: string } = {}
): LeavePlan {
  const note = opts.note ?? "연차 관리시트 일괄 등록";
  const byName = new Map<string, LeaveTarget[]>();
  for (const e of employees) {
    const k = baseName(e.name);
    const list = byName.get(k) ?? [];
    list.push(e);
    byName.set(k, list);
  }
  const seen = new Set(existing.map((x) => `${x.employeeId}|${x.date}|${x.category}`));

  const out: LeavePlanRow[] = [];
  const unmatched: string[] = [];

  for (const r of rows) {
    const errors = [...r.errors];
    const warnings = [...r.warnings];
    const cands = byName.get(r.name) ?? [];
    let target: LeaveTarget | null = null;

    if (cands.length === 1) target = cands[0];
    else if (cands.length > 1)
      errors.push(`'${r.name}' 이름의 직원이 ${cands.length}명입니다 — 수동으로 등록해 주세요`);
    else {
      errors.push("등록된 직원 중 일치하는 사람이 없습니다");
      unmatched.push(r.rawName);
    }
    if (isContractorContract(target))
      errors.push("위탁계약(프리랜서·완전비율제)은 연차 미적용 대상입니다");

    const adds: LeaveEntry[] = [];
    const skipped: LeaveEntry[] = [];
    const duplicates: LeaveEntry[] = [];
    const nonDeducting: LeaveEntry[] = [];
    const txns: PlannedTxn[] = [];
    const inFile = new Set<string>();

    if (target && !errors.length) {
      for (const e of r.entries) {
        if (!e.deducts) {
          nonDeducting.push(e);
          continue;
        }
        const key = `${target.id}|${e.date}|${e.category}`;
        if (inFile.has(key)) {
          // 같은 시트 안에서 같은 날짜가 또 나왔다 — 하루에 연차를 두 번 쓸 수는 없다
          duplicates.push(e);
          warnings.push(`${e.date} 가 시트에 두 번 적혀 있습니다 — 한 번만 등록합니다`);
          continue;
        }
        inFile.add(key);
        if (seen.has(key)) {
          skipped.push(e);
          continue;
        }
        seen.add(key);
        adds.push(e);
        txns.push({
          employeeId: target.id,
          date: e.date,
          days: -e.days,
          type: "USE",
          category: e.category,
          note: `${note} — ${e.label}`,
        });
      }
      // 대체휴가는 부여 기록이 있어야 사용이 잔고를 넘지 않는다
      const compAdded = adds
        .filter((e) => e.category === "COMP")
        .reduce((a, e) => a + e.days, 0);
      if (compAdded > 0) {
        txns.unshift({
          employeeId: target.id,
          date: adds.find((e) => e.category === "COMP")!.date,
          days: compAdded,
          type: "GRANT",
          category: "COMP",
          note: `${note} — 대체휴가 부여`,
        });
      }
      if (r.compGranted > 0 && Math.abs(r.compGranted - r.compUsed) > 0.001)
        warnings.push(
          `시트의 대체휴가 부여(${r.compGranted})와 사용(${r.compUsed})이 다릅니다 — 사용분만 등록합니다`
        );
    }

    out.push({
      rowNo: r.rowNo,
      rawName: r.rawName,
      name: r.name,
      employeeId: target?.id ?? null,
      adds,
      skipped,
      duplicates,
      nonDeducting,
      compGrant: adds.filter((e) => e.category === "COMP").reduce((a, e) => a + e.days, 0),
      txns,
      errors,
      warnings,
    });
  }

  return {
    year: 0,
    rows: out,
    matchedCount: out.filter((r) => r.employeeId != null && !r.errors.length).length,
    addCount: out.reduce((a, r) => a + r.adds.length, 0),
    skipCount: out.reduce((a, r) => a + r.skipped.length, 0),
    duplicateCount: out.reduce((a, r) => a + r.duplicates.length, 0),
    unmatched,
  };
}
