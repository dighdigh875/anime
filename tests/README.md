# Playback checks

`npm test` runs deterministic tests without external services. UI tests simulate server failures, browser metadata responses, DB state and subtitle responses. Bridge tests check exact origins, actual iframe descendants, detached players, and the absence of a cross-origin browser stream API request.

`node --import ./tests/register.mjs tests/live-reanime.mjs` is an opt-in live check for Anissia 3440 / Chainsmoker Cat episode 12. It checks exact title/year matching, episode availability, real Korean subtitle validation, and then the stream URL. It runs in Node, so it does not test browser CORS or Vercel egress.

## Deployment verification

1. Search `ヤニねこ` on `/korean/3440`, select the TV season, save the mapping, and reload to check restoration.
2. Choose episode 12 and prepare subtitles. No stream request or iframe should appear before successful subtitle validation.
3. When the server returns `REANIME_UNAVAILABLE`, search/detail retry from the browser. Stream lookup instead restores the original Reanime watch-page iframe, because `/api/flix/...` does not permit browser CORS.
4. In mirror mode, turn off Reanime's **Auto Next**, use a SUB server (HD-1 worked in the local check), and click Play if autoplay is blocked. Check that the app's subtitle clock follows the video and Korean dialogue appears.
5. Use the app's outer fullscreen button to keep the Korean overlay visible. For another episode, use the app's **자막 회차** selector and prepare subtitles again.

## Verified boundary and limitations

On 2026-09-26/27, Chrome loaded real Reanime search/detail/episode metadata after simulated server failures. A temporary local page supplied subtitles previously fetched and validated by the actual server helper. With the stream server failure also simulated, the production client mounted the Reanime watch page, received real nested FlixCloud time replies, advanced from 06:30 to 06:39 and beyond, and displayed Korean dialogue. The temporary page and subtitle fixture are not committed. Authenticated deployment/DB and Vercel egress must still be checked after deployment.

The nested bridge is limited to the current iframe's descendants at `https://flixcloud.cc`; unknown origins are rejected. Third-party domain/protocol changes may require an update. No browser security settings are disabled.

The full watch page retains its own controls. **Auto Next defaults on**, and changing episodes inside it bypasses this app's subtitle preparation and keeps the initially selected subtitle/history metadata. Turn Auto Next off and change episodes in this app. The parent cannot reliably inspect or prevent the cross-origin page's internal navigation. Fullscreen entered inside the source page can also exclude the Korean overlay; use the outer fullscreen control. This fallback verifies the episode selected in this app, not arbitrary later navigation inside Reanime.

## Video-only mirror viewport

Mirror mode starts with **영상만 보기**. It keeps the embedded page at a 960px layout width, below Reanime's sidebar breakpoint, and scales a 16:9 crop to the local player. The preset comes from the fetched watch-page HTML/CSS: 8px side padding and a video top of 106.5px. It is not a live measurement of the cross-origin document.

- **원본 화면** exposes the source controls, including server selection and Auto Next. If you scroll that page, return it to the top before switching back to the cropped view.
- **화면 조절** changes zoom and position; **화면 위치 초기화** restores the preset. Toggling and adjustment retain the existing iframe, URL and subtitle canvas.
- After deployment, check an episode with an available subtitle at desktop and mobile widths, and check portrait/landscape fullscreen. Verify that the video's edges and controls remain visible and the Korean subtitle overlays the video. Third-party banners or layout changes may require adjustment.

The viewport tests use JSDOM and simulated parent dimensions to check UI state and iframe preservation. They do not render Reanime or prove crop alignment, playback continuity, subtitle acquisition, or fullscreen appearance. Initial visual verification of this viewport change was blocked by browser tooling; that connection has since been restored.

## Subtitle rendering and title punctuation regression checks

`subtitle-rendering-ui.test.mjs` mounts the production iframe player with synthetic subtitles and simulated video-time messages. It checks SRT/VTT color, nested emphasis, entities, line breaks, and rejection of active HTML. At the external WASM boundary, a renderer double checks explicit canvas dimensions on resize, fullscreen, DPR change and cleanup. It does not prove font appearance or automatic subtitle acquisition.

On 2026-09-27, a temporary localhost page additionally loaded the production player and the real bundled libass worker/font with **synthetic ASS and SRT/VTT subtitles**. Chrome visibly rendered sharp Korean ASS text, colored and italic SRT text, and preserved line breaks. Canvas backing dimensions followed the displayed surface: 1102×619 normally, 378×212 at a narrow width, 756×424 at DPR 2, and 1438×943 in fullscreen. The temporary clock iframe, test page and viewport override were removed after verification. This is a rendering check, not a test of downloading subtitles or authenticated Vercel playback.

The same local page called the production search helper against the live Reanime API from Chrome: `無職転生Ⅲ〜異世界行ったら本気だす〜` returned an empty result, then `無職転生Ⅲ異世界行ったら本気だす` returned **Mushoku Tensei: Jobless Reincarnation Season 3**. Both requests returned HTTP 200. Search tests also cover preserving season numerals, ranking, original successful results and connection errors. The fallback is shared by server and browser; Vercel egress remains deployment-dependent.
