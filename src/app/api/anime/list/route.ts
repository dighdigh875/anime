import {NextRequest,NextResponse} from "next/server";
import {getAnimeList} from "@/lib/reanime";
import {getSessionUser} from "@/lib/auth";
export async function GET(request:NextRequest) {
  if (!await getSessionUser()) return new NextResponse("Unauthorized",{status:401});
  const p = request.nextUrl.searchParams;
  try {
    const result = await getAnimeList({q:p.get("q")?.trim(),tab:p.get("tab")||"airing",page:Number(p.get("page"))||1});
    return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
  } catch {
    return NextResponse.json({success:false,message:"서버에서 Reanime 목록에 연결하지 못했습니다.",browserRetry:true},{status:502});
  }
}
