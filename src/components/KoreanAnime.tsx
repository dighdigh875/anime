'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Play, Search, Subtitles } from 'lucide-react';
import IframePlayer from './IframePlayer';
import SubtitleSelectModal, { type CreatorInfo, type SubtitleOption } from './SubtitleSelectModal';
import type { AnissiaAnime } from '@/lib/anissia';
import type { AnimeMapping } from '@/lib/anime-mapping';
import type { ReanimeCandidate } from '@/lib/korean-playback';
import type { ReanimeDetail } from '@/lib/reanime-api';
import {searchKoreanReanime, loadKoreanReanimeDetail, loadKoreanReanimeStream} from '@/lib/korean-reanime-client';
import {validateKoreanSubtitle} from '@/lib/korean-playback';
import {ReanimeBridgeError} from '@/lib/reanime-browser-bridge';
import ReanimeConnectionHelp from './ReanimeConnectionHelp';

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

const statusText: Record<string, string> = {
  not_found: '이번 회차의 한국어 자막 파일을 확보하지 못했습니다. 한글 자막 없이 재생하거나 자막 파일을 직접 선택할 수 있습니다.',
  timeout: '자막 검색 시간이 초과되었습니다. 자막이 없는 것으로 확정된 것은 아닙니다. 다시 시도하거나 직접 선택해 주세요.',
  error: '자막 정보를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  episode_missing: '연결된 영상에 이 회차가 없습니다. 작품·시즌과 회차 차이를 확인해 주세요.',
  stream_error: '자막은 확인했지만 영상 주소를 가져오지 못했습니다. 다시 시도해 주세요.',
};

