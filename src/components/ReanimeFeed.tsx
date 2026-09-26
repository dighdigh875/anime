"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import AnimeCard from "./AnimeCard";
import ReanimeConnectionState from "./ReanimeConnectionState";
import {fetchReanimeList, type AnimeListResponse, type FeedParams} from "@/lib/reanime-client";

export default function ReanimeFeed({baseUrl,params,initialData}: {baseUrl:string;params:FeedParams;initialData:AnimeListResponse|null}) {
  const [data,setData] = useState(initialData);
  const [error,setError] = useState("");
  const [attempt,setAttempt] = useState(0);
  const {tab,q,page} = params;
  useEffect(() => {
    if (initialData && attempt === 0) return;
    let active = true;
    setError("");
    const load = async () => {
      // Explicit retries also recheck the application server in case the block has cleared.
      if (attempt > 0) {
        try {
          const query = new URLSearchParams({tab:tab||"airing",q:q||"",page:String(page||1)});
          const res = await fetch(`/api/anime/list?${query}`,{signal:AbortSignal.timeout(15000)});
          if (res.ok) return await res.json() as AnimeListResponse;
        } catch { /* Try the browser's network next. */ }
      }
      return fetchReanimeList(baseUrl,{tab,q,page});
    };
    load().then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message || "Reanime 목록 연결 실패");});
    return ()=>{active=false;};
  },[baseUrl,tab,q,page,attempt,initialData]);
  if (!data) return <ReanimeConnectionState error={error} retry={()=>setAttempt(x=>x+1)} externalUrl={baseUrl}/>;
  const pageUrl = (next:number) => `/?${new URLSearchParams({tab:tab||"airing",q:q||"",page:String(next)})}`;
  return <>
    <p className="mt-6 text-sm text-slate-400">{q ? `“${q}” 검색 결과` : tab === "top" ? "Reanime 인기 작품 · 평점순" : tab === "list" ? "Reanime에 최근 등록된 작품" : "Reanime 최근 방영 목록"}</p>
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">{data.items.map(anime=><AnimeCard key={anime.id} anime={anime}/>)}</div>
    {data.items.length === 0 && <p className="py-12 text-center text-slate-400">검색된 작품이 없습니다. 영문 또는 일본어 제목으로도 검색해보세요.</p>}
    <div className="mt-8 flex justify-center gap-4 text-purple-300">
      {data.page > 1 && <Link href={pageUrl(data.page-1)}>이전</Link>}
      <span>{data.page} / {data.total_pages} 페이지</span>
      {data.has_next && <Link href={pageUrl(data.page+1)}>다음</Link>}
    </div>
  </>;
}
