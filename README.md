# 애니메이션 스트리밍 플레이어 (Anime Streaming Player)

Next.js 15 App Router와 Vercel Serverless, Neon Postgres를 기반으로 구축된 고성능 애니메이션 웹 스트리밍 플레이어입니다.

## 한국어 자막을 먼저 확인하는 재생 방식

기본 화면은 **애니시아 한글 작품 선택 → 같은 작품·시즌의 Reanime 영상 연결 → 해당 회차 자막 파일 확인 → 영상과 함께 재생** 순서로 진행합니다.

1. 편성표 또는 한글 제목 검색에서 작품을 선택합니다.
2. `영상 찾기`를 누르고 후보의 원제·방영 연도·시즌을 확인해 연결합니다. 일치하는 후보를 먼저 표시하지만 자동 확정하지 않습니다.
3. 회차 번호가 다르면 `회차 차이`를 지정합니다. 자막 1화가 영상 13화라면 `12`, 자막 단편 0이 영상 1화라면 `1`입니다. 연결은 로그인 계정별로 DB에 저장합니다.
4. 회차를 골라 `자막 확인 후 재생`을 누릅니다. 실제 파일의 한국어 대사·시간 구간·회차 단서를 확인한 뒤 플레이어를 엽니다.
5. 자동 수집에 실패하면 제작자 게시물을 확인하거나 `자막 직접 선택`으로 ASS/SSA/SRT/SMI/VTT 파일을 불러옵니다. 직접 선택하는 파일은 최대 2MB입니다.

애니시아의 자막 등록 표시는 최신 제작자 게시물 정보이며, 원하는 회차 파일의 다운로드 성공을 뜻하지 않습니다. 블로그 구조·접근 제한·첨부파일 삭제에 따라 수집이 실패할 수 있습니다. 시간 초과와 파일 미확보를 구분하며, 일부 검색이 늦어져도 이미 확보한 자막은 유지합니다.

파일 검증만으로 번역 내용이나 영상과의 시간 싱크를 보장할 수는 없습니다. 재생 중 싱크 조절 기능을 사용할 수 있으며, 영상 iframe 제공자가 재생 시간 메시지를 지원해야 외부 자막이 시간에 맞춰 표시됩니다.

한글 재생 화면에서 남긴 시청 기록과 다음 회차 바로가기는 다시 자막 확인 화면으로 연결됩니다. `기존 영상 목록`이나 소스 선택 메뉴에서는 기존 Reanime/Linkkf/Ohli24 탐색 흐름을 사용할 수 있습니다.

작품·제작자 정보 출처: [애니시아](https://anissia.net/).

---

## 🚀 Vercel 원클릭 배포 및 시작하기

Vercel에 Next.js 앱을 배포하고 Neon Postgres를 연결해 사용합니다. 작품 연결·계정·시청 기록을 저장하려면 DB가 필요합니다.

### 1. 원클릭 배포 (Deploy to Vercel)
수정본을 계속 업데이트하려면 Vercel에서 GitHub 저장소 `dighdigh875/anime`을 Import하세요. Framework Preset은 Next.js, Root Directory는 저장소 루트입니다. 별도 복제 배포에는 아래 버튼을 사용할 수 있습니다.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/dighdigh875/anime)

