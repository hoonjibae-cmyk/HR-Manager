import {describe,it,expect} from 'vitest';
import {placementImageBlocks} from './placement-image';
const url='https://report.yussam.com/api/placement/summary/11111111-1111-4111-8111-111111111111?expires=123456789&signature='+'a'.repeat(64);
describe('반배정 성적 이미지 알림',()=>{
  it('기존 글 알림은 그대로 보내고 지정 앱·채널·이미지 주소에만 이미지를 허용한다',()=>{
    expect(placementImageBlocks('other','COTHER','기존 알림',undefined,undefined)).toBeUndefined();
    expect(placementImageBlocks('omr-report','C06PAG818TZ','반배정 요청',url,'성적 요약')?.[1]).toMatchObject({type:'image',image_url:url});
    for(const bad of [url.replace('report.yussam.com','evil.example'),url.replace('https:','http:')])expect(()=>placementImageBlocks('omr-report','C06PAG818TZ','요청',bad,'요약')).toThrow();
    expect(()=>placementImageBlocks('other','C06PAG818TZ','요청',url,'요약')).toThrow();
  });
});
