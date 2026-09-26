function msToTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const remMs = ms % 1000;
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(remMs).padStart(3, "0")}`;
}

// 6. SMI/SRT to WebVTT converter
export function convertToVtt(rawText: string, origExt: string): { content: string; ext: string } {
  const lowerExt = origExt.toLowerCase();
  if (/^\uFEFF?WEBVTT(?:\s|$)/.test(rawText)) return {content: rawText, ext: '.vtt'};
  if (lowerExt === ".ass" || lowerExt === ".ssa") {
    return { content: rawText, ext: ".ass" };
  }

  const lowerText = rawText.toLowerCase();

  // SAMI (.smi) Parser
  if (lowerExt === ".smi" || lowerText.includes("<sync") || lowerText.includes("<sami")) {
    const matches: Array<{ startMs: number; text: string }> = [];
    const syncRegex = /<SYNC\s+Start=(\d+)>(?:<P[^>]*>)?([\s\S]*?)(?=<SYNC|$)/gi;
    let m: RegExpExecArray | null;

    while ((m = syncRegex.exec(rawText)) !== null) {
      const startMs = parseInt(m[1], 10);
      let clean = m[2].replace(/<br\s*\/?>/gi, "\n");
      clean = clean.replace(/<(?!(\/)?(?:font|i|b|u)\b)[^>]+>/gi, "").trim();
      clean = clean.replace(/&nbsp;/gi, " ").trim();
      if (clean && clean.toLowerCase() !== "&nbsp;") {
        matches.push({ startMs, text: clean });
      }
    }

    if (matches.length > 0) {
      const lines = ["WEBVTT", ""];
      for (let i = 0; i < matches.length; i++) {
        const item = matches[i];
        const endMs = i + 1 < matches.length ? matches[i + 1].startMs : item.startMs + 3000;
        lines.push(`${msToTime(item.startMs)} --> ${msToTime(endMs)}`);
        lines.push(item.text);
        lines.push("");
      }
      return { content: lines.join("\n"), ext: ".vtt" };
    }
  }

  // SRT Parser
  if (lowerExt === ".srt" || rawText.includes("-->")) {
    const vtt = "WEBVTT\n\n" + rawText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    return { content: vtt, ext: ".vtt" };
  }

  return { content: rawText, ext: origExt };
}
