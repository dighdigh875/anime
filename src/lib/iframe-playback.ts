// Reanime embeds FlixCloud inside its watch page. Window.frames and postMessage
// are available across origins; reading the nested document is neither needed nor allowed.
const NESTED_PLAYER_ORIGIN = 'https://flixcloud.cc';

function descendants(root: Window): Window[] {
  const result: Window[] = [];
  const queue = [{frame: root, depth: 0}];
  const seen = new Set<Window>([root]);
  while (queue.length && result.length < 16) {
    const item = queue.shift()!;
    if (item.depth >= 2) continue;
    try {
      for (let i = 0; i < Math.min(item.frame.frames.length, 8) && result.length < 16; i++) {
        const child = item.frame.frames[i];
        if (!child || seen.has(child)) continue;
        seen.add(child);
        result.push(child);
        queue.push({frame: child, depth: item.depth + 1});
      }
    } catch { /* The frame may have been removed during navigation. */ }
  }
  return result;
}

export function pollPlaybackTime(root: Window, embedOrigin: string, nested: boolean): void {
  try { root.postMessage({command: 'getTime'}, embedOrigin); } catch {}
  if (nested) {
    for (const frame of descendants(root)) {
      try { frame.postMessage({command: 'getTime'}, NESTED_PLAYER_ORIGIN); } catch {}
    }
  }
}

export function isPlaybackMessage(event: MessageEvent, root: Window, embedOrigin: string, nested: boolean): boolean {
  if (!event.data || typeof event.data !== 'object') return false;
  if (event.source === root) return event.origin === embedOrigin;
  return nested && event.origin === NESTED_PLAYER_ORIGIN && descendants(root).some(frame => event.source === frame);
}
