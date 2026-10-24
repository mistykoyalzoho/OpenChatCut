/**
 * Clean-room WebGL2 recreations of the public Ladybug study motion presets.
 * These are independent implementations based on exposed preset parameters
 * and observable output behavior; they are not copies of the original shaders.
 *
 * Stateful effects consume the renderer's immediately previous input frame.
 * The history is intentionally used as a modest visual trail only. It is not
 * a substitute for the original multi-resolution flow analysis/state graphs.
 */
import type { FxPass, UniformValue } from '../runtime.js';
import { studyGlyphTexture, studyGlyphGLSL } from './studyGlyphs.js';

const COMMON = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_input;
uniform sampler2D u_history;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_historyValid;
uniform float u_deltaTime;
out vec4 outColor;
float luma(vec3 c){return dot(c,vec3(0.299,0.587,0.114));}
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec3 hex3(vec3 c){return c;}
`;

const GLYPH_COMMON = COMMON + studyGlyphGLSL;

const THERMAL = COMMON + `
uniform float u_low,u_high,u_gamma,u_detail,u_soften,u_relief,u_light,u_motion,u_motionGain,u_motionFloor,u_trail,u_hotEdges,u_glow,u_streaks,u_phase,u_cycles,u_drift,u_breathe,u_reverse,u_progress;
uniform vec3 u_palette0,u_palette1,u_palette2,u_palette3,u_palette4,u_palette5,u_palette6,u_palette7,u_palette8,u_palette9,u_palette10,u_palette11;
vec3 stopColor(int i){if(i==0)return u_palette0;if(i==1)return u_palette1;if(i==2)return u_palette2;if(i==3)return u_palette3;if(i==4)return u_palette4;if(i==5)return u_palette5;if(i==6)return u_palette6;if(i==7)return u_palette7;if(i==8)return u_palette8;if(i==9)return u_palette9;if(i==10)return u_palette10;return u_palette11;}
vec3 ramp(float x){x=clamp(u_reverse>.5?1.-x:x,0.,.99999)*11.;int i=int(floor(x));return mix(stopColor(i),stopColor(i+1),fract(x));}
void main(){vec2 uv=v_texCoord;vec4 src=texture(u_input,uv);float lum=luma(src.rgb);vec2 px=1./u_resolution;float avg=0.;for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++)avg+=luma(texture(u_input,uv+vec2(x,y)*px*max(1.,u_soften/5.)).rgb)/25.;float field=mix(lum,lum+(lum-avg)*u_detail,clamp(u_detail,0.,1.));field=clamp((field-u_low)/max(0.001,u_high-u_low),0.,1.);field=pow(field,1./max(0.05,u_gamma));field=fract(field*u_cycles+u_phase+u_drift*u_time+u_breathe*sin(u_time*0.8));vec3 col=ramp(field);float edge=length(vec2(dFdx(field),dFdy(field)));float hot=smoothstep(0.01,0.06,edge)*u_hotEdges;col=mix(col,vec3(1.),hot);vec2 old=texture(u_history,uv).rg;float motion=clamp(abs(field-old.r)-u_motionFloor,0.,1.)*u_motion*u_motionGain;col=mix(col,ramp(old.g),clamp(u_trail*0.35,0.,0.8)*u_historyValid);col+=vec3(motion*0.18);float band=exp(-pow((uv.y-fract(u_time*0.08+0.5))*80.,2.))*u_streaks*0.12;col+=band;float glow=0.;for(int i=1;i<=4;i++){float o=float(i)*2.;glow+=luma(texture(u_input,uv+vec2(o,0.)*px).rgb)*0.25;}col+=ramp(field)*glow*u_glow*0.12;float reveal=smoothstep(0.,.08,u_progress)*(1.-smoothstep(1.13,2.,u_progress));float alpha=smoothstep(0.,.05,u_progress);col=mix(src.rgb,col,reveal*alpha);outColor=vec4(col*src.a,src.a);}
`;

const CONTOUR = COMMON + `
uniform float u_levels,u_lineWidth,u_smoothing,u_invert,u_filled,u_drift,u_brightness,u_contrast,u_gamma,u_backgroundOpacity;uniform vec3 u_foreground,u_background;
void main(){vec2 uv=v_texCoord;vec4 src=texture(u_input,uv);float v=luma(src.rgb);v=pow(clamp((v-0.5)*(1.+u_contrast*0.01)+0.5+u_brightness*0.005,0.,1.),1./max(0.05,u_gamma));if(u_invert>0.5)v=1.-v;float bands=v*max(2.,u_levels);float edge=abs(fract(bands)-0.5);float aa=max(fwidth(bands)*max(0.5,u_smoothing),0.002);float line=1.-smoothstep(u_lineWidth*0.035,u_lineWidth*0.035+aa,edge);float fill=u_filled>0.5?bands/max(2.,u_levels):0.;vec3 ink=mix(u_background,u_foreground,clamp(max(line,fill*0.35),0.,1.));float a=src.a*(u_backgroundOpacity+(1.-u_backgroundOpacity)*max(line,fill));outColor=vec4(ink*a,a);}
`;

const CONTOUR_MAP = GLYPH_COMMON + `
uniform float u_detail,u_bands,u_lineWidth,u_lineAlpha,u_smooth,u_multi,u_tight,u_glyphSize,u_spacing,u_boxes,u_boxSize,u_labels,u_ticks,u_glow,u_heroes,u_seed,u_drift,u_backgroundOpacity,u_charset;uniform vec3 u_foreground,u_background,u_accent;
float fieldAt(vec2 pixel){vec2 cell=max(vec2(1.),u_resolution/max(2.,u_spacing));vec2 center=(floor(pixel/cell)+.5)*cell;vec2 px=1./u_resolution;float sum=0.,weight=0.;float radius=clamp(u_smooth*.35,.35,2.);for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 o=vec2(float(x),float(y));float w=exp(-dot(o,o)/max(.25,radius*radius*2.));sum+=luma(texture(u_input,(center+o*cell*.45)*px).rgb)*w;weight+=w;}return sum/max(weight,.001);}
void main(){vec2 uv=v_texCoord;vec4 src=texture(u_input,uv);vec2 pixel=uv*u_resolution;float lum=fieldAt(pixel);vec2 cell=max(vec2(1.),u_resolution/max(2.,u_spacing));vec2 p=pixel/cell;float q=lum*max(1.,u_bands);float gx=fieldAt(pixel+vec2(cell.x,0.))-fieldAt(pixel-vec2(cell.x,0.));float gy=fieldAt(pixel+vec2(0.,cell.y))-fieldAt(pixel-vec2(0.,cell.y));float grad=max(length(vec2(gx,gy)),.0001);float contour=0.;float nLevels=clamp(u_multi,1.,4.);for(int m=0;m<4;m++){if(float(m)>=nLevels)break;float offset=(float(m)-(nLevels-1.)*.5)*u_tight*.025;float phase=fract(q+offset);float distance=abs(phase-.5)/grad;float width=max(.25,u_lineWidth)*(1.+float(m)*.08);contour=max(contour,1.-smoothstep(width-.75,width+.75,distance));}float relief=clamp(grad*u_detail*1.7,0.,1.);vec2 gridLocal=fract(p);float gridDist=min(min(gridLocal.x,1.-gridLocal.x),min(gridLocal.y,1.-gridLocal.y));float box=1.-smoothstep(.0,max(.002,.035*u_boxSize),gridDist);float tick=step(.94,fract(p.x*4.))*step(.88,fract(p.y*4.))*u_ticks;float hero=step(1.-clamp(u_heroes,0.,1.)*.12,hash12(floor(p)+u_seed+4.));vec2 glyphPx=max(vec2(2.),vec2(u_glyphSize));vec2 local=fract(pixel/glyphPx);float digit=mod(floor(lum*100.),10.);float code=48.+digit;if(u_charset<.5)code=lum<.5?48.:49.;else if(u_charset<1.5)code=lum<.25?60.:lum<.5?62.:lum<.75?94.:118.;else if(u_charset<2.5)code=lum<.25?43.:lum<.5?42.:lum<.75?61.:35.;else if(u_charset<3.5)code=lum<.25?46.:lum<.5?43.:lum<.75?35.:64.;else if(u_charset<4.5)code=lum<.25?46.:lum<.5?58.:lum<.75?111.:79.;float annotation=studyGlyph(local,code)*u_labels;float mark=clamp(contour*u_lineAlpha+relief*.25+tick+annotation*.7,0.,1.);vec3 col=mix(u_background,u_foreground,mark);col=mix(col,u_accent,clamp(hero+box*u_boxes*.15,0.,1.));col+=u_accent*contour*u_glow*.18;float alpha=src.a*(u_backgroundOpacity+(1.-u_backgroundOpacity)*max(contour,max(relief,annotation)));outColor=vec4(col*alpha,alpha);}
`;

const CRT_SCREEN = COMMON + `
uniform float u_curvature,u_zoom,u_aberration,u_edgeBlur,u_vignette,u_gridSize,u_gridStrength,u_subpixel,u_reflection,u_streaks,u_tint,u_lift,u_bloom,u_grime,u_brightness,u_contrast,u_gamma;uniform vec3 u_tintColor;
void main(){vec2 p=(v_texCoord-.5)/max(.2,u_zoom);p*=1.+u_curvature*dot(p,p)*1.8;vec2 uv=p+.5;float r=texture(u_input,uv+vec2(u_aberration/u_resolution.x,0.)).r;float g=texture(u_input,uv).g;float b=texture(u_input,uv-vec2(u_aberration/u_resolution.x,0.)).b;vec4 src=texture(u_input,uv);vec3 c=vec3(r,g,b);c=(c-.5)*(1.+u_contrast*.01)+.5+u_brightness*.005;c=pow(max(c,vec3(0.)),vec3(1./max(.05,u_gamma)));float scan=1.-u_gridStrength*(.5+.5*cos(gl_FragCoord.y*3.14159/max(.5,u_gridSize)));float rgb=1.-u_subpixel*(.5+.5*cos(gl_FragCoord.x*6.28318/3.));c*=scan*rgb;c=mix(c,c*u_tintColor,u_tint*.3);float vig=1.-u_vignette*dot(p,p)*2.3;float outside=max(max(-uv.x,uv.x-1.),max(-uv.y,uv.y-1.));float edge=1.-smoothstep(0.,max(.0001,u_edgeBlur*.12),max(0.,outside));float refl=pow(max(0.,1.-abs(v_texCoord.y-.12)*8.),4.)*u_reflection*.13;float streak=exp(-pow((v_texCoord.y-.5)*95.,2.))*u_streaks*.1;float grain=(hash12(floor(gl_FragCoord.xy)+floor(u_time*24.))-.5)*u_grime*.035; c=max(vec3(0.),c*max(0.,vig)+refl+streak+grain+u_lift*.015);float a=src.a*edge*clamp(vig,0.,1.);outColor=vec4(c*a,a);}
`;

const VHS = COMMON + `
uniform float u_soft,u_bleed,u_smear,u_sharp,u_rainbow,u_ghost,u_wear,u_noise,u_cnoise,u_drop,u_jitter,u_wow,u_track,u_head,u_flag,u_inter,u_events,u_scan,u_curve,u_vig,u_bloom,u_streak,u_conv,u_hum,u_snow,u_flick,u_fade,u_sat,u_hue,u_warm,u_bw;
void main(){vec2 uv=v_texCoord;float row=floor(uv.y*u_resolution.y);float rnd=hash12(vec2(row,floor(u_time*24.)));float shift=(rnd-.5)*u_jitter*.006+sin(uv.y*10.+u_time*.6)*u_wow*.003;uv.x+=shift;uv.x=(uv.x-.5)*(1.+u_curve*pow((uv.y-.5)*2.,2.))+.5;vec2 px=1./u_resolution;vec3 c=texture(u_input,uv).rgb;vec3 blur=(texture(u_input,uv+px*vec2(u_bleed*2.,0.)).rgb+texture(u_input,uv-px*vec2(u_bleed*2.,0.)).rgb)*.5;c=mix(c,blur,u_soft*.3+u_smear*.2);vec3 chroma=vec3(texture(u_input,uv+px*vec2(u_rainbow*2.,0.)).r,c.g,texture(u_input,uv-px*vec2(u_rainbow*2.,0.)).b);c=mix(c,chroma,u_conv);float lum=luma(c);c=mix(vec3(lum),c,u_sat);c.r+=u_warm*.08;c.g+=sin(u_hue)*.015;c=mix(c,vec3(lum),u_bw);float scan=1.-u_scan*(.5+.5*sin(uv.y*u_resolution.y*3.14159));float noise=(hash12(floor(gl_FragCoord.xy)+floor(u_time*30.))-.5)*u_noise*.18;c=c*scan+noise;float track=exp(-pow((fract(uv.y+u_time*.01)-.7)*60.,2.))*u_track;float dropout=step(1.-u_drop*.04,hash12(vec2(row,floor(u_time*3.))))*u_drop*.35;float ghost=texture(u_history,uv+vec2(px.x*3.,0.)).r*u_ghost*u_historyValid;c=mix(c,vec3(ghost),.25);float flick=1.-u_flick*(.5+.5*sin(u_time*35.));float vig=1.-u_vig*dot(v_texCoord-.5,v_texCoord-.5)*2.;c+=track*.2+noise*u_snow;c*=max(.3,flick*vig)*(1.-u_fade*.12);float a=texture(u_input,uv).a;outColor=vec4(max(c,vec3(0.))*a,a);}
`;

const STARDUST = COMMON + `
uniform float u_density,u_particleSize,u_threshold,u_underlay,u_twinkle,u_shimmer,u_drift,u_dust,u_seed,u_animate,u_dark;uniform vec3 u_colorA,u_colorB,u_background;
void main(){vec2 uv=v_texCoord;vec4 src=texture(u_input,uv);float lum=luma(src.rgb);vec2 grid=floor(uv*u_resolution/max(2.,u_particleSize));float rnd=hash12(grid+u_seed);vec2 local=fract(uv*u_resolution/max(2.,u_particleSize));float d=length(local-.5);float particleOn=step(1.-u_density*.2,rnd)*step(u_threshold*.01,lum);if(u_dark>.5)particleOn=step(1.-u_density*.2,rnd)*step(lum,u_threshold*.01);float tw=1.-u_twinkle*.45*(.5+.5*sin(u_time*u_shimmer+rnd*6.283));vec2 pos=fract((grid+vec2(rnd,hash12(grid+3.)))*.754877+u_time*u_drift*.008);float part=1.-smoothstep(.10,.10+u_dust*.25,length(local-pos));vec3 dust=mix(u_colorA,u_colorB,rnd);float sparkle=particleOn*part*tw;vec3 col=mix(u_background,src.rgb,u_underlay);col+=dust*sparkle;float a=src.a;outColor=vec4(col*a,a);}
`;

const ASCII_GHOST = GLYPH_COMMON + `
uniform float u_cell,u_rhythm,u_colorBoost,u_inkFloor,u_saturation,u_contrast,u_exposure,u_text,u_blend,u_photo,u_glow,u_drift,u_charset;uniform vec3 u_background;
void main(){vec2 uv=v_texCoord;float cell=max(2.,u_cell);vec2 grid=floor(uv*u_resolution/cell);vec2 local=fract(uv*u_resolution/cell);local.x=fract(local.x+u_drift*u_time*.03);vec2 suv=(grid+.5)*cell/u_resolution;vec4 src=texture(u_input,suv);float lum=luma(src.rgb);float tone=clamp((lum-.5)*u_contrast+.5+u_exposure*.12,0.,1.);tone=clamp(tone+(hash12(grid)*2.-1.)*u_rhythm*.08,0.,1.);float code=32.+floor(tone*8.);if(u_charset<.5){code=tone<.5?48.:49.;}else if(u_charset<1.5){code=tone<.5?46.:43.;}else if(u_charset<2.5){code=tone<.35?43.:tone<.65?61.:35.;}else{code=tone<.25?46.:tone<.5?43.:tone<.75?42.:35.;}float glyph=studyGlyph(local,code);float signal=max(u_inkFloor*.1,glyph*u_text);vec3 gray=mix(vec3(luma(src.rgb)),src.rgb,u_saturation);vec3 ink=gray*(1.+u_colorBoost);vec3 col=mix(u_background,ink,signal);if(u_blend>.5)col=clamp(u_background+ink*signal+src.rgb*u_photo,0.,1.);else col=mix(col,src.rgb,clamp(u_photo,0.,1.));col+=ink*signal*u_glow*.002;float a=src.a;outColor=vec4(col*a,a);}
`;

const KINETIC_TRACE = COMMON + `
uniform sampler2D u_feedback;uniform float u_fineMotion,u_mediumMotion,u_broadMotion,u_sensitivity,u_noiseReject,u_body,u_gain,u_geometry,u_trail,u_echoGap,u_ageColor,u_materialScale,u_materialFill,u_feedbackAmount,u_feedbackZoom,u_feedbackSpin,u_directionMode,u_ditherMaterial;uniform vec3 u_inkColor,u_paperColor;
float lumAt(vec2 uv){return luma(texture(u_input,clamp(uv,vec2(0.),vec2(1.))).rgb);}
float oldLum(vec2 uv){return luma(texture(u_history,clamp(uv,vec2(0.),vec2(1.))).rgb);}
vec3 bestFlow(vec2 uv,float stride){vec2 px=stride/u_resolution;float center=lumAt(uv);float best=1e6;vec2 flow=vec2(0.);for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){vec2 d=vec2(float(x),float(y))*px;float score=abs(center-oldLum(uv+d));if(score<best){best=score;flow=d;}}return vec3(flow,best);}
void main(){vec2 uv=v_texCoord;vec4 src=texture(u_input,uv);vec2 px=1./u_resolution;float now=lumAt(uv);vec3 fine=bestFlow(uv,1.),medium=bestFlow(uv,3.),broad=bestFlow(uv,8.);float wf=max(0.,u_fineMotion),wm=max(0.,u_mediumMotion),wb=max(0.,u_broadMotion);float ws=max(.001,wf+wm+wb);vec2 flow=(fine.xy*wf+medium.xy*wm+broad.xy*wb)/ws;float residual=(fine.z*wf+medium.z*wm+broad.z*wb)/ws;float gradX=lumAt(uv+vec2(px.x,0.))-lumAt(uv-vec2(px.x,0.));float gradY=lumAt(uv+vec2(0.,px.y))-lumAt(uv-vec2(0.,px.y));float edge=length(vec2(gradX,gradY));float temporal=abs(now-oldLum(uv+flow));float confidence=1.-smoothstep(u_noiseReject*.002,.12,residual);float magnitude=length(flow*u_resolution);float motionSignal=clamp((magnitude*u_sensitivity*.002+temporal*u_geometry*.08+edge*u_body*.03)*u_gain*.02,0.,1.)*confidence*u_historyValid;float material=1.;if(u_ditherMaterial>.5){float scale=max(2.,u_materialScale);vec2 cell=floor(gl_FragCoord.xy/scale);material=step(hash12(cell)*100.,clamp(u_materialFill,0.,100.));}float density=clamp(motionSignal*material,0.,1.);if(u_directionMode>.5){vec2 dir=normalize(flow+vec2(1e-5));float orient=dot(normalize(vec2(gradX,gradY)+vec2(1e-5)),dir);density*=smoothstep(-.5,.5,orient);}
vec2 center=uv-.5;float angle=u_feedbackSpin*0.0174532925;mat2 rot=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));vec2 feedbackUv=rot*center/max(.5,1.+u_feedbackZoom*.002)+.5;vec3 prior=texture(u_feedback,feedbackUv).rgb;float decay=exp(-max(0.,u_deltaTime)*1000./max(1.,u_trail));float trail=clamp(u_feedbackAmount*.01,0.,.95)*decay*u_historyValid;vec3 trace=mix(u_paperColor,u_inkColor,density);trace=mix(trace,prior,trail);float cell=max(1.,u_materialScale);float echo=texture(u_feedback,uv-flow*max(0.,u_echoGap)).r;trace=mix(trace,u_inkColor,clamp(echo*u_ageColor*.01*trail,0.,.65));float alpha=src.a;outColor=vec4(trace*alpha,alpha);}
`;

const BRAND = GLYPH_COMMON + `
uniform float u_blockSize,u_minDistance,u_connectionMaxDistance,u_connectionWeight,u_threshold,u_colorMix,u_minRadius,u_maxRadius,u_strokeWidth,u_sizeSeed,u_square,u_overlayOpacity,u_showBackground,u_bgBrightness,u_showGrid,u_showCrosshair,u_chainOn,u_chainCount,u_chainAngle,u_chainBaseRadius,u_chainSizeRatio,u_chainMarkerSize,u_showText,u_labelSize;uniform vec3 u_accentColor,u_background;
float sdCircle(vec2 p,float r){return length(p)-r;}float sdBox(vec2 p,float r){vec2 d=abs(p)-vec2(r);return length(max(d,0.))+min(max(d.x,d.y),0.);}float blockLuma(vec2 id){vec2 uv=(id+.5)*max(2.,u_blockSize)/u_resolution;float s=0.;for(int y=0;y<2;y++)for(int x=0;x<2;x++)s+=luma(texture(u_input,uv+(vec2(x,y)-.5)*u_blockSize*.35/u_resolution).rgb);return s*.25;}float candidate(vec2 id){float lum=blockLuma(id);float threshold=clamp(u_threshold*.01,0.,1.);float score=smoothstep(threshold-.08,threshold+.08,lum);float h=hash12(id+u_sizeSeed);return score*step(.15,h);}
void main(){vec2 uv=v_texCoord;vec4 src=texture(u_input,uv);float bs=max(2.,u_blockSize);vec2 id=floor(gl_FragCoord.xy/bs);float h=hash12(id+u_sizeSeed);vec2 local=fract(gl_FragCoord.xy/bs)-.5;float radius=mix(u_minRadius,u_maxRadius,h)/bs;float sd=mix(sdCircle(local,radius),sdBox(local,radius),u_square);float ring=1.-smoothstep(0.,max(.001,u_strokeWidth/bs),abs(sd));float here=candidate(id);float isolated=1.;for(int y=-4;y<=4;y++)for(int x=-4;x<=4;x++){if(x==0&&y==0)continue;vec2 off=vec2(float(x),float(y));if(length(off*bs)>=u_minDistance)continue;float other=candidate(id+off);if(other>here)isolated=0.;}float node=here*isolated*ring;float links=0.;for(int i=0;i<8;i++){float a=6.2831853*float(i)/8.;vec2 d=vec2(cos(a),sin(a));float dist=length(d*bs*2.);if(dist>u_connectionMaxDistance)continue;float other=candidate(id+d*2.);float line=1.-smoothstep(.02,.12,abs(local.x*d.y-local.y*d.x));line*=step(0.,dot(local,d))*step(dot(local,d),dist/bs);links=max(links,line*other*u_connectionWeight);}float grid=min(fract(gl_FragCoord.x/48.),fract(gl_FragCoord.y/48.));float gridLine=(1.-smoothstep(.01,.04,grid))*u_showGrid*.12;vec2 p=uv-.5;float cross=max(1.-smoothstep(.002,.006,abs(p.x)),1.-smoothstep(.002,.006,abs(p.y)))*u_showCrosshair*.25;float chain=0.;if(u_chainOn>.5){float ang=atan(p.y,p.x)-u_chainAngle*.0174532925;float radiusPx=length(p*u_resolution);float ringDist=abs(radiusPx-u_chainBaseRadius*u_chainSizeRatio);float angular=abs(fract(ang/6.2831853*u_chainCount+.5)-.5);chain=(1.-smoothstep(.002,.012,angular))*(1.-smoothstep(1.,max(2.,u_chainMarkerSize),ringDist));}vec2 textCell=max(vec2(4.),vec2(u_labelSize));vec2 at=gl_FragCoord.xy;float label=0.;float glyphCode=32.;vec2 lp=fract(at/textCell);float col=floor(at.x/textCell.x);float idx=col;if(at.y<textCell.y*1.6&&at.x<u_resolution.x*.52){__LABEL_TL__}else if(at.y<textCell.y*1.6&&at.x>u_resolution.x*.48){idx=col-floor(u_resolution.x*.52/textCell.x);__LABEL_TR__}else if(at.y>u_resolution.y-textCell.y*1.6&&at.x<u_resolution.x*.52){__LABEL_BL__}else if(at.y>u_resolution.y-textCell.y*1.6&&at.x>u_resolution.x*.48){idx=col-floor(u_resolution.x*.52/textCell.x);__LABEL_BR__}label=studyGlyph(lp,glyphCode)*u_showText;float shape=clamp(node+links+gridLine+cross+chain*u_chainMarkerSize*.2,0.,1.);vec3 bg=mix(src.rgb,u_background,u_showBackground*(1.-u_bgBrightness));vec3 theme=mix(u_accentColor,src.rgb,u_colorMix);vec3 colOut=mix(bg,theme,clamp(shape+label,0.,1.)*u_overlayOpacity);outColor=vec4(colOut*src.a,src.a);}
`;

function num(p: Record<string, unknown>, key: string, fallback: number): number {
  const n = p[key]; return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}
function color(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (typeof value !== 'string') return fallback;
  const m = value.match(/^#([\da-f]{6})$/i); if (!m) return fallback;
  const n = Number.parseInt(m[1], 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function val(p: Record<string, unknown>, key: string, fallback = 0): number { return num(p, key, fallback); }
function palette(value: unknown): [number, number, number][] {
  const defaults = ['#160b35','#3f2b70','#b34e8a','#e98a60','#f8cf84','#fff4dc'].map((x) => color(x,[1,1,1]));
  const parsed = typeof value === 'string' ? value.match(/#[\da-f]{6}/ig)?.map((x) => color(x,[1,1,1])) : undefined;
  const colors = parsed?.length ? parsed : defaults;
  return Array.from({length:12},(_,i)=>colors[Math.round(i*(colors.length-1)/11)]);
}
function pass(frag: string, uniforms: Record<string, UniformValue>, glyph = false): FxPass {
  return glyph
    ? { frag, uniforms, textureData: { u_glyphAtlas: studyGlyphTexture } }
    : { frag, uniforms };
}
function charsetId(value: unknown): number {
  switch (value) {
    case 'binary': return 0;
    case 'arrows': return 1;
    case 'symbols': return 2;
    case 'blocks': return 3;
    case 'dotted': return 4;
    default: return 5;
  }
}
function labelBranches(text: unknown): string {
  const chars = Array.from(typeof text === 'string' ? text : '').slice(0, 64);
  return `glyphCode=32.; ${chars.map((char, i) => {
    const code = char.codePointAt(0) ?? 32;
    const safe = code >= 32 && code <= 127 ? code : 32;
    return `${i === 0 ? 'if' : 'else if'}(idx<${i + 1}.0)glyphCode=${safe}.0;`;
  }).join(' ')}`;
}

/** Build the single-pass WebGL2 approximation for a reconstructed study preset. */
export function buildStudyMotionPasses(
  type: string,
  params: Record<string, unknown>,
  uniforms: Record<string, UniformValue>,
): FxPass[] | undefined {
  const time = typeof uniforms.u_time === 'number' ? uniforms.u_time : 0;
  const common: Record<string, UniformValue> = { u_time: time };
  switch (type) {
    case 'thermal': {
      const colors = palette(params.customPalette);
      return [pass(THERMAL, {...common,u_low:val(params,'low'),u_high:val(params,'high',1),u_gamma:val(params,'gamma',1),u_detail:val(params,'detail',.2),u_soften:val(params,'soften',8),u_relief:val(params,'relief'),u_light:val(params,'light',1),u_motion:val(params,'motion'),u_motionGain:val(params,'motionGain',1),u_motionFloor:val(params,'motionFloor',.01),u_trail:val(params,'trail'),u_hotEdges:val(params,'hotEdges'),u_glow:val(params,'glow'),u_streaks:val(params,'streaks'),u_phase:val(params,'phase'),u_cycles:val(params,'cycles',1),u_drift:val(params,'drift'),u_breathe:val(params,'breathe'),u_progress:val(params,'progress'),u_reverse:params.reverse===true?1:0,...Object.fromEntries(colors.map((c,i)=>[`u_palette${i}`,c]))})];
    }
    case 'contour': return [pass(CONTOUR,{...common,u_levels:val(params,'levels',8),u_lineWidth:val(params,'lineWidth',1),u_smoothing:val(params,'lineSmoothing',1),u_invert:params.invert===true?1:0,u_filled:params.filled===true?1:0,u_drift:val(params,'drift'),u_brightness:val(params,'brightness'),u_contrast:val(params,'contrast'),u_gamma:val(params,'gamma',1),u_backgroundOpacity:val(params,'backgroundOpacity',1),u_foreground:color(params.foreground,[1,1,1]),u_background:color(params.background,[0,0,0])})];
    case 'contourMap': return [pass(CONTOUR_MAP,{...common,u_detail:val(params,'detail',4),u_bands:val(params,'bands',8),u_lineWidth:val(params,'lineWidth',1),u_lineAlpha:val(params,'lineAlpha',.7),u_smooth:val(params,'smooth',5),u_multi:val(params,'multi',1),u_tight:val(params,'tight',1),u_glyphSize:val(params,'glyphSize',16),u_spacing:val(params,'spacing',16),u_boxes:val(params,'boxes'),u_boxSize:val(params,'boxSize',1),u_labels:val(params,'labels'),u_ticks:val(params,'ticks'),u_glow:val(params,'glow'),u_heroes:val(params,'heroes'),u_seed:val(params,'seed'),u_drift:val(params,'drift'),u_charset:charsetId(params.charset),u_backgroundOpacity:val(params,'backgroundOpacity',1),u_foreground:color(params.foreground,[.8,.8,.8]),u_background:color(params.background,[.08,.08,.08]),u_accent:color(params.accent,[.8,.1,.1])},true)];
    case 'crtScreen': return [pass(CRT_SCREEN,{...common,u_curvature:val(params,'curvature'),u_zoom:val(params,'zoom',1),u_aberration:val(params,'aberration'),u_edgeBlur:val(params,'edgeBlur'),u_vignette:val(params,'vignette'),u_gridSize:val(params,'gridSize',1),u_gridStrength:val(params,'gridStrength'),u_subpixel:val(params,'subpixel'),u_reflection:val(params,'reflection'),u_streaks:val(params,'streaks'),u_tint:val(params,'tint'),u_lift:val(params,'lift'),u_bloom:val(params,'bloom'),u_grime:val(params,'grime'),u_brightness:val(params,'brightness'),u_contrast:val(params,'contrast'),u_gamma:val(params,'gamma',1),u_tintColor:color(params.tintColor,[.9,1,.96])})];
    case 'vhs': return [pass(VHS,{...common,u_soft:val(params,'soft'),u_bleed:val(params,'bleed'),u_smear:val(params,'smear'),u_sharp:val(params,'sharp'),u_rainbow:val(params,'rainbow'),u_ghost:val(params,'ghost'),u_wear:val(params,'wear'),u_noise:val(params,'noise'),u_cnoise:val(params,'cnoise'),u_drop:val(params,'drop'),u_jitter:val(params,'jitter'),u_wow:val(params,'wow'),u_track:val(params,'track'),u_head:val(params,'head'),u_flag:val(params,'flag'),u_inter:val(params,'inter'),u_events:val(params,'events'),u_scan:val(params,'scan'),u_curve:val(params,'curve'),u_vig:val(params,'vig'),u_bloom:val(params,'bloom'),u_streak:val(params,'streak'),u_conv:val(params,'conv'),u_hum:val(params,'hum'),u_snow:val(params,'snow'),u_flick:val(params,'flick'),u_fade:val(params,'fade'),u_sat:val(params,'sat',1),u_hue:val(params,'hue'),u_warm:val(params,'warm'),u_bw:params.bw===true?1:0})];
    case 'stardust': return [pass(STARDUST,{...common,u_density:val(params,'density',4)*.1,u_particleSize:val(params,'particleSize',3),u_threshold:val(params,'threshold',10),u_underlay:val(params,'underlay',.2),u_twinkle:val(params,'twinkleSpeed',1),u_shimmer:val(params,'shimmer',.3),u_drift:val(params,'drift'),u_dust:val(params,'dust',.5),u_seed:val(params,'seed'),u_animate:params.animate===true?1:0,u_dark:params.toneZone==='dark'?1:0,u_colorA:color(params.colorA,[.2,.1,.4]),u_colorB:color(params.colorB,[.8,.4,1]),u_background:color(params.background,[0,0,.02])})];
    case 'asciiGhost': return [pass(ASCII_GHOST,{...common,u_cell:val(params,'cell',8),u_rhythm:val(params,'rhythm',.5),u_colorBoost:val(params,'colorBoost'),u_inkFloor:val(params,'inkFloor'),u_saturation:val(params,'saturation',1),u_contrast:val(params,'contrast',1),u_exposure:val(params,'exposure'),u_text:val(params,'text',1),u_blend:params.blend===true?1:0,u_photo:val(params,'photo',.3),u_glow:val(params,'glow'),u_drift:val(params,'drift'),u_charset:charsetId(params.charset),u_background:color(params.background,[0,0,0])},true)];
    case 'kineticTrace': return [pass(KINETIC_TRACE,{...common,u_fineMotion:val(params,'fineMotion',70),u_mediumMotion:val(params,'mediumMotion',90),u_broadMotion:val(params,'broadMotion',45),u_sensitivity:val(params,'sensitivity',70),u_noiseReject:val(params,'noiseReject',60),u_body:val(params,'body',20),u_gain:val(params,'gain',50),u_geometry:val(params,'geometry',20),u_trail:val(params,'trail',500),u_echoGap:val(params,'echoGap',5),u_ageColor:val(params,'ageColor',10),u_materialScale:val(params,'materialScale',12),u_materialFill:val(params,'materialFill',100),u_feedbackAmount:val(params,'feedback',5),u_feedbackZoom:val(params,'feedbackZoom',2),u_feedbackSpin:val(params,'feedbackSpin'),u_directionMode:params.mode==='direction'?1:0,u_ditherMaterial:params.material==='dither'?1:0,u_inkColor:color(params.inkColor,[.1,.3,.8]),u_paperColor:color(params.paperColor,[.95,.95,.9])})];
    case 'brandGenerator': {
      const labelFrag = BRAND.replace('__LABEL_TL__', labelBranches(params.topLeftText))
        .replace('__LABEL_TR__', labelBranches(params.topRightText))
        .replace('__LABEL_BL__', labelBranches(params.bottomLeftText))
        .replace('__LABEL_BR__', labelBranches(params.bottomRightText));
      return [pass(labelFrag,{...common,u_blockSize:val(params,'blockSize',8),u_minDistance:val(params,'minDistance',80),u_connectionMaxDistance:val(params,'connectionMaxDistance',200),u_connectionWeight:val(params,'connectionWeight',.5),u_threshold:val(params,'threshold',30),u_colorMix:val(params,'colorMix',.45),u_minRadius:val(params,'minRadius',5),u_maxRadius:val(params,'maxRadius',20),u_strokeWidth:val(params,'strokeWidth',1),u_sizeSeed:val(params,'sizeSeed',1),u_square:params.shapeType==='square'?1:0,u_overlayOpacity:val(params,'overlayOpacity',1),u_showBackground:params.showBackground===false?0:1,u_bgBrightness:val(params,'bgBrightness',.8),u_showGrid:params.showGrid===false?0:1,u_showCrosshair:params.showCrosshair===false?0:1,u_chainOn:params.chainOn===true?1:0,u_chainCount:val(params,'chainCount',20),u_chainAngle:val(params,'chainAngle'),u_chainBaseRadius:val(params,'chainBaseRadius',200),u_chainSizeRatio:val(params,'chainSizeRatio',1),u_chainMarkerSize:val(params,'chainMarkerSize',3),u_showText:params.showText===true?1:0,u_labelSize:val(params,'labelSize',11),u_accentColor:color(params.accentColor,[1,1,1]),u_background:color(params.background,[0,0,0])},true)];
    }
    default: return undefined;
  }
}
