// 구글 캘린더 연동 — 승인된 휴가를 '유쌤에듀-직원휴가일정' 캘린더에 자동 등록/삭제
//
// 인증: 서비스 계정(JWT → OAuth2 access token). googleapis 패키지 없이
//       node:crypto 로 RS256 서명만 하므로 서버리스 번들이 가벼움.
//
// 준비 (docs/SETUP.md 참고)
//  1) Google Cloud 콘솔에서 서비스 계정 생성 → JSON 키 발급
//  2) 구글 캘린더에서 대상 캘린더 → 설정 → '특정 사용자와 공유'에
//     서비스 계정 이메일을 추가하고 **변경 및 공유 관리 권한** 부여
//  3) 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON(키 파일 통째로) + GOOGLE_CALENDAR_ID
//     (또는 GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY + GOOGLE_CALENDAR_ID)

import { createSign } from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar";

/**
 * 서비스 계정 자격증명.
 * 두 가지 방법을 모두 지원한다.
 *  (A) GOOGLE_SERVICE_ACCOUNT_JSON — 다운로드한 JSON 파일 내용을 통째로 (권장·오타 없음)
 *  (B) GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY — 두 값을 따로
 */
export function serviceAccount(): { clientEmail: string; privateKey: string } {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (raw) {
    try {
      const j = JSON.parse(raw);
      return {
        clientEmail: j.client_email || "",
        // JSON.parse 가 \n 을 이미 실제 줄바꿈으로 바꿔 준다
        privateKey: j.private_key || "",
      };
    } catch {
      // 파싱 실패 시 아래 개별 환경변수로 넘어간다 (진단에서 형식 오류로 잡힘)
    }
  }
  return {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL || "",
    // 환경변수에 저장할 때 줄바꿈이 \n 문자열로 들어가는 경우가 많다
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
}

export function gcalConfigured(): boolean {
  const sa = serviceAccount();
  return !!sa.clientEmail && !!sa.privateKey && !!process.env.GOOGLE_CALENDAR_ID;
}

/**
 * 보강 일정은 휴가와 **다른 캘린더**('보강캘린더')에 올린다.
 * GOOGLE_MAKEUP_CALENDAR_ID 를 따로 넣어야 하며, 없으면 보강 동기화만 조용히 꺼진다
 * (휴가 캘린더에 섞여 들어가면 안 되므로 GOOGLE_CALENDAR_ID 로 대체하지 않는다).
 */
export function makeupCalendarId(): string {
  return (process.env.GOOGLE_MAKEUP_CALENDAR_ID || "").trim();
}

export function makeupCalendarConfigured(): boolean {
  const sa = serviceAccount();
  return !!sa.clientEmail && !!sa.privateKey && !!makeupCalendarId();
}

function privateKey(): string {
  return serviceAccount().privateKey;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (!gcalConfigured()) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: serviceAccount().clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(privateKey()));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const j: any = await res.json();
  if (!j?.access_token) {
    console.error("[gcal] 토큰 발급 실패:", j?.error_description || j?.error);
    return null;
  }
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

/* ==================== 연결 진단 (설정 화면 '연결 테스트') ==================== */

export interface GcalStep {
  name: string;
  ok: boolean;
  detail?: string;
}

/** 구글이 돌려준 오류 코드/메시지 → 관리자가 바로 조치할 수 있는 안내 */
function gcalHint(status: number, reason: string, message: string): string {
  const m = `${reason} ${message}`.toLowerCase();
  if (m.includes("accessnotconfigured") || m.includes("has not been used"))
    return "Google Cloud 프로젝트에서 **Google Calendar API** 가 사용 설정되지 않았습니다.\n콘솔 → API 및 서비스 → 라이브러리 → Google Calendar API → 사용.";
  if (m.includes("invalid_grant"))
    return "서비스 계정 인증에 실패했습니다. 키 파일(JSON)을 통째로 GOOGLE_SERVICE_ACCOUNT_JSON 에\n붙여넣는 방법이 가장 확실합니다. 개별 변수를 쓴다면 client_email 과 private_key 가\n같은 JSON 파일에서 온 값인지, 키가 중간에 잘리지 않았는지 확인하세요.";
  if (status === 404)
    return "캘린더를 찾지 못했습니다. GOOGLE_CALENDAR_ID 가 정확한지, 그리고 그 캘린더를\n서비스 계정 이메일과 **공유** 했는지 확인하세요 (공유하지 않으면 존재해도 404 가 납니다).";
  if (status === 403)
    return "권한이 부족합니다. 캘린더 → 설정 및 공유 → 특정 사용자와 공유에서\n서비스 계정 이메일의 권한을 **일정 변경** 이상으로 올려 주세요.";
  if (status === 401)
    return "인증이 거부되었습니다. 서비스 계정 키가 삭제되었거나 잘못된 값입니다.";
  return message || "알 수 없는 오류";
}

/**
 * 토큰 발급 → 캘린더 조회 → 테스트 일정 생성/삭제까지 실제로 해 보고
 * 어디서 막혔는지 단계별로 알려준다.
 */
export async function gcalDiagnose(): Promise<{
  ok: boolean;
  steps: GcalStep[];
  hint?: string;
  calendarName?: string;
}> {
  const steps: GcalStep[] = [];
  const sa = serviceAccount();
  const usedJson = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  const jsonBroken = usedJson && !sa.clientEmail;
  if (jsonBroken) {
    steps.push({
      name: "환경변수",
      ok: false,
      detail: "GOOGLE_SERVICE_ACCOUNT_JSON 을 JSON 으로 읽지 못했습니다",
    });
    return {
      ok: false,
      steps,
      hint: "다운로드한 키 파일 내용을 { 부터 } 까지 통째로, 앞뒤 따옴표 없이 붙여넣었는지 확인하세요.",
    };
  }
  const missing = [
    !sa.clientEmail && "GOOGLE_CLIENT_EMAIL (또는 GOOGLE_SERVICE_ACCOUNT_JSON)",
    !sa.privateKey && "GOOGLE_PRIVATE_KEY (또는 GOOGLE_SERVICE_ACCOUNT_JSON)",
    !process.env.GOOGLE_CALENDAR_ID && "GOOGLE_CALENDAR_ID",
  ].filter(Boolean) as string[];
  if (missing.length) {
    steps.push({ name: "환경변수", ok: false, detail: `누락: ${missing.join(", ")}` });
    return { ok: false, steps, hint: "환경변수를 넣고 재배포(Redeploy)한 뒤 다시 시도하세요." };
  }
  steps.push({
    name: "환경변수",
    ok: true,
    detail: `${sa.clientEmail} (${usedJson ? "JSON 통째로" : "개별 변수"})`,
  });

  const key = privateKey();
  const keyOk = key.includes("BEGIN PRIVATE KEY") && key.includes("END PRIVATE KEY");
  steps.push({
    name: "비밀키 형식",
    ok: keyOk,
    detail: keyOk ? "정상" : "-----BEGIN PRIVATE KEY----- ~ -----END PRIVATE KEY----- 가 온전하지 않습니다",
  });
  if (!keyOk)
    return {
      ok: false,
      steps,
      hint: "키 파일(JSON) 전체를 GOOGLE_SERVICE_ACCOUNT_JSON 에 붙여넣으면 이 오류가 나지 않습니다.",
    };

  // 1) 토큰
  cachedToken = null; // 진단은 항상 새 토큰으로
  let token: string | null = null;
  try {
    token = await accessToken();
  } catch (e: any) {
    steps.push({ name: "토큰 발급", ok: false, detail: e.message });
    return { ok: false, steps, hint: gcalHint(0, "invalid_grant", e.message) };
  }
  if (!token) {
    steps.push({ name: "토큰 발급", ok: false, detail: "access_token 을 받지 못했습니다" });
    return { ok: false, steps, hint: gcalHint(0, "invalid_grant", "") };
  }
  steps.push({ name: "토큰 발급", ok: true });

  const calId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "");
  const auth = { Authorization: `Bearer ${token}` };

  // 2) 캘린더 접근
  const metaRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}`, {
    headers: auth,
  });
  const meta: any = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok) {
    const reason = meta?.error?.errors?.[0]?.reason ?? "";
    const message = meta?.error?.message ?? `HTTP ${metaRes.status}`;
    steps.push({ name: "캘린더 접근", ok: false, detail: message });
    return { ok: false, steps, hint: gcalHint(metaRes.status, reason, message) };
  }
  steps.push({ name: "캘린더 접근", ok: true, detail: meta.summary });

  // 3) 쓰기 권한 — 실제로 만들었다가 지운다
  const probe = {
    summary: "[연결 테스트] 유쌤에듀 HR",
    description: "연결 확인용 임시 일정입니다. 자동으로 삭제됩니다.",
    start: { date: "2000-01-01" },
    end: { date: "2000-01-02" },
    transparency: "transparent",
  };
  const createRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
    { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(probe) }
  );
  const created: any = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created?.id) {
    const reason = created?.error?.errors?.[0]?.reason ?? "";
    const message = created?.error?.message ?? `HTTP ${createRes.status}`;
    steps.push({ name: "일정 생성 권한", ok: false, detail: message });
    return { ok: false, steps, hint: gcalHint(createRes.status, reason, message), calendarName: meta.summary };
  }
  const deleted = await deleteLeaveEvent(created.id);
  steps.push({ name: "일정 생성 권한", ok: true, detail: deleted ? "생성·삭제 확인" : "생성 성공 (테스트 일정 삭제 실패 — 수동 삭제 필요)" });

  return { ok: true, steps, calendarName: meta.summary };
}

/** YYYY-MM-DD (UTC 기준 저장된 날짜를 그대로 사용) */
function dateStr(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** 종료일 다음 날 (구글 종일 일정의 end.date 는 배타적) */
export function exclusiveEnd(end: Date): string {
  const d = new Date(new Date(end).getTime() + 86400000);
  return d.toISOString().slice(0, 10);
}

export interface LeaveEventInput {
  name: string;
  typeLabel: string; // 연차 / 반차 / 병가 ...
  start: Date;
  end: Date;
  reason?: string | null;
  department?: string | null;
  days?: number;
  workPlan?: string | null; // 업무조치사항
}

/** 캘린더 일정 본문 (테스트를 위해 분리) */
export function buildLeaveEvent(input: LeaveEventInput) {
  const summary = `${input.name} ${input.typeLabel}`;
  const lines = [
    `직원: ${input.name}${input.department ? ` (${input.department})` : ""}`,
    `종류: ${input.typeLabel}${input.days ? ` · ${input.days}일` : ""}`,
    input.reason ? `사유: ${input.reason}` : "",
    input.workPlan ? `업무조치사항: ${input.workPlan}` : "",
    "",
    "※ 유쌤에듀 HR 프로그램에서 자동 등록된 일정입니다.",
  ].filter(Boolean);
  return {
    summary,
    description: lines.join("\n"),
    start: { date: dateStr(input.start) },
    end: { date: exclusiveEnd(input.end) },
    transparency: "transparent",
  };
}

/** 휴가 일정 생성 → eventId (실패 시 null, 예외를 던지지 않음) */
export async function createLeaveEvent(input: LeaveEventInput): Promise<string | null> {
  const token = await accessToken();
  if (!token) return null;
  try {
    const calId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "");
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildLeaveEvent(input)),
      }
    );
    const j: any = await res.json();
    if (!j?.id) {
      console.error("[gcal] 일정 생성 실패:", j?.error?.message);
      return null;
    }
    return j.id as string;
  } catch (e: any) {
    console.error("[gcal] 일정 생성 예외:", e.message);
    return null;
  }
}

/** 휴가 일정 삭제 (취소 승인 시) */
export async function deleteLeaveEvent(eventId: string): Promise<boolean> {
  return deleteEvent(process.env.GOOGLE_CALENDAR_ID || "", eventId);
}

/**
 * 기간 안의 일정 **읽기**. 이 앱에서 캘린더를 읽는 건 여기뿐이다 —
 * 나머지는 다 쓰기(만들기·지우기)라 지금까지 필요가 없었다.
 *
 * 쓰는 곳: 운영팀 평일 휴무(`(휴무)김수민`)를 연차 캘린더에서 끌어온다(lib/dayoff-service.ts).
 * 그 일정들은 **사람이 손으로 넣은 것**이라 앱이 만들지 않는다. 읽기만 한다.
 *
 * - `singleEvents=true` — 반복 일정을 날짜별로 펴서 준다. 안 켜면 매주 반복 휴무가
 *   원본 한 줄로만 와서 그 주 하루만 잡힌다.
 * - **다음 쪽이 있으면 끝까지 따라간다**(`nextPageToken`). 기본 250건이라 석 달치면
 *   넘길 수 있고, 넘긴 줄이 조용히 사라지면 그 사람 휴무가 통째로 빠진다.
 * - 실패하면 `null` — **빈 배열이 아니다.** 빈 배열로 돌려주면 호출부가 '휴무가 하나도 없다'
 *   로 읽고 표를 통째로 지운다.
 */
export async function listEvents(
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<any[] | null> {
  const out: any[] = [];
  let pageToken: string | undefined;
  try {
    // **토큰 발급도 try 안에서** — 키가 깨져 있으면 `createSign` 이 예외를 던진다.
    // 밖에 두면 그 예외가 그대로 올라가 요청이 500 으로 죽는다. 여기서는 '못 읽었다'(null)가 맞다.
    const token = await accessToken();
    if (!token || !calendarId) return null;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({
        timeMin: `${timeMin}T00:00:00Z`,
        timeMax: `${timeMax}T23:59:59Z`,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500",
      });
      if (pageToken) q.set("pageToken", pageToken);
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${q}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const j: any = await res.json().catch(() => null);
      if (!res.ok || !j) {
        console.error("[gcal] 일정 조회 실패:", j?.error?.message ?? `HTTP ${res.status}`);
        return null;
      }
      out.push(...(j.items ?? []));
      pageToken = j.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  } catch (e: any) {
    console.error("[gcal] 일정 조회 예외:", e.message);
    return null;
  }
}

/** 연차 캘린더 — 휴무 일정도 여기에 함께 들어 있다 */
export async function listLeaveCalendarEvents(timeMin: string, timeMax: string) {
  return listEvents(process.env.GOOGLE_CALENDAR_ID || "", timeMin, timeMax);
}

/**
 * **학사일정 캘린더** — 학원방학·개학처럼 학원 전체가 도는지 마는지를 담은 달력.
 * 연차·보강 캘린더와 **별개**라 없을 때 그쪽으로 대체하지 않는다(성격이 아예 다르다).
 */
export function schoolCalendarId(): string {
  return (process.env.GOOGLE_SCHOOL_CALENDAR_ID || "").trim();
}
export function schoolCalendarConfigured(): boolean {
  return gcalConfigured() && !!schoolCalendarId();
}

/**
 * 학사일정 조회. 캘린더를 안 붙였으면 `null` — **빈 배열이 아니다.**
 * 빈 배열은 '일정이 하나도 없다(= 방학이 아니다)' 는 뜻이고, `null` 은 '모른다' 다.
 * 부르는 쪽이 이 둘을 갈라 봐야 모르는 날을 방학으로 단정하지 않는다.
 */
export async function listSchoolCalendarEvents(timeMin: string, timeMax: string) {
  const id = schoolCalendarId();
  if (!id) return null;
  return listEvents(id, timeMin, timeMax);
}

async function deleteEvent(calendarId: string, eventId: string): Promise<boolean> {
  const token = await accessToken();
  if (!token || !eventId || !calendarId) return false;
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId
      )}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    // 204 삭제 성공, 410 이미 삭제됨
    return res.status === 204 || res.status === 410;
  } catch (e: any) {
    console.error("[gcal] 일정 삭제 예외:", e.message);
    return false;
  }
}

/* ==================== 보강캘린더 (휴가와 별개) ==================== */

export interface MakeupEventInput {
  name: string;
  department?: string | null;
  categoryLabel: string; // 직전보강 / 내신의무보강 ...
  /** KST 벽시계 값이 UTC 필드에 담긴 Date (앱 전체 규칙) */
  start: Date;
  end: Date;
  targetClass: string;
  headcount?: number | null;
  detail?: string | null;
  note?: string | null;
  statusLabel?: string; // 실근무 확정 / 미실시 ...
}

/** "2026-08-15T19:00:00" — 구글에는 시각만 주고 시간대는 Asia/Seoul 로 따로 알린다 */
function seoulDateTime(d: Date): string {
  return new Date(d).toISOString().slice(0, 19);
}

/** 보강 일정 본문 (테스트를 위해 분리) */
export function buildMakeupEvent(input: MakeupEventInput) {
  const hours = Math.round(((input.end.getTime() - input.start.getTime()) / 3600000) * 100) / 100;
  const lines = [
    `강사: ${input.name}${input.department ? ` (${input.department})` : ""}`,
    `보강종류: ${input.categoryLabel}`,
    `대상반: ${input.targetClass}`,
    input.headcount ? `수강 예상인원: ${input.headcount}명` : "",
    hours > 0 ? `예정 시간: ${hours}시간` : "",
    input.detail ? `\n[세부 보강내역]\n${input.detail}` : "",
    input.note ? `\n[기타 특이사항]\n${input.note}` : "",
    input.statusLabel ? `\n상태: ${input.statusLabel}` : "",
    "",
    "※ 유쌤에듀 HR 프로그램에서 자동 등록된 일정입니다.",
  ].filter(Boolean);
  return {
    summary: `[${input.categoryLabel}] ${input.name} · ${input.targetClass}`,
    description: lines.join("\n"),
    start: { dateTime: seoulDateTime(input.start), timeZone: "Asia/Seoul" },
    end: { dateTime: seoulDateTime(input.end), timeZone: "Asia/Seoul" },
  };
}

/** 보강 일정 생성 → eventId (실패 시 null, 예외를 던지지 않음) */
export async function createMakeupEvent(input: MakeupEventInput): Promise<string | null> {
  const calId = makeupCalendarId();
  const token = calId ? await accessToken() : null;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildMakeupEvent(input)),
      }
    );
    const j: any = await res.json();
    if (!j?.id) {
      console.error("[gcal] 보강 일정 생성 실패:", j?.error?.message);
      return null;
    }
    return j.id as string;
  } catch (e: any) {
    console.error("[gcal] 보강 일정 생성 예외:", e.message);
    return null;
  }
}

/** 보강 일정 수정 (실근무 시각 확정 등). 일정이 사라졌으면 새로 만들어 새 ID 를 돌려준다 */
export async function updateMakeupEvent(
  eventId: string,
  input: MakeupEventInput
): Promise<string | null> {
  const calId = makeupCalendarId();
  const token = calId && eventId ? await accessToken() : null;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calId
      )}/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildMakeupEvent(input)),
      }
    );
    if (res.status === 404 || res.status === 410) return createMakeupEvent(input);
    const j: any = await res.json().catch(() => ({}));
    if (!j?.id) {
      console.error("[gcal] 보강 일정 수정 실패:", j?.error?.message);
      return null;
    }
    return j.id as string;
  } catch (e: any) {
    console.error("[gcal] 보강 일정 수정 예외:", e.message);
    return null;
  }
}

/** 보강 일정 삭제 (신청 취소 시) */
export async function deleteMakeupEvent(eventId: string): Promise<boolean> {
  return deleteEvent(makeupCalendarId(), eventId);
}
