import {
  AnimeDetail,
  AnimeListFilterParams,
  AnimeListItem,
  AnimeListResponse,
  AnimeProvider,
  EpisodeItem,
  EpisodeStreamInfo,
  ServerSource,
} from "./types";
import { REANIME_PREFIX, stripReanimeId, toReanimeId } from "./index";
import { getReanimeBaseUrl, DEFAULT_REANIME_URL } from "@/lib/db";
import { fetchReanimeServer } from "@/lib/reanime-server-fetch";

export const BASE_URL = DEFAULT_REANIME_URL;

export const REANIME_GENRES: [string, string][] = [
  ["액션", "Action"],
  ["모험", "Adventure"],
  ["코미디", "Comedy"],
  ["드라마", "Drama"],
  ["판타지", "Fantasy"],
  ["공포", "Horror"],
  ["마법소녀", "Mahou Shoujo"],
  ["메카닉", "Mecha"],
  ["음악", "Music"],
  ["미스터리", "Mystery"],
  ["심리", "Psychological"],
  ["로맨스", "Romance"],
  ["SF", "Sci-Fi"],
  ["일상", "Slice of Life"],
  ["스포츠", "Sports"],
  ["초자연", "Supernatural"],
  ["스릴러", "Thriller"],
];

const REANIME_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://reanime.to/",
  Accept: "application/json, text/plain, */*",
};

// In-memory caches with timestamps
const detailCache: Record<string, { data: AnimeDetail; anilistId: number; timestamp: number }> = {};
const streamCache: Record<string, { data: EpisodeStreamInfo; timestamp: number }> = {};
let homeCache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const HOME_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export async function getBaseUrl(): Promise<string> {
  return await getReanimeBaseUrl();
}

/**
 * SvelteKit 1/2 devalue hydration helper
 */
function unflatten(data: unknown[]): any {
  if (!Array.isArray(data) || data.length === 0) return null;
  const cache = new Map<number, any>();
  function hydrate(val: any): any {
    if (typeof val !== "number") return val;
    if (cache.has(val)) return cache.get(val);
    const raw = data[val];
    if (raw === null || typeof raw !== "object") return raw;
    if (Array.isArray(raw)) {
      const arr: any[] = [];
      cache.set(val, arr);
      for (const item of raw) arr.push(hydrate(item));
      return arr;
    }
    const obj: Record<string, any> = {};
    cache.set(val, obj);
    for (const [k, v] of Object.entries(raw)) obj[k] = hydrate(v);
    return obj;
  }
  return hydrate(0);
}

