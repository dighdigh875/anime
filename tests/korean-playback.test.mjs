import test from 'node:test';
import assert from 'node:assert/strict';
import { validateKoreanSubtitle, prepareKoreanPlayback, rankReanimeCandidates, nextKoreanHistoryUrl } from '../src/lib/korean-playback.ts';
import {prepareKoreanSubtitles} from '../src/lib/korean-playback.ts';

const valid = {name:'번역자',episode:1,orig_filename:'작품 1화.vtt',format:'VTT',is_ass:false,content:'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n안녕하세요\n'};
test('server subtitle preflight is independent of Reanime and preserves the mapped episode',async()=>{
  const ready=await prepareKoreanSubtitles({episode:1,offset:12},async()=>({subtitles:[valid],creators:[],status:'ready'}));
  assert.equal(ready.status,'subtitles_ready');assert.equal(ready.videoEpisode,13);
  const invalid=await prepareKoreanSubtitles({episode:1,offset:12},async()=>({subtitles:[{...valid,episode:12}],creators:[],status:'ready'}));
  assert.equal(invalid.status,'not_found');assert.equal(invalid.subtitles.length,0);
  let searched=false;
  const missing=await prepareKoreanSubtitles({episode:1,offset:-2},async()=>{searched=true;});
  assert.equal(missing.status,'episode_missing');assert.equal(searched,false);
});
test('promoted history preserves the Korean route and subtitle episode offset', () => {
  assert.equal(nextKoreanHistoryUrl('/korean/123?ep=1',13,14),'/korean/123?ep=2');
  assert.equal(nextKoreanHistoryUrl('/korean/123?ep=0',1,2),'/korean/123?ep=1');
  assert.equal(nextKoreanHistoryUrl('/korean/123?ep=12.5',12.5,13),'/korean/123?ep=13');
  assert.equal(nextKoreanHistoryUrl('https://example.com/watch',1,2),null);
});
test('ready requires actual Korean dialogue with valid cue timing', () => {
  assert.equal(validateKoreanSubtitle(valid), true);
  for (const content of ['<html>한글 로그인</html>', 'WEBVTT\n\n', 'WEBVTT\n\n00:00:03.000 --> 00:00:01.000\n잘못된 시간', 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello']) {
    assert.equal(validateKoreanSubtitle({...valid,content}),false);
  }
  assert.equal(validateKoreanSubtitle({...valid,is_ass:true,format:'ASS',content:'[Script Info]\nTitle: 한글 제목\n[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello'}),false);
});
test('matching ranks an exact native title and year ahead of another season', () => {
  const ranked = rankReanimeCandidates({originalSubject:'作品 第2期',subject:'작품 2기',startDate:'2026-01-01'}, [
    {id:'re_wrong',title:'Work',nativeTitle:'作品',year:'2024'},
    {id:'re_right',title:'Work 2',nativeTitle:'作品 第2期',year:'2026'},
  ]);
  assert.equal(ranked[0].id,'re_right');
  assert.equal(ranked[0].exactMatch,true);
  assert.equal(ranked[1].exactMatch,false);
});
test('video fetch happens only after subtitle verification and uses the mapped episode', async () => {
  const events=[];
  const result=await prepareKoreanPlayback({episode:1,offset:12,episodes:[{number:13,watch_url:'https://example.com/13',title:'13화'}]}, {
    findSubtitles:async()=>{events.push('subtitles');return {subtitles:[valid],creators:[],status:'ready'};},
    getStream:async url=>{events.push(url);return {embed_url:'https://example.com/embed',stream_type:'iframe'};},
  });
  assert.deepEqual(events,['subtitles','https://example.com/13']);
  assert.equal(result.status,'ready');
  assert.equal(result.videoEpisode,13);
});
test('missing, invalid, or timed-out subtitles never trigger video loading', async () => {
  for (const found of [{subtitles:[],status:'not_found'}, {subtitles:[],status:'timeout'}, {subtitles:[{...valid,content:'<html>접근 제한</html>'}],status:'ready'}]) {
    let loaded=false;
    const result=await prepareKoreanPlayback({episode:1,offset:0,episodes:[{number:1,watch_url:'url'}]}, {
      findSubtitles:async()=>({...found,creators:[]}),getStream:async()=>{loaded=true;},
    });
    assert.equal(loaded,false);
    assert.notEqual(result.status,'ready');
  }
});
test('an unavailable episode never falls back to the first episode', async () => {
  let loaded=false;
  const result=await prepareKoreanPlayback({episode:12,offset:0,episodes:[{number:1,watch_url:'url'}]}, {
    findSubtitles:async()=>({subtitles:[valid],creators:[],status:'ready'}),getStream:async()=>{loaded=true;},
  });
  assert.equal(result.status,'episode_missing');
  assert.equal(loaded,false);
});
test('a manually searched subtitle for episode 12 cannot prepare episode 1', async () => {
  let loaded=false;
  const result=await prepareKoreanPlayback({episode:1,offset:0,episodes:[{number:1,watch_url:'url'}]}, {
    findSubtitles:async()=>({subtitles:[{...valid,episode:12}],creators:[],status:'ready'}),getStream:async()=>{loaded=true;},
  });
  assert.equal(result.status,'not_found'); assert.equal(loaded,false);
});