> 🔗 **원클릭 배포 주소**:  
> [Vercel에서 수정본 배포하기](https://vercel.com/new/clone?repository-url=https://github.com/dighdigh875/anime)

### 2. 데이터베이스 연결
1. 배포 완료 후 Vercel 프로젝트 대시보드 상단의 **`Storage`** 탭을 클릭합니다.
2. **`Create Database` ➔ `Neon (Postgres)`**을 선택하고 **`Continue`**를 누릅니다.
3. 연결 후 `DATABASE_URL` 또는 `POSTGRES_URL` 환경 변수가 배포 환경에 등록되어 있는지 확인하고 **재배포**합니다. 직접 만든 Neon DB의 연결 문자열을 환경 변수에 설정해도 됩니다.

공식 안내: [Vercel GitHub 연결](https://vercel.com/docs/git/vercel-for-github), [Neon 연동](https://vercel.com/marketplace/neon/neon).

### 3. 세션 보안 키 (Zero-Config)
- `AUTH_SECRET`을 별도로 설정할 수 있습니다. 미설정 시 DB 연결 문자열에서 서명 키를 파생합니다. DB 접속 정보가 변경되면 기존 로그인 세션이 만료될 수 있습니다.

### 4. 테이블 자동 생성 및 초기 관리자 설정
- 배포 완료 후 사이트에 접속하면 필요한 모든 DB 테이블(시청 기록, 즐겨찾기, 오디오 스킵, 유저 계정 등)이 **자동으로 생성**됩니다.
- 최초 접속 시 `/setup` 마법사 페이지로 자동 이동하며, 마스터 관리자 계정을 1회 생성하면 즉시 서비스를 이용하실 수 있습니다.

---

## ✨ 주요 기능

### 1. 실시간 스트리밍 & CORS 우회
- **HLS 스트리밍 지원**: `ArtPlayer`와 `Hls.js`를 결합하여 끊김 없는 고화질 m3u8 스트리밍 제공
- **서버리스 프록시**: 외부 m3u8 재생목록 및 세그먼트, 자막에 대한 CORS/Referer 우회 프록시 파이프라인 내장

### 2. 고성능 자막 크롤링 & WASM 렌더링
- **libass WebAssembly (SubtitlesOctopus)**: 브라우저 환경에서 화려한 효과의 `.ass` 자막을 원본 그대로 고해상도 렌더링
- **온디맨드 자막 수집**: 애니시아(Anissia) 및 외부 자막 블로그 크롤링 & 직다운로드
- **다양한 포맷 실시간 변환**: SMI / SRT 포맷 인메모리 압축 해제 및 WebVTT 실시간 변환
- **자막 편의 기능**: 실시간 자막 선택 및 싱크 미세 조정 (±0.1s, ±0.5s)

### 3. 스마트 오프닝/엔딩 스킵
- **AniSkip 연동**: 글로벌 애니메이션 타임스탬프 DB를 조회하여 오프닝/엔딩 자동 스킵
- **플레이어 타임라인 하이라이트**: 프로그레스 바에 오프닝/엔딩 구간 시각화
- **수동 스킵 폴백**: 미등록 작품 시 플레이어 상시 `+85s 스킵` 버튼 및 초반부 플로팅 건너뛰기 제안

### 4. 고도화된 플레이어 및 회차 탐색 UX
- **장편 애니 완벽 대응**: 50화 단위 구간 선택 탭, 회차 번호 직접 입력 점프, 오름차순/내림차순 정렬
- **인플레이어(In-Player) 탐색**: 전체화면이나 재생 중에도 하단 회차 리스트에서 즉시 회차 변경
- **자막/더빙 분기 스위치**: 더빙이 존재하는 회차는 원클릭으로 판본 전환 가능
- **신규 회차 감지 (NEW 뱃지)**: 완주한 방영작에 새 회차가 업데이트되면 시청 기록에서 자동으로 인식 및 강조

### 5. 멀티 디바이스 시청 동기화 & 보안
- **클라우드 이어보기**: Neon Serverless Postgres 기반으로 모바일, 태블릿, PC 간 실시간 시청 진도율 자동 동기화
- **마스터 관리자 설정 마법사 (`/setup`)**: 첫 배포 시 관리자 계정을 직접 생성하여 사이트를 비공개 보호
- **안전한 인증 체계**: Node.js `scrypt` 기반 단방향 해싱 및 암호화 세션 쿠키 인증

---

## 🛠 기술 스택

| 영역 | 기술 |
| :--- | :--- |
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Lucide React |
| **Player** | ArtPlayer, Hls.js, SubtitlesOctopus (libass WASM) |
| **Backend** | Next.js Serverless API Routes, Cheerio, Adm-zip, Iconv-lite |
| **Database** | Neon Serverless PostgreSQL (`@neondatabase/serverless`) |
| **Deploy** | Vercel (Region: `icn1` 서울) |

---

## ⚙️ 추가 환경 변수 (선택 사항)

외부 소스 미러 도메인 주소가 바뀔 경우에만 Vercel 환경 변수에 등록합니다:

```env
# 선택: 외부 소스 미러 도메인 변경 시
# LINKKF_BASE_URL=https://...
```

## 개발 및 검증

Node.js 22.13 이상을 사용하고 `.env.local`에 본인의 DB 연결 정보를 설정합니다.

```sh
npm ci
npm run dev
```

```sh
npm test
npm run typecheck
npm run build
```

테스트는 한국어 자막 검사, 작품 후보 정렬, 회차 선택, CP949/SMI/VTT/ZIP 처리, 시간 초과 시 부분 결과 보존, 시청 기록의 회차 이동, 자막 검증 전후 플레이어 표시 조건을 확인합니다. UI 테스트는 모의 네트워크 응답을 사용하며 실제 외부 영상 재생을 확인하는 테스트는 아닙니다.

로컬과 Vercel의 외부 서비스 접근 조건은 다를 수 있습니다. 배포 후 작품 연결 저장, 회차 자막 다운로드, 영상 재생, 자막 싱크를 확인하세요. 모든 작품의 자막 확보를 보장하지 않습니다.
