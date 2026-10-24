/** Independent reconstructions of the 24 public effect presets. All rendering
 * stays local, through the same GL graph used by preview and export. */
import presets from './studyPresets.json';
import { buildStudyGridPasses } from './studyGrid';
import { buildStudyMotionPasses } from './studyMotion';
import { appendStudyFinish } from './studyFinish';
import type { FxDef } from './uniforms';
import type { FxPass, UniformValue } from '../runtimeTypes';

type Key = { t: number; v: number; ease: string };
function bezier(x: number, points: number[]): number {
  const [x1, y1, x2, y2] = points;
  const value = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const t = (low + high) / 2;
    if (value(t, x1, x2) < x) low = t; else high = t;
  }
  return value((low + high) / 2, y1, y2);
}
export function studyEase(t: number, easing: string): number {
  const x = Math.min(1, Math.max(0, t));
  if (x === 0 || x === 1) return x;
  if (easing === 'easeOut') return bezier(x, [.22, 1, .36, 1]);
  if (easing === 'easeIn') return bezier(x, [.64, 0, .78, 0]);
  if (easing === 'easeInOut') return bezier(x, [.83, 0, .17, 1]);
  if (easing === 'spring') {
    const damping = .55, frequency = 16, damped = frequency * Math.sqrt(1 - damping * damping);
    const response = (t: number) => 1 - Math.exp(-damping * frequency * t) * (Math.cos(damped * t) + damping * frequency / damped * Math.sin(damped * t));
    return response(x) + (1 - response(1)) * x;
  }
  return x;
}
export function studyTrackValue(keys: Key[], time: number): number {
  if (time <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (time <= b.t) return a.v + (b.v - a.v) * studyEase((time - a.t) / Math.max(.000001, b.t - a.t), a.ease);
  }
  return keys[keys.length - 1].v;
}
const copy = `#version 300 es
precision highp float;in vec2 v_texCoord;uniform sampler2D u_input;out vec4 outColor;
void main(){outColor=texture(u_input,v_texCoord);}`;
const strength = `#version 300 es
precision highp float;in vec2 v_texCoord;uniform sampler2D u_input,u_original;uniform float u_strength;out vec4 outColor;
void main(){outColor=mix(texture(u_original,v_texCoord),texture(u_input,v_texCoord),u_strength);}`;

export const STUDY_EFFECTS: Record<string, FxDef> = {};
export const STUDY_ORDER: string[] = [];
for (const preset of presets) {
  const id = `builtin:fx-study-${preset.slug}`;
  const pipeline = (input: Record<string, UniformValue>): FxPass[] => {
    const time = Number(input.u_time ?? 0) * Number(input.u_speed ?? 1);
    const uniforms = { ...input, u_time: time, u_speed: 1, u_amount: 1 };
    const passes: FxPass[] = [{ frag: copy, uniforms }];
    preset.fx.forEach((node, index) => {
      const params: Record<string, unknown> = { ...node.params };
      for (const track of preset.tracks) if (track.index === index && track.path[0] === 'params') {
        params[track.path[1]] = studyTrackValue(track.keys, time % preset.duration);
      }
      const local = buildStudyGridPasses(node.type, params, uniforms)
        ?? buildStudyMotionPasses(node.type, params, uniforms);
      if (!local) throw new Error(`Unsupported study effect: ${node.type}`);
      const offset = passes.length;
      for (const pass of local) passes.push({ ...pass,
        inputFrom: pass.inputFrom == null ? undefined : pass.inputFrom + offset,
        samplers: pass.samplers ? Object.fromEntries(Object.entries(pass.samplers).map(([name, value]) => [name, value + offset])) : undefined,
      });
    });
    appendStudyFinish(passes, preset.finish, uniforms);
    appendStudyFinish(passes, preset.post, uniforms);
    passes.push({ frag: strength, uniforms: { ...uniforms, u_strength: Number(input.u_strength ?? 1) }, samplers: { u_original: 0 } });
    return passes;
  };
  STUDY_EFFECTS[id] = {
    id, name: preset.name, desc: `${preset.name} · reconstructed preset`,
    frag: copy,
    props: [
      { key: 'strength', label: 'Strength', default: 1, min: 0, max: 1, step: .01 },
      { key: 'scale', label: 'Detail scale', default: 1, min: .25, max: 4, step: .05 },
      { key: 'speed', label: 'Motion speed', default: 1, min: 0, max: 4, step: .05 },
    ],
    requiresHistory: preset.fx.some(node => ['kineticTrace'].includes(node.type)),
    pipeline,
  };
  STUDY_ORDER.push(id);
}
