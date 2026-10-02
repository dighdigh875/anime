(() => {
  const origin = 'https://anime-eight-virid.vercel.app';
  if (location.origin !== origin || window.top !== window) return;
  window.addEventListener('message', event => {
    const request = event.data;
    if (event.source !== window || event.origin !== origin || request?.type !== 'ANIHUB_REANIME_REQUEST_V1' ||
        typeof request.requestId !== 'string' || request.requestId.length > 100) return;
    const reply = data => window.postMessage({...data, requestId: request.requestId}, origin);
    reply({type: 'ANIHUB_REANIME_ACK_V1'});
    try {
      chrome.runtime.sendMessage({type: 'ANIHUB_REANIME_STREAM_V1', anilistId: request.anilistId, episode: request.episode}, result => {
        const error = chrome.runtime.lastError;
        reply({type: 'ANIHUB_REANIME_RESPONSE_V1', result: error
          ? {ok: false, error: '연결 도우미를 갱신한 뒤 사이트를 새로고침해 주세요.'} : result});
      });
    } catch {
      reply({type: 'ANIHUB_REANIME_RESPONSE_V1', result: {ok: false, error: '사이트를 새로고침한 뒤 다시 연결해 주세요.'}});
    }
  });
})();
