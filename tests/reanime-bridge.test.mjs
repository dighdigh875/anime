import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import AdmZip from 'adm-zip';
import {resolveStream} from '../extensions/reanime-bridge/background.mjs';
import {requestReanimeBrowserStream} from '../src/lib/reanime-browser-bridge.ts';

const request={type:'ANIHUB_REANIME_STREAM_V1',anilistId:178789,episode:14};
const sender={url:'https://anime-eight-virid.vercel.app/korean/3005'};
const validServer={serverName:'HD-1',dataType:'sub',dataLink:'https://flixcloud.cc/e/huud4iw09tf6?v=1'};

test('extension requests only fixed public metadata, omits credentials and strips unrelated response fields',async()=>{
  let call;
  const response=await resolveStream(request,sender,async(url,init)=>{
    call={url,init};
    return Response.json({token:'must-not-forward',servers:[{...validServer,cookie:'must-not-forward'}]});
  });
  assert.equal(call.url,'https://reanime.to/api/flix/178789/14');
  assert.equal(call.init.credentials,'omit');assert.equal(call.init.redirect,'error');
  assert.deepEqual(response,{ok:true,servers:[validServer]});
});

test('extension refuses foreign pages and invalid IDs without making a request',async()=>{
  let called=0;const fetcher=()=>{called++;throw new Error('unexpected fetch');};
  for (const origin of ['https://evil.example','https://anime-eight-virid.vercel.app.evil.example','http://anime-eight-virid.vercel.app','file:///x']) {
    assert.equal((await resolveStream(request,{url:origin},fetcher)).ok,false);
  }
  for (const fields of [{anilistId:'178789'},{anilistId:NaN},{anilistId:-1},{anilistId:100000001},{episode:'../../x'},{episode:Infinity},{episode:1.001},{episode:-1},{type:'other'}]) {
    assert.equal((await resolveStream({...request,...fields},sender,fetcher)).ok,false);
  }
  assert.equal(called,0);
});

test('extension filters arbitrary hosts, credentials, watch pages and unsupported streams',async()=>{
  const urls=['http://flixcloud.cc/e/id','https://flixcloud.cc.evil.example/e/id','https://user:pass@flixcloud.cc/e/id','https://reanime.to/watch/work','https://flixcloud.cc/video.m3u8','javascript:alert(1)'];
  const result=await resolveStream(request,sender,async()=>Response.json({servers:[validServer,...urls.map(dataLink=>({...validServer,dataLink}))]}));
  assert.deepEqual(result.servers,[validServer]);
});

test('extension reports failed, challenge and malformed responses as failures',async()=>{
  for (const response of [new Response('blocked',{status:403}),new Response('<html>challenge</html>'),Response.json({message:'missing'})]) {
    assert.equal((await resolveStream(request,sender,async()=>response)).ok,false);
  }
});

async function browser(run) {
  const dom=new JSDOM('',{url:sender.url}),old=globalThis.window;
  globalThis.window=dom.window;
  try {await run(dom.window);} finally {globalThis.window=old;dom.window.close();}
}

test('browser bridge correlates origin, source and request ID before using an embed',async()=>browser(async win=>{
  win.postMessage=(sent,target)=>{
    assert.equal(target,new URL(sender.url).origin);
    const reply={type:'ANIHUB_REANIME_RESPONSE_V1',requestId:sent.requestId,result:{ok:true,servers:[validServer]}};
    queueMicrotask(()=>{
      win.dispatchEvent(new win.MessageEvent('message',{source:win,origin:'https://evil.example',data:{...reply,result:{ok:false}}}));
      win.dispatchEvent(new win.MessageEvent('message',{source:win,origin:target,data:{...reply,requestId:'wrong',result:{ok:false}}}));
      win.dispatchEvent(new win.MessageEvent('message',{origin:target,data:{...reply,result:{ok:false}}}));
      win.dispatchEvent(new win.MessageEvent('message',{source:win,origin:target,data:reply}));
    });
  };
  const stream=await requestReanimeBrowserStream('https://reanime.to',178789,14);
  assert.equal(stream.embed_url,validServer.dataLink);assert.notEqual(stream.reanime_watch_page,true);
}));

test('an aborted bridge ignores late results and does not fall back to the watch page',async()=>browser(async win=>{
  const controller=new AbortController();
  win.postMessage=()=>queueMicrotask(()=>controller.abort());
  await assert.rejects(requestReanimeBrowserStream('https://reanime.to',178789,14,controller.signal),e=>e.name==='AbortError');
}));

test('bridge does not accept a different language or arbitrary player host',async()=>browser(async win=>{
  let servers=[{...validServer,dataType:'dub'}];
  win.postMessage=sent=>queueMicrotask(()=>win.dispatchEvent(new win.MessageEvent('message',{source:win,origin:win.location.origin,
    data:{type:'ANIHUB_REANIME_RESPONSE_V1',requestId:sent.requestId,result:{ok:true,servers}}})));
  await assert.rejects(requestReanimeBrowserStream('https://reanime.to',178789,14));
  assert.equal((await requestReanimeBrowserStream('https://reanime.to',178789,14,undefined,'dub')).embed_url,validServer.dataLink);
  servers=[{...validServer,dataLink:'https://reanime.to/watch/work'}];
  await assert.rejects(requestReanimeBrowserStream('https://reanime.to',178789,14));
}));

test('content script passes only same-window app requests to the extension and preserves correlation',async()=>{
  const script=await readFile(new URL('../extensions/reanime-bridge/content.js',import.meta.url),'utf8');
  let listener;const sent=[],replies=[];
  const win={addEventListener:(_,fn)=>{listener=fn;},postMessage:(data,origin)=>replies.push({data,origin})};win.top=win;
  runInNewContext(script,{window:win,location:{origin:new URL(sender.url).origin},chrome:{runtime:{sendMessage:(data,callback)=>{sent.push(data);callback({ok:true,servers:[validServer]});}}}});
  const data={type:'ANIHUB_REANIME_REQUEST_V1',requestId:'test-id',anilistId:178789,episode:14,url:'https://evil.example'};
  listener({source:win,origin:'https://evil.example',data});
  listener({source:{},origin:new URL(sender.url).origin,data});
  assert.equal(sent.length,0);
  listener({source:win,origin:new URL(sender.url).origin,data});
  assert.equal(sent.length,1);assert.equal(sent[0].url,undefined);assert.equal(sent[0].episode,14);
  assert.equal(replies.length,2);assert.equal(replies[0].data.type,'ANIHUB_REANIME_ACK_V1');
  assert.equal(replies[1].data.requestId,'test-id');assert.equal(replies[1].origin,new URL(sender.url).origin);
});

test('download package contains the reviewed source and only the two intended site scopes',async()=>{
  const archive=new AdmZip(await readFile(new URL('../public/downloads/anihub-reanime-bridge.zip',import.meta.url)));
  for (const name of ['manifest.json','background.mjs','content.js','README.md']) {
    assert.equal(archive.readAsText(name),await readFile(new URL(`../extensions/reanime-bridge/${name}`,import.meta.url),'utf8'));
  }
  const manifest=JSON.parse(archive.readAsText('manifest.json'));
  assert.deepEqual(manifest.host_permissions,['https://reanime.to/*']);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://anime-eight-virid.vercel.app/*']);
  assert.equal(manifest.permissions,undefined);
});
