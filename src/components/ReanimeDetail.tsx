"use client";
import {useEffect,useState} from "react";
import {fetchReanimeDetail,type AnimeDetail} from "@/lib/reanime-client";
import ReanimeConnectionState from "./ReanimeConnectionState";
import ReanimeDetailView from "./ReanimeDetailView";

export default function ReanimeDetail({baseUrl,id,isDub,initialData,history}: {baseUrl:string;id:string;isDub:boolean;initialData:AnimeDetail|null;history:Record<string,any>}) {
  const [data,setData] = useState(initialData);
  const [error,setError] = useState("");
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    if (initialData && attempt === 0) return;
    let active = true;
    setError("");
    const load = async () => {
      if (attempt > 0) {
        try {
          const res = await fetch(`/api/anime/detail?id=${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(15000)});
          if (res.ok) return await res.json() as AnimeDetail;
        } catch { /* Browser retry */ }
      }
      return fetchReanimeDetail(baseUrl,id);
    };
    load().then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message || "Reanime 작품 연결 실패");});
    return ()=>{active=false;};
  },[baseUrl,id,initialData,attempt]);
  if (!data) return <ReanimeConnectionState error={error} retry={()=>setAttempt(x=>x+1)} externalUrl={baseUrl}/>;
  return <ReanimeDetailView anime={data} isDub={isDub} initialHistoryMap={history}/>;
}
