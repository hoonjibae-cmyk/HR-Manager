/**
 * 계약 이력의 날짜 빈틈·중복 경고.
 * 급여·계약서는 '그 시점을 지배하는 계약' 을 읽으므로, 덮이지 않은 기간이 있으면
 * 그 기간의 급여 산정 근거가 없어진다.
 */
export default function ContractIssueNotice({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div className="card p-4 border border-amber-200 bg-amber-50">
      <p className="font-bold text-amber-800 text-sm">계약 기간에 빈틈이 있습니다</p>
      <ul className="mt-2 space-y-0.5 text-xs text-amber-900">
        {messages.map((m, i) => (
          <li key={i}>· {m}</li>
        ))}
      </ul>
      <p className="text-[11px] text-amber-700 mt-2">
        급여 산정과 계약서 발급은 해당 시점의 계약을 기준으로 합니다. 아래 <b>계약 이력</b>에서
        빈 기간을 덮는 계약을 만들거나, 기존 계약의 기간을 고쳐 주세요.
      </p>
    </div>
  );
}
