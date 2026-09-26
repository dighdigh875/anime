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
async function mount({saved=false,status='subtitles_ready',dbFailure=false,detailResponse,offset=0,prepareResponse}={}) {
  const calls=[];let mapping=saved ? {reanimeId:'re_cat',episodeOffset:offset} : null;
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
    if(url==='/api/anissia/prepare') return prepareResponse ? prepareResponse(JSON.parse(init.body)) : Response.json({status,mapping,videoEpisode:1,subtitles:status==='subtitles_ready'?[subtitle]:[],creators:[]});
    if(String(url).includes('/api/v1/search')) return Response.json({results:[{anime_id:'cat',title:{english:'Chainsmoker Cat',native:'ヤニねこ'},season_year:2026}]});
    if(String(url).endsWith('/api/v1/anime/cat/episodes')) return Response.json({data:[{episode_number:1},{episode_number:2}]});
    if(String(url).endsWith('/api/v1/anime/cat')) return Response.json({anilist_id:207141,title:{english:'Chainsmoker Cat'}});
    if(String(url).startsWith('/api/anime/reanime-sync')) return Response.json({success:true,setting:null});
    throw new Error(`Unexpected request: ${url}`);
  };
  const container=document.getElementById('root');const root=createRoot(container);
  await React.act(async()=>{root.render(React.createElement(KoreanAnime,{animeNo:3440}));await settle();});
  const click=async text=>{const b=[...container.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(b,`Missing button: ${text}`);await React.act(async()=>{b.click();await settle();});};
  return {container,calls,click,render:async animeNo=>{await React.act(async()=>{root.render(React.createElement(KoreanAnime,{animeNo}));await settle();});},cleanup:async()=>{await React.act(async()=>root.unmount());globalThis.fetch=old;}};
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
    await ui.click('한글 자막 없이 재생');
    assert.equal(ui.calls.some(c=>c.includes('episode=')),false);
  } finally {await ui.cleanup();}
});

test('explicit playback without Korean subtitles skips subtitle acquisition and uses the mapped episode',async()=>{
  const ui=await mount({saved:true,offset:1});
  try {
    assert.equal(ui.container.querySelector('iframe'),null);
    await ui.click('한글 자막 없이 재생');
    assert.equal(ui.container.querySelector('iframe')?.src,'https://reanime.to/watch/cat?ep=2&anilist=207141&lang=sub');
    assert.equal(ui.calls.some(c=>c.includes('/prepare')||c.includes('/subtitles')),false);
    assert.match(ui.container.textContent,/한글 자막 없음/);
    assert.doesNotMatch(ui.container.textContent,/자막 연동 중|자막 ON|싱크 미세조절/);
    assert.ok([...ui.container.querySelectorAll('button')].some(b=>b.textContent.trim()==='전체화면'));
  } finally {await ui.cleanup();}
});

for (const status of ['not_found','timeout','error']) {
  test(`${status} does not auto-play but allows an explicit original-player choice`,async()=>{
    const ui=await mount({saved:true,status});
    try {
      await ui.click('자막 확인 후 재생');
      assert.equal(ui.container.querySelector('iframe'),null);
      assert.equal(ui.calls.some(c=>c.includes('episode=')),false);
      await ui.click('한글 자막 없이 재생');
      assert.ok(ui.container.querySelector('iframe'));
      assert.equal(ui.calls.filter(c=>c==='/api/anissia/prepare').length,1);
    } finally {await ui.cleanup();}
  });
}

test('retrying Korean subtitles keeps the playing iframe during lookup, failure and successful attachment',async()=>{
  let release;
  const ui=await mount({saved:true,prepareResponse:()=>new Promise(r=>{release=r;})});
  try {
    await ui.click('한글 자막 없이 재생');
    const iframe=ui.container.querySelector('iframe');
    await ui.click('한글 자막 다시 검색');
    assert.equal(ui.container.querySelector('iframe'),iframe);
    const picker=[...ui.container.querySelectorAll('button')].find(b=>b.textContent.trim()==='자막 변경 / 검색');
    assert.equal(picker.disabled,true,'manual selection must not race an older automatic retry');
    await ui.click('자막 변경 / 검색');
    assert.doesNotMatch(document.body.textContent,/자막 선택 및 수동 검색/);
    await React.act(async()=>{release(Response.json({status:'not_found'}));await settle();});
    assert.equal(ui.container.querySelector('iframe'),iframe);
    assert.equal(picker.disabled,false);
    await ui.click('한글 자막 다시 검색');
    await React.act(async()=>{release(Response.json({status:'subtitles_ready',mapping:{reanimeId:'re_cat',episodeOffset:0},videoEpisode:1,subtitles:[subtitle]}));await settle();});
    assert.equal(ui.container.querySelector('iframe'),iframe);
    assert.equal(ui.calls.filter(c=>c.includes('episode=')).length,1);
    assert.match(ui.container.textContent,/번역자/);
    assert.match(ui.container.textContent,/자막 ON/);
    await React.act(async()=>window.dispatchEvent(new window.MessageEvent('message',{source:iframe.contentWindow,origin:'https://reanime.to',data:{currentTime:2,duration:600}})));
    assert.equal(ui.container.querySelector('.font-black.text-white.text-center').textContent,'안녕하세요');
  } finally {await ui.cleanup();}
});

test('switching episodes removes original-player playback before preparing the next episode',async()=>{
  const ui=await mount({saved:true});
  try {
    await ui.click('한글 자막 없이 재생');
    const select=ui.container.querySelector('select');
    await React.act(async()=>{select.value='2';select.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();});
    assert.equal(ui.container.querySelector('iframe'),null);
    await ui.click('한글 자막 없이 재생');
    assert.match(ui.container.querySelector('iframe').src,/ep=2&/);
  } finally {await ui.cleanup();}
});

test('a delayed original-player response cannot mount after navigating to another work',async()=>{
  let release;
  const ui=await mount({saved:true,detailResponse:url=>url.includes('episode=') ? new Promise(r=>{release=r;}) : blocked()});
  try {
    await ui.click('한글 자막 없이 재생');
    await ui.render(3441);
    await React.act(async()=>{release(blocked());await settle();});
    assert.equal(ui.container.querySelector('iframe'),null);
  } finally {await ui.cleanup();}
});

test('original playback still rejects authentication failures and never mounts a fallback iframe',async()=>{
  const ui=await mount({saved:true,detailResponse:url=>url.includes('episode=') ? Response.json({error:'로그인이 필요합니다.'},{status:401}) : blocked()});
  try {
    await ui.click('한글 자막 없이 재생');
    assert.equal(ui.container.querySelector('iframe'),null);
    assert.match(ui.container.textContent,/로그인이 필요/);
  } finally {await ui.cleanup();}
});

test('both playback choices stay disabled when the mapped work has no available episodes',async()=>{
  const ui=await mount({saved:true,detailResponse:()=>Response.json({detail:{id:'re_cat',title:'Cat',sub_episodes:[]}})});
  try {
    for (const name of ['자막 확인 후 재생','한글 자막 없이 재생']) {
      const button=[...ui.container.querySelectorAll('button')].find(b=>b.textContent===name);
      assert.equal(button.disabled,true);
      await ui.click(name);
    }
    assert.equal(ui.container.querySelector('iframe'),null);
    assert.equal(ui.calls.some(c=>c.includes('episode=')||c.includes('/prepare')),false);
  } finally {await ui.cleanup();}
});
