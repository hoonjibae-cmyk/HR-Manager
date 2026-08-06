/**
 * 공휴일 표 채우기 — 한국천문연구원 「특일 정보」에서 받아 온다.
 *
 *   npm run db:holidays-sync              # 올해·내년
 *   YEARS=2026,2027 npm run db:holidays-sync
 *
 * `HOLIDAY_API_KEY` 가 있어야 한다(공공데이터포털 인증키의 **Decoding** 쪽).
 *
 * **넣기만 하고 지우지 않는다** — 표에 학원이 직접 넣은 휴무일이 섞여 있을 수 있어서다.
 * 관공서 공휴일 목록에 없는 날은 마지막에 따로 적어 주고, 지울지는 사람이 정한다.
 *
 * 앱에서는 설정 화면의 *공휴일 받아오기* 버튼과 크론이 같은 일을 한다 —
 * 크론은 표가 모자랄 때만 부르므로 평소에는 API 를 두드리지 않는다.
 */

import { prisma } from "../lib/db";
import { syncHolidays } from "../lib/holiday-service";
import { yearsToSync } from "../lib/holidays";

async function main() {
  const years = (process.env.YEARS || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((y) => Number.isFinite(y) && y >= 2000 && y <= 2100);
  const list = years.length ? years : yearsToSync();

  if (!(process.env.HOLIDAY_API_KEY || "").trim()) {
    console.error("HOLIDAY_API_KEY 가 없습니다 — 공공데이터포털 「한국천문연구원_특일 정보」 인증키(Decoding)를 .env 에 넣어 주세요.");
    process.exit(1);
  }

  console.log(`공휴일 동기화 — ${list.join(", ")}년`);
  const out = await syncHolidays(list);

  for (const r of out.results) {
    if (r.error) {
      console.error(`  ✗ ${r.year}년 — ${r.error}`);
      continue;
    }
    console.log(
      `  ✓ ${r.year}년 — ${r.added}일 추가` +
        (r.renamed ? ` · ${r.renamed}일 이름 정정` : "") +
        (r.skipped ? ` · 못 읽은 항목 ${r.skipped}건(⚠ API 모양이 바뀌었을 수 있습니다)` : "")
    );
    if (r.extra.length)
      console.log(`      표에는 있는데 목록에 없는 날(지우지 않음): ${r.extra.map((h) => `${h.date} ${h.name}`).join(", ")}`);
  }

  console.log(out.coverage.warning ? `\n⚠ ${out.coverage.warning}` : "\n채움 상태 정상");
  for (const y of out.coverage.years) console.log(`  ${y.year}년 ${y.count}일 ${y.ok ? "✓" : "⚠"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
