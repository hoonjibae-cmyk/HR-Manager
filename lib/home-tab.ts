// 슬랙 앱 홈 탭 구성 — 이벤트 수신(app_home_opened)과 버튼 처리에서 함께 쓴다.
import { prisma } from "./db";
import { findEmployeeBySlack, autoLinkEmployeeBySlack, homeTabView, publishHomeView } from "./slack";
import { leaveBalanceOf, leaveBalanceText, rangeLabel, RATIO_LEAVE_NOTICE } from "./leave-slack";
import { LEAVE_TYPE_LABEL, LEAVE_STATUS_LABEL, isContractorContract } from "./constants";
import { upcomingMakeups } from "./makeup-slack";

/** 오늘(KST) 이후로 예정된 신청·승인 건 */
async function upcomingLeaves(employeeId: number) {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate())
  );
  const rows = await prisma.leaveRequest.findMany({
    where: { employeeId, endDate: { gte: today }, status: { in: ["PENDING", "APPROVED", "CANCEL_PENDING"] } },
    orderBy: { startDate: "asc" },
    take: 10,
  });
  return rows.map((r) => ({
    label: `${rangeLabel(r.startDate, r.endDate, r.days)} · ${
      LEAVE_TYPE_LABEL[r.leaveType] ?? "연차"
    } ${r.days}일`,
    status:
      r.status === "CANCEL_PENDING"
        ? "취소 승인대기"
        : LEAVE_STATUS_LABEL[r.status] ?? r.status,
  }));
}

/** 앱 홈 탭을 해당 사용자 기준으로 다시 그린다 */
export async function refreshHomeTab(slackUserId: string) {
  const company = await prisma.company.findFirst({ where: { id: 1 } });
  const companyName = company?.name ?? "유쌤에듀";

  let emp = await findEmployeeBySlack(slackUserId);
  if (!emp) emp = (await autoLinkEmployeeBySlack(slackUserId)).emp;

  if (!emp) {
    return publishHomeView(
      slackUserId,
      homeTabView({
        companyName,
        notice:
          "등록된 직원 정보를 찾을 수 없습니다.\n관리자에게 *직원 관리 → 슬랙 계정 일괄 연결* 실행을 요청해 주세요.",
      })
    );
  }
  // 위탁계약(프리랜서·완전비율제)은 연차가 없지만 보강계획은 등록한다 — 연차 자리에만 안내를 넣는다
  if (isContractorContract(emp)) {
    return publishHomeView(
      slackUserId,
      homeTabView({
        companyName,
        notice: RATIO_LEAVE_NOTICE,
        makeups: await upcomingMakeups(emp.id),
      })
    );
  }

  const { summary, comp, eligibility, txns } = await leaveBalanceOf(emp);
  const [upcoming, makeups] = await Promise.all([upcomingLeaves(emp.id), upcomingMakeups(emp.id)]);
  return publishHomeView(
    slackUserId,
    homeTabView({
      companyName,
      balanceText: leaveBalanceText(emp.name, summary, comp, eligibility, txns),
      upcoming,
      makeups,
    })
  );
}
