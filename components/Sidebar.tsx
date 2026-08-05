"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { versionLabel } from "@/lib/version";

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

export default function Sidebar({ logo, companyName }: { logo?: string | null; companyName?: string }) {
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
        <div className="px-3 pt-2 text-[10px] text-slate-300">
          주식회사 유쌤에듀 · {versionLabel()}
        </div>
      </div>
    </aside>
  );
}
