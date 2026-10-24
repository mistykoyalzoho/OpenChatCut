import type { TimelineItem } from '../../editor/types.js';
import { sourceFrameAt } from '../../editor/sourceLimit.js';

export interface HistoryReplayInput {
  item: Pick<TimelineItem, 'src' | 'srcInFrame' | 'playbackRate'>;
  targetFrame: number;
  fps: number;
  signal: AbortSignal;
  render: (source: CanvasImageSource, localFrame: number) => void;
}

/** Return the shortest prefix that can update temporal GL state. A pass that
 * reads history/feedback can affect later temporal passes, so retain everything
 * through the last such pass. If shader metadata is absent, replay the full graph. */
export function historyReplayPassLimit(passes: readonly { frag: string }[]): number {
  let lastHistoryPass = -1;
  for (let index = 0; index < passes.length; index++) {
    if (/uniform\s+sampler2D\s+u_(?:history|feedback)\b/.test(passes[index].frag)) lastHistoryPass = index;
  }
  return lastHistoryPass < 0 ? passes.length : lastHistoryPass + 1;
}

/** Decode and replay every source frame before a seek target so temporal GL
 * effects have the same feedback state as sequential playback/export. */
export async function replayVideoHistory({ item, targetFrame, fps, signal, render }: HistoryReplayInput): Promise<void> {
  if (!item.src) throw new Error('Cannot replay GL history without a video source URL');
  const { ALL_FORMATS, CanvasSink, Input, UrlSource } = await import('mediabunny');
  if (signal.aborted) return;
  const input = new Input({ source: new UrlSource(item.src), formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`No video track available for GL history replay: ${item.src}`);
    const sink = new CanvasSink(track);
    const timestamps = Array.from({ length: Math.max(0, Math.floor(targetFrame)) }, (_, frame) =>
      sourceFrameAt(item, frame) / fps + 0.001,
    );
    let localFrame = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (signal.aborted) return;
      if (!wrapped) throw new Error(`Unable to decode GL history frame ${localFrame} from ${item.src}`);
      render(wrapped.canvas, localFrame++);
    }
    if (!signal.aborted && localFrame !== timestamps.length) {
      throw new Error(`Incomplete GL history replay: decoded ${localFrame}/${timestamps.length} frames`);
    }
  } finally {
    signal.removeEventListener('abort', abort);
    input.dispose();
  }
}
