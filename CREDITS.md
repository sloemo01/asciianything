# Credits

## Reference

**everything is ascii** — [@buildwithsid on X](https://x.com/buildwithsid/status/2110732049661485084), posted 15 Oct 2026.
The effect this project is measured against.

## Footage

**Night highway** — [Night Traffic Flow in Urban Highway View](https://www.pexels.com/video/night-traffic-flow-in-urban-highway-view-35835506/)
by [Sururi Ballıdağ](https://www.pexels.com/@drector/) (İstanbul).
Source file `15195617_1440_2560_30fps.mp4`, 1440 × 2560, 29.97 fps, 19.42 s.
Used under the [Pexels license](https://www.pexels.com/license/). `assets/night-highway-1080p.mp4` is the
ASCII derivative of it: a 16:9 crop of the vertical original, rendered at 1920 × 1080.

**Sunset** — [Stunning Beach Sunset with Vibrant Colors](https://www.pexels.com/video/stunning-beach-sunset-with-vibrant-colors-29045884/)
by [Manoo Media](https://www.pexels.com/@manoo-media-65214113/).
Source file `12556562_3840_2160_60fps.mp4`, 3840 × 2160, 60 fps, 11.57 s.
Used under the [Pexels license](https://www.pexels.com/license/). `assets/sunset-ascii.mp4` is the ASCII derivative.

**Aurora** — [Aurora Borealis Forms in the Sky](https://www.pexels.com/video/aurora-borealis-forms-in-the-sky-5700940/)
by [Nico Becker](https://www.pexels.com/@nicobecker/).
Source file `5700940-uhd_3840_2160_25fps.mp4`, 3840 × 2160, 25 fps, 7.57 s, scaled to 1920 × 1080 before rendering.
Used under the [Pexels license](https://www.pexels.com/license/). `assets/aurora-harbour-1080p.mp4` is the ASCII derivative; the
source's black point was crushed before rendering so the night sky stays clean.

**New York** — [Fireworks Over New York Skyline at Night](https://www.pexels.com/video/fireworks-over-new-york-skyline-at-night-38103693/)
by [Yura Forrat](https://www.pexels.com/@yuraforrat/).
Source file `16183841_3840_2160_30fps.mp4`, 3840 × 2160, 30 fps, 16.03 s, scaled to 1920 × 1080 before rendering.
Used under the [Pexels license](https://www.pexels.com/license/). `assets/new-york-1080p.mp4` is the ASCII derivative.

The Pexels license allows free use, including commercial use and modification, without attribution.
The credits above are given because the footage is the other half of these renders, not because the licence demands it.

## Typeface

**JetBrains Mono** — [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono),
licensed under the SIL Open Font License 1.1. The variable font is bundled at
`assets/JetBrainsMono-Variable.ttf` with the licence text in `assets/OFL.txt`.

## Prose

The bundled sentence banks were written for this project: `assets/prose.json` (1,844 sentences) for the
night-highway clips, `assets/prose-aurora.txt` (35) for the aurora, `assets/prose-city.txt` (35) for the
New York clip, and a separate 256-sentence bank for the sunset. None is sampled from another work.

## Code

MIT — see [`LICENSE`](LICENSE). The renderer uses [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas)
(Skia bindings, MIT) for glyph rasterisation, and `ffmpeg` for decoding and encoding.
