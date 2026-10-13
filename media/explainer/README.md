# Harness Desk explainer

A 105-second, 1920 × 1080, 30 fps Remotion walkthrough: understand a setup, improve one thing, then verify a fresh session. Includes local synthesized narration, English captions in a dedicated bottom band, transcript and four real UI captures from synthetic fixtures. No real agent configuration or transcripts are used. The example input reduction is simulated, not a product performance claim.

## Source and assets

- `src/index.tsx`: React composition, motion, hierarchy diagram and screenshot scenes.
- `src/chapters.mjs`: narration, chapter timing and on-screen copy.
- `render.mjs`: validates audio, renders a proof frame for every chapter, then H.264 video.
- `finalize.mjs`: fits the full visual frame above a reserved 180-pixel caption band, burns in captions, and writes SRT/WebVTT captions. Cue timing is approximate within each measured narration segment.
- `../../docs/assets/user-guide/`: reviewed synthetic screenshots, also used in the [user guide](../../docs/user-guide.md).

The screenshot hashes are pinned in the public-source gate. Recapture only from an isolated synthetic app without real homes, accounts or repositories mounted. Visually review every image before updating its hash. Never use screenshots from a real local inventory for public materials.

## Render on macOS with Docker

From the repository root, prepare an ignored rendering workspace and generate narration using the built-in Samantha voice:

```sh
node media/explainer/prepare.mjs --narrate
docker build -t harness-explainer-renderer -f media/explainer/Dockerfile media/explainer
docker run --rm -v "$PWD/.verification/remotion:/work" -w /work harness-explainer-renderer npm ci --no-audit --no-fund
docker run --rm -v "$PWD/.verification/remotion:/work" -w /work harness-explainer-renderer sh -c 'for file in public/audio/*.aiff; do ffmpeg -y -v error -i "$file" "${file%.aiff}.wav"; done'
docker run --rm -v "$PWD/.verification/remotion:/work" -w /work harness-explainer-renderer npm run render
docker run --rm -v "$PWD/.verification/remotion:/work" -w /work harness-explainer-renderer node finalize.mjs
```

For proof frames only, replace `npm run render` with `node render.mjs --stills`. Rendering uses pinned npm dependencies and a separate Chromium/FFmpeg image; the application acquires no runtime dependencies.

On other platforms, run `prepare.mjs` without `--narrate` and supply a nonempty WAV file per chapter under `.verification/remotion/public/audio/`, named for the chapter ID. The render preflight rejects audio longer than its scene. Adjust chapter timing or narration before rendering. Docker commands may need shell-specific volume syntax. This media recipe does not establish Windows support for the app.

The final file is `.verification/remotion/output/harness-desk.mp4`. Copy deliverables you want to retain to `data/media/` before running local cleanup, which archives `.verification/`. Generated media remain ignored and are not automatically published. Respect the applicable Remotion license when using this renderer; see the [official licensing page](https://www.remotion.dev/license).

Before sharing, review every proof frame, play the finished video with sound, confirm caption timing and verify support claims against [the capability notes](../../docs/context-measurement-capabilities.md). Preserve the synthetic-demo and development-preview labels.

## Caption layout requirement

Captions must never cover screenshots, diagrams, labels or footnotes. Finalization fits the complete visual frame into 1600 × 900 at the top of the 1920 × 1080 output, preserving its aspect ratio without cropping. The bottom 180 pixels are reserved for captions, with at most two lines of 60 characters and a 42-pixel font. Caption groups are balanced to avoid brief one-word tails. A failed fit or sub-second cue blocks finalization.

The delivered MP4 burns captions into that reserved area so its layout is consistent across players; do not add another native caption overlay. Separate SRT/WebVTT files remain available for editing. Review `output/caption-proofs/` for every cue and `output/caption-layout.json` for timing and bounds before sharing.
