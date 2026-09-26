import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getAnissiaAnime, searchReanimeCandidates } from '@/lib/anissia';
import { getAnimeMapping, saveAnimeMapping } from '@/lib/anime-mapping';
import { getAnimeDetail } from '@/lib/providers/reanime';
import { getReanimeBaseUrl } from '@/lib/db';

export const maxDuration = 30;
const headers = {'Cache-Control': 'private, no-store'};

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({error: '로그인이 필요합니다.'}, {status: 401});
  const p = request.nextUrl.searchParams;
  const id = Number(p.get('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({error: '잘못된 작품 번호입니다.'}, {status: 400});
  try {
    if (p.get('search') === '1') {
      const anime = await getAnissiaAnime(id);
      const candidates = await searchReanimeCandidates(anime, await getReanimeBaseUrl(), p.get('q')?.trim().slice(0, 120) || undefined);
      return NextResponse.json({candidates}, {headers});
    }
    const mapping = await getAnimeMapping(user.username, id);
    const detail = mapping ? await getAnimeDetail(mapping.reanimeId) : null;
    return NextResponse.json({mapping, detail}, {headers});
  } catch (error) {
    console.error('[Anissia mapping GET]', error);
    return NextResponse.json({error: '작품 연결을 불러오지 못했습니다. DB 연결과 Reanime 상태를 확인해 주세요.'}, {status: 502});
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({error: '로그인이 필요합니다.'}, {status: 401});
  try {
    const {animeNo, reanimeId, episodeOffset} = await request.json();
    if (!Number.isSafeInteger(animeNo) || animeNo <= 0 || typeof reanimeId !== 'string' || !/^re_[a-zA-Z0-9_-]{1,230}$/.test(reanimeId)
      || !Number.isInteger(episodeOffset) || Math.abs(episodeOffset) > 5000) {
      return NextResponse.json({error: '작품과 회차 차이를 확인해 주세요.'}, {status: 400});
    }
    await getAnissiaAnime(animeNo);
    const detail = await getAnimeDetail(reanimeId);
    if (!detail) return NextResponse.json({error: '선택한 Reanime 작품을 확인하지 못했습니다.'}, {status: 502});
    const mapping = {reanimeId, episodeOffset};
    await saveAnimeMapping(user.username, animeNo, mapping);
    return NextResponse.json({mapping, detail}, {headers});
  } catch (error) {
    console.error('[Anissia mapping POST]', error);
    return NextResponse.json({error: '작품 연결을 저장하지 못했습니다. DB 연결을 확인해 주세요.'}, {status: 503});
  }
}
