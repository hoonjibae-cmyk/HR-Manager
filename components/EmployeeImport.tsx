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

type Tab = "create" | "fill" | "bank";

/** 엑셀 명단 → 미리보기 → 확정 등록 / 기존 직원 정보 채우기 / 은행 이체 양식으로 계좌 등록 */
export default function EmployeeImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("create");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  async function send(kind: "preview" | "commit", f?: File, ow?: boolean) {
    const target = f ?? file;
    if (!target) return;
    setBusy(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", target);
    fd.append("mode", tab === "fill" ? `fill-${kind}` : kind);
    if (tab !== "create") fd.append("overwrite", (ow ?? overwrite) ? "1" : "0");
    const url = tab === "bank" ? "/api/employees/bank-import" : "/api/employees/import";
    const res = await fetch(url, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error || "처리에 실패했습니다.");
    if (kind === "preview") {
      setPreview(j);
      return;
    }
    alert(
      tab === "bank"
        ? `계좌 등록 완료 — ${j.updatedCount}명 / ${j.changeCount}건` +
            (j.unmatched?.length ? `\n등록된 직원이 없어 건너뜀: ${j.unmatched.join(", ")}` : "")
        : tab === "fill"
        ? `채우기 완료 — ${j.updatedCount}명 / ${j.changeCount}건`
        : `등록 완료 — ${j.createdCount}명` +
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

  function switchTab(t: Tab) {
    setTab(t);
    setPreview(null);
    setFile(null);
    setErr("");
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
            <h2 className="font-bold text-slate-800 text-lg">
              {tab === "create"
                ? "직원 명단 일괄 등록"
                : tab === "fill"
                ? "기존 직원 정보 채우기"
                : "급여 계좌 일괄 등록"}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {tab === "create" ? (
                <>
                  엑셀(.xlsx) 또는 CSV 파일을 올리면 내용을 먼저 확인한 뒤 등록합니다.
                  각 직원의 <b>초기 계약</b>도 함께 만들어집니다.
                </>
              ) : tab === "fill" ? (
                <>
                  이미 등록된 직원의 <b>비어 있는 인적사항</b>(이메일·주민번호·연락처 등)만 채웁니다.
                  기본급·수당 등 보수조건은 계약에서만 바꿀 수 있어 이 화면으로는 변경되지 않습니다.
                </>
              ) : (
                <>
                  은행 <b>대량이체(파일이체) 양식</b>을 그대로 올리면 <b>예상예금주</b> 이름으로 직원을 찾아
                  은행·계좌번호를 채웁니다. 입금통장표시가 <b>퇴직유보금</b>인 줄은 유보금 전용 통장으로 들어갑니다.
                </>
              )}
            </p>
          </div>
          <button
            className="btn-ghost shrink-0"
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

        <div className="flex gap-1 mb-4 border-b border-slate-200">
          {([
            ["create", "신규 등록"],
            ["fill", "정보 채우기"],
            ["bank", "계좌 등록"],
          ] as Array<[Tab, string]>).map(([k, label]) => (
            <button
              key={k}
              className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${
                tab === k
                  ? "border-brand-500 text-brand-600"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
              onClick={() => switchTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {tab !== "bank" ? (
            <a
              href={tab === "fill" ? "/api/employees/import?kind=fill" : "/api/employees/import"}
              className="btn-outline"
            >
              {tab === "fill" ? "직원 명단 깔린 양식 내려받기" : "빈 양식 내려받기"}
            </a>
          ) : (
            <span className="text-xs text-slate-500">
              은행에서 내려받은 <b>대량이체 양식(.xls)</b>을 그대로 올리세요.
            </span>
          )}
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

        {preview && tab !== "create" && (
          <>
            <div className="flex flex-wrap gap-3 text-sm mb-3">
              <span className="pill bg-slate-100 text-slate-600">읽은 행 {preview.total}</span>
              <span className="pill bg-emerald-50 text-emerald-700">
                직원 찾음 {preview.matchedCount}
              </span>
              <span className="pill bg-brand-50 text-brand-700">채울 항목 {preview.changeCount}건</span>
              {preview.errorCount > 0 && (
                <span className="pill bg-red-50 text-red-700">오류 {preview.errorCount}</span>
              )}
              {preview.skipped > 0 && (
                <span className="pill bg-amber-50 text-amber-700">
                  계좌가 비어 건너뛴 줄 {preview.skipped}
                </span>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs mb-3">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={overwrite}
                onChange={(e) => {
                  setOverwrite(e.target.checked);
                  send("preview", undefined, e.target.checked);
                }}
              />
              <span>
                이미 값이 있는 항목도 <b>덮어쓰기</b>
                <span className="text-slate-400">
                  {tab === "bank"
                    ? " (기본은 비어 있는 계좌만 채웁니다 — 잘못 덮어쓰면 돈이 남에게 갑니다)"
                    : " (기본은 비어 있는 항목만 채웁니다)"}
                </span>
              </span>
            </label>

            <div className="border border-slate-200 rounded-lg overflow-auto max-h-[50vh]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="th">행</th>
                    <th className="th">성명</th>
                    <th className="th">채울 내용</th>
                    <th className="th">확인사항</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.rows ?? []).map((r: any, i: number) => (
                    <tr key={`${r.rowNo}-${i}`} className={r.errors.length ? "bg-red-50" : ""}>
                      <td className="td tnum text-slate-400">{r.rowNo}</td>
                      <td className="td font-semibold align-top">
                        {r.name}
                        {r.matchedBy === "name" && (
                          <div className="text-[10px] text-slate-400 font-normal">이름으로 찾음</div>
                        )}
                      </td>
                      <td className="td">
                        {r.changes.map((c: any, ci: number) => (
                          <div key={c.field ?? ci}>
                            <span className="text-slate-500">{c.label}</span>{" "}
                            <span className="text-slate-400">{c.from}</span>
                            <span className="text-slate-300"> → </span>
                            <b className="text-emerald-700">{c.to}</b>
                          </div>
                        ))}
                        {r.kept.map((c: any, ki: number) => (
                          <div key={c.field ?? `k${ki}`} className="text-slate-300">
                            {c.label} {c.from} → {c.to} (유지)
                          </div>
                        ))}
                        {!r.changes.length && !r.kept.length && (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="td">
                        {r.errors.map((e: string, i: number) => (
                          <div key={i} className="text-red-600">✕ {e}</div>
                        ))}
                        {(r.warnings ?? []).map((w: string, i: number) => (
                          <div key={i} className="text-amber-600">! {w}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-slate-400">
                {tab === "bank"
                  ? "계좌번호는 화면에만 뒤 4자리로 가려 표시하고, 저장은 원본으로 됩니다."
                  : "주민등록번호·계좌번호는 화면에만 가려 표시하고, 저장은 원본으로 됩니다."}
              </p>
              <button
                className="btn-primary"
                disabled={busy || preview.changeCount === 0}
                onClick={() => {
                  if (confirm(`${preview.changeCount}건을 채웁니다. 계속할까요?`)) send("commit");
                }}
              >
                {busy ? "적용 중…" : `${preview.changeCount}건 채우기`}
              </button>
            </div>
          </>
        )}

        {preview && tab === "create" && (
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
