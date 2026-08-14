"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSize, fileIcon } from "@/lib/contract-file";
import { chunkCount, chunkRange, checkFileSize, progressLabel } from "@/lib/upload-chunk";

export interface ContractFileRow {
  id: number;
  name: string;
  mime: string;
  size: number;
  note: string | null;
  /** YYYY-MM-DD — 서버에서 문자열로 내려준다(하이드레이션이 어긋나지 않게) */
  uploadedAt: string;
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
  /** 올리는 중 표시 — 큰 파일은 수십 초라, 없으면 멈춘 줄 알고 새로고침한다 */
  const [progress, setProgress] = useState("");

  /**
   * **조각내 올린다.**
   *
   * Vercel 서버리스 함수의 요청 본문 상한이 4.5MB 라, 큰 스캔본을 한 번에 보내면
   * 함수에 닿기도 전에 플랫폼이 잘라 버리고 화면에는 아무 단서도 남지 않는다.
   * 그래서 `자리 잡기 → 조각 보내기 → (마지막 조각에서 서버가 이어 붙임)` 으로 나눈다.
   *
   * 파일이 여러 개면 **한 번에 하나씩** 보낸다 — 동시에 던지면 서버리스 함수가 그만큼
   * 한꺼번에 뜨고, 진행률도 뒤엉켜 무엇이 얼마나 갔는지 알 수 없게 된다.
   */
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setErr("");
    const files = Array.from(list);

    // 보내기 전에 크기부터 본다 — 다 보내고 나서 거절하면 시간만 버린다
    for (const f of files) {
      const c = checkFileSize(f.size, f.name);
      if (!c.ok) {
        setErr(c.error!);
        if (input.current) input.current.value = "";
        return;
      }
    }

    setBusy(true);
    const failures: string[] = [];

    for (const f of files) {
      let uploadId = "";
      try {
        const init = await fetch(`/api/contracts/${contractId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: f.name, size: f.size }),
        });
        const ij = await init.json().catch(() => ({}) as any);
        if (!init.ok) throw new Error(ij.error || "업로드를 시작하지 못했습니다.");
        uploadId = ij.uploadId;

        const total = chunkCount(f.size);
        for (let i = 0; i < total; i++) {
          const { start, end } = chunkRange(i, f.size);
          setProgress(progressLabel(start, f.size, f.name));
          const res = await fetch(`/api/contract-files/upload/${uploadId}?index=${i}`, {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: f.slice(start, end),
          });
          const j = await res.json().catch(() => ({}) as any);
          if (!res.ok) throw new Error(j.error || `${i + 1}번째 조각을 보내지 못했습니다.`);
        }
        setProgress(progressLabel(f.size, f.size, f.name));
      } catch (e: any) {
        failures.push(`${f.name} — ${e.message}`);
        // 올리다 만 자리를 치운다 — 두면 목록에는 안 보이지만 DB 에 쌓인다
        if (uploadId)
          await fetch(`/api/contract-files/upload/${uploadId}`, { method: "DELETE" }).catch(() => {});
      }
    }

    setBusy(false);
    setProgress("");
    if (input.current) input.current.value = "";
    if (failures.length) setErr(failures.join("\n"));
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

      {progress && (
        <p className="text-[11px] text-brand-600 mt-1 tnum" aria-live="polite">
          {progress}
        </p>
      )}
      {err && <p className="text-[11px] text-rose-600 mt-1 whitespace-pre-line">{err}</p>}
    </div>
  );
}
