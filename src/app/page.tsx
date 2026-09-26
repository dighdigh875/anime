import Navbar from "@/components/Navbar";
import AnimeCard from "@/components/AnimeCard";
import HistoryList, { HistoryItem } from "@/components/HistoryList";
import ReanimeFeed from "@/components/ReanimeFeed";
import { getAnimeList } from "@/lib/reanime";
import type { AnimeListItem, AnimeListResponse } from "@/lib/reanime-client";
import { getReanimeBaseUrl } from "@/lib/db";
import { getDb, initDb } from "@/lib/db";
import { checkAndPromoteNewEpisodes } from "@/lib/historyPromotion";
import { getCurrentUserId, requireAuth } from "@/lib/auth";
import Link from "next/link";
import { Flame, Tv, Filter, ChevronLeft, ChevronRight, Star, Clock } from "lucide-react";

interface SearchParams {
  tab?: string;
  q?: string;
  page?: string;
  genre?: string;
  year?: string;
  type?: string;
  period?: "day" | "week" | "month" | "all";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // 인증 검사: 관리자 없으면 /setup 강제 이동, 미로그인이면 /login 강제 이동
  await requireAuth();

  const params = await searchParams;
  const tab = params.tab || (params.q ? "search" : "airing");
  const q = params.q?.trim() || "";
  const page = parseInt(params.page || "1", 10) || 1;
  let items: AnimeListItem[] = [];
  let historyItems: HistoryItem[] = [];

  const baseUrl = await getReanimeBaseUrl();
  let initialFeed: AnimeListResponse | null = null;
  if (q || (tab !== "favorites" && tab !== "history")) {
    try { initialFeed = await getAnimeList({q, tab, page}); } catch { /* Browser retry */ }
  }

  if (!q && tab === "favorites") {
    const sql = getDb();
    if (sql) {
      await initDb();
      try {
        const currentUserId = await getCurrentUserId();
        const rows = await sql`
          SELECT anime_id as id, anime_title as title, anime_poster as poster, '' as detail_url, '즐겨찾기' as remarks
          FROM anime_favorites
          WHERE user_id = ${currentUserId}
          ORDER BY created_at DESC;
        `;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items = rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          poster: r.poster,
          detail_url: `/anime/${r.id}`,
          remarks: "★ 즐겨찾기",
        }));
      } catch {}
    }
  } else if (tab === "history") {
    const sql = getDb();
    if (sql) {
      await initDb();
      try {
        const currentUserId = await getCurrentUserId();
        await checkAndPromoteNewEpisodes(currentUserId);

        const rows = await sql`
          SELECT * FROM (
            SELECT DISTINCT ON (anime_id)
              id, anime_id, anime_title, anime_poster, episode_number, episode_title, watch_url, watch_time, duration, is_completed, updated_at
            FROM anime_history
            WHERE user_id = ${currentUserId}
            ORDER BY anime_id, updated_at DESC
          ) t
          ORDER BY updated_at DESC
          LIMIT 50;
        `;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        historyItems = rows.map((r: any) => ({
          id: r.id,
          anime_id: r.anime_id,
          anime_title: r.anime_title,
          anime_poster: r.anime_poster || "",
          episode_number: r.episode_number,
          episode_title: r.episode_title || "",
          watch_url: r.watch_url,
          watch_time: parseFloat(r.watch_time || "0"),
          duration: parseFloat(r.duration || "0"),
          is_completed: Boolean(r.is_completed),
          updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        }));
      } catch (e) {
        console.error("Failed to fetch history:", e);
      }
    }
  }


  return (
    <div className="min-h-screen bg-[#0b0f19]">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-purple-500/20 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/?tab=airing"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "airing"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Tv className="h-4 w-4" />
              신작 방영
            </Link>

            <Link
              href="/?tab=top"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "top"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Flame className="h-4 w-4" />
              인기 작품
            </Link>

            <Link
              href="/?tab=list"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "list"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Filter className="h-4 w-4" />
              최근 등록
            </Link>

            <Link
              href="/?tab=favorites"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "favorites"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              즐겨찾기
            </Link>

            <Link
              href="/?tab=history"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "history"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Clock className="h-4 w-4 text-purple-400" />
              시청 기록
            </Link>
          </div>

        </div>

        {/* History Tab vs General Grid */}
        {!q && tab === "history" ? (
          <div className="mt-6">
            <HistoryList initialItems={historyItems} />
          </div>
        ) : !q && tab === "favorites" ? (
          <>
            {/* Anime Grid */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((anime) => (
                <AnimeCard key={anime.id} anime={anime} />
              ))}
            </div>

            {items.length === 0 && (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-slate-400">
                <p className="text-base font-semibold">
                  {tab === "favorites"
                    ? "등록된 즐겨찾기가 없습니다. 마음에 드는 작품을 추가해 보세요!"
                    : "작품 목록이 없습니다."}
                </p>
              </div>
            )}
          </>
        ) : <ReanimeFeed key={`${baseUrl}:${tab}:${q}:${page}`} baseUrl={baseUrl} params={{tab,q,page}} initialData={initialFeed} />}

      </main>
    </div>
  );
}
