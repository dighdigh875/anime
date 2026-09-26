import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getAnissiaAnime } from '@/lib/anissia';
import {searchReanimeCandidates, ReanimeRequestError} from '@/lib/reanime-api';
import { getAnimeMapping, saveAnimeMapping } from '@/lib/anime-mapping';
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
      const baseUrl = await getReanimeBaseUrl();
      try {
        const candidates = await searchReanimeCandidates(anime, baseUrl, p.get('q')?.trim().slice(0, 120) || undefined, request.signal);
        return NextResponse.json({candidates}, {headers});
      } catch (error) {
        console.error('[Anissia Reanime search]', {status: error instanceof ReanimeRequestError ? error.status : undefined, message: error instanceof Error ? error.message : 'Unknown error'});
        return NextResponse.json({code: 'REANIME_UNAVAILABLE', baseUrl, error: error instanceof ReanimeRequestError ? error.message : 'Reanime 검색에 연결하지 못했습니다.'}, {status: 502, headers});
      }
    }
    const mapping = await getAnimeMapping(user.username, id);
    return NextResponse.json({mapping}, {headers});
  } catch (error) {
    console.error('[Anissia mapping GET]', error);
    const search = p.get('search') === '1';
    return NextResponse.json({code: search ? 'ANISSIA_UNAVAILABLE' : 'DATABASE_ERROR', error: search ? '애니시아 작품 정보를 불러오지 못했습니다.' : '저장된 작품 연결을 읽지 못했습니다. DB 연결을 확인해 주세요.'}, {status: 503, headers});
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
    try { await getAnissiaAnime(animeNo); }
    catch (error) {
      console.error('[Anissia mapping metadata]', error);
      return NextResponse.json({code: 'ANISSIA_UNAVAILABLE', error: '애니시아 작품 정보를 불러오지 못했습니다.'}, {status: 502, headers});
    }
    // This is a personal preference, not a cache of browser-supplied URLs or metadata.
    // The client verifies the selected detail before saving; a provider outage must not block the DB write.
    const mapping = {reanimeId, episodeOffset};
    await saveAnimeMapping(user.username, animeNo, mapping);
    return NextResponse.json({mapping}, {headers});
  } catch (error) {
    console.error('[Anissia mapping POST]', error);
    return NextResponse.json({code: 'DATABASE_ERROR', error: '작품 연결을 저장하지 못했습니다. DB 연결을 확인해 주세요.'}, {status: 503, headers});
  }
}
