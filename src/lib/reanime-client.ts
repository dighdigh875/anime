// Shared by server requests and the browser retry. Keep Node/DB imports out of this file.
export const DEFAULT_REANIME_URL = "https://reanime.to";
export interface AnimeListItem {
  id: string; title: string; poster: string; detail_url: string; remarks: string; rank?: number | null;
}
export interface AnimeListResponse {
  items: AnimeListItem[]; page: number; has_next: boolean; total_pages: number;
}
export interface EpisodeItem { number: number; title: string; watch_url: string }
export interface AnimeDetail {
  id: string; title: string; poster: string; description: string; genres: string[];
  sub_episodes: EpisodeItem[]; dub_episodes: EpisodeItem[]; total_episodes: number;
  status_text: string; year: string; is_finished: boolean; anilist_id: number;
}
export interface EpisodeStreamInfo {
  success: boolean; m3u8_url: string; vtt_url: string; player_url: string;
  stream_type: "iframe" | "m3u8"; embed_url: string;
  server_sources: {label: string; player_url: string}[]; link_next: string; link_pre: string;
}
export interface FeedParams { q?: string; tab?: string; page?: number }
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Raw = Record<string, any>;

export function normalizeReanimeUrl(value: string): string {
  const text = value.trim();
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!text || url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) {
    throw new Error("Reanime의 HTTPS 도메인을 입력해주세요. 예: https://reanime.to");
  }
  // API/watch URLs pasted into settings must never become a nested API base.
  return url.origin;
}

export function reanimeSlug(id: string): string {
  if (!/^re_[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(id)) {
    throw new Error("Reanime 작품이 아닙니다. Reanime에서 작품을 다시 검색해주세요.");
  }
  return id.slice(3);
}

async function readJson(url: string, fetcher: Fetcher): Promise<Raw> {
  const response = await fetcher(url, {cache: "no-store", signal: AbortSignal.timeout(6000)});
  if (!response.ok) throw new Error(`Reanime 연결 실패 (HTTP ${response.status})`);
  try { return await response.json(); }
  catch { throw new Error("Reanime가 JSON 대신 차단 페이지 또는 잘못된 응답을 반환했습니다."); }
}

function unflatten(values: unknown[]): Raw {
  const seen = new Map<number, any>();
  function visit(index: number): any {
    if (index === -1) return undefined;
    if (index === -3) return NaN;
    if (seen.has(index)) return seen.get(index);
    const value = values[index];
    if (!value || typeof value !== "object") return value;
    const result: any = Array.isArray(value) ? [] : Object.create(null);
    seen.set(index, result);
    for (const [key, ref] of Object.entries(value)) result[key] = visit(ref as number);
    return result;
  }
  return visit(0);
}

function mapItem(raw: Raw): AnimeListItem {
  if (typeof raw?.anime_id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(raw.anime_id)) {
    throw new Error("Reanime 작품 ID를 확인할 수 없습니다.");
  }
  const id = `re_${raw.anime_id}`;
  return {
    id, title: typeof raw.title === "string" ? raw.title : raw.title?.english || raw.title?.romaji || raw.title?.native || raw.anime_id,
    poster: raw.cover_image?.large || raw.cover_image?.extra_large || "",
    detail_url: `/anime/${id}`,
    remarks: raw.episode?.episode_number ? `${raw.episode.episode_number}화 방영` : [raw.season_year, raw.format, raw.status === "Finished" ? "완결" : ""].filter(Boolean).join(" • "),
    rank: null,
  };
}

export async function fetchReanimeList(base: string, params: FeedParams = {}, fetcher: Fetcher = fetch): Promise<AnimeListResponse> {
  base = normalizeReanimeUrl(base);
  const page = Math.max(1, Math.floor(params.page || 1));
  if (params.q) {
    const data = await readJson(`${base}/api/v1/search?q=${encodeURIComponent(params.q)}&limit=20&offset=${(page - 1) * 20}`, fetcher);
    if (!Array.isArray(data.results)) throw new Error("Reanime 검색 응답 형식이 올바르지 않습니다.");
    const total = Number(data.total ?? data.estimated_total_hits);
    const hasNext = Number.isFinite(total) ? page * 20 < total : data.results.length === 20;
    return {items: data.results.map(mapItem), page, has_next: hasNext, total_pages: Number.isFinite(total) ? Math.max(1, Math.ceil(total / 20)) : page + Number(hasNext)};
  }
  const key = params.tab === "top" ? "trending" : params.tab === "list" ? "new_on_site" : "latest_aired";
  let home: Raw;
  try {
    home = await readJson(`${base}/api/v1/home`, fetcher);
    if (!Array.isArray(home?.[key])) throw new Error("Reanime 목록 응답 형식이 올바르지 않습니다.");
  } catch {
    const payload = await readJson(`${base}/home/__data.json`, fetcher);
    const node = payload?.nodes?.find((n: Raw) => Array.isArray(n?.data) && n.data[0]?.homeData !== undefined);
    home = node ? unflatten(node.data)?.homeData : null;
    if (!Array.isArray(home?.[key])) throw new Error("Reanime 목록을 확인할 수 없습니다. 브라우저에서 다시 시도해주세요.");
  }
  const rows: Raw[] = params.tab === "top" ? [...home[key]].sort((a,b) => (b.average_score || 0) - (a.average_score || 0)) : home[key];
  const unique = [...new Map(rows.map(raw => [raw.anime_id, raw])).values()];
  const totalPages = Math.max(1, Math.ceil(unique.length / 24));
  const currentPage = Math.min(page, totalPages);
  return {items: unique.slice((currentPage-1)*24, currentPage*24).map((raw,index)=>({...mapItem(raw),rank:params.tab === "top" ? (currentPage-1)*24+index+1 : null})), page: currentPage, has_next: currentPage < totalPages, total_pages: totalPages};
}

async function fetchAllEpisodes(base: string, slug: string, fetcher: Fetcher): Promise<Raw[]> {
  const episodes: Raw[] = [];
  const seen = new Set<number>();
  for (let page = 0; page < 10; page++) {
    const payload = await readJson(`${base}/api/v1/anime/${slug}/episodes?limit=2000&offset=${episodes.length}`, fetcher);
    if (!Array.isArray(payload?.data)) throw new Error("Reanime 회차 응답 형식이 올바르지 않습니다.");
    const total = Number(payload.total ?? payload.data.length);
    if (episodes.length && payload.data.every((ep: Raw)=>seen.has(ep.episode_number))) throw new Error("Reanime 추가 회차를 읽지 못했습니다.");
    episodes.push(...payload.data);
    payload.data.forEach((ep: Raw)=>seen.add(ep.episode_number));
    if (episodes.length >= total) return episodes;
    if (!payload.data.length) break;
  }
  throw new Error("Reanime 전체 회차를 읽지 못했습니다. 다시 시도해주세요.");
}

export async function fetchReanimeDetail(base: string, id: string, fetcher: Fetcher = fetch): Promise<AnimeDetail> {
  base = normalizeReanimeUrl(base);
  const slug = reanimeSlug(id);
  const [raw, allEpisodes] = await Promise.all([
    readJson(`${base}/api/v1/anime/${slug}`, fetcher),
    fetchAllEpisodes(base, slug, fetcher),
  ]);
  if (raw?.anime_id !== slug) throw new Error("Reanime 작품 응답 형식이 올바르지 않습니다.");
  const anilistId = Number(raw.anilist_id);
  const episodes: Raw[] = allEpisodes.filter((ep: Raw) => Number.isInteger(ep.episode_number) && ep.episode_number > 0 && ep.playable !== false);
  const mapEpisode = (ep: Raw, dub: boolean): EpisodeItem => ({
    number: ep.episode_number, title: ep.title || `${ep.episode_number}화`,
    watch_url: `${base}/watch/${slug}?ep=${ep.episode_number}&anilist=${anilistId}${dub ? "&dub=1" : ""}`,
  });
  const list = (dub: boolean) => [...new Map(episodes.filter(ep => dub ? ep.dubbed === true : ep.subbed !== false).map(ep => [ep.episode_number, mapEpisode(ep, dub)])).values()].sort((a,b) => a.number - b.number);
  return {...mapItem(raw), anilist_id: Number.isSafeInteger(anilistId) ? anilistId : 0,
    description: String(raw.description || "").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<[^>]*>/g,""),
    genres: Array.isArray(raw.genres) ? raw.genres.filter((g: unknown) => typeof g === "string") : [],
    sub_episodes: list(false), dub_episodes: list(true), total_episodes: Number(raw.episodes) || episodes.length,
    year: String(raw.season_year || ""), status_text: raw.status || "", is_finished: raw.status === "Finished",
  };
}

