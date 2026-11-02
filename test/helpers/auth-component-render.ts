import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const native=createRequire(import.meta.url);
/** Execute the real components with React; only the CSS loader is replaced. */
export function renderAuthComponent(path:string,name:string,props:Record<string,unknown>,layoutPath?:string):string{
 const cache=new Map<string,Record<string,unknown>>();
 function load(file:string):Record<string,unknown>{
  const hit=cache.get(file);if(hit)return hit;const module={exports:{} as Record<string,unknown>};cache.set(file,module.exports);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)((key:string)=>{
   if(key.endsWith('.css'))return {__esModule:true,default:{}};
   if(!key.startsWith('.'))return native(key);
   const base=resolve(dirname(file),key),found=[base,base+'.tsx',base+'.ts'].find(candidate=>existsSync(candidate));if(!found)throw Error('Component dependency unavailable');return load(found);
  },module,module.exports);return module.exports;
 }
 const component=load(resolve(path))[name] as React.ComponentType<any>,element=React.createElement(component,props);
 const layout=layoutPath?load(resolve(layoutPath)).default as React.ComponentType<any>:null;return renderToStaticMarkup(layout?React.createElement(layout,null,element):element);
}
