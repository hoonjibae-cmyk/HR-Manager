// 회사 이미지(로고·법인인감) 업로드 검증 — 로고와 인감이 같은 규칙을 쓴다.
//
// **파일이 아니라 data URI 로 DB 에 담는다** — 서버리스(Vercel)에는 쓸 수 있는 파일 경로가 없고,
// 재배포 없이 화면에서 바꿀 수 있어야 하며, 문서 PDF 도 이 값을 그대로 `<img src>` 에 쓴다.

/** 허용 형식. 화면에서 미리 줄여 보내므로 실제로는 대개 PNG 로 들어온다 */
export const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/** DB 한 칸에 담기므로 넉넉하되 상한을 둔다 (브라우저에서 줄여 보내면 보통 30KB 내외) */
export const MAX_IMAGE_BYTES = 400_000;

export type ImageCheck =
  | { ok: true; mime: string; bytes: number }
  | { ok: false; error: string };

/** data URI 문자열을 검사한다 (형식·형식종류·용량) */
export function checkDataUrl(dataUrl: string): ImageCheck {
  const m = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ""));
  if (!m)
    return { ok: false, error: "이미지를 읽지 못했습니다. PNG · JPG · SVG 파일을 올려 주세요." };
  const [, mime, b64] = m;
  if (!ALLOWED_IMAGE_MIME.includes(mime.toLowerCase()))
    return { ok: false, error: `지원하지 않는 형식입니다 (${mime}). PNG · JPG · WEBP · SVG 만 됩니다.` };
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES)
    return {
      ok: false,
      error: `파일이 너무 큽니다 (${Math.round(bytes / 1024)}KB). 400KB 이하로 줄여 주세요.`,
    };
  return { ok: true, mime, bytes };
}
