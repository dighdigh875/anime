import Navbar from '@/components/Navbar';
import KoreanAnime from '@/components/KoreanAnime';
import { requireAuth } from '@/lib/auth';
import { notFound } from 'next/navigation';

export default async function KoreanAnimePage({params, searchParams}: {
  params: Promise<{id: string}>; searchParams: Promise<{ep?: string}>;
}) {
  await requireAuth();
  const {id} = await params;
  if (!/^\d+$/.test(id) || Number(id) <= 0 || !Number.isSafeInteger(Number(id))) notFound();
  const {ep} = await searchParams;
  return <div className="min-h-screen bg-[#0b0f19] pb-16"><Navbar/><KoreanAnime animeNo={Number(id)} initialEpisode={ep === undefined ? undefined : Number(ep)}/></div>;
}
