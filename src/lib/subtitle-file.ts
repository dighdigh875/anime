function timestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds/3600)).padStart(2,"0")}:${String(Math.floor(seconds/60)%60).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}.${String(ms%1000).padStart(3,"0")}`;
}

export function readSubtitleFile(bytes: Uint8Array, filename: string): {content:string;is_ass:boolean} {
  if (bytes.length > 5 * 1024 * 1024) throw new Error("자막 파일은 5MB 이하로 선택해주세요.");
  let text: string;
  try { text = new TextDecoder("utf-8",{fatal:true}).decode(bytes); }
  catch { text = new TextDecoder("euc-kr",{fatal:true}).decode(bytes); }
  text = text.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n");
  if (!text.trim() || /<!doctype\s+html|<html\b/i.test(text) || (/<head\b/i.test(text) && !(/\.smi$/i.test(filename) && /<sami\b/i.test(text)))) throw new Error("정상적인 자막 파일이 아닙니다.");
  if (/\.(ass|ssa)$/i.test(filename)) {
    if (!/^Dialogue:/im.test(text)) throw new Error("ASS 자막에 시간 정보가 없습니다.");
    return {content:text,is_ass:true};
  }
  if (/\.smi$/i.test(filename)) {
    const matches = [...text.matchAll(/<sync\b[^>]*\bstart\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)(?=<sync\b|$)/gi)];
    const lines = ["WEBVTT",""];
    matches.forEach((m,index)=>{
      const content = m[2].replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").trim();
      const start = Number(m[1]), end = index+1<matches.length ? Number(matches[index+1][1]) : start+3000;
      if (content && end>start) lines.push(`${timestamp(start)} --> ${timestamp(end)}`,content,"");
    });
    text = lines.join("\n");
  } else {
    text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g,"$1.$2");
    if (!text.startsWith("WEBVTT")) text = `WEBVTT\n\n${text}`;
  }
  if (!/\d{2}:\d{2}(?:\.\d+)?\s*-->\s*/.test(text)) throw new Error("자막에 재생 시간 정보가 없습니다.");
  return {content:text,is_ass:false};
}

export function parseVttCues(text: string): {start:number;end:number;text:string}[] {
  const cues: {start:number;end:number;text:string}[] = [];
  const time = (value: string) => value.replace(",", ".").split(":").reduce((sum,part)=>sum*60+Number(part),0);
  for (const block of text.replace(/\r\n?/g,"\n").split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const index = lines.findIndex(line=>/^(?:\d+:)?\d{2}:\d{2}[.,]\d+\s*-->/.test(line.trim()));
    if (index < 0) continue;
    const match = lines[index].trim().match(/^((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)/);
    if (!match) continue;
    const start = time(match[1]), end = time(match[2]);
    const content = lines.slice(index+1).join("\n").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();
    if (content && Number.isFinite(start) && end>start) cues.push({start,end,text:content});
  }
  return cues;
}
