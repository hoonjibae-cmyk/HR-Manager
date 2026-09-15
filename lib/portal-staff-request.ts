import { prisma } from "./db";
import {
  matchesActivePortalEmployee,
  type PortalStaffClaims,
  type PortalStaffScope,
  verifyPortalStaffToken,
} from "./portal-staff";

function portalOrigin() {
  return new URL(process.env.PORTAL_ORIGIN || "https://portal.yussam.com").origin;
}

export async function authenticatedPortalStaff(
  req: Request,
  scope: PortalStaffScope,
) {
  const secret = process.env.HR_SSO_SECRET?.trim();
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!secret || secret.length < 32 || !token) return null;

  const claims = verifyPortalStaffToken(token, secret, {
    portalOrigin: portalOrigin(),
    hrOrigin: new URL(req.url).origin,
    scope,
  });
  if (!claims) return null;

  const employee = await prisma.employee.findUnique({
    where: { empNo: claims.empNo },
  });
  if (!employee) return null;
  if (!matchesActivePortalEmployee(claims, employee)) return null;
  return { claims: claims as PortalStaffClaims, employee };
}
