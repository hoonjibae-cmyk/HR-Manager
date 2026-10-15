import Link from "next/link";
import { Pill, Empty } from "@/components/ui";
import {
  LOGIN_ACTION_LABEL,
  denialText,
  kstLabel,
  type LoginLogRow,
  type LoginStats,
} from "@/lib/login-log";

const PILL_KIND: Record<LoginLogRow["action"], string> = {
  LOGIN: "APPROVED",
  LOGIN_FAILED: "REJECTED",
  LOGOUT: "DRAFT",
};

/**
 * 설정 → 최근 로그인. 어떤 계정이 언제 어디서 들어왔는지(거부·로그아웃 포함).
 * 서버 컴포넌트가 데이터를 넘기고 여기서는 그리기만 한다 — 상호작용이 없다.
 */
export default function LoginLogPanel({
  rows,
  stats,
  statsDays,
  take,
}: {
  rows: LoginLogRow[];
  stats: LoginStats;
  statsDays: number;
  take: number;
}) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <h2 className="font-bold text-slate-800">최근 로그인</h2>
        <Link href="/activity?filter=login" className="text-xs text-brand-600 font-semibold whitespace-nowrap">
          작업 이력에서 전체 보기 →
        </Link>
      </div>
      <p className="text-xs text-slate-500 mb-3 break-keep">
        어떤 계정이 언제 어디서 들어왔는지 — 포털(Slack 신원) 로그인 · 거부 · 로그아웃.
        <span className="ml-1 tnum">
          최근 {statsDays}일: 로그인 <b>{stats.logins}</b>회 · 계정 <b>{stats.accounts}</b>개 · 거부{" "}
          <b className={stats.denied ? "text-rose-600" : ""}>{stats.denied}</b>회
        </span>
      </p>

      {rows.length === 0 ? (
        <Empty>아직 로그인 기록이 없습니다.</Empty>
      ) : (
        <div className="overflow-auto max-h-[28rem] -mx-5 px-5">
          <table className="w-full text-xs">
            <thead className="sticky-head">
              {/* 결과 배지는 계정 칸에 함께 둔다 — 휴대폰에서는 처음 두 칸만 보이는데,
                  누가·언제·되었나 가 한 화면에 있어야 한다(사유는 옆으로 밀어서 본다) */}
              <tr>
                <th className="th">일시 (KST)</th>
                <th className="th">계정 · 결과</th>
                <th className="th">거부 사유</th>
                <th className="th">접속지 (IP)</th>
                <th className="th">기기</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.action === "LOGIN_FAILED" ? "bg-rose-50/40" : "hover:bg-slate-50"}>
                  <td className="td tnum whitespace-nowrap text-slate-500">{kstLabel(r.at)}</td>
                  <td className="td whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{r.name ?? "(알 수 없음)"}</span>
                      <Pill kind={PILL_KIND[r.action]}>{LOGIN_ACTION_LABEL[r.action]}</Pill>
                      {!r.verified && (
                        <span
                          className="pill bg-amber-50 text-amber-700"
                          title="포털 서명이 확인되지 않아 토큰에 적힌 이름일 뿐입니다. 그 사람이 시도했다고 단정할 수 없습니다."
                        >
                          미검증
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400">
                      {[r.empNo, r.department].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="td text-slate-500 break-keep min-w-[14rem]">
                    {r.reason ? denialText(r.reason, r.failedChecks, { expired: r.expired }) : ""}
                  </td>
                  <td className="td tnum whitespace-nowrap text-slate-500">{r.ip ?? "—"}</td>
                  <td className="td whitespace-nowrap text-slate-500" title={r.ua ?? undefined}>
                    {r.device ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-3 leading-relaxed break-keep">
        · 최근 {take}건까지 표시합니다. 비밀번호 로그인은 없고 포털을 거친 로그인만 기록됩니다.
        &nbsp;· 거부 중 「미검증」은 서명이 맞지 않아 토큰에 적힌 이름일 뿐입니다 — 대개 포털에서 HR 카드를
        누른 뒤 1분이 지나 생기며, 다시 누르면 됩니다.
        &nbsp;· 이 기록은 개인정보 안전성 확보조치 기준 §8의 접속기록이라 지우지 않습니다
        (주민등록번호를 다루는 시스템은 2년 이상 보관 · 월 1회 이상 점검).
      </p>
    </div>
  );
}
