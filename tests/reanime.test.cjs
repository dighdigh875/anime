const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const file = require('node:path').resolve('src/lib/reanime-client.ts');
let api = {};
if (fs.existsSync(file)) {
  const m = new Module(file, module);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  api = m.exports;
}
const base = 'https://reanime.to';
const anime = { anime_id: 'sample-ab1234', anilist_id: 21, title: {english:'Sample'}, genres:['Action'], cover_image:{large:'https://images.example/a.jpg'} };
const json = (body, status=200) => new Response(JSON.stringify(body), {status});
test('uses the root origin even when an API endpoint is pasted', () => {
  assert.equal(typeof api.normalizeReanimeUrl, 'function');
  assert.equal(api.normalizeReanimeUrl('reanime.to/api/v1/home?x=1'), base);
  assert.throws(() => api.normalizeReanimeUrl('https://user:password@reanime.to'));
  assert.throws(() => api.normalizeReanimeUrl('javascript:alert(1)'));
});
test('403 on both home endpoints remains a failure rather than an empty healthy list', async () => {
  assert.equal(typeof api.fetchReanimeList, 'function');
  await assert.rejects(api.fetchReanimeList(base, {}, async () => json({},403)), /403/);
});
test('home can recover using the Svelte data endpoint', async () => {
  assert.equal(typeof api.fetchReanimeList, 'function');
  const response = await api.fetchReanimeList(base, {}, async url => String(url).endsWith('/api/v1/home') ? json({},403) : json({nodes:[{data:[{homeData:1},{latest_aired:2},[3],{anime_id:4,title:5},'sample-ab1234',{english:6},'Sample']}]}));
  assert.equal(response.items[0].id, 're_sample-ab1234');
});
test('a 200 HTML challenge is not a healthy Reanime response', async () => {
  assert.equal(typeof api.fetchReanimeList, 'function');
  await assert.rejects(api.fetchReanimeList(base, {}, async () => new Response('<html>Challenge</html>')));
});
test('search offsets follow the requested page', async () => {
  assert.equal(typeof api.fetchReanimeList, 'function');
  const response = await api.fetchReanimeList(base, {q:'Sample',page:2}, async url => {
    assert.equal(new URL(url).searchParams.get('offset'),'20');
    return json({results:[anime],total:21});
  });
  assert.equal(response.page,2);
  assert.equal(response.has_next,false);
});
test('detail retains actual episode numbers and language availability', async () => {
  assert.equal(typeof api.fetchReanimeDetail, 'function');
  const result = await api.fetchReanimeDetail(base,'re_sample-ab1234', async url => json(new URL(url).pathname.endsWith('/episodes') ? {data:[{episode_number:3,title:'Third',subbed:true,dubbed:false,playable:true},{episode_number:4,subbed:true,dubbed:true,playable:false}]} : anime));
  assert.deepEqual(result.sub_episodes.map(e=>e.number),[3]);
  assert.deepEqual(result.dub_episodes,[]);
  assert.equal(api.selectEpisode(result,99),null);
  assert.throws(()=>api.reanimeSlug('1234'),/Reanime/);
});
test('detail loads episodes beyond the provider default first page',async()=>{
  const result=await api.fetchReanimeDetail(base,'re_sample-ab1234',async url=>{
    const parsed=new URL(url);
    if(!parsed.pathname.endsWith('/episodes'))return json(anime);
    const offset=Number(parsed.searchParams.get('offset')||0);
    return json({data:[{episode_number:offset+1,subbed:true,playable:true}],total:3});
  });
  assert.deepEqual(result.sub_episodes.map(e=>e.number),[1,2,3]);
});
test('popular items show a rank rather than their score as a place number',async()=>{
  const result=await api.fetchReanimeList(base,{tab:'top'},async()=>json({trending:[{...anime,average_score:87}]}));
  assert.equal(result.items[0].rank,1);
});
test('embed sources remain iframe sources and select the requested language', async () => {
  assert.equal(typeof api.fetchReanimeStream, 'function');
  const fetcher = async () => json({success:true,servers:[{serverName:'HD-1',dataType:'dub',dataLink:'https://video.example/dub'},{serverName:'HD-2',dataType:'sub',dataLink:'https://video.example/sub'}]});
  const result = await api.fetchReanimeStream(base,21,3,false,fetcher);
  assert.equal(result.stream_type,'iframe');
  assert.equal(result.m3u8_url,'');
  assert.equal(result.embed_url,'https://video.example/sub');
  const dub = await api.fetchReanimeStream(base,21,3,true,fetcher);
  assert.equal(dub.embed_url,'https://video.example/dub');
});
test('no matching language or unsafe embed URL cannot silently play another source', async () => {
  assert.equal(typeof api.fetchReanimeStream, 'function');
  await assert.rejects(api.fetchReanimeStream(base,21,3,false,async()=>json({success:true,servers:[{dataType:'dub',dataLink:'https://video.example/e'}]})));
  await assert.rejects(api.fetchReanimeStream(base,21,3,false,async()=>json({success:true,servers:[{dataType:'sub',dataLink:'javascript:alert(1)'}]})));
});