export default function KoreanAnime({animeNo, initialEpisode}: {animeNo: number; initialEpisode?: number}) {
  const [anime, setAnime] = useState<AnissiaAnime | null>(null);
  const [creators, setCreators] = useState<CreatorInfo[]>([]);
  const [mapping, setMapping] = useState<AnimeMapping | null>(null);
  const [detail, setDetail] = useState<ReanimeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [candidates, setCandidates] = useState<ReanimeCandidate[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [offset, setOffset] = useState(0);
  const [episode, setEpisode] = useState(initialEpisode ?? 1);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [needsBridge, setNeedsBridge] = useState(false);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);

  const resetPlayback = () => {generation.current++; activeRequest.current?.abort(); setPrepared(null); setNotice(''); setBusy(false); setNeedsBridge(false);};
  useEffect(() => {
    const controller = new AbortController();
    resetPlayback(); searchRequest.current?.abort(); setSearching(false);
    const token = generation.current;
    setLoading(true); setError(''); setCandidates([]); setMapping(null); setDetail(null); setAnime(null);
    Promise.allSettled([
      jsonRequest(`/api/anissia?id=${animeNo}`, {signal: controller.signal}),
      jsonRequest(`/api/anissia/mapping?id=${animeNo}`, {signal: controller.signal}),
    ]).then(async ([a, m]) => {
      if (controller.signal.aborted) return;
      if (a.status === 'fulfilled') {
        setAnime(a.value.anime); setCreators(a.value.creators); setQuery(a.value.anime.originalSubject || a.value.anime.subject);
        if (a.value.captionsUnavailable) setNotice('자막 제작자 목록을 불러오지 못했습니다. 재생 준비 시 다시 확인합니다.');
      } else setError(a.reason.message);
      if (m.status === 'fulfilled') {
        setMapping(m.value.mapping); setOffset(m.value.mapping?.episodeOffset || 0); setShowMapping(!m.value.mapping);
        if (m.value.mapping) {
          try {
            const restored = m.value.detail || await loadKoreanReanimeDetail(m.value.mapping.reanimeId, controller.signal);
            if (controller.signal.aborted || token !== generation.current) return;
            setDetail(restored);
            const available = restored.sub_episodes.map((e: any) => e.number - m.value.mapping.episodeOffset).filter((n: number) => n >= 0).sort((a: number,b: number) => a-b);
            setEpisode(current => available.includes(current) ? current : (available[0] ?? current));
          } catch (e: any) {
            if (controller.signal.aborted) return;
            setError(e.message); setShowMapping(true);
          }
        }
      } else {setShowMapping(true); setError(m.reason.message);}
      setLoading(false);
    });
    return () => {controller.abort(); activeRequest.current?.abort(); searchRequest.current?.abort(); generation.current++;};
  }, [animeNo, reload]);

  const search = async () => {
    if (!anime || loading || busy) return;
    searchRequest.current?.abort();
    const controller = new AbortController(); searchRequest.current = controller;
    setSearching(true); setError(''); setNotice(''); setCandidates([]);
    try {
      const data = await searchKoreanReanime(anime, query.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setCandidates(data.candidates);
      if (!data.candidates.length) setNotice('영상 검색 결과가 없습니다. 영어 또는 로마자 제목으로도 검색해 보세요.');
    } catch (e: any) {if (!controller.signal.aborted) setError(e.message);}
    finally {if (!controller.signal.aborted) setSearching(false);}
  };
  const connect = async (id: string) => {
    if (loading || busy) return;
    resetPlayback(); setBusy(true); setError('');
    const token = generation.current;
    const controller = new AbortController(); activeRequest.current = controller;
    try {
      const selected = await loadKoreanReanimeDetail(id, controller.signal);
      controller.signal.throwIfAborted();
      const data = await jsonRequest('/api/anissia/mapping', {method: 'POST', signal: controller.signal, headers: {'Content-Type':'application/json'}, body: JSON.stringify({animeNo, reanimeId:id, episodeOffset:offset})});
      if (token !== generation.current) return;
      setMapping(data.mapping); setDetail(selected); setShowMapping(false);
      const numbers = selected.sub_episodes.map((e: any) => e.number - offset).filter((n: number) => n >= 0).sort((a: number,b: number) => a-b);
      if (!numbers.includes(episode) && numbers.length) setEpisode(numbers[0]);
      setNotice('작품 연결을 저장했습니다. 이제 회차를 선택해 주세요.');
    } catch (e: any) {if (!controller.signal.aborted) {setError(e.message); setNotice('');}}
    finally {if (token === generation.current) setBusy(false);}
  };
  const prepare = async (manualSubtitle?: SubtitleOption, withoutKorean = false) => {
    if (!mapping || !detail || loading || busy) return;
    // Keep the current iframe mounted while looking for subtitles for this episode.
    activeRequest.current?.abort();
    const token = ++generation.current;
    setBusy(true); setError(''); setNotice(''); setModalOpen(false); setNeedsBridge(false);
    const controller = new AbortController(); activeRequest.current = controller;
    try {
      if (detail.id !== mapping.reanimeId) throw new Error('영상 작품과 저장된 연결이 일치하지 않습니다. 다시 불러와 주세요.');
      const videoEpisode = episode + mapping.episodeOffset;
      if (!detail.sub_episodes.some(e => e.number === videoEpisode)) {setNotice(statusText.episode_missing); return;}
      const existingStream = prepared?.videoEpisode === videoEpisode ? prepared.stream : undefined;
      if (withoutKorean) {
        const stream = existingStream || await loadKoreanReanimeStream(detail, videoEpisode, controller.signal);
        if (token !== generation.current) return;
        // An explicit empty list also prevents IframePlayer from auto-fetching subtitles.
        setPrepared({status: 'ready', stream, videoEpisode, subtitles: []});
        setNotice('한글 자막 없이 재생합니다. 원본 자막은 영상 플레이어에서 선택할 수 있으며, 제공되지 않는 회차는 자막 없이 재생됩니다.');
        return;
      }
      const data = await jsonRequest('/api/anissia/prepare', {method:'POST', signal:controller.signal, headers:{'Content-Type':'application/json'}, body:JSON.stringify({animeNo,episode,...mapping,manualSubtitle})});
      if (token !== generation.current) return;
      if (data.creators?.length) setCreators(data.creators);
      if (data.status === 'subtitles_ready') {
        if (data.mapping?.reanimeId !== mapping.reanimeId || data.mapping?.episodeOffset !== mapping.episodeOffset || data.videoEpisode !== videoEpisode) {
          throw new Error('작품 연결이 변경되었습니다. 다시 불러온 뒤 시도해 주세요.');
        }
        if (!data.subtitles?.some((s: any) => s.episode === episode && validateKoreanSubtitle(s))) throw new Error('한국어 자막 검증 결과를 확인하지 못했습니다.');
        setNotice('한국어 자막을 확인했습니다. 영상에 연결하는 중입니다…');
        const stream = existingStream || await loadKoreanReanimeStream(detail, videoEpisode, controller.signal);
        if (token !== generation.current) return;
        setPrepared({...data, status: 'ready', stream}); setNotice('한국어 자막 파일을 확인했습니다. 재생을 시작할 수 있습니다.');
      }
      else if (data.status === 'ready') {setPrepared({...data, stream: existingStream || data.stream}); setNotice('한국어 자막 파일을 확인했습니다. 재생을 시작할 수 있습니다.');}
      else setNotice(statusText[data.status] || '재생을 준비하지 못했습니다.');
    } catch (e: any) {if (!controller.signal.aborted) {setError(e.message); setNotice(''); setNeedsBridge(e instanceof ReanimeBridgeError && e.code === 'NOT_INSTALLED');}}
    finally {if (token === generation.current) setBusy(false);}
  };
  const episodes = detail ? [...new Set(detail.sub_episodes.map(e => e.number - (mapping?.episodeOffset || 0)).filter(n => n >= 0))].sort((a,b) => a-b) : [];

  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
    <Link href="/?tab=korean" className="inline-flex items-center gap-2 text-sm text-purple-300"><ArrowLeft size={16}/> 한글 작품 목록</Link>
    {loading && <p role="status" className="py-12 text-slate-400">작품과 저장된 연결을 불러오는 중입니다…</p>}
    {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-300">{error}<button className="ml-3 underline" disabled={busy || loading} onClick={() => {resetPlayback();setReload(v=>v+1);}}>다시 불러오기</button></div>}
    {anime && <>
      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
        <p className="text-xs font-semibold text-purple-300">1. 한글 작품 선택 완료 · {anime.startDate || '방영일 미정'}</p>
        <h1 className="mt-2 text-2xl font-bold text-white">{anime.subject}</h1><p className="mt-2 text-sm text-slate-400">{anime.originalSubject}</p>
        <p className="mt-4 text-xs text-slate-500">제작자의 등록 회차는 최신 게시물 정보입니다. 이전 회차의 자막은 재생 준비 단계에서 따로 확인합니다.</p>
        <div className="mt-3 flex flex-wrap gap-2">{creators.map((c,i) => <span key={`${c.name}-${i}`} className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300">{c.name} · {c.episode === '0' ? '단편' : `${c.episode}화`} {/^https?:\/\//.test(c.website) ? <a className="ml-2 text-purple-300" href={c.website} target="_blank" rel="noopener noreferrer">게시물 ↗</a> : '· 준비 중'}</span>)}</div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold text-white">2. 같은 작품·시즌의 영상 연결</h2>{mapping && <button disabled={busy || loading} onClick={() => {resetPlayback();setShowMapping(v=>!v);}} className="text-xs text-purple-300">{showMapping ? '닫기' : '연결 변경'}</button>}</div>
        {mapping && <p className="mt-3 flex items-center gap-2 text-sm text-emerald-300"><Check size={16}/>{detail?.title || mapping.reanimeId} · 영상 회차 = 자막 회차 {mapping.episodeOffset >= 0 ? '+' : ''}{mapping.episodeOffset}</p>}
        {showMapping && <div className="mt-4 space-y-4">
          <p className="text-sm leading-6 text-slate-400">원제·방영 연도와 시즌을 확인한 뒤 연결하세요. 선택한 연결은 내 계정에 저장됩니다.</p>
          <form onSubmit={e=>{e.preventDefault();void search();}} className="flex gap-2"><input aria-label="Reanime 작품 검색" value={query} maxLength={120} onChange={e=>setQuery(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white"/><button disabled={searching || busy || loading || !query.trim()} className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-40"><Search size={14}/>{searching ? '검색 중…' : '영상 찾기'}</button></form>
          <label className="flex flex-wrap items-center gap-3 text-sm text-slate-300">회차 차이 <input aria-label="회차 차이" type="number" step="1" min="-5000" max="5000" value={offset} onChange={e=>setOffset(Number(e.target.value))} className="w-24 rounded-lg border border-white/15 bg-slate-950 px-3 py-2"/><span className="text-xs text-slate-500">보통 0 · 자막 1화가 영상 13화라면 12</span></label>
          {mapping && <button disabled={busy || loading} onClick={()=>void connect(mapping.reanimeId)} className="text-sm text-purple-300">현재 작품의 회차 차이 저장</button>}
          <div className="grid gap-3 sm:grid-cols-2">{candidates.map(c => <div key={c.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            {c.exactMatch && <p className="mb-2 text-xs text-emerald-300">원제·방영 연도 일치</p>}<h3 className="text-sm font-semibold text-white">{c.title}</h3><p className="mt-1 text-xs text-slate-400">{c.nativeTitle}</p><p className="mt-2 text-xs text-slate-500">{c.year || '연도 미등록'} · {c.format || '형식 미등록'}</p>
            <button disabled={busy || loading || !Number.isInteger(offset)} onClick={()=>void connect(c.id)} className="mt-4 rounded-lg bg-purple-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy ? '저장 중…' : '이 작품·시즌 연결'}</button>
          </div>)}</div>
          {notice && <p role="status" className="text-sm text-slate-300">{notice}</p>}
        </div>}
      </section>
      {mapping && detail && !showMapping && <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
        <h2 className="font-bold text-white">3. 회차 선택 및 재생</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3"><label className="text-sm text-slate-300">자막 회차 <select aria-label="자막 회차" value={episode} disabled={busy || loading} onChange={e=>{resetPlayback();setEpisode(Number(e.target.value));}} className="ml-2 rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-white">{episodes.map(n=><option key={n} value={n}>{n === 0 ? '단편 (0)' : `${n}화`}</option>)}</select></label>
          <button disabled={busy || loading || !episodes.includes(episode)} onClick={()=>void prepare()} className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Play size={15}/>{busy ? '준비 중…' : prepared ? '한글 자막 다시 검색' : '자막 확인 후 재생'}</button>
          {!prepared && <button disabled={busy || loading || !episodes.includes(episode)} onClick={()=>void prepare(undefined, true)} className="flex items-center gap-2 rounded-xl border border-white/15 bg-slate-800 px-4 py-2.5 text-sm font-bold text-slate-200 disabled:opacity-40"><Play size={15}/>한글 자막 없이 재생</button>}
          <button disabled={busy || loading} onClick={()=>setModalOpen(true)} className="flex items-center gap-2 text-sm text-purple-300"><Subtitles size={16}/> 자막 직접 선택</button>
        </div>
        {!episodes.length && <p className="mt-3 text-sm text-amber-300">연결된 작품에 선택할 수 있는 영상 회차가 없습니다.</p>}
        {notice && <p role="status" className="mt-4 text-sm leading-6 text-slate-300">{notice}</p>}
      </section>}
      {needsBridge && <ReanimeConnectionHelp/>}
      {prepared && <IframePlayer key={`${animeNo}-${episode}-${prepared.videoEpisode}`} animeId={mapping!.reanimeId} animeTitle={anime.subject} animePoster={detail?.poster} episodeNumber={prepared.videoEpisode}
        initialEpTitle={episode === 0 ? '단편' : `${episode}화`} embedUrl={prepared.stream.embed_url || prepared.stream.player_url}
        allowNestedPlayback={prepared.stream.reanime_watch_page}
        subtitleSelectionDisabled={busy}
        initialSubtitles={prepared.subtitles} initialCreators={creators} subtitleEpisodeNumber={episode} watchPageUrl={`/korean/${animeNo}?ep=${episode}`} backUrl={`/?tab=korean`}/>}
      <SubtitleSelectModal isOpen={modalOpen} onClose={()=>setModalOpen(false)} animeId={mapping?.reanimeId || ''} animeTitle={anime.subject} episodeNumber={episode} creators={creators} onSelectSubtitle={sub=>void prepare(sub)}/>
    </>}
  </main>;
}
