import test from 'node:test';
import assert from 'node:assert/strict';
import {searchReanimeCandidates, getReanimeDetail, getReanimeStream} from '../src/lib/reanime-api.ts';
import {requestWithReanimeFallback,loadKoreanReanimeStream} from '../src/lib/korean-reanime-client.ts';

const anime={originalSubject:'ヤニねこ',subject:'담배 고양이',startDate:'2026-07-03'};
const base='https://reanime.to';
async function withFetch(fn, run) {const old=globalThis.fetch;globalThis.fetch=fn;try {await run();} finally {globalThis.fetch=old;}}

test('empty title searches retry without wave punctuation while preserving the season numeral',async()=>{
  const work={originalSubject:'無職転生Ⅲ〜異世界行ったら本気だす〜',subject:'무직 전생 III',startDate:'2026-07-06'};
  const calls=[];
  await withFetch(async url=>{
    const q=new URL(url).searchParams.get('q'); calls.push(q);
    return Response.json({results:q==='無職転生Ⅲ異世界行ったら本気だす'?[{anime_id:'mushoku-3',title:{native:work.originalSubject},season_year:2026}]:[]});
  },async()=>{
    const results=await searchReanimeCandidates(work,base,work.originalSubject);
    assert.equal(results[0]?.id,'re_mushoku-3'); assert.equal(results[0]?.exactMatch,true);
    assert.deepEqual(calls,[work.originalSubject,'無職転生Ⅲ異世界行ったら本気だす']);
  });
});
test('successful original searches do not broaden or duplicate requests',async()=>{
  const calls=[];
  await withFetch(async url=>{calls.push(url);return Response.json({results:[{anime_id:'cat',title:{native:'ヤニねこ'}}]});},async()=>{
    assert.equal((await searchReanimeCandidates(anime,base,'ヤニ〜ねこ')).length,1);
    assert.equal(calls.length,1);
  });
});

test('search preserves upstream status and rejects HTML challenge responses',async()=>{
  await withFetch(async()=>new Response('Forbidden',{status:403}),async()=>{
    await assert.rejects(searchReanimeCandidates(anime,base,'ヤニねこ'),e=>e.status===403 && /403/.test(e.message));
  });
  await withFetch(async()=>new Response('<html>Challenge</html>'),async()=>{
    await assert.rejects(searchReanimeCandidates(anime,base,'ヤニねこ'),/JSON/);
  });
});
test('server rejection retries the same operation in the browser using configured origin',async()=>{
  let fallbackBase;
  await withFetch(async()=>Response.json({code:'REANIME_UNAVAILABLE',baseUrl:base,error:'검색 HTTP 403'},{status:502}),async()=>{
    const result=await requestWithReanimeFallback('/api/anissia/mapping?id=3440&search=1',async b=>{fallbackBase=b;return {candidates:[{id:'re_cat'}]};});
    assert.equal(fallbackBase,base);assert.equal(result.candidates[0].id,'re_cat');
  });
});
test('authentication and database failures never trigger browser retry',async()=>{
  for (const [status,code] of [[401,'AUTH_REQUIRED'],[503,'DATABASE_ERROR']]) {
    await withFetch(async()=>Response.json({code,error:'실패'},{status}),async()=>{
      let retried=false;
      await assert.rejects(requestWithReanimeFallback('/api/test',async()=>{retried=true;}));
      assert.equal(retried,false);
    });
  }
});
test('a failed browser retry is a connection error, not an empty search result',async()=>{
  await withFetch(async()=>Response.json({code:'REANIME_UNAVAILABLE',baseUrl:base,error:'검색 HTTP 403'},{status:502}),async()=>{
    await assert.rejects(requestWithReanimeFallback('/api/test',async()=>{throw new TypeError('Failed to fetch');}),/브라우저/);
  });
});
test('detail uses real episode numbers and does not turn a failed episode request into an empty list',async()=>{
  await withFetch(async url=>String(url).endsWith('/episodes') ? Response.json({data:[{episode_number:13,title:'13'},{episode_number:14,title:'14'}]}) : Response.json({anime_id:'cat',anilist_id:207141,title:{english:'Cat'},season_year:2026}),async()=>{
    const d=await getReanimeDetail(base,'re_cat');
    assert.deepEqual(d.sub_episodes.map(e=>e.number),[13,14]);
    assert.match(d.sub_episodes[0].watch_url,/ep=13&anilist=207141/);
  });
  await withFetch(async url=>String(url).endsWith('/episodes') ? new Response('',{status:403}) : Response.json({title:{english:'Cat'}}),async()=>{
    await assert.rejects(getReanimeDetail(base,'re_cat'),e=>e.status===403);
  });
});
test('stream chooses a valid sub embed and never falls back to a dubbed or watch page',async()=>{
  await withFetch(async()=>Response.json({servers:[{dataType:'dub',dataLink:'https://player.example/dub'},{dataType:'sub',serverName:'HD-1',dataLink:'https://player.example/sub'}]}),async()=>{
    const stream=await getReanimeStream(base,207141,1);
    assert.equal(stream.embed_url,'https://player.example/sub');assert.equal(stream.m3u8_url,'');
  });
  for(const servers of [[{dataType:'dub',dataLink:'https://player.example/dub'}],[{dataType:'sub',dataLink:'javascript:alert(1)'}],[]]) {
    await withFetch(async()=>Response.json({servers}),async()=>{await assert.rejects(getReanimeStream(base,207141,1));});
  }
});
test('aborting a server request cannot start a browser retry',async()=>{
  const controller=new AbortController();controller.abort();let retried=false;
  await withFetch(async()=>{throw new DOMException('Aborted','AbortError');},async()=>{
    await assert.rejects(requestWithReanimeFallback('/api/test',async()=>{retried=true;},controller.signal));
    assert.equal(retried,false);
  });
});
test('blocked stream API does not return the watch page that now rejects external frames',async()=>{
  const calls=[];
  await withFetch(async url=>{calls.push(url);return Response.json({code:'REANIME_UNAVAILABLE',baseUrl:base,error:'HTTP 403'},{status:502});},async()=>{
    await assert.rejects(loadKoreanReanimeStream({id:'re_cat',anilistId:207141},12),/연결 도우미/);
    assert.equal(calls.length,1);
  });
});
