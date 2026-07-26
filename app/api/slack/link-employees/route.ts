import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { slackConfigured, slackUserList } from "@/lib/slack";
import { matchEmployee } from "@/lib/timesheet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 슬랙 워크스페이스 사용자 ↔ 직원 카드 일괄 연결.
 * 1) 이메일 일치 (대소문자 무시)
 * 2) 이름 일치 (슬랙 표시명의 '_부원장', '조교' 등 직책어 제거 후 비교)
 * 매칭되지 않은 직원/슬랙 사용자를 함께 돌려주어 수동 보정이 가능하도록 한다.
 */
export async function POST() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!slackConfigured())
    return NextResponse.json({ error: "슬랙이 설정되지 않았습니다." }, { status: 400 });

  const users = await slackUserList();
  if (!users.length)
    return NextResponse.json(
      { error: "슬랙 사용자 목록을 불러오지 못했습니다. users:read 권한을 확인하세요." },
      { status: 400 }
    );

  const employees = await prisma.employee.findMany();
  const linkedIds = new Set(employees.map((e) => e.slackUserId).filter(Boolean) as string[]);

  const linked: Array<{ name: string; via: string; slackName: string }> = [];
  const takenEmpIds = new Set<number>();

  // 1차: 이메일 매칭
  for (const u of users) {
    if (linkedIds.has(u.id) || !u.email) continue;
    const emp = employees.find(
      (e) =>
        !e.slackUserId &&
        !takenEmpIds.has(e.id) &&
        e.email &&
        e.email.toLowerCase() === u.email!.toLowerCase()
    );
    if (emp) {
      await prisma.employee.update({ where: { id: emp.id }, data: { slackUserId: u.id } });
      takenEmpIds.add(emp.id);
      linkedIds.add(u.id);
      linked.push({ name: emp.name, via: "이메일", slackName: u.realName || u.displayName });
    }
  }

  // 2차: 이름 매칭 (직책 접미사 제거)
  for (const u of users) {
    if (linkedIds.has(u.id)) continue;
    const pool = employees.filter((e) => !e.slackUserId && !takenEmpIds.has(e.id));
    if (!pool.length) break;
    const nameCandidates = [u.realName, u.displayName].filter(Boolean) as string[];
    for (const raw of nameCandidates) {
      const m = matchEmployee(raw, pool);
      if (m.emp) {
        await prisma.employee.update({ where: { id: m.emp.id }, data: { slackUserId: u.id } });
        takenEmpIds.add(m.emp.id);
        linkedIds.add(u.id);
        linked.push({ name: m.emp.name, via: "이름", slackName: raw });
        break;
      }
    }
  }

  const after = await prisma.employee.findMany({ orderBy: { empNo: "asc" } });
  const stillUnlinked = after.filter((e) => e.active && !e.slackUserId).map((e) => e.name);
  const unmatchedSlack = users
    .filter((u) => !after.some((e) => e.slackUserId === u.id))
    .map((u) => u.realName || u.displayName || u.id);

  return NextResponse.json({
    ok: true,
    slackUsers: users.length,
    emailVisible: users.some((u) => !!u.email),
    linkedCount: linked.length,
    linked,
    alreadyLinked: after.filter((e) => !!e.slackUserId).length - linked.length,
    stillUnlinked,
    unmatchedSlack,
  });
}
