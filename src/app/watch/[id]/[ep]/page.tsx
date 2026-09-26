import Navbar from "@/components/Navbar";
import ReanimeWatch from "@/components/ReanimeWatch";
import {getAnimeDetail,getEpisodeStream} from "@/lib/reanime";
import {selectEpisode} from "@/lib/reanime-client";
import {getReanimeBaseUrl} from "@/lib/db";
import {requireAuth} from "@/lib/auth";
export default async function WatchPage({params,searchParams}: {params:Promise<{id:string;ep:string}>;searchParams:Promise<{dub?:string}>}) {
  await requireAuth();
  const {id,ep} = await params;
  const {dub} = await searchParams;
  const number = Number(ep);
  const isDub = dub === "1";
  const baseUrl = await getReanimeBaseUrl();
  let anime = null, stream = null;
  try {
    anime = await getAnimeDetail(id);
    const episode = selectEpisode(anime,number,isDub);
    if (episode) stream = await getEpisodeStream(episode.watch_url);
  } catch { /* Browser retry */ }
  return <div className="min-h-screen bg-[#0b0f19]"><Navbar/><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <ReanimeWatch key={`${baseUrl}:${id}:${ep}:${isDub}`} baseUrl={baseUrl} id={id} ep={number} isDub={isDub} initialAnime={anime} initialStream={stream}/>
  </main></div>;
}
