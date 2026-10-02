import {getReanimeDetail, searchReanimeCandidates, type ReanimeDetail} from './reanime-api';
import {ReanimeBridgeError, requestReanimeBrowserStream} from './reanime-browser-bridge';
import type {AnissiaAnime} from './anissia';

export async function requestWithReanimeFallback<T>(url: string, direct: (baseUrl: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {signal});
  const data = await response.json();
  signal?.throwIfAborted();
  if (response.ok) return data;
  // Only retry a provider failure. Login/DB/Anissia failures must stay visible.
  if (data.code !== 'REANIME_UNAVAILABLE' || data.browserFallback === false || typeof data.baseUrl !== 'string') throw new Error(data.error || '요청에 실패했습니다.');
  try { return await direct(data.baseUrl); }
  catch (error) {
    if (signal?.aborted || error instanceof ReanimeBridgeError) throw error;
    throw new Error(`서버와 브라우저에서 Reanime에 연결하지 못했습니다. ${error instanceof Error ? error.message : ''}`);
  }
}

export function searchKoreanReanime(anime: AnissiaAnime, query: string, signal?: AbortSignal) {
  return requestWithReanimeFallback(`/api/anissia/mapping?id=${anime.animeNo}&search=1&q=${encodeURIComponent(query)}`,
    async base => ({candidates: await searchReanimeCandidates(anime, base, query, signal)}), signal);
}

export async function loadKoreanReanimeDetail(id: string, signal?: AbortSignal) {
  const result = await requestWithReanimeFallback(`/api/anissia/reanime?id=${encodeURIComponent(id)}`,
    async base => ({detail: await getReanimeDetail(base, id, signal)}), signal);
  return result.detail;
}

export async function loadKoreanReanimeStream(detail: Pick<ReanimeDetail, 'id' | 'anilistId'>, episode: number, signal?: AbortSignal, language: 'sub' | 'dub' = 'sub') {
  const result = await requestWithReanimeFallback(`/api/anissia/reanime?id=${encodeURIComponent(detail.id)}&anilist=${detail.anilistId}&episode=${episode}&lang=${language}`,
    // Reanime blocks watch-page framing. The opt-in browser extension resolves
    // only player metadata on this PC; the supported video embed loads directly.
    async base => ({stream: await requestReanimeBrowserStream(base, detail.anilistId, episode, signal, language)}), signal);
  return result.stream;
}
