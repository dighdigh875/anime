import { rankReanimeCandidates, type ReanimeCandidate } from './korean-playback';

export interface AnissiaAnime {
  animeNo: number;
  subject: string;
  originalSubject: string;
  startDate: string;
  endDate?: string;
  genres: string;
  week: string;
  time: string;
  status: string;
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.anissia.net/anime/${path}`, {
    signal: AbortSignal.timeout(8000), next: {revalidate: 300},
  });
  if (!response.ok) throw new Error('애니시아에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const json = await response.json();
  if (json.code && json.code !== 'ok') throw new Error('애니시아에서 작품 정보를 받지 못했습니다.');
  return json.data ?? json;
}

export async function getAnissiaAnime(id: number): Promise<AnissiaAnime> {
  const anime = await request<AnissiaAnime>(`animeNo/${id}`);
  if (!anime || anime.animeNo !== id || !anime.subject) throw new Error('작품을 찾지 못했습니다.');
  return anime;
}

export async function listAnissiaAnime(query = '', page = 0, week = '6') {
  if (query) {
    const data = await request<{content: AnissiaAnime[]; last: boolean; totalPages: number}>(`list/${page}?q=${encodeURIComponent(query)}`);
    if (!Array.isArray(data.content)) throw new Error('작품 검색 응답을 읽지 못했습니다.');
    return {items: data.content, hasNext: !data.last, page};
  }
  const data = await request<AnissiaAnime[]>(`schedule/${week}`);
  if (!Array.isArray(data)) throw new Error('편성표 응답을 읽지 못했습니다.');
  return {items: data, hasNext: false, page: 0};
}

export async function searchReanimeCandidates(anime: AnissiaAnime, baseUrl: string, query?: string): Promise<ReanimeCandidate[]> {
  const terms = query ? [query] : Array.from(new Set([anime.originalSubject, anime.subject].filter(Boolean)));
  const batches = await Promise.all(terms.map(async term => {
    const response = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent(term)}`, {
      headers: {Accept: 'application/json', Referer: `${baseUrl}/`}, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Reanime 작품 검색에 실패했습니다.');
    const json = await response.json();
    if (!Array.isArray(json.results)) throw new Error('Reanime 검색 응답을 읽지 못했습니다.');
    return json.results.map((item: any): ReanimeCandidate => ({
      id: `re_${item.anime_id}`, title: item.title?.english || item.title?.romaji || item.title?.native || '',
      nativeTitle: item.title?.native || '', romajiTitle: item.title?.romaji || '',
      poster: item.cover_image?.large || item.cover_image?.medium || '',
      year: String(item.season_year || item.start_date?.year || ''), episodes: Number(item.episodes || 0), format: item.format || '',
    }));
  }));
  const unique = new Map<string, ReanimeCandidate>();
  batches.flat().filter(c => /^re_[a-zA-Z0-9_-]+$/.test(c.id)).forEach(c => unique.set(c.id, c));
  return rankReanimeCandidates(anime, Array.from(unique.values()));
}
