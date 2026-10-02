import {NextRequest, NextResponse} from 'next/server';
import {getSessionUser} from '@/lib/auth';
import {getReanimeBaseUrl} from '@/lib/db';
import {getReanimeDetail, getReanimeStream, ReanimeRequestError} from '@/lib/reanime-api';
import {fetchReanimeServer, isReanimeWorkerConfigured} from '@/lib/reanime-server-fetch';

export const maxDuration = 15;
const headers = {'Cache-Control': 'private, no-store'};

export async function GET(request: NextRequest) {
  if (!await getSessionUser()) return NextResponse.json({error: '로그인이 필요합니다.'}, {status: 401, headers});
  const p = request.nextUrl.searchParams;
  const id = p.get('id') || '';
  const episode = p.has('episode') ? Number(p.get('episode')) : null;
  const anilistId = Number(p.get('anilist'));
  const language = p.get('lang') || 'sub';
  if (language !== 'sub' && language !== 'dub') return NextResponse.json({error: '잘못된 영상 언어입니다.'}, {status: 400, headers});
  if (!/^re_[a-zA-Z0-9_-]{1,230}$/.test(id) || (episode !== null &&
    (!Number.isFinite(episode) || episode < 0 || episode > 10000 || Math.round(episode * 10) !== episode * 10 || !Number.isSafeInteger(anilistId) || anilistId <= 0))) {
    return NextResponse.json({error: '작품과 회차를 확인해 주세요.'}, {status: 400, headers});
  }
  const baseUrl = await getReanimeBaseUrl();
  try {
    return NextResponse.json(episode === null
      ? {detail: await getReanimeDetail(baseUrl, id, request.signal, fetchReanimeServer)}
      : {stream: await getReanimeStream(baseUrl, anilistId, episode, request.signal, language, fetchReanimeServer)}, {headers});
  } catch (error) {
    console.error('[Anissia Reanime]', {stage: episode === null ? 'detail' : 'stream', status: error instanceof ReanimeRequestError ? error.status : undefined, message: error instanceof Error ? error.message : 'Unknown error'});
    return NextResponse.json({code: 'REANIME_UNAVAILABLE', baseUrl, browserFallback: !isReanimeWorkerConfigured(), error: error instanceof ReanimeRequestError ? error.message : 'Reanime에 연결하지 못했습니다.'}, {status: 502, headers});
  }
}
