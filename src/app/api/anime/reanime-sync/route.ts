import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, getCurrentUserId } from "@/lib/auth";
import { getReanimeSubtitleSetting, setReanimeSubtitleSetting } from "@/lib/db";
import { reanimeSlug } from "@/lib/reanime-client";

function validId(id: unknown): id is string {
  if (typeof id !== "string" || id.length > 500) return false;
  try { reanimeSlug(id); return true; } catch { return false; }
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const animeId = searchParams.get("animeId");
  const epStr = searchParams.get("ep");

  if (!validId(animeId) || !epStr) {
    return NextResponse.json({ success: false, message: "Missing animeId or ep" }, { status: 400 });
  }

  const epNum = Number(epStr);
  if (!Number.isSafeInteger(epNum) || epNum <= 0) {
    return NextResponse.json({ success: false, message: "Invalid ep number" }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  const setting = await getReanimeSubtitleSetting(userId, animeId, epNum);

  return NextResponse.json(
    { success: true, setting },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const { animeId, ep, syncOffset, subtitleName, subtitleUrl } = body;

    if (!validId(animeId) || ep === undefined) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    const epNum = Number(ep);
    const offsetVal = Number(syncOffset ?? 0);
    if (!Number.isSafeInteger(epNum) || epNum <= 0 || !Number.isFinite(offsetVal) || Math.abs(offsetVal) > 86400 ||
      (subtitleName != null && (typeof subtitleName !== "string" || subtitleName.length > 500)) ||
      (subtitleUrl != null && (typeof subtitleUrl !== "string" || subtitleUrl.length > 4096))) {
      return NextResponse.json({success:false,message:"회차 또는 자막 설정 값이 올바르지 않습니다."},{status:400});
    }

    const userId = await getCurrentUserId();
    const ok = await setReanimeSubtitleSetting(
      userId,
      animeId,
      epNum,
      offsetVal,
      subtitleName || null,
      subtitleUrl || null
    );

    return NextResponse.json({ success: ok }, {status: ok ? 200 : 503});
  } catch (e: any) {
    console.error("[reanime-sync POST error]:", e);
    return NextResponse.json({ success: false, message: "자막 설정 저장에 실패했습니다." }, { status: 500 });
  }
}
