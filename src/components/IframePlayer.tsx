"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  Maximize2,
  Minimize2,
  RotateCcw,
  Clock,
  Target,
  Type,
  Subtitles,
  Sparkles,
  Search,
  Check,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { EpisodeItem } from "./Player";
import SubtitleSelectModal, { CreatorInfo, SubtitleOption } from "./SubtitleSelectModal";
import {isPlaybackMessage, pollPlaybackTime} from "@/lib/iframe-playback";
import {ReanimeViewportControls, useReanimeViewport} from "./ReanimeViewport";

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface IframePlayerProps {
  animeId: string;
  animeTitle: string;
  animePoster?: string;
  episodeNumber: number;
  initialEpTitle?: string;
  m3u8Url?: string;
  defaultVttUrl?: string;
  linkPreEp?: number | null;
  linkNextEp?: number | null;
  isDub?: boolean;
  subEpisodes?: EpisodeItem[];
  dubEpisodes?: EpisodeItem[];
  streamType?: "m3u8" | "iframe";
  embedUrl?: string;
  allowNestedPlayback?: boolean;
  initialSubtitles?: SubtitleOption[];
  subtitleEpisodeNumber?: number;
  watchPageUrl?: string;
  backUrl?: string;
}

function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${String(m).padStart(2, "0")}:${s.padStart(4, "0")}`;
}

export default function IframePlayer({
  animeId,
  animeTitle,
  animePoster,
  episodeNumber,
  initialEpTitle,
  linkPreEp,
  linkNextEp,
  subEpisodes = [],
  embedUrl = "",
  allowNestedPlayback = false,
  initialSubtitles,
  subtitleEpisodeNumber = episodeNumber,
  watchPageUrl,
  backUrl,
}: IframePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoSurfaceRef = useRef<HTMLDivElement>(null);
  const mirrorViewport = useReanimeViewport(allowNestedPlayback, videoSurfaceRef);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudTextRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const octopusRef = useRef<any>(null);

  // States
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [syncOffset, setSyncOffset] = useState(0.0);
  const [isSubEnabled, setIsSubEnabled] = useState(true);
  const [subSize, setSubSize] = useState<"small" | "normal" | "large">("normal");
  const [isSavedSync, setIsSavedSync] = useState(false);

  // Subtitles & Creators
  const [subtitles, setSubtitles] = useState<SubtitleOption[]>([]);
  const [currentSubIndex, setCurrentSubIndex] = useState(0);
  const [creators, setCreators] = useState<CreatorInfo[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [firstDialogue, setFirstDialogue] = useState<SubtitleCue | null>(null);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [assReady, setAssReady] = useState(false);

  const syncDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastHistorySaveTime = useRef(0);

  // Show temporary toast notice
  const showNotice = useCallback((msg: string, duration = 3000) => {
    setNoticeMessage(msg);
    setTimeout(() => {
      setNoticeMessage((prev) => (prev === msg ? null : prev));
    }, duration);
  }, []);

  // 1. ASS Dialogue Parser
  const parseAssToCues = useCallback((assText: string): SubtitleCue[] => {
    if (!assText) return [];
    const list: SubtitleCue[] = [];
    const pattern =
      /^Dialogue:\s*[^,]+,(\d+:\d{2}:\d{2}(?:\.\d+)?),(\d+:\d{2}:\d{2}(?:\.\d+)?),([^,]*),([^,]*),(?:[^,]*,){4}(.*)$/gim;

    const toSec = (tStr: string) => {
      const p = tStr.trim().split(":");
      if (p.length === 3) {
        return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
      } else if (p.length === 2) {
        return parseFloat(p[0]) * 60 + parseFloat(p[1]);
      }
      return parseFloat(tStr) || 0;
    };

    let match;
    while ((match = pattern.exec(assText)) !== null) {
      const startSec = toSec(match[1]);
      const endSec = toSec(match[2]);
      const rawText = match[5];
      const cleanText = rawText
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\N/gi, "\n")
        .replace(/\\n/gi, "\n")
        .trim();
      if (cleanText && endSec > startSec) {
        list.push({ start: startSec, end: endSec, text: cleanText });
      }
    }
    return list;
  }, []);

  // 2. VTT Parser
  const parseVttToCues = useCallback((vttText: string): SubtitleCue[] => {
    if (!vttText) return [];
    const list: SubtitleCue[] = [];
    const lines = vttText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let currentStart: number | null = null;
    let currentEnd: number | null = null;
    let currentTexts: string[] = [];

    const toSec = (tStr: string) => {
      if (!tStr) return 0;
      const cleanStr = tStr.replace(",", ".").trim();
      const p = cleanStr.split(":");
      if (p.length === 3) {
        return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
      } else if (p.length === 2) {
        return parseFloat(p[0]) * 60 + parseFloat(p[1]);
      }
      return parseFloat(cleanStr) || 0;
    };

    const timeArrowPattern =
      /((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{1,3})/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const timeMatch = timeArrowPattern.exec(line);
      if (timeMatch || !line) {
        if (currentStart !== null && currentEnd !== null && currentTexts.length > 0) {
          const text = currentTexts.join("\n").trim();
          if (text && currentEnd > currentStart) {
            list.push({ start: currentStart, end: currentEnd, text });
          }
        }
        // A blank line ends the cue. Its following identifier is metadata,
        // not a line of dialogue from the preceding cue.
        currentStart = timeMatch ? toSec(timeMatch[1]) : null;
        currentEnd = timeMatch ? toSec(timeMatch[2]) : null;
        currentTexts = [];
      } else if (currentStart !== null && line && !line.includes("-->")) {
        currentTexts.push(line);
      }
    }

    if (currentStart !== null && currentEnd !== null && currentTexts.length > 0) {
      const text = currentTexts.join("\n").trim();
      if (text && currentEnd > currentStart) {
        list.push({ start: currentStart, end: currentEnd, text });
      }
    }
    return list;
  }, []);

  // 3. Load saved sync setting from DB
  useEffect(() => {
    async function loadSavedSync() {
      try {
        const res = await fetch(
          `/api/anime/reanime-sync?animeId=${encodeURIComponent(animeId)}&ep=${episodeNumber}`
        );
        const data = await res.json();
        if (data.success && data.setting) {
          const savedOffset = parseFloat(data.setting.sync_offset || "0");
          setSyncOffset(savedOffset);
          setIsSavedSync(true);
        }
      } catch (err) {
        console.error("Failed to load saved sync offset:", err);
      }
    }
    loadSavedSync();
  }, [animeId, episodeNumber]);

  // 4. Save sync setting to DB (debounced)
  const saveSyncToDb = useCallback(
    (offset: number) => {
      setIsSavedSync(false);
      if (syncDebounceTimer.current) {
        clearTimeout(syncDebounceTimer.current);
      }
      syncDebounceTimer.current = setTimeout(async () => {
        try {
          const currentSub = subtitles[currentSubIndex];
          const response = await fetch("/api/anime/reanime-sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              animeId,
              ep: episodeNumber,
              syncOffset: offset,
              subtitleName: currentSub?.name || "",
              subtitleUrl: currentSub?.url || "",
            }),
          });
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error('싱크 저장 실패');
          setIsSavedSync(true);
        } catch (err) {
          console.error("Failed to save sync offset to DB:", err);
        }
      }, 800);
    },
    [animeId, episodeNumber, subtitles, currentSubIndex]
  );

  // 5. Fetch Korean subtitles for this anime
  useEffect(() => {
    if (initialSubtitles) {
      setSubtitles(initialSubtitles); setCurrentSubIndex(0); setLoadingSubs(false);
      return;
    }
    let isCancelled = false;
    async function fetchSubs() {
      setLoadingSubs(true);
      try {
        const res = await fetch(
          `/api/anime/subtitles?title=${encodeURIComponent(animeTitle)}&ep=${subtitleEpisodeNumber}`
        );
        const data = await res.json();
        if (isCancelled) return;

        if (data.success) {
          if (Array.isArray(data.creators)) {
            setCreators(data.creators);
          }
          if (Array.isArray(data.subtitles) && data.subtitles.length > 0) {
            const list: SubtitleOption[] = data.subtitles.map((s: any) => ({
              name: s.name,
              format: s.is_ass ? "ASS" : "VTT",
              is_ass: Boolean(s.is_ass),
              content: s.content || "",
              url: s.url || "",
            }));
            setSubtitles(list);
            setCurrentSubIndex(0);
            showNotice(`자막 로드 완료 (${list.length}개 발견)`);
          }
        }
      } catch (err) {
        console.error("Error fetching subtitles:", err);
      } finally {
        if (!isCancelled) setLoadingSubs(false);
      }
    }
    fetchSubs();
    return () => {
      isCancelled = true;
    };
  }, [animeTitle, subtitleEpisodeNumber, initialSubtitles, showNotice]);

  // 6. When currentSub changes, parse cues or setup SubtitlesOctopus
  useEffect(() => {
    const sub = subtitles[currentSubIndex];
    if (!sub || !sub.content) return;
    let subtitleBlobUrl: string | undefined;

    if (sub.is_ass) {
      const parsed = parseAssToCues(sub.content);
      setCues(parsed);
      if (parsed.length > 0) setFirstDialogue(parsed[0]);

      // Init SubtitlesOctopus on canvas if script is available
      if (typeof window !== "undefined" && window.SubtitlesOctopus && canvasRef.current) {
        try {
          if (octopusRef.current) {
            octopusRef.current.dispose();
            octopusRef.current = null;
          }
          const blob = new Blob([sub.content], { type: "text/plain;charset=utf-8" });
          const blobUrl = URL.createObjectURL(blob);
          subtitleBlobUrl = blobUrl;

          octopusRef.current = new window.SubtitlesOctopus({
            canvas: canvasRef.current,
            subUrl: blobUrl,
            fonts: ["/libass/default.woff2"],
            fallbackFont: "/libass/default.woff2",
            workerUrl: "/libass/subtitles-octopus-worker.js",
            legacyWorkerUrl: "/libass/subtitles-octopus-worker.js",
            timeOffset: syncOffset,
            onReady: () => {
              showNotice(`${sub.name} (ASS 특수효과) 자막 활성화`);
            },
            onError: (e: any) => {
              console.error("SubtitlesOctopus error:", e);
            },
          });
        } catch (e) {
          console.error("Failed to init SubtitlesOctopus:", e);
        }
      }
    } else {
      const parsed = parseVttToCues(sub.content);
      setCues(parsed);
      if (parsed.length > 0) setFirstDialogue(parsed[0]);
      if (octopusRef.current) {
        octopusRef.current.dispose();
        octopusRef.current = null;
      }
    }
    return () => {
      if (octopusRef.current) {octopusRef.current.dispose(); octopusRef.current = null;}
      if (subtitleBlobUrl) URL.revokeObjectURL(subtitleBlobUrl);
    };
  }, [subtitles, currentSubIndex, parseAssToCues, parseVttToCues, syncOffset, showNotice, assReady]);

  // 7. Load SubtitlesOctopus library script
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.SubtitlesOctopus) {setAssReady(true); return;}
    const script = document.createElement("script");
    script.src = "/libass/subtitles-octopus.js";
    script.async = true;
    script.onload = () => setAssReady(true);
    document.body.appendChild(script);
    return () => {script.onload = null; script.remove();};
  }, []);

  // 8. FlixCloud postMessage polling (100ms) & message listeners
  useEffect(() => {
    let embedOrigin: string;
    try { embedOrigin = new URL(embedUrl).origin; } catch { return; }
    const timer = setInterval(() => {
      if (iframeRef.current?.contentWindow) {
        pollPlaybackTime(iframeRef.current.contentWindow, embedOrigin, allowNestedPlayback);
      }
    }, 100);

    const handleMessage = (event: MessageEvent) => {
      const root = iframeRef.current?.contentWindow;
      if (!root || !isPlaybackMessage(event, root, embedOrigin, allowNestedPlayback)) return;

      // Handle Fullscreen queries from iframe
      if (event.data.zenCommand === "getFullscreenState") {
        (event.source as Window).postMessage(
          { zenFullscreenState: !!document.fullscreenElement },
          event.origin
        );
      }

      // Handle Fullscreen toggle command from iframe
      if (event.data.zenCommand === "toggleFullscreen") {
        if (!document.fullscreenElement) {
          containerRef.current?.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
      }

      // Handle currentTime updates from FlixCloud
      if (typeof event.data.currentTime === "number" && Number.isFinite(event.data.currentTime) && event.data.currentTime >= 0) {
        const time = event.data.currentTime;
        setCurrentVideoTime(time);

        if (typeof event.data.duration === "number" && Number.isFinite(event.data.duration) && event.data.duration >= 0) {
          setVideoDuration(event.data.duration);
        }

        // Drive SubtitlesOctopus if ASS
        if (octopusRef.current && typeof octopusRef.current.setCurrentTime === "function") {
          octopusRef.current.setCurrentTime(time + syncOffset);
        }

        // Drive HTML HUD text if cues exist
        if (hudTextRef.current) {
          if (!isSubEnabled || cues.length === 0 || octopusRef.current) {
            hudTextRef.current.style.display = "none";
          } else {
            const effectiveTime = time + syncOffset;
            const matched = cues.find((c) => effectiveTime >= c.start && effectiveTime <= c.end);
            if (matched) {
              hudTextRef.current.innerText = matched.text;
              hudTextRef.current.style.display = "block";
            } else {
              hudTextRef.current.style.display = "none";
            }
          }
        }

        // Save history every 10 seconds
        const now = Date.now();
        if (now - lastHistorySaveTime.current > 10000 && time > 2) {
          lastHistorySaveTime.current = now;
          const dur = event.data.duration || videoDuration;
          fetch("/api/anime/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              anime_id: animeId,
              anime_title: animeTitle,
              anime_poster: animePoster || "",
              episode_number: episodeNumber,
              episode_title: initialEpTitle || `${episodeNumber}화`,
              watch_url: watchPageUrl || `/watch/${animeId}/${episodeNumber}`,
              watch_time: Math.floor(time),
              duration: Math.floor(dur),
              is_completed: dur > 0 && time / dur > 0.85,
            }),
          }).catch(() => {});
        }
      }
    };

    window.addEventListener("message", handleMessage);

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      if (octopusRef.current && typeof octopusRef.current.resize === "function") {
        setTimeout(() => octopusRef.current?.resize?.(), 100);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      clearInterval(timer);
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [animeId, animeTitle, animePoster, episodeNumber, initialEpTitle, isSubEnabled, cues, syncOffset, videoDuration, embedUrl, watchPageUrl, allowNestedPlayback]);

  useEffect(() => () => {if (syncDebounceTimer.current) clearTimeout(syncDebounceTimer.current);}, []);

  // Adjust Sync Offset
  const adjustSync = (delta: number) => {
    const nextVal = Math.round((syncOffset + delta) * 10) / 10;
    setSyncOffset(nextVal);
    saveSyncToDb(nextVal);
  };

  const resetSync = () => {
    setSyncOffset(0.0);
    saveSyncToDb(0.0);
    showNotice("싱크가 0.0초로 초기화되었습니다.");
  };

  // Instant Sync matching first dialogue
  const handleAutoSyncFirstDialogue = () => {
    if (!firstDialogue) {
      showNotice("자막의 첫 대사 정보를 불러오지 못했습니다.");
      return;
    }
    // Dialogue time in sub vs current playback time in video
    // When dialogue is spoken, currentVideoTime + offset = firstDialogue.start
    // => offset = firstDialogue.start - currentVideoTime
    const calculatedOffset = Math.round((firstDialogue.start - currentVideoTime) * 10) / 10;
    setSyncOffset(calculatedOffset);
    saveSyncToDb(calculatedOffset);
    showNotice(
      `첫 대사에 맞춰 싱크가 ${calculatedOffset > 0 ? `+${calculatedOffset}` : calculatedOffset}초로 자동 조정되었습니다! 🎯`
    );
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const cycleSubSize = () => {
    if (subSize === "small") setSubSize("normal");
    else if (subSize === "normal") setSubSize("large");
    else setSubSize("small");
  };

  const handleSelectSubtitle = (selectedSub: SubtitleOption) => {
    setSubtitles((prev) => {
      const idx = prev.findIndex((s) => s.name === selectedSub.name);
      if (idx >= 0) {
        setCurrentSubIndex(idx);
        return prev;
      }
      const updated = [selectedSub, ...prev];
      setCurrentSubIndex(0);
      return updated;
    });
    saveSyncToDb(syncOffset);
    showNotice(`자막 [${selectedSub.name}] 적용 완료! ✨`);
  };

  const subSizeClasses = {
    small: "text-[clamp(16px,2.4vw,24px)] leading-snug",
    normal: "text-[clamp(20px,3.2vw,34px)] leading-tight",
    large: "text-[clamp(24px,4.0vw,42px)] leading-tight",
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* Top Header / Breadcrumb & Episode Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-purple-500/20 bg-slate-900/60 p-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            href={backUrl || `/anime/${animeId}`}
            className="flex items-center gap-1.5 rounded-xl bg-purple-600/20 px-3 py-1.5 text-xs font-semibold text-purple-300 transition hover:bg-purple-600 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            작품으로
          </Link>
          <div>
            <h1 className="text-base font-bold text-white line-clamp-1">{animeTitle}</h1>
            <p className="text-xs text-purple-400">
              {initialEpTitle || `${episodeNumber}화`} • ReAnime 1080p
            </p>
          </div>
        </div>

        {/* Episode Switcher Dropdown & Nav Buttons */}
        <div className="flex items-center gap-2">
          {linkPreEp && (
            <Link
              href={`/watch/${animeId}/${linkPreEp}`}
              className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
              이전화
            </Link>
          )}

          {subEpisodes.length > 0 && (
            <div className="relative">
              <select
                value={episodeNumber}
                onChange={(e) => {
                  const targetEp = e.target.value;
                  if (targetEp) {
                    window.location.href = `/watch/${animeId}/${targetEp}`;
                  }
                }}
                className="appearance-none rounded-xl border border-purple-500/30 bg-slate-800/90 py-1.5 pl-3 pr-8 text-xs font-bold text-purple-200 outline-none transition focus:border-purple-400 cursor-pointer"
              >
                {subEpisodes.map((ep) => (
                  <option key={ep.number} value={ep.number} className="bg-slate-900 text-white">
                    {ep.title || `${ep.number}화`}
                  </option>
                ))}
              </select>
              <List className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400" />
            </div>
          )}

          {linkNextEp && (
            <Link
              href={`/watch/${animeId}/${linkNextEp}`}
              className="flex items-center gap-1 rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-purple-600/30 transition hover:bg-purple-500"
            >
              다음화
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>

      {/* Main Video Box with Subtitle HUD Overlay */}
      <ReanimeViewportControls viewport={mirrorViewport}/>
      <div
        ref={containerRef}
        className={`relative grid place-items-center aspect-video w-full overflow-hidden rounded-2xl border border-purple-500/30 bg-black shadow-2xl shadow-purple-950/40 ${
          isFullscreen ? "fixed inset-0 z-50 h-screen w-screen rounded-none border-none" : ""
        }`}
      >
        <div ref={videoSurfaceRef} className="relative h-full w-full overflow-hidden"
          style={allowNestedPlayback && mirrorViewport.cropped && isFullscreen ? {width: 'min(100%, calc(100dvh * 16 / 9))', height: 'auto', aspectRatio: '16 / 9'} : undefined}>
        {/* Layer 1: Sandboxed FlixCloud Iframe */}
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title="Anime Player"
          className="absolute inset-0 h-full w-full border-0 z-0"
          style={mirrorViewport.style}
          scrolling={allowNestedPlayback && mirrorViewport.cropped ? 'no' : 'auto'}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-fullscreen"
          allowFullScreen
        />

        {/* Layer 2a: SubtitlesOctopus ASS Canvas (WASM libass) */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full pointer-events-none z-10"
          style={{visibility: isSubEnabled ? 'visible' : 'hidden'}}
        />

        {/* Layer 2b: Text / VTT Subtitle HUD Overlay */}
        <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-end items-center pb-[7.5%] overflow-hidden">
          <div
            ref={hudTextRef}
            className={`font-black text-white text-center max-w-[88%] px-4 py-1.5 rounded-xl transition-all duration-75 select-none ${subSizeClasses[subSize]}`}
            style={{
              textShadow:
                "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, -3px 0 0 #000, 3px 0 0 #000, 0 -3px 0 #000, 0 3px 0 #000, 0 4px 14px rgba(0, 0, 0, 0.95)",
              display: "none",
            }}
          />
        </div>

        {/* Toast Notification Banner inside player */}
        {noticeMessage && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl border border-purple-500/40 bg-slate-900/90 px-4 py-2 text-xs font-bold text-purple-200 shadow-2xl backdrop-blur-md animate-fade-in pointer-events-none">
            <Sparkles className="h-4 w-4 text-purple-400" />
            {noticeMessage}
          </div>
        )}
        </div>
      </div>

      {/* Layer 3: Subtitle Control Toolbar (플레이어 하단) */}
      <div className="rounded-2xl border border-purple-500/20 bg-slate-900/70 p-4 backdrop-blur-md space-y-3">
        {/* Row 1: Subtitle Source & First Dialogue Guide */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-400">
              <Subtitles className="h-3.5 w-3.5" />
              {subtitles[currentSubIndex]?.name || "자막 연동 중..."}
            </span>

            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-600/20 px-2.5 py-1 text-xs font-bold text-purple-300 transition hover:bg-purple-600 hover:text-white active:scale-95"
              title="다른 자막 제작자 선택, 수동 검색, 내 파일 직접 열기"
            >
              <Search className="h-3.5 w-3.5" />
              자막 변경 / 검색
            </button>

            {/* Video Time Monitor */}
            <span className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 font-mono text-xs font-semibold text-sky-400">
              <Clock className="h-3 w-3" />
              {formatTime(currentVideoTime)} / {formatTime(videoDuration)}
            </span>

            {loadingSubs && (
              <span className="flex items-center gap-1 text-xs text-purple-400 animate-pulse">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 자막 검색 중...
              </span>
            )}
          </div>

          {/* First Dialogue Guide & Instant Sync Button */}
          {firstDialogue && (
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-3 py-1 text-xs text-slate-300 border border-purple-500/20"
                title={`자막 첫 대사: "${firstDialogue.text}"`}
              >
                <span className="font-bold text-purple-400">📌 첫 대사:</span>
                <span className="max-w-[200px] truncate text-slate-200">
                  &quot;{firstDialogue.text}&quot;
                </span>
                <span className="font-mono text-sky-400">
                  ({formatTime(firstDialogue.start)})
                </span>
              </div>

              <button
                onClick={handleAutoSyncFirstDialogue}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-3 py-1 text-xs font-bold text-white shadow-lg shadow-purple-600/30 transition hover:brightness-110 active:scale-95"
              >
                <Target className="h-3.5 w-3.5 text-yellow-300" />
                지금 대사에 맞추기
              </button>
            </div>
          )}
        </div>

        {/* Row 2: Fine-Tuning Sync Offset & Tooling */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Sync Offset Adjuster */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-bold text-slate-400 mr-1">싱크 미세조절:</span>
            <button
              onClick={() => adjustSync(-5.0)}
              className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95"
            >
              -5s
            </button>
            <button
              onClick={() => adjustSync(-1.0)}
              className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95"
            >
              -1s
            </button>
            <button
              onClick={() => adjustSync(-0.1)}
              className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95"
            >
              -0.1s
            </button>

            <span className="min-w-[56px] text-center font-mono text-sm font-extrabold text-purple-300">
              {syncOffset > 0 ? `+${syncOffset.toFixed(1)}s` : `${syncOffset.toFixed(1)}s`}
            </span>

            <button
              onClick={() => adjustSync(0.1)}
              className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95"
            >
              +0.1s
            </button>
            <button
              onClick={() => adjustSync(1.0)}
              className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95"
            >
              +1s
            </button>
            <button
              onClick={() => adjustSync(5.0)}
              className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95"
            >
              +5s
            </button>

            <button
              onClick={resetSync}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-400 transition hover:bg-slate-700 hover:text-slate-200"
              title="싱크 0초로 초기화"
            >
              <RotateCcw className="h-3 w-3" />
              초기화
            </button>

            {isSavedSync && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-400 ml-2">
                <Check className="h-3 w-3" /> 저장됨
              </span>
            )}
          </div>

          {/* Subtitle Toggle, Size & Fullscreen */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSubEnabled(!isSubEnabled)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                isSubEnabled
                  ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                  : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              자막 {isSubEnabled ? "ON" : "OFF"}
            </button>

            <button
              onClick={cycleSubSize}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white"
              title="자막 크기 변경"
            >
              <Type className="h-3.5 w-3.5 text-purple-400" />
              {subSize === "small" ? "작게" : subSize === "normal" ? "보통" : "크게"}
            </button>

            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5" /> 축소
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" /> 전체화면
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Subtitle Selection & Search Modal */}
      <SubtitleSelectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        animeId={animeId}
        animeTitle={animeTitle}
        episodeNumber={subtitleEpisodeNumber}
        creators={creators}
        currentSubName={subtitles[currentSubIndex]?.name}
        onSelectSubtitle={handleSelectSubtitle}
      />
    </div>
  );
}
