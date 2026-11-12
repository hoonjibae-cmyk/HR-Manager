import {beforeEach,describe,it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({placementSlackResult:{findUnique:vi.fn(),create:vi.fn()}}));
vi.mock('./db',()=>({prisma:db}));
import {registerResultSnapshot,validResultSnapshot} from './placement-results';
const input={rootId:'b6aa6a58-49e0-4da7-9e11-52275f24bfa7',fingerprint:'a6aa6a58-49e0-4da7-9e11-52275f24bfa7',schedule:'화목',report:{family:'C_generic',examTitle:'반배치고사',student:{name:'학생'},score:{raw:80,max:100},areas:[{area:'독해',earned:40,possible:50}]}};
beforeEach(()=>vi.resetAllMocks());
describe('immutable placement score snapshots',()=>{
 it('uses the legacy root image token for the first snapshot',async()=>{
  db.placementSlackResult.findUnique.mockResolvedValue(null);db.placementSlackResult.create.mockImplementation(async({data})=>data);
  const result=await registerResultSnapshot({...input,alreadySent:true});
  expect(result.id).toBe(input.rootId);expect(result.state).toBe('sent');
  expect(JSON.parse(result.report).score.raw).toBe(80);
 });
 it('never replaces an existing snapshot when the same result is requested again',async()=>{
  const stored={id:input.rootId,report:JSON.stringify(input.report),state:'sent'};db.placementSlackResult.findUnique.mockResolvedValue(stored);
  const result=await registerResultSnapshot({...input,report:{...input.report,score:{raw:95,max:100}}});
  expect(result).toBe(stored);expect(db.placementSlackResult.create).not.toHaveBeenCalled();expect(JSON.parse(result.report).score.raw).toBe(80);
 });
 it('stores the next attempt under a different image token and pending delivery',async()=>{
  db.placementSlackResult.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({id:input.rootId});db.placementSlackResult.create.mockImplementation(async({data})=>data);
  const result=await registerResultSnapshot(input);expect(result.id).toBe(input.fingerprint);expect(result.state).toBe('pending');
 });
 it('rejects invalid or missing score data',()=>{
  expect(validResultSnapshot(input)).toBe(true);expect(validResultSnapshot({...input,report:{...input.report,score:{raw:null,max:100}}})).toBe(false);
  expect(validResultSnapshot({...input,rootId:'invalid'})).toBe(false);
 });
});
