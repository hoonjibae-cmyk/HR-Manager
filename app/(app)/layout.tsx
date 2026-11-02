import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Sidebar from "@/components/Sidebar";
import SessionGuard from "@/components/SessionGuard";
import { versionLabel, COMMIT_SHA } from "@/lib/version";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAuthed())) redirect("/login");
  const company = await prisma.company.findFirst({ where: { id: 1 } }).catch(() => null);
  return (
    // 좁은 화면에서는 메뉴가 위쪽 막대로 접히므로(components/Sidebar.tsx) 세로로 쌓고,
    // lg 부터 예전처럼 좌우로 놓는다.
    <div className="flex flex-col lg:flex-row min-h-screen">
      {/* 로그인 만료(401) 안내 — 이미 그려진 화면에서 버튼만 실패할 때 무엇을 해야 하는지 알려 준다 */}
      <SessionGuard />
      <Sidebar
        logo={(company as any)?.logo ?? null}
        companyName={company?.name}
        version={versionLabel()}
        commit={COMMIT_SHA}
      />
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-[1400px]">{children}</main>
    </div>
  );
}
