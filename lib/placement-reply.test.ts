import {describe,it,expect} from 'vitest';
import {PLACEMENT_CHANNEL,placementAuthorAllowed,placementReplyEvent,stableMessageId,validPlacementRequest,placementReplyBlocks} from './placement-reply';
const event={type:'message',channel:PLACEMENT_CHANNEL,user:'U123',ts:'1794447937.000001',thread_ts:'1794447900.000001',text:'M7S 화목으로 배정해 주세요.'};
describe('placement reply policy',()=>{
 it('accepts only active management or faculty heads, independently of leave approvers',()=>{
  for(const [department,position] of [['경영지원','직원'],['교수부','교수부장'],['교수부장','부장']])expect(placementAuthorAllowed({active:true,department,position})).toBe(true);
  for(const department of ['교수부','조교팀','교육운영팀','경영지원보조'])expect(placementAuthorAllowed({active:true,department,position:'강사'})).toBe(false);
  expect(placementAuthorAllowed({active:false,department:'경영지원'})).toBe(false);
  expect(placementAuthorAllowed({active:true,resignDate:new Date(),position:'교수부장'})).toBe(false);
  expect(placementAuthorAllowed(null)).toBe(false);
 });
 it('ignores other channels, roots, bots, deletion and unfurl-only updates',()=>{
  expect(placementReplyEvent(event)?.replyTs).toBe(event.ts);
  for(const change of [{channel:'COTHER'},{thread_ts:event.ts},{bot_id:'B1'},{app_id:'A1'},{subtype:'message_deleted'},{text:''}])expect(placementReplyEvent({...event,...change})).toBeNull();
  const changed={type:'message',channel:PLACEMENT_CHANNEL,subtype:'message_changed',message:{...event,edited:{ts:'1794447938.000001'}}};
  expect(placementReplyEvent(changed)?.versionTs).toBe('1794447938.000001');
  expect(placementReplyEvent({...changed,message:{...event}})?.versionTs).toBe(event.ts);
 });
 it('deduplicates event delivery, but keeps a genuinely edited reply distinct',()=>{
  expect(stableMessageId('request:reply:version')).toBe(stableMessageId('request:reply:version'));
  expect(stableMessageId('request:reply:version2')).not.toBe(stableMessageId('request:reply:version'));
 });
 it('validates stable OMR request identity',()=>{
  const input={requestId:'b6aa6a58-49e0-4da7-9e11-52275f24bfa7',studentName:'테스트 학생',requestedBy:'staff',responsibleEmpNo:'001'};
  expect(validPlacementRequest(input)).toBe(true);
  expect(validPlacementRequest({...input,requestId:'------------------------------------'})).toBe(false);
  expect(validPlacementRequest({...input,studentName:''})).toBe(false);
 });
 it('shows an acknowledgement button only until acknowledged; reply text stays plain text',()=>{
  const input={studentName:'학생',authorName:'작성자',text:'<@UALL> 내용',url:'https://slack.com/archives/C1/p1',id:'reply'};
  expect(JSON.stringify(placementReplyBlocks(input))).toContain('placement_reply_ack');
  expect(JSON.stringify(placementReplyBlocks({...input,acknowledged:true}))).not.toContain('placement_reply_ack');
  expect(placementReplyBlocks(input)[1]).toMatchObject({text:{type:'plain_text'}});
 });
});
