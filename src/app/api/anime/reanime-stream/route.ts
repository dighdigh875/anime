import {NextRequest,NextResponse} from "next/server";
import {getSessionUser} from "@/lib/auth";
import {getReanimeBaseUrl} from "@/lib/db";
import {fetchReanimeStream} from "@/lib/reanime-client";
import {reanimeServerFetch} from "@/lib/reanime";
// Fixed provider endpoint only: no client-controlled upstream URL or host.
export async function GET(request:NextRequest) {
  if (!await getSessionUser()) return new NextResponse("Unauthorized",{status:401});
  const p = request.nextUrl.searchParams;
  const anilist = Number(p.get("anilist")), ep = Number(p.get("ep"));
  if (!Number.isSafeInteger(anilist) || anilist <= 0 || !Number.isSafeInteger(ep) || ep <= 0) return NextResponse.json({success:false},{status:400});
  try {
    return NextResponse.json(await fetchReanimeStream(await getReanimeBaseUrl(),anilist,ep,p.get("dub")==="1",reanimeServerFetch),{headers:{"Cache-Control":"private, no-store"}});
  } catch {
    return NextResponse.json({success:false,message:"Reanime 영상 서버 연결 실패",browserRetry:true},{status:502});
  }
}
