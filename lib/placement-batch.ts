import {validPlacementRequest,escapeSlack} from './placement-reply';

/** Text-only bulk requests use the same durable thread and reply-owner handling. */
export function placementBatchMessage(input:any){
 if(!input||!Array.isArray(input.students)||input.students.length<10||input.students.length>1000)throw Error('묶음 반배정 인원을 확인해 주세요.');
 const request={requestId:input.requestId,studentName:`신규생 ${input.students.length}명`,requestedBy:input.requestedBy,responsibleEmpNo:input.responsibleEmpNo};
 if(!validPlacementRequest(request))throw Error('묶음 반배정 요청 정보를 확인해 주세요.');
 const url=new URL(input.workspaceUrl);
 if(url.origin!=='https://classfit.yussam.com'||url.pathname!=='/'||url.username||url.password||!url.searchParams.get('workspace'))throw Error('반편성 연결 주소를 확인해 주세요.');
 const lines=input.students.map((s:any)=>{
  if(typeof s.name!=='string'||!s.name.trim()||s.name.length>80||!Number.isFinite(s.score)||s.score<0)throw Error('학생 이름과 총점을 확인해 주세요.');
  return `${escapeSlack(s.name.trim().replace(/[\r\n]/g,' '))} · ${s.score}점`;
 });
 const heading=`신규생 ${lines.length}명의 반편성 요청이 있습니다.`;
 const sections:string[]=[];let section='';
 for(const line of lines){if(section.length+line.length+1>2800){sections.push(section);section='';}section+=(section?'\n':'')+line;}if(section)sections.push(section);
 const link=`<${url.href}|유쌤 반편성에서 확인하기>`;
 const blocks=[{type:'section',text:{type:'plain_text',text:heading}},...sections.map(text=>({type:'section',text:{type:'mrkdwn',text}})),{type:'section',text:{type:'mrkdwn',text:link}}];
 return {request,text:`${heading}\n${lines.join('\n')}`.slice(0,38000)+`\n${url.href}`,blocks};
}
