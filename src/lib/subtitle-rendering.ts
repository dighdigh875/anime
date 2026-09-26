// Build a small, inert subset of subtitle markup. Never insert subtitle HTML.
const ENTITIES: Record<string, string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',lrm:'\u200e',rlm:'\u200f'};
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|lrm|rlm);/gi, (entity, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity;
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2),16) : parseInt(code.slice(1),10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
  });
}

export function subtitleFragment(text: string, doc: Document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const stack: Array<{tag: string; node: DocumentFragment | HTMLElement}> = [{tag:'',node:fragment}];
  // Ignore executable/style blocks entirely; no DOM parser or resource loading.
  const source = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const tokens = source.split(/(<\/?[a-z][^>]*>|<\d{2}:\d{2}(?::\d{2})?\.\d{3}>)/gi);
  for (const token of tokens) {
    const parent = stack[stack.length - 1].node;
    const tag = /^<(\/?)([a-z]+)(?=[.\s/>])[^>]*>$/i.exec(token);
    if (!tag) {
      if (!/^<\d{2}:/.test(token)) parent.appendChild(doc.createTextNode(decodeEntities(token)));
      continue;
    }
    const name = tag[2].toLowerCase();
    if (tag[1]) {
      for (let i=stack.length-1;i>0;i--) {
        if (stack[i].tag === name) {stack.length=i;break;}
      }
      continue;
    }
    if (name === 'br') {parent.appendChild(doc.createTextNode('\n'));continue;}
    if (!['b','i','u','font','c'].includes(name)) continue;
    const element = doc.createElement(name === 'font' || name === 'c' ? 'span' : name);
    const color = name === 'font'
      ? /\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token)?.slice(1).find(v=>v !== undefined)
      : name === 'c' ? /^<c\.(white|lime|cyan|red|yellow|magenta|blue|black)>$/i.exec(token)?.[1] : undefined;
    // CSS color values only; discard every other attribute, URL and style.
    if (color && /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+)$/i.test(color)) element.style.color=color;
    parent.appendChild(element);
    stack.push({tag:name,node:element});
  }
  return fragment;
}

export function observeAssCanvasSize(surface: HTMLElement, renderer: {resize(width: number, height: number): void}): () => void {
  let lastWidth=0, lastHeight=0;
  const resize = () => {
    const rect=surface.getBoundingClientRect(), ratio=window.devicePixelRatio || 1;
    const width=Math.round(rect.width * ratio), height=Math.round(rect.height * ratio);
    if (width <= 0 || height <= 0 || (width === lastWidth && height === lastHeight)) return;
    // A canvas-only libass instance cannot infer video dimensions itself.
    renderer.resize(width,height);
    lastWidth=width; lastHeight=height;
  };
  const observer=typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
  observer?.observe(surface);
  window.addEventListener('resize',resize);
  document.addEventListener('fullscreenchange',resize);
  let media: MediaQueryList | undefined;
  const watchRatio = () => {
    media?.removeEventListener('change',watchRatio);
    media=window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    media?.addEventListener('change',watchRatio);
    resize();
  };
  watchRatio();
  return () => {
    observer?.disconnect();
    media?.removeEventListener('change',watchRatio);
    window.removeEventListener('resize',resize);
    document.removeEventListener('fullscreenchange',resize);
  };
}
