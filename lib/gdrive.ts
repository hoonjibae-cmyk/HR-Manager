// 구글 드라이브 연동 — 계약서 **서명본 스캔**의 저장소.
//
// 인증은 캘린더와 **같은 서비스 계정**을 쓰되(`lib/gcal.ts` 의 `serviceAccount()`),
// 스코프가 달라 토큰은 따로 받는다.
//
// ⚠ **서비스 계정에는 드라이브 저장 용량이 없다.** 구글이 2022년경부터 서비스 계정이
// 자기 My Drive 에 파일을 소유하는 것을 막았다. 그래서 올릴 수 있는 곳은 사실상
// **공유 드라이브(Shared Drive)** 뿐이고, 공유 드라이브는 **Google Workspace 전용**이다.
// 개인 지메일 계정의 폴더를 서비스 계정에 공유해 두면 **조회는 되는데 업로드만
// `storageQuotaExceeded` 로 실패한다** — 가장 헷갈리는 실패 모양이라 진단이 이것을 딱 짚어 준다.
//
// 준비
//  1) Google Cloud 콘솔 → API 및 서비스 → 라이브러리 → **Google Drive API** 사용 설정
//  2) 드라이브에 **공유 드라이브**를 만들고 그 안에 폴더 생성
//     (또는 기존 공유 드라이브 폴더 사용)
//  3) 그 폴더를 서비스 계정 이메일과 공유하고 **콘텐츠 관리자** 이상 권한 부여
//  4) 환경변수 `GOOGLE_DRIVE_CONTRACT_FOLDER_ID` = 그 폴더의 ID
//     (드라이브에서 폴더를 열었을 때 주소의 `/folders/` 뒤 문자열)

import { createSign } from "crypto";
import { serviceAccount } from "./gcal";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
/**
 * `drive.file`(자기가 만든 파일만)이 아니라 `drive` 를 쓴다 — 지정한 폴더의 정보를 읽고
 * 직원별 하위 폴더를 찾아 쓰려면 앱이 만들지 않은 폴더에도 닿아야 한다.
 */
const SCOPE = "https://www.googleapis.com/auth/drive";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
/** 공유 드라이브 안의 파일은 이 값을 안 붙이면 **없는 것으로 나온다**(404) */
const SHARED = "supportsAllDrives=true&includeItemsFromAllDrives=true";

export function driveFolderId(): string {
  return (process.env.GOOGLE_DRIVE_CONTRACT_FOLDER_ID || "").trim();
}

export function driveConfigured(): boolean {
  const sa = serviceAccount();
  return !!sa.clientEmail && !!sa.privateKey && !!driveFolderId();
}

/* ───────────── 이름 짓기 (순수 함수 — 테스트 있음) ───────────── */

/**
 * 직원별 하위 폴더 이름.
 *
 * 드라이브를 **회사의 문서 캐비닛**으로 쓰는 것이 목적이라, 사람이 드라이브에서 바로 찾을 수
 * 있어야 한다. 사번을 앞에 두어 이름이 같은 직원이 섞이지 않게 한다.
 */
export function employeeFolderName(emp: { empNo?: string | null; name: string }): string {
  const no = (emp.empNo ?? "").trim();
  return sanitizeDriveName(no ? `${no} ${emp.name}` : emp.name);
}

/**
 * 드라이브에 올릴 파일 이름 — `2025-10-01 근로계약서_김지연.pdf`.
 *
 * 계약 시작일을 앞에 붙이는 이유: 한 직원 폴더에 계약이 여러 건 쌓이는데, 드라이브의 기본
 * 정렬은 이름순이라 날짜가 앞에 없으면 **어느 계약의 스캔본인지 파일만 봐서는 모른다**.
 */
export function driveFileName(startYmd: string, name: string): string {
  return sanitizeDriveName(`${startYmd} ${name}`);
}

