import { normalizeReanimeUrl } from "@/lib/reanime-client";
import { checkReanimeHealth } from "@/lib/reanime";
import { NextRequest, NextResponse } from "next/server";
import { getReanimeBaseUrl, setReanimeBaseUrl, DEFAULT_REANIME_URL } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  // 보안: 설정된 베이스 URL이 외부에 노출되지 않도록 로그인 요구
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { success: false, message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  try {
    const currentBaseUrl = await getReanimeBaseUrl();
    const health = await checkReanimeHealth(currentBaseUrl);

    return NextResponse.json({
      success: true,
      baseUrl: currentBaseUrl,
      defaultUrl: DEFAULT_REANIME_URL,
      isHealthy: health.ok,
      latencyMs: health.latencyMs,
      statusText: health.statusText,
    });
  } catch (error: any) {
    console.error("[GET /api/settings/base-url error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "베이스 URL을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { success: false, message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }
  // 보안: 사이트 전체에 적용되는 설정이므로 관리자만 변경 가능
  if (!user.isAdmin) {
    return NextResponse.json(
      { success: false, message: "관리자만 베이스 URL을 변경할 수 있습니다." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const rawUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const force = Boolean(body.force);

    if (!rawUrl) {
      return NextResponse.json(
        { success: false, message: "베이스 URL을 입력해주세요." },
        { status: 400 }
      );
    }

    let formatted: string;
    try { formatted = normalizeReanimeUrl(rawUrl); }
    catch {
      return NextResponse.json({success:false,message:"Reanime HTTPS 도메인을 입력해주세요. 예: https://reanime.to"},{status:400});
    }

    // 보안: 내부/비공개 주소로의 SSRF 차단
    try {
      await assertSafeProxyUrl(formatted);
    } catch (e) {
      if (e instanceof UnsafeProxyUrlError) {
        return NextResponse.json(
          { success: false, message: `허용되지 않는 주소입니다: ${e.message}` },
          { status: 400 }
        );
      }
      throw e;
    }

    // 연결성 테스트
    const health = await checkReanimeHealth(formatted);
    if (!health.ok && !force) {
      return NextResponse.json(
        {
          success: false,
          needsConfirmation: true,
          message: `서버에서 Reanime(${formatted}) 목록을 확인하지 못했습니다 (${health.statusText}). 저장 후 브라우저 재시도는 가능하지만 재생을 보장하지 않습니다. 그래도 저장하시겠습니까?`,
          baseUrl: formatted,
          health,
        },
        { status: 422 }
      );
    }

    const saved = await setReanimeBaseUrl(formatted);
    if (!saved) {
      return NextResponse.json(
        { success: false, message: "데이터베이스 저장에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      baseUrl: formatted,
      message: "스트리밍 베이스 URL이 성공적으로 변경되었습니다.",
      health,
    });
  } catch (error: any) {
    console.error("[POST /api/settings/base-url error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "베이스 URL 저장에 실패했습니다." },
      { status: 500 }
    );
  }
}
