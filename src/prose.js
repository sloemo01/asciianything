'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CHARS = " abcdefghijklmnopqrstuvwxyz.,';:?\u2019";
const CHAR_INDEX = new Map([...CHARS].map((ch, i) => [ch, i]));

function hash32(x) {
  x = (x + 0x9e3779b9) | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function normalizeProse(text) {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim() + ' ';
}

function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [];
}

function loadBank(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return JSON.parse(raw);
  return splitSentences(normalizeProse(raw));
}

function defaultBank() {
  return path.join(__dirname, '..', 'assets', 'prose.json');
}

function rowCorpus(sentences, row) {
  const order = sentences.map((_, i) => i);
  let seed = hash32(row * 0x9e3779b1 + 0x85ebca6b);
  for (let i = order.length - 1; i > 0; i--) {
    seed = hash32(seed);
    const j = seed % (i + 1);
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  let text = '';
  for (let i = 0; i < order.length; i++) {
    const s = sentences[order[i]];
    text += s.endsWith(' ') ? s : s + ' ';
  }
  return text;
}

/** Build the fixed character grid: one stable prose character per cell. */
function buildCharGrid(cols, rows, sentences) {
  const grid = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const corpus = rowCorpus(sentences, row);
    const n = corpus.length;
    const start = hash32(row * 0x27d4eb2d + 0x165667b1) % n;
    let source = corpus;
    while (source.length < start + cols) source += corpus;
    const line = source.slice(start, start + cols);
    for (let col = 0; col < cols; col++) {
      const idx = CHAR_INDEX.get(line[col]);
      grid[row * cols + col] = idx === undefined ? 0 : idx;
    }
  }
  return grid;
}

module.exports = {
  CHARS,
  CHAR_INDEX,
  hash32,
  normalizeProse,
  splitSentences,
  loadBank,
  defaultBank,
  buildCharGrid,
};
