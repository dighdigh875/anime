"use client";
export default function ReanimeConnectionState({error, retry, externalUrl}: {error?:string;retry:()=>void;externalUrl?:string}) {
  return <div className="my-8 rounded-2xl border border-purple-500/20 bg-slate-900 p-6 text-slate-300" role="status">
    <p>{error || "서버에서 조회하지 못해 브라우저에서 Reanime 연결을 다시 확인하고 있습니다…"}</p>
    {error && <><p className="mt-2 text-sm text-slate-400">서버 또는 브라우저 연결이 차단됐을 수 있습니다. 도메인 설정을 확인한 뒤 다시 시도해주세요.</p>
      <button onClick={retry} className="mt-4 rounded-lg bg-purple-600 px-4 py-2 text-white">다시 시도</button>
      {externalUrl && <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="ml-4 underline">Reanime에서 열기</a>}
    </>}
  </div>;
}
