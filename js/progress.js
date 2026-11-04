'use strict';

/**
 * progress.js
 * セッションをまたいだ弱点記録（localStorage）とドリルモードの出題
 *
 * 記録はルールごと・表のマスごとに { n: 判断回数, correct: 正解数, evLoss: EV損失の合計（ベット比） }。
 * localStorage が使えない環境（プライベートモード等）ではメモリ上だけで動作する。
 */

const PROGRESS_STORAGE_KEY = 'bj-practice:progress:v1';
let memoryStore = null;

function loadAll() {
  if (memoryStore) return memoryStore;
  let data = null;
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { /* 使えなければメモリのみ */ }
  memoryStore = data && typeof data === 'object' && data.rules ? data : { rules: {} };
  return memoryStore;
}

function saveAll() {
  try {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(memoryStore));
  } catch (e) { /* 保存できなくても続行 */ }
}

/** 記録を分けるルールのキー（推奨が変わる設定のみ） */
function ruleKey(settings) {
  const r = Strategy.normalizeRules(settings);
  return `${r.numDecks}D-${r.h17 ? 'H17' : 'S17'}-${r.das ? 'DAS' : 'NoDAS'}-${r.surrender ? 'LS' : 'NoLS'}-${r.maxHands}H`;
}

/** レコードの局面を表のマスのキーに変換する（表にないマスは null） */
function cellKeyOf(record) {
  const row = record.row;
  if (!row) return null;
  if (row.type === 'insurance') return `insurance:${row.key}`;
  if (row.type === 'hard' && (row.key < 4 || row.key > 17)) return null;
  if (row.type === 'soft' && (row.key < 13 || row.key > 20)) return null;
  return `${row.type}:${row.key}:${row.dIdx}`;
}

function recordDecision(settings, record) {
  const key = cellKeyOf(record);
  if (!key) return;
  const all = loadAll();
  const rk = ruleKey(settings);
  const cells = all.rules[rk] = all.rules[rk] || {};
  const cell = cells[key] = cells[key] || { n: 0, correct: 0, evLoss: 0 };
  cell.n++;
  if (record.isCorrect) cell.correct++;
  cell.evLoss += record.evLoss || 0;
  saveAll();
}

function getCells(settings) {
  return loadAll().rules[ruleKey(settings)] || {};
}

function reset(settings) {
  const all = loadAll();
  if (settings) delete all.rules[ruleKey(settings)];
  else all.rules = {};
  saveAll();
}

/** 苦手な順（EV損失の合計 → ミス回数） */
function weakest(settings, limit = 5) {
  return Object.entries(getCells(settings))
    .map(([key, c]) => ({ key, ...c, misses: c.n - c.correct }))
    .filter(c => c.misses > 0)
    .sort((a, b) => b.evLoss - a.evLoss || b.misses - a.misses)
    .slice(0, limit);
}

// ── ドリルモード ──
const DRILL_ROWS = {
  hard: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  soft: [13, 14, 15, 16, 17, 18, 19, 20],
  pair: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
};

const DRILL_MODES = {
  normal: '通常（ランダム配牌）',
  hard:   'ハードハンドのみ',
  soft:   'ソフトハンドのみ',
  pair:   'ペアのみ',
  all:    '全マス均等',
  weak:   '苦手なマス優先',
};

function drillCells(mode) {
  const types = mode === 'hard' || mode === 'soft' || mode === 'pair' ? [mode] : ['hard', 'soft', 'pair'];
  const cells = [];
  for (const type of types) {
    for (const key of DRILL_ROWS[type]) {
      for (let dIdx = 0; dIdx < 10; dIdx++) cells.push({ type, key, dIdx });
    }
  }
  return cells;
}

/** マスの出題重み: 未経験・正解率が低い・EV損失が大きいほど出やすい */
function cellWeight(stat) {
  if (!stat || stat.n === 0) return 1.5;
  const missRate = 1 - stat.correct / stat.n;
  const avgLoss = stat.evLoss / stat.n;
  const fewSamples = stat.n < 3 ? 0.5 : 0;
  return 0.3 + 4 * missRate + 40 * avgLoss + fewSamples;
}

/**
 * ドリルの出題局面を選ぶ
 * @returns {{ type, key, dIdx } | null} normal モードなら null（通常の配牌）
 */
function pickDrillTarget(mode, settings, rand = Math.random) {
  if (!mode || mode === 'normal' || !DRILL_MODES[mode]) return null;
  const cells = drillCells(mode);
  if (mode !== 'weak') return cells[Math.floor(rand() * cells.length)];
  const stats = getCells(settings);
  const weights = cells.map(c => cellWeight(stats[`${c.type}:${c.key}:${c.dIdx}`]));
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = rand() * sum;
  for (let i = 0; i < cells.length; i++) {
    x -= weights[i];
    if (x <= 0) return cells[i];
  }
  return cells[cells.length - 1];
}

// テスト用: メモリ上の記録を初期化する
function _resetMemory() {
  memoryStore = null;
}

// ── グローバル公開 ──
window.Progress = {
  DRILL_MODES,
  ruleKey,
  cellKeyOf,
  recordDecision,
  getCells,
  reset,
  weakest,
  pickDrillTarget,
  cellWeight,
  _resetMemory,
};
