"use client";

import { useState } from "react";
import DocButton from "@/components/DocButton";

interface Emp { id: number; name: string; department: string | null; position: string | null }

export default function DocHub({ employees }: { employees: Emp[] }) {
  const [empId, setEmpId] = useState<string>("");
  const selected = employees.find((e) => String(e.id) === empId);

  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-4">문서 발급</h2>
      <div className="mb-4 max-w-xs">
        <label className="label">직원 선택</label>
        <select className="input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
          <option value="">직원을 선택하세요</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.department} {e.position}
            </option>
          ))}
        </select>
      </div>

      {selected ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <DocCard title="신규입사 패키지" desc="근로계약서 + 복무서약서 + 개인정보동의서 + 임금공제동의서">
            <DocButton endpoint="/api/documents/newhire" body={{ employeeId: selected.id }} label="발급" className="btn-primary w-full" />
          </DocCard>
          <DocCard title="재직증명서" desc="용도 입력 후 발급">
            <DocButton endpoint="/api/documents/cert" body={{ employeeId: selected.id, type: "CERT_EMPLOYMENT" }} label="발급" className="btn-outline w-full" promptPurpose />
          </DocCard>
          <DocCard title="경력증명서" desc="근무이력 증명">
            <DocButton endpoint="/api/documents/cert" body={{ employeeId: selected.id, type: "CERT_CAREER" }} label="발급" className="btn-outline w-full" promptPurpose />
          </DocCard>
          <DocCard title="계약서 (개별)" desc="직원 상세 → 계약 이력에서 발급">
            <a href={`/employees/${selected.id}`} className="btn-ghost w-full">직원 상세로 →</a>
          </DocCard>
        </div>
      ) : (
        <p className="text-sm text-slate-400 py-6 text-center">직원을 선택하면 발급 가능한 문서가 표시됩니다.</p>
      )}
    </div>
  );
}

function DocCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-xl p-4 flex flex-col">
      <div className="font-semibold text-sm text-slate-800">{title}</div>
      <div className="text-xs text-slate-400 mt-1 mb-3 flex-1">{desc}</div>
      {children}
    </div>
  );
}
