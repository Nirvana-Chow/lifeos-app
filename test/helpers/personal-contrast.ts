export type ContrastLayer={backgroundColor:string;backgroundImage?:string;mixBlendMode?:string;backgroundBlendMode?:string;opacity?:string;filter?:string;backdropFilter?:string};
/** Computed sRGB only. Layers are nearest-first; no assumed canvas/body fallback. */
export function renderedContrast(foreground:string,layers:ContrastLayer[]){
 type RGBA=[number,number,number,number];
 const parse=(value:string):RGBA=>{
  const fail=():never=>{throw Error('CONTRAST_UNSUPPORTED_COLOR');};
  const color=value.trim().toLowerCase();if(color==='transparent')return [0,0,0,0];
  if(/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.test(color)){
   let hex=color.slice(1);if(hex.length<=4)hex=hex.split('').map(c=>c+c).join('');
   return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),hex.length===8?parseInt(hex.slice(6),16)/255:1];
  }
  const match=/^rgba?\(([^()]+)\)$/.exec(color);if(!match)return fail();
  const body=match[1],parts=body.includes(',')?body.split(',').map(v=>v.trim()):body.trim().split(/\s*\/\s*|\s+/);
  if(parts.length!==3&&parts.length!==4)return fail();
  const number=(part:string,max:number)=>{
   if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(part))return fail();
   const result=parseFloat(part)*(part.endsWith('%')?max/100:1);if(result<0||result>max)return fail();return result;
  };
  return [number(parts[0],255),number(parts[1],255),number(parts[2],255),parts[3]===undefined?1:number(parts[3],1)];
 };
 // These effects need a richer renderer; never substitute a passing default.
 for(const layer of layers){
  if((layer.backgroundImage??'none')!=='none'||(layer.mixBlendMode??'normal')!=='normal'||(layer.backgroundBlendMode??'normal')!=='normal'||Number(layer.opacity??'1')!==1||(layer.filter??'none')!=='none'||(layer.backdropFilter??'none')!=='none')throw Error('CONTRAST_UNSUPPORTED_EFFECT');
 }
 const colors=layers.map(layer=>parse(layer.backgroundColor)),opaque=colors.findIndex(c=>c[3]===1);
 if(opaque<0)throw Error('CONTRAST_BACKGROUND_UNRESOLVED');
 const over=(source:RGBA,backdrop:RGBA):RGBA=>{
  const alpha=source[3]+backdrop[3]*(1-source[3]);
  return [0,1,2].map(i=>(source[i]*source[3]+backdrop[i]*backdrop[3]*(1-source[3]))/alpha).concat(alpha) as RGBA;
 };
 let background=colors[opaque];for(let i=opaque-1;i>=0;i--)background=over(colors[i],background);
 const fg=parse(foreground),ink=over(fg,background);
 const luminance=(color:RGBA)=>{const c=color.slice(0,3).map(value=>{const n=value/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 const values=[luminance(ink),luminance(background)].sort((a,b)=>a-b);
 return {contrast:(values[1]+.05)/(values[0]+.05),background:background.slice(0,3),backgroundAlpha:background[3],foregroundAlpha:fg[3]};
}