export function selectEpisode(detail: AnimeDetail, number: number, dub = false): EpisodeItem | null {
  return (dub ? detail.dub_episodes : detail.sub_episodes).find(ep => ep.number === number) || null;
}

export async function fetchReanimeStream(base: string, anilistId: number, ep: number, dub = false, fetcher: Fetcher = fetch): Promise<EpisodeStreamInfo> {
  if (!Number.isSafeInteger(anilistId) || anilistId <= 0 || !Number.isSafeInteger(ep) || ep <= 0) throw new Error("작품 또는 회차 번호가 올바르지 않습니다.");
  const data = await readJson(`${normalizeReanimeUrl(base)}/api/flix/${anilistId}/${ep}`, fetcher);
  if (data?.success === false || !Array.isArray(data?.servers)) throw new Error("Reanime 영상 정보를 가져오지 못했습니다.");
  const servers = data.servers.filter((s: Raw) => {
    if (s.dataType !== (dub ? "dub" : "sub")) return false;
    try { const url = new URL(s.dataLink); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  });
  const selected = servers.find((s: Raw) => s.serverName === "HD-1") || servers[0];
  if (!selected) throw new Error("이 회차의 선택한 언어에 재생 가능한 영상이 없습니다.");
  const hls = /\.m3u8(?:$|\?)/i.test(selected.dataLink);
  return {success: true, stream_type: hls ? "m3u8" : "iframe", embed_url: hls ? "" : selected.dataLink,
    m3u8_url: hls ? selected.dataLink : "", vtt_url: "", player_url: selected.dataLink,
    server_sources: servers.map((s: Raw) => ({label:s.serverName || "Server",player_url:s.dataLink})), link_next:"",link_pre:""};
}
