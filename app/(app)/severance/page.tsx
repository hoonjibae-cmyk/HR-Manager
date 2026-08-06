import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { severanceMonth } from "@/lib/severance-service";
import SeveranceTable from "@/components/SeveranceTable";
import SeverancePolicyPanel from "@/components/SeverancePolicyPanel";

export const dynamic = "force-dynamic";

export default async function SeverancePage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const now = new Date();
  const year = Number(searchParams.year) || now.getFullYear();
  const month = Number(searchParams.month) || now.getMonth() + 1;

  const { rows, policy, totals, warnings } = await severanceMonth(year, month);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  return (
    // 긴 명단 화면은 화면 높이에 맞춰 두 층으로 — 머리글·합계는 고정, 행만 표 안에서 스크롤
    <div className="flex flex-col h-[calc(100dvh-6rem)] min-h-[28rem]">
      <PageHeader
        title="퇴직급여"
        desc="근속 1년 미만은 퇴직급여충당금으로 적립하고, 1년이 지나면 DC형 퇴직연금 부담금으로 산정합니다."
        action={<SeverancePolicyPanel policy={policy as any} />}
      />

      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/severance?year=${prev.y}&month=${prev.m}`} className="btn-outline py-1 px-2.5">
          ←
        </Link>
        <span className="font-bold text-lg text-slate-800 tnum">
          {year}년 {month}월
        </span>
        <Link href={`/severance?year=${next.y}&month=${next.m}`} className="btn-outline py-1 px-2.5">
          →
        </Link>
        <span className="text-xs text-slate-400 ml-2 leading-relaxed">
          그 달 급여에서 그때그때 산정합니다 — 급여를 정정하면 이 금액도 따라 바뀝니다.
        </span>
      </div>

      <SeveranceTable
        year={year}
        month={month}
        rows={rows}
        totals={totals}
        warnings={warnings}
      />

      <details className="mt-4 text-xs text-slate-400">
        <summary className="cursor-pointer hover:text-slate-600">퇴직급여 산정 규칙</summary>
        <div className="mt-2 leading-relaxed space-y-1.5">
          <p>
            · <b>DC형 퇴직연금</b> — 유쌤에듀는 근속 1년이 지나면 확정기여형(DC) 퇴직연금에
            가입합니다. 가입 후에는 회사가 매월 <b>부담금</b>을 근로자 계정에 납입합니다
            (근로자퇴직급여보장법 §20①).
          </p>
          <p>
            · <b>퇴직급여충당금</b> — 근속 1년 미만 구간은 아직 납입할 계정이 없어 회사가 적립만
            해 둡니다. <b>없어지는 돈이 아닙니다</b> — 계속근로가 1년을 넘기면 퇴직급여는{" "}
            <b>입사일부터 전체 기간</b>에 대해 지급 의무가 생기므로(§8①), 이 충당금 누계가 DC
            가입 시 <b>소급 납입할 몫</b>이 됩니다.
          </p>
          <p>
            · <b>대상 제외</b> — ① 위탁계약(프리랜서)은 근로자가 아니라 퇴직급여제도가 적용되지
            않습니다 ② 4주 평균 1주 소정근로시간이 <b>15시간 미만</b>인 초단시간근로자는 법정
            적용 제외입니다(§4① 단서).
          </p>
          <p>
            · <b>근로시간표가 없으면 &lsquo;판정 보류&rsquo;</b> — 주 소정근로시간을 모르면
            초단시간인지 가릴 수 없습니다. 0시간으로 읽어 조용히 빼면 퇴직급여를 통째로 안 쌓게
            되므로 제외하지 않고 보류로 두고 경고합니다.
          </p>
          <p>
            · <b>산정기준 임금 = 계약서에 합의된 월 급여총액</b> — 기본급·주휴수당·직책수당·
            식대·차량유지비·연차미사용수당에 더해 <b>포괄임금 약정 시간외·야간</b>(계약서 제4조의
            고정분)까지 들어갑니다. <b>상여·인센티브·그 달 발생한 오버타임은 빠집니다</b>(산정
            조건에서 변경 가능). 월 적립액 = 산정기준 임금 ÷ 12, 원 단위 반올림(10원 절사하지
            않습니다 — 근로자 몫이라 깎지 않습니다).
          </p>
          <p>
            · <b>오버타임은 두 갈래</b> — 계약서에 이미 들어 있는 <b>약정분</b>(매달 같은 금액,
            산입)과 그 달 보강·초과근로로 새로 생긴 <b>변동분</b>(달마다 다름, 제외). 급여
            레코드에는 한 칸에 섞여 있어, 그 달 입력·확정된 시간에서 변동분을 다시 세워
            가릅니다 — <b>세무사무소 제출자료의 &lsquo;오버타임수당&rsquo; 열과 같은 판정</b>이라
            두 문서가 어긋나지 않습니다.
          </p>
          <p>
            · <b>인센티브를 뺀 이유</b> — 인센티브에 대한 퇴직급여분은 이미{" "}
            <b>퇴직유보금</b>(인센티브 원천액의 1/12)으로 별도 통장에 적립하고 있습니다(확인서
            제6조). 여기서 또 넣으면 이중 적립이 됩니다. 표의 &lsquo;인센티브 유보금&rsquo; 열이
            그 금액입니다.
          </p>
          <p className="text-amber-600">
            · ⚠ <b>법정 하한</b> — §20① 의 하한은 &lsquo;연간 <b>임금총액</b>의 1/12&rsquo;
            이고, 그 달 발생한 연장·야간·휴일수당도 근로의 대가인 임금에 들어갑니다. 이 변동분을
            빼는 현재 기준으로는 하한에 미달할 수 있으니 노무 자문으로 확인해 주세요.
            산입하려면 <b>산정 조건</b>에서 켜면 됩니다(그 수당이 실제로 발생한 달에만 경고가
            뜹니다).
          </p>
        </div>
      </details>
    </div>
  );
}
