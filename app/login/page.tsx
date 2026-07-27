import { prisma } from "@/lib/db";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // 로그인 화면에도 로고를 보여 준다 — 직원이 처음 만나는 화면이라 여기부터 학원 것으로 보여야 한다
  const company = await prisma.company.findFirst({ where: { id: 1 } }).catch(() => null);
  return <LoginForm logo={(company as any)?.logo ?? null} />;
}
