import {NextRequest,NextResponse} from "next/server";
import {getAnimeDetail} from "@/lib/reanime";
import {getSessionUser} from "@/lib/auth";
import {reanimeSlug} from "@/lib/reanime-client";
export async function GET(request:NextRequest) {
  if (!await getSessionUser()) return new NextResponse("Unauthorized",{status:401});
  const id = request.nextUrl.searchParams.get("id") || "";
  try { reanimeSlug(id); } catch { return NextResponse.json({success:false,message:"Reanime 작품 ID가 필요합니다."},{status:400}); }
  try {
    return NextResponse.json(await getAnimeDetail(id),{headers:{"Cache-Control":"private, no-store"}});
  } catch {
    return NextResponse.json({success:false,message:"서버에서 Reanime 작품에 연결하지 못했습니다.",browserRetry:true},{status:502});
  }
}
