const test=require('node:test');
const assert=require('node:assert/strict');
const {NextRequest}=require('next/server');
const {loadTs}=require('./load-ts.cjs');
const user={isAdmin:true};
const auth={getSessionUser:async()=>user,getCurrentUserId:async()=>'user-1'};
test('sync rejects invalid episode, offset and legacy IDs before a DB write',async()=>{
  let writes=0;
  const route=loadTs('src/app/api/anime/reanime-sync/route.ts',{'@/lib/auth':auth,'@/lib/db':{setReanimeSubtitleSetting:async()=>{writes++;return true;}}});
  for(const body of [{animeId:'re_sample',ep:0,syncOffset:0},{animeId:'re_sample',ep:1,syncOffset:'oops'},{animeId:'1234',ep:1,syncOffset:0}]) {
    const res=await route.POST(new NextRequest('https://app.example/api/anime/reanime-sync',{method:'POST',body:JSON.stringify(body)}));
    assert.equal(res.status,400);
  }
  assert.equal(writes,0);
});
test('force-saving a blocked provider stays unhealthy and saves only the normalized root',async()=>{
  let saved;
  const route=loadTs('src/app/api/settings/base-url/route.ts',{'@/lib/auth':auth,'@/lib/db':{getReanimeBaseUrl:async()=>'',setReanimeBaseUrl:async url=>{saved=url;return true;},DEFAULT_REANIME_URL:'https://reanime.to'},'@/lib/reanime':{checkReanimeHealth:async()=>({ok:false,statusText:'HTTP 403',latencyMs:1})},'@/lib/proxyGuard':{assertSafeProxyUrl:async()=>{},UnsafeProxyUrlError:class extends Error{}}});
  const make=force=>new NextRequest('https://app.example/api/settings/base-url',{method:'POST',body:JSON.stringify({baseUrl:'https://reanime.to/api/v1/home',force})});
  assert.equal((await route.POST(make(false))).status,422);
  assert.equal(saved,undefined);
  const response=await route.POST(make(true));
  assert.equal(response.status,200);
  assert.equal((await response.json()).health.ok,false);
  assert.equal(saved,'https://reanime.to');
});
test('provider settings and stream proxy enforce authentication and admin writes',async()=>{
  let session=null;
  const route=loadTs('src/app/api/settings/base-url/route.ts',{'@/lib/auth':{getSessionUser:async()=>session},'@/lib/db':{},'@/lib/reanime':{}});
  const request=new NextRequest('https://app.example/api/settings/base-url',{method:'POST',body:'{}'});
  assert.equal((await route.GET()).status,401);
  assert.equal((await route.POST(request)).status,401);
  session={isAdmin:false};
  assert.equal((await route.POST(request)).status,403);
  const stream=loadTs('src/app/api/anime/reanime-stream/route.ts',{'@/lib/auth':{getSessionUser:async()=>null},'@/lib/db':{},'@/lib/reanime':{}});
  assert.equal((await stream.GET(new NextRequest('https://app.example/api/anime/reanime-stream?anilist=21&ep=1'))).status,401);
});
