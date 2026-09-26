import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');
const {createRoot}=await import('react-dom/client');
const {default:KoreanAnime}=await import('../src/components/KoreanAnime.tsx');
const settle=()=>new Promise(r=>setTimeout(r,10));
const anime={animeNo:3440,subject:'담배 고양이',originalSubject:'ヤニねこ',startDate:'2026-07-03'};
const subtitle={name:'번역자',episode:1,orig_filename:'1.vtt',is_ass:false,content:'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n안녕하세요\n\n2\n00:00:04.000 --> 00:00:05.000\n다음 대사\n'};
const blocked=()=>Response.json({code:'REANIME_UNAVAILABLE',baseUrl:'https://reanime.to',error:'Reanime HTTP 403'},{status:502});
async function mount({saved=false,status='subtitles_ready',dbFailure=false,detailResponse}={}) {
  const calls=[];let mapping=saved ? {reanimeId:'re_cat',episodeOffset:0} : null;
  const old=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    calls.push(String(url));
    if(String(url).includes('/api/anissia/mapping') && String(url).includes('search=1')) return blocked();
    if(url==='/api/anissia/mapping' && init.method==='POST') {
      const body=JSON.parse(init.body);mapping={reanimeId:body.reanimeId,episodeOffset:body.episodeOffset};return Response.json({mapping});
    }
    if(String(url).startsWith('/api/anissia/mapping')) return dbFailure ? Response.json({code:'DATABASE_ERROR',error:'DB 조회 실패'},{status:503}) : Response.json({mapping});
    if(String(url).startsWith('/api/anissia/reanime')) return detailResponse ? detailResponse(url) : blocked();
    if(String(url).startsWith('/api/anissia?')) return Response.json({anime,creators:[]});
    if(url==='/api/anissia/prepare') return Response.json({status,mapping,videoEpisode:1,subtitles:status==='subtitles_ready'?[subtitle]:[],creators:[]});
    if(String(url).includes('/api/v1/search')) return Response.json({results:[{anime_id:'cat',title:{english:'Chainsmoker Cat',native:'ヤニねこ'},season_year:2026}]});
    if(String(url).endsWith('/api/v1/anime/cat/episodes')) return Response.json({data:[{episode_number:1},{episode_number:2}]});
    if(String(url).endsWith('/api/v1/anime/cat')) return Response.json({anilist_id:207141,title:{english:'Chainsmoker Cat'}});
    if(String(url).startsWith('/api/anime/reanime-sync')) return Response.json({success:true,setting:null});
    throw new Error(`Unexpected request: ${url}`);
  };
  const container=document.getElementById('root');const root=createRoot(container);
  await React.act(async()=>{root.render(React.createElement(KoreanAnime,{animeNo:3440}));await settle();});
  const click=async text=>{const b=[...container.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(b,`Missing button: ${text}`);await React.act(async()=>{b.click();await settle();});};
  return {container,calls,click,cleanup:async()=>{await React.act(async()=>root.unmount());globalThis.fetch=old;}};
}
test('provider failures with simulated CORS-enabled responses preserve search, mapping and subtitle-before-stream ordering',async()=>{
  const ui=await mount();
  try {
    await ui.click('영상 찾기');
    assert.match(ui.container.textContent,/Chainsmoker Cat/);
    await ui.click('이 작품·시즌 연결');
    assert.match(ui.container.textContent,/작품 연결을 저장/);
    assert.equal(ui.calls.some(c=>c.includes('/api/flix/')),false);
    await ui.click('자막 확인 후 재생');
    assert.equal(ui.container.querySelector('iframe')?.src,'https://reanime.to/watch/cat?ep=1&anilist=207141&lang=sub');
    assert.ok(ui.calls.indexOf('/api/anissia/prepare')<ui.calls.findIndex(c=>c.includes('/api/anissia/reanime') && c.includes('episode=')));
    assert.equal(ui.calls.some(c=>c.includes('/api/flix/')),false);
    assert.match(ui.container.textContent,/번역자/);
    assert.equal(ui.container.querySelector('[title^="자막 첫 대사:"]')?.getAttribute('title'),'자막 첫 대사: "안녕하세요"');
  } finally {await ui.cleanup();}
});
test('a stored mapping restores its episodes through the same browser fallback',async()=>{
  const ui=await mount({saved:true});
  try {assert.equal(ui.container.querySelector('select')?.options.length,2);assert.match(ui.container.textContent,/Chainsmoker Cat/);}
  finally {await ui.cleanup();}
});
test('subtitle timeout never requests a server or browser stream',async()=>{
  const ui=await mount({saved:true,status:'timeout'});
  try {await ui.click('자막 확인 후 재생');assert.match(ui.container.textContent,/검색 시간이 초과/);assert.equal(ui.calls.some(c=>c.includes('episode=')||c.includes('/api/flix/')),false);assert.equal(ui.container.querySelector('iframe'),null);}
  finally {await ui.cleanup();}
});
test('mapping DB failure stays visible and does not request Reanime',async()=>{
  const ui=await mount({dbFailure:true});
  try {assert.match(ui.container.textContent,/DB 조회 실패/);assert.equal(ui.calls.some(c=>c.includes('/api/anissia/reanime')||c.startsWith('https://reanime.to')),false);}
  finally {await ui.cleanup();}
});
test('a pending stored-detail restore cannot race a new mapping selection',async()=>{
  let release;
  const ui=await mount({saved:true,detailResponse:()=>new Promise(r=>{release=r;})});
  try {
    const button=[...ui.container.querySelectorAll('button')].find(b=>b.textContent==='연결 변경');
    assert.equal(button.disabled,true);
    await React.act(async()=>{release(Response.json({detail:{id:'re_cat',anilistId:207141,title:'Cat',sub_episodes:[{number:1}]}}));await settle();});
    assert.equal(button.disabled,false);
  } finally {await ui.cleanup();}
});
test('a detail for another work cannot request subtitles or stream for a saved mapping',async()=>{
  const ui=await mount({saved:true,detailResponse:async()=>Response.json({detail:{id:'re_other',anilistId:111,title:'Other',sub_episodes:[{number:1}]}})});
  try {
    await ui.click('자막 확인 후 재생');
    assert.equal(ui.calls.includes('/api/anissia/prepare'),false);
    assert.match(ui.container.textContent,/작품.*일치/);
  } finally {await ui.cleanup();}
});
