# Anihub Reanime 연결 도우미

Reanime가 다른 사이트에서 원본 페이지를 iframe으로 여는 것을 차단해, 영상 플레이어 주소를 PC에서 조회하는 Chrome 확장 기능입니다. 영상과 자막은 기존 Anihub 플레이어에서 재생합니다.

## 설치

1. ZIP을 압축 해제합니다. `manifest.json`이 들어 있는 폴더를 사용합니다.
2. Chrome 주소창에 `chrome://extensions`를 입력합니다.
3. 오른쪽 위 `개발자 모드`를 켭니다.
4. `압축해제된 확장 프로그램을 로드합니다`를 누르고 1번 폴더를 선택합니다.
5. Anihub 페이지를 새로고침한 다음 회차를 재생합니다.

이 폴더를 삭제하거나 이동하면 확장 기능이 동작하지 않을 수 있습니다. 업데이트할 때는 파일을 교체한 뒤 확장 프로그램 화면의 새로고침을 누르고 Anihub도 새로고침합니다.

## 접근 범위

- `https://anime-eight-virid.vercel.app/*`: 이 사이트의 영상 주소 요청을 전달합니다.
- `https://reanime.to/*`: `/api/flix/{작품번호}/{회차}`의 공개 JSON만 조회합니다. 로그인 쿠키를 보내지 않습니다.
- 임의 URL, 비밀번호, 시청 기록을 수집하거나 저장하지 않습니다. `cookies`, `tabs`, `webRequest`, `<all_urls>` 권한을 요청하지 않습니다.
- Reanime의 화면 삽입 정책이나 브라우저 보안 설정을 변경하지 않습니다. 응답 중 `flixcloud.cc/e/...` 영상 주소와 언어·서버 이름만 전달합니다.

Reanime 원본 사이트나 영상 서버가 중단되면 이 도우미로도 재생할 수 없습니다. 다른 Anihub 배포 도메인에서는 동작하지 않습니다. 도메인을 이전하면 `manifest.json`, `content.js`, `background.mjs`의 허용 사이트를 함께 수정해야 합니다.
