// OMR의 기존 알림 권한으로 요청 채널에 요약 이미지만 추가한다. 봇 키는 HR에 남는다.
export function placementImageBlocks(app:string,channel:string,text:string,imageUrl:unknown,imageAlt:unknown){
  if(imageUrl===undefined)return undefined;
  if(app!=='omr-report'||channel!=='C06PAG818TZ'||typeof imageUrl!=='string')throw Error('이미지 반배정 알림 대상이 올바르지 않습니다.');
  const url=new URL(imageUrl);
  if(url.protocol!=='https:'||url.hostname!=='report.yussam.com'||url.username||url.password||url.port||!/^\/api\/placement\/summary\/[a-f0-9-]{36}$/.test(url.pathname)||!/^\d+$/.test(url.searchParams.get('expires')??'')||!/^[a-f0-9]{64}$/.test(url.searchParams.get('signature')??''))throw Error('반배정 성적 요약 이미지 주소를 확인해 주세요.');
  return [{type:'section',text:{type:'mrkdwn',text:text.slice(0,3000)}},{type:'image',image_url:url.toString(),alt_text:typeof imageAlt==='string'?imageAlt.slice(0,1000):'반배치고사 성적 요약'}];
}
