# Credits

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

The Pexels license allows free use, including commercial use and modification, without attribution.
The credits above are given because the footage is the other half of these renders, not because the licence demands it.

## Typeface

**JetBrains Mono** — [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono),
licensed under the SIL Open Font License 1.1. The variable font is bundled at
`assets/JetBrainsMono-Variable.ttf` with the licence text in `assets/OFL.txt`.

## Prose

The bundled sentence bank (`assets/prose.json`) was written for this project. It is deterministic
generated text, not sampled from any other work. The sunset demo uses a separate 256-sentence bank
written for that clip.

## Code

MIT — see [`LICENSE`](LICENSE). The renderer uses [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas)
(Skia bindings, MIT) for glyph rasterisation, and `ffmpeg` for decoding and encoding.
