# Public effect preset reconstruction

The Effects library includes 24 independently implemented presets based on the
public Ladybug effect collection. They use the existing OpenChatCut WebGL graph
for library thumbnails, clip preview, and export. Preset names describe the
reference looks; visual equivalence requires separate reference comparisons.

The collection contains 19 effect algorithms in 24 ordered stacks. The preset
settings live in `src/gl/fx/studyPresets.json`. Rendering is split between
`studyGrid.ts`, `studyMotion.ts`, and `studyFinish.ts`. No downloaded renderer
bundle or reference media is distributed with the application.

Each preset exposes Strength, Detail scale, and Motion speed. Strength zero
preserves the original clip. Thermal Pink includes its reference progress track.
Neo Motion, Trace Motion, and The Trace require previous frames. Seeking or
requesting an isolated export frame replays the clip's preceding frames to rebuild
feedback, which can make late-frame requests expensive. Temporal effects inside
transition overlaps currently stop export with an explicit error. Preview shows
the transition fallback reason.

JetBrains Mono Bold is bundled under the SIL Open Font License. Its license and
copyright notice are in `assets/fonts/licenses/JetBrainsMono-OFL.txt`. Tag Pill
waits for the font before creating its text atlas. Korean glyphs still depend on
available system font fallback.

## Verification

Build and export checks establish that an effect executes. They do not establish
pixel, color, motion, or spring fidelity. Reference evaluation must match source,
crop, output dimensions, time, and frame history. A comparison of a file with
itself only verifies the comparison harness.

The initial ASCII CG0 comparison showed a large visible mismatch. Its candidate
also used a lower resolution. A later comparison raised a source/reference
sequence pairing concern. Neither result qualifies the preset as an exact
reproduction. Exact fidelity across all 24 presets remains unverified.

Native-size Remotion PNG checks produced start and middle frames for all 24
presets, and end frames for 23. Neo Motion's end frame (884) timed out both at the
default limit and with a 120-second limit. Its long isolated-frame replay remains
an unresolved performance issue. Thermal Pink was checked using a processed
preview as substitute input because its original clip was unavailable; that check
only establishes execution.

A separate 160×90, 30 fps Trace Motion regression compared every decoded RGB byte
of frame 30 from sequential and isolated exports. MSE was 0.0003472222 across
43,200 bytes before the replay-prefix performance change. That checks replay consistency, not similarity to the public look; the optimized path requires its own parity receipt.

After the replay-prefix change, Neo Motion sequential and isolated exports at
frame 30 (160×90, 30 fps) matched exactly across all 43,200 decoded RGB bytes
(MSE 0). This is a replay consistency check, not a public-reference fidelity score.
