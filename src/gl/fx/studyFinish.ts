import type { FxPass, UniformValue } from '../runtimeTypes';

type Settings = Record<string, unknown>;
const number = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const header = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_input;
uniform vec2 u_resolution;
out vec4 outColor;
`;
const bright = header + `uniform float u_threshold,u_knee;
void main(){vec4 c=texture(u_input,v_texCoord);float v=max(max(c.r,c.g),c.b);float k=max(0.0001,u_threshold*u_knee);float soft=clamp(v-u_threshold+k,0.,2.*k);soft=soft*soft/(4.*k);float contribution=max(soft,v-u_threshold)/max(v,0.0001);outColor=vec4(c.rgb*max(contribution,0.),c.a);}`;
const blur = header + `uniform vec2 u_direction;
void main(){vec2 d=u_direction/u_resolution;vec4 c=texture(u_input,v_texCoord)*0.227027;
c+=(texture(u_input,v_texCoord+d*1.384615)+texture(u_input,v_texCoord-d*1.384615))*0.316216;
c+=(texture(u_input,v_texCoord+d*3.230769)+texture(u_input,v_texCoord-d*3.230769))*0.070270;outColor=c;}`;
const streak = header + `uniform float u_angle,u_length,u_intensity,u_threshold,u_knee,u_taps,u_falloff,u_mirror;uniform vec3 u_tint;
void main(){vec4 base=texture(u_input,v_texCoord);vec2 dir=vec2(cos(u_angle),sin(u_angle))*u_length*.25;vec3 sum=vec3(0.);float weights=0.;
for(int i=1;i<=24;i++){if(float(i)>u_taps)break;float t=float(i)/u_taps;float w=pow(u_falloff,float(i));vec3 c=texture(u_input,v_texCoord+dir*t).rgb;if(u_mirror>.5)c+=texture(u_input,v_texCoord-dir*t).rgb;float v=max(max(c.r,c.g),c.b);float k=max(.0001,u_knee);sum+=c*smoothstep(u_threshold-k,u_threshold+k,v)*w;weights+=w;}
outColor=vec4(base.rgb+sum/max(weights,1.)*u_intensity*u_tint,base.a);}`;
const tonemap = header + `uniform float u_exposure,u_lift,u_contrast,u_saturation;
void main(){vec4 c=texture(u_input,v_texCoord);vec3 rgb=max(vec3(0.),c.rgb*exp2(u_exposure)+u_lift);rgb=(rgb-.5)*u_contrast+.5;float y=dot(rgb,vec3(.2126,.7152,.0722));outColor=vec4(mix(vec3(y),rgb,u_saturation),c.a);}`;

/** Add composition finishes after the ordered source effects. References stay
 * local to the preset graph; fxPasses rebases the entire graph at clip level. */
export function appendStudyFinish(passes: FxPass[], settings: Settings, uniforms: Record<string, UniformValue>): void {
  const bloom = settings.bloom as Settings | undefined;
  if (bloom?.enabled && number(bloom.intensity, .6) > 0) {
    const base = passes.length - 1;
    const count = Math.max(1, Math.min(8, Math.round(number(bloom.levels, 5))));
    const targets: number[] = [];
    passes.push({ frag: bright, uniforms: { ...uniforms, u_threshold: number(bloom.threshold, .4), u_knee: number(bloom.knee, .5) } });
    const threshold = passes.length - 1;
    for (let level = 0; level < count; level++) {
      const radius = number(bloom.radius, 1) * Math.pow(2, level);
      passes.push({ frag: blur, inputFrom: threshold, uniforms: { ...uniforms, u_direction: [radius, 0] } });
      passes.push({ frag: blur, uniforms: { ...uniforms, u_direction: [0, radius] } });
      targets.push(passes.length - 1);
    }
    const samplers: Record<string, number> = {};
    const tints = bloom.tints as number[][] | null;
    const values: Record<string, UniformValue> = { ...uniforms, u_intensity: number(bloom.intensity, .6) };
    const declarations: string[] = [];
    const terms: string[] = [];
    targets.forEach((target, level) => {
      samplers[`u_level${level}`] = target;
      declarations.push(`uniform sampler2D u_level${level}; uniform vec3 u_tint${level};`);
      values[`u_tint${level}`] = (tints?.[Math.min(level, tints.length - 1)] ?? [1, 1, 1])
        .map(value => value * Math.pow(number(bloom.levelGain, .8), level) / count);
      terms.push(`texture(u_level${level},v_texCoord).rgb*u_tint${level}`);
    });
    passes.push({ frag: header + declarations.join('\n') + `\nuniform float u_intensity;\nvoid main(){vec4 c=texture(u_input,v_texCoord);outColor=vec4(c.rgb+(${terms.join('+')})*u_intensity,c.a);}`, inputFrom: base, samplers, uniforms: values });
  }
  const s = settings.streaks as Settings | undefined;
  if (s?.enabled && number(s.intensity, .9) > 0) passes.push({ frag: streak, uniforms: {
    ...uniforms, u_angle: number(s.angle, 0) * Math.PI / 180, u_length: number(s.length, .35),
    u_intensity: number(s.intensity, .9), u_threshold: number(s.threshold, .4), u_knee: number(s.knee, .5),
    u_taps: number(s.taps, 12), u_falloff: number(s.falloff, .86), u_mirror: s.mirror ? 1 : 0,
    u_tint: Array.isArray(s.tint) ? s.tint as number[] : [.55, .68, 1],
  } });
  const t = settings.tonemap as Settings | undefined;
  if (t?.enabled) passes.push({ frag: tonemap, uniforms: { ...uniforms, u_exposure: number(t.exposure, 0), u_lift: number(t.lift, 0), u_contrast: number(t.contrast, 1), u_saturation: number(t.saturation, 1) } });
}
