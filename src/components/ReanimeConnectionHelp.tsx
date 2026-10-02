export default function ReanimeConnectionHelp() {
  return <aside className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5 text-sm text-slate-200" aria-label="Reanime 연결 도우미 설치">
    <h2 className="font-bold text-amber-200">Reanime 연결 도우미가 필요합니다</h2>
    <p className="mt-2 leading-6">한 번 설치하면 이 브라우저에서 영상 주소를 연결할 수 있습니다. 설치 후 이 페이지를 새로고침하고 다시 재생해 주세요.</p>
    <a href="/downloads/anihub-reanime-bridge.zip" download className="mt-3 inline-block rounded-lg bg-purple-600 px-4 py-2 font-bold text-white">연결 도우미 다운로드</a>
    <ol className="mt-3 list-inside list-decimal space-y-2 text-xs leading-5 text-slate-300">
      <li>다운로드한 ZIP 파일의 압축을 풉니다.</li>
      <li>Chrome 주소창에 <code>chrome://extensions</code>를 입력하고 ‘개발자 모드’를 켭니다.</li>
      <li>‘압축해제된 확장 프로그램을 로드합니다’에서 압축을 푼 폴더를 선택합니다.</li>
    </ol>
    <p className="mt-3 text-xs text-slate-400">지원 브라우저: PC Chrome · 연결 대상: anime-eight-virid.vercel.app, reanime.to</p>
  </aside>;
}
