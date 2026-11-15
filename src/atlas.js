'use strict';

const path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { CHARS } = require('./prose');

const FAMILY = 'AsciiAnythingMono';
let fontReady = false;

function ensureFont(fontPath) {
  if (!fontReady) {
    const resolved = fontPath || path.join(__dirname, '..', 'assets', 'JetBrainsMono-Variable.ttf');
    const ok = GlobalFonts.registerFromPath(resolved, FAMILY);
    if (!ok) throw new Error(`could not register font at ${resolved}`);
    fontReady = true;
  }
  return FAMILY;
}

/**
 * Glyph atlas: one antialiased alpha tile per (weight, character), measured at
 * the cell pitch so ink coverage can be divided out later.
 */
class Atlas {
  constructor(opts) {
    const {
      fontPath,
      cellw,
      cellh,
      pad = 1,
      ss = 4,
      weights = [400, 500, 600, 700, 800],
      stroke = 0,
    } = opts;

    this.family = ensureFont(fontPath);
    this.cellw = cellw;
    this.cellh = cellh;
    this.pad = pad;
    this.ss = ss;
    this.weights = weights;
    this.stroke = stroke;
    this.tilew = cellw + 2 * pad;
    this.tileh = cellh + 2 * pad;
    this.area = this.tilew * this.tileh;
    this.chars = CHARS;

    // font size that makes the measured advance exactly one cell wide
    const probe = createCanvas(8, 8).getContext('2d');
    probe.font = `400 200px "${this.family}"`;
    const advance200 = probe.measureText('m').width;
    this.fontSize = cellw / (advance200 / 200);

    const size = Math.max(2, Math.round(this.fontSize * ss));
    const metricCtx = createCanvas(8, 8).getContext('2d');
    metricCtx.font = `400 ${size}px "${this.family}"`;
    const metrics = metricCtx.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent || size * 0.8;
    const descent = metrics.fontBoundingBoxDescent || size * 0.2;

    // keep the baseline inside the tile while leaving room for descenders
    const nativeBaseline = Math.min(
      cellh - 1,
      Math.max(cellh * 0.62, Math.round((cellh + (ascent - descent) / ss) / 2))
    );
    this.baseline = nativeBaseline;

    this.alpha = new Float32Array(weights.length * this.chars.length * this.area);
    this.coverage = new Float32Array(weights.length * this.chars.length);

    this._build(nativeBaseline);
  }

  _build(baseline) {
    const { ss, pad, tilew, tileh, cellw, cellh, area } = this;
    const big = createCanvas(tilew * ss, tileh * ss);
    const ctx = big.getContext('2d');
    const size = Math.max(2, Math.round(this.fontSize * ss));
    const tile = new Float32Array(this.area);

    for (let wi = 0; wi < this.weights.length; wi++) {
      const weight = this.weights[wi];
      for (let ci = 0; ci < this.chars.length; ci++) {
        const ch = this.chars[ci];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, big.width, big.height);
        if (ch !== ' ') {
          ctx.font = `${weight} ${size}px "${this.family}"`;
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = '#fff';
          const x = pad * ss;
          const y = baseline * ss;
          if (this.stroke > 0) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = this.stroke * ss;
            ctx.lineJoin = 'round';
            ctx.strokeText(ch, x, y);
          }
          ctx.fillText(ch, x, y);
        }
        const data = ctx.getImageData(0, 0, big.width, big.height).data;

        // box downsample by ss in each direction
        for (let ty = 0; ty < tileh; ty++) {
          for (let tx = 0; tx < tilew; tx++) {
            let sum = 0;
            for (let y = 0; y < ss; y++) {
              let p = ((ty * ss + y) * big.width + tx * ss) * 4 + 3;
              for (let x = 0; x < ss; x++, p += 4) sum += data[p];
            }
            tile[ty * tilew + tx] = sum / (ss * ss * 255);
          }
        }

        const base = (wi * this.chars.length + ci) * area;
        this.alpha.set(tile, base);

        let ink = 0;
        for (let y = 0; y < cellh; y++) {
          const row = (pad + y) * tilew + pad;
          for (let x = 0; x < cellw; x++) ink += tile[row + x];
        }
        this.coverage[wi * this.chars.length + ci] = Math.max(ink / (cellw * cellh), 0.02);
      }
    }
  }

  coverageAt(wi, ci) {
    return this.coverage[wi * this.chars.length + ci];
  }

  meanCoverage() {
    let sum = 0;
    for (let i = 0; i < this.coverage.length; i++) sum += this.coverage[i];
    return sum / this.coverage.length;
  }

  stats() {
    return this.weights.map((w, i) => ({
      weight: w,
      coverage: Number(
        (
          this.coverage.slice(i * this.chars.length, (i + 1) * this.chars.length).reduce((a, b) => a + b, 0) /
          this.chars.length
        ).toFixed(4)
      ),
    }));
  }
}

module.exports = { Atlas, FAMILY };
