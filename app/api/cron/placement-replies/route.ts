import {timingSafeEqual} from 'node:crypto';
import {dispatchPlacementReplies} from '@/lib/placement-reply-service';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(req:Request){
 const secret=process.env.CRON_SECRET??'';const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(req.headers.get('authorization')??'');
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return Response.json({error:'unauthorized'},{status:401});
 return Response.json(await dispatchPlacementReplies());
}
