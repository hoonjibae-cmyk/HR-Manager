import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({db:{employee:{findFirst:vi.fn()},placementSlackThread:{findUnique:vi.fn(),findUniqueOrThrow:vi.fn(),create:vi.fn(),update:vi.fn(),updateMany:vi.fn()},placementSlackReply:{findUnique:vi.fn(),findUniqueOrThrow:vi.fn(),findFirst:vi.fn(),findMany:vi.fn(),update:vi.fn(),updateMany:vi.fn(),count:vi.fn(),upsert:vi.fn()},placementSlackEvent:{upsert:vi.fn(),updateMany:vi.fn(),findMany:vi.fn(),findUniqueOrThrow:vi.fn(),update:vi.fn()}}}));
vi.mock('./db',()=>({prisma:mocks.db}));
import {dispatchPlacementReplies,enqueuePlacementEvent,handlePlacementAction,sendPlacementRequest} from './placement-reply-service';
const id='b6aa6a58-49e0-4da7-9e11-52275f24bfa7';
const thread={id,channel:'C06PAG818TZ',rootTs:'1794447900.000001',studentName:'학생',requestedBy:'staff',ownerEmpNo:'001',ownerSlackId:'UOWNER',originalText:'반배정 요청',originalBlocks:'[]',state:'sent'};
const reply={id:'reply',threadId:id,replyTs:'1794447937.000001',versionTs:'1794447937.000001',authorSlackId:'UMANAGER',authorName:'관리자',text:'M7S 화목',state:'sent',recipientSlackId:'UOWNER',dmChannel:'D1',dmTs:'1794447938.000001',acknowledgedAt:null,syncedAt:null,thread};
const fetchMock=vi.fn();
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',fetchMock);fetchMock.mockResolvedValue({json:async()=>({ok:true,channel:'D1',ts:'1794447938.000001'})});mocks.db.placementSlackReply.updateMany.mockResolvedValue({count:1});mocks.db.placementSlackEvent.updateMany.mockResolvedValue({count:1});mocks.db.placementSlackEvent.findMany.mockResolvedValue([]);mocks.db.placementSlackReply.findMany.mockResolvedValue([]);mocks.db.placementSlackReply.findFirst.mockResolvedValue(null);});
describe('placement delivery boundaries',()=>{
 it.each([{department:'경영지원',position:'직원'},{department:'교수부',position:'교수부장'}])('queues the permitted author $department/$position for the linked root',async(role)=>{
  mocks.db.placementSlackEvent.findMany.mockResolvedValue([{id:'Ev1'}]);
  mocks.db.placementSlackEvent.findUniqueOrThrow.mockResolvedValue({payload:JSON.stringify({user:'UMANAGER',channel:thread.channel,rootTs:thread.rootTs,replyTs:reply.replyTs,versionTs:reply.versionTs,text:reply.text})});
  mocks.db.employee.findFirst.mockResolvedValue({active:true,resignDate:null,name:'관리자',...role});
  mocks.db.placementSlackThread.findUnique.mockResolvedValue(thread);
  await dispatchPlacementReplies();
  expect(mocks.db.placementSlackReply.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({threadId:id,authorSlackId:'UMANAGER',text:reply.text}),update:{}}));
 });
 it('delivers a claimed reply once to its active owner with source link and acknowledgement',async()=>{
  mocks.db.placementSlackReply.findMany.mockResolvedValueOnce([{id:'reply'}]).mockResolvedValueOnce([]);
  mocks.db.placementSlackReply.findUniqueOrThrow.mockResolvedValue({...reply,state:'pending'});
  mocks.db.employee.findFirst.mockResolvedValueOnce({slackUserId:'UOWNER'}).mockResolvedValueOnce({active:true,resignDate:null,department:'경영지원'});
  mocks.db.placementSlackThread.findUniqueOrThrow.mockResolvedValue(thread);
  await dispatchPlacementReplies();
  const post=fetchMock.mock.calls.find(c=>String(c[0]).includes('chat.postMessage'));
  expect(JSON.parse(post![1].body)).toMatchObject({channel:'UOWNER',client_msg_id:expect.any(String)});
  expect(post![1].body).toContain('placement_reply_ack');expect(post![1].body).toContain('thread_ts=');
  expect(mocks.db.placementSlackReply.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'sent',dmChannel:'D1'})}));
 });
 it('does not look up an arbitrary first employee when a Slack action has no user',async()=>{
  await handlePlacementAction({actions:[{action_id:'placement_owner',selected_user:'UOWNER'}]});
  expect(mocks.db.employee.findFirst).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
 });
 it('persists a normalized event with idempotent upsert before background work',async()=>{
  expect(await enqueuePlacementEvent('Ev1',{type:'message',channel:thread.channel,user:'UMANAGER',ts:reply.replyTs,thread_ts:thread.rootTs,text:'배정'})).toBe(true);
  expect(mocks.db.placementSlackEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{id:'Ev1'},update:{}}));
  expect(fetchMock).not.toHaveBeenCalled();
 });
 it('does not look up or forward a general instructor/operations reply',async()=>{
  mocks.db.placementSlackEvent.findMany.mockResolvedValue([{id:'Ev1'}]);
  mocks.db.placementSlackEvent.findUniqueOrThrow.mockResolvedValue({payload:JSON.stringify({user:'UTEACHER',channel:thread.channel,rootTs:thread.rootTs})});
  mocks.db.employee.findFirst.mockResolvedValue({active:true,resignDate:null,department:'교육운영팀',position:'직원'});
  await dispatchPlacementReplies();
  expect(mocks.db.placementSlackThread.findUnique).not.toHaveBeenCalled();
  expect(mocks.db.placementSlackReply.upsert).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
 });
 it('does not send a duplicate root for an existing request',async()=>{
  mocks.db.placementSlackThread.findUnique.mockResolvedValue(thread);
  const result=await sendPlacementRequest({requestId:id,studentName:'학생',requestedBy:'staff'},'text',[]);
  expect(result.delivered).toBe(true);expect(fetchMock).not.toHaveBeenCalled();
 });
 it('keeps an ambiguous root delivery uncertain instead of automatically reposting',async()=>{
  mocks.db.placementSlackThread.findUnique.mockResolvedValue(null);mocks.db.employee.findFirst.mockResolvedValue(null);
  mocks.db.placementSlackThread.create.mockImplementation(async({data})=>({...thread,...data,rootTs:null}));
  fetchMock.mockRejectedValue(new Error('timeout after accepted'));
  expect((await sendPlacementRequest({requestId:id,studentName:'학생',requestedBy:'staff'},'text',[])).delivered).toBeNull();
  expect(mocks.db.placementSlackThread.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'uncertain'})}));
 });
 it('rejects acknowledgement by anyone other than the current DM recipient',async()=>{
  mocks.db.placementSlackReply.findUnique.mockResolvedValue(reply);
  await handlePlacementAction({user:{id:'UOTHER'},container:{channel_id:'D1',message_ts:reply.dmTs},actions:[{action_id:'placement_reply_ack',value:'reply'}]});
  expect(mocks.db.placementSlackReply.updateMany).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls[0][0]).toContain('chat.postEphemeral');
 });
 it('persists acknowledgement before updating both DM and root; retry can recover a Slack outage',async()=>{
  mocks.db.placementSlackReply.findUnique.mockResolvedValue(reply);mocks.db.employee.findFirst.mockResolvedValue({active:true});
  mocks.db.placementSlackReply.findUniqueOrThrow.mockResolvedValue({...reply,acknowledgedAt:new Date()});
  mocks.db.placementSlackThread.findUniqueOrThrow.mockResolvedValue(thread);
  await handlePlacementAction({user:{id:'UOWNER'},container:{channel_id:'D1',message_ts:reply.dmTs},actions:[{action_id:'placement_reply_ack',value:'reply'}]});
  expect(mocks.db.placementSlackReply.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({acknowledgedAt:expect.any(Date),syncedAt:null})}));
  expect(fetchMock.mock.calls.filter(c=>String(c[0]).includes('chat.update'))).toHaveLength(2);
 });
 it('does not send queued replies when owner is missing or author lost access',async()=>{
  mocks.db.placementSlackReply.findMany.mockResolvedValueOnce([{id:'reply'}]).mockResolvedValueOnce([]);
  mocks.db.placementSlackReply.findUniqueOrThrow.mockResolvedValue(reply);
  mocks.db.employee.findFirst.mockResolvedValueOnce({slackUserId:'UOWNER'}).mockResolvedValueOnce({active:true,resignDate:null,department:'교수부',position:'강사'});
  await dispatchPlacementReplies();expect(fetchMock).not.toHaveBeenCalled();
  expect(mocks.db.placementSlackReply.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{state:'skipped'}}));
 });
});
