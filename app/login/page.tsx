import { prisma } from "@/lib/db";
import LoginForm from "./LoginForm";
import { versionLabel, COMMIT_SHA } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const company = await prisma.company.findFirst({ where: { id: 1 } }).catch(() => null);
  const portalUrl = new URL(
    "/go/hr",
    process.env.PORTAL_ORIGIN || "https://portal.yussam.com",
  ).href;
  return (
    <LoginForm
      logo={(company as any)?.logo ?? null}
      version={versionLabel()}
      commit={COMMIT_SHA}
      portalUrl={portalUrl}
      accessDenied={searchParams.error === "access_denied"}
    />
  );
}
