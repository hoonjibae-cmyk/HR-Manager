import {directoryRequestAuthorized} from '@/lib/directory-api-auth';
import {prisma} from '@/lib/db';
import {registerResultSnapshot,validResultSnapshot} from '@/lib/placement-results';
export const dynamic='force-dynamic';
function authorized(req:Request){return req.headers.get('x-app')==='omr-report'&&directoryRequestAuthorized('omr-report',req.headers.get('x-api-key')??'');}
export async function POST(req:Request){
 if(!authorized(req))return Response.json({error:'unauthorized'},{status:401});
 let input;try{input=await req.json();}catch{return Response.json({error:'invalid JSON'},{status:400});}
 if(!validResultSnapshot(input)||JSON.stringify(input).length>100000)return Response.json({error:'invalid snapshot'},{status:400});
 const result=await registerResultSnapshot(input);
 return Response.json({id:result.id,state:result.state,root:result.id===result.rootId});
}
export async function GET(req:Request){
 if(!authorized(req))return Response.json({error:'unauthorized'},{status:401});
 const id=new URL(req.url).searchParams.get('id')??'';
 if(!/^[a-f0-9-]{36}$/i.test(id))return Response.json({error:'invalid id'},{status:400});
 const result=await prisma.placementSlackResult.findUnique({where:{id}});
 if(!result)return Response.json({error:'not found'},{status:404});
 return Response.json({report:JSON.parse(result.report),schedule:result.schedule},{headers:{'Cache-Control':'no-store'}});
}
