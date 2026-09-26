import type { SubtitleResult, CreatorInfo } from './subtitles';
import type { EpisodeItem, EpisodeStreamInfo } from './providers/types';

export type SubtitleStatus = 'ready' | 'not_found' | 'timeout' | 'error';
export interface SubtitleSearchResult {
  subtitles: SubtitleResult[];
  creators: CreatorInfo[];
  status: SubtitleStatus;
}

/** History stores video numbering; the Korean page expects subtitle numbering. */
export function nextKoreanHistoryUrl(watchUrl: string, currentVideoEpisode: number, nextVideoEpisode: number): string | null {
  const match = /^\/korean\/(\d+)\?ep=(\d+(?:\.\d+)?)$/.exec(watchUrl);
  if (!match) return null;
  const nextSubtitleEpisode = Number((Number(match[2]) + nextVideoEpisode - currentVideoEpisode).toFixed(1));
  return Number.isFinite(nextSubtitleEpisode) && nextSubtitleEpisode >= 0
    ? `/korean/${match[1]}?ep=${nextSubtitleEpisode}` : null;
}

function seconds(text: string): number {
  const parts = text.replace(',', '.').split(':').map(Number);
  if (parts.some(p => !Number.isFinite(p) || p < 0)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}

/** Only playable Korean dialogue counts as an acquired subtitle, not a blog link. */
export function validateKoreanSubtitle(sub: Pick<SubtitleResult, 'content' | 'is_ass'>): boolean {
  const content = sub?.content;
  if (typeof content !== 'string' || content.length > 2_000_000 || /<!doctype\s+html|<html\b|<head\b/i.test(content)) return false;
  const cue = sub.is_ass
    ? /^Dialogue:\s*[^,]+,([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/gim
    : /^((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/gm;
  if (!sub.is_ass && !/^\uFEFF?WEBVTT(?:\s|$)/.test(content)) return false;
  for (const match of content.replace(/\r/g, '').matchAll(cue)) {
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    const dialogue = match[3].replace(/\{[^}]*\}|<[^>]*>/g, '');
    if (end > start && start >= 0 && /[가-힣]/.test(dialogue)) return true;
  }
  return false;
}

export interface ReanimeCandidate {
  id: string;
  title: string;
  nativeTitle: string;
  romajiTitle?: string;
  poster?: string;
  year: string;
  episodes?: number;
  format?: string;
  exactMatch?: boolean;
}

export function rankReanimeCandidates(
  anime: { originalSubject: string; subject: string; startDate: string },
  candidates: ReanimeCandidate[],
): ReanimeCandidate[] {
  const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const original = normalize(anime.originalSubject || '');
  const year = anime.startDate?.slice(0, 4);
  return candidates.map(c => ({...c, exactMatch: Boolean(original && original === normalize(c.nativeTitle) && (!year || c.year === year))}))
    .sort((a, b) => Number(b.exactMatch) - Number(a.exactMatch));
}

export async function prepareKoreanPlayback(
  input: { episode: number; offset: number; episodes: EpisodeItem[] },
  dependencies: {
    findSubtitles: () => Promise<SubtitleSearchResult>;
    getStream: (url: string) => Promise<Partial<EpisodeStreamInfo> | null | undefined>;
  },
) {
  const videoEpisode = input.episode + input.offset;
  const episode = input.episodes.find(e => e.number === videoEpisode);
  if (!episode) return {status: 'episode_missing' as const, videoEpisode, subtitles: [], creators: []};
  const found = await dependencies.findSubtitles();
  const subtitles = found.subtitles.filter(s => s.episode === input.episode && validateKoreanSubtitle(s));
  if (!subtitles.length) return {...found, subtitles, status: found.status === 'ready' ? 'not_found' as const : found.status, videoEpisode};
  // This call must stay after validation. A failed preflight never loads video.
  const stream = await dependencies.getStream(episode.watch_url);
  if (!stream?.embed_url && !stream?.m3u8_url) return {status: 'stream_error' as const, subtitles, creators: found.creators, videoEpisode};
  return {status: 'ready' as const, stream, subtitles, creators: found.creators, videoEpisode, episodeTitle: episode.title};
}
