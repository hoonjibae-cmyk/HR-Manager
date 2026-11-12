import {prisma} from './db';
import {directoryApiKey} from './directory-api-auth';
import {PLACEMENT_CHANNEL,placementAuthorAllowed,placementOwnerAction,placementReplyBlocks,placementReplyEvent,stableMessageId,validPlacementRequest} from './placement-reply';
import type {PlacementSlackThread,PlacementSlackReply} from '@prisma/client';

// Only this fixed channel is consumed. No bot token or employee directory leaves HR.
async function api(method:string,payload:unknown){
 const response=await fetch(`https://slack.com/api/${method}`,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8',Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
 const result=await response.json();
 if(!result.ok)throw new SlackError(result.error??'slack-error');
 return result;
}
class SlackError extends Error{}
const activeEmployee=(slackUserId:string)=>/^U[A-Z0-9]+$/.test(slackUserId??'')?prisma.employee.findFirst({where:{slackUserId,active:true,resignDate:null},select:{empNo:true,slackUserId:true,name:true,department:true,position:true,active:true,resignDate:true}}):Promise.resolve(null);
async function owner(empNo:string|null){return empNo?prisma.employee.findFirst({where:{empNo,active:true,resignDate:null},select:{empNo:true,slackUserId:true}}):null;}
async function omrOwner(id:string,imageId=id){
 const key=directoryApiKey('omr-report');if(!key)throw Error('OMR 연동 키 없음');
 const response=await fetch(`https://report.yussam.com/api/integrations/placement-owner?request=${encodeURIComponent(id)}&image=${encodeURIComponent(imageId)}`,{headers:{'x-api-key':key},cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error(`OMR 담당자 조회 실패 (${response.status})`);
 return response.json() as Promise<{studentName:string;requestedBy:string;responsibleEmpNo:string|null;imageUrl:string}>;
}
function rootBlocks(thread:PlacementSlackThread,status:string){
 const blocks=JSON.parse(thread.originalBlocks) as any[];
 return [...blocks,{type:'context',elements:[{type:'mrkdwn',text:`담당 직원: ${thread.ownerSlackId?`<@${thread.ownerSlackId}>`:'*지정 필요*'} · ${status}`} ]},placementOwnerAction(thread.id)];
}
async function refreshRoot(threadId:string){
 const thread=await prisma.placementSlackThread.findUniqueOrThrow({where:{id:threadId}});if(!thread.rootTs)return;
 const latest=await prisma.placementSlackReply.findFirst({where:{threadId,state:{not:'skipped'}},orderBy:{versionTs:'desc'}});
 // Slack re-fetches image URLs on chat.update; refresh the signed URL after expiry.
 const original=JSON.parse(thread.originalBlocks) as any[];
 const image=original.find(b=>b.type==='image');
 if(image&&Number(new URL(image.image_url).searchParams.get('expires'))<Date.now()+60000){
  const imageId=new URL(image.image_url).pathname.split('/').pop()!;
  image.image_url=(await omrOwner(thread.id,imageId)).imageUrl;
  thread.originalBlocks=JSON.stringify(original);
  await prisma.placementSlackThread.update({where:{id:thread.id},data:{originalBlocks:thread.originalBlocks}});
 }
 const status=latest?.acknowledgedAt?'답변 확인 완료':latest?.state==='sent'?'답변 전달 완료 · 확인 대기':latest?.state==='uncertain'?'답변 발송 결과 확인 필요':latest?'답변 전달 대기':'원장 답변 대기';
 await api('chat.update',{channel:thread.channel,ts:thread.rootTs,text:`${thread.originalText}\n${status}`,blocks:rootBlocks(thread,status)});
}
export async function sendPlacementRequest(input:any,text:string,blocks:any[]){
 if(!validPlacementRequest(input))return {delivered:false,error:'반배정 요청 정보 오류'};
 let thread=await prisma.placementSlackThread.findUnique({where:{id:input.requestId}});
 const result=input.resultId?await prisma.placementSlackResult.findUnique({where:{id:input.resultId}}):null;
 if(input.resultId&&(!result||result.rootId!==input.requestId||!blocks.some(b=>b.type==='image'&&new URL(b.image_url).pathname.endsWith(`/${result.id}`))))return {delivered:false,error:'보관 성적표 연결 오류'};
 if(!thread?.rootTs&&result){
  const original=await prisma.placementSlackResult.findUnique({where:{id:input.requestId}});
  if(original?.state==='sent'){
   const legacy=await findLegacyPlacementRoot(input.requestId,input.requestedAt);
   if(!legacy)return {delivered:false,error:'기존 Slack 반배정 요청을 찾지 못했습니다. 새 메시지를 중복 발송하지 않았습니다.'};
   const employee=await owner(input.responsibleEmpNo??null);
   thread=await prisma.placementSlackThread.upsert({where:{id:input.requestId},create:{id:input.requestId,channel:PLACEMENT_CHANNEL,rootTs:legacy.ts,studentName:input.studentName,requestedBy:input.requestedBy,ownerEmpNo:employee?.empNo,ownerSlackId:employee?.slackUserId,originalText:legacy.text??text,originalBlocks:JSON.stringify(legacy.blocks.filter((b:any)=>['section','image'].includes(b.type))),state:'sent'},update:{rootTs:legacy.ts,state:'sent'}});
  }
 }
 if(thread?.rootTs&&result){
  const rootImage=JSON.parse(thread.originalBlocks).find((b:any)=>b.type==='image');
  if(rootImage&&new URL(rootImage.image_url).pathname.endsWith(`/${result.id}`)){
   // Recover a crash after posting the root but before saving its result delivery.
   await prisma.placementSlackResult.update({where:{id:result.id},data:{state:'sent',slackTs:thread.rootTs}});
   return {delivered:true,channel:thread.channel,ts:thread.rootTs,imageIncluded:true};
  }
  return sendPlacementRetest(thread,result.id,text,blocks);
 }
 if(thread?.rootTs)return {delivered:true,channel:thread.channel,ts:thread.rootTs,imageIncluded:true};
 if(thread&&thread.state!=='error')return {delivered:null,error:'발송 결과 확인 대기. 중복 발송하지 않습니다.'};
 const employee=await owner(input.responsibleEmpNo??null);
 const data={channel:PLACEMENT_CHANNEL,studentName:input.studentName.trim(),requestedBy:input.requestedBy,ownerEmpNo:employee?.empNo??null,ownerSlackId:employee?.slackUserId??null,originalText:text,originalBlocks:JSON.stringify(blocks),state:'sending',error:null};
 // Creation/claim is atomic: two identical HTTP requests cannot both post a root.
 if(thread){const claim=await prisma.placementSlackThread.updateMany({where:{id:thread.id,state:'error'},data});if(!claim.count)return {delivered:null};thread={...thread,...data};}
 else {try{thread=await prisma.placementSlackThread.create({data:{id:input.requestId,...data}});}catch(error){if((error as any)?.code==='P2002')return {delivered:null};throw error;}}
 try{
  const result=await api('chat.postMessage',{channel:PLACEMENT_CHANNEL,text,blocks:rootBlocks(thread,'원장 답변 대기'),client_msg_id:stableMessageId(`placement:${thread.id}`)});
  await prisma.placementSlackThread.update({where:{id:thread.id},data:{rootTs:result.ts,state:'sent'}});
  if(input.resultId)await prisma.placementSlackResult.update({where:{id:input.resultId},data:{state:'sent',slackTs:result.ts}});
  return {delivered:true,channel:PLACEMENT_CHANNEL,ts:result.ts,imageIncluded:true};
 }catch(error){const certain=error instanceof SlackError;await prisma.placementSlackThread.update({where:{id:thread.id},data:{state:certain?'error':'uncertain',error:error instanceof Error?error.message:'발송 결과 불명'}});return {delivered:certain?false:null,error:'반배정 알림 발송 상태를 확인해 주세요.'};}
}
// Locate only this bot's original score image; never infer a thread by student name.
async function findLegacyPlacementRoot(rootId:string,requestedAt?:string){
 const auth=await api('auth.test',{});let cursor:string|undefined;
 const when=Date.parse(requestedAt??'');const oldest=Number.isFinite(when)?String(Math.floor(when/1000)-86400):undefined;
 for(let page=0;page<5;page++){
  const history=await api('conversations.history',{channel:PLACEMENT_CHANNEL,limit:100,oldest,cursor});
  const root=history.messages?.find((m:any)=>(!m.thread_ts||m.thread_ts===m.ts)&&m.blocks?.some((b:any)=>{if(b.type!=='image')return false;try{const url=new URL(b.image_url);return url.hostname==='report.yussam.com'&&url.pathname===`/api/placement/summary/${rootId}`;}catch{return false;}})&&(m.user===auth.user_id||(auth.bot_id&&m.bot_id===auth.bot_id)));
  if(root)return root;
  cursor=history.response_metadata?.next_cursor;if(!cursor)return null;
 }
 return null;
}
async function sendPlacementRetest(thread:PlacementSlackThread,resultId:string,text:string,blocks:any[]){
 const result=await prisma.placementSlackResult.findUniqueOrThrow({where:{id:resultId}});
 if(result.state==='sent')return {delivered:true,imageIncluded:true,channel:thread.channel,ts:result.slackTs};
 if(!['pending','error'].includes(result.state))return {delivered:null,error:'재시험 알림 발송 결과 확인 대기. 중복 전송하지 않습니다.'};
 const uploadedAt=JSON.parse(result.report).sourceScan?.uploadedAt;
 const scanned=uploadedAt&&Number.isFinite(Date.parse(uploadedAt))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(uploadedAt)):null;
 const original=await prisma.placementSlackResult.findUnique({where:{id:thread.id}});
 const originalScan=original?JSON.parse(original.report).sourceScan?.id:null;
 const currentScan=JSON.parse(result.report).sourceScan?.id;
 const correction=!!originalScan&&originalScan===currentScan;
 const caption=correction?'성적 정정 결과':'재시험 결과';
 const body=`${caption} · ${thread.studentName}${scanned?`\n답안지 업로드일: ${scanned}`:''}\n기존 성적표는 유지되며, ${correction?'정정된 성적을':'다시 응시한 결과를'} 추가합니다.\n${text}`;
 const replyBlocks=[{type:'section',text:{type:'mrkdwn',text:body.slice(0,3000)}},...blocks.filter(b=>b.type==='image')];
 const claim=await prisma.placementSlackResult.updateMany({where:{id:resultId,state:{in:['pending','error']}},data:{state:'sending',error:null}});
 if(!claim.count)return {delivered:null,error:'재시험 알림 발송 결과 확인 대기. 중복 전송하지 않습니다.'};
 try{
  const posted=await api('chat.postMessage',{channel:thread.channel,thread_ts:thread.rootTs,text:body,blocks:replyBlocks,client_msg_id:stableMessageId(`placement-result:${resultId}`)});
  await prisma.placementSlackResult.update({where:{id:resultId},data:{state:'sent',slackTs:posted.ts}});
  return {delivered:true,imageIncluded:true,channel:thread.channel,ts:posted.ts};
 }catch(error){const certain=error instanceof SlackError;await prisma.placementSlackResult.update({where:{id:resultId},data:{state:certain?'error':'uncertain',error:error instanceof Error?error.message:'발송 결과 불명'}});return {delivered:certain?false:null,error:'재시험 댓글 알림 발송 상태를 확인해 주세요.'};}
}
// Store the verified event before acknowledging Slack. Background work is recoverable by cron.
export async function enqueuePlacementEvent(eventId:string,event:unknown){
 const normalized=placementReplyEvent(event);if(!normalized)return false;
 await prisma.placementSlackEvent.upsert({where:{id:eventId},create:{id:eventId,payload:JSON.stringify(normalized)},update:{}});return true;
}
async function recoverThread(channel:string,rootTs:string){
 const found=await prisma.placementSlackThread.findUnique({where:{rootTs}});if(found)return found;
 const [history,auth]=await Promise.all([api('conversations.history',{channel,oldest:rootTs,latest:rootTs,inclusive:true,limit:1}),api('auth.test',{})]);
 const root=history.messages?.find((m:any)=>m.ts===rootTs);
 if(!root||!(root.user===auth.user_id||(auth.bot_id&&root.bot_id===auth.bot_id)))return null;
 const image=root.blocks?.find((b:any)=>b.type==='image');if(!image)return null;
 let url:URL;try{url=new URL(image.image_url);}catch{return null;}
 const match=url.pathname.match(/^\/api\/placement\/summary\/([a-f0-9-]{36})$/i);
 if(url.protocol!=='https:'||url.hostname!=='report.yussam.com'||!match)return null;
 const details=await omrOwner(match[1]);const employee=await owner(details.responsibleEmpNo);
 return prisma.placementSlackThread.upsert({where:{id:match[1]},create:{id:match[1],channel,rootTs,studentName:details.studentName,requestedBy:details.requestedBy,ownerEmpNo:employee?.empNo,ownerSlackId:employee?.slackUserId,originalText:root.text??'반배정 요청',originalBlocks:JSON.stringify(root.blocks.filter((b:any)=>b.type==='section'||b.type==='image')),state:'sent'},update:{rootTs,state:'sent'}});
}
async function processEvent(id:string){
 const claim=await prisma.placementSlackEvent.updateMany({where:{id,state:{in:['pending','error']},OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{state:'processing',leaseUntil:new Date(Date.now()+120000),attempts:{increment:1}}});if(!claim.count)return;
 try{
  const row=await prisma.placementSlackEvent.findUniqueOrThrow({where:{id}});const event=JSON.parse(row.payload);
  const author=await activeEmployee(event.user);
  if(placementAuthorAllowed(author)){
   const thread=await recoverThread(event.channel,event.rootTs);
   if(thread){
    const replyId=stableMessageId(`${thread.id}:${event.replyTs}:${event.versionTs}`);
    await prisma.placementSlackReply.upsert({where:{id:replyId},create:{id:replyId,threadId:thread.id,replyTs:event.replyTs,versionTs:event.versionTs,authorSlackId:event.user,authorName:author!.name,text:event.text},update:{}});
   }
  }
  await prisma.placementSlackEvent.update({where:{id},data:{state:'done',leaseUntil:null,error:null}});
 }catch(error){await prisma.placementSlackEvent.update({where:{id},data:{state:'error',leaseUntil:new Date(Date.now()+60000),error:error instanceof Error?error.message:'처리 실패'}});}
}
function replyUrl(thread:PlacementSlackThread,reply:PlacementSlackReply){return `https://slack.com/archives/${thread.channel}/p${reply.replyTs.replace('.','')}?thread_ts=${thread.rootTs}&cid=${thread.channel}`;}
async function syncAcknowledgement(reply:PlacementSlackReply,thread:PlacementSlackThread){
 if(!reply.dmChannel||!reply.dmTs)return;
 await api('chat.update',{channel:reply.dmChannel,ts:reply.dmTs,text:`${thread.studentName} 반배정 답변 · 확인 완료`,blocks:placementReplyBlocks({studentName:thread.studentName,authorName:reply.authorName,text:reply.text,url:replyUrl(thread,reply),id:reply.id,acknowledged:true})});
 await refreshRoot(thread.id);
 await prisma.placementSlackReply.update({where:{id:reply.id},data:{syncedAt:new Date()}});
}
async function deliverReply(id:string){
 const reply=await prisma.placementSlackReply.findUniqueOrThrow({where:{id},include:{thread:true}});
 const employee=await owner(reply.thread.ownerEmpNo);if(!employee?.slackUserId||employee.slackUserId!==reply.thread.ownerSlackId)return;
 if(employee.slackUserId===reply.authorSlackId){await prisma.placementSlackReply.updateMany({where:{id,state:{in:['pending','error']}},data:{state:'skipped'}});return;}
 // Recheck current HR status before sending (queued messages do not bypass revoked roles).
 if(!placementAuthorAllowed(await activeEmployee(reply.authorSlackId))){await prisma.placementSlackReply.updateMany({where:{id,state:{in:['pending','error']}},data:{state:'skipped'}});return;}
 const claim=await prisma.placementSlackReply.updateMany({where:{id,state:{in:['pending','error']},OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{state:'sending',leaseUntil:new Date(Date.now()+120000),attempts:{increment:1},recipientSlackId:employee.slackUserId}});if(!claim.count)return;
 try{
  const response=await api('chat.postMessage',{channel:employee.slackUserId,text:`${reply.thread.studentName} 학생 반배정 답변: ${reply.text}`,blocks:placementReplyBlocks({studentName:reply.thread.studentName,authorName:reply.authorName,text:reply.text,url:replyUrl(reply.thread,reply),id}),client_msg_id:stableMessageId(`${id}:${employee.slackUserId}`)});
  await prisma.placementSlackReply.update({where:{id},data:{state:'sent',dmChannel:response.channel,dmTs:response.ts,leaseUntil:null,error:null}});
 }catch(error){await prisma.placementSlackReply.update({where:{id},data:{state:error instanceof SlackError?'error':'uncertain',leaseUntil:new Date(Date.now()+60000),error:error instanceof Error?error.message:'발송 결과 불명'}});return;}
 await refreshRoot(reply.threadId).then(()=>prisma.placementSlackReply.update({where:{id},data:{syncedAt:new Date()}})).catch(()=>{});
}
export async function dispatchPlacementReplies(){
 const started=Date.now();
 await prisma.placementSlackEvent.updateMany({where:{state:'processing',leaseUntil:{lt:new Date()}},data:{state:'pending',leaseUntil:null}});
 // A process may die after Slack accepted a DM. Never blindly send it again.
 await prisma.placementSlackReply.updateMany({where:{state:'sending',leaseUntil:{lt:new Date()}},data:{state:'uncertain',error:'전송 결과 확인 필요',leaseUntil:null}});
 const events=await prisma.placementSlackEvent.findMany({where:{state:{in:['pending','error']},attempts:{lt:20},OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},orderBy:{createdAt:'asc'},take:10});
 for(const event of events){if(Date.now()-started>40000)break;await processEvent(event.id);}
 const replies=await prisma.placementSlackReply.findMany({where:{state:{in:['pending','error']},attempts:{lt:10},OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},orderBy:{createdAt:'asc'},take:15});
 for(const reply of replies){if(Date.now()-started>45000)break;await deliverReply(reply.id);}
 const acknowledgements=await prisma.placementSlackReply.findMany({where:{state:'sent',syncedAt:null},include:{thread:true},take:10});
 for(const reply of acknowledgements){if(Date.now()-started>45000)break;await (reply.acknowledgedAt?syncAcknowledgement(reply,reply.thread):refreshRoot(reply.threadId).then(()=>prisma.placementSlackReply.update({where:{id:reply.id},data:{syncedAt:new Date()}}))).catch(()=>{});}
 return {events:events.length,replies:replies.length};
}
export async function handlePlacementAction(payload:any){
 const action=payload.actions?.[0];const user=payload.user?.id;const channel=payload.container?.channel_id??payload.channel?.id;const ts=payload.container?.message_ts??payload.message?.ts;
 if(!/^U[A-Z0-9]+$/.test(user??''))return;
 async function reject(text:string){if(channel&&user)await api('chat.postEphemeral',{channel,user,text});}
 if(action?.action_id==='placement_reply_ack'){
  const reply=await prisma.placementSlackReply.findUnique({where:{id:String(action.value)},include:{thread:true}});
  if(!reply||reply.state!=='sent'||reply.recipientSlackId!==user||reply.thread.ownerSlackId!==user||reply.dmChannel!==channel||reply.dmTs!==ts||!await activeEmployee(user)){await reject('현재 담당 직원만 이 답변을 확인 처리할 수 있습니다.');return;}
  if(!reply.acknowledgedAt)await prisma.placementSlackReply.updateMany({where:{id:reply.id,acknowledgedAt:null},data:{acknowledgedAt:new Date(),syncedAt:null}});
  const current=await prisma.placementSlackReply.findUniqueOrThrow({where:{id:reply.id}});
  await syncAcknowledgement(current,reply.thread);return;
 }
 if(action?.action_id==='placement_owner'){
  if(!placementAuthorAllowed(await activeEmployee(user))){await reject('경영지원 또는 교수부장만 담당 직원을 변경할 수 있습니다.');return;}
  const id=String(action.block_id??'').replace(/^placement:/,'');const thread=await prisma.placementSlackThread.findUnique({where:{id}});
  const selected=await activeEmployee(action.selected_user);
  if(!thread||thread.channel!==channel||thread.rootTs!==ts||!selected){await reject('재직 중이며 인사 정보에 연결된 직원을 선택해 주세요.');return;}
  if(await prisma.placementSlackReply.count({where:{threadId:id,state:'sending'}})){await reject('답변을 전달 중입니다. 잠시 후 담당 직원을 변경해 주세요.');return;}
  await prisma.placementSlackThread.update({where:{id},data:{ownerEmpNo:selected.empNo,ownerSlackId:selected.slackUserId}});
  // Old recipient's acknowledgement no longer represents the new owner.
  if(thread.ownerSlackId!==selected.slackUserId)await prisma.placementSlackReply.updateMany({where:{threadId:id,state:'sent'},data:{state:'pending',recipientSlackId:null,dmChannel:null,dmTs:null,acknowledgedAt:null,syncedAt:null,leaseUntil:null,attempts:0}});
  await refreshRoot(id);await dispatchPlacementReplies();
 }
}
