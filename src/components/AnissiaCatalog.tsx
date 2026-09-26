'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Subtitles, ArrowRight, RefreshCw } from 'lucide-react';
import type { AnissiaAnime } from '@/lib/anissia';

export default function AnissiaCatalog({query = ''}: {query?: string}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(query);
  const [week, setWeek] = useState(String(new Date(Date.now() + 9 * 3600000).getUTCDay()));
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<AnissiaAnime[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {setKeyword(query); setPage(0);}, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/anissia?q=${encodeURIComponent(query)}&week=${week}&page=${page}`, {signal: controller.signal})
      .then(async res => {const data = await res.json(); if (!res.ok) throw new Error(data.error); return data;})
      .then(data => {setItems(data.items); setHasNext(data.hasNext);})
      .catch(e => {if (!controller.signal.aborted) setError(e.message || '작품을 불러오지 못했습니다.');})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [query, week, page, retry]);
  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <div className="rounded-3xl border border-purple-500/25 bg-slate-900/70 p-6 sm:p-8">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-purple-300"><Subtitles size={18}/> 한글 자막으로 시작하기</p>
      <h1 className="text-2xl font-bold text-white sm:text-3xl">보고 싶은 작품을 한글로 찾아보세요</h1>
      <p className="mt-3 text-sm leading-6 text-slate-400">애니시아에서 작품을 고르고, 같은 시즌의 영상을 연결합니다. 회차의 한국어 자막 파일을 확인한 뒤 재생합니다.</p>
      <form className="mt-6 flex gap-2" onSubmit={e => {e.preventDefault();setPage(0);router.push(`/?tab=korean&q=${encodeURIComponent(keyword.trim())}`);}}>
        <input aria-label="한글 작품 검색" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="예: 책벌레의 하극상, 귀멸의 칼날" maxLength={120} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-sm text-white"/>
        <button className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-bold text-white"><Search size={16}/> 검색</button>
      </form>
      <div className="mt-5 flex flex-wrap gap-3 text-xs text-slate-400">
        <Link href="/?tab=history" className="hover:text-white">시청 기록</Link><Link href="/?tab=favorites" className="hover:text-white">즐겨찾기</Link>
        <Link href="/?tab=airing" className="hover:text-white">기존 영상 목록</Link>
        <a href="https://anissia.net" target="_blank" rel="noopener noreferrer" className="ml-auto hover:text-white">편성표 · 자막 정보: 애니시아 ↗</a>
      </div>
    </div>
    <div className="my-6 flex flex-wrap items-center gap-2">
      {query ? <><h2 className="mr-auto text-lg font-bold text-white">“{query}” 검색 결과</h2><Link href="/?tab=korean" className="text-sm text-purple-300">편성표로 돌아가기</Link></> :
        ['일','월','화','수','목','금','토','기타','신작'].map((label, i) => <button key={label} onClick={() => {setWeek(String(i));setPage(0);}} className={`rounded-xl px-4 py-2 text-sm ${week === String(i) ? 'bg-purple-600 font-bold text-white' : 'bg-slate-900 text-slate-400'}`}>{label}</button>)}
    </div>
    {loading ? <p role="status" className="py-16 text-center text-slate-400">작품을 불러오는 중입니다…</p> : error ?
      <div role="alert" className="rounded-2xl border border-rose-500/30 p-6 text-rose-300">{error}<button onClick={() => setRetry(v => v + 1)} className="ml-4 inline-flex items-center gap-1 text-sm"><RefreshCw size={14}/> 다시 시도</button></div> :
      items.length ? <div className="grid gap-3 sm:grid-cols-2">{items.map(item => <Link key={item.animeNo} href={`/korean/${item.animeNo}`} className="group rounded-2xl border border-white/10 bg-slate-900/60 p-5 transition hover:border-purple-500/60">
        <p className="text-xs text-purple-300">{item.startDate || '방영일 미정'}{!query && item.time ? ` · ${item.time}` : ''}{item.status === 'OFF' ? ' · 결방' : ''}</p>
        <h3 className="mt-2 font-bold leading-6 text-white">{item.subject}</h3><p className="mt-1 truncate text-xs text-slate-500">{item.originalSubject || '원제 미등록'}</p>
        <div className="mt-4 flex items-center justify-between gap-2 text-xs"><span className="text-slate-400">{item.genres}</span><span className="flex shrink-0 items-center gap-1 text-purple-300">작품 선택 <ArrowRight size={14}/></span></div>
      </Link>)}</div> : <p className="py-16 text-center text-slate-400">해당 조건의 작품이 없습니다. 다른 한글 제목으로 검색해 보세요.</p>}
    {query && !loading && !error && <div className="mt-6 flex justify-center gap-4"><button disabled={page === 0} onClick={() => setPage(v => v - 1)} className="text-sm text-purple-300 disabled:opacity-30">이전</button><span className="text-sm text-slate-400">{page + 1}</span><button disabled={!hasNext} onClick={() => setPage(v => v + 1)} className="text-sm text-purple-300 disabled:opacity-30">다음</button></div>}
  </main>;
}
