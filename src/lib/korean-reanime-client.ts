import {getReanimeDetail, getReanimeWatchStream, searchReanimeCandidates, type ReanimeDetail} from './reanime-api';
import type {AnissiaAnime} from './anissia';

export async function requestWithReanimeFallback<T>(url: string, direct: (baseUrl: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {signal});
  const data = await response.json();
  signal?.throwIfAborted();
  if (response.ok) return data;
  // Only retry a provider failure. Login/DB/Anissia failures must stay visible.
  if (data.code !== 'REANIME_UNAVAILABLE' || typeof data.baseUrl !== 'string') throw new Error(data.error || '요청에 실패했습니다.');
  try { return await direct(data.baseUrl); }
  catch (error) {
    if (signal?.aborted) throw error;
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

export async function loadKoreanReanimeStream(detail: ReanimeDetail, episode: number, signal?: AbortSignal) {
  const result = await requestWithReanimeFallback(`/api/anissia/reanime?id=${encodeURIComponent(detail.id)}&anilist=${detail.anilistId}&episode=${episode}`,
    // The stream API lacks browser CORS headers. Restore the original watch-page
    // iframe instead; its nested player supplies the subtitle clock via postMessage.
    async base => ({stream: getReanimeWatchStream(base, detail, episode)}), signal);
  return result.stream;
}
