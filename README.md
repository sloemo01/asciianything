# asciianything

Turn any video into a mosaic of coloured lowercase prose — frame-accurate, full length, full resolution.

```bash
npx asciianything night-drive.mp4
```

![night highway, source and ascii prose](https://raw.githubusercontent.com/sloemo01/asciianything/main/assets/comparison.png)

Not an `@%#*+=-:.` ramp. Every cell of the picture is one stable English word-character, the prose is readable up close, and at normal viewing distance the mosaic reads as the original footage: same framing, same colours, same exposure, same motion.

![ascii frame](https://raw.githubusercontent.com/sloemo01/asciianything/main/assets/preview.png)

## Why it looks like the video and not like text wallpaper

A glyph only covers part of its cell. Drawing the sampled source colour into the letter multiplies the source by the ink coverage and turns bright footage into a dark wall of text. So the renderer measures, for every character at every weight, how much of the cell it actually inks, and divides:

```
emitted = scene / (coverage × calibration)
```

Each glyph is therefore brighter than its source cell, and the **integrated cell** — letters plus the black gaps between them — averages back to the sampled colour in linear light. Bright regions stay bright; a blue sky stays blue instead of going navy.

The rest of the contract:

- **One fixed prose field.** A sentence bank is shuffled per row with a deterministic hash, so no row repeats the row above and every cell keeps the same character for the whole video. Only colour and glyph weight follow the scene.
- **Subcell sampling.** Each cell integrates a `cellW × cellH` block of the full-resolution frame, recovering percentiles and the bright-quartile colour, so a light smaller than a cell still lifts it.
- **Linear light.** sRGB is decoded to linear before any averaging or compensation, then encoded once on output.
- **No synthetic cinematography.** No zoom, pan, transitions, grain, vignette or animated font size. One source frame in, one rendered frame out.

## Requirements

- Node 18+
- `ffmpeg` and `ffprobe` on `PATH`

## Usage

```bash
# whole video, same resolution / frame rate / duration
npx asciianything input.mp4 -o output.mp4

# bigger letters
npx asciianything input.mp4 --font-size 32

# one still as PNG (seconds into the video)
npx asciianything input.mp4 --still 8 -o frame.png

# preview the first 60 frames
npx asciianything input.mp4 --limit 60 -o preview.mp4

# your own prose instead of the bundled night-highway bank
npx asciianything input.mp4 --prose my-words.txt
```

### Options

| flag | default | meaning |
| --- | --- | --- |
| `-o, --out <file>` | `<input>-ascii.mp4` | output path |
| `--font-size <px>` | `20` | glyph size in output pixels; cells are `0.6 × fs` wide, `1.12 × fs` tall |
| `--cell-ratio <r>` | `1.12` | cell height ÷ font size |
| `--weights <a,b,…>` | `400,500,600,700,800` | font weights available to the atlas |
| `--weight-min / --weight-max` | `600` / `800` | weight range chosen from scene luminance |
| `--stroke <px>` | `0.5` | extra outline that raises ink coverage |
| `--calibration <n>` | `0.86` | ink-coverage calibration for the final composite |
| `--diffusion <n>` | `0.1` | base softening of ink into the gaps |
| `--diffusion-adaptive <n>` | `0.25` | extra softening for bright cells (tames highlight clipping) |
| `--detail <n>` | `0.14` | subcell luminance recovery |
| `--color-detail <n>` | `0.1` | subcell colour recovery |
| `--prose <file>` | bundled bank | `.txt` (sentences) or `.json` (array of sentences) |
| `--crf <n>` / `--preset <p>` | `17` / `slow` | x264 quality and speed |
| `--still <seconds>` | — | render a single PNG instead |
| `--limit <n>` | — | stop after n frames |
| `--info` | — | print grid, cell size and measured coverage |

## The bundled look

`assets/prose.json` holds 1,844 deterministic sentences about night highways, sodium light, lane dashes and distant towers. It is the house voice for the demo — pass `--prose` to write your own. Any lowercase English works; longer sentences read better at small font sizes.

![prose detail](https://raw.githubusercontent.com/sloemo01/asciianything/main/assets/detail.png)

## Demo

`assets/demo.mp4` — 1440×2560, 29.97 fps, 19.42 s, rendered from a night freeway clip at `--font-size 20` (120 × 117 cells, 14,040 characters). The MP4 was produced by this package's renderer and encoder path.

## How it is built

- `src/atlas.js` rasterises every character at every weight through Skia (`@napi-rs/canvas`), supersampled 4× and box-averaged down to the cell pitch, then measures the real ink coverage of each tile.
- `src/render.js` samples the frame, computes per-cell linear colour and luminance, picks a weight, divides by measured coverage, and composites the ink into an RGB buffer.
- `src/prose.js` builds the fixed character field from the sentence bank.
- `src/cli.js` pipes raw frames from `ffmpeg` into the renderer and rendered frames straight into `libx264`, so no intermediate frame sequence ever touches disk.

Rendering is deterministic: same input frame and settings produce the same output frame.

## Limits

Large glyphs mean fewer cells, and a cell can only average as bright as its ink coverage allows. Very bright, very large highlights (a full-white sky at `--font-size 32`) will top out below the source; lowering `--calibration` brightens the whole mosaic, raising it darkens it. Small font sizes preserve more detail and read as a finer texture.

## Licence

MIT for the code. The bundled JetBrains Mono font is SIL OFL 1.1 — see `assets/OFL.txt`.
