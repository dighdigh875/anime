// Shared by the server and browser. Do not import server providers/DB here.
import {rankReanimeCandidates, type ReanimeCandidate} from './korean-playback';
import type {AnimeDetail, EpisodeStreamInfo} from './providers/types';

export class ReanimeRequestError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = 'ReanimeRequestError'; }
}

export function reanimeOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Reanime 도메인 설정을 확인해 주세요.');
  return url.origin;
}

async function request(baseUrl: string, path: string, signal?: AbortSignal): Promise<any> {
  const timeout = AbortSignal.timeout(8000);
  let response: Response;
  try {
    response = await fetch(`${reanimeOrigin(baseUrl)}${path}`, {
      headers: {Accept: 'application/json'}, credentials: 'omit', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ReanimeRequestError(timeout.aborted ? 'Reanime 응답 시간이 초과되었습니다.' : 'Reanime에 연결하지 못했습니다.');
  }
  if (!response.ok) throw new ReanimeRequestError(`Reanime 요청 실패 (HTTP ${response.status}).`, response.status);
  try { return await response.json(); }
  catch { throw new ReanimeRequestError('Reanime에서 올바른 JSON 응답을 받지 못했습니다.', response.status); }
}

export async function searchReanimeCandidates(
  anime: {originalSubject: string; subject: string; startDate: string}, baseUrl: string, query?: string, signal?: AbortSignal,
): Promise<ReanimeCandidate[]> {
  const terms = query ? [query] : Array.from(new Set([anime.originalSubject, anime.subject].filter(Boolean)));
  const batches = await Promise.all(terms.map(async term => {
    const json = await request(baseUrl, `/api/v1/search?q=${encodeURIComponent(term)}`, signal);
    if (!Array.isArray(json?.results)) throw new ReanimeRequestError('Reanime 검색 응답을 읽지 못했습니다.');
    return json.results.filter((item: any) => item && /^[a-zA-Z0-9_-]{1,230}$/.test(item.anime_id)).map((item: any): ReanimeCandidate => ({
      id: `re_${item.anime_id}`, title: item.title?.english || item.title?.romaji || item.title?.native || '',
      nativeTitle: item.title?.native || '', romajiTitle: item.title?.romaji || '',
      poster: item.cover_image?.large || item.cover_image?.medium || '',
      year: String(item.season_year || item.start_date?.year || ''), episodes: Number(item.episodes || 0), format: item.format || '',
    }));
  }));
  const unique = new Map<string, ReanimeCandidate>();
  batches.flat().forEach(c => unique.set(c.id, c));
  return rankReanimeCandidates(anime, Array.from(unique.values()));
}

export interface ReanimeDetail extends AnimeDetail { anilistId: number }

export function getReanimeWatchStream(baseUrl: string, detail: ReanimeDetail, episode: number): EpisodeStreamInfo {
  if (!/^re_[a-zA-Z0-9_-]{1,230}$/.test(detail.id) || !Number.isSafeInteger(detail.anilistId) || detail.anilistId <= 0 ||
      !Number.isFinite(episode) || episode < 0 || episode > 10000) throw new Error('영상 작품·회차 번호를 확인하지 못했습니다.');
  const url = `${reanimeOrigin(baseUrl)}/watch/${detail.id.slice(3)}?ep=${episode}&anilist=${detail.anilistId}&lang=sub`;
  return {success: true, embed_url: url, player_url: url, reanime_watch_page: true, stream_type: 'iframe',
    m3u8_url: '', vtt_url: '', server_sources: [], link_next: '', link_pre: ''};
}

export async function getReanimeDetail(baseUrl: string, id: string, signal?: AbortSignal): Promise<ReanimeDetail> {
  if (!/^re_[a-zA-Z0-9_-]{1,230}$/.test(id)) throw new Error('잘못된 Reanime 작품 번호입니다.');
  const slug = id.slice(3);
  const [raw, eps] = await Promise.all([
    request(baseUrl, `/api/v1/anime/${slug}`, signal), request(baseUrl, `/api/v1/anime/${slug}/episodes`, signal),
  ]);
  if (!raw?.title || !Array.isArray(eps?.data)) throw new ReanimeRequestError('Reanime 작품·회차 응답을 읽지 못했습니다.');
  const anilistId = Number(raw.anilist_id || 0);
  const subEpisodes = eps.data.filter((e: any) => e && e.subbed !== false).map((e: any) => {
    const number = Number(e.episode_number ?? e.number);
    if (!Number.isFinite(number) || number < 0 || number > 10000) throw new ReanimeRequestError('Reanime 회차 번호를 확인하지 못했습니다.');
    return {number, title: e.title ? `${number}화 - ${e.title}` : `${number}화`,
      watch_url: `${reanimeOrigin(baseUrl)}/watch/${slug}?ep=${number}&anilist=${anilistId}`};
  });
  return {
    id, anilistId, title: raw.title.english || raw.title.romaji || raw.title.native || slug,
    poster: raw.cover_image?.extra_large || raw.cover_image?.large || raw.cover_image?.medium || '',
    description: typeof raw.description === 'string' ? raw.description.replace(/<br\s*\/?\s*>/gi, '\n') : '',
    genres: Array.isArray(raw.genres) ? raw.genres : [], sub_episodes: subEpisodes, dub_episodes: [],
    total_episodes: Number(raw.episodes || subEpisodes.length), status_text: raw.status || '',
    year: String(raw.season_year || ''), is_finished: raw.status === 'Finished',
  };
}

export async function getReanimeStream(baseUrl: string, anilistId: number, episode: number, signal?: AbortSignal): Promise<EpisodeStreamInfo> {
  if (!Number.isSafeInteger(anilistId) || anilistId <= 0 || !Number.isFinite(episode) || episode < 0 || episode > 10000) {
    throw new Error('영상 작품·회차 번호를 확인하지 못했습니다.');
  }
  const json = await request(baseUrl, `/api/flix/${anilistId}/${episode}`, signal);
  const servers = (Array.isArray(json?.servers) ? json.servers : []).filter((s: any) => {
    if (s?.dataType !== 'sub' || typeof s.dataLink !== 'string') return false;
    try {const url = new URL(s.dataLink); return url.protocol === 'https:' && !url.username && !url.password && !/\.m3u8$/i.test(url.pathname);}
    catch {return false;}
  });
  const selected = servers.find((s: any) => s.serverName === 'HD-1') || servers[0];
  if (!selected) throw new ReanimeRequestError('자막용 영상 플레이어를 찾지 못했습니다.');
  return {success: true, embed_url: selected.dataLink, player_url: selected.dataLink, stream_type: 'iframe', m3u8_url: '', vtt_url: '',
    server_sources: servers.map((s: any) => ({label: `${s.serverName || 'HD'} (sub)`, player_url: s.dataLink})), link_next: '', link_pre: ''};
}
