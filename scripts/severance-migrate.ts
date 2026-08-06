/**
 * 퇴직급여 이력 마이그레이션 — 시스템 도입 이전 달을 **계약 이력에서 추산**해 메운다.
 *
 *   npm run db:severance-migrate            # 미리보기 (아무것도 쓰지 않는다)
 *   APPLY=1 npm run db:severance-migrate    # 실제 반영
 *   THROUGH=2026-06 ...                     # 어느 달까지 (기본 2026-06)
 *
 * **왜 필요한가**: 퇴직급여는 원래 그 달 급여 레코드에서 파생되는데(lib/severance-service.ts),
 * 시스템 도입 전에는 급여 레코드 자체가 없다. 그 달들이 0으로 남으면 누계가 통째로 비고,
 * DC 전환 때 소급 납입할 금액도 나오지 않는다.
 *
 * **무엇을 쓰는가**: `SeveranceMonthlyBase` 에 `source="ESTIMATED"` 로 월별 산정기준 임금을 넣는다.
 * 우선순위가 **MANUAL > 급여 레코드 > ESTIMATED** 라, 나중에 그 달 급여가 생기면 급여가
 * 자동으로 이기고 추산값은 조용히 밀려난다 — 지우지 않아도 된다.
 *
 * **멱등**: 이미 값이 있는 달은 건너뛴다(관리자가 고친 MANUAL 을 덮지 않는다).
 * 다시 추산하려면 `REDO=1` 로 ESTIMATED 만 덮어쓴다(MANUAL 은 그대로 둔다).
 */

import { prisma } from "../lib/db";
import { parseSchedule, isContractorContract, PAY_SCHEME_LABEL } from "../lib/constants";
import { computeWeeklyHours } from "../lib/payroll";
import { governingContract, paySchemeOfTemplate } from "../lib/contracts";
import {
  estimateContractBase,
  severanceVerdict,
  monthlyAccrual,
  type SeverancePolicy,
} from "../lib/severance";

const APPLY = process.env.APPLY === "1";
const REDO = process.env.REDO === "1";
const THROUGH = process.env.THROUGH || "2026-06";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0));
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));

/** 그 달의 재직비율 — 월중 입·퇴사면 일수로 나눈다 (급여의 일할계산과 같은 뜻) */
function prorateOf(hire: Date, resign: Date | null, y: number, m: number): number {
  const first = monthStart(y, m);
  const last = monthEnd(y, m);
  const days = last.getUTCDate();
  const from = hire > first ? hire : first;
  const to = resign && resign < last ? resign : last;
  if (to < from) return 0;
  const worked = (to.getTime() - from.getTime()) / 86400000 + 1;
  return Math.min(Math.max(worked / days, 0), 1);
}

