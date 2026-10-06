"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/dashboard", label: "대시보드", icon: "▣" },
  { href: "/employees", label: "직원 관리", icon: "👤" },
  { href: "/payroll", label: "급여 산정", icon: "₩" },
  { href: "/makeup", label: "보강 · 오버타임", icon: "📚" },
  { href: "/leave", label: "연차 관리", icon: "📅" },
  { href: "/vacation", label: "방학 근무·연차", icon: "🗓" },
  { href: "/severance", label: "퇴직급여", icon: "🏦" },
  { href: "/documents", label: "문서 발급", icon: "📄" },
  { href: "/activity", label: "작업 이력", icon: "🕘" },
  { href: "/settings", label: "설정", icon: "⚙" },
];

interface Props {
  logo?: string | null;
  companyName?: string;
  /** 서버에서 구한 `versionLabel()` — 클라이언트에서 부르면 하이드레이션이 어긋난다(lib/version.ts) */
  version: string;
  commit?: string | null;
}

/**
 * 좌측 메뉴 — **화면 폭에 따라 모양이 갈린다.**
 *  · lg 이상: 늘 펼쳐진 240px 세로 메뉴(예전 그대로).
 *  · lg 미만(휴대폰·세로 태블릿): 메뉴를 **위쪽 막대 + ≡ 서랍**으로 접는다.
 *    고정 폭 메뉴가 그대로 남으면 본문이 60px 남짓으로 쪼그라들어 통계 카드 글자가
 *    한 글자씩 세로로 내려앉았다(실제 겪음 — 휴대폰에서 대시보드가 안 읽혔다).
 * 서랍은 페이지가 바뀌면 닫는다 — 안 닫으면 메뉴를 누른 뒤에도 서랍이 본문을 덮고 있다.
 */
export default function Sidebar({ logo, companyName, version, commit }: Props) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  // 서랍이 열려 있는 동안 뒤 본문이 함께 스크롤되지 않게 한다
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const title = logo ? "HR 관리" : "유쌤에듀 HR";

  const brand = (
    <div className="px-5 py-5 border-b border-slate-100">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={companyName ?? "유쌤에듀"} className="h-9 w-auto max-w-[180px] object-contain mb-2" />
      ) : null}
      <div className="text-lg font-extrabold text-brand-700">{title}</div>
      <div className="text-xs text-slate-400 mt-0.5">인사·급여·연차 관리</div>
    </div>
  );

  const nav = (
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
      {NAV.map((n) => {
        const active = path === n.href || path.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="w-5 text-center text-base">{n.icon}</span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  const foot = (
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
  );

  const current = NAV.find((n) => path === n.href || path.startsWith(n.href + "/"));

  return (
    <>
      {/* ── 넓은 화면: 늘 펼쳐진 세로 메뉴 ── */}
      <aside className="hidden lg:flex w-60 shrink-0 bg-white border-r border-slate-200 flex-col">
        {brand}
        {nav}
        {foot}
      </aside>

      {/* ── 좁은 화면: 위쪽 막대 ── */}
      <header className="lg:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-3 bg-white border-b border-slate-200">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="메뉴 열기"
          aria-expanded={open}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900 truncate">
            {current ? current.label : title}
          </div>
          <div className="text-[11px] text-slate-400 truncate">{companyName ?? "주식회사 유쌤에듀"}</div>
        </div>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-7 w-auto max-w-[96px] object-contain" />
        ) : null}
      </header>

      {/* ── 좁은 화면: 서랍 ── */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-900/40"
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col">
            <div className="flex items-start justify-between pr-2">
              <div className="flex-1">{brand}</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="메뉴 닫기"
                className="mt-3 inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {nav}
            {foot}
          </aside>
        </div>
      )}
    </>
  );
}
