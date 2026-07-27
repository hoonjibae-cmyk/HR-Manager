import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAuthed())) redirect("/login");
  const company = await prisma.company.findFirst({ where: { id: 1 } }).catch(() => null);
  return (
    <div className="flex min-h-screen">
      <Sidebar logo={(company as any)?.logo ?? null} companyName={company?.name} />
      <main className="flex-1 min-w-0 p-6 lg:p-8 max-w-[1400px]">{children}</main>
    </div>
  );
}
