"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { PAY_SCHEME_LABEL, INCOME_TYPE_LABEL } from "@/lib/constants";
import { won } from "@/lib/format";

interface Row {
  rowNo: number;
  name: string;
  department?: string;
  position?: string;
  hireDate: string;
  incomeType: string;
  payScheme: string;
  baseWage: number;
  ratioPercent: number | null;
  email?: string;
  errors: string[];
  warnings: string[];
}

/** 엑셀 명단 → 미리보기 → 확정 등록 */
export default function EmployeeImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);

  async function send(mode: "preview" | "commit", f?: File) {
    const target = f ?? file;
    if (!target) return;
    setBusy(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", target);
    fd.append("mode", mode);
    const res = await fetch("/api/employees/import", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error || "처리에 실패했습니다.");
    if (mode === "preview") {
      setPreview(j);
      return;
    }
    alert(
      `등록 완료 — ${j.createdCount}명` +
        (j.skippedCount ? `\n오류로 제외: ${j.skippedCount}명` : "")
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
    send("preview", f);
  }

  if (!open)
    return (
      <button className="btn-outline" onClick={() => setOpen(true)}>
        명단 일괄 등록
      </button>
    );

  const rows: Row[] = preview?.rows ?? [];

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="card w-full max-w-5xl my-8 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">직원 명단 일괄 등록</h2>
            <p className="text-xs text-slate-500 mt-1">
              엑셀(.xlsx) 또는 CSV 파일을 올리면 내용을 먼저 확인한 뒤 등록합니다.
              각 직원의 <b>초기 계약</b>도 함께 만들어집니다.
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
          <a href="/api/employees/import" className="btn-outline">
            빈 양식 내려받기
          </a>
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "읽는 중…" : "파일 선택"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={pick}
          />
          {file && <span className="text-xs text-slate-500">{file.name}</span>}
        </div>

        {err && <p className="text-sm text-red-600 whitespace-pre-line mb-3">{err}</p>}

        {preview && (
          <>
            <div className="flex flex-wrap gap-3 text-sm mb-3">
              <span className="pill bg-slate-100 text-slate-600">읽은 행 {preview.total}</span>
              <span className="pill bg-emerald-50 text-emerald-700">등록 가능 {preview.validCount}</span>
              {preview.errorCount > 0 && (
                <span className="pill bg-red-50 text-red-700">오류 {preview.errorCount}</span>
              )}
              {preview.alreadyRegistered > 0 && (
                <span className="pill bg-amber-50 text-amber-700">
                  이미 등록된 직원 {preview.alreadyRegistered}명 있음
                </span>
              )}
            </div>

            {preview.unknownHeaders?.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                인식하지 못한 열은 무시했습니다: {preview.unknownHeaders.join(", ")}
              </p>
            )}

            <div className="border border-slate-200 rounded-lg overflow-auto max-h-[50vh]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="th">행</th>
                    <th className="th">성명</th>
                    <th className="th">부서·직책</th>
                    <th className="th">입사일</th>
                    <th className="th">구분</th>
                    <th className="th text-right">보수</th>
                    <th className="th">이메일</th>
                    <th className="th">확인사항</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNo} className={r.errors.length ? "bg-red-50" : ""}>
                      <td className="td tnum text-slate-400">{r.rowNo}</td>
                      <td className="td font-semibold">{r.name}</td>
                      <td className="td text-slate-500">
                        {r.department ?? "-"} {r.position ?? ""}
                      </td>
                      <td className="td tnum">{r.hireDate || "-"}</td>
                      <td className="td text-slate-500">
                        {INCOME_TYPE_LABEL[r.incomeType]} · {PAY_SCHEME_LABEL[r.payScheme]}
                      </td>
                      <td className="td text-right tnum">
                        {r.payScheme === "RATIO"
                          ? `${((r.ratioPercent ?? 0) * 100).toFixed(1)}%`
                          : won(r.baseWage)}
                      </td>
                      <td className="td text-slate-400">{r.email ?? "-"}</td>
                      <td className="td">
                        {r.errors.map((e, i) => (
                          <div key={i} className="text-red-600">
                            ✕ {e}
                          </div>
                        ))}
                        {r.warnings.map((w, i) => (
                          <div key={i} className="text-amber-600">
                            ! {w}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-slate-400">
                ✕ 표시된 행은 등록되지 않습니다. 파일을 고쳐 다시 올려 주세요.
              </p>
              <button
                className="btn-primary"
                disabled={busy || preview.validCount === 0}
                onClick={() => {
                  if (
                    confirm(
                      `${preview.validCount}명을 등록합니다.` +
                        (preview.errorCount ? `\n오류 ${preview.errorCount}명은 제외됩니다.` : "")
                    )
                  )
                    send("commit");
                }}
              >
                {busy ? "등록 중…" : `${preview.validCount}명 등록`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
