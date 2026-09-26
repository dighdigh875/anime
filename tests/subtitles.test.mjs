import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import dns from 'node:dns';
import { extractSubtitleFromBuffer, getAnissiaCreators, getAnissiaCreatorsById, searchAllSubtitlesParallel, convertToVtt, parseEpisodes } from '../src/lib/subtitles.ts';

const srt = '1\n00:00:01,000 --> 00:00:03,000\n안녕하세요\n';
test('CP949 subtitles preserve Korean dialogue', () => {
  const result = extractSubtitleFromBuffer(iconv.encode(srt, 'cp949'), 1, 'https://example.com/1.srt');
  assert.match(result.content, /안녕하세요/);
  assert.doesNotMatch(result.content, /�/);
});
test('plain attachments with another episode are rejected', () => {
  assert.equal(extractSubtitleFromBuffer(Buffer.from(srt), 1, 'https://example.com/작품%2012화.srt'), null);
});
test('episode parsing preserves long-running, special, and season/episode numbers', () => {
  assert.deepEqual(parseEpisodes('원피스 1130화.ass'), [1130]);
  assert.deepEqual(parseEpisodes('작품 12.5화.ass'), [12.5]);
  assert.deepEqual(parseEpisodes('Work.S04E22.1080p.ass'), [22]);
  assert.deepEqual(parseEpisodes('작품 2기 01화.ass'), [1]);
});
test('bundled posts include the entire episode range', () => {
  assert.deepEqual(parseEpisodes('작품 01~03화.zip'), [1,2,3]);
});
test('SMI conversion includes the final dialogue cue', () => {
  const result = convertToVtt('<SAMI><BODY><SYNC Start=1000><P Class=KRCC>첫 대사<SYNC Start=3000><P Class=KRCC>마지막 대사</BODY></SAMI>', '.smi');
  assert.match(result.content, /마지막 대사/);
  assert.match(result.content, /00:00:03.000 --> 00:00:06.000/);
});
test('a single file archive for episode 12 must not be used for episode 1', () => {
  const zip = new AdmZip();
  zip.addFile('작품 12화.srt', Buffer.from(srt));
  assert.equal(extractSubtitleFromBuffer(zip.toBuffer(), 1, 'https://example.com/sub.zip'), null);
});
test('a WebVTT subtitle keeps a single header', () => {
  const result = extractSubtitleFromBuffer(Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n안녕하세요\n'), 1, 'https://example.com/sub.vtt');
  assert.equal(result.content.match(/WEBVTT/g).length, 1);
});
test('caption 12 is not caption 1', async t => {
  t.mock.method(dns.promises, 'lookup', async()=>[{address:'203.0.113.1',family:4}]);
  const original = globalThis.fetch;
  globalThis.fetch = async url => Response.json(String(url).includes('/list/')
    ? {data:{content:[{animeNo:123,subject:'테스트 작품'}]}}
    : {data:[{name:'번역자',episode:'12',website:'https://example.com/12',updDt:'2026-01-01'}]});
  try { assert.equal((await getAnissiaCreators('테스트 작품', 1))[0].is_current_ep, false); }
  finally { globalThis.fetch = original; }
});
test('known Anissia IDs use caption lookup directly, including episode zero', async t => {
  t.mock.method(dns.promises, 'lookup', async()=>[{address:'203.0.113.1',family:4}]);
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,'https://api.anissia.net/anime/caption/animeNo/123');
    return Response.json({code:'ok',data:[{name:'번역자',episode:'0',website:'https://example.com/movie',updDt:'2026-01-01T00:00:00'}]});
  });
  assert.equal((await getAnissiaCreatorsById(123,0))[0].is_current_ep,true);
});
test('a slow fallback cannot discard a completed creator subtitle at the deadline', async t => {
  t.mock.method(dns.promises, 'lookup', async()=>[{address:'203.0.113.1',family:4}]);
  let aborted=false;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(url.includes('api.anissia.net')) return Response.json({data:[{name:'번역자',episode:'1',website:'https://example.com/post',updDt:'2026-01-01'}]});
    if(url==='https://example.com/post') return new Response('<title>테스트 작품 1화</title><a href="https://example.com/1.srt">1.srt</a>');
    if(url==='https://example.com/1.srt') return new Response(srt.replace('안녕하세요','안녕하세요. 회차에 맞는 한국어 자막입니다.'));
    if(url.includes('kairan03.blogspot.com/search')) return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true}));
    throw new Error('Unexpected URL '+url);
  });
  const result=await searchAllSubtitlesParallel('테스트 작품',1,150,123);
  assert.equal(result.status,'ready');
  assert.equal(result.subtitles[0].name,'번역자');
  assert.equal(result.creators.length,1);
  assert.equal(aborted,true);
});
