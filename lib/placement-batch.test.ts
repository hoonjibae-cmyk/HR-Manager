import {describe,it,expect} from 'vitest';
import {placementBatchMessage} from './placement-batch';
const input=()=>({requestId:'a6aa6a58-49e0-4da7-9e11-52275f24bfa7',requestedBy:'staff',workspaceUrl:'https://classfit.yussam.com/?workspace=example&grade=%EC%B4%886',students:Array.from({length:10},(_,i)=>({name:`학생${i}`,score:80+i}))});
describe('묶음 반배정 알림',()=>{
 it('10명부터 이름·총점·링크만 표시하고 이미지 없이 기존 담당자 스레드로 보낸다',()=>{const m=placementBatchMessage(input());expect(m.text).toContain('신규생 10명의 반편성 요청이 있습니다.');expect(m.text).toContain('학생0 · 80점');expect(m.blocks.some(b=>b.type==='image')).toBe(false);expect(m.request.studentName).toBe('신규생 10명');});
 it('9명·외부 링크·비정상 점수를 거부하고 Slack 멘션을 이스케이프한다',()=>{const x=input();expect(()=>placementBatchMessage({...x,students:x.students.slice(1)})).toThrow();expect(()=>placementBatchMessage({...x,workspaceUrl:'https://evil.example/'})).toThrow();x.students[0]={name:'<!channel>',score:80};expect(placementBatchMessage(x).text).not.toContain('<!channel>');x.students[0].score=NaN;expect(()=>placementBatchMessage(x)).toThrow();});
});
