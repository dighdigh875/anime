"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import Player from "./Player";
import IframePlayer from "./IframePlayer";
import ReanimeConnectionState from "./ReanimeConnectionState";
import {fetchReanimeDetail,fetchReanimeStream,selectEpisode,type AnimeDetail,type EpisodeStreamInfo} from "@/lib/reanime-client";

export default function ReanimeWatch({baseUrl,id,ep,isDub,initialAnime,initialStream}: {
  baseUrl:string;id:string;ep:number;isDub:boolean;initialAnime:AnimeDetail|null;initialStream:EpisodeStreamInfo|null;
}) {
  const [data,setData] = useState<{anime:AnimeDetail;stream:EpisodeStreamInfo}|null>(initialAnime && initialStream ? {anime:initialAnime,stream:initialStream}:null);
  const [error,setError] = useState("");
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    if (data) return;
    let active = true;
    setError("");
    const load = async () => {
      let anime = initialAnime;
      if (!anime) {
        // Retry our server too; Flix may allow it even when the catalogue was blocked.
        try {
          const res = await fetch(`/api/anime/detail?id=${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(15000)});
          if (res.ok) anime = await res.json();
        } catch { /* Browser fallback below */ }
        if (!anime) anime = await fetchReanimeDetail(baseUrl,id);
      }
      if (!selectEpisode(anime,ep,isDub)) throw new Error("선택한 회차 또는 언어의 영상이 없습니다. 작품 목록에서 회차를 다시 선택해주세요.");
      let stream: EpisodeStreamInfo;
      try {
        const res = await fetch(`/api/anime/reanime-stream?anilist=${anime.anilist_id}&ep=${ep}&dub=${isDub ? 1:0}`,{signal:AbortSignal.timeout(15000)});
        if (!res.ok) throw new Error("Reanime 영상 서버 연결 실패");
        stream = await res.json();
      } catch {
        stream = await fetchReanimeStream(baseUrl,anime.anilist_id,ep,isDub);
      }
      return {anime,stream};
    };
    load().then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message || "Reanime 영상 연결 실패");});
    return ()=>{active=false;};
  },[baseUrl,id,ep,isDub,initialAnime,attempt,data]);
  if (!data) return <><Link href={`/anime/${id}`} className="text-purple-300">← 회차 목록</Link><ReanimeConnectionState error={error} retry={()=>setAttempt(x=>x+1)} externalUrl={`${baseUrl}/watch/${id.slice(3)}?ep=${ep}`}/></>;
  const {anime,stream} = data;
  const episodes = isDub ? anime.dub_episodes : anime.sub_episodes;
  const index = episodes.findIndex(e=>e.number===ep);
  const common = {animeId:id,animeTitle:anime.title,animePoster:anime.poster,episodeNumber:ep,isDub,
    linkPreEp:episodes[index-1]?.number,linkNextEp:episodes[index+1]?.number,subEpisodes:anime.sub_episodes,dubEpisodes:anime.dub_episodes};
  if (stream.stream_type === "iframe") return <IframePlayer key={`${id}:${ep}:${isDub}`} {...common} subEpisodes={episodes} embedUrl={stream.embed_url} initialEpTitle={episodes[index]?.title} watchPageUrl={`/watch/${id}/${ep}${isDub?"?dub=1":""}`} backUrl={`/anime/${id}${isDub?"?dub=1":""}`}/>;
  const m3u8 = `/api/anime/stream/m3u8?url=${encodeURIComponent(stream.m3u8_url)}&ref=${encodeURIComponent(stream.player_url)}`;
  return <Player key={`${id}:${ep}:${isDub}`} {...common} m3u8Url={m3u8} defaultVttUrl=""/>;
}
