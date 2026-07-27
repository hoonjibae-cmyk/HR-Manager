"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * 연차 관리시트(엑셀) → 사용 내역 일괄 등록.
 * 발생(부여)은 가져오지 않는다 — 시트는 회계연도, 이 시스템은 입사일 기준이라 총일수가 다르다.
 */
export default function LeaveImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState<number | null>(null);

  async function send(mode: "preview" | "commit", f?: File, y?: number | null) {
    const target = f ?? file;
    if (!target) return;
    setBusy(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", target);
    fd.append("mode", mode);
    const yr = y === undefined ? year : y;
    if (yr) fd.append("year", String(yr));
    const res = await fetch("/api/leave/import", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error || "처리에 실패했습니다.");
    if (mode === "preview") {
      setPreview(j);
      setYear(j.year);
      return;
    }
    alert(
      `등록 완료 — ${j.employeeCount}명 / ${j.addedCount}건` +
        (j.skipCount ? `\n이미 있어 건너뜀: ${j.skipCount}건` : "")
    );
    setOpen(false);
    setPreview(null);
    setFile(null);
    router.refresh();
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(null);
    setYear(null);
    send("preview", f, null);
  }

  if (!open)
    return (
      <button className="btn-outline" onClick={() => setOpen(true)}>
        연차 시트 가져오기
      </button>
    );

  const rows: any[] = preview?.rows ?? [];

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="card w-full max-w-5xl my-8 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">연차 관리시트 가져오기</h2>
            <p className="text-xs text-slate-500 mt-1">
              쓰시던 엑셀 관리시트의 <b>사용 내역</b>만 가져옵니다. 연차 <b>발생일수는 이 시스템이
              입사일 기준(근로기준법)으로 계산한 값</b>을 그대로 쓰므로, 시트의 회계연도 기준
              총일수와 다를 수 있습니다.
            </p>
          </div>
          <button
            className="btn-ghost"
            onClick={() => {
              setOpen(false);
              setPreview(null);
              setFile(null);
              setErr("");
            }}
          >
            닫기
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "읽는 중…" : "파일 선택"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={pick} />
          {file && <span className="text-xs text-slate-500">{file.name}</span>}
          {preview?.availableYears?.length > 1 && (
            <select
              className="input w-auto text-xs"
              value={year ?? preview.year}
              onChange={(e) => {
                const y = Number(e.target.value);
                setYear(y);
                send("preview", undefined, y);
              }}
            >
              {preview.availableYears.map((y: number) => (
                <option key={y} value={y}>
                  {y}년 시트
                </option>
              ))}
            </select>
          )}
        </div>

        {err && <p className="text-sm text-red-600 whitespace-pre-line mb-3">{err}</p>}

        {preview && (
          <>
            <div className="flex flex-wrap gap-3 text-sm mb-3">
              <span className="pill bg-slate-100 text-slate-600">{preview.year}년</span>
              <span className="pill bg-emerald-50 text-emerald-700">
                직원 찾음 {preview.matchedCount}
              </span>
              <span className="pill bg-brand-50 text-brand-700">등록할 항목 {preview.addCount}건</span>
              {preview.skipCount > 0 && (
                <span className="pill bg-slate-100 text-slate-500">
                  이미 있음 {preview.skipCount}건
                </span>
              )}
              {preview.duplicateCount > 0 && (
                <span className="pill bg-amber-50 text-amber-700">
                  시트 내 날짜 중복 {preview.duplicateCount}건
                </span>
              )}
              {preview.errorCount > 0 && (
                <span className="pill bg-red-50 text-red-700">오류 {preview.errorCount}</span>
              )}
            </div>

            {preview.unknownKinds?.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                모르는 휴가종류는 건너뜁니다: {preview.unknownKinds.join(", ")}
              </p>
            )}

            <div className="border border-slate-200 rounded-lg overflow-auto max-h-[50vh]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="th">성명</th>
                    <th className="th text-right">연차</th>
                    <th className="th text-right">대휴</th>
                    <th className="th">사용일자</th>
                    <th className="th">확인사항</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const annual = r.adds
                      .filter((e: any) => e.category === "STATUTORY")
                      .reduce((a: number, e: any) => a + e.days, 0);
                    const comp = r.adds
                      .filter((e: any) => e.category === "COMP")
                      .reduce((a: number, e: any) => a + e.days, 0);
                    return (
                      <tr key={r.rowNo} className={r.errors.length ? "bg-red-50" : ""}>
                        <td className="td font-semibold align-top">
                          {r.name}
                          {r.rawName !== r.name && (
                            <div className="text-[10px] text-slate-400 font-normal">{r.rawName}</div>
                          )}
                        </td>
                        <td className="td text-right tnum align-top">{annual || "-"}</td>
                        <td className="td text-right tnum align-top text-slate-500">
                          {comp || "-"}
                        </td>
                        <td className="td">
                          {r.adds.map((e: any, i: number) => (
                            <span key={i} className="inline-block mr-2 whitespace-nowrap">
                              {e.date.slice(5)}
                              <span className="text-slate-400">
                                {e.label === "연차" ? "" : `(${e.label})`}
                              </span>
                            </span>
                          ))}
                          {r.skipped.length > 0 && (
                            <div className="text-slate-300 mt-1">
                              이미 있음 {r.skipped.length}건:{" "}
                              {r.skipped.map((e: any) => e.date.slice(5)).join(", ")}
                            </div>
                          )}
                          {r.duplicates.length > 0 && (
                            <div className="text-amber-600 mt-1">
                              시트에 두 번 적힘:{" "}
                              {r.duplicates.map((e: any) => e.date.slice(5)).join(", ")}
                            </div>
                          )}
                          {r.nonDeducting.length > 0 && (
                            <div className="text-slate-400 mt-1">
                              차감 없음(기록 안 함):{" "}
                              {r.nonDeducting
                                .map((e: any) => `${e.date.slice(5)} ${e.label}`)
                                .join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="td align-top">
                          {r.errors.map((e: string, i: number) => (
                            <div key={i} className="text-red-600">
                              ✕ {e}
                            </div>
                          ))}
                          {r.warnings.map((w: string, i: number) => (
                            <div key={i} className="text-amber-600">
                              ! {w}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-slate-400">
                같은 날짜로 이미 기록된 사용분은 건너뜁니다 — 두 번 올려도 중복되지 않습니다.
              </p>
              <button
                className="btn-primary"
                disabled={busy || preview.addCount === 0}
                onClick={() => {
                  if (
                    confirm(
                      `${preview.year}년 사용 내역 ${preview.addCount}건을 등록합니다.` +
                        (preview.errorCount
                          ? `\n오류 ${preview.errorCount}명은 제외됩니다.`
                          : "")
                    )
                  )
                    send("commit");
                }}
              >
                {busy ? "등록 중…" : `${preview.addCount}건 등록`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
