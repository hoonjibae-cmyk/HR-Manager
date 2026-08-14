/**
 * **첨부 파일의 형식·이름 판정** — 순수 함수(DB·네트워크 무관).
 *
 * 계약서 서명본 스캔과 직원 서류함이 함께 쓴다. 크기 상한·조각 나누기는 `lib/upload-chunk.ts`.
 *
 * ⚠ **크기는 여기서 보지 않는다.** 파일은 조각내 올라오므로 이 파일의 함수들이 받는 것은
 * **파일 전체가 아니라 첫 조각**이다. 여기에 크기 상한을 두면 조각 크기를 파일 크기로 착각해
 * 재게 되고, 조각 크기를 조금만 키워도 **모든 업로드가 거절된다**(겪었다).
 */

/** **브라우저에서 그대로 열어 볼 수 있는** 형식 — 이것만 inline 으로 내보낸다 */
export const VIEWABLE_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type ViewableMime = (typeof VIEWABLE_MIME)[number];

/** 저장한 형식 — 앞머리로 가린 것이거나, 못 가렸으면 octet-stream */
export const UNKNOWN_MIME = "application/octet-stream";

/**
 * 브라우저에 **inline 으로 내보내도 되는가**.
 *
 * 앞머리로 못 가린 형식(hwp·docx·zip …)을 inline 으로 주면 브라우저가 제멋대로 해석할
 * 여지를 준다. 아는 것만 열어 주고 **나머지는 내려받기로 돌린다**.
 */
export function isViewable(mime: string): boolean {
  return (VIEWABLE_MIME as readonly string[]).includes(mime);
}

export interface UploadCheck {
  ok: boolean;
  /** 실제로 저장할 형식 — **확장자가 아니라 파일 앞머리로 가린 것** */
  mime?: ViewableMime;
  error?: string;
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  sig.every((v, i) => b[at + i] === v);

/** ASCII 문자열이 그 위치에 있는가 */
const hasAscii = (b: Uint8Array, s: string, at: number) =>
  startsWith(b, [...s].map((c) => c.charCodeAt(0)), at);

/**
 * **파일 앞머리(매직 넘버)로 형식을 가린다** — 확장자·브라우저가 보낸 Content-Type 을 믿지 않는다.
 *
 * 서버가 저장한 형식 그대로 `Content-Type` 을 붙여 돌려주므로, 확장자만 보고 받아 두면
 * 엉뚱한 파일을 브라우저에 `application/pdf` 라고 건네주게 된다. 앞머리는 위조가 가능하지만,
 * 적어도 **실수로 잘못 올린 파일**은 여기서 걸린다.
 */
export function sniffMime(bytes: Uint8Array): ViewableMime | "heic" | null {
  if (bytes.length < 12) return null;
  if (hasAscii(bytes, "%PDF-", 0)) return "application/pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasAscii(bytes, "RIFF", 0) && hasAscii(bytes, "WEBP", 8)) return "image/webp";
  // 아이폰 기본 촬영 형식 — 브라우저가 못 여는 곳이 많아 따로 가려내 안내한다
  if (hasAscii(bytes, "ftyp", 4) && (hasAscii(bytes, "heic", 8) || hasAscii(bytes, "heif", 8)))
    return "heic";
  return null;
}

/**
 * **화면에서 열어 볼 수 있는 형식인가** — 파일의 앞머리만 보면 되므로 첫 조각으로 판정한다.
 *
 * ⚠ **못 가려도 거절하지 않는다.** 인사서류는 hwp·docx 처럼 앞머리로 못 가리는 형식이
 * 흔하고, 담당자가 가진 파일이 그것뿐일 수 있다. 대신 `ok:false` 로 알려 부르는 쪽이
 * `application/octet-stream` 으로 담고 **열 때 내려받게** 한다.
 */
export function checkFormat(bytes: Uint8Array, name = ""): UploadCheck {
  if (!bytes.length) return { ok: false, error: "빈 파일입니다." };

  const kind = sniffMime(bytes);
  // HEIC 는 브라우저가 못 여는 곳이 많다 — 저장은 하되 화면에서 열리지는 않는다
  if (!kind || kind === "heic")
    return {
      ok: false,
      error: `화면에서 바로 열 수 없는 형식입니다${name ? ` (${name})` : ""} — 내려받아서 봅니다.`,
    };
  return { ok: true, mime: kind };
}

/** 사람이 읽는 크기 — 표에 나란히 서므로 자릿수를 한 자리로 맞춘다 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 목록 아이콘 — PDF·사진·그 밖의 문서를 눈으로 가른다 */
export function fileIcon(mime: string): string {
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("image/")) return "🖼";
  return "📎";
}

export function isPdf(mime: string): boolean {
  return mime === "application/pdf";
}

/** 저장한 형식에 맞는 확장자 — 올린 이름이 엉뚱해도 내려받을 때는 맞게 붙는다 */
export function extensionOf(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    // 모르는 형식은 확장자를 지어내지 않는다 — 올린 이름의 확장자를 그대로 두는 편이 맞다
    default:
      return "";
  }
}

/**
 * 저장할 파일 이름.
 *
 * 경로 구분자와 제어문자를 털어 낸다 — 이름이 그대로 `Content-Disposition` 에 실리므로
 * 줄바꿈이 들어가면 헤더가 쪼개진다(응답 헤더 주입). 한글은 그대로 둔다(그쪽이 읽기 좋고,
 * 내보낼 때 RFC 5987 로 감싼다).
 */
export function safeName(raw: string, mime: string): string {
  const base = String(raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 120);
  const ext = extensionOf(mime);
  if (!base) return ext ? `첨부파일.${ext}` : "첨부파일";
  if (/\.[A-Za-z0-9]{1,5}$/.test(base) || !ext) return base;
  return `${base}.${ext}`;
}

/**
 * `Content-Disposition` 헤더 값.
 *
 * 한글 이름은 ASCII 로 못 적으므로 **`filename*` (RFC 5987)** 으로 싣고, 못 읽는 옛
 * 브라우저를 위해 ASCII 로 눌러쓴 `filename` 도 함께 준다. 둘 중 하나만 두면
 * 이름이 깨지거나(앞) 아예 안 붙는다(뒤).
 */
export function contentDisposition(name: string, mime: string, download = false): string {
  const safe = safeName(name, mime);
  const ascii = safe.replace(/[^\u0020-\u007e]/g, "_").replace(/"/g, "'");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** 첨부 요약 한 줄 — 카드에 "2건 · 1.4MB" 로 적는다 */
export function attachmentSummary(files: Array<{ size: number }>): string | null {
  if (!files.length) return null;
  const total = files.reduce((a, f) => a + f.size, 0);
  return `${files.length}건 · ${formatSize(total)}`;
}
