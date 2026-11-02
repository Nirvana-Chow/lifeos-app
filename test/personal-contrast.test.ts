import test from 'node:test';
import assert from 'node:assert/strict';
import {renderedContrast,type ContrastLayer} from './helpers/personal-contrast.ts';
const bg=(backgroundColor:string):ContrastLayer=>({backgroundColor});
const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<.0001,JSON.stringify({actual,expected}));
test('transparent search controls inherit the real light and dark ancestor backgrounds',()=>{
 const light=renderedContrast('rgb(24, 24, 27)',[bg('rgba(0, 0, 0, 0)'),bg('transparent'),bg('rgb(250, 250, 250)')]);
 close(light.contrast,16.973895);assert.deepEqual(light.background,[250,250,250]);
 const dark=renderedContrast('rgb(250, 250, 250)',[bg('rgba(0, 0, 0, 0)'),bg('rgb(9, 9, 11)')]);close(dark.contrast,19.061122);
});
test('nearest-first layers use source-over and translucent foreground is measured after compositing',()=>{
 const result=renderedContrast('rgb(0 0 0 / 50%)',[bg('rgb(255 0 0 / .5)'),bg('rgba(0, 0, 255, .5)'),bg('#fff')]);
 assert.deepEqual(result.background,[191.25,63.75,127.5]);assert.equal(result.foregroundAlpha,.5);assert.equal(result.backgroundAlpha,1);
 close(renderedContrast('rgba(0,0,0,.5)',[bg('#ffffff')]).contrast,3.976653);
});
test('opaque RGB and hex retain known WCAG ratios, with genuinely low contrast still below 4.5',()=>{
 close(renderedContrast('rgb(0, 0, 0)',[bg('rgb(255, 255, 255)')]).contrast,21);
 close(renderedContrast('#777',[bg('#fff')]).contrast,4.478089);assert.equal(renderedContrast('#777',[bg('#fff')]).contrast>=4.5,false);
});
test('unknown colors, unbacked alpha and unsupported rendering fail closed',()=>{
 for(const color of ['color(display-p3 1 0 0)','oklch(.5 .2 30)','rgb(NaN,0,0)','rgb(0,0,0) private'])assert.throws(()=>renderedContrast(color,[bg('#fff')]),/CONTRAST_UNSUPPORTED_COLOR/);
 assert.throws(()=>renderedContrast('#000',[bg('transparent')]),/CONTRAST_BACKGROUND_UNRESOLVED/);
 for(const change of [{backgroundImage:'linear-gradient(red,blue)'},{mixBlendMode:'multiply'},{backgroundBlendMode:'screen'},{opacity:'.5'},{filter:'blur(1px)'},{backdropFilter:'blur(1px)'}])assert.throws(()=>renderedContrast('#000',[{...bg('#fff'),...change}]),/CONTRAST_UNSUPPORTED_EFFECT/);
});
