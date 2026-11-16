#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { createCanvas } = require('@napi-rs/canvas');
const { Renderer } = require('./render');

const HELP = `
asciianything — turn anything with pixels into coloured lowercase prose.

usage:
  asciianything <video.mp4>            [-o out.mp4]
  asciianything <photo.png>            [-o out.png]
  asciianything <frames-dir/> [--fps]  [-o out.mp4]

options:
  -o, --out <file>        output video (default: <input>-ascii.mp4)
  --font-size <px>        glyph size in output pixels (default 20)
  --cell-ratio <r>        cell height / font size (default 1.12)
  --weights <a,b,..>      font weights used (default 400,500,600,700,800)
  --weight-min <n>        lightest weight for dark cells (default 600)
  --weight-max <n>        heaviest weight for bright cells (default 800)
  --stroke <px>           extra glyph stroke in output pixels (default 0.5)
  --calibration <n>       ink-coverage calibration (default 0.86)
  --diffusion <n>         base ink softening, 0..1 (default 0.1)
  --diffusion-adaptive    extra softening for bright cells (default 0.25)
  --halo <n>              highlight halo for light the ink cannot carry (default 0)
  --halo-radius <px>      halo blur radius (default 0.9 x cell width)
  --detail <n>            subcell luminance detail recovery (default 0.14)
  --color-detail <n>      subcell colour recovery (default 0.1)
  --prose <file>          sentence bank (.txt or .json) instead of the bundled one
  --crf <n>               x264 quality, lower is better, 0 = lossless (default 17)
  --pix-fmt <fmt>         encoder pixel format: yuv420p or yuv444p (default yuv420p)
  --preset <name>         x264 preset (default slow)
  --fps <n>               frame rate for an image-sequence input (default 30)
  --still <seconds>       render one frame to PNG instead of the whole video
  --limit <n>             only render the first n frames (preview)
  --info                  print grid and coverage stats, then exit
  -q, --quiet             no progress output
  -h, --help              show this help

requires ffmpeg and ffprobe on PATH.
`.trim();

function fail(msg) {
  console.error(`asciianything: ${msg}`);
  process.exit(1);
}

function which(bin) {
  const res = spawnSync(bin, ['-version'], { stdio: 'ignore' });
  if (res.error || res.status !== 0) {
    fail(`${bin} not found. Install ffmpeg (brew install ffmpeg / apt install ffmpeg) and try again.`);
  }
}

function probe(file) {
  const res = spawnSync(
    'ffprobe',
    [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration',
      '-of', 'json', file,
    ],
    { encoding: 'utf8' }
  );
  if (res.status !== 0) fail(`ffprobe failed on ${file}`);
  const info = JSON.parse(res.stdout).streams[0];
  const rate = info.avg_frame_rate && info.avg_frame_rate !== '0/0' ? info.avg_frame_rate : info.r_frame_rate;
  const [num, den] = rate.split('/').map(Number);
  return {
    width: info.width,
    height: info.height,
    rate,
    fps: num / den,
    frames: Number(info.nb_frames) || 0,
    duration: Number(info.duration) || 0,
  };
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp', '.avif']);

function probeImage(file) {
  const res = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file],
    { encoding: 'utf8' }
  );
  if (res.status !== 0) fail(`ffprobe failed on ${file}`);
  const info = JSON.parse(res.stdout).streams[0];
  if (!info || !info.width) fail(`no image data in ${file}`);
  return { width: info.width, height: info.height, fps: 0, rate: '0/1', frames: 1, duration: 0 };
}

function probeSequence(dir, fps) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort();
  if (!files.length) fail(`no images in ${dir}`);
  const first = path.join(dir, files[0]);
  const img = probeImage(first);
  const ext = path.extname(files[0]).toLowerCase();
  const same = files.filter((f) => path.extname(f).toLowerCase() === ext).length;
  return {
    width: img.width,
    height: img.height,
    fps,
    rate: `${fps}/1`,
    frames: same,
    duration: same / fps,
    pattern: path.join(dir, `*${ext}`),
  };
}