async function main() {
  const [ty, tm] = THROUGH.split("-").map(Number);
  if (!ty || !tm || tm < 1 || tm > 12) {
    console.error(`[severance] THROUGH 형식이 잘못됐습니다: ${THROUGH} (예: 2026-06)`);
    process.exit(1);
  }

  console.log(
    `[severance] 퇴직급여 이력 추산 — ${THROUGH} 까지 · ${
      APPLY ? "실제 반영" : "미리보기 (쓰지 않음)"
    }${REDO ? " · 기존 추산값 다시 계산" : ""}`
  );

  const policy = (await prisma.severancePolicy.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  })) as unknown as SeverancePolicy;

  const emps = await prisma.employee.findMany({
    include: { contracts: { orderBy: { startDate: "asc" } } },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });

  const existing = await prisma.severanceMonthlyBase.findMany();
  const have = new Map(existing.map((o) => [`${o.employeeId}:${o.year}:${o.month}`, o]));

  const payrolls = await prisma.payrollRecord.findMany({
    select: { employeeId: true, year: true, month: true },
  });
  const hasPayroll = new Set(payrolls.map((p) => `${p.employeeId}:${p.year}:${p.month}`));

  const writes: Array<{ employeeId: number; year: number; month: number; base: number; note: string }> = [];
  const skipped: string[] = [];
  let totalAccrual = 0;

  for (const e of emps) {
    const schedule = parseSchedule(e.schedule);
    const hasSchedule = schedule.some((d) => d.work);
    const { weeklyContractual, weeklyHoliday } = computeWeeklyHours(schedule);
    const subject = {
      hireDate: e.hireDate,
      contractor: isContractorContract(e),
      weeklyContractual,
      hasSchedule,
    };

    // 지금 기준으로 대상이 아니면 과거분도 만들지 않는다 (화면의 누계 규칙과 같다)
    const now = severanceVerdict(subject, monthEnd(ty, tm), policy);
    if (now.status === "EXCLUDED" || now.status === "UNKNOWN") {
      skipped.push(`${e.name} (${PAY_SCHEME_LABEL[e.payScheme] ?? e.payScheme}) — ${now.reason}`);
      continue;
    }

    let made = 0;
    let sum = 0;
    let y = e.hireDate.getUTCFullYear();
    let m = e.hireDate.getUTCMonth() + 1;
    while (y < ty || (y === ty && m <= tm)) {
      const key = `${e.id}:${y}:${m}`;
      const prev = have.get(key);
      const skip =
        // 이미 그 달 급여가 있으면 그쪽이 이긴다 — 추산을 만들 이유가 없다
        hasPayroll.has(key) ||
        // 관리자가 고친 값은 절대 덮지 않는다
        prev?.source === "MANUAL" ||
        // 이미 추산해 둔 달은 REDO 일 때만 다시 만든다
        (prev?.source === "ESTIMATED" && !REDO);
      if (skip) {
        m += 1;
        if (m > 12) (m = 1), (y += 1);
        continue;
      }

      // 퇴사 후의 달은 만들지 않는다
      const prorate = prorateOf(e.hireDate, e.resignDate, y, m);
      if (prorate <= 0) {
        m += 1;
        if (m > 12) (m = 1), (y += 1);
        continue;
      }

      // **그 달을 지배한 계약**의 보수조건으로 추산한다 (계약이 진실 — 직원 카드는 거울일 뿐)
      const c = governingContract(e.contracts, monthEnd(y, m));
      const terms = c
        ? {
            // 계약이 진실 — 모르는 종류(촉탁·단기 등)면 직원 카드로 물러난다
            payScheme: paySchemeOfTemplate(c.templateKey) ?? e.payScheme,
            baseWage: c.baseWage,
            positionAllow: c.positionAllow,
            mealAllow: c.mealAllow,
            carAllow: c.carAllow,
            isContractor: c.isContractor,
          }
        : {
            // 계약 이력이 없는 달은 직원 카드로 대신한다 — 근거에 그렇게 적는다
            payScheme: e.payScheme,
            baseWage: e.baseWage,
            positionAllow: e.positionAllow,
            mealAllow: e.mealAllow,
            carAllow: e.carAllow,
            isContractor: e.isContractor,
          };

      const est = estimateContractBase(terms, { weeklyContractual, weeklyHoliday, prorate });
      if (est.excluded || est.base <= 0) {
        m += 1;
        if (m > 12) (m = 1), (y += 1);
        continue;
      }

      const note = c ? est.note : `${est.note} ※ 그 달 계약 이력이 없어 직원 카드 기준`;
      writes.push({ employeeId: e.id, year: y, month: m, base: est.base, note });
      made++;
      sum += monthlyAccrual(est.base, policy);

      m += 1;
      if (m > 12) (m = 1), (y += 1);
    }

    if (made) {
      totalAccrual += sum;
      console.log(
        `  · ${e.name.padEnd(6)} ${String(made).padStart(3)}개월  적립 ${won(sum).padStart(12)}원  ` +
          `(입사 ${e.hireDate.toISOString().slice(0, 10)}${e.contracts.length ? "" : " · 계약 이력 없음"})`
      );
    }
  }

  if (skipped.length) {
    console.log(`\n[severance] 대상 아님·보류 ${skipped.length}명:`);
    for (const s of skipped) console.log(`  · ${s}`);
  }

  console.log(
    `\n[severance] 만들 달: ${writes.length}개 · 적립 합계 ${won(totalAccrual)}원 ` +
      `(직원 ${new Set(writes.map((w) => w.employeeId)).size}명)`
  );

  if (!writes.length) {
    console.log("[severance] 새로 만들 것이 없습니다.");
    return;
  }

  if (!APPLY) {
    console.log("\n[severance] 미리보기입니다 — 아무것도 쓰지 않았습니다.");
    console.log("[severance] 실제로 반영하려면: APPLY=1 npm run db:severance-migrate");
    console.log("[severance] 표본 5건:");
    for (const w of writes.slice(0, 5))
      console.log(`  · #${w.employeeId} ${w.year}-${String(w.month).padStart(2, "0")}  ${won(w.base)}원\n     ${w.note}`);
    return;
  }

  // upsert 로 넣는다 — REDO 로 다시 돌려도 같은 달이 두 줄이 되지 않는다
  let done = 0;
  for (const w of writes) {
    await prisma.severanceMonthlyBase.upsert({
      where: { employeeId_year_month: { employeeId: w.employeeId, year: w.year, month: w.month } },
      update: { base: w.base, source: "ESTIMATED", note: w.note },
      create: { ...w, source: "ESTIMATED" },
    });
    done++;
  }
  console.log(`[severance] ✅ ${done}개 달을 반영했습니다.`);
  console.log("[severance] 퇴직급여 화면에서 '추산' 배지로 확인할 수 있고, 행을 눌러 기준급여를 고칠 수 있습니다.");
}

main()
  .catch((e) => {
    console.error("[severance] 실패:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