/**
 * 드라이브 이름에서 걸러야 할 문자.
 *
 * 슬래시는 드라이브가 폴더 구분으로 읽지는 않지만 내려받을 때 경로로 오해되고,
 * 제어문자는 API 요청(JSON)과 나중의 헤더 양쪽에서 말썽이 된다.
 */
export function sanitizeDriveName(raw: string): string {
  return (
    String(raw ?? "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[\\/]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "계약서스캔"
  );
}

/**
 * 드라이브 검색 질의(`q`)에 이름을 넣을 때의 이스케이프.
 *
 * 이름은 **직원 이름에서 온 값**이라 작은따옴표가 들어갈 수 있다(예: `O'Brien`).
 * 그대로 이어붙이면 질의가 깨져 엉뚱한 폴더를 찾거나 오류가 난다.
 */
export function escapeQuery(v: string): string {
  return String(v ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/* ───────────── 인증 ───────────── */

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string | null> {
  const sa = serviceAccount();
  if (!sa.clientEmail || !sa.privateKey) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({ iss: sa.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${b64url(signer.sign(sa.privateKey))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!j?.access_token) {
    console.error("[gdrive] 토큰 발급 실패:", j?.error_description || j?.error);
    return null;
  }
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

/* ───────────── 오류 안내 (순수 함수 — 테스트 있음) ───────────── */

/**
 * 구글이 돌려준 오류 → 관리자가 **바로 할 수 있는 조치**.
 *
 * 드라이브 오류는 원문이 영문 상수라 그대로 띄우면 무엇을 고쳐야 할지 알 수 없다.
 * 특히 `storageQuotaExceeded` 는 "용량이 찼다" 로 읽히지만 실제로는
 * **개인 드라이브 폴더를 쓰고 있다**는 뜻이라 반드시 풀어서 적어야 한다.
 */
export function driveHint(status: number, reason: string, message: string): string {
  const m = `${reason} ${message}`.toLowerCase();
  if (m.includes("storagequotaexceeded") || m.includes("service accounts do not have storage"))
    return (
      "서비스 계정은 **개인 드라이브(내 드라이브)에 파일을 소유할 수 없습니다.**\n" +
      "지정한 폴더가 개인 계정의 폴더로 보입니다 — 조회는 되지만 업로드만 막히는 상태입니다.\n" +
      "**공유 드라이브(Shared Drive)** 를 만들어 그 안의 폴더를 쓰세요. " +
      "공유 드라이브는 Google Workspace 계정에서만 만들 수 있습니다.\n" +
      "Workspace 가 아니라면 스캔본은 DB 보관을 그대로 쓰는 편이 낫습니다."
    );
  if (m.includes("accessnotconfigured") || m.includes("has not been used"))
    return "Google Cloud 프로젝트에서 **Google Drive API** 가 사용 설정되지 않았습니다.\n콘솔 → API 및 서비스 → 라이브러리 → Google Drive API → 사용.";
  if (m.includes("invalid_grant"))
    return "서비스 계정 인증에 실패했습니다. 키 파일(JSON)을 통째로 GOOGLE_SERVICE_ACCOUNT_JSON 에 넣는 방법이 가장 확실합니다.";
  if (status === 404)
    return "폴더를 찾지 못했습니다. GOOGLE_DRIVE_CONTRACT_FOLDER_ID 가 정확한지, 그리고 그 폴더를\n서비스 계정 이메일과 **공유** 했는지 확인하세요 (공유하지 않으면 존재해도 404 가 납니다).";
  if (status === 403)
    return "권한이 부족합니다. 폴더 공유 설정에서 서비스 계정의 권한을 **콘텐츠 관리자(편집자)** 이상으로 올려 주세요.";
  if (status === 401) return "인증이 거부되었습니다. 서비스 계정 키가 삭제되었거나 잘못된 값입니다.";
  return message || "알 수 없는 오류";
}

function errOf(status: number, body: any): string {
  const e = body?.error;
  const reason = e?.errors?.[0]?.reason ?? e?.status ?? "";
  const message = e?.message ?? "";
  return driveHint(status, String(reason), String(message));
}

/* ───────────── 폴더 ───────────── */

export interface DriveFolderInfo {
  id: string;
  name: string;
  /** 공유 드라이브 안이면 그 드라이브 id — **없으면 개인 드라이브**라 업로드가 막힌다 */
  driveId?: string | null;
  canAddChildren?: boolean;
}

async function folderInfo(token: string, id: string): Promise<{ ok: boolean; info?: DriveFolderInfo; error?: string }> {
  const res = await fetch(
    `${API}/files/${encodeURIComponent(id)}?${SHARED}&fields=id,name,mimeType,driveId,capabilities(canAddChildren)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: errOf(res.status, j) };
  if (j.mimeType !== "application/vnd.google-apps.folder")
    return { ok: false, error: "지정한 ID 가 폴더가 아닙니다. 폴더를 열었을 때 주소의 /folders/ 뒤 값을 넣어 주세요." };
  return {
    ok: true,
    info: { id: j.id, name: j.name, driveId: j.driveId ?? null, canAddChildren: j.capabilities?.canAddChildren },
  };
}

/**
 * 직원 폴더를 찾고, 없으면 만든다.
 *
 * **못 만들어도 업로드를 포기하지 않는다** — 상위 폴더에 그대로 올린다.
 * 파일이 어디 있느냐보다 파일이 저장되는 것이 먼저다.
 */
async function ensureEmployeeFolder(token: string, parent: string, name: string): Promise<string> {
  const q = [
    `'${escapeQuery(parent)}' in parents`,
    `name = '${escapeQuery(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");
  const found: any = await fetch(`${API}/files?${SHARED}&q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json())
    .catch(() => null);
  if (found?.files?.[0]?.id) return found.files[0].id;

  const made: any = await fetch(`${API}/files?${SHARED}&fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parent],
    }),
  })
    .then((r) => r.json())
    .catch(() => null);
  return made?.id || parent;
}

/* ───────────── 업로드·조회·삭제 ───────────── */

export interface DriveUploadResult {
  ok: boolean;
  fileId?: string;
  webViewLink?: string;
  error?: string;
}

export async function uploadToDrive(opts: {
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** 직원별 하위 폴더 이름 (없으면 상위 폴더에 바로 올린다) */
  folderName?: string;
}): Promise<DriveUploadResult> {
  if (!driveConfigured()) return { ok: false, error: "구글 드라이브가 설정되지 않았습니다." };
  const token = await accessToken();
  if (!token) return { ok: false, error: "구글 인증에 실패했습니다 (서비스 계정 키를 확인하세요)." };

  const root = driveFolderId();
  const parent = opts.folderName ? await ensureEmployeeFolder(token, root, opts.folderName) : root;

  // multipart 업로드 — 메타데이터와 본문을 한 번에 보낸다
  const boundary = `----hrdrive${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: sanitizeDriveName(opts.name), parents: [parent] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${opts.mime}\r\n\r\n`),
    Buffer.from(opts.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&${SHARED}&fields=id,webViewLink`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j?.id) return { ok: false, error: errOf(res.status, j) };
  return { ok: true, fileId: j.id, webViewLink: j.webViewLink };
}

/**
 * 파일 본문을 그대로 흘려보낸다.
 *
 * 버퍼로 받지 않고 **스트림을 그대로 넘긴다** — 서버리스 함수의 메모리에 수 MB 짜리
 * 스캔본을 통째로 올릴 이유가 없다.
 */
export async function driveStream(
  fileId: string
): Promise<{ ok: boolean; body?: ReadableStream<Uint8Array> | null; error?: string; status?: number }> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "구글 인증에 실패했습니다.", status: 502 };
  const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&${SHARED}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const j: any = await res.json().catch(() => ({}));
    return { ok: false, error: errOf(res.status, j), status: res.status };
  }
  return { ok: true, body: res.body };
}

export async function deleteFromDrive(fileId: string): Promise<{ ok: boolean; error?: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "구글 인증에 실패했습니다." };
  const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?${SHARED}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  // 이미 없으면 지운 것으로 본다 (드라이브에서 사람이 먼저 지웠을 수 있다)
  if (res.status === 404) return { ok: true };
  if (!res.ok) {
    const j: any = await res.json().catch(() => ({}));
    return { ok: false, error: errOf(res.status, j) };
  }
  return { ok: true };
}

/* ───────────── 연결 진단 ───────────── */

export interface DriveStep {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * 토큰 → 폴더 조회 → **시험 업로드·삭제**까지 실제로 해 본다.
 *
 * 시험 업로드를 빼면 안 된다 — 개인 드라이브 폴더는 **조회까지는 성공하고 업로드에서만**
 * 막히기 때문에, 조회만 확인하고 "연결됨" 이라고 적으면 실제 첨부 때 처음 실패한다.
 * Workspace(공유 드라이브)인지 아닌지가 여기서 갈린다.
 */
export async function driveDiagnose(): Promise<{
  ok: boolean;
  steps: DriveStep[];
  hint?: string;
  folderName?: string;
  sharedDrive?: boolean;
}> {
  const steps: DriveStep[] = [];
  const sa = serviceAccount();

  steps.push({
    name: "서비스 계정 키",
    ok: !!sa.clientEmail && !!sa.privateKey,
    detail: sa.clientEmail || "GOOGLE_SERVICE_ACCOUNT_JSON 없음",
  });
  if (!steps[0].ok)
    return { ok: false, steps, hint: "구글 캘린더와 같은 서비스 계정을 씁니다. 키를 먼저 넣어 주세요." };

  const folder = driveFolderId();
  steps.push({
    name: "폴더 ID",
    ok: !!folder,
    detail: folder || "GOOGLE_DRIVE_CONTRACT_FOLDER_ID 없음",
  });
  if (!folder)
    return {
      ok: false,
      steps,
      hint: "드라이브에서 폴더를 열었을 때 주소의 `/folders/` 뒤 문자열을 GOOGLE_DRIVE_CONTRACT_FOLDER_ID 에 넣으세요.",
    };

  const token = await accessToken();
  steps.push({ name: "토큰 발급 (drive 스코프)", ok: !!token });
  if (!token) return { ok: false, steps, hint: driveHint(401, "invalid_grant", "") };

  const info = await folderInfo(token, folder);
  steps.push({
    name: "폴더 조회",
    ok: info.ok,
    detail: info.ok ? info.info!.name : info.error,
  });
  if (!info.ok) return { ok: false, steps, hint: info.error };

  const shared = !!info.info?.driveId;
  steps.push({
    name: "공유 드라이브 여부",
    ok: shared,
    detail: shared
      ? "공유 드라이브 — 서비스 계정이 파일을 소유할 수 있습니다"
      : "개인(내) 드라이브로 보입니다 — 업로드가 막힐 수 있습니다",
  });

  // 실제로 올려 보고 지운다 — 여기까지 통과해야 '된다' 고 말할 수 있다
  const probe = await uploadToDrive({
    name: "연결테스트.txt",
    mime: "text/plain",
    bytes: new TextEncoder().encode("유쌤에듀 HR 연결 테스트"),
  });
  steps.push({ name: "시험 업로드", ok: probe.ok, detail: probe.ok ? "성공" : probe.error });
  if (!probe.ok) return { ok: false, steps, hint: probe.error, folderName: info.info?.name, sharedDrive: shared };

  const del = await deleteFromDrive(probe.fileId!);
  steps.push({ name: "시험 파일 삭제", ok: del.ok, detail: del.ok ? "정리됨" : del.error });

  return { ok: true, steps, folderName: info.info?.name, sharedDrive: shared };
}
