import type { FxPass, UniformValue } from '../runtime.js';
import { studyGlyphTexture, studyGlyphGLSL } from './studyGlyphs.js';

type Params = Record<string, unknown>;
type StudyPass = FxPass & { textureData?: Record<string, { width: number; height: number; data: Uint8Array }> };

const n = (p: Params, key: string, fallback: number, lo = -1e6, hi = 1e6) => {
  const value = p[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
};
const b = (p: Params, key: string, fallback = false) => typeof p[key] === 'boolean' ? p[key] as boolean : fallback;
const s = (p: Params, key: string, fallback: string) => typeof p[key] === 'string' ? (p[key] as string).slice(0, 512) : fallback;
const color = (p: Params, key: string, fallback: string): number[] => {
  const raw = s(p, key, fallback).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(raw);
  const hex = m?.[1] ?? fallback.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
};
const vec3 = (v: number[]) => `vec3(${v.map((x) => x.toFixed(5)).join(',')})`;
const f = (x: number) => Number.isFinite(x) ? x.toFixed(5) : '0.00000';
const uniforms = (time: number, p: Params, frameWidth: number): Record<string, UniformValue> => ({
  u_time: time, u_amount: n(p, 'amount', 1, 0, 2), u_scale: n(p, 'scale', 1, 0.05, 8),
  u_speed: n(p, 'speed', 1, 0, 8), u_frameWidth: frameWidth,
});

const header = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_amount;
uniform float u_scale;
uniform float u_speed;
uniform float u_frameWidth;
out vec4 outColor;
float lum(vec3 c){return dot(c,vec3(0.299,0.587,0.114));}
vec3 grade(vec3 c,float brightness,float contrast,float gamma){
 float y=max(0.0,(lum(c)-0.5)*(1.0+contrast)+0.5+brightness);
 float g=pow(clamp(y,0.0,1.0),1.0/max(0.05,gamma));
 return c*(g/max(lum(c),0.0001));
}
float bayer(vec2 ip,float size){
 float v=0.0; float scale=1.0;
 for(int k=0;k<3;k++){
   float a=mod(ip.x,2.0), b=mod(ip.y,2.0);
   v+=(a==0.0?(b==0.0?0.0:2.0):(b==0.0?3.0:1.0))*scale;
   ip=floor(ip*0.5); scale*=0.25;
   if(size<4.0 && k==0) break;
   if(size<8.0 && k==1) break;
 }
 return v/4.0;
}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
`;

const wordAtlasCache = new Map<string, { width: number; height: number; data: Uint8Array; columns: number; rows: number }>();
function buildWordAtlas(words: string[], fontStyle: string) {
  const key = `${fontStyle}\u0000${words.join('\u0000')}`;
  const cached = wordAtlasCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return undefined;
  const columns = Math.max(1, ...words.map((word) => Array.from(word).length));
  const rows = Math.max(1, words.length);
  const cell = 32;
  const canvas = document.createElement('canvas');
  canvas.width = columns * cell; canvas.height = rows * cell;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#fff';
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = fontStyle === 'monospace' ? '700 22px "JetBrains Mono", monospace' : '600 22px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  words.forEach((word, row) => Array.from(word).forEach((char, column) => context.fillText(char, column * cell + cell / 2, row * cell + cell / 2, cell)));
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  for (let i = 0; i < pixels.length; i += 4) data[i] = data[i + 1] = data[i + 2] = pixels[i + 3], data[i + 3] = 255;
  const result = { width: canvas.width, height: canvas.height, data, columns, rows };
  if (wordAtlasCache.size > 16) wordAtlasCache.delete(wordAtlasCache.keys().next().value!);
  wordAtlasCache.set(key, result);
  return result;
}

function shader(type: string, p: Params): string | undefined {
  const fg = vec3(color(p, type === 'pixelDither' ? 'foregroundColor' : 'foreground', type === 'pixelDither' ? '#d8ff3e' : '#f2f2f2'));
  const bg = vec3(color(p, type === 'pixelDither' ? 'backgroundColor' : 'background', '#161616'));
  const brightness = n(p, 'brightness', 0, -100, 100) / 100;
  const contrast = n(p, 'contrast', 0, -100, 200) / 100;
  const gamma = n(p, 'gamma', 1, 0.05, 5);
  const gradeLine = `vec3 src=texture(u_input,v_texCoord).rgb; vec3 c=grade(src,${f(brightness)},${f(contrast)},${f(gamma)}); float y=lum(c); float px=max(0.05,u_resolution.x/u_frameWidth);`;
  let body = '';
  let declarations = '';
  switch (type) {
    case 'dither': {
      const scale = n(p, 'scale', 14, 1, 256), levels = n(p, 'levels', 4, 2, 16);
      const pat = s(p, 'pattern', 'bayer4');
      const matrix = pat === 'bayer8' ? 8 : pat === 'bayer2' ? 2 : pat === 'bayer4' ? 4 : 0;
      const invert=b(p,'invert',false), noise=n(p,'noise',0,0,1), intensity=n(p,'intensity',1,0,2);
      body = `${gradeLine}
 float cell=max(1.0,${f(scale)}*px/u_scale); vec2 ip=floor(v_texCoord*u_resolution/cell);
 float threshold=${matrix ? `bayer(ip,${f(matrix)})` : 'hash(ip)'}; float tone=${invert?'1.0-y':'y'}; tone=clamp(tone+(hash(ip+u_time*${f(n(p,'animSpeed',1,0,20))})-0.5)*${f(noise)},0.0,1.0);
 float q=floor(tone*${f(levels - 1)}+threshold)/${f(levels - 1)};
 float gap=${f(n(p,'gap',0,0,0.95))}; q=mix(q,0.5,gap);
 vec3 ink=mix(${bg},${fg},q); outColor=vec4(mix(c,ink,clamp(u_amount*${f(intensity)},0.0,1.0)),texture(u_input,v_texCoord).a);`;
      break;
    }
    case 'ascii': case 'asciiGhost': {
      const columns = type === 'ascii' ? n(p,'columns',90,4,720) : Math.max(4,n(p,'columns',Math.round(uScale(p,65)),4,720));
      const hs = type === 'ascii' ? n(p,'heightScale',1,0.2,4) : 1;
      const ramp = s(p,'customRamp','@#8&xo;:,. ');
      const glyphs = type === 'asciiGhost'
        ? (s(p, 'charset', 'dotted') === 'blocks' ? '#*+=-.' : s(p, 'charset', 'dotted') === 'binary' ? '10' : '#*+=;:,. ')
        : ramp;
      const codes = Array.from(glyphs).map(ch => ch.codePointAt(0) ?? 32).filter(code => code >= 32 && code <= 127).slice(0, 96);
      const ghost = type === 'asciiGhost';
      const ghostPhoto = n(p,'photo',0,0,1), ghostText = n(p,'text',1,0,1);
      const ghostFieldPalette = s(p,'fieldPalette','off');
      const ghostPalette = ghostFieldPalette === 'ember'
        ? `mix(vec3(0.10,0.012,0.006),vec3(1.0,0.24,0.025),pow(clamp(cellTone,0.0,1.0),0.72))`
        : `cellColor`;
      const rampLen = Math.max(2, codes.length);
      const selection = codes.slice(0, -1).map((code, i) => `${i ? 'else ' : ''}if(glyphIndex<${f(i + 0.5)}) code=${f(code)};`).join(' ');
      const invert = b(p,'inverted',false);
      body = `${gradeLine}
 float cols=max(4.0,${f(columns)}*u_scale); float rows=max(2.0,round(cols*u_resolution.y/u_resolution.x*${f(hs)}));
 float pxl=max(0.0,${f(n(p,'pixelate',0,0,12))}); cols=max(4.0,cols/(pxl+1.0)); rows=max(2.0,rows/(pxl+1.0));
 vec2 cell=floor(v_texCoord*vec2(cols,rows)); vec2 local=fract(v_texCoord*vec2(cols,rows));
 vec2 sampleUv=(cell+0.5)/vec2(cols,rows); vec3 cellColor=grade(texture(u_input,sampleUv).rgb,${f(brightness)},${f(contrast)},${f(gamma)}); float cellTone=lum(cellColor);
 float density=clamp(pow(max(cellTone,0.0001),${f(n(p,'densityBias',1,0.1,5))})+${f(n(p,'floor',0,0,1))}*0.1,0.0,1.0); float tone=${invert?'1.0-density':'density'}; float glyphIndex=floor(clamp(tone,0.0,1.0)*${f(rampLen-1)}+0.5); float code=${f(codes.at(-1) ?? 65)}; ${selection}
 float coverage=studyGlyph(local,code); float ink=coverage*step(0.025,1.0-tone+${f(n(p,'structure',0.15,0,1))}*0.1);
 vec3 inkColor=${ghost ? `mix(${bg},${ghostPalette},ink)` : s(p,'colorMode','mono') === 'original' ? `mix(${bg},cellColor,ink)` : `mix(${bg},${fg},ink)`};
 ${ghost ? `inkColor=mix(inkColor,cellColor,${f(ghostPhoto)}); inkColor=mix(cellColor,inkColor,${f(ghostText)});` : `inkColor=clamp(inkColor*${f(n(p,'emissiveGain',1,0,8))}+vec3(${f(n(p,'colorLift',0,0,2))}*ink*0.12),0.0,1.0);`}
 vec3 result=mix(c,inkColor,clamp(u_amount,0.0,1.0));
 outColor=vec4(result,texture(u_input,v_texCoord).a);`;
      break;
    }
    case 'halftone': {
      const angle = n(p,'angle',45,-360,360)*Math.PI/180, spacing=n(p,'spacing',18,2,256), dotScale=n(p,'dotScale',1,0.05,4), glow=n(p,'edgeGlow',0,0,1);
      const dotColor=vec3(color(p,'foreground','#ffb54d')), paper=vec3(color(p,'background','#0b0705'));
      body = `${gradeLine}
 float pitch=max(2.0,${f(spacing)}*px/u_scale); float a=${f(angle)}; mat2 rot=mat2(cos(a),-sin(a),sin(a),cos(a));
 vec2 pp=rot*(v_texCoord*u_resolution); vec2 cell=mod(pp+pitch*0.5,pitch)-pitch*0.5;
 float radius=(1.0-y)*pitch*0.5*${f(dotScale)}*(1.0+${f(glow)}*0.6);
 float mask=1.0-smoothstep(radius-0.8*px,radius+0.8*px,length(cell));
 vec3 outRgb=mix(${paper},${dotColor},mask); outColor=vec4(mix(c,outRgb,clamp(u_amount,0.0,1.0)),texture(u_input,v_texCoord).a);`;
      break;
    }
    case 'dithertext': {
      const text=s(p,'text','OPENCHATCUT'), cell=n(p,'cellSize',28,4,256), mode=s(p,'mode','foreground'), threshold=n(p,'textThreshold',0.5,0,3.8), style=s(p,'ditherStyle','bayer4');
      const code=Array.from(text).slice(0,128).map(ch=>ch.codePointAt(0) ?? 32).find(v=>v>=32&&v<=127) ?? 65;
      const matrix=style==='bayer8'?8:style==='bayer2'?2:style==='threshold'?0:4;
      body = `${gradeLine}
 float cell=max(2.0,${f(cell)}*px/u_scale); vec2 ip=floor(v_texCoord*u_resolution/cell); vec2 local=fract(v_texCoord*u_resolution/cell);
 float pattern=${matrix?`bayer(ip,${f(matrix)})`:'hash(ip)'}; float gate=step(${f(threshold/3.8)},y+pattern*0.5);
 float charColumn=mod(ip.x,${f(Math.max(1,Array.from(text).length))}); float textCode=${f(code)}; ${Array.from(text).slice(0,128).map((ch,i)=>{const cp=ch.codePointAt(0)??65;return cp>=32&&cp<=127?`${i?'else ':''}if(charColumn<${f(i+1)}) textCode=${f(cp)};`:''}).join(' ')} float textMask=studyGlyph(local,textCode); ${mode==='background'?'textMask=1.0-textMask;':''}
 float mask=textMask*gate; vec3 ink=mix(${bg},${fg},mask); outColor=vec4(mix(c,ink,clamp(u_amount,0.0,1.0)),texture(u_input,v_texCoord).a);`;
      break;
    }
    case 'pixelDither': {
      const block=n(p,'blockSize',30,2,256), thresholds=[n(p,'thresholdMicro',.2,0,1),n(p,'thresholdLight',.35,0,1),n(p,'thresholdMid',.59,0,1),n(p,'thresholdCore',.84,0,1)];
      body = `${gradeLine}
 float cell=max(2.0,${f(block)}*px/u_scale); vec2 ip=floor(v_texCoord*u_resolution/cell); vec2 uv=(ip+0.5)*cell/u_resolution;
 vec3 sampleColor=grade(texture(u_input,clamp(uv,0.0,1.0)).rgb,${f(brightness)},${f(contrast)},${f(gamma)}); float t=lum(sampleColor);
 float threshold=${thresholds.map((v,i)=>`step(${f(v)},t)*${i+1}.0`).join('+')}; float glyph=studyGlyph(fract(v_texCoord*u_resolution/cell),32.0+threshold*8.0);
 vec3 ink=mix(${bg},${fg},glyph*step(${f(thresholds[0])},t)); outColor=vec4(mix(c,ink,clamp(u_amount,0.0,1.0)),texture(u_input,v_texCoord).a);`;
      break;
    }
    case 'retroMatrix': {
      const spacing=n(p,'spacing',17,4,128), ht=n(p,'highlightThresh',.6,0,1), dt=n(p,'ditherThresh',.45,0,1), mt=n(p,'midtoneThresh',.3,0,1), st=n(p,'shadowThresh',.15,0,1);
      const green=vec3(color(p,'foreground','#42ff70')), black=vec3(color(p,'background','#020703'));
      const flags=[b(p,'showHighlight',true),b(p,'showTransition',true),b(p,'showMidtone',true),b(p,'showDot',true)];
      body = `${gradeLine}
 float cell=max(2.0,${f(spacing)}*px/u_scale); vec2 ip=floor(v_texCoord*u_resolution/cell); vec2 uv=(ip+0.5)*cell/u_resolution; float t=lum(grade(texture(u_input,uv).rgb,${f(brightness)},${f(contrast)},${f(gamma)}));
 float band=t>${f(ht)}?4.0:t>${f(dt)}?3.0:t>${f(mt)}?2.0:t>${f(st)}?1.0:0.0; vec2 local=fract(v_texCoord*u_resolution/cell); float anim=u_time*${f(n(p,'sway',3,0,20))}*u_speed; float jitter=(hash(ip+floor(anim))-0.5)*${f(n(p,'randOffset',1.5,0,12))}*0.04;
 float height=clamp(${f(n(p,'blockHeight',0.85,0.1,1))}+${f(n(p,'pulse',0.05,0,1))}*sin(u_time*6.283/${f(n(p,'loopDuration',5,0.1,60))}*u_speed+hash(ip)*6.283),0.05,1.0); float rect=max(abs(local.x-0.5),abs(local.y-0.5)); float block=step(abs(local.x-0.5),0.34+jitter)*step(abs(local.y-0.5),height*0.5);
 float grid=max(2.0,${f(n(p,'dotGrid',3,1,12))}); vec2 dotLocal=fract(local*grid); float dots=step(length(dotLocal-0.5),0.32); float transition=step(hash(ip+floor(u_time*${f(n(p,'glitch',0.2,0,1)*8)}*u_speed)),0.55); float horizontal=step(0.36,local.y); float vertical=step(0.36,local.x);
 float patt=band>=4.0?block:band>=3.0?transition:band>=2.0?horizontal:vertical; float enabled=band>=4.0?${flags[0]?'1.0':'0.0'}:band>=3.0?${flags[1]?'1.0':'0.0'}:band>=2.0?${flags[2]?'1.0':'0.0'}:${flags[3]?'1.0':'0.0'};
 float mark=patt*enabled*(${b(p,'edgeOnly',true)?'step(0.40,rect)':'1.0'}); vec3 ink=mix(${black},${green},mark); outColor=vec4(mix(c,ink,clamp(u_amount,0.0,1.0)),texture(u_input,v_texCoord).a);`;
      break;
    }
    case 'dataHatch': {
      const grid=n(p,'gridSize',21,4,128), accent=vec3(color(p,'accentColor','#ffffff'));
      const glyph=s(p,'hatchChar','+').charCodeAt(0) || 43;
      body = `${gradeLine}
 float cell=max(2.0,${f(grid)}*px/u_scale); vec2 ip=floor(v_texCoord*u_resolution/cell); vec2 local=fract(v_texCoord*u_resolution/cell); vec2 uv=(ip+0.5)*cell/u_resolution;
 float tone=lum(grade(texture(u_input,uv).rgb,${f(brightness)},${f(contrast)},${f(gamma)})); float hatch=studyGlyph(local,${f(Math.max(32,Math.min(127,glyph)))});
 float density=step(0.12,tone)*hatch; float line=step(0.86,local.y); vec3 ink=mix(${bg},${accent},max(density,line*0.15));
 outColor=vec4(mix(c,ink,clamp(u_amount,0.0,1.0)),texture(u_input,v_texCoord).a);`;
      break;
    }
    case 'pixelCode': {
      const cell=n(p,'cellSize',30,4,256), chars=s(p,'customChars','01<>[]{}');
      const codes=Array.from(chars).map(ch=>ch.codePointAt(0) ?? 48).filter(x=>x>=32&&x<=127).slice(0,96);
      const glyphCode=codes.length?codes[0]:48;
      const glyphChoice=codes.map((code,i)=>`${i?'else ':''}if(glyphIndex<${f(i+1)}) code=${f(code)};`).join(' ');
      const a=vec3(color(p,'accentA','#7adfff')), c2=vec3(color(p,'accentB','#ff7a4a'));
      body = `${gradeLine}
 float cell=max(2.0,${f(cell)}*px/u_scale); vec2 ip=floor(v_texCoord*u_resolution/cell); vec2 local=fract(v_texCoord*u_resolution/cell); vec2 uv=(ip+0.5)*cell/u_resolution; float tone=lum(grade(texture(u_input,uv).rgb,${f(brightness)},${f(contrast)},${f(gamma)}));
 float glyphIndex=floor(hash(ip)*${f(Math.max(1,codes.length))}); float code=${f(glyphCode)}; ${glyphChoice} float glyph=studyGlyph(local,code); float flick=0.85+0.15*sin(u_time*${f(n(p,'flickerRate',4,0,20))}*u_speed+hash(ip)*6.283); float ink=glyph*step(0.03,tone)*flick;
 vec3 col=mix(${bg},mix(${a},${c2},step(0.5,fract(ip.x*0.13+ip.y*0.07))),ink); outColor=vec4(mix(c,col,clamp(u_amount,0.0,1.0)),texture(u_input,v_texCoord).a);`;
      break;
    }
    case 'riso': {
      const pitch=n(p,'dotSpacing',12,2,128), angle1=n(p,'ink1Angle',15,-360,360)*Math.PI/180, angle2=n(p,'ink2Angle',75,-360,360)*Math.PI/180, split=n(p,'splitThreshold',.48,0,1);
      const i1=vec3(color(p,'ink1Color','#ff453a')),i2=vec3(color(p,'ink2Color','#1d4ed8')),paper=vec3(color(p,'paperColor','#f4f0e6'));
      body = `${gradeLine}
 float pitch=max(2.0,${f(pitch)}*px/u_scale); float a1=${f(angle1)},a2=${f(angle2)}; vec2 pp1=mat2(cos(a1),-sin(a1),sin(a1),cos(a1))*(v_texCoord*u_resolution); vec2 pp2=mat2(cos(a2),-sin(a2),sin(a2),cos(a2))*(v_texCoord*u_resolution);
 float d1=1.0-smoothstep(0.12,0.48,length(mod(pp1+pitch*.5,pitch)-pitch*.5)/pitch); float d2=1.0-smoothstep(0.12,0.48,length(mod(pp2+pitch*.5,pitch)-pitch*.5)/pitch);
 float inkA=step(${f(split)},y)*d1; float inkB=step(1.0-${f(split)},1.0-y)*d2; vec3 print=mix(${paper},${i1},inkA); print=mix(print,${i2},inkB*${f(n(p,'bleed',.5,0,1))});
 outColor=vec4(mix(c,print,clamp(u_amount,0.0,1.0)),texture(u_input,v_texCoord).a);`;
      break;
    }
    case 'capsuleCloud': {
      const tokens=s(p,'tagsText','OPEN, CHAT, CUT').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean).slice(0,48).map(x=>Array.from(x).slice(0,48).join(''));
      const cell=n(p,'capsuleHeight',35,8,128), radius=n(p,'borderRadius',10,0,64), gap=n(p,'capsuleGap',7,0,64), rowGap=n(p,'rowGap',6,0,64);
      const maxChars=Math.max(1,...tokens.map(x=>Array.from(x).length));
      const palette=[color(p,'customColor1','#ff3366'),color(p,'customColor2','#00f0ff'),color(p,'customColor3','#ff9900'),color(p,'customColor4','#39ff14'),color(p,'customColor5','#ffee00')].map(vec3);
      const count=Math.max(1,tokens.length);
      declarations = 'uniform sampler2D u_wordAtlas; uniform vec2 u_wordAtlasDims;\n';
      body = `${gradeLine}
 float cell=max(8.0,${f(cell)}*px/u_scale); vec2 g=v_texCoord*u_resolution; float rowH=cell+${f(rowGap)}*px; float row=floor(g.y/rowH); float maxWidth=cell*(0.62*${f(maxChars)}+0.8); float slotWidth=maxWidth+${f(gap)}*px; float x=mod(g.x+row*cell*0.37,u_resolution.x); float slot=floor(x/slotWidth); float wordIndex=mod(slot+floor(row*1.7),${f(count)}); float chars=1.0;
 ${tokens.map((word,index)=>`${index?'else ':''}if(wordIndex<${f(index+1)}) chars=${f(Math.max(1,Array.from(word).length))};`).join(' ')}
 float w=cell*(0.62*chars+0.8); vec2 q=vec2(mod(x,slotWidth)-${f(gap)}*px*0.5,mod(g.y,rowH)-rowH*.5); float h=cell*.5; float r=min(${f(radius)}*px,h); vec2 d=abs(q-vec2(w*.5,0.0))-vec2(max(0.0,w*.5-r),max(0.0,h-r)); float pill=1.0-smoothstep(-0.75*px,0.75*px,length(max(d,0.0))+min(max(d.x,d.y),0.0)-r);
 float charIndex=floor((q.x-(w-cell*0.62*chars)*0.5)/(cell*0.62)); vec2 glyphLocal=vec2(fract((q.x-(w-cell*0.62*chars)*0.5)/(cell*0.62)),q.y/cell+0.5); float text=0.0; if(charIndex>=0.0&&charIndex<chars){ vec2 uv=(vec2(charIndex,wordIndex)+vec2(clamp(glyphLocal.x,0.01,0.99),1.0-clamp(glyphLocal.y,0.01,0.99)))/u_wordAtlasDims; text=texture(u_wordAtlas,uv).r; }
 float lumGate=step(${f(n(p,'minLuminance',0.14,0,1))},y)*(1.0-step(${f(n(p,'maxLuminance',0.93,0,1))},y)); float midGate=1.0-step(${f(n(p,'midtoneFilter',0,0,1))},y)*step(0.38,y)*step(y,0.62); pill*=lumGate*midGate; vec3 pc=${palette[0]}; ${palette.map((c,i)=>`${i?'else ':''}if(mod(wordIndex,5.0)<${f(i+1)}) pc=${c};`).join(' ')} vec3 plate=mix(${bg},pc,pill*0.82); plate=mix(plate,vec3(1.0),text*pill);
 outColor=vec4(mix(c,plate,clamp(u_amount,0.0,1.0)),texture(u_input,v_texCoord).a);`;
      break;
    }
    default: return undefined;
  }
  return `${header}${declarations}${studyGlyphGLSL}\nvoid main(){${body}\n}`;
}

function uScale(p: Params, fallback: number) { return n(p, 'cell', fallback, 4, 256); }

/** Clean-room grid and print effects used by the public study presets. */
export function buildStudyGridPasses(
  type: string,
  params: Record<string, unknown>,
  inputUniforms: Record<string, UniformValue>,
): FxPass[] | undefined {
  const frag = shader(type, params);
  if (!frag) return undefined;
  const frameWidth = n(params, 'lookFrameWidth', 1200, 1, 8192);
  const time = typeof inputUniforms.u_time === 'number' && Number.isFinite(inputUniforms.u_time) ? inputUniforms.u_time : 0;
  const values = { ...uniforms(time, params, frameWidth), ...inputUniforms };
  const pass = { frag, uniforms: values, textureData: { u_glyphAtlas: studyGlyphTexture } } as StudyPass;
  if (type === 'capsuleCloud') {
    const words=s(params,'tagsText','OPEN, CHAT, CUT').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean).slice(0,48).map(x=>Array.from(x).slice(0,48).join(''));
    const atlas=buildWordAtlas(words,s(params,'fontStyle','monospace'));
    if(atlas){pass.textureData={...pass.textureData,u_wordAtlas:atlas};pass.uniforms={...pass.uniforms,u_wordAtlasDims:[atlas.columns,atlas.rows]};}
  }
  return [pass];
}
