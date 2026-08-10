/**
 * 그 달 급여 산정 시트에 **누가 오르는가** — 순수 함수(DB 무관).
 *
 * 전월 자로 퇴직한 직원은 익월 시트에 나오면 안 된다. 산정 자체는 원래도
 * 일할계산 비율이 0 이라 건너뛰었지만, **이미 만들어 둔 기록은 그대로 남았다** —
 * 월초에 급여를 한 번 돌린 뒤 퇴직일을 입력하면 그 달 시트에 만근 금액이 남아
 * 세무 제출자료·은행 이체 파일까지 그대로 흘러간다. 그래서 산정 때마다
 * '이 달 재직 기간이 없는 기록' 을 훑어 내린다.
 *
 * 반대로 **일부러 올려야 하는 경우도 있다** — 퇴직 뒤에 확정된 보강 수당,
 * 미사용 연차수당, 인센티브 정산처럼 마지막 급여 이후에 지급할 몫이 생긴다.
 * 그건 기록에 `manualAdd` 를 새겨 두고 배치가 건드리지 않게 한다.
 * (일할계산 비율은 0 이라 기본급은 0 이고, 직접 넣은 항목만 지급된다.)
 */

export interface RosterEmp {
  id: number;
  name?: string;
  hireDate: Date;
  resignDate?: Date | null;
}

export interface SheetRecord {
  id: number;
  employeeId: number;
  status: string;
  manualAdd?: boolean | null;
  gross?: number;
  net?: number;
}

/** 왜 시트에 있는가 / 왜 없는가 */
export type RosterReason =
  /** 그 달에 하루라도 재직 */
  | "EMPLOYED"
  /** 재직 기간은 없지만 관리자가 직접 올림 */
  | "MANUAL"
  /** 그 달 시작 전에 퇴직 */
  | "RESIGNED"
  /** 그 달이 끝난 뒤에 입사 */
  | "NOT_HIRED";

export interface RosterVerdict {
  employeeId: number;
  include: boolean;
  reason: RosterReason;
  /** 화면·작업 이력에 그대로 쓰는 한 줄 */
  note: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** 시각을 떼고 날짜만 남긴다 — 입·퇴사일은 하루 단위로만 뜻이 있다 */
function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function monthSpan(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0)), // 말일
  };
}

/**
 * 그 달에 하루라도 재직했는가.
 * `prorationRatioFor(...) > 0` 과 **같은 판정**이어야 한다(테스트로 못박아 둔다) —
 * 둘이 어긋나면 시트에는 올라오는데 금액이 0 이거나, 그 반대가 된다.
 */
export function employedInMonth(emp: RosterEmp, year: number, month: number): boolean {
  const { start, end } = monthSpan(year, month);
  if (dayStart(emp.hireDate) > end) return false;
  if (emp.resignDate && dayStart(emp.resignDate) < start) return false;
  return true;
}

export function rosterVerdict(
  emp: RosterEmp,
  year: number,
  month: number,
  manual = false
): RosterVerdict {
  const who = emp.name ?? `#${emp.id}`;
  if (employedInMonth(emp, year, month))
    return { employeeId: emp.id, include: true, reason: "EMPLOYED", note: "" };
  if (manual)
    return {
      employeeId: emp.id,
      include: true,
      reason: "MANUAL",
      note: `${who} — ${year}년 ${month}월 재직 기간은 없지만 관리자가 시트에 올린 건입니다`,
    };
  if (emp.resignDate)
    return {
      employeeId: emp.id,
      include: false,
      reason: "RESIGNED",
      note: `${who} — ${ymd(emp.resignDate)} 퇴직 (${year}년 ${month}월 재직 없음)`,
    };
  return {
    employeeId: emp.id,
    include: false,
    reason: "NOT_HIRED",
    note: `${who} — ${ymd(emp.hireDate)} 입사 예정 (${year}년 ${month}월 재직 없음)`,
  };
}

export interface CleanupEntry {
  recordId: number;
  employeeId: number;
  name: string;
  reason: RosterReason;
  note: string;
  gross: number;
}

export interface SheetCleanupPlan {
  /** 시트에서 내릴 것 */
  remove: CleanupEntry[];
  /**
   * 재직 기간이 없는데 **이미 발송(SENT)** 돼 내리지 못한 것.
   * 잠금은 이 경로로 풀지 않는다 — 명세서가 이미 직원에게 갔으므로
   * 사유를 남기는 '발송 잠금 해제' 를 거쳐야 한다. 대신 알린다.
   */
  locked: CleanupEntry[];
  /** 관리자가 일부러 올려 둔 것 — 그대로 둔다 */
  kept: CleanupEntry[];
}

