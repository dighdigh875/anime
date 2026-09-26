import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', {url: 'http://localhost/'});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() { this.callback([{contentRect: {width: 800, height: 450}}]); }
  disconnect() {}
};
const React = await import('react');
const {createRoot} = await import('react-dom/client');
const {default: IframePlayer} = await import('../src/components/IframePlayer.tsx');

async function mount(mirror) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({success: true, setting: null});
  const container = document.getElementById('root');
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(IframePlayer, {
    animeId: 're_test', animeTitle: '작품', episodeNumber: 12, initialSubtitles: [],
    embedUrl: 'https://reanime.to/watch/test?ep=12', allowNestedPlayback: mirror,
  })));
  return {container, cleanup: async () => {await React.act(async () => root.unmount()); globalThis.fetch = originalFetch;}};
}
function button(container, label) {
  const found = [...container.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label);
  assert.ok(found, `Missing button: ${label}`);
  return found;
}
test('mirror framing and adjustments keep the same iframe element and subtitle canvas', async () => {
  const ui = await mount(true);
  try {
    const frame = ui.container.querySelector('iframe');
    const source = frame.src;
    const canvas = ui.container.querySelector('canvas');
    assert.equal(button(ui.container, '영상만 보기').getAttribute('aria-pressed'), 'true');
    const cropped = frame.style.transform;
    assert.match(cropped, /scale/);
    await React.act(async () => button(ui.container, '원본 화면').click());
    assert.equal(frame.style.transform, '');
    await React.act(async () => button(ui.container, '영상만 보기').click());
    await React.act(async () => button(ui.container, '화면 조절').click());
    await React.act(async () => button(ui.container, '영상 확대').click());
    assert.notEqual(frame.style.transform, cropped);
    await React.act(async () => button(ui.container, '화면 위치 초기화').click());
    assert.equal(frame.style.transform, cropped);
    assert.equal(ui.container.querySelector('iframe'), frame);
    assert.equal(frame.src, source);
    assert.equal(ui.container.querySelector('canvas'), canvas);
  } finally {await ui.cleanup();}
});
test('direct video embeds retain their full-frame presentation', async () => {
  const ui = await mount(false);
  try {
    assert.equal(ui.container.textContent.includes('영상만 보기'), false);
    assert.equal(ui.container.querySelector('iframe').style.transform, '');
  } finally {await ui.cleanup();}
});
