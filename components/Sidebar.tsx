"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "대시보드", icon: "▣" },
  { href: "/employees", label: "직원 관리", icon: "👤" },
  { href: "/payroll", label: "급여 산정", icon: "₩" },
  { href: "/leave", label: "연차 관리", icon: "📅" },
  { href: "/makeup", label: "보강 · 오버타임", icon: "📚" },
  { href: "/severance", label: "퇴직급여", icon: "🏦" },
  { href: "/documents", label: "문서 발급", icon: "📄" },
  { href: "/activity", label: "작업 이력", icon: "🕘" },
  { href: "/settings", label: "설정", icon: "⚙" },
];

export default function Sidebar({
  logo,
  companyName,
  version,
  commit,
}: {
  logo?: string | null;
  companyName?: string;
  /** 서버에서 구한 `versionLabel()` — 클라이언트에서 부르면 하이드레이션이 어긋난다(lib/version.ts) */
  version: string;
  commit?: string | null;
}) {
  const path = usePathname();
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col">
      <div className="px-5 py-5 border-b border-slate-100">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={companyName ?? "유쌤에듀"} className="h-9 w-auto max-w-[180px] object-contain mb-2" />
        ) : null}
        <div className="text-lg font-extrabold text-brand-700">
          {logo ? "HR 관리" : "유쌤에듀 HR"}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">인사·급여·연차 관리</div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map((n) => {
          const active = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="w-5 text-center text-base">{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-slate-100">
        <form action="/api/auth/logout" method="post">
          <button className="w-full text-left text-xs text-slate-400 hover:text-slate-600 px-3 py-2">
            로그아웃 →
          </button>
        </form>
        {/* 배포 버전 — **읽히게** 둔다. 예전엔 10px slate-300 이라 사실상 안 보여서
            "고쳐 올렸는데 화면이 그대로다" 일 때 정작 확인할 수가 없었다.
            커밋 해시는 툴팁으로 전부 보여 준다(같은 버전으로 여러 번 배포할 수 있다). */}
        <div className="px-3 pt-2 space-y-0.5">
          <div className="text-[10px] text-slate-400">{companyName ?? "주식회사 유쌤에듀"}</div>
          <div
            className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 tnum"
            title={commit ? `배포 커밋 ${commit}` : "로컬 실행 (배포 커밋 정보 없음)"}
          >
            {version}
          </div>
        </div>
      </div>
    </aside>
  );
}
