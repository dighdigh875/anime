import { convertToVtt } from './subtitle-format';
export { convertToVtt } from './subtitle-format';
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import AdmZip from "adm-zip";
import { validateKoreanSubtitle, type SubtitleSearchResult } from './korean-playback';
import { AsyncLocalStorage } from 'node:async_hooks';
import { assertSafeProxyUrl } from './proxyGuard';

const subtitleRequestContext = new AsyncLocalStorage<AbortSignal>();

async function subtitleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const deadline = subtitleRequestContext.getStore();
  const signals = [init.signal, deadline].filter((s): s is AbortSignal => Boolean(s));
  const signal = signals.length ? AbortSignal.any(signals) : AbortSignal.timeout(5000);
  let target = url;
  for (let redirects = 0; redirects < 5; redirects++) {
    signal.throwIfAborted();
    await assertSafeProxyUrl(target);
    const response = await fetch(target, {...init, signal, redirect: 'manual'});
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Missing redirect location');
    target = new URL(location, target).href;
  }
  throw new Error('Too many subtitle redirects');
}

export const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

export interface SubtitleResult {
  name: string;
  episode: number;
  orig_filename: string;
  format: "ASS" | "VTT";
  is_ass: boolean;
  content: string; // VTT text or raw ASS string
  url?: string;
}

export interface CreatorInfo {
  name: string;
  episode: string;
  update_date: string;
  website: string;
  is_current_ep: boolean;
}

