import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

// 엑셀에서 추출한 조직/급여 구조 (개인정보 제외)
interface RawEmp {
  row: number;
  department: string;
  duty: string;
  position: string;
  incomeTypeRaw: string;
  paySchemeRaw: string;
  baseWage: number | null;
  positionAllow: number;
  carAllow: number;
  workDays: number;
  schedule: any[];
}

// 가명 + 입사일(근속연차 다양화) + 이메일. 엑셀 row 순서와 매칭.
const PROFILE: {
  name: string;
  hire: string;
  email: string;
  dependents: number;
}[] = [
  { name: "김서준", hire: "2019-03-04", email: "seojun.kim@yoossam.example", dependents: 3 },
  { name: "이지우", hire: "2020-09-01", email: "jiwoo.lee@yoossam.example", dependents: 1 },
  { name: "박도윤", hire: "2021-03-02", email: "doyoon.park@yoossam.example", dependents: 2 },
  { name: "최하은", hire: "2022-03-01", email: "haeun.choi@yoossam.example", dependents: 1 },
  { name: "정시우", hire: "2023-03-06", email: "siwoo.jung@yoossam.example", dependents: 1 },
  { name: "강민서", hire: "2023-09-04", email: "minseo.kang@yoossam.example", dependents: 2 },
  { name: "조유나", hire: "2024-03-04", email: "yuna.cho@yoossam.example", dependents: 1 },
  { name: "윤예준", hire: "2024-05-13", email: "yejun.yoon@yoossam.example", dependents: 1 },
  { name: "장하윤", hire: "2020-03-02", email: "hayoon.jang@yoossam.example", dependents: 4 },
  { name: "임서윤", hire: "2021-07-01", email: "seoyoon.lim@yoossam.example", dependents: 2 },
  { name: "한지호", hire: "2025-01-06", email: "jiho.han@yoossam.example", dependents: 1 },
  { name: "오은우", hire: "2022-11-01", email: "eunwoo.oh@yoossam.example", dependents: 1 },
  { name: "서지안", hire: "2025-05-16", email: "jian.seo@yoossam.example", dependents: 1 },
  { name: "신아린", hire: "2024-01-23", email: "arin.shin@yoossam.example", dependents: 1 },
  { name: "권도현", hire: "2025-02-26", email: "dohyun.kwon@yoossam.example", dependents: 1 },
  { name: "황시윤", hire: "2023-11-14", email: "siyoon.hwang@yoossam.example", dependents: 1 },
  { name: "안하준", hire: "2026-02-27", email: "hajun.ahn@yoossam.example", dependents: 1 },
  { name: "송지율", hire: "2026-02-11", email: "jiyul.song@yoossam.example", dependents: 1 },
  { name: "전서진", hire: "2025-03-31", email: "seojin.jeon@yoossam.example", dependents: 1 },
  { name: "홍이서", hire: "2025-06-27", email: "iseo.hong@yoossam.example", dependents: 1 },
  { name: "고주원", hire: "2025-12-30", email: "juwon.ko@yoossam.example", dependents: 1 },
  { name: "문채원", hire: "2025-04-07", email: "chaewon.moon@yoossam.example", dependents: 1 },
];

function mapIncome(raw: string): "EMPLOYEE" | "FREELANCE" {
  return raw && raw.includes("정규") ? "EMPLOYEE" : "FREELANCE";
}
function mapScheme(raw: string): "MONTHLY" | "HOURLY" {
  return raw && raw.includes("시급") ? "HOURLY" : "MONTHLY";
}

function contractStageFor(hire: Date, now: Date): string {
  const years = (now.getTime() - hire.getTime()) / (365 * 24 * 3600 * 1000);
  if (years >= 2) return "REGULAR";
  if (years >= 1) return "RENEWAL_1";
  return "SHORT_TERM_1";
}

