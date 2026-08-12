"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 문서에는 20mm(≈236px @300dpi)로 찍히므로 그 이상은 파일만 무거워진다.
 * 로고(320)보다 크게 잡는 것은 도장 테두리·전각(篆刻) 획이 가늘어 인쇄에서 뭉개지기 쉬워서다.
 */
const MAX_EDGE = 512;

/**
 * 법인 인감(직인) 업로드.
 *
 * 로고와 같은 방식이지만 **투명 배경 유지가 훨씬 중요하다** — 도장은 이름 위에 겹쳐 찍히므로
 * 흰 배경이 남아 있으면 글자를 덮어 버린다. 그래서 캔버스를 지우고 그린 뒤 반드시 PNG 로 내보내고,
 * 미리보기도 체크무늬 위에 얹어 배경이 뚫려 있는지 눈으로 확인하게 한다.
 */
export default function StampUpload({
  stamp,
  seam,
  initials,
}: {
  stamp: string | null;
  seam: boolean;
  initials: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [preview, setPreview] = useState<string | null>(stamp);
  const [useSeam, setUseSeam] = useState(seam);
  const [useInitials, setUseInitials] = useState(initials);

  /** 2장 이상 계약서 장치 저장 — 보낸 항목만 바뀐다 */
  async function saveOption(body: { seam?: boolean; initials?: boolean }) {
    setBusy(true);
    await fetch("/api/settings/stamp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  /** 네 모서리가 모두 불투명하면 누끼를 안 딴 사각 사진일 가능성이 높다 */
  function looksOpaque(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
    const pts: Array<[number, number]> = [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
    ];
    return pts.every(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] > 250);
  }

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
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.width * scale));
    cv.height = Math.max(1, Math.round(img.height * scale));
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return raw;
    ctx.clearRect(0, 0, cv.width, cv.height); // 투명하게 시작 — 흰 배경을 깔지 않는다
    ctx.drawImage(img, 0, 0, cv.width, cv.height);

    setWarn(
      looksOpaque(ctx, cv.width, cv.height)
        ? "배경이 뚫려 있지 않은 것 같습니다. 흰 사각형이 이름을 덮을 수 있으니 누끼(배경 제거)된 PNG 를 권합니다."
        : ""
    );
    // 반드시 PNG — JPG 로 내보내면 투명 배경이 검게 채워진다
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
      const res = await fetch("/api/settings/stamp", {
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
    if (!confirm("법인 인감을 삭제할까요?\n이후 발급되는 문서에는 (인)·(직인) 글자만 찍힙니다."))
      return;
    setBusy(true);
    await fetch("/api/settings/stamp", { method: "DELETE" });
    setPreview(null);
    setWarn("");
    setBusy(false);
    router.refresh();
  }

  // 배경이 뚫려 있는지 눈으로 보이게 체크무늬를 깐다
  const checker =
    "repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%) 50% / 12px 12px";

  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-1">법인 인감 (직인)</h2>
      <p className="text-xs text-slate-400 mb-4">
        등록하면 <b>근로·위탁계약서의 &ldquo;갑&rdquo; 대표자</b> 칸과 <b>재직·경력증명서</b>의
        대표이사 옆에 자동으로 찍힙니다. A4 인쇄 기준 <b>20mm</b>(계약서는 17mm)로 나갑니다.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <div
          className="w-24 h-24 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden"
          style={{ background: preview ? checker : undefined }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="법인 인감" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-[11px] text-slate-400 text-center px-2">등록된 인감 없음</span>
          )}
        </div>

        {/* 실제 문서에서 어떻게 보이는지 그대로 미리 보여 준다 */}
        {/* 도장이 이름 오른쪽으로 삐져나오므로 오른쪽 여백을 넉넉히 둔다 */}
        <div className="rounded-lg border border-slate-200 bg-white pl-4 pr-14 py-3 text-sm">
          <div className="text-[11px] text-slate-400 mb-1">문서에 찍히는 모습</div>
          <div className="relative inline-block leading-8">
            <span className="text-slate-500 mr-1.5">대표자</span>
            <b className="text-slate-800">유은정</b>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt=""
                className="absolute w-[52px] h-[52px] object-contain pointer-events-none"
                style={{ left: "calc(100% - 8px)", top: "50%", transform: "translateY(-55%)" }}
              />
            ) : (
              <span className="text-red-700 font-bold ml-1">(인)</span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? "올리는 중…" : preview ? "다른 파일로 바꾸기" : "인감 올리기"}
            </button>
            {preview && (
              <button className="btn-ghost text-red-500" onClick={remove} disabled={busy}>
                삭제
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 max-w-xs">
            배경을 지운(누끼) <b>PNG</b> 를 올려 주세요 — 도장이 이름 위에 겹쳐 찍히므로 흰 배경이
            남아 있으면 글자를 덮습니다. 큰 사진은 알아서 줄여 저장합니다.
          </p>
          {/* 찍히는 크기는 이미지의 여백에 좌우된다 — 사람이 알고 올려야 자로 재서 맞출 수 있다 */}
          <p className="text-[11px] text-slate-400 max-w-xs">
            문서에 찍히는 크기는 <b>도장 둘레의 여백까지 포함해</b> 맞춰집니다. 지금은 실물 인감
            <b> 지름 18mm</b> 에 맞춰 두었으니, <b>여백을 더 바짝 자른 이미지</b>로 바꾸면 그만큼
            크게 찍힙니다. 바꾼 뒤에는 계약서를 한 장 뽑아 자로 재 보고, 다르면 알려 주세요.
          </p>
          {warn && <p className="text-xs text-amber-600 max-w-xs">⚠️ {warn}</p>}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      </div>

      {/* 2장 이상 계약서 — 장이 바뀌어도 같은 계약서임을 보이는 장치들 */}
      <div className="mt-4 border-t border-slate-100 pt-3 space-y-2.5">
        <div className="text-xs font-semibold text-slate-500">2장 이상 계약서</div>

        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="w-4 h-4 mt-0.5"
            checked={useInitials}
            disabled={busy}
            onChange={(e) => {
              setUseInitials(e.target.checked);
              saveOption({ initials: e.target.checked });
            }}
          />
          <span className="text-slate-600">
            각 장 <b>이니셜란</b> — <span className="text-slate-400">갑 (서명) ____ 을 (서명) ____</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">
              장마다 서명을 받으면 <b>민사소송법 §358</b>(서명·날인이 있는 사문서는 진정한 것으로 추정)이
              그 장에 직접 걸립니다. 간인보다 확실한 방법입니다.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="w-4 h-4 mt-0.5"
            checked={useSeam}
            disabled={busy || !preview}
            onChange={(e) => {
              setUseSeam(e.target.checked);
              saveOption({ seam: e.target.checked });
            }}
          />
          <span className={preview ? "text-slate-600" : "text-slate-400"}>
            <b>간인</b> 찍기 — 장 경계마다 인감을 반씩
            <span className="block text-[11px] text-slate-400 mt-0.5">
              앞장 오른쪽 끝·뒷장 왼쪽 끝에 반씩 찍혀, 종이를 접으면 맞물립니다. 종이 관행을 옮긴 것으로
              <b> 법으로 정해진 의무는 아닙니다</b>.{!preview && " (인감을 먼저 등록하세요)"}
            </span>
          </span>
        </label>

        <p className="text-[11px] text-slate-400">쪽번호(1 / 2)는 2장 이상이면 항상 붙습니다.</p>
      </div>

      <p className="text-[11px] text-slate-400 mt-3 border-t border-slate-100 pt-3">
        이미 발급해 둔 PDF 는 그대로입니다 — 인감은 <b>발급하는 시점</b>에 찍히므로, 기존 문서에
        넣으려면 다시 발급하세요.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/svg+xml"
        className="hidden"
        onChange={onPick}
      />
    </div>
  );
}
