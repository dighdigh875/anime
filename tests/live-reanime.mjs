// Opt-in live provider check: node --import ./tests/register.mjs tests/live-reanime.mjs
import {getAnissiaAnime} from '../src/lib/anissia.ts';
import {searchReanimeCandidates,getReanimeDetail,getReanimeStream} from '../src/lib/reanime-api.ts';
import {prepareKoreanSubtitles} from '../src/lib/korean-playback.ts';
import {searchAllSubtitlesParallel} from '../src/lib/subtitles.ts';
const anime=await getAnissiaAnime(3440);
const candidates=await searchReanimeCandidates(anime,'https://reanime.to',anime.originalSubject);
const selected=candidates.find(c=>c.exactMatch);
if(!selected) throw new Error('Exact native title/year not found');
const detail=await getReanimeDetail('https://reanime.to',selected.id);
const episode=12;
if(!detail.sub_episodes.some(e=>e.number===episode)) throw new Error('Requested episode missing');
const ready=await prepareKoreanSubtitles({episode,offset:0},()=>searchAllSubtitlesParallel(anime.subject,episode,18000,anime.animeNo));
console.log(JSON.stringify({anime:anime.subject,candidates:candidates.length,selected:selected.id,episodes:detail.sub_episodes.length,subtitleStatus:ready.status,subtitleCount:ready.subtitles.length}));
if(ready.status==='subtitles_ready') {
  const stream=await getReanimeStream('https://reanime.to',detail.anilistId,episode);
  console.log(JSON.stringify({streamType:stream.stream_type,embedHost:new URL(stream.embed_url).host}));
} else throw new Error(`Subtitle validation failed: ${ready.status}`);