// 1. Title cleaner
export function cleanTitle(text: string): string {
  if (!text) return "";
  let t = text.replace(/\[.*?\]|\(.*?\)|【.*?】|<.*?>/g, " ");
  t = t.replace(/\bBD\b/gi, " ");
  t = t.replace(/\s+\d+화(?:\s|$)/g, " ");
  t = t.replace(/[^\w\s가-힣a-zA-Z0-9~-]/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// 2. Safe filename
export function safeFilename(text: string): string {
  return text.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").replace(/^_+|_+$/g, "");
}

// 3. Season parser (로마 숫자 I~VI, 유니코드 Ⅰ~Ⅵ, Part/파트, 기수 등 완벽 지원)
export function parseSeason(text: string): number | null {
  if (!text) return null;

  // 1) 유니코드 로마 숫자 (Ⅰ~Ⅹ)
  if (/Ⅹ/i.test(text)) return 10;
  if (/Ⅸ/i.test(text)) return 9;
  if (/Ⅷ/i.test(text)) return 8;
  if (/Ⅶ/i.test(text)) return 7;
  if (/Ⅵ/i.test(text)) return 6;
  if (/Ⅴ/i.test(text)) return 5;
  if (/Ⅳ/i.test(text)) return 4;
  if (/Ⅲ/i.test(text)) return 3;
  if (/Ⅱ/i.test(text)) return 2;
  if (/Ⅰ/i.test(text)) return 1;

  // 2) 단어 단위 아스키 로마 숫자 (VI, IV, III, II)
  if (/\bVI\b/i.test(text)) return 6;
  if (/\bV\b/i.test(text)) return 5;
  if (/\bIV\b/i.test(text)) return 4;
  if (/\bIII\b/i.test(text)) return 3;
  if (/\bII\b/i.test(text)) return 2;

  // 3) 파트 / Part / 시즌 / 기
  const m = text.match(/(\d+)\s*기|\b(\d+)(?:st|nd|rd|th)\b|season\s*(\d+)|\bs(\d+)\b|파트\s*(\d+)|part\s*(\d+)/i);
  if (m) {
    for (let i = 1; i <= 6; i++) {
      if (m[i]) return parseInt(m[i], 10);
    }
  }

  // 4) 한글/영문 바로 뒤 숫자 (예: 신의탑2)
  const m2 = text.match(/(?<=[가-힣a-zA-Z])([2-9])(?=\s|$|[^\w가-힣])/);
  if (m2) {
    return parseInt(m2[1], 10);
  }
  return null;
}

// 4. Episode numbers parser
export function parseEpisodes(text: string): number[] {
  if (!text) return [];
  let base = text.split(/[\\/]/).pop() || text;
  try {base = decodeURIComponent(base);} catch {}
  base = base.replace(/\d+\s*기|season\s*\d+|\b\d+(?:st|nd|rd|th)\b/gi, ' ');
  const episodes = new Set<number>();
  // Prefer explicit episode markers; a season number is never an episode.
  for (const m of base.matchAll(/(?:^|[^\d.])(\d{1,4}(?:\.\d)?)\s*(?:화|편)/g)) episodes.add(Number(m[1]));
  for (const m of base.matchAll(/(?:\bs\d+)?(?:episode|ep|\be|(?<=\d)e|#)\s*0*(\d{1,4}(?:\.\d)?)(?!\d)/gi)) episodes.add(Number(m[1]));
  base = base.replace(/\bs\d+\b/gi, ' ');
  for (const m of base.matchAll(/(?:^|[^\d])(\d{1,4})\s*(?:~|-|_|\.\.|to)\s*(\d{1,4})(?!\d)/gi)) {
    const start = Number(m[1]), end = Number(m[2]);
    if (start >= 0 && end > start && end - start <= 2000 && end < 10000) {
      for (let i=start;i<=end;i++) episodes.add(i);
    }
  }
  if (episodes.size) return [...episodes].sort((a,b) => a-b);
  for (const m of base.matchAll(/(?<![\p{L}\p{N}])(\d{1,4}(?:\.\d)?)(?![\p{L}\p{N}])/gu)) {
    const n = Number(m[1]);
    if (![360,480,720,1080,2160].includes(n) && !(n >= 1900 && n <= 2100)) episodes.add(n);
  }
  return [...episodes].sort((a,b) => a-b);
}

// 5. Decode text buffer with encoding fallback (UTF-8, UTF-16, CP949, EUC-KR)
export function decodeSubtitleBuffer(buf: Buffer): string {
  // UTF-16 BOM or null-byte pattern
  if (
    (buf[0] === 0xff && buf[1] === 0xfe) ||
    (buf[0] === 0xfe && buf[1] === 0xff) ||
    buf.subarray(0, 50).includes(0x00)
  ) {
    try {
      const s = iconv.decode(buf, "utf-16");
      if (s.toLowerCase().includes("<sync") || s.toLowerCase().includes("<sami") || s.includes("-->")) {
        return s;
      }
    } catch {}
  }

  for (const enc of ["utf-8", "cp949", "euc-kr", "utf-16"]) {
    try {
      const s = enc === 'utf-8' ? new TextDecoder('utf-8', {fatal: true}).decode(buf) : iconv.decode(buf, enc);
      if (
        s.toLowerCase().includes("<sync") ||
        s.toLowerCase().includes("<sami") ||
        s.includes("-->") ||
        s.toLowerCase().includes("[script info]")
      ) {
        return s;
      }
    } catch {}
  }

  // Fallback UTF-8
  return buf.toString("utf-8");
}

// 7. In-memory ZIP extractor & subtitle reader
export function extractSubtitleFromBuffer(
  buffer: Buffer,
  episodeNumber: number,
  urlPath: string
): { filename: string; orig_filename: string; content: string; format: "ASS" | "VTT"; is_ass: boolean } | null {
  const isZip =
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    urlPath.toLowerCase().endsWith(".zip");

  if (isZip) {
    try {
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();
      const subEntries = zipEntries.filter((entry) => {
        const name = entry.entryName.toLowerCase();
        return (
          !name.startsWith("__macosx") &&
          (name.endsWith(".ass") ||
            name.endsWith(".ssa") ||
            name.endsWith(".smi") ||
            name.endsWith(".srt") ||
            name.endsWith(".vtt"))
        );
      });

      if (subEntries.length === 0) return null;

      const extPriority: Record<string, number> = {
        ".ass": 1,
        ".ssa": 2,
        ".smi": 3,
        ".srt": 4,
        ".vtt": 5,
      };

      let matchedEntry: AdmZip.IZipEntry | null = null;
      let matchedDecName = "";

      const candidates: Array<{ priority: number; entry: AdmZip.IZipEntry; decName: string }> = [];

      for (const entry of subEntries) {
        let decName = entry.entryName;
        try {
          // CP949 decode attempt for Korean filenames inside zip
          decName = iconv.decode(entry.rawEntryName, "cp949");
        } catch {}

        for (const nameToCheck of [decName, entry.entryName]) {
          const epNums = parseEpisodes(nameToCheck);
          if (epNums.includes(episodeNumber)) {
            const ext = "." + (entry.name.split(".").pop() || "").toLowerCase();
            candidates.push({
              priority: extPriority[ext] || 99,
              entry,
              decName,
            });
            break;
          }
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.priority - b.priority);
        matchedEntry = candidates[0].entry;
        matchedDecName = candidates[0].decName;
      } else if (subEntries.length === 1 && parseEpisodes(subEntries[0].entryName).length === 0) {
        matchedEntry = subEntries[0];
        matchedDecName = matchedEntry.name;
      }

      if (matchedEntry) {
        if (matchedEntry.header.size > 4_000_000) return null;
        const rawBuf = matchedEntry.getData();
        const rawText = decodeSubtitleBuffer(rawBuf);
        const origExt = "." + (matchedEntry.name.split(".").pop() || "").toLowerCase();
        const { content, ext } = convertToVtt(rawText, origExt);
        const isAss = ext === ".ass" || ext === ".ssa";

        return {
          filename: `sub${ext}`,
          orig_filename: matchedDecName || matchedEntry.name,
          content,
          format: isAss ? "ASS" : "VTT",
          is_ass: isAss,
        };
      }
    } catch (e) {
      console.error("[Zip Extractor error]:", e);
    }
  } else {
    let attachmentName = '';
    try {attachmentName = decodeURIComponent(new URL(urlPath).pathname.split('/').pop() || '');} catch {}
    if (/\.(?:ass|ssa|srt|smi|vtt)$/i.test(attachmentName)) {
      const namedEpisodes = parseEpisodes(attachmentName);
      if (namedEpisodes.length && !namedEpisodes.includes(episodeNumber)) return null;
    }
    const rawText = decodeSubtitleBuffer(buffer);
    const textLower = rawText.slice(0, 500).toLowerCase();

    // Reject HTML content completely (e.g. Google Drive web viewer/login pages)
    if (
      textLower.includes("<!doctype html") ||
      textLower.includes("<html") ||
      textLower.includes("<head>")
    ) {
      return null;
    }

    const isAss = textLower.includes("[script info]") || textLower.includes("dialogue:");
    const isSmi = textLower.includes("<sami") || textLower.includes("<sync");
    const isSrt = /^\s*\d+\s*[\r\n]+\d{2}:\d{2}/.test(rawText.slice(0, 100)) || rawText.includes("-->");

    if (isAss || isSmi || isSrt) {
      const origExt = isAss ? ".ass" : isSmi ? ".smi" : /^\uFEFF?WEBVTT\b/.test(rawText) ? ".vtt" : ".srt";
      const { content, ext } = convertToVtt(rawText, origExt);
      const isAssResult = ext === ".ass" || ext === ".ssa";
      let displayFn = urlPath.split("/").pop() || `subtitle${origExt}`;
      if (displayFn.includes("?") || displayFn.length > 60) {
        displayFn = `subtitle${origExt}`;
      }

      return {
        filename: `sub${ext}`,
        orig_filename: displayFn,
        content,
        format: isAssResult ? "ASS" : "VTT",
        is_ass: isAssResult,
      };
    }
  }

  return null;
}

// 8. Convert Google Drive and cloud links to direct download URLs
export function convertToDirectDownloadUrl(url: string): string {
  if (!url) return url;
  const driveMatch = url.match(
    /(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/
  );
  if (driveMatch && driveMatch[1]) {
    return `https://drive.usercontent.google.com/download?id=${driveMatch[1]}&export=download`;
  }
  return url;
}

// 9. Download file helper with timeout & Google Drive support
export async function downloadFileWithTimeout(
  url: string,
  referer?: string,
  timeoutMs = 4500
): Promise<Buffer | null> {
  try {
    const headers: Record<string, string> = { ...HEADERS };
    if (referer) headers["Referer"] = referer;

    const directUrl = convertToDirectDownloadUrl(url);

    let res = await subtitleFetch(directUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Fallback for Google Drive
    if (!res.ok && directUrl.includes("drive.usercontent.google.com")) {
      const driveMatch = url.match(
        /(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/
      );
      if (driveMatch && driveMatch[1]) {
        res = await subtitleFetch(
          `https://docs.google.com/uc?export=download&id=${driveMatch[1]}&confirm=t`,
          {
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          }
        );
      }
    }

    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    // Reject HTML responses
    if (buf.length > 0) {
      const sample = buf.subarray(0, 300).toString("utf-8").toLowerCase();
      if (sample.includes("<!doctype html") || sample.includes("<html")) {
        return null;
      }
    }

    return buf;
  } catch {
    return null;
  }
}

// 9. Kairan blog subtitle searcher
export async function findKairanSubtitle(
  title: string,
  episodeNumber: number,
  timeoutMs = 3500
): Promise<SubtitleResult | null> {
  try {
    const targetSeason = parseSeason(title);
    const targetEp = episodeNumber;

    let cleanBase = title.replace(/[\(\[\{<~].*?[\]\)\}>~]/g, "").trim();
    cleanBase = cleanBase.replace(/\s+\d+기$/g, "").trim();
    cleanBase = cleanBase.replace(/\b\d+(?:st|nd|rd|th)\b/gi, "").trim();
    cleanBase = cleanBase.replace(/season\s*\d+/gi, "").trim();
    cleanBase = cleanTitle(cleanBase);

    const words = cleanBase
      .split(/\s+/)
      .filter((w) => !["시즌", "더빙", "자막", "극장판", "애니"].includes(w));
    const searchTerm = words.length >= 2 ? words.slice(0, 2).join(" ") : words[0] || cleanBase;
    if (!searchTerm) return null;

    const queries: string[] = [];
    if (targetSeason) {
      queries.push(`${searchTerm} ${targetSeason}th ${targetEp}`);
      queries.push(`${searchTerm} ${targetSeason}기 ${targetEp}`);
      queries.push(`${searchTerm} ${targetSeason}th`);
      queries.push(`${searchTerm} ${targetSeason}기`);
    }
    queries.push(`${searchTerm} ${targetEp}화`);
    queries.push(`${searchTerm} ${targetEp}`);
    queries.push(`${searchTerm}`);

    for (const q of queries) {
      const searchUrl = `https://kairan03.blogspot.com/search?q=${encodeURIComponent(q)}`;
      const res = await subtitleFetch(searchUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      let matchedPostUrl = "";
      $(".post, .date-outer, .entry").each((_, p) => {
        if (matchedPostUrl) return;
        const titleEl = $(p).find(".post-title a, h3 a, .entry-title a").first();
        if (!titleEl.length) return;

        const postTitle = titleEl.text().trim();
        const postUrl = titleEl.attr("href")?.trim() || "";
        if (!postUrl || postUrl.includes("report-abuse")) return;
        if (!postTitle.includes(words[0])) return;

        const postSeason = parseSeason(postTitle);
        const postEps = parseEpisodes(postTitle);

        if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
          return;
        }

        if (postEps.includes(targetEp)) {
          matchedPostUrl = postUrl;
        }
      });

      if (matchedPostUrl) {
        // Download post page to find attachment link
        const postRes = await subtitleFetch(matchedPostUrl, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!postRes.ok) continue;

        const postHtml = await postRes.text();
        const $p = cheerio.load(postHtml);

        let subDownloadUrl = "";
        $p("a[href]").each((_, a) => {
          if (subDownloadUrl) return;
          const href = $p(a).attr("href")?.trim() || "";
          const text = $p(a).text().trim().toLowerCase();
          if (
            href.includes("drive.google.com") ||
            href.includes("docs.google.com") ||
            href.endsWith(".zip") ||
            href.endsWith(".ass") ||
            href.endsWith(".smi") ||
            href.endsWith(".srt") ||
            text.includes("자막") ||
            text.includes("다운로드")
          ) {
            subDownloadUrl = href;
          }
        });

        // Fallback: search postHtml for Google Drive link
        if (!subDownloadUrl) {
          const driveMatch = postHtml.match(
            /https?:\/\/(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/
          );
          if (driveMatch) {
            subDownloadUrl = driveMatch[0];
          }
        }

        if (subDownloadUrl) {
          const buf = await downloadFileWithTimeout(subDownloadUrl, matchedPostUrl, timeoutMs + 1500);
          if (buf && buf.length > 100) {
            const extracted = extractSubtitleFromBuffer(buf, targetEp, subDownloadUrl);
            if (extracted) {
              return {
                name: "카이란",
                episode: targetEp,
                orig_filename:
                  extracted.orig_filename.startsWith("view?") || extracted.orig_filename.startsWith("subtitle")
                    ? `${cleanBase} ${targetEp}화.${extracted.format.toLowerCase()}`
                    : extracted.orig_filename,
                format: extracted.format,
                is_ass: extracted.is_ass,
                content: extracted.content,
              };
            }
          }
        }
      }
    }
  } catch (e) {
    if (!subtitleRequestContext.getStore()?.aborted) console.error("[Kairan Subtitle] error:", e);
  }
  return null;
}

// 10. Creator blog search (Tistory, Naver Blog, Blogspot)
export async function searchBlogForEpisode(
  domain: string,
  website: string,
  animeTitle: string,
  episodeNumber: number,
  timeoutMs = 5000
): Promise<string | null> {
  const targetSeason = parseSeason(animeTitle);
  const targetEp = episodeNumber;

  let cleanBase = animeTitle.replace(/[\(\[\{<~].*?[\]\)\}>~]/g, "").trim();
  cleanBase = cleanBase.replace(/\s+\d+기$/g, "").trim();
  cleanBase = cleanBase.replace(/\b\d+(?:st|nd|rd|th)\b/gi, "").trim();
  cleanBase = cleanBase.replace(/season\s*\d+/gi, "").trim();
  cleanBase = cleanTitle(cleanBase);

  const words = cleanBase
    .split(/\s+/)
    .filter((w) => !["시즌", "더빙", "자막", "극장판", "애니"].includes(w));
  const searchTerm = words.length >= 2 ? words.slice(0, 2).join(" ") : words[0] || cleanBase;

  const queries = [
    `${searchTerm} ${targetEp}화`,
    `${searchTerm} ${String(targetEp).padStart(2, "0")}`,
    `${searchTerm}`,
  ];

  try {
    // 1. Google Blogger (blogspot.com)
    if (domain.includes("blogspot.com")) {
      for (const q of queries) {
        const searchUrl = `https://${domain}/search?q=${encodeURIComponent(q)}`;
        const res = await subtitleFetch(searchUrl, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;

        const html = await res.text();
        const $ = cheerio.load(html);

        let foundUrl = "";
        $(".post-title a, h3 a, .entry-title a").each((_, a) => {
          if (foundUrl) return;
          const title = $(a).text().trim();
          const href = $(a).attr("href")?.trim() || "";
          if (!href || href.includes("report-abuse")) return;

          const postSeason = parseSeason(title);
          const postEps = parseEpisodes(title);

          if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
            return;
          }

          if (postEps.includes(targetEp)) {
            foundUrl = href;
          }
        });

        if (foundUrl) return foundUrl;
      }
    }
    // 2. Tistory
    else if (domain.includes("tistory.com")) {
      for (const q of queries) {
        const searchUrl = `https://${domain}/search/${encodeURIComponent(q)}`;
        const res = await subtitleFetch(searchUrl, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;

        const html = await res.text();
        const $ = cheerio.load(html);

        let foundUrl = "";
        $(".link_article, .post-item a, .title a, a[href*='/entry/']").each((_, a) => {
          if (foundUrl) return;
          const title = $(a).text().trim();
          const href = $(a).attr("href")?.trim() || "";
          if (!href) return;

          const postSeason = parseSeason(title);
          const postEps = parseEpisodes(title);

          if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
            return;
          }

          if (postEps.includes(targetEp)) {
            foundUrl = new URL(href, website).toString();
          }
        });

        if (foundUrl) return foundUrl;
      }
    }
    // 3. Naver Blog
    else if (domain.includes("blog.naver.com")) {
      const m = website.match(/blog\.naver\.com\/([^/?#]+)/);
      if (m) {
        const blogId = m[1];
        for (const q of queries.slice(0, 2)) {
          const searchUrl = `https://blog.naver.com/PostSearchList.naver?blogId=${blogId}&searchText=${encodeURIComponent(q)}`;
          const res = await subtitleFetch(searchUrl, {
            headers: HEADERS,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) continue;

          const html = await res.text();
          const $ = cheerio.load(html);

          let foundUrl = "";
          $("a.link, .title a, a[href*='logNo=']").each((_, a) => {
            if (foundUrl) return;
            const href = $(a).attr("href")?.trim() || "";
            const title = $(a).text().trim();
            if (!href) return;

            const postSeason = parseSeason(title);
            const postEps = parseEpisodes(title);

            if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
              return;
            }

            if (postEps.includes(targetEp)) {
              foundUrl = href;
            }
          });

          if (foundUrl) return foundUrl;
        }
      }
    }
  } catch (e) {
    console.warn("[searchBlogForEpisode error]:", e);
  }
  return null;
}

// 11. Fetch creator subtitle from their blog post (jcore와 100% 동일한 강력한 추출 엔진)
export async function fetchCreatorSubtitle(
  creatorName: string,
  website: string,
  animeTitle: string,
  episodeNumber: number,
  timeoutMs = 5000
): Promise<SubtitleResult | null> {
  if (!website) return null;
  try {
    const domain = new URL(website).hostname.toLowerCase();
    const targetSeason = parseSeason(animeTitle);

    // 단일 페이지에서 자막 파일(첨부파일/구글드라이브/다운로드링크) 추출 헬퍼 함수
    const tryExtractFromPage = async (targetUrl: string): Promise<SubtitleResult | null> => {
      try {
        let postUrl = targetUrl;
        const reqHeaders: Record<string, string> = { ...HEADERS };

        // 네이버 블로그: 프레임셋 우회용 PostView.naver URL로 자동 변환
        if (domain.includes("blog.naver.com")) {
          const m = targetUrl.match(/blog\.naver\.com\/([^/?&]+)\/(\d+)/) ||
                    targetUrl.match(/blog\.naver\.com\/([^/?&]+).*?[?&]logNo=(\d+)/);
          if (m) {
            postUrl = `https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}`;
          }
          reqHeaders["Referer"] = "https://blog.naver.com/";
        }

        const res = await subtitleFetch(postUrl, {
          headers: reqHeaders,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;

        const html = await res.text();
        const $ = cheerio.load(html);

        // 1) 티스토리 첨부파일 (tfile, attachment, kakaocdn.net)
        if (domain.includes("tistory.com")) {
          const links: string[] = [];
          $('a[href*="tfile"], a[href*="attachment"], a[href*="kakaocdn.net"]').each((_, a) => {
            const href = $(a).attr("href")?.trim();
            if (href) links.push(new URL(href, postUrl).toString());
          });

          for (const dlUrl of links) {
            const buf = await downloadFileWithTimeout(dlUrl, postUrl, timeoutMs + 1000);
            if (buf && buf.length > 50) {
              const extracted = extractSubtitleFromBuffer(buf, episodeNumber, dlUrl);
              if (extracted) {
                return {
                  name: creatorName,
                  episode: episodeNumber,
                  orig_filename: extracted.orig_filename,
                  format: extracted.format,
                  is_ass: extracted.is_ass,
                  content: extracted.content,
                };
              }
            }
          }
        }

        // 2) 네이버 블로그 첨부파일 (download.blog.naver.com, blogfiles.naver.net, attach)
        else if (domain.includes("blog.naver.com")) {
          const links: string[] = [];
          $('a[href*="download.blog.naver.com"], a[href*="blogfiles.naver.net"], a[href*="attach"]').each((_, a) => {
            const href = $(a).attr("href")?.trim();
            if (href) links.push(href);
          });

          for (const dlUrl of links) {
            const buf = await downloadFileWithTimeout(dlUrl, "https://blog.naver.com/", timeoutMs + 1000);
            if (buf && buf.length > 50) {
              const extracted = extractSubtitleFromBuffer(buf, episodeNumber, dlUrl);
              if (extracted) {
                return {
                  name: creatorName,
                  episode: episodeNumber,
                  orig_filename: extracted.orig_filename,
                  format: extracted.format,
                  is_ass: extracted.is_ass,
                  content: extracted.content,
                };
              }
            }
          }
        }

        // 3) 구글 블로거 / 구글 드라이브 첨부 링크
        const gdriveMatches = html.match(
          /https?:\/\/(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/g
        );
        if (gdriveMatches && gdriveMatches.length > 0) {
          for (const gUrl of gdriveMatches) {
            const buf = await downloadFileWithTimeout(gUrl, postUrl, timeoutMs + 1500);
            if (buf && buf.length > 50) {
              const extracted = extractSubtitleFromBuffer(buf, episodeNumber, gUrl);
              if (extracted) {
                return {
                  name: creatorName,
                  episode: episodeNumber,
                  orig_filename: extracted.orig_filename,
                  format: extracted.format,
                  is_ass: extracted.is_ass,
                  content: extracted.content,
                };
              }
            }
          }
        }

        // 4) 일반 링크 (.zip, .smi, .srt, .ass, .vtt)
        const fileLinks: string[] = [];
        $("a[href]").each((_, a) => {
          const href = $(a).attr("href")?.trim() || "";
          const text = $(a).text().trim().toLowerCase();
          if (
            href.endsWith(".zip") ||
            href.endsWith(".smi") ||
            href.endsWith(".srt") ||
            href.endsWith(".ass") ||
            href.endsWith(".ssa") ||
            href.endsWith(".vtt") ||
            text.includes(".zip") ||
            text.includes(".smi") ||
            text.includes(".ass") ||
            text.includes(".srt") ||
            text.includes("자막 다운")
          ) {
            try {
              fileLinks.push(new URL(href, postUrl).toString());
            } catch {}
          }
        });

        for (const fUrl of fileLinks) {
          const buf = await downloadFileWithTimeout(fUrl, postUrl, timeoutMs + 1000);
          if (buf && buf.length > 50) {
            const extracted = extractSubtitleFromBuffer(buf, episodeNumber, fUrl);
            if (extracted) {
              return {
                name: creatorName,
                episode: episodeNumber,
                orig_filename: extracted.orig_filename,
                format: extracted.format,
                is_ass: extracted.is_ass,
                content: extracted.content,
              };
            }
          }
        }
      } catch (err) {
        console.warn(`[tryExtractFromPage error] ${targetUrl}:`, err);
      }
      return null;
    };

    // 🌟 1단계: 초기 등록 링크(website) 자체가 해당 회차 글인지 먼저 확인 (jcore 방식)
    let isInitialUrlCurrentEp = false;
    try {
      const initRes = await subtitleFetch(website, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4000),
      });
      if (initRes.ok) {
        const initHtml = await initRes.text();
        const $init = cheerio.load(initHtml);
        const pageTitle = $init("title").text().trim() || "";
        const pSeason = parseSeason(`${pageTitle} ${website}`);
        const pEps = parseEpisodes(pageTitle);

        const seasonOk = (targetSeason === null || pSeason === null || targetSeason === pSeason);
        if (seasonOk && pEps.includes(episodeNumber)) {
          isInitialUrlCurrentEp = true;
        }
      }
    } catch {}

    if (isInitialUrlCurrentEp) {
      const initExtracted = await tryExtractFromPage(website);
      if (initExtracted) return initExtracted;
    }

    // 🌟 2단계: 초기 URL이 해당 회차가 아니거나 추출 실패 시, 블로그 전체에서 현재 회차 포스트 자동 탐색
    const matchedPostUrl = await searchBlogForEpisode(domain, website, animeTitle, episodeNumber, timeoutMs);
    if (matchedPostUrl) {
      const searchExtracted = await tryExtractFromPage(matchedPostUrl);
      if (searchExtracted) return searchExtracted;
    }
  } catch (e) {
    if (!subtitleRequestContext.getStore()?.aborted) console.error(`[fetchCreatorSubtitle error] ${creatorName}:`, e);
  }
  return null;
}

// 12-1. Generate smart search queries for Anissia (다단계 스마트 검색어 생성)
export function generateAnissiaSearchQueries(rawTitle: string): string[] {
  const queries = new Set<string>();
  if (!rawTitle) return [];

  let t = rawTitle;
  // 1) 괄호류 태그 제거 ([BD], (더빙) 등)
  t = t.replace(/\[.*?\]|\(.*?\)|【.*?】|<.*?>/g, " ");
  // 2) 끝에 붙은 "1130화", "1화" 등 회차 제거
  t = t.replace(/\s+\d+화(?:\s|$)/g, " ");
  // 3) BD, Rip, 더빙, 자막 제거
  t = t.replace(/\b(BD|Rip|더빙|자막)\b/gi, " ");

  // 한글 부분 추출 (영문 부제 분리: 예 "뫼비우스 더스트 Mebius Dust" -> "뫼비우스 더스트")
  let korOnly = "";
  const matchKor = t.match(/[가-힣0-9\s~:-]+/g);
  if (matchKor) {
    korOnly = matchKor.join(" ").replace(/\s+/g, " ").trim();
  }

  // 시즌/기수 제거
  const removeSeason = (str: string) => {
    return str
      .replace(/\s*\d+\s*기\b/g, "")
      .replace(/season\s*\d+/gi, "")
      .replace(/\b\d+(?:st|nd|rd|th)\b/gi, "")
      .replace(/\s+[ⅠⅡⅢⅣⅤⅥII|III|IV|V|VI]\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  // 구분자(~, -, :, 「, 『) 앞의 대표명사 추출
  const getMainBeforeSeparator = (str: string) => {
    for (const sep of ["~", "-", ":", "「", "『"]) {
      if (str.includes(sep) && !str.startsWith(sep)) {
        return str.split(sep)[0].trim();
      }
    }
    return "";
  };

  const addCandidates = (base: string) => {
    if (!base) return;
    const cleaned = base.replace(/[^\w\s가-힣a-zA-Z0-9]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 2) {
      queries.add(cleaned);

      // 띄어쓰기 변형 (공백 없는 4글자 이상 한글: 예 "무직전생" -> "무직 전생")
      if (!cleaned.includes(" ") && cleaned.length >= 4) {
        queries.add(cleaned.slice(0, 2) + " " + cleaned.slice(2));
      }

      // 첫 1~2단어 (불용어 제외)
      const words = cleaned.split(/\s+/).filter((w) => !["시즌", "더빙", "자막", "극장판", "애니", "1기", "2기", "3기", "4기", "5기"].includes(w));
      if (words.length >= 1 && words[0].length >= 2) {
        queries.add(words[0]);
      }
      if (words.length >= 2) {
        queries.add(`${words[0]} ${words[1]}`);
      }
    }
  };

  const mainSep = getMainBeforeSeparator(t);
  if (mainSep) {
    addCandidates(removeSeason(mainSep));
    addCandidates(mainSep);
  }

  if (korOnly) {
    addCandidates(removeSeason(korOnly));
    addCandidates(korOnly);
  }

  const baseCleaned = removeSeason(t);
  addCandidates(baseCleaned);
  addCandidates(t);

  return Array.from(queries).filter((q) => q.length >= 2);
}

// 12-2. Anime Match Scorer (가중치 기반 최적 작품 매칭기 - 오매칭 원천 차단)
export function scoreAnimeMatch(
  rawTitle: string,
  targetSeason: number | null,
  item: { animeNo: number; subject: string }
): number {
  const itemSubject = item.subject || "";
  const itemSeason = parseSeason(itemSubject);

  let score = 0;

  // 1) 제목 완전 일치 또는 상호 포함 여부
  const cleanRaw = rawTitle.replace(/[^\w가-힣0-9]/g, "").toLowerCase();
  const cleanItem = itemSubject.replace(/[^\w가-힣0-9]/g, "").toLowerCase();

  if (cleanRaw === cleanItem) {
    score += 150;
  } else if (cleanItem.includes(cleanRaw) || cleanRaw.includes(cleanItem)) {
    score += 80;
  }

  // 2) 시즌 일치 점수
  if (targetSeason === null) {
    // 1기이거나 단편인 경우
    if (itemSeason === null || itemSeason === 1) {
      score += 40;
    } else {
      // 대상이 2기, 3기 등 후속작이면 큰 감점
      score -= 60;
    }
  } else {
    // 특정 시즌(2기 이상)인 경우
    if (itemSeason === targetSeason) {
      score += 60;
    } else if (itemSeason === null) {
      score -= 20;
    } else {
      // 시즌이 완전히 다른 경우 대폭 감점 (예: 2기 찾는데 5기)
      score -= 100;
    }
  }

  // 3) 극장판 / 외전 패널티
  const isTargetMovie = /극장판|movie/i.test(rawTitle);
  const isItemMovie = /극장판|movie/i.test(itemSubject);
  if (isTargetMovie && isItemMovie) {
    score += 40;
  } else if (!isTargetMovie && isItemMovie) {
    score -= 40; // TV 시리즈 찾는데 극장판이면 감점
  }

  const isTargetSpinOff = /외전|팬레터|스페셜|멍!/i.test(rawTitle);
  const isItemSpinOff = /외전|팬레터|스페셜|멍!/i.test(itemSubject);
  if (!isTargetSpinOff && isItemSpinOff) {
    score -= 50; // 본편 찾는데 스핀오프면 감점
  }

  // 4) 단어 오버랩 점수
  const rawWords = rawTitle.split(/\s+/).filter((w) => w.length >= 2);
  let overlapWords = 0;
  for (const w of rawWords) {
    if (itemSubject.includes(w)) overlapWords++;
  }
  score += overlapWords * 15;

  return score;
}

// 12-3. Anissia API query for subtitle creators with smart multi-stage search
export async function getAnissiaCreators(
  title: string,
  episodeNumber: number,
  timeoutMs = 3500
): Promise<CreatorInfo[]> {
  const results: CreatorInfo[] = [];
  try {
    const targetSeason = parseSeason(title);
    const queries = generateAnissiaSearchQueries(title);

    let bestAnime: { animeNo: number; subject: string } | null = null;
    let bestScore = 0;

    // 최대 4개의 스마트 쿼리를 순차/조기종료 방식으로 검색
    for (const q of queries.slice(0, 4)) {
      try {
        const url = `https://api.anissia.net/anime/list/0?q=${encodeURIComponent(q)}`;
        const res = await subtitleFetch(url, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) continue;
        const json = await res.json();
        const content: Array<{ animeNo: number; subject: string }> = json?.data?.content || [];
        if (content.length === 0) continue;

        for (const item of content) {
          const sc = scoreAnimeMatch(title, targetSeason, item);
          if (sc > bestScore) {
            bestScore = sc;
            bestAnime = item;
          }
        }

        // 높은 신뢰도(120점 이상)인 경우 추가 쿼리 검색 생략
        if (bestScore >= 120) {
          break;
        }
      } catch {}
    }

    // 신뢰도 점수가 50점 미만이면 오매칭(다른 작품 자막) 방지를 위해 제외
    if (!bestAnime || bestScore < 50) {
      return results;
    }

    const capUrl = `https://api.anissia.net/anime/caption/animeNo/${bestAnime.animeNo}`;
    const capRes = await subtitleFetch(capUrl, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (capRes.ok) {
      const capJson = await capRes.json();
      const captions = capJson?.data || [];
      const seenNames = new Set<string>();

      for (const c of captions) {
        const name = (c.name || "제작자").trim();
        if (seenNames.has(name)) continue;
        seenNames.add(name);

        const epStr = String(c.episode ?? "");
        const isCurrent = epStr.trim() !== '' && Number(epStr) === episodeNumber;
        results.push({
          name,
          episode: epStr,
          update_date: (c.updDt || "").replace("T", " ").slice(0, 16),
          website: (c.website || "").trim(),
          is_current_ep: isCurrent,
        });
      }
    }
  } catch (e) {
    console.error("[getAnissiaCreators error]:", e);
  }
  return results;
}

export async function getAnissiaCreatorsById(animeNo: number, episodeNumber: number): Promise<CreatorInfo[]> {
  const response = await subtitleFetch(`https://api.anissia.net/anime/caption/animeNo/${animeNo}`, {
    headers: HEADERS, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Caption lookup failed');
  const json = await response.json();
  const captions = json.data ?? json;
  if (!Array.isArray(captions)) throw new Error('Invalid caption response');
  return captions.map((c: any) => ({
    name: String(c.name || '제작자'), episode: String(c.episode ?? ''),
    update_date: String(c.updDt || '').replace('T', ' ').slice(0, 16),
    website: String(c.website || '').trim(),
    is_current_ep: String(c.episode ?? '').trim() !== '' && Number(c.episode) === episodeNumber,
  }));
}

// Keep completed work on timeout, and cancel outstanding upstream requests.
export async function searchAllSubtitlesParallel(
  title: string,
  episodeNumber: number,
  maxTotalTimeMs = 13000,
  animeNo?: number,
): Promise<SubtitleSearchResult> {
  const controller = new AbortController();
  const subtitles: SubtitleResult[] = [];
  let creators: CreatorInfo[] = [];
  let lookupFailed = false;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>(resolve => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); resolve(); }, maxTotalTimeMs);
  });
  const collect = (sub: SubtitleResult | null) => {
    if (!controller.signal.aborted && sub && validateKoreanSubtitle(sub) && !subtitles.some(s => s.name === sub.name)) subtitles.push(sub);
  };
  const work = subtitleRequestContext.run(controller.signal, async () => {
    // The title is already Korean in the Anissia-first flow. ID lookup avoids fuzzy rematching.
    const creatorWork = (async () => {
      try {
        creators = animeNo ? await getAnissiaCreatorsById(animeNo, episodeNumber) : await getAnissiaCreators(title, episodeNumber);
        const candidates = creators.filter(c => /^https?:\/\//.test(c.website))
          .sort((a, b) => Number(b.is_current_ep) - Number(a.is_current_ep)).slice(0, 4);
        await Promise.allSettled(candidates.map(async c => collect(await fetchCreatorSubtitle(c.name, c.website, title, episodeNumber, 4000))));
      } catch { lookupFailed = true; }
    })();
    const fallbackWork = findKairanSubtitle(title, episodeNumber, 4000).then(collect);
    await Promise.allSettled([creatorWork, fallbackWork]);
  });
  try { await Promise.race([work, deadline]); }
  finally { clearTimeout(timer!); controller.abort(); }
  return {
    subtitles: [...subtitles], creators: [...creators],
    status: subtitles.length ? 'ready' : timedOut ? 'timeout' : lookupFailed ? 'error' : 'not_found',
  };
}