async function fetchHomeData(): Promise<any> {
  const now = Date.now();
  if (homeCache && now - homeCache.timestamp < HOME_CACHE_TTL) {
    return homeCache.data;
  }

  const baseUrl = await getBaseUrl();
  const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };

  // 1순위: 공식 순수 JSON REST API 시도 (/api/v1/home)
  try {
    const res = await fetchReanimeServer(`${baseUrl}/api/v1/home`, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      if (data && (Array.isArray(data.trending) || Array.isArray(data.latest_aired))) {
        homeCache = { data, timestamp: now };
        return data;
      }
    }
  } catch (e) {
    console.warn("[ReAnime] /api/v1/home error, falling back to SvelteKit:", e);
  }

  // 2순위: SvelteKit __data.json 백업 엔드포인트
  try {
    const res = await fetchReanimeServer(`${baseUrl}/home/__data.json`, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch home data: ${res.status}`);
    }
    const json = await res.json();
    const homeNode = json.nodes?.find((n: any) => n?.data?.[0] && "homeData" in n.data[0]);
    if (!homeNode || !homeNode.data) {
      throw new Error("Could not find homeData node in ReAnime response");
    }
    const unflattened = unflatten(homeNode.data);
    const homeData = unflattened?.homeData || {};
    homeCache = { data: homeData, timestamp: now };
    return homeData;
  } catch (err) {
    console.error("[ReAnime] fetchHomeData error:", err);
    return homeCache?.data || {};
  }
}

function mapRawItemToAnimeListItem(item: any): AnimeListItem {
  const animeId = item.anime_id || "";
  const title =
    item.title?.english ||
    item.title?.romaji ||
    item.title?.native ||
    item.title?.user_preferred ||
    item.title ||
    animeId;

  const poster =
    item.cover_image?.large ||
    item.cover_image?.extra_large ||
    item.cover_image?.medium ||
    item.banner_image ||
    "";

  let remarks = "";
  if (item.episode?.episode_number) {
    remarks = `${item.episode.episode_number}화 방영`;
  } else if (item.format) {
    const epCount = item.episodes ? `${item.episodes}화` : "";
    const statusKo = item.status === "Finished" ? "완결" : (item.status === "Releasing" ? "방영중" : "");
    remarks = [item.season_year, item.format, epCount, statusKo].filter(Boolean).join(" • ");
  } else if (item.status) {
    remarks = item.status === "Finished" ? "완결" : item.status;
  }

  return {
    id: toReanimeId(animeId),
    title,
    poster,
    detail_url: `/anime/${toReanimeId(animeId)}`,
    remarks,
    rank: item.average_score || null,
  };
}

export async function getAnimeList(params: {
  category?: "airing" | "top" | "movie" | "finished" | "trending" | "upcoming";
  page?: number;
  genre?: string;
  period?: "day" | "week" | "month" | "all";
  sort?: string;
}): Promise<AnimeListResponse> {
  try {
    // If a genre is specified, perform a search by genre (한글 장르명 -> 영문 변환)
    if (params.genre) {
      const match = REANIME_GENRES.find(
        ([k, v]) => k === params.genre || v.toLowerCase() === params.genre?.toLowerCase()
      );
      const queryGenre = match ? match[1] : params.genre;
      return await searchAnime(queryGenre, params.page || 1);
    }

    const homeData = await fetchHomeData();
    let rawList: any[] = [];

    switch (params.category) {
      case "airing":
        rawList = homeData.latest_aired || [];
        break;
      case "upcoming":
        rawList = homeData.upcoming || [];
        break;
      case "top":
        // Sort trending or available items by average_score descending
        rawList = [...(homeData.trending || [])].sort((a, b) => (b.average_score || 0) - (a.average_score || 0));
        break;
      case "finished":
        rawList = (homeData.trending || []).filter((item: any) => item.status === "Finished");
        break;
      case "movie":
        rawList = (homeData.trending || []).filter((item: any) => item.format === "MOVIE");
        break;
      case "trending":
      default:
        rawList = homeData.trending || [];
        break;
    }

    const items = rawList.map(mapRawItemToAnimeListItem);

    return {
      items,
      page: params.page || 1,
      has_next: false,
      total_pages: 1,
    };
  } catch (error) {
    console.error("[ReAnime] getAnimeList error:", error);
    return { items: [], page: 1, has_next: false, total_pages: 1 };
  }
}

export async function getAnimeListFiltered(params: AnimeListFilterParams): Promise<AnimeListResponse> {
  return await getAnimeList({
    category: params.category,
    page: params.page,
    genre: params.genre,
    period: params.period,
    sort: params.sort,
  });
}

export async function searchAnime(keyword: string, page = 1): Promise<AnimeListResponse> {
  const trimmed = keyword?.trim();
  if (!trimmed) {
    return { items: [], page: 1, has_next: false, total_pages: 1 };
  }

  const searchTerms: string[] = [trimmed];

  // 한글 검색어인 경우 애니시아(Anissia)를 통해 원제(일본어) 및 영문 제목을 검색 목록에 보강
  if (/[가-힣]/.test(trimmed)) {
    try {
      const aniRes = await fetch(
        `https://api.anissia.net/anime/list/0?q=${encodeURIComponent(trimmed)}`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (aniRes.ok) {
        const aniData = await aniRes.json();
        const content = aniData.data?.content || [];
        const exact = content.find((it: any) => it.subject?.trim() === trimmed);
        if (exact?.originalSubject && !searchTerms.includes(exact.originalSubject)) {
          searchTerms.splice(1, 0, exact.originalSubject);
        }
        for (const item of content.slice(0, 4)) {
          if (item.originalSubject && !searchTerms.includes(item.originalSubject)) {
            searchTerms.push(item.originalSubject);
          }
        }
      }
    } catch {
      // Anissia 실패 시 기본 검색어 유지
    }
  }

  const baseUrl = await getBaseUrl();
  const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };

  // 순차 검색 시도 (결과가 발견되면 즉시 반환)
  for (const term of searchTerms) {
    try {
      const res = await fetchReanimeServer(`${baseUrl}/api/v1/search?q=${encodeURIComponent(term)}`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;

      const json = await res.json();
      const results = Array.isArray(json.results) ? json.results : [];
      if (results.length > 0) {
        const items = results.map(mapRawItemToAnimeListItem);
        return {
          items,
          page,
          has_next: false,
          total_pages: 1,
        };
      }
    } catch (err) {
      console.warn(`[ReAnime] searchAnime attempt for "${term}" error:`, err);
    }
  }

  return { items: [], page: 1, has_next: false, total_pages: 1 };
}

