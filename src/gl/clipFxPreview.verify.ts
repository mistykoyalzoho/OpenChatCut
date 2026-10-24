import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./ClipFx.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(
  source,
  /import \{[^}]*\bVideo\b[^}]*\} from 'remotion'/,
  'effect preview must not reintroduce the HTML video decoder path',
);
assert.match(
  source,
  /<MediaVideo[\s\S]*onVideoFrame=\{onVideoFrame\}/,
  'effect preview must receive decoded frames from @remotion/media',
);
assert.doesNotMatch(
  source,
  /setRenderedKey\(renderKey\)/,
  'effect playback must not schedule a second React render for every decoded frame',
);
assert.match(
  source,
  /const historyContext = JSON\.stringify\([\s\S]*?renderFxChain\(shaderFrame\.passes, staging, historyContext\)/,
  'temporal GL history must be scoped to the clip and its effect graph',
);
assert.match(source, /ensureStudyFont\(\)\.catch/, 'Tag Pill font loading must settle before atlas rendering and fail soft');
assert.match(source, /replayVideoHistory\(\{ item, targetFrame: frame, fps/, 'history effects replay decoded source frames after seeks');
assert.match(source, /if \(isRendering\) cancelRender\(error\)/, 'failed history replay must fail export rather than export unfiltered media');
assert.match(source, /if \(disposed\) return/, 'cancelled replay jobs cannot publish stale frames');

console.log('clipFxPreview.verify: GL preview uses the shared @remotion/media decoder path');
