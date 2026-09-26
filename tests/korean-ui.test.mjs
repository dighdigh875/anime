import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url:'http://localhost/'});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const {createRoot} = await import('react-dom/client');
const {default: KoreanAnime} = await import('../src/components/KoreanAnime.tsx');
const anime={animeNo:123,subject:'테스트 작품',originalSubject:'作品',startDate:'2026-01-01',genres:'판타지'};
const subtitle={name:'번역자',episode:1,orig_filename:'작품 1화.vtt',format:'VTT',is_ass:false,content:'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n안녕하세요\n'};
const settle=()=>new Promise(r=>setTimeout(r,10));
async function mount({offset=0,prepare}={}) {
  const container=document.getElementById('root');
  const mapping={reanimeId:'re_work',episodeOffset:offset};
  const detail={id:'re_work',title:'Work',poster:'',sub_episodes:[{number:1,title:'1화',watch_url:'https://example.com/1'}]};
  const original=globalThis.fetch;
  globalThis.fetch=async (url,init)=>{
    if(url==='/api/anissia/prepare') return prepare(JSON.parse(init.body));
    if(url.startsWith('/api/anissia/mapping')) return Response.json({mapping,detail});
    if(url.startsWith('/api/anissia?')) return Response.json({anime,creators:[]});
    if(url.startsWith('/api/anime/reanime-sync')) return Response.json({success:true,setting:null});
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const root=createRoot(container);
  await React.act(async()=>{root.render(React.createElement(KoreanAnime,{animeNo:123}));await settle();});
  return {container, detail, mapping, cleanup:async()=>{await React.act(async()=>root.unmount());globalThis.fetch=original;}};
}
test('restoring a single-episode movie mapping selects subtitle episode zero',async()=>{
  const ui=await mount({offset:1});
  try {
    const button=[...ui.container.querySelectorAll('button')].find(b=>b.textContent==='자막 확인 후 재생');
    assert.equal(ui.container.querySelector('select').value,'0');
    assert.equal(button.disabled,false);
  } finally {await ui.cleanup();}
});
test('a timeout displays its reason and never mounts the video iframe',async()=>{
  const ui=await mount({prepare:async()=>Response.json({status:'timeout',creators:[],subtitles:[]})});
  try {
    const button=[...ui.container.querySelectorAll('button')].find(b=>b.textContent==='자막 확인 후 재생');
    await React.act(async()=>{button.click();await settle();});
    assert.equal(ui.container.querySelector('iframe'),null);
    assert.match(ui.container.textContent,/검색 시간이 초과/);
  } finally {await ui.cleanup();}
});
test('video mounts after a ready response and receives the acquired subtitle',async()=>{
  let release;
  let input;
  const ui=await mount({prepare:body=>{input=body;return new Promise(r=>{release=r;});}});
  try {
    const button=[...ui.container.querySelectorAll('button')].find(b=>b.textContent==='자막 확인 후 재생');
    await React.act(async()=>{button.click();await settle();});
    assert.equal(ui.container.querySelector('iframe'),null);
    assert.equal(input.episode,1);
    await React.act(async()=>{release(Response.json({status:'ready',subtitles:[subtitle],creators:[],videoEpisode:1,stream:{embed_url:'https://player.example/embed'}}));await settle();});
    const iframe=ui.container.querySelector('iframe');
    assert.equal(iframe.src,'https://player.example/embed');
    assert.match(ui.container.textContent,/번역자/);
    await React.act(async()=>{window.dispatchEvent(new window.MessageEvent('message',{source:iframe.contentWindow,origin:'https://player.example',data:{currentTime:2,duration:30}}));await settle();});
    const hud=ui.container.querySelector('.font-black.text-white.text-center');
    assert.equal(hud.textContent,'안녕하세요');
  } finally {await ui.cleanup();}
});
