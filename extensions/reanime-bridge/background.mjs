const APP_ORIGIN = 'https://anime-eight-virid.vercel.app';

// The page cannot supply a host, URL, credentials or arbitrary request headers.
export async function resolveStream(message, sender, fetcher = fetch) {
  try {
    if (new URL(sender?.url || '').origin !== APP_ORIGIN ||
        message?.type !== 'ANIHUB_REANIME_STREAM_V1' ||
        !Number.isSafeInteger(message.anilistId) || message.anilistId <= 0 || message.anilistId > 100000000 ||
        !Number.isFinite(message.episode) || message.episode < 0 || message.episode > 10000 ||
        Math.round(message.episode * 10) !== message.episode * 10) {
      return {ok: false, error: '허용되지 않은 영상 주소 요청입니다.'};
    }
    const response = await fetcher(`https://reanime.to/api/flix/${message.anilistId}/${message.episode}`, {
      credentials: 'omit', redirect: 'error', cache: 'no-store', headers: {Accept: 'application/json'},
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return {ok: false, error: `PC에서 Reanime 영상 주소를 조회하지 못했습니다 (HTTP ${response.status}).`};
    const text = await response.text();
    if (text.length > 100000) throw new Error('응답이 너무 큽니다.');
    const data = JSON.parse(text);
    if (!Array.isArray(data.servers)) throw new Error('영상 주소 응답이 아닙니다.');
    const servers = data.servers.flatMap(server => {
      try {
        const url = new URL(server.dataLink);
        if (url.origin !== 'https://flixcloud.cc' || url.username || url.password ||
            !/^\/e\/[a-zA-Z0-9_-]{1,128}$/.test(url.pathname) || !['sub','dub'].includes(server.dataType)) return [];
        // Return only the player address and selection metadata, never cookies or page data.
        const version = url.searchParams.get('v');
        return [{serverName: String(server.serverName || 'HD').slice(0,30), dataType: server.dataType,
          dataLink: `${url.origin}${url.pathname}${version === '1' || version === '2' ? `?v=${version}` : ''}`}];
      } catch {return [];}
    });
    return {ok: true, servers};
  } catch {
    return {ok: false, error: 'PC에서 Reanime에 연결하지 못했습니다. 원본 사이트 접속 상태를 확인하고 다시 시도해 주세요.'};
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'ANIHUB_REANIME_STREAM_V1') return false;
    resolveStream(message, sender).then(sendResponse);
    return true;
  });
}
