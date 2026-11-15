'use strict';

const { createCanvas } = require('@napi-rs/canvas');
const { Atlas } = require('./atlas');
const { CHARS, buildCharGrid, loadBank, defaultBank } = require('./prose');

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function smoothstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** k-th smallest (0-based) via Hoare partition; reorders `arr` in place. */
function kth(arr, n, k) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = arr[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (arr[i] < pivot) i++;
      while (arr[j] > pivot) j--;
      if (i <= j) {
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return arr[k];
}

/**
 * Deterministic prose-mosaic renderer.
 *
 * A source frame goes in as RGBA; a completed RGB frame comes out. Every
 * character index is fixed for the whole video, only colour and weight follow
 * the sampled scene.
 */
class Renderer {
  constructor(cfg = {}) {
    this.width = cfg.width || 1920;
    this.height = cfg.height || 1080;
    this.fontSize = cfg.fontSize || 20;
    this.cellRatio = cfg.cellRatio || 1.12;
    this.cellw = cfg.cellw || Math.max(2, Math.round(this.fontSize * 0.6));
    this.cellh = cfg.cellh || Math.max(3, Math.round(this.fontSize * this.cellRatio));
    this.pad = cfg.pad === undefined ? 1 : cfg.pad;
    this.ss = cfg.ss || 4;
    this.weights = cfg.weights || [400, 500, 600, 700, 800];
    this.weightMin = cfg.weightMin === undefined ? 600 : cfg.weightMin;
    this.weightMax = cfg.weightMax === undefined ? 800 : cfg.weightMax;
    this.stroke = cfg.stroke === undefined ? 0.5 : cfg.stroke;
    this.calibration = cfg.calibration === undefined ? 0.86 : cfg.calibration;
    this.maxEmitted = cfg.maxEmitted === undefined ? 8 : cfg.maxEmitted;
    this.diffusion = cfg.diffusion === undefined ? 0.1 : cfg.diffusion;
    this.diffusionAdaptive = cfg.diffusionAdaptive === undefined ? 0.25 : cfg.diffusionAdaptive;
    this.diffusionPasses = cfg.diffusionPasses || 1;
    this.detailLuma = cfg.detailLuma === undefined ? 0.14 : cfg.detailLuma;
    this.detailColor = cfg.detailColor === undefined ? 0.1 : cfg.detailColor;
    this.satLift = cfg.satLift === undefined ? 1.02 : cfg.satLift;

    this.cols = Math.ceil(this.width / this.cellw);
    this.rows = Math.ceil(this.height / this.cellh);
    this.cells = this.cols * this.rows;
    this.sampleW = this.cols * this.cellw;
    this.sampleH = this.rows * this.cellh;
    this.subX = this.cellw;
    this.subY = this.cellh;

    this.atlas = new Atlas({
      fontPath: cfg.fontPath,
      cellw: this.cellw,
      cellh: this.cellh,
      pad: this.pad,
      ss: this.ss,
      weights: this.weights,
      stroke: this.stroke,
    });
    this.stride = this.atlas.chars.length * this.atlas.area;
    this.flat = this.atlas.alpha;

    this.linLUT = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.linLUT[i] = srgbToLinear(i / 255);
    this.outLUT = buildOutputLUT();

    const bank = cfg.prosePath ? loadBank(cfg.prosePath) : loadBank(defaultBank());
    this.sentences = bank;
    this.chars = buildCharGrid(this.cols, this.rows, bank);

    // pixel -> cell / atlas offset, computed once
    const H = this.height;
    const W = this.width;
    const pad = this.pad;
    this.cellId = new Int32Array(H * W);
    this.base = new Int32Array(H * W);
    for (let y = 0; y < H; y++) {
      const cy = (y / this.cellh) | 0;
      const ty = (y % this.cellh) + pad;
      for (let x = 0; x < W; x++) {
        const cx = (x / this.cellw) | 0;
        const tx = (x % this.cellw) + pad;
        const i = y * W + x;
        const cell = cy * this.cols + cx;
        this.cellId[i] = cell;
        this.base[i] = this.chars[cell] * this.atlas.area + ty * this.atlas.tilew + tx;
      }
    }

    // deterministic +/-1 weight jitter on ~22% of cells
    this.jitter = new Int8Array(this.cells);
    for (let c = 0; c < this.cells; c++) {
      const h = (Math.imul(c + 1, 0x9e3779b1) ^ 0x5bf03635) >>> 0;
      this.jitter[c] = h % 100 < 22 ? (h & 2 ? -1 : 1) : 0;
    }

    this.wgrid = new Uint8Array(this.cells);
    this.colors = new Float32Array(this.cells * 3);

    this.scratch = new Float32Array(this.cellw * this.cellh);
    this.sceneRGB = new Float32Array(this.cells * 3);
    this.sceneY = new Float32Array(this.cells);
    this.p20 = new Float32Array(this.cells);
    this.p80 = new Float32Array(this.cells);
    this.contrast = new Float32Array(this.cells);
    this.meanY = new Float32Array(this.cells);
    this.meanRGB = new Float32Array(this.cells * 3);
    this.brightRGB = new Float32Array(this.cells * 3);

    this.frameCanvas = createCanvas(this.width, this.height);
    this.frameCtx = this.frameCanvas.getContext('2d');
    this.frameImage = this.frameCtx.createImageData(this.width, this.height);

    this.sampleCanvas = createCanvas(this.sampleW, this.sampleH);
    this.sampleCtx = this.sampleCanvas.getContext('2d');

    const scale = Math.max(this.sampleW / this.width, this.sampleH / this.height);
    this.drawW = Math.round(this.width * scale);
    this.drawH = Math.round(this.height * scale);
    this.drawX = Math.round((this.sampleW - this.drawW) * 0.5);
    this.drawY = Math.round((this.sampleH - this.drawH) * 0.5);

    this.rgb = new Uint8Array(this.width * this.height * 3);
    this.alpha = new Float32Array(this.width * this.height);
  }

  stats() {
    return {
      width: this.width,
      height: this.height,
      cell: [this.cellw, this.cellh],
      grid: [this.cols, this.rows],
      cells: this.cells,
      fontSize: Number(this.atlas.fontSize.toFixed(2)),
      sentences: this.sentences.length,
      coverage: this.atlas.stats(),
    };
  }

  /** rgba: Uint8ClampedArray of width*height*4 */
  renderFrame(rgba) {
    this.frameImage.data.set(rgba);
    this.frameCtx.putImageData(this.frameImage, 0, 0);
    const sctx = this.sampleCtx;
    sctx.clearRect(0, 0, this.sampleW, this.sampleH);
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(this.frameCanvas, this.drawX, this.drawY, this.drawW, this.drawH);
    const sd = sctx.getImageData(0, 0, this.sampleW, this.sampleH).data;

    this._sample(sd);
    this._choose();
    return this._composite();
  }

  _sample(sd) {
    const { cols, rows, cellw, cellh, sampleW } = this;
    const linLUT = this.linLUT;
    const n = cellw * cellh;

    for (let r = 0; r < rows; r++) {
      const y0 = r * cellh;
      for (let c = 0; c < cols; c++) {
        const cell = r * cols + c;
        const x0 = c * cellw;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let k = 0;
        for (let y = 0; y < cellh; y++) {
          let p = ((y0 + y) * sampleW + x0) * 4;
          for (let x = 0; x < cellw; x++, p += 4) {
            const r8 = sd[p];
            const g8 = sd[p + 1];
            const b8 = sd[p + 2];
            sr += linLUT[r8];
            sg += linLUT[g8];
            sb += linLUT[b8];
            this.scratch[k++] = LUMA_R * r8 + LUMA_G * g8 + LUMA_B * b8;
          }
        }
        const inv = 1 / n;
        this.meanRGB[cell * 3] = sr * inv;
        this.meanRGB[cell * 3 + 1] = sg * inv;
        this.meanRGB[cell * 3 + 2] = sb * inv;
        const meanY = (LUMA_R * sr + LUMA_G * sg + LUMA_B * sb) * inv;
        this.meanY[cell] = meanY;

        const p20 = kth(this.scratch, n, Math.floor(0.2 * (n - 1)));
        const p80 = kth(this.scratch, n, Math.floor(0.8 * (n - 1)));
        const p75 = kth(this.scratch, n, Math.floor(0.75 * (n - 1)));
        this.p20[cell] = linLUT[p20 | 0];
        this.p80[cell] = linLUT[p80 | 0];
        const contrast = this.p80[cell] - this.p20[cell];
        this.contrast[cell] = contrast;

        let br = 0;
        let bg = 0;
        let bb = 0;
        let count = 0;
        for (let y = 0; y < cellh; y++) {
          let p = ((y0 + y) * sampleW + x0) * 4;
          for (let x = 0; x < cellw; x++, p += 4) {
            const r8 = sd[p];
            const g8 = sd[p + 1];
            const b8 = sd[p + 2];
            if (LUMA_R * r8 + LUMA_G * g8 + LUMA_B * b8 >= p75) {
              br += linLUT[r8];
              bg += linLUT[g8];
              bb += linLUT[b8];
              count++;
            }
          }
        }
        if (count === 0) count = 1;
        this.brightRGB[cell * 3] = br / count;
        this.brightRGB[cell * 3 + 1] = bg / count;
        this.brightRGB[cell * 3 + 2] = bb / count;

        const detail = this.detailLuma * Math.min(1, contrast * 4);
        this.sceneY[cell] = meanY + (this.p80[cell] - meanY) * detail;
        const mix = this.detailColor * contrast;
        this.sceneRGB[cell * 3] = this.meanRGB[cell * 3] + (this.brightRGB[cell * 3] - this.meanRGB[cell * 3]) * mix;
        this.sceneRGB[cell * 3 + 1] =
          this.meanRGB[cell * 3 + 1] + (this.brightRGB[cell * 3 + 1] - this.meanRGB[cell * 3 + 1]) * mix;
        this.sceneRGB[cell * 3 + 2] =
          this.meanRGB[cell * 3 + 2] + (this.brightRGB[cell * 3 + 2] - this.meanRGB[cell * 3 + 2]) * mix;
      }
    }
  }

  _choose() {
    const { cells, weights, calibration, maxEmitted, cols } = this;
    const nw = weights.length;
    const step = nw > 1 ? 100 : 1;
    const cov = this.atlas.coverage;

    for (let c = 0; c < cells; c++) {
      const t = smoothstep(0.015, 0.65, this.sceneY[c]);
      let wi = Math.round((this.weightMin + (this.weightMax - this.weightMin) * t - weights[0]) / step);
      wi += this.jitter[c];
      if (wi < 0) wi = 0;
      if (wi > nw - 1) wi = nw - 1;

      const ch = this.chars[c];
      let denom = Math.max(cov[wi * this.atlas.chars.length + ch] * calibration, 0.02);
      let gr = this.sceneRGB[c * 3] / denom;
      let gg = this.sceneRGB[c * 3 + 1] / denom;
      let gb = this.sceneRGB[c * 3 + 2] / denom;

      for (let pass = 0; pass < 2; pass++) {
        const over = gr > maxEmitted || gg > maxEmitted || gb > maxEmitted;
        if (!over || wi >= nw - 1) break;
        wi += 1;
        denom = Math.max(cov[wi * this.atlas.chars.length + ch] * calibration, 0.02);
        gr = this.sceneRGB[c * 3] / denom;
        gg = this.sceneRGB[c * 3 + 1] / denom;
        gb = this.sceneRGB[c * 3 + 2] / denom;
      }

      this.wgrid[c] = wi;
      this.colors[c * 3] = Math.min(gr, maxEmitted);
      this.colors[c * 3 + 1] = Math.min(gg, maxEmitted);
      this.colors[c * 3 + 2] = Math.min(gb, maxEmitted);
    }
  }

  _composite() {
    const { width, height, colors, wgrid, cellId, base, flat, stride } = this;
    const px = width * height;
    const out = this.rgb;
    const outLUT = this.outLUT;
    const sat = this.satLift;
    const alpha = this.alpha;

    // ink coverage per pixel (optionally softened into the gaps)
    let a = alpha;
    for (let i = 0; i < px; i++) a[i] = flat[wgrid[cellId[i]] * stride + base[i]];

    if (this.diffusion > 0 || this.diffusionAdaptive > 0) {
      let soft = a;
      for (let p = 0; p < this.diffusionPasses; p++) soft = box3(soft, width, height, p === 0 ? null : soft);
      const blend = new Float32Array(this.cells);
      for (let c = 0; c < wgrid.length; c++) {
        const gmax = Math.max(colors[c * 3], colors[c * 3 + 1], colors[c * 3 + 2]);
        const adaptive = this.diffusionAdaptive * smoothstep(0.45, 1.4, gmax);
        blend[c] = Math.max(this.diffusion, adaptive);
      }
      for (let i = 0; i < px; i++) {
        const d = blend[cellId[i]];
        a[i] = a[i] * (1 - d) + soft[i] * d;
      }
    }

    for (let i = 0; i < px; i++) {
      const cell = cellId[i];
      const ink = a[i];
      const cr = colors[cell * 3];
      const cg = colors[cell * 3 + 1];
      const cb = colors[cell * 3 + 2];
      let r = ink * cr;
      let g = ink * cg;
      let b = ink * cb;
      const y = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      r = y + (r - y) * sat;
      g = y + (g - y) * sat;
      b = y + (b - y) * sat;
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      b = b < 0 ? 0 : b > 1 ? 1 : b;
      const o = i * 3;
      out[o] = outLUT[(r * 4095) | 0];
      out[o + 1] = outLUT[(g * 4095) | 0];
      out[o + 2] = outLUT[(b * 4095) | 0];
    }
    return out;
  }
}

function buildOutputLUT(n = 4096) {
  const lut = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const lin = i / (n - 1);
    const s = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    lut[i] = Math.round(Math.max(0, Math.min(1, s)) * 255);
  }
  return lut;
}

/** separable 1-2-1 blur over a float image, energy preserving */
function box3(src, width, height, dst) {
  const out = dst || new Float32Array(src.length);
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    tmp[row] = (src[row] * 3 + src[row + 1]) / 4;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      tmp[i] = (src[i - 1] + 2 * src[i] + src[i + 1]) / 4;
    }
    tmp[row + width - 1] = (src[row + width - 1] * 3 + src[row + width - 2]) / 4;
  }
  for (let x = 0; x < width; x++) {
    out[x] = (tmp[x] * 3 + tmp[width + x]) / 4;
    for (let y = 1; y < height - 1; y++) {
      const i = y * width + x;
      out[i] = (tmp[i - width] + 2 * tmp[i] + tmp[i + width]) / 4;
    }
    const last = (height - 1) * width + x;
    out[last] = (tmp[last] * 3 + tmp[last - width]) / 4;
  }
  return out;
}

module.exports = { Renderer, CHARS };
