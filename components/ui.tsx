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
