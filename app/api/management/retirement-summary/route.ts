import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { severanceMonth } from "@/lib/severance-service";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
 const origin="https://management.yussam.com";
 if(req.headers.get("origin")!==origin)return NextResponse.json({error:"forbidden"},{status:403});
 const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Credentials":"true","Vary":"Origin","Cache-Control":"private, no-store"};
 if(!(await isAuthed()))return NextResponse.json({error:"unauthorized"},{status:401,headers});
 const month=new URL(req.url).searchParams.get("month")||"";
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return NextResponse.json({error:"invalid month"},{status:400,headers});
 const [y,m]=month.split("-").map(Number);const data=await severanceMonth(y,m,true),t=data.totals;
 const complete=t.deptExemptCount===2&&t.unknownCount===0&&t.noPayrollCount===0;
 return NextResponse.json({version:1,month,cumulative:complete?t.cumulativeAll:null,excludedManagement:t.deptExemptCount,complete,estimatedCount:t.estimatedCount,unknownCount:t.unknownCount,noPayrollCount:t.noPayrollCount,generatedAt:new Date().toISOString(),basis:"HR 퇴직급여 적립 누계(충당금+DC), 경영지원 및 퇴직정산 완료자 제외. 당월 충당금을 중복 가산하지 않음."},{headers});
}
