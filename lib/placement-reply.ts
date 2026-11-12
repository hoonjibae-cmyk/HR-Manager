import {createHash} from 'node:crypto';
export const PLACEMENT_CHANNEL='C06PAG818TZ';
export function stableMessageId(value:string){const hash=createHash('sha256').update(value).digest('hex');return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;}
export function escapeSlack(value:string){return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
export function placementReplyEvent(event:any){
 const m=event?.subtype==='message_changed'?event.message:event;
 if(event?.type!=='message'||event.channel!==PLACEMENT_CHANNEL||!m||m.bot_id||m.app_id||m.subtype||!/^U[A-Z0-9]+$/.test(m.user??'')||!/^\d{10,}\.\d{6}$/.test(m.thread_ts??'')||m.thread_ts===m.ts||!/^\d{10,}\.\d{6}$/.test(m.ts??'')||typeof m.text!=='string'||!m.text.trim())return null;
 if(event.subtype&&event.subtype!=='message_changed')return null;
 const version=m.edited?.ts??m.ts;if(!/^\d{10,}\.\d{6}$/.test(version))return null;
 return {channel:event.channel,rootTs:m.thread_ts,replyTs:m.ts,versionTs:version,user:m.user,text:m.text.slice(0,12000)};
}
export function placementReplyBlocks(input:{studentName:string;authorName:string;text:string;url:string;id:string;acknowledged?:boolean}){
 return [{type:'section',text:{type:'plain_text',text:`${input.studentName} 학생 반배정 답변${input.acknowledged?' · 확인 완료':''}`}},{type:'section',text:{type:'plain_text',text:`${input.authorName}: ${input.text}`.slice(0,3000)}},{type:'actions',elements:[{type:'button',text:{type:'plain_text',text:'원문 보기'},url:input.url},...(!input.acknowledged?[{type:'button',text:{type:'plain_text',text:'확인 완료'},style:'primary',action_id:'placement_reply_ack',value:input.id}]:[])]}];
}
export function placementOwnerAction(id:string){return {type:'actions',block_id:`placement:${id}`,elements:[{type:'users_select',action_id:'placement_owner',placeholder:{type:'plain_text',text:'담당 직원 지정 · 변경'}}]};}
export function validPlacementRequest(input:any){return !!input&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId??'')&&typeof input.studentName==='string'&&input.studentName.trim().length>0&&input.studentName.length<=100&&typeof input.requestedBy==='string'&&input.requestedBy.length<=120&&(input.responsibleEmpNo==null||typeof input.responsibleEmpNo==='string'&&input.responsibleEmpNo.length<=80);}

export function placementAuthorAllowed(employee:{active:boolean;resignDate?:Date|null;department?:string|null;position?:string|null}|null){
 return !!employee&&employee.active&&!employee.resignDate&&(employee.department?.trim()==='경영지원'||employee.department?.trim()==='교수부장'||employee.position?.trim()==='교수부장');
}
