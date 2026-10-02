import {readFile,mkdir,writeFile} from 'node:fs/promises';
import AdmZip from 'adm-zip';
const root=new URL('../',import.meta.url);
const zip=new AdmZip();
for (const name of ['manifest.json','background.mjs','content.js','README.md']) {
  zip.addFile(name,await readFile(new URL(`extensions/reanime-bridge/${name}`,root)));
}
await mkdir(new URL('public/downloads/',root),{recursive:true});
await writeFile(new URL('public/downloads/anihub-reanime-bridge.zip',root),zip.toBuffer());
console.log('Packaged public/downloads/anihub-reanime-bridge.zip');