async function main() {
  console.log("🌱 시딩 시작...");

  // 1) 회사
  await prisma.company.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: "주식회사 유쌤에듀",
      ceo: "유은정",
      bizNo: "418-86-02289",
      phone: "031-794-3306",
      address: "경기도 하남시 미사강변대로 216 한강트윈프라자2 3층",
      payday: 7,
    },
  });

  // 2) 4대보험 요율 (2025)
  await prisma.insuranceRate.upsert({
    where: { year: 2025 },
    update: {},
    create: { year: 2025, isActive: true },
  });

  // 3) 간이세액표
  const taxCount = await prisma.taxBracket.count();
  if (taxCount === 0) {
    const raw: any[] = JSON.parse(
      readFileSync(join(__dirname, "data", "tax_table.json"), "utf-8")
    );
    const rows = raw
      .filter((b) => typeof b.lo === "number")
      .map((b) => ({
        loThousand: b.lo as number,
        hiThousand: typeof b.hi === "number" ? (b.hi as number) : null,
        taxByDependents: JSON.stringify(
          (b.tax as any[]).map((t) => (typeof t === "number" ? t : 0))
        ),
      }));
    await prisma.taxBracket.createMany({ data: rows });
    console.log(`  세액표 ${rows.length}개 구간 로드`);
  }

  // 4) 공휴일 (2025~2026 주요 공휴일)
  const holidays: [string, string][] = [
    ["2025-01-01", "신정"],
    ["2025-01-28", "설날연휴"],
    ["2025-01-29", "설날"],
    ["2025-01-30", "설날연휴"],
    ["2025-03-01", "삼일절"],
    ["2025-05-05", "어린이날"],
    ["2025-05-06", "부처님오신날(대체)"],
    ["2025-06-06", "현충일"],
    ["2025-08-15", "광복절"],
    ["2025-10-03", "개천절"],
    ["2025-10-06", "추석연휴"],
    ["2025-10-07", "추석"],
    ["2025-10-08", "추석연휴"],
    ["2025-10-09", "한글날"],
    ["2025-12-25", "성탄절"],
    ["2026-01-01", "신정"],
    ["2026-02-16", "설날연휴"],
    ["2026-02-17", "설날"],
    ["2026-02-18", "설날연휴"],
    ["2026-03-01", "삼일절"],
    ["2026-05-05", "어린이날"],
    ["2026-06-06", "현충일"],
    ["2026-08-15", "광복절"],
    ["2026-09-24", "추석연휴"],
    ["2026-09-25", "추석"],
    ["2026-10-03", "개천절"],
    ["2026-12-25", "성탄절"],
  ];
  for (const [d, name] of holidays) {
    const date = new Date(d + "T00:00:00Z");
    await prisma.holiday.upsert({
      where: { date },
      update: { name },
      create: { date, name },
    });
  }

  // 5) 직원 (기존 시드 있으면 스킵)
  const empCount = await prisma.employee.count();
  if (empCount > 0) {
    console.log("  직원 데이터가 이미 존재하여 스킵합니다.");
    console.log("✅ 시딩 완료");
    return;
  }

  const structure: RawEmp[] = JSON.parse(
    readFileSync(join(__dirname, "data", "employees_structure.json"), "utf-8")
  );
  const now = new Date();

  let idx = 0;
  for (const s of structure) {
    const p = PROFILE[idx] ?? {
      name: `직원${idx + 1}`,
      hire: "2024-03-01",
      email: "",
      dependents: 1,
    };
    const incomeType = mapIncome(s.incomeTypeRaw);
    const payScheme = mapScheme(s.paySchemeRaw);
    const hire = new Date(p.hire + "T00:00:00Z");
    const mealAllow = incomeType === "EMPLOYEE" ? 200000 : 0;

    const emp = await prisma.employee.create({
      data: {
        empNo: `E${String(idx + 1).padStart(3, "0")}`,
        name: p.name,
        department: s.department,
        position: s.position,
        duty: s.duty,
        email: p.email,
        hireDate: hire,
        incomeType,
        payScheme,
        baseWage: s.baseWage ?? 0,
        positionAllow: s.positionAllow ?? 0,
        mealAllow,
        carAllow: s.carAllow ?? 0,
        dependents: p.dependents,
        schedule: JSON.stringify(s.schedule),
      },
    });

    await prisma.contract.create({
      data: {
        employeeId: emp.id,
        stage: contractStageFor(hire, now),
        templateKey: payScheme === "HOURLY" ? "HOURLY" : "MONTHLY",
        incomeType,
        startDate: hire,
        endDate: null,
        isProbation: false,
        baseWage: emp.baseWage,
        positionAllow: emp.positionAllow,
        mealAllow: emp.mealAllow,
        carAllow: emp.carAllow,
        status: "ACTIVE",
      },
    });
    idx++;
  }

  // 6) 데모: 인센티브 강사 & 완전비율제 강사 추가
  const demoSchedule = JSON.stringify([
    { day: "mon", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
    { day: "tue", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
    { day: "wed", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
    { day: "thu", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
    { day: "fri", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
    { day: "sat", work: false, start: "13:00", end: "18:00", breakH: 0.5 },
    { day: "sun", work: false, start: "13:00", end: "18:00", breakH: 0.5 },
  ]);

  const incEmp = await prisma.employee.create({
    data: {
      empNo: "E023",
      name: "배진호",
      department: "교수부",
      position: "강사",
      duty: "강의(학급관리)",
      email: "jinho.bae@yoossam.example",
      hireDate: new Date("2023-03-02T00:00:00Z"),
      incomeType: "FREELANCE",
      payScheme: "INCENTIVE",
      baseWage: 3000000,
      dependents: 1,
      incThreshold: 40,
      incPerStudent: 50000,
      schedule: demoSchedule,
    },
  });
  await prisma.contract.create({
    data: {
      employeeId: incEmp.id,
      stage: "REGULAR",
      templateKey: "INCENTIVE",
      incomeType: incEmp.incomeType,
      startDate: incEmp.hireDate,
      isProbation: false,
      baseWage: 3000000,
      incThreshold: 40,
      incPerStudent: 50000,
      status: "ACTIVE",
    },
  });

  const ratioEmp = await prisma.employee.create({
    data: {
      empNo: "E024",
      name: "남궁현",
      department: "교수부",
      position: "위탁강사",
      duty: "강의(반 운영)",
      email: "hyun.namgung@yoossam.example",
      hireDate: new Date("2024-03-01T00:00:00Z"),
      incomeType: "FREELANCE",
      payScheme: "RATIO",
      baseWage: 0,
      dependents: 1,
      ratioPercent: 0.5,
      schedule: demoSchedule,
    },
  });
  await prisma.contract.create({
    data: {
      employeeId: ratioEmp.id,
      stage: "REGULAR",
      templateKey: "RATIO",
      incomeType: ratioEmp.incomeType,
      startDate: ratioEmp.hireDate,
      isProbation: false,
      ratioPercent: 0.5,
      status: "ACTIVE",
    },
  });

  // 7) 데모 연차 사용 및 신청
  const first = await prisma.employee.findFirst({ orderBy: { id: "asc" } });
  if (first) {
    await prisma.leaveTransaction.create({
      data: {
        employeeId: first.id,
        date: new Date("2025-05-02T00:00:00Z"),
        days: -1,
        type: "USE",
        note: "5월 연차 사용(가족행사)",
      },
    });
    await prisma.leaveRequest.create({
      data: {
        employeeId: first.id,
        startDate: new Date("2026-08-14T00:00:00Z"),
        endDate: new Date("2026-08-14T00:00:00Z"),
        days: 1,
        leaveType: "ANNUAL",
        reason: "개인 사유",
        status: "PENDING",
        source: "WEB",
      },
    });
  }

  // 8) 급여명세서 자동발송 스케줄 (기본: 매월 7일 09:00, 비활성)
  await prisma.emailSchedule.create({
    data: {
      name: "급여명세서 자동발송",
      enabled: false,
      frequency: "MONTHLY",
      dayOfMonth: 7,
      hour: 9,
      minute: 0,
      targetMonthOffset: -1,
    },
  });

  const total = await prisma.employee.count();
  console.log(`  직원 ${total}명 생성`);
  console.log("✅ 시딩 완료");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