async function* readFrames(stream, frameBytes) {
  const buf = Buffer.allocUnsafe(frameBytes);
  let fill = 0;
  for await (const chunk of stream) {
    let off = 0;
    while (off < chunk.length) {
      const take = Math.min(frameBytes - fill, chunk.length - off);
      chunk.copy(buf, fill, off, off + take);
      fill += take;
      off += take;
      if (fill === frameBytes) {
        yield buf;
        fill = 0;
      }
    }
  }
}

function writeFrame(stream, buf, proc) {
  if (stream.write(buf)) return null;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', onDrain);
      proc.off('exit', onExit);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`encoder exited with code ${code}`));
    };
    stream.once('drain', onDrain);
    proc.once('exit', onExit);
  });
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        'font-size': { type: 'string' },
        'cell-ratio': { type: 'string' },
        weights: { type: 'string' },
        'weight-min': { type: 'string' },
        'weight-max': { type: 'string' },
        stroke: { type: 'string' },
        calibration: { type: 'string' },
        diffusion: { type: 'string' },
        'diffusion-adaptive': { type: 'string' },
        halo: { type: 'string' },
        'halo-radius': { type: 'string' },
        detail: { type: 'string' },
        'color-detail': { type: 'string' },
        prose: { type: 'string' },
        crf: { type: 'string' },
        'pix-fmt': { type: 'string' },
        preset: { type: 'string' },
        fps: { type: 'string' },
        still: { type: 'string' },
        limit: { type: 'string' },
        info: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    fail(err.message);
  }

  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  which('ffmpeg');
  which('ffprobe');

  const input = positionals[0];
  if (!fs.existsSync(input)) fail(`no such file: ${input}`);
  const isDir = fs.statSync(input).isDirectory();
  const isImage = !isDir && IMAGE_EXT.has(path.extname(input).toLowerCase());
  const seqFps = Number(values.fps || 30);
  const meta = isDir ? probeSequence(input, seqFps) : isImage ? probeImage(input) : probe(input);
  const quiet = !!values.quiet;

  const num = (v, d) => (v === undefined ? d : Number(v));
  const cfg = {
    width: meta.width,
    height: meta.height,
    fontSize: num(values['font-size'], 20),
    cellRatio: num(values['cell-ratio'], 1.12),
    weights: values.weights
      ? values.weights.split(',').map((v) => Number(v.trim()))
      : [400, 500, 600, 700, 800],
    weightMin: num(values['weight-min'], 600),
    weightMax: num(values['weight-max'], 800),
    stroke: num(values.stroke, 0.5),
    calibration: num(values.calibration, 0.86),
    diffusion: num(values.diffusion, 0.1),
    diffusionAdaptive: num(values['diffusion-adaptive'], 0.25),
    halo: num(values.halo, 0),
    haloRadius: values['halo-radius'] === undefined ? undefined : num(values['halo-radius'], 0),
    detailLuma: num(values.detail, 0.14),
    detailColor: num(values['color-detail'], 0.1),
    prosePath: values.prose,
  };

  const t0 = Date.now();
  const renderer = new Renderer(cfg);
  const stats = renderer.stats();
  if (!quiet) {
    console.error(
      `grid ${stats.grid[0]}x${stats.grid[1]} (${stats.cells} cells), ` +
        `glyph ${stats.fontSize}px on ${stats.cell[0]}x${stats.cell[1]}px cells, ` +
        `${stats.sentences} sentences, ready in ${((Date.now() - t0) / 1000).toFixed(2)}s`
    );
  }
  if (values.info) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  if (isImage || values.still !== undefined) {
    const at = isImage ? 0 : Number(values.still);
    const png = await renderStill(input, at, renderer, meta);
    let out = values.out || `${path.basename(input, path.extname(input))}-ascii.png`;
    if (path.extname(out).toLowerCase() !== '.png') {
      out = `${out.slice(0, out.length - path.extname(out).length)}.png`;
      if (!quiet) console.error(`one frame: writing PNG -> ${out}`);
    }
    fs.writeFileSync(out, png);
    if (!quiet) console.error(`wrote ${out}`);
    return;
  }

  const out = values.out || `${path.basename(input, path.extname(input))}-ascii.mp4`;
  const limit = values.limit ? Number(values.limit) : 0;

  // yuv420p needs even dimensions; pick 4:4:4 automatically when they are odd
  // so an odd-sized frame sequence still encodes at its exact size.
  const even = meta.width % 2 === 0 && meta.height % 2 === 0;
  const pixFmt = values['pix-fmt'] || (even ? 'yuv420p' : 'yuv444p');
  if (!even && !values['pix-fmt'] && !quiet) {
    console.error(`${meta.width}x${meta.height} is odd: encoding yuv444p (yuv420p needs even sizes)`);
  }

  const decodeArgs = isDir
    ? ['-v', 'error', '-framerate', String(seqFps), '-pattern_type', 'glob', '-i', meta.pattern]
    : ['-v', 'error', '-i', input];
  const decoder = spawn(
    'ffmpeg',
    [...decodeArgs, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let decodeErr = '';
  decoder.stderr.on('data', (d) => {
    decodeErr += d.toString();
  });

  const encoder = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24',
      '-s', `${meta.width}x${meta.height}`, '-r', meta.rate, '-i', '-',
      '-vf', 'scale=out_color_matrix=bt709',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-an', '-c:v', 'libx264', '-preset', values.preset || 'slow',
      '-crf', String(num(values.crf, 17)), '-pix_fmt', pixFmt,
      '-movflags', '+faststart', out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] }
  );

  const frameBytes = meta.width * meta.height * 4;
  let count = 0;
  const started = Date.now();

  try {
    for await (const frame of readFrames(decoder.stdout, frameBytes)) {
      const rgb = renderer.renderFrame(frame);
      const pending = writeFrame(encoder.stdin, Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length), encoder);
      if (pending) await pending;
      count++;
      if (!quiet && count % 20 === 0) {
        const elapsed = (Date.now() - started) / 1000;
        console.error(`frame ${count}  ${(count / elapsed).toFixed(2)} fps`);
      }
      if (limit && count >= limit) break;
    }
    encoder.stdin.end();
    const code = await new Promise((resolve) => encoder.on('close', resolve));
    if (code !== 0) {
      fail(
        `encoder exited with ${code}. For odd frame sizes or exact colour try ` +
          `--pix-fmt yuv444p (and --crf 0 for a lossless encode).`
      );
    }
    if (decodeErr.trim() && !limit) fail(`decoder reported: ${decodeErr.split('\n')[0]}`);
  } finally {
    decoder.kill();
  }

  if (!quiet) {
    const size = (fs.statSync(out).size / 1e6).toFixed(1);
    console.error(`rendered ${count} frames in ${((Date.now() - started) / 60000).toFixed(1)} min -> ${out} (${size} MB)`);
  }
}

// One frame, decoded exactly as the video decoder decodes them: same flags,
// same pixel format, same renderer call. A photo is simply a source with one
// frame, so its output is byte-identical to frame 0 of a clip of that image.
async function renderStill(input, at, renderer, meta) {
  const seek = at > 0 ? ['-ss', String(at)] : [];
  const res = spawnSync(
    'ffmpeg',
    ['-v', 'error', ...seek, '-i', input, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: meta.width * meta.height * 4 * 2 }
  );
  if (res.status !== 0) fail('could not decode the frame for --still');
  const rgb = renderer.renderFrame(new Uint8ClampedArray(res.stdout));
  const canvas = createCanvas(meta.width, meta.height);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(meta.width, meta.height);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    img.data[j] = rgb[i];
    img.data[j + 1] = rgb[i + 1];
    img.data[j + 2] = rgb[i + 2];
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toBuffer('image/png');
}

main().catch((err) => fail(err.stack || String(err)));