export async function getAnimeDetail(animeId: string): Promise<AnimeDetail | null> {
  const normalizedId = toReanimeId(animeId);
  const now = Date.now();

  if (detailCache[normalizedId] && now - detailCache[normalizedId].timestamp < CACHE_TTL) {
    return detailCache[normalizedId].data;
  }

  const slug = stripReanimeId(animeId);
  if (!slug) return null;

  const baseUrl = await getBaseUrl();
  const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };

  // 1순위: 공식 순수 JSON REST API 시도 (/api/v1/anime/:slug & /episodes)
  try {
    const [rDetail, rEps] = await Promise.all([
      fetchReanimeServer(`${baseUrl}/api/v1/anime/${slug}`, {
        headers,
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      }),
      fetchReanimeServer(`${baseUrl}/api/v1/anime/${slug}/episodes`, {
        headers,
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      }),
    ]);

    if (rDetail.ok) {
      const rawAnime = await rDetail.json();
      const epsJson = rEps.ok ? await rEps.json() : {};
      const rawEpisodes: any[] = Array.isArray(epsJson.data) ? epsJson.data : [];

      const anilistId = Number(rawAnime.anilist_id || 0);

      const title =
        rawAnime.title?.english ||
        rawAnime.title?.romaji ||
        rawAnime.title?.native ||
        rawAnime.title?.user_preferred ||
        slug;

      const poster =
        rawAnime.cover_image?.extra_large ||
        rawAnime.cover_image?.large ||
        rawAnime.cover_image?.medium ||
        rawAnime.banner_image ||
        "";

      const subEpisodes: EpisodeItem[] = rawEpisodes.map((ep: any) => {
        const epNum = Number(ep.episode_number ?? ep.number ?? 1);
        return {
          number: epNum,
          title: ep.title ? `${epNum}화 - ${ep.title}` : `${epNum}화`,
          watch_url: `${baseUrl}/watch/${slug}?ep=${epNum}&anilist=${anilistId}`,
        };
      });

      const isFinished = rawAnime.status === "Finished";
      const statusText = isFinished ? "완결" : (rawAnime.status === "Releasing" ? "방영중" : (rawAnime.status || ""));

      const detail: AnimeDetail = {
        id: normalizedId,
        title,
        poster,
        description: rawAnime.description ? rawAnime.description.replace(/<br\s*[\/]?>/gi, "\n") : "",
        genres: Array.isArray(rawAnime.genres) ? rawAnime.genres : [],
        sub_episodes: subEpisodes,
        dub_episodes: [],
        total_episodes: Number(rawAnime.episodes_total || rawEpisodes.length || 0),
        status_text: statusText,
        year: String(rawAnime.season_year || ""),
        is_finished: isFinished,
      };

      detailCache[normalizedId] = { data: detail, anilistId, timestamp: now };
      return detail;
    }
  } catch (err) {
    console.warn(`[ReAnime] REST detail failed for "${slug}", trying SvelteKit fallback:`, err);
  }

  // 2순위: SvelteKit __data.json 백업 엔드포인트
  try {
    const res = await fetchReanimeServer(`${baseUrl}/watch/${slug}/__data.json?ep=1`, {
      headers,
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Failed to load anime detail: ${res.status}`);
    }

    const json = await res.json();
    const watchNode = json.nodes?.find(
      (n: any) => n?.data?.[0] && ("anime" in n.data[0] || "episodes" in n.data[0])
    );

    if (!watchNode || !watchNode.data) {
      throw new Error("Could not find anime data node in watch response");
    }

    const unflattened = unflatten(watchNode.data);
    const rawAnime = unflattened?.anime || {};
    const rawEpisodes: any[] = Array.isArray(unflattened?.episodes) ? unflattened.episodes : [];

    const anilistId = Number(rawAnime.anilist_id || 0);

    const title =
      rawAnime.title?.english ||
      rawAnime.title?.romaji ||
      rawAnime.title?.native ||
      rawAnime.title?.user_preferred ||
      slug;

    const poster =
      rawAnime.cover_image?.extra_large ||
      rawAnime.cover_image?.large ||
      rawAnime.cover_image?.medium ||
      rawAnime.banner_image ||
      "";

    const subEpisodes: EpisodeItem[] = rawEpisodes.map((ep: any) => {
      const epNum = Number(ep.number ?? ep.episode_number ?? 1);
      return {
        number: epNum,
        title: ep.title ? `${epNum}화 - ${ep.title}` : `${epNum}화`,
        watch_url: `${baseUrl}/watch/${slug}?ep=${epNum}&anilist=${anilistId}`,
      };
    });

    const isFinished = rawAnime.status === "Finished";
    const statusText = isFinished ? "완결" : (rawAnime.status === "Releasing" ? "방영중" : (rawAnime.status || ""));

    const detail: AnimeDetail = {
      id: normalizedId,
      title,
      poster,
      description: rawAnime.description ? rawAnime.description.replace(/<br\s*[\/]?>/gi, "\n") : "",
      genres: Array.isArray(rawAnime.genres) ? rawAnime.genres : [],
      sub_episodes: subEpisodes,
      dub_episodes: [],
      total_episodes: Number(rawAnime.episodes_total || rawEpisodes.length || 0),
      status_text: statusText,
      year: String(rawAnime.season_year || ""),
      is_finished: isFinished,
    };

    detailCache[normalizedId] = { data: detail, anilistId, timestamp: now };
    return detail;
  } catch (error) {
    console.error("[ReAnime] getAnimeDetail error:", error);
    return null;
  }
}

export async function getEpisodeStream(watchUrl: string): Promise<EpisodeStreamInfo | null> {
  const now = Date.now();
  if (streamCache[watchUrl] && now - streamCache[watchUrl].timestamp < CACHE_TTL) {
    return streamCache[watchUrl].data;
  }

  try {
    const baseUrl = await getBaseUrl();
    const url = new URL(watchUrl, baseUrl);
    const ep = url.searchParams.get("ep") || "1";
    let anilistIdStr = url.searchParams.get("anilist");

    if (!anilistIdStr) {
      // Fallback: extract slug and lookup detail
      const slug = url.pathname.replace(/^\/watch\/?/, "").split("/")[0];
      const detail = await getAnimeDetail(slug);
      const cached = detailCache[toReanimeId(slug)];
      if (cached?.anilistId) {
        anilistIdStr = String(cached.anilistId);
      }
    }

    if (!anilistIdStr) {
      throw new Error(`Unable to determine anilistId for watchUrl: ${watchUrl}`);
    }

    const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };
    const res = await fetchReanimeServer(`${baseUrl}/api/flix/${anilistIdStr}/${ep}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`Flix API returned ${res.status}`);
    }

    const json = await res.json();
    const servers: any[] = Array.isArray(json.servers) ? json.servers : [];

    // Find preferred server: prefer HD-1 sub, or first available with dataLink
    const preferredServer =
      servers.find((s) => s.serverName === "HD-1" && s.dataType === "sub") ||
      servers.find((s) => s.dataType === "sub") ||
      servers[0];

    const embedUrl = preferredServer?.dataLink || "";

    if (!embedUrl) {
      throw new Error("No valid embed URL found from Flix servers");
    }

    const serverSources: ServerSource[] = servers.map((s) => ({
      label: `${s.serverName || "HD"} (${s.dataType || "sub"})`,
      player_url: s.dataLink,
    }));

    const result: EpisodeStreamInfo = {
      success: true,
      m3u8_url: embedUrl,
      embed_url: embedUrl,
      player_url: embedUrl,
      vtt_url: "",
      stream_type: "iframe",
      server_sources: serverSources,
      link_next: "",
      link_pre: "",
    };

    streamCache[watchUrl] = { data: result, timestamp: now };
    return result;
  } catch (error) {
    console.error("[ReAnime] getEpisodeStream error:", error);
    return null;
  }
}

export const reanimeProvider: AnimeProvider = {
  name: "reanime",
  displayName: "ReAnime (1080p)",
  getBaseUrl,
  getAnimeListFiltered,
  getAnimeList,
  searchAnime,
  getAnimeDetail,
  getEpisodeStream,
};
