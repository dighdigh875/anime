import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getAnissiaAnime, listAnissiaAnime } from '@/lib/anissia';
import { getAnissiaCreatorsById } from '@/lib/subtitles';

export async function GET(request: NextRequest) {
  if (!await getSessionUser()) return NextResponse.json({error: '로그인이 필요합니다.'}, {status: 401});
  const p = request.nextUrl.searchParams;
  try {
    if (p.has('id')) {
      const id = Number(p.get('id'));
      if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({error: '잘못된 작품 번호입니다.'}, {status: 400});
      const anime = await getAnissiaAnime(id);
      let creators: Awaited<ReturnType<typeof getAnissiaCreatorsById>> = [];
      let captionsUnavailable = false;
      try { creators = await getAnissiaCreatorsById(id, -1); } catch { captionsUnavailable = true; }
      return NextResponse.json({anime, creators, captionsUnavailable}, {headers: {'Cache-Control': 'private, no-store'}});
    }
    const q = (p.get('q') || '').trim().slice(0, 120);
    const page = Number(p.get('page') || '0');
    const week = p.get('week') || '6';
    if (!Number.isSafeInteger(page) || page < 0 || page > 1000 || !/^[0-8]$/.test(week)) return NextResponse.json({error: '잘못된 검색 조건입니다.'}, {status: 400});
    return NextResponse.json(await listAnissiaAnime(q, page, week), {headers: {'Cache-Control': 'private, no-store'}});
  } catch {
    return NextResponse.json({error: '애니시아 정보를 불러오지 못했습니다. 다시 시도해 주세요.'}, {status: 502});
  }
}
