"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSize, fileIcon, MAX_UPLOAD_BYTES } from "@/lib/contract-file";

export interface ContractFileRow {
  id: number;
  name: string;
  mime: string;
  size: number;
  note: string | null;
  /** YYYY-MM-DD — 서버에서 문자열로 내려준다(하이드레이션이 어긋나지 않게) */
  uploadedAt: string;
  /** DB | DRIVE — 어디에 담겼는지. 두 방식이 섞여 산다 */
  storage?: string;
  /** 구글 드라이브에서 바로 열어 보는 주소 (드라이브 보관분만) */
  driveWebLink?: string | null;
}

/**
 * 계약 카드 안의 **서명본 스캔 첨부**.
 *
 * 시스템이 뽑는 *계약서 발급* 과 나란히 서지만 뜻이 다르다 — 발급본은 지금 조건으로 새로
 * 만드는 서식이라 조건을 고치면 따라 바뀌고, 스캔본은 실제로 서명·날인해 주고받은 원본이라
 * 그대로 남는다. **분쟁 때 근거가 되는 쪽은 스캔본**이라 그 사실을 화면에도 적는다.
 *
 * 열기는 `<a target="_blank">` 로 한다 — `window.open` 을 `await` 뒤에서 부르면 팝업
 * 차단에 걸리므로(lib/open-pdf.ts), 애초에 주소가 정해져 있는 링크는 링크로 둔다.
 */
export default function ContractFiles({
  contractId,
  files,
}: {
  contractId: number;
  files: ContractFileRow[];
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setErr("");

    // **보내기 전에 크기를 먼저 본다** — Vercel 서버리스는 4.5MB 를 넘는 요청 본문을
    // 함수에 닿기도 전에 잘라 버려서, 그대로 보내면 화면에는 알 수 없는 오류만 남는다.
    const big = Array.from(list).filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (big.length) {
      setErr(
        `${big.map((f) => `${f.name}(${formatSize(f.size)})`).join(", ")} — 파일당 ` +
          `${formatSize(MAX_UPLOAD_BYTES)} 까지만 올릴 수 있습니다. 스캔 해상도를 200~300dpi 로 ` +
          `낮추거나 흑백으로 다시 스캔해 보세요.`
      );
      if (input.current) input.current.value = "";
      return;
    }

    const fd = new FormData();
    for (const f of Array.from(list)) fd.append("file", f);
    setBusy(true);
    const res = await fetch(`/api/contracts/${contractId}/files`, { method: "POST", body: fd }).catch(
      () => null
    );
    setBusy(false);
    if (input.current) input.current.value = "";
    if (!res) return setErr("업로드에 실패했습니다. 연결을 확인해 주세요.");
    const j = await res.json().catch(() => ({}) as any);
    if (!res.ok) return setErr(j.error || "업로드에 실패했습니다.");
    // 일부만 걸러졌으면 무엇이 왜 빠졌는지 남긴다 (조용히 빠지면 올린 줄 안다)
    if (j.failed?.length) setErr(j.failed.join("\n"));
    // 드라이브가 켜져 있는데 실패한 경우 — 파일은 DB 에 받아 뒀지만 그 사실을 알려 준다
    else if (j.driveFallback)
      setErr(`구글 드라이브에 올리지 못해 DB 에 보관했습니다.\n${j.driveFallback}`);
    router.refresh();
  }

  async function remove(f: ContractFileRow) {
    if (
      !confirm(
        `‘${f.name}’ 을(를) 지웁니다.\n\n서명본 스캔은 되돌릴 수 없습니다 — 종이 원본을 다시 스캔해야 합니다.`
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/contract-files/${f.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setErr("삭제하지 못했습니다.");
    router.refresh();
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-500">
          서명본 스캔
          {files.length > 0 && <span className="text-slate-400 font-normal"> · {files.length}건</span>}
        </span>
        <button
          type="button"
          className="text-[11px] text-brand-600 font-semibold hover:underline disabled:text-slate-300"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "올리는 중…" : "＋ 스캔본 첨부"}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </div>

      {files.length === 0 ? (
        <p className="text-[11px] text-slate-400 mt-1">
          서명·날인한 원본을 올려 두세요. 위 <b>계약서 발급</b>은 지금 조건으로 새로 뽑는 서식이라
          조건을 고치면 함께 바뀌지만, 스캔본은 그대로 남습니다.
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-xs group">
              <a
                href={`/api/contract-files/${f.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-slate-700 hover:text-brand-600 hover:underline truncate"
                title={f.note ? `${f.name} — ${f.note}` : f.name}
              >
                {fileIcon(f.mime)} {f.name}
              </a>
              <span className="text-[10px] text-slate-400 tnum shrink-0">
                {formatSize(f.size)} · {f.uploadedAt}
              </span>
              {/* 어디에 담겼는지 — 드라이브로 옮기는 중에는 두 방식이 섞여 살아서,
                  이 표시가 없으면 무엇이 드라이브에 있는지 알 수가 없다 */}
              {f.storage === "DRIVE" ? (
                f.driveWebLink ? (
                  <a
                    href={f.driveWebLink}
                    target="_blank"
                    rel="noreferrer"
                    className="pill bg-emerald-50 text-emerald-700 text-[9px] shrink-0 hover:underline"
                    title="구글 드라이브에서 열기"
                  >
                    Drive ↗
                  </a>
                ) : (
                  <span className="pill bg-emerald-50 text-emerald-700 text-[9px] shrink-0">Drive</span>
                )
              ) : (
                <span
                  className="pill bg-slate-100 text-slate-500 text-[9px] shrink-0"
                  title="이 파일은 DB 에 보관돼 있습니다"
                >
                  DB
                </span>
              )}
              <a
                href={`/api/contract-files/${f.id}?download=1`}
                className="text-[10px] text-slate-400 hover:text-brand-600 shrink-0 ml-auto"
                title="내려받기"
              >
                ↓
              </a>
              <button
                type="button"
                className="text-[10px] text-slate-300 hover:text-rose-600 shrink-0"
                disabled={busy}
                onClick={() => remove(f)}
                title="삭제"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {err && <p className="text-[11px] text-rose-600 mt-1 whitespace-pre-line">{err}</p>}
    </div>
  );
}