/**
 * 그 달 기록 목록에서 내릴 것을 가린다.
 * 직원 카드를 못 찾은 기록은 **건드리지 않는다** — 판단 근거가 없는데 지우는 쪽이 더 나쁘다.
 */
export function planSheetCleanup(
  records: SheetRecord[],
  emps: RosterEmp[],
  year: number,
  month: number
): SheetCleanupPlan {
  const byId = new Map(emps.map((e) => [e.id, e]));
  const plan: SheetCleanupPlan = { remove: [], locked: [], kept: [] };
  for (const rec of records) {
    const emp = byId.get(rec.employeeId);
    if (!emp) continue; // 근거 없음 — 그대로 둔다
    if (employedInMonth(emp, year, month)) continue;
    const v = rosterVerdict(emp, year, month, !!rec.manualAdd);
    const entry: CleanupEntry = {
      recordId: rec.id,
      employeeId: rec.employeeId,
      name: emp.name ?? `#${emp.id}`,
      reason: v.reason,
      note: v.note,
      gross: rec.gross ?? 0,
    };
    if (rec.manualAdd) plan.kept.push(entry);
    else if (rec.status === "SENT") plan.locked.push(entry);
    else plan.remove.push(entry);
  }
  return plan;
}

/**
 * **조회 시점** 기준 퇴직 여부.
 *
 * 급여 시트는 '그 달에 재직했는가' 로 만들지만, 화면을 보는 시점은 그보다 뒤다 —
 * 8월 시트에 8/15 퇴직자가 올라와 있는 건 맞는 일이고(마지막 급여), 9월에 그 화면을
 * 열면 그 사람은 이미 나간 사람이다. 이름만 봐서는 재직자와 구분이 안 돼
 * **엉뚱한 사람에게 급여가 나갈 수 있으므로** 행을 다르게 그린다.
 *
 * - `RESIGNED` — 오늘 기준 이미 퇴직 (지급 전에 반드시 확인할 행)
 * - `LEAVING`  — 퇴사일이 잡혀 있으나 아직 오지 않음 (마지막 급여를 앞둔 행)
 *
 * ⚠ Tailwind 클래스는 여기 두지 않는다 — `content` 가 `lib/` 를 훑지 않아
 * 조용히 아무 효과도 나지 않는다. 색은 부르는 쪽(components/app)에서 고른다.
 */
export type ResignStatus = "NONE" | "RESIGNED" | "LEAVING";

export function resignStatusOf(
  resignDate: string | null | undefined,
  todayYmd: string
): ResignStatus {
  if (!resignDate) return "NONE";
  const day = resignDate.slice(0, 10); // ISO 문자열로 와도 날짜만 본다
  return day <= todayYmd ? "RESIGNED" : "LEAVING";
}

/** 이름 옆에 붙이는 짧은 표시 — 날짜를 함께 적어야 '언제 나갔나' 를 되묻지 않는다 */
export function resignBadgeLabel(resignDate: string, status: ResignStatus): string {
  const day = resignDate.slice(0, 10);
  if (status === "LEAVING") return `${day} 퇴사 예정`;
  return `${day} 퇴직`;
}

/** 시트 위에 띄우는 한 줄 — 몇 명이 얼마짜리인지까지 적어야 지급 전에 걸린다 */
export function resignedSummary(
  rows: Array<{ name: string; resignDate?: string | null; gross: number }>,
  todayYmd: string
): { count: number; gross: number; names: string[] } {
  const hit = rows.filter((r) => resignStatusOf(r.resignDate, todayYmd) === "RESIGNED");
  return {
    count: hit.length,
    gross: hit.reduce((a, r) => a + r.gross, 0),
    names: hit.map((r) => r.name),
  };
}

/** 산정 결과 화면에 띄우는 안내 — 조용히 빠지면 왜 없어졌는지 아무도 모른다 */
export function cleanupNotice(plan: SheetCleanupPlan): string {
  const lines: string[] = [];
  if (plan.remove.length)
    lines.push(
      `퇴직·미입사로 시트에서 제외한 ${plan.remove.length}명\n` +
        plan.remove.map((e) => `· ${e.note}`).join("\n")
    );
  if (plan.locked.length)
    lines.push(
      `⚠️ 재직 기간이 없는데 이미 명세서가 발송돼 그대로 둔 ${plan.locked.length}건\n` +
        plan.locked.map((e) => `· ${e.note}`).join("\n") +
        `\n→ 잘못된 발송이면 상태 필터를 '발송완료' 로 좁혀 '발송 잠금 해제' 후 다시 산정하세요.`
    );
  return lines.join("\n\n");
}
