"use client";

import { useEffect, useRef, useState } from "react";
import Player from "@/components/Player";
import { stripReanimeId } from "@/lib/providers";
import { EpisodeItem } from "@/lib/providers/types";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import {loadKoreanReanimeStream} from '@/lib/korean-reanime-client';
import {ReanimeBridgeError} from '@/lib/reanime-browser-bridge';
import ReanimeConnectionHelp from './ReanimeConnectionHelp';

interface ReanimeWatchFallbackProps {
  id: string;
  ep: number;
  isDub?: boolean;
}

export default function ReanimeWatchFallback({
  id,
  ep,
  isDub = false,
}: ReanimeWatchFallbackProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playerProps, setPlayerProps] = useState<any>(null);
  const [needsBridge, setNeedsBridge] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  const slug = stripReanimeId(id);

  const loadStream = async () => {
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller;
    setLoading(true);
    setError(null);
    setNeedsBridge(false);

    try {
      let baseUrl = "https://reanime.to";
      try {
        const settingsRes = await fetch("/api/settings/base-url?provider=reanime", {signal: controller.signal});
        const settingsData = await settingsRes.json();
        if (settingsData.success && settingsData.baseUrl) {
          baseUrl = settingsData.baseUrl;
        }
      } catch {}

      // 1. 디테일 & 에피소드 병렬 조회
      const [rDetail, rEps] = await Promise.all([
        fetch(`${baseUrl}/api/v1/anime/${slug}`, {signal: controller.signal}),
        fetch(`${baseUrl}/api/v1/anime/${slug}/episodes`, {signal: controller.signal}),
      ]);

      if (!rDetail.ok) {
        throw new Error(`작품 정보를 불러오지 못했습니다 (${rDetail.status})`);
      }
      if (!rEps.ok) throw new Error(`회차 목록을 불러오지 못했습니다 (${rEps.status})`);

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

      const subEpisodes: EpisodeItem[] = rawEpisodes.map((e: any) => {
        const epNum = Number(e.episode_number ?? e.number ?? 1);
        return {
          number: epNum,
          title: e.title ? `${epNum}화 - ${e.title}` : `${epNum}화`,
          watch_url: `${baseUrl}/watch/${slug}?ep=${epNum}&anilist=${anilistId}`,
        };
      });

      if (!subEpisodes.some(episode => episode.number === ep)) throw new Error('요청한 영상 회차가 없습니다.');
      // The same authenticated server/extension resolver is used by the Korean page.
      // Never embed the watch page: Reanime now rejects frames from other sites.
      const stream = await loadKoreanReanimeStream({id, anilistId}, ep, controller.signal, isDub ? 'dub' : 'sub');
      controller.signal.throwIfAborted();

      // 회차 번호 계산
      let linkPreEpNum: number | null = null;
      let linkNextEpNum: number | null = null;
      let epTitle = `${ep}화`;

      for (let idx = 0; idx < subEpisodes.length; idx++) {
        const e = subEpisodes[idx];
        if (e.number === ep) {
          epTitle = e.title;
          if (idx > 0) linkPreEpNum = subEpisodes[idx - 1].number;
          if (idx + 1 < subEpisodes.length) linkNextEpNum = subEpisodes[idx + 1].number;
          break;
        }
      }

      setPlayerProps({
        animeId: id,
        animeTitle: title,
        animePoster: poster,
        episodeNumber: ep,
        initialEpTitle: epTitle,
        m3u8Url: "",
        defaultVttUrl: "",
        linkPreEp: linkPreEpNum,
        linkNextEp: linkNextEpNum,
        isDub,
        subEpisodes,
        dubEpisodes: [],
        streamType: "iframe",
        embedUrl: stream.embed_url || stream.player_url,
      });
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.error("[ReanimeWatchFallback error]:", err);
      setError(err?.message || "영상 스트림을 불러오는 중 오류가 발생했습니다.");
      setNeedsBridge(err instanceof ReanimeBridgeError && err.code === 'NOT_INSTALLED');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    loadStream();
    return () => activeRequest.current?.abort();
  }, [id, ep, isDub]);

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-20 text-center">
        <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-purple-500/20 bg-slate-900/60 p-12 backdrop-blur-md">
          <Loader2 className="h-10 w-10 animate-spin text-purple-400" />
          <h2 className="text-lg font-bold text-white">ReAnime 고화질 스트림 연결 중...</h2>
          <p className="text-xs text-slate-400">영상 소스 서버를 탐색하고 있습니다. 잠시만 기다려주세요.</p>
        </div>
      </main>
    );
  }

  if (error || !playerProps) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16 text-center">
        <div className="rounded-3xl border border-red-500/20 bg-slate-900/60 p-8">
          <h2 className="text-xl font-bold text-red-400">스트림 주소를 불러오지 못했습니다.</h2>
          <p className="mt-2 text-sm text-slate-400">
            {error || "해당 회차 영상 소스가 아직 업로드되지 않았거나 연결이 원활하지 않습니다."}
          </p>
          {needsBridge && <div className="mt-4 text-left"><ReanimeConnectionHelp/></div>}
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href={`/anime/${id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition"
            >
              <ArrowLeft className="h-4 w-4" /> 작품 회차 목록으로 돌아가기
            </Link>
            <button
              onClick={loadStream}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 transition"
            >
              <RefreshCw className="h-4 w-4" /> 다시 시도
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Player {...playerProps} />
    </main>
  );
}
