'use client';

import {useEffect, useState, type CSSProperties, type RefObject} from 'react';

// Reanime's watch page below its 1024px sidebar breakpoint (observed HTML/CSS).
// 64px header + 16px margin + 16.5px breadcrumb + 10px gap; 8px side padding.
// These are a starting preset, not runtime measurements of the remote document.
const FRAME_WIDTH = 960;
const VIDEO_WIDTH = FRAME_WIDTH - 16;
const VIDEO_TOP = 106.5;
const DEFAULT_ADJUSTMENT = {zoom: 1, x: 0, y: 0};

export function useReanimeViewport(enabled: boolean, surface: RefObject<HTMLDivElement | null>) {
  const [cropped, setCropped] = useState(true);
  const [editing, setEditing] = useState(false);
  const [width, setWidth] = useState(0);
  const [adjustment, setAdjustment] = useState(DEFAULT_ADJUSTMENT);

  useEffect(() => {
    const element = surface.current;
    if (!enabled || !element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, surface]);

  const scale = width / VIDEO_WIDTH * adjustment.zoom;
  const style: CSSProperties | undefined = enabled && cropped ? {
    width: FRAME_WIDTH,
    height: 900,
    maxWidth: 'none',
    left: (width - VIDEO_WIDTH * scale) / 2 - 8 * scale + adjustment.x * scale,
    top: (width * 9 / 16 - VIDEO_WIDTH * 9 / 16 * scale) / 2 - VIDEO_TOP * scale + adjustment.y * scale,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    visibility: width > 0 ? 'visible' : 'hidden',
  } : undefined;

  const move = (x: number, y: number) => setAdjustment(a => ({...a,
    x: Math.max(-240, Math.min(240, a.x + x)), y: Math.max(-240, Math.min(240, a.y + y))}));
  const zoom = (delta: number) => setAdjustment(a => ({...a,
    zoom: Math.max(0.8, Math.min(1.6, Math.round((a.zoom + delta) * 100) / 100))}));

  return {enabled, cropped, setCropped, editing, setEditing, adjustment, move, zoom, style,
    reset: () => setAdjustment(DEFAULT_ADJUSTMENT)};
}

export function ReanimeViewportControls({viewport: v}: {viewport: ReturnType<typeof useReanimeViewport>}) {
  if (!v.enabled) return null;
  const button = 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400';
  return <div className="space-y-2 text-sm text-slate-300">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="영상 표시 방식">
      <button type="button" aria-pressed={v.cropped} onClick={() => v.setCropped(true)} className={`${button} ${v.cropped ? 'bg-purple-600' : ''}`}>영상만 보기</button>
      <button type="button" aria-pressed={!v.cropped} onClick={() => v.setCropped(false)} className={`${button} ${!v.cropped ? 'bg-purple-600' : ''}`}>원본 화면</button>
      {v.cropped && <button type="button" aria-expanded={v.editing} onClick={() => v.setEditing(!v.editing)} className={button}>화면 조절</button>}
    </div>
    {v.cropped && v.editing && <div className="space-y-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="영상 축소" onClick={() => v.zoom(-0.05)} className={button}>−</button>
        <output aria-label="영상 배율" className="min-w-12 text-center tabular-nums">{Math.round(v.adjustment.zoom * 100)}%</output>
        <button type="button" aria-label="영상 확대" onClick={() => v.zoom(0.05)} className={button}>＋</button>
        <button type="button" aria-label="화면 왼쪽으로" onClick={() => v.move(-8, 0)} className={button}>←</button>
        <button type="button" aria-label="화면 위로" onClick={() => v.move(0, -8)} className={button}>↑</button>
        <button type="button" aria-label="화면 아래로" onClick={() => v.move(0, 8)} className={button}>↓</button>
        <button type="button" aria-label="화면 오른쪽으로" onClick={() => v.move(8, 0)} className={button}>→</button>
        <button type="button" onClick={v.reset} className={button}>화면 위치 초기화</button>
      </div>
      <p className="text-xs leading-5 text-slate-400">영상 테두리나 버튼이 잘리면 배율과 위치를 맞춰 주세요. 원본 화면을 스크롤했다면 맨 위로 올린 뒤 ‘영상만 보기’를 선택해 주세요.</p>
    </div>}
    <p className="text-xs leading-5 text-slate-400">재생 서버와 Auto Next는 ‘원본 화면’에서 조절할 수 있습니다. Auto Next는 끄고, 회차는 위의 ‘자막 회차’에서 변경해 주세요. 한글 자막 전체화면은 아래 버튼을 사용해 주세요.</p>
  </div>;
}
