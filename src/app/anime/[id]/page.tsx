import Navbar from "@/components/Navbar";
import ReanimeDetail from "@/components/ReanimeDetail";
import {getAnimeDetail} from "@/lib/reanime";
import {requireAuth,getCurrentUserId} from "@/lib/auth";
import {getAnimeHistoryMap,getReanimeBaseUrl} from "@/lib/db";
export default async function AnimeDetailPage({params,searchParams}: {params:Promise<{id:string}>;searchParams:Promise<{dub?:string}>}) {
  await requireAuth();
  const {id} = await params;
  const {dub} = await searchParams;
  const baseUrl = await getReanimeBaseUrl();
  const history = await getAnimeHistoryMap(await getCurrentUserId(),id);
  let anime = null;
  try { anime = await getAnimeDetail(id); } catch { /* Browser retry */ }
  return <div className="min-h-screen bg-[#0b0f19]"><Navbar/><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <ReanimeDetail key={`${baseUrl}:${id}`} baseUrl={baseUrl} id={id} isDub={dub === "1"} initialData={anime} history={history}/>
  </main></div>;
}
