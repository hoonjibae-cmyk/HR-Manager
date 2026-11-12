import {prisma} from './db';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validResultSnapshot(input:any){
 const r=input?.report;
 return UUID.test(input?.rootId??'')&&UUID.test(input?.fingerprint??'')&&typeof input?.schedule==='string'&&input.schedule.length<=30&&r?.family==='C_generic'&&typeof r.examTitle==='string'&&r.examTitle.length<=500&&typeof r.student?.name==='string'&&r.student.name.length<=100&&Number.isFinite(r.score?.raw)&&Number.isFinite(r.score?.max)&&Array.isArray(r.areas)&&r.areas.length<=100&&r.areas.every((a:any)=>typeof a.area==='string'&&a.area.length<=100&&Number.isFinite(a.earned)&&Number.isFinite(a.possible));
}
export async function registerResultSnapshot(input:any){
 if(!validResultSnapshot(input))throw Error('invalid snapshot');
 const existing=await prisma.placementSlackResult.findUnique({where:{rootId_fingerprint:{rootId:input.rootId,fingerprint:input.fingerprint}}});
 if(existing)return existing;
 const root=await prisma.placementSlackResult.findUnique({where:{id:input.rootId}});
 const data={id:root?input.fingerprint:input.rootId,rootId:input.rootId,fingerprint:input.fingerprint,report:JSON.stringify(input.report),schedule:input.schedule,state:!root&&input.alreadySent===true?'sent':'pending'};
 try{return await prisma.placementSlackResult.create({data});}
 catch(error){
  if((error as any)?.code!=='P2002')throw error;
  // Concurrent registrations must never replace the first stored image.
  const winner=await prisma.placementSlackResult.findUnique({where:{rootId_fingerprint:{rootId:input.rootId,fingerprint:input.fingerprint}}});
  if(winner)return winner;
  return prisma.placementSlackResult.create({data:{...data,id:input.fingerprint,state:'pending'}});
 }
}
