import {isAuthed} from '@/lib/auth';
import {slackAuthTest} from '@/lib/slack';
import {prisma} from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET(){
 if(!await isAuthed())return Response.json({error:'unauthorized'},{status:401});
 const auth=await slackAuthTest();
 const [threads,replies,uncertain,lastEvent]=await Promise.all([prisma.placementSlackThread.count(),prisma.placementSlackReply.count(),prisma.placementSlackReply.count({where:{state:'uncertain'}}),prisma.placementSlackEvent.findFirst({orderBy:{createdAt:'desc'},select:{createdAt:true,state:true,error:true}})]);
 return Response.json({version:'1.60.0',slack:auth,threads,replies,uncertain,lastEvent},{headers:{'Cache-Control':'no-store'}});
}
