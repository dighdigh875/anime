import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getAnissiaAnime } from '@/lib/anissia';
import { getAnimeMapping } from '@/lib/anime-mapping';
import { getAnimeDetail, getEpisodeStream } from '@/lib/providers/reanime';
import { prepareKoreanPlayback, validateKoreanSubtitle } from '@/lib/korean-playback';
import { searchAllSubtitlesParallel, parseEpisodes, type SubtitleResult } from '@/lib/subtitles';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({error: '로그인이 필요합니다.'}, {status: 401});
  try {
    if (Number(request.headers.get('content-length')) > 2_100_000) return NextResponse.json({error: '자막 파일이 너무 큽니다.'}, {status: 413});
    const {animeNo, episode, reanimeId, episodeOffset, manualSubtitle} = await request.json();
    if (!Number.isSafeInteger(animeNo) || animeNo <= 0 || !Number.isFinite(episode) || episode < 0 || episode > 10000 || Math.round(episode * 10) !== episode * 10) {
      return NextResponse.json({error: '작품과 회차를 확인해 주세요.'}, {status: 400});
    }
    const mapping = await getAnimeMapping(user.username, animeNo);
    if (!mapping) return NextResponse.json({error: '먼저 같은 작품의 Reanime 영상을 연결해 주세요.'}, {status: 409});
    if (mapping.reanimeId !== reanimeId || mapping.episodeOffset !== episodeOffset) return NextResponse.json({error: '작품 연결이 변경되었습니다. 새로고침 후 다시 시도해 주세요.'}, {status: 409});
    const [anime, detail] = await Promise.all([getAnissiaAnime(animeNo), getAnimeDetail(mapping.reanimeId)]);
    if (!detail) return NextResponse.json({error: '영상 회차 정보를 불러오지 못했습니다.'}, {status: 502});
    let manual: SubtitleResult | null = null;
    if (manualSubtitle) {
      manual = {name: String(manualSubtitle.name || '직접 선택한 자막').slice(0, 200), episode: Number(manualSubtitle.episode), orig_filename: String(manualSubtitle.orig_filename || ''),
        is_ass: manualSubtitle.is_ass === true, format: manualSubtitle.is_ass === true ? 'ASS' : 'VTT', content: manualSubtitle.content};
      const filenameEpisodes = parseEpisodes(manual.orig_filename);
      if (manual.episode !== episode || !validateKoreanSubtitle(manual) || (filenameEpisodes.length > 0 && !filenameEpisodes.includes(episode))) {
        return NextResponse.json({error: '한국어 대사와 재생 시간을 확인하지 못했거나 파일의 회차가 다릅니다.'}, {status: 400});
      }
    }
    const result = await prepareKoreanPlayback({episode, offset: mapping.episodeOffset, episodes: detail.sub_episodes}, {
      findSubtitles: () => manual ? Promise.resolve({subtitles: [manual], creators: [], status: 'ready'}) : searchAllSubtitlesParallel(anime.subject, episode, 18000, animeNo),
      getStream: getEpisodeStream,
    });
    return NextResponse.json({...result, anime, detail, mapping}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    console.error('[Anissia prepare]', error);
    return NextResponse.json({error: '재생 준비 중 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.'}, {status: 502});
  }
}
