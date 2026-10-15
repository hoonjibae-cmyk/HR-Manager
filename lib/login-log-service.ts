// 로그인 기록 조회 — AuditLog(LOGIN / LOGIN_FAILED / LOGOUT) 를 읽어 설정 화면에 낸다.
// 판정·표기는 lib/login-log.ts(순수 함수)에 있다.

import { prisma } from "./db";
import {
  LOGIN_ACTIONS,
  toLoginRow,
  summarizeLogins,
  type LoginLogRow,
  type LoginStats,
} from "./login-log";

export interface RecentLoginLog {
  rows: LoginLogRow[];
  /** 최근 `statsDays` 일 요약 — 표는 건수로 끊지만 요약은 기간으로 끊는다 */
  stats: LoginStats;
  statsDays: number;
  take: number;
}

export async function recentLoginLog(
  opts: { take?: number; statsDays?: number } = {}
): Promise<RecentLoginLog> {
  const take = opts.take ?? 50;
  const statsDays = opts.statsDays ?? 30;
  const since = new Date(Date.now() - statsDays * 86400000);
  const actions = { in: [...LOGIN_ACTIONS] };

  const [recent, window] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: actions },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.auditLog.findMany({
      where: { action: actions, createdAt: { gte: since } },
      select: { action: true, actorName: true, employeeId: true },
    }),
  ]);

  // 이름·사번·부서는 **지금 원장**에서 읽는다 — 기록 당시 이름이 바뀌었어도 지금 누구인지가 궁금하다.
  // 삭제된 직원(입사 취소)은 기록에 적힌 이름으로 남는다.
  const ids = [...new Set(recent.map((r) => r.employeeId).filter((x): x is number => x != null))];
  const employees = ids.length
    ? await prisma.employee.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, empNo: true, department: true },
      })
    : [];
  const byId = new Map(employees.map((e) => [e.id, e]));

  return {
    rows: recent
      .map((r) => toLoginRow(r, r.employeeId != null ? (byId.get(r.employeeId) ?? null) : null))
      .filter((r): r is LoginLogRow => r !== null),
    stats: summarizeLogins(window),
    statsDays,
    take,
  };
}
