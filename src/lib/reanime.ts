import {getReanimeBaseUrl} from "./db";
import {assertSafeProxyUrl} from "./proxyGuard";
import {fetchReanimeList, fetchReanimeDetail, fetchReanimeStream, type FeedParams, type Fetcher} from "./reanime-client";
export type {AnimeDetail, AnimeListItem, AnimeListResponse, EpisodeItem, EpisodeStreamInfo} from "./reanime-client";

// Guard every server request, including redirects. Failed responses are never cached as successes.
export const reanimeServerFetch: Fetcher = async (url, init) => {
  const origin = new URL(url).origin;
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertSafeProxyUrl(current);
    const response = await fetch(current, {...init, redirect:"manual", headers:{
      "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: `${origin}/`, Accept: "application/json",
    }});
    if (![301,302,303,307,308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Reanime 리다이렉트 주소가 없습니다.");
    current = new URL(location, current).href;
  }
  throw new Error("Reanime 리다이렉트 횟수를 초과했습니다.");
};
export async function getAnimeList(params: FeedParams = {}) {
  return fetchReanimeList(await getReanimeBaseUrl(), params, reanimeServerFetch);
}
export async function getAnimeDetail(id: string) {
  return fetchReanimeDetail(await getReanimeBaseUrl(), id, reanimeServerFetch);
}
export async function getEpisodeStream(watchUrl: string) {
  const base = await getReanimeBaseUrl();
  const url = new URL(watchUrl);
  if (url.origin !== base || !url.pathname.startsWith("/watch/")) throw new Error("Reanime 회차 주소가 아닙니다.");
  return fetchReanimeStream(base, Number(url.searchParams.get("anilist")), Number(url.searchParams.get("ep")), url.searchParams.get("dub") === "1", reanimeServerFetch);
}
export async function checkReanimeHealth(base: string) {
  const start = Date.now();
  try {
    await fetchReanimeList(base, {}, reanimeServerFetch);
    return {ok:true, latencyMs: Date.now()-start, statusText:"Reanime 목록 조회 성공"};
  } catch (error) {
    return {ok:false, latencyMs: Date.now()-start, statusText:error instanceof Error ? error.message : "Reanime 연결 실패"};
  }
}
