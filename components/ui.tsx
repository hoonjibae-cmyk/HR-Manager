import Link from "next/link";
import React from "react";

export function PageHeader({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {desc && <p className="text-sm text-slate-500 mt-1">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  href,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  href?: string;
  accent?: string;
}) {
  const inner = (
    <div className="card p-5 h-full hover:shadow-md transition">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={`stat-num mt-2 ${accent ?? ""}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

const PILL_COLORS: Record<string, string> = {
  EMPLOYEE: "bg-emerald-50 text-emerald-700",
  FREELANCE: "bg-amber-50 text-amber-700",
  MONTHLY: "bg-blue-50 text-blue-700",
  HOURLY: "bg-violet-50 text-violet-700",
  INCENTIVE: "bg-pink-50 text-pink-700",
  RATIO: "bg-orange-50 text-orange-700",
  PENDING: "bg-amber-50 text-amber-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
  CANCELED: "bg-slate-100 text-slate-500",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  DRAFT: "bg-slate-100 text-slate-600",
  CONFIRMED: "bg-blue-50 text-blue-700",
  SENT: "bg-emerald-50 text-emerald-700",
};

export function Pill({ kind, children }: { kind?: string; children: React.ReactNode }) {
  return (
    <span className={`pill ${PILL_COLORS[kind ?? ""] ?? "bg-slate-100 text-slate-600"}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center text-sm text-slate-400 py-12">{children}</div>
  );
}

/* ───────────── 달력 '오늘' 칸 ───────────── */
//
// ⚠ **이 문자열들은 반드시 `components/` 안에 있어야 한다.** Tailwind 의 `content` 는
// `app/**` 과 `components/**` 만 훑으므로(tailwind.config.ts), `lib/` 에 적으면 클래스가
// 아예 생성되지 않아 **조용히 아무 효과도 나지 않는다**(겪었다 — 칸 배경·테두리가 통째로 빠졌다).

/** 오늘 칸 — 테두리를 **안쪽**으로 둘러 칸 크기가 밀리지 않게 한다(바깥 ring 은 격자를 흔든다) */
export const TODAY_CELL = "bg-brand-50 ring-2 ring-inset ring-brand-500";

/** 오늘 날짜 숫자 — 채운 동그라미 */
export const TODAY_NUM =
  "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-brand-600 text-white";
