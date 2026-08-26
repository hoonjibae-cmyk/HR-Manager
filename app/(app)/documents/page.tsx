import { prisma } from "@/lib/db";
import { PageHeader, Pill } from "@/components/ui";
import DocHub from "@/components/DocHub";
import { DOCUMENT_TYPE_LABEL, isContractorContract } from "@/lib/constants";
import { ymd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const [employees, docs] = await Promise.all([
    prisma.employee.findMany({ where: { active: true }, orderBy: { empNo: "asc" } }),
    prisma.document.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { employee: true },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="문서 발급"
        desc="근로계약서·서약서·동의서·증명서를 PDF로 발급합니다. 급여명세서는 급여 산정 화면에서 발급/발송합니다."
      />

      <div className="mb-6">
        <DocHub
          employees={employees.map((e) => ({
            id: e.id,
            name: e.name,
            department: e.department,
            position: e.position,
            contractor: isContractorContract(e),
          }))}
        />
      </div>

      <div className="card overflow-x-auto">
        <div className="px-5 py-3 border-b border-slate-100 font-bold text-slate-800">최근 발급 이력</div>
        {docs.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">발급 이력이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">문서</th>
                <th className="th">종류</th>
                <th className="th">대상</th>
                <th className="th">발급일시</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="td font-medium">{d.title}</td>
                  <td className="td"><Pill>{DOCUMENT_TYPE_LABEL[d.type] ?? d.type}</Pill></td>
                  <td className="td">{d.employee?.name ?? "-"}</td>
                  <td className="td tnum text-slate-400">{ymd(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
