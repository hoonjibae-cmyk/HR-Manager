// 직원 단위 연차 신청 잠금 — 일반 연차 신청(submitLeaveRequest)과 방학 근무·연차 제출이
// 같은 직원에 대해 동시에 돌 때, 중복 확인·잔여 판정·생성이 한 줄로 서게 한다.
//
// Postgres advisory lock 을 **트랜잭션 범위**로 건다(pg_advisory_xact_lock) — 커밋·롤백 때
// 저절로 풀리므로 pgbouncer 트랜잭션 풀링에서도 새지 않는다. 행을 잠그는 것이 아니라
// '이 직원의 연차 신청' 이라는 이름에 줄을 세우는 것이라 아직 없는 행(새 신청)도 막아 준다.
import { prisma } from "./db";

/** 잠금 이름 공간 — 다른 advisory lock 과 겹치지 않게 앞 키를 고정한다 */
const LEAVE_LOCK_NS = 71_010;

export async function withEmployeeLeaveLock<T>(employeeId: number, fn: (tx: any) => Promise<T>): Promise<T> {
  return (prisma as any).$transaction(
    async (tx: any) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(${LEAVE_LOCK_NS}::int, ${employeeId}::int)`;
      return fn(tx);
    },
    { timeout: 20_000, maxWait: 10_000 }
  );
}
