import test from 'node:test';
import assert from 'node:assert/strict';
import {pollPlaybackTime,isPlaybackMessage} from '../src/lib/iframe-playback.ts';
function frame(children=[]) {const sent=[];const w={frames:children,length:children.length,postMessage:(data,origin)=>sent.push({data,origin})};children.forEach((c,i)=>w[i]=c);return {w,sent};}
test('mirrored playback polls nested player windows using only the supported player origin',()=>{
  const player=frame();const root=frame([player.w]);
  pollPlaybackTime(root.w,'https://reanime.to',true);
  assert.deepEqual(player.sent,[{data:{command:'getTime'},origin:'https://flixcloud.cc'}]);
  assert.equal(root.sent[0].origin,'https://reanime.to');
});
test('time messages must come from the actual iframe tree and a trusted origin',()=>{
  const player=frame();const root=frame([player.w]);const unrelated=frame();
  const event={source:player.w,origin:'https://flixcloud.cc',data:{currentTime:51,duration:1422}};
  assert.equal(isPlaybackMessage(event,root.w,'https://reanime.to',true),true);
  assert.equal(isPlaybackMessage(event,root.w,'https://reanime.to',false),false);
  assert.equal(isPlaybackMessage({...event,source:unrelated.w},root.w,'https://reanime.to',true),false);
  assert.equal(isPlaybackMessage({...event,origin:'https://ads.example'},root.w,'https://reanime.to',true),false);
  assert.equal(isPlaybackMessage({...event,source:root.w},root.w,'https://reanime.to',true),false);
});
test('a detached player is no longer accepted and a direct embed keeps its origin check',()=>{
  const player=frame();const root=frame([player.w]);
  root.w.frames=[];root.w.length=0;delete root.w[0];
  assert.equal(isPlaybackMessage({source:player.w,origin:'https://flixcloud.cc',data:{}},root.w,'https://reanime.to',true),false);
  assert.equal(isPlaybackMessage({source:root.w,origin:'https://player.example',data:{}},root.w,'https://player.example',false),true);
});
