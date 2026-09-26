const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const iconv=require('iconv-lite');
const {loadTs}=require('./load-ts.cjs');
const read=()=>fs.existsSync('src/lib/subtitle-file.ts')?loadTs('src/lib/subtitle-file.ts'):{};
test('Korean CP949 SRT is decoded and converted into timed VTT',()=>{
  const {readSubtitleFile}=read();assert.equal(typeof readSubtitleFile,'function');
  const result=readSubtitleFile(iconv.encode('1\n00:00:01,000 --> 00:00:02,000\n안녕하세요\n','cp949'),'episode.srt');
  assert.match(result.content,/WEBVTT/);assert.match(result.content,/안녕하세요/);assert.match(result.content,/00:00:01.000 --> 00:00:02.000/);
});
test('SMI empty sync entries end the preceding subtitle',()=>{
  const {readSubtitleFile}=read();assert.equal(typeof readSubtitleFile,'function');
  const result=readSubtitleFile(new TextEncoder().encode('<SAMI><HEAD><TITLE>자막</TITLE><STYLE>P {color: white}</STYLE></HEAD><BODY><SYNC Start="1000"><P>첫 대사<SYNC Start="2000"><P>&nbsp;<SYNC Start="4000"><P>둘째 대사</BODY></SAMI>'),'episode.smi');
  assert.match(result.content,/00:00:01.000 --> 00:00:02.000\n첫 대사/);
});
test('HTML pages masquerading as subtitles are rejected',()=>{
  const {readSubtitleFile}=read();assert.equal(typeof readSubtitleFile,'function');
  assert.throws(()=>readSubtitleFile(new TextEncoder().encode('<!DOCTYPE html><html>Blocked</html>'),'episode.vtt'));
});
test('cue identifiers and settings are kept out of displayed subtitle text',()=>{
  const {parseVttCues}=read();assert.equal(typeof parseVttCues,'function');
  const cues=parseVttCues('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000 align:center\nFirst dialogue\n\n2\n00:00:03.000 --> 00:00:04.000\nSecond dialogue\n');
  assert.deepEqual(cues,[{start:1,end:2,text:'First dialogue'},{start:3,end:4,text:'Second dialogue'}]);
});
