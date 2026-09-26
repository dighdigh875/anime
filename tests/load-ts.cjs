const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function loadTs(relative, stubs = {}, cache = new Map()) {
  const file = path.resolve(relative);
  if (cache.has(file)) return cache.get(file).exports;
  const m = new Module(file, module);
  cache.set(file, m);
  const regular = Module.createRequire(file);
  m.require = id => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (id.startsWith('@/') || id.startsWith('.')) {
      const location = id.startsWith('@/') ? path.resolve('src', id.slice(2)) : path.resolve(path.dirname(file), id);
      const local = [location,location+'.ts',location+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
      if (local) return loadTs(local,stubs,cache);
    }
    return regular(id);
  };
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
  return m.exports;
}
module.exports = {loadTs};
