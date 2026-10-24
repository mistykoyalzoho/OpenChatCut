import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { historyReplayPassLimit } from './historyReplay.js';

const pass = (frag: string) => ({ frag });
assert.equal(historyReplayPassLimit([]), 0);
assert.equal(historyReplayPassLimit([pass('void main(){}'), pass('void main(){}')]), 2,
  'graphs without temporal uniforms retain the full replay path');
assert.equal(historyReplayPassLimit([
  pass('uniform sampler2D u_history; void main(){}'),
  pass('void main(){}'),
  pass('void main(){}'),
]), 1, 'downstream finishing passes are skipped after the last temporal pass');
assert.equal(historyReplayPassLimit([
  pass('void main(){}'),
  pass('uniform sampler2D u_feedback; void main(){}'),
  pass('uniform sampler2D u_history; void main(){}'),
  pass('void main(){}'),
]), 3, 'all passes through the last history or feedback consumer are replayed');

const [runtimeTypes, runtime, clipFx] = await Promise.all([
  readFile(new URL('../runtimeTypes.ts', import.meta.url), 'utf8'),
  readFile(new URL('../runtime.ts', import.meta.url), 'utf8'),
  readFile(new URL('../ClipFx.tsx', import.meta.url), 'utf8'),
]);
assert.match(runtimeTypes, /renderFxChain:[^\n]*maxPasses\?/);
assert.match(runtime, /ensureFbos\(Math\.max\(0, passes\.length - 1\)\)/,
  'the full graph framebuffer layout remains allocated');
assert.match(runtime, /const last = i === passes\.length - 1/,
  'the final target and all pass indices remain based on the full graph');
assert.match(runtime, /i < passLimit/);
assert.match(clipFx, /historyReplayPassLimit\(replayFrame\.passes\)/);

console.log('historyReplay.verify: temporal prefix preserves graph indices and full fallback');
