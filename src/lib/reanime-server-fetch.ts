// Server-only transport: import this from API routes/providers, never from client components.
import {ReanimeRequestError, type ReanimeFetch} from './reanime-api';

export function isReanimeWorkerConfigured(): boolean {
  return !!(process.env.REANIME_WORKER_URL?.trim() || process.env.REANIME_WORKER_TOKEN?.trim());
}

export const fetchReanimeServer: ReanimeFetch = async (url, init = {}) => {
  const workerUrl = process.env.REANIME_WORKER_URL?.trim();
  const token = process.env.REANIME_WORKER_TOKEN?.trim();
  if (!workerUrl && !token) return fetch(url, init);
  if (!workerUrl || !token || token.length < 32) throw new ReanimeRequestError('Reanime 중계 서버의 URL과 인증 키 설정을 확인해 주세요.');
  let target: URL;
  let relay: URL;
  try {target = new URL(url); relay = new URL(workerUrl);}
  catch {throw new ReanimeRequestError('Reanime 중계 서버 URL 설정을 확인해 주세요.');}
  if (target.origin !== 'https://reanime.to' || target.username || target.password || target.hash || (init.method && init.method !== 'GET')) {
    throw new ReanimeRequestError('중계 서버는 Reanime 공개 정보 조회만 지원합니다.');
  }
  if (relay.protocol !== 'https:' || relay.username || relay.password || relay.search || relay.hash || relay.pathname !== '/') {
    throw new ReanimeRequestError('Reanime 중계 서버 URL에는 HTTPS 기본 주소만 설정해 주세요.');
  }
  return fetch(new URL('/resolve', relay).href, {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: JSON.stringify({path: `${target.pathname}${target.search}`}),
    cache: 'no-store', credentials: 'omit', redirect: 'error', signal: init.signal ?? AbortSignal.timeout(10000),
  });
};
