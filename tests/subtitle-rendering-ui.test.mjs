import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/'});
globalThis.window=dom.window; globalThis.document=dom.window.document;
globalThis.HTMLElement=dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let size={width:1102,height:619};
let observers=[];
globalThis.ResizeObserver=class {
  constructor(cb){this.cb=cb;observers.push(this);}
  observe(){} disconnect(){observers=observers.filter(o=>o!==this);}
};
dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {...size,x:0,y:0,top:0,left:0,right:size.width,bottom:size.height};};
const React=await import('react');
const {createRoot}=await import('react-dom/client');
const {default:IframePlayer}=await import('../src/components/IframePlayer.tsx');
const {convertToVtt}=await import('../src/lib/subtitle-format.ts');
async function mount(sub) {
  const old=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({success:true,setting:null});
  const container=document.getElementById('root'), root=createRoot(container);
  const update=async sub=>React.act(async()=>root.render(React.createElement(IframePlayer,{animeId:'re_test',animeTitle:'테스트',episodeNumber:1,
    embedUrl:'https://player.example/video',initialSubtitles:sub?[sub]:[]})));
  await update(sub);
  return {container, update, async time(t){await React.act(async()=>window.dispatchEvent(new window.MessageEvent('message',{
    origin:'https://player.example',source:container.querySelector('iframe').contentWindow,data:{currentTime:t,duration:1000}})));},
    async cleanup(){await React.act(async()=>root.unmount());globalThis.fetch=old;delete window.SubtitlesOctopus;}};
}
test('converted SRT renders color, nested emphasis, entities and line breaks without exposing markup or active HTML',async()=>{
  const text='<font color="#ff0000" onclick="alert(1)"><b>빨강 &amp; <i>강조</i></b></font><br>다음 줄\n&lt;대사&gt;<img src="https://bad.example/pixel" onerror="alert(1)">';
  const ui=await mount({name:'테스트',is_ass:false,format:'VTT',content:convertToVtt(`1\n00:00:01,000 --> 00:00:03,000\n${text}\n`,'.srt').content});
  try {
    await ui.time(2);
    const hud=ui.container.querySelector('canvas').nextElementSibling.firstElementChild;
    assert.equal(hud.textContent,'빨강 & 강조\n다음 줄\n<대사>');
    assert.equal(hud.querySelector('span').style.color,'rgb(255, 0, 0)');
    assert.equal(hud.querySelector('b i').textContent,'강조');
    assert.equal(hud.querySelector('img,script,[onclick],[onerror]'),null);
    await ui.time(4); assert.equal(hud.style.display,'none');
  } finally {await ui.cleanup();}
});
test('ASS renderer receives display pixels at mount, resize, fullscreen and DPR change; observers stop on unmount',async()=>{
  // External WASM worker boundary: resize updates the real DOM canvas as libass does.
  let disposed=false;
  window.SubtitlesOctopus=class {
    constructor(options){this.canvas=options.canvas;}
    resize(w,h){assert.equal(disposed,false);this.canvas.width=w;this.canvas.height=h;}
    setCurrentTime(){} dispose(){disposed=true;}
  };
  window.devicePixelRatio=2;
  const ui=await mount({name:'테스트',is_ass:true,format:'ASS',content:'[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,한글 자막'});
  try {
    const canvas=ui.container.querySelector('canvas');
    assert.deepEqual([canvas.width,canvas.height],[2204,1238]);
    size={width:800,height:450};
    await React.act(async()=>observers.forEach(o=>o.cb([{contentRect:size}])));
    assert.deepEqual([canvas.width,canvas.height],[1600,900]);
    size={width:1920,height:1080};
    await React.act(async()=>document.dispatchEvent(new window.Event('fullscreenchange')));
    assert.deepEqual([canvas.width,canvas.height],[3840,2160]);
    window.devicePixelRatio=1;
    await React.act(async()=>window.dispatchEvent(new window.Event('resize')));
    assert.deepEqual([canvas.width,canvas.height],[1920,1080]);
  } finally {await ui.cleanup();}
  assert.equal(observers.length,0);
  window.dispatchEvent(new window.Event('resize'));
});

test('attaching and removing ASS after original playback retains the iframe and clears subtitle controls and canvas',async()=>{
  let disposed=0;
  window.SubtitlesOctopus=class {
    constructor(options){this.canvas=options.canvas;}
    resize(w,h){this.canvas.width=w;this.canvas.height=h;}
    setCurrentTime(){} dispose(){disposed++;}
  };
  const ui=await mount(null);
  try {
    const iframe=ui.container.querySelector('iframe'),canvas=ui.container.querySelector('canvas');
    assert.match(ui.container.textContent,/한글 자막 없음/);
    await ui.update({name:'늦게 추가한 ASS',is_ass:true,format:'ASS',content:'[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,한글 자막'});
    assert.equal(ui.container.querySelector('iframe'),iframe);
    assert.match(ui.container.textContent,/늦게 추가한 ASS|자막 ON/);
    assert.equal(canvas.style.visibility,'visible');
    await ui.update(null);
    assert.equal(ui.container.querySelector('iframe'),iframe);
    assert.equal(canvas.style.visibility,'hidden');
    assert.doesNotMatch(ui.container.textContent,/자막 ON|싱크 미세조절|첫 대사/);
    assert.equal(disposed,1);
    assert.equal(observers.length,0);
  } finally {await ui.cleanup();}
});
