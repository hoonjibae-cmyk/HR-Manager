"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** 문서 머리글에 30px 높이로 들어가므로 그 3배까지만 남기면 충분하다 */
const MAX_EDGE = 320;

/**
 * 학원 로고 업로드.
 *
 * 큰 사진을 그대로 DB 에 넣으면 문서 PDF 가 무거워지므로 **브라우저에서 미리 줄여** 보낸다
 * (원본 png 를 그대로 올려도 되게 하려는 것 — 사용자가 크기를 맞출 필요가 없다).
 * SVG 는 벡터라 줄이지 않고 그대로 보낸다.
 */
export default function LogoUpload({ logo }: { logo: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<string | null>(logo);

  async function shrink(file: File): Promise<string> {
    const raw = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error("파일을 읽지 못했습니다."));
      fr.readAsDataURL(file);
    });
    if (file.type === "image/svg+xml") return raw;

    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("이미지를 열지 못했습니다."));
      i.src = raw;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    if (scale >= 1 && raw.length < 200_000) return raw; // 이미 충분히 작다

    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * scale);
    cv.height = Math.round(img.height * scale);
    const ctx = cv.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    // PNG 로 내보내 투명 배경을 살린다 (로고는 대개 배경이 뚫려 있다)
    return cv.toDataURL("image/png");
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const dataUrl = await shrink(file);
      const res = await fetch("/api/settings/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "업로드에 실패했습니다.");
      setPreview(dataUrl);
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("로고를 삭제할까요? 문서와 화면에서 회사명만 표시됩니다.")) return;
    setBusy(true);
    await fetch("/api/settings/logo", { method: "DELETE" });
    setPreview(null);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-1">학원 로고</h2>
      <p className="text-xs text-slate-400 mb-4">
        화면 왼쪽 위와 계약서·급여명세서·증명서 머리글에 함께 표시됩니다. PNG · JPG · SVG 모두 됩니다.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <div className="w-44 h-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="학원 로고" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-xs text-slate-400">등록된 로고 없음</span>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              className="btn-primary"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {busy ? "올리는 중…" : preview ? "다른 파일로 바꾸기" : "로고 올리기"}
            </button>
            {preview && (
              <button className="btn-ghost text-red-500" onClick={remove} disabled={busy}>
                삭제
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            큰 사진을 골라도 알아서 줄여 저장합니다. 배경이 없는(투명) PNG 가 가장 깔끔합니다.
          </p>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={onPick}
      />
    </div>
  );
}
