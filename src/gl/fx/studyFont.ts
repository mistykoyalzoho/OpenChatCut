let ready: Promise<void> | undefined;
let settled = false;
/** Font loading is shared by library cards, timeline preview and export. */
export function ensureStudyFont(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (!ready) ready = new FontFace('JetBrains Mono', 'url(/fonts/JetBrainsMono-Bold.ttf)', { weight: '700' })
    .load().then(font => { document.fonts.add(font); })
    .finally(() => { settled = true; });
  return ready;
}
export function studyFontSettled(): boolean { return settled; }
