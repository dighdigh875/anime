const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {act} = React;
const {createRoot} = require('react-dom/client');
const {JSDOM} = require('jsdom');
const {loadTs} = require('./load-ts.cjs');
const dom = new JSDOM('<html><body></body></html>',{url:'https://app.example'});
global.window=dom.window; global.document=dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT=true;
const Link = ({href,children,...props})=>React.createElement('a',{href,...props},children);
const leaf = kind => props=>React.createElement('div',{'data-player':kind,'data-url':props.embedUrl||props.m3u8Url},props.animeTitle);
const icons=new Proxy({}, {get:()=>()=>null});
const stubs = {'next/link':Link,'lucide-react':icons,'./Player':leaf('hls'),'./IframePlayer':leaf('iframe')};
const Feed = loadTs('src/components/ReanimeFeed.tsx',stubs).default;
const Watch = loadTs('src/components/ReanimeWatch.tsx',stubs).default;
const json = (body,status=200)=>new Response(JSON.stringify(body),{status});
const raw={anime_id:'sample-ab1234',anilist_id:21,title:{english:'Sample'},cover_image:{},genres:[]};
const detail={id:'re_sample-ab1234',title:'Sample',poster:'',anilist_id:21,sub_episodes:[{number:3,title:'Third',watch_url:'https://reanime.to/watch/sample-ab1234?ep=3&anilist=21'}],dub_episodes:[]};
async function mount(Component,props,run) {
  const div=document.createElement('div');document.body.appendChild(div);
  const root=createRoot(div);
  try {await act(async()=>{root.render(React.createElement(Component,props));});await run(div);}
  finally {await act(async()=>root.unmount());div.remove();}
}
test('server failure recovers a visible feed through the browser request', async()=>{
  global.fetch=async()=>json({latest_aired:[raw]});
  await mount(Feed,{baseUrl:'https://reanime.to',params:{},initialData:null},async div=>{
    assert.match(div.textContent,/Sample/);
    assert.equal(div.querySelector('a').getAttribute('href'),'/anime/re_sample-ab1234');
  });
});
test('browser failure displays retry rather than an empty catalogue; retry recovers',async()=>{
  global.fetch=async()=>json({},403);
  await mount(Feed,{baseUrl:'https://reanime.to',params:{},initialData:null},async div=>{
    assert.match(div.textContent,/HTTP 403/);
    assert.doesNotMatch(div.textContent,/검색된 작품이 없습니다/);
    global.fetch=async()=>json({items:[{id:'re_sample-ab1234',title:'Recovered',poster:'',remarks:''}],page:1,total_pages:1,has_next:false});
    await act(async()=>div.querySelector('button').click());
    assert.match(div.textContent,/Recovered/);
  });
});
test('browser detail fallback still uses the authenticated server for Flix, renders iframe',async()=>{
  global.fetch=async url=>{
    if(String(url).startsWith('/api/anime/detail')) return json({},502);
    if(String(url).startsWith('/api/anime/reanime-stream')) return json({success:true,stream_type:'iframe',embed_url:'https://video.example/embed',m3u8_url:''});
    return json(new URL(url).pathname.endsWith('/episodes')?{data:[{episode_number:3,subbed:true,playable:true}]}:raw);
  };
  await mount(Watch,{baseUrl:'https://reanime.to',id:detail.id,ep:3,isDub:false,initialAnime:null,initialStream:null},async div=>{
    assert.equal(div.querySelector('[data-player]').dataset.player,'iframe');
    assert.equal(div.querySelector('[data-player]').dataset.url,'https://video.example/embed');
  });
});
test('missing episode never starts the first episode',async()=>{
  global.fetch=async()=>{throw new Error('Unexpected playback request');};
  await mount(Watch,{baseUrl:'https://reanime.to',id:detail.id,ep:99,isDub:false,initialAnime:detail,initialStream:null},async div=>{
    assert.match(div.textContent,/선택한 회차/);
    assert.equal(div.querySelector('[data-player]'),null);
  });
});
test('iframe accepts timing only from its own origin and frame',async()=>{
  const Iframe=loadTs('src/components/IframePlayer.tsx',{'next/link':Link,'lucide-react':icons,'./SubtitleSelectModal':()=>null}).default;
  global.fetch=async()=>json({success:true,setting:null,subtitles:[],creators:[]});
  await mount(Iframe,{animeId:detail.id,animeTitle:'Sample',episodeNumber:3,embedUrl:'https://video.example/embed',initialSubtitles:[],isDub:true,linkNextEp:4},async div=>{
    const frame=div.querySelector('iframe');
    const send = (origin,source,time)=>window.dispatchEvent(new window.MessageEvent('message',{origin,source,data:{currentTime:time,duration:120}}));
    await act(async()=>send('https://evil.example',frame.contentWindow,51));
    assert.doesNotMatch(div.textContent,/00:51/);
    await act(async()=>send('https://video.example',window,51));
    assert.doesNotMatch(div.textContent,/00:51/);
    await act(async()=>send('https://video.example',frame.contentWindow,31));
    assert.match(div.textContent,/00:31/);
    assert.equal([...div.querySelectorAll('a')].find(a=>a.textContent.includes('다음화')).getAttribute('href'),'/watch/re_sample-ab1234/4?dub=1');
    assert.doesNotMatch(div.textContent,/자막 연동 중/);
  });
});
test('iframe resumes unfinished history and writes progress using the current API contract',async()=>{
  const Iframe=loadTs('src/components/IframePlayer.tsx',{'next/link':Link,'lucide-react':icons,'./SubtitleSelectModal':()=>null}).default;
  const writes=[];
  global.fetch=async(url,init)=>{
    if(String(url).startsWith('/api/anime/history') && !init?.method) return json({success:true,items:[{episode_number:3,watch_time:45,duration:120,is_completed:false}]});
    if(init?.method==='POST') writes.push(JSON.parse(init.body));
    return json({success:true,setting:null,subtitles:[],creators:[]});
  };
  await mount(Iframe,{animeId:detail.id,animeTitle:'Sample',episodeNumber:3,embedUrl:'https://video.example/embed',initialSubtitles:[]},async div=>{
    const frame=div.querySelector('iframe');const commands=[];
    frame.contentWindow.postMessage=(body,origin)=>commands.push({body,origin});
    const tick=time=>window.dispatchEvent(new window.MessageEvent('message',{origin:'https://video.example',source:frame.contentWindow,data:{currentTime:time,duration:120}}));
    await act(async()=>tick(0));
    assert.deepEqual(commands.find(c=>c.body.command==='seek'),{body:{command:'seek',value:45},origin:'https://video.example'});
    await act(async()=>tick(46));
    const saved=writes.find(w=>w.animeId===detail.id);
    assert.equal(saved.episodeNumber,3);
    assert.equal(saved.currentTime,46);
    assert.equal(saved.watchUrl,'/watch/re_sample-ab1234/3');
  });
});
