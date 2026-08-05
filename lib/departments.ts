// 부서 + 부서별 입사 서류 정책
//
// 부서를 코드 상수가 아니라 데이터로 두는 이유는 **부서마다 받아야 할 서류가 다르기 때문**이다.
// 상수로 두면 부서가 하나 늘 때마다 배포해야 하고, 새 부서에 어떤 서류가 나가야 하는지
// 아무도 정하지 않은 채로 남는다. 그래서 부서를 추가할 때 서류 정책을 함께 묻는다(설정 화면).

import { prisma } from "./db";

/** 부서가 정하는 서류 정책 — 설정 화면에서 부서를 만들 때 묻는 항목이 이 넷이다 */
export interface DeptDocPolicy {
  /** 복무서약서-II (강의 운영 관련 조항) */
  docPledgeServiceII: boolean;
  /** 프로필 홍보 동의서 (학력·경력·사진의 홍보 활용) */
  docPromotion: boolean;
  /** 건강서약서 */
  docHealth: boolean;
  /** 보안서약서의 경업금지 조항 (퇴사 후 6개월·반경 2km) */
  docNonCompete: boolean;
}

export interface DeptRow extends DeptDocPolicy {
  id: number;
  name: string;
  sortOrder: number;
  active: boolean;
}

/** 설정 화면이 부서를 만들 때 물어볼 항목 — 라벨과 설명을 한곳에 둔다 */
export const DEPT_DOC_FIELDS: Array<{
  key: keyof DeptDocPolicy;
  label: string;
  hint: string;
}> = [
  {
    key: "docPledgeServiceII",
    label: "복무서약서-II",
    hint: "강의 시간표·반 배정·교재 선정 등 강의 운영에 관한 서약. 강의를 맡는 부서만.",
  },
  {
    key: "docPromotion",
    label: "프로필 홍보 동의서",
    hint: "출신학교·경력·프로필 사진을 학원 홍보에 쓰는 것에 대한 동의. 홍보에 얼굴이 나가는 부서만.",
  },
  {
    key: "docHealth",
    label: "건강서약서",
    hint: "채용 시 건강상태 고지와 이후 건강관리에 관한 서약.",
  },
  {
    key: "docNonCompete",
    label: "보안서약서 — 경업금지 조항",
    hint:
      "퇴사 후 6개월간 반경 2km 내 취업·운영 금지, 원생·강사 유인 금지 조항을 넣을지. " +
      "보안서약서 자체는 전 직원이 쓰고 이 조항만 부서에 따라 붙였다 뗀다.",
  },
];

/**
 * 처음 실행 때 넣어 두는 부서 — 지금까지 코드 상수로 쓰던 넷을 그대로 옮긴 것이다.
 * 서류 정책은 실제로 받아 온 서류(교수부 박○○ 님 입사 서류철) 기준.
 */
const SEED: Array<Omit<DeptRow, "id">> = [
  {
    name: "교수부",
    sortOrder: 10,
    active: true,
    docPledgeServiceII: true,
    docPromotion: true,
    docHealth: true,
    docNonCompete: true,
  },
  // 조교팀은 건강서약서에서 빠진다 (대부분 단기·학생 조교라 건강 고지를 받지 않아 왔다)
  {
    name: "조교팀",
    sortOrder: 20,
    active: true,
    docPledgeServiceII: false,
    docPromotion: false,
    docHealth: false,
    docNonCompete: false,
  },
  {
    name: "교육운영팀",
    sortOrder: 30,
    active: true,
    docPledgeServiceII: false,
    docPromotion: false,
    docHealth: true,
    docNonCompete: false,
  },
  {
    name: "경영지원",
    sortOrder: 40,
    active: true,
    docPledgeServiceII: false,
    docPromotion: false,
    docHealth: true,
    docNonCompete: false,
  },
];

/**
 * 부서 목록. **비어 있으면 기본 넷을 한 번 넣고 돌려준다** —
 * 기존 배포에는 Department 표가 없으므로, 설정 화면에 들어가기 전에 급여·직원 화면이
 * 먼저 열려도 부서가 없어 아무것도 못 하는 상태가 되지 않게 한다.
 */
export async function listDepartments(opts: { activeOnly?: boolean } = {}): Promise<DeptRow[]> {
  const where = opts.activeOnly ? { active: true } : {};
  let rows = await prisma.department.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  if (!rows.length && !(await prisma.department.count())) {
    await prisma.department.createMany({ data: SEED, skipDuplicates: true });
    rows = await prisma.department.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
  }
  return rows as DeptRow[];
}

/**
 * 직원의 부서에 맞는 서류 정책.
 * **부서가 없거나 표에 없는 이름이면 null** — 부르는 쪽이 발급을 막고 사람에게 물어야 한다.
 * 여기서 기본값을 지어내면 조교에게 강사용 서약서가 나가거나 그 반대가 된다.
 */
export async function docPolicyFor(department: string | null | undefined): Promise<DeptRow | null> {
  const name = (department ?? "").trim();
  if (!name) return null;
  const rows = await listDepartments();
  return rows.find((d) => d.name === name) ?? null;
}

/** 서류 발급 전 점검 — 막아야 하면 사유를 돌려준다 */
export async function documentBlockReason(
  employee: { name: string; department?: string | null }
): Promise<string | null> {
  const name = (employee.department ?? "").trim();
  if (!name)
    return (
      `${employee.name} 님의 부서가 비어 있습니다. ` +
      `부서에 따라 받아야 할 서류가 달라(복무서약서-II·프로필 홍보 동의서·건강서약서 등) ` +
      `부서를 먼저 입력해야 발급할 수 있습니다.`
    );
  const policy = await docPolicyFor(name);
  if (!policy)
    return (
      `'${name}' 은(는) 등록되지 않은 부서입니다. ` +
      `설정 → 부서 관리에서 이 부서를 추가하고 서류 정책을 정한 뒤 발급하세요.`
    );
  return null;
}
