import {parseReanimeStream, reanimeOrigin} from './reanime-api';
import type {EpisodeStreamInfo} from './providers/types';

export class ReanimeBridgeError extends Error {
  constructor(message: string, public code: 'NOT_INSTALLED' | 'FAILED' = 'FAILED') {
    super(message); this.name = 'ReanimeBridgeError';
  }
}

export function requestReanimeBrowserStream(baseUrl: string, anilistId: number, episode: number,
  signal?: AbortSignal, language: 'sub' | 'dub' = 'sub'): Promise<EpisodeStreamInfo> {
  if (reanimeOrigin(baseUrl) !== 'https://reanime.to') {
    return Promise.reject(new ReanimeBridgeError('연결 도우미는 현재 reanime.to만 지원합니다. 도메인 설정을 확인해 주세요.'));
  }
  if (typeof window === 'undefined') return Promise.reject(new ReanimeBridgeError('브라우저 연결 도우미가 필요합니다.', 'NOT_INSTALLED'));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const origin = window.location.origin;
    let timer: ReturnType<typeof setTimeout>;
    let acknowledged = false;
    const finish = (error?: unknown, stream?: EpisodeStreamInfo) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(stream!);
    };
    const onAbort = () => finish(signal?.reason || new DOMException('Aborted', 'AbortError'));
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== origin || event.data?.requestId !== requestId) return;
      if (event.data.type === 'ANIHUB_REANIME_ACK_V1' && !acknowledged) {
        acknowledged = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish(new ReanimeBridgeError('연결 도우미의 응답 시간이 초과되었습니다. 다시 시도해 주세요.')), 12000);
      } else if (event.data.type === 'ANIHUB_REANIME_RESPONSE_V1') {
        const result = event.data.result;
        if (!result?.ok) {finish(new ReanimeBridgeError(String(result?.error || '연결 도우미가 영상 주소를 가져오지 못했습니다.'))); return;}
        try {
          // Reject messages containing an arbitrary frame URL, including the blocked watch page.
          const servers = Array.isArray(result.servers) ? result.servers.filter((server: any) => {
            try {
              const url = new URL(server.dataLink);
              return url.origin === 'https://flixcloud.cc' && !url.username && !url.password && /^\/e\/[a-zA-Z0-9_-]{1,128}$/.test(url.pathname);
            } catch {return false;}
          }) : [];
          finish(undefined, parseReanimeStream({servers}, language));
        } catch {finish(new ReanimeBridgeError('요청한 회차·언어의 영상 플레이어 주소를 확인하지 못했습니다.'));}
      }
    };
    if (signal?.aborted) {onAbort(); return;}
    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, {once: true});
    timer = setTimeout(() => finish(new ReanimeBridgeError('브라우저 연결 도우미를 설치한 뒤 이 페이지를 새로고침해 주세요.', 'NOT_INSTALLED')), 1000);
    window.postMessage({type: 'ANIHUB_REANIME_REQUEST_V1', requestId, anilistId, episode}, origin);
  });
}
