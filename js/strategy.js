'use strict';

/**
 * strategy.js
 * ベーシックストラテジーと EV 評価
 *
 * 戦略表は手書きではなく、js/strategy-data.js（tools/generate-strategy-data.js で生成した
 * 有限デッキの EV 表）から「EV が最大のアクション」として導出する。
 * そのためデッキ数・S17/H17・DAS・再スプリット可否ごとに正しい表になる。
 *
 * アクションコード:
 *   H   = ヒット
 *   S   = スタンド
 *   D   = ダブルダウン（できなければヒット）
 *   Ds  = ダブルダウン（できなければスタンド）
 *   P   = スプリット
 *   R   = サレンダー（できなければヒット）
 *   Rs  = サレンダー（できなければスタンド）
 *   Rp  = サレンダー（できなければスプリット）
 *   I / E / N = インシュランスを取る / イーブンマネーを受ける / 断る
 */

// 不正解でも EV 差がこの値未満なら「惜しい（境界ケース）」扱い（ベット比）
const BORDERLINE_THRESHOLD = 0.01;
// EV 差がこの値以上なら「重大なミス」
const SERIOUS_THRESHOLD = 0.05;
const SURRENDER_EV = -0.5;

const DEALER_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
const DEALER_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
const AVAILABLE_DECKS = [1, 2, 4, 6, 8];

// ── ディーラーアップカード → インデックス変換 ──
// 0=2, 1=3, 2=4, 3=5, 4=6, 5=7, 6=8, 7=9, 8=10/J/Q/K, 9=A
function dealerToIdx(dealerValue) {
  if (dealerValue === 1 || dealerValue === 11) return 9; // Ace
  if (dealerValue >= 2 && dealerValue <= 9) return dealerValue - 2;
  return 8; // 10, J, Q, K
}

function dealerLabel(dealerValue) {
  return DEALER_LABELS[dealerToIdx(dealerValue)];
}

// ── データアクセス ──
function getData() {
  const data = (typeof window !== 'undefined' && window.STRATEGY_DATA) || null;
  if (!data) throw new Error('STRATEGY_DATA が読み込まれていません（js/strategy-data.js）');
  return data;
}

function normalizeRules(options = {}) {
  let numDecks = Number(options.numDecks) || 6;
  if (!AVAILABLE_DECKS.includes(numDecks)) {
    numDecks = AVAILABLE_DECKS.reduce((a, b) => (Math.abs(b - numDecks) < Math.abs(a - numDecks) ? b : a));
  }
  return {
    numDecks,
    h17: !!options.h17,
    das: options.das !== false,
    surrender: !!options.surrender,
    maxHands: Number(options.maxHands) === 2 ? 2 : 4,
    advanced: !!options.advanced,
  };
}

function ruleSet(rules) {
  const key = `${rules.numDecks}D-${rules.h17 ? 'H17' : 'S17'}`;
  const rs = getData().rules[key];
  if (!rs) throw new Error(`ルール ${key} のデータがありません`);
  return rs;
}

function scaled(v) {
  return v / getData().scale;
}

function evArr(arr) {
  if (!arr) return null;
  const [S, H, D] = arr;
  const o = { S: scaled(S), H: scaled(H) };
  if (D !== undefined) o.D = scaled(D);
  return o;
}

/**
 * 2枚の時点の表の行の EV（S/H/D と、ペアなら P）
 * @param {'hard'|'soft'|'pair'} type
 */
function rowEV(type, key, dIdx, rules) {
  const rs = ruleSet(rules);
  if (type === 'pair') {
    const ev = evArr(rs.pair[key][dIdx]);
    ev.P = scaled(rs.split[`das${rules.das ? 1 : 0}-rs${rules.maxHands}`][key][dIdx]);
    return ev;
  }
  const table = type === 'soft' ? rs.soft : rs.hard;
  const row = table[key];
  return row ? evArr(row[dIdx]) : null;
}

// ── EV からアクションコードを導出 ──
function argmax(ev, keys) {
  let best = null;
  for (const k of keys) {
    if (ev[k] === undefined) continue;
    if (best === null || ev[k] > ev[best] + 1e-12) best = k;
  }
  return best;
}

/**
 * EV（{S,H,D?,P?}）から表記コードを導出する。サレンダー（EV -0.5）は常に候補として扱い、
 * 実際に使えるかどうかは resolveAction で解決する。
 */
function deriveRaw(ev) {
  const best = argmax(ev, ['S', 'H', 'D', 'P']);
  if (SURRENDER_EV > ev[best] + 1e-12) {
    if (best === 'S') return 'Rs';
    if (best === 'P') return 'Rp';
    return 'R';
  }
  if (best === 'D') return argmax(ev, ['S', 'H']) === 'S' ? 'Ds' : 'D';
  return best;
}

/**
 * 条件付きアクションを実際に実行可能なアクションに変換する
 */
function resolveAction(raw, canDouble, canSurrender) {
  switch (raw) {
    case 'D':  return canDouble    ? 'D' : 'H';
    case 'Ds': return canDouble    ? 'D' : 'S';
    case 'R':  return canSurrender ? 'R' : 'H';
    case 'Rs': return canSurrender ? 'R' : 'S';
    case 'Rp': return canSurrender ? 'R' : 'P';
    default:   return raw;
  }
}

/** ハンドが表のどの行に当たるか */
function rowFor(handInfo, splitAllowed) {
  const { total, isSoft, isPair, pairValue, cardCount } = handInfo;
  if (isPair && cardCount === 2 && splitAllowed) {
    return { type: 'pair', key: pairValue >= 10 ? 10 : pairValue };
  }
  if (isSoft) return { type: 'soft', key: Math.min(Math.max(total, 12), 21) };
  return { type: 'hard', key: Math.min(Math.max(total, 4), 21) };
}

/** 上級モードの構成依存 EV（該当しなければ null） */
function advancedEV(handInfo, row, dIdx, rules, cards) {
  if (!rules.advanced) return null;
  const rs = ruleSet(rules);
  if (handInfo.cardCount >= 3) {
    const table = row.type === 'soft' ? rs.multi.soft : rs.multi.hard;
    const r = table[row.key];
    if (!r || !r[dIdx]) return null;
    return { ev: evArr(r[dIdx]), source: 'multi' };
  }
  if (row.type === 'hard' && cards && cards.length === 2) {
    const vals = cards.map(c => c.value).sort((a, b) => a - b);
    const comp = rs.comp[`${vals[0]}-${vals[1]}`];
    if (comp && comp[dIdx]) return { ev: evArr(comp[dIdx]), source: 'comp' };
  }
  return null;
}

/**
 * 推奨アクションを取得する
 * @param {object} handInfo - { total, isSoft, isPair, pairValue, cardCount }
 * @param {number} dealerValue - ディーラーのアップカード数値 (1 or 11=A, 2-10)
 * @param {object} options - { numDecks, h17, das, surrender, maxHands, advanced,
 *                             isSplit, canDouble, canSplit, cards }
 *   canDouble / canSplit: 実際にダブル・スプリットできるか（省略時は可能とみなす）
 *   cards: 上級モードで 2 枚の構成を判定するためのカード配列
 * @returns {{ raw, resolved, ev, row, source }}
 *   raw: 表上のアクション（Ds, Rp等含む）
 *   resolved: 実際にプレイ可能なアクション（H/S/D/P/R）
 *   ev: 実行可能な各アクションの EV（ベット 1 単位あたり）
 *   source: 'table'（合計ベースの表）| 'multi'（3枚以上の例外）| 'comp'（2枚構成の例外）
 */
function getStrategyAction(handInfo, dealerValue, options = {}) {
  const rules = normalizeRules(options);
  const isSplit = !!options.isSplit;
  const dIdx = dealerToIdx(dealerValue);
  const splitAllowed = options.canSplit !== false;
  const row = rowFor(handInfo, splitAllowed);

  let ev = row.key <= 20 ? rowEV(row.type, row.key, dIdx, rules) : null;
  let source = 'table';
  const adv = ev ? advancedEV(handInfo, row, dIdx, rules, options.cards) : null;
  if (adv) { ev = adv.ev; source = adv.source; }

  // 21（またはデータ範囲外）は常にスタンド
  if (!ev) {
    return { raw: 'S', resolved: 'S', ev: { S: 1 }, row: { ...row, dIdx }, source };
  }

  const raw = deriveRaw(ev);
  const canDouble = handInfo.cardCount === 2 && (rules.das || !isSplit) && options.canDouble !== false && ev.D !== undefined;
  const canSurrender = rules.surrender && handInfo.cardCount === 2 && !isSplit;
  const resolved = resolveAction(raw, canDouble, canSurrender);

  // 実行可能なアクションの EV
  const avail = { S: ev.S, H: ev.H };
  if (canDouble) avail.D = ev.D;
  if (row.type === 'pair' && ev.P !== undefined) avail.P = ev.P;
  if (canSurrender) avail.R = SURRENDER_EV;

  return { raw, resolved, ev: avail, row: { ...row, dIdx }, source };
}

/**
 * プレイヤーの選択を EV で評価する
 * @returns {{ recommended, isCorrect, isBorderline, evLoss, severity, ev, runnerUp }}
 *   evLoss: 推奨アクションとの EV 差（ベット比, 0 以上）
 *   severity: 'correct' | 'close'（惜しい） | 'moderate' | 'serious'
 *   runnerUp: 次点アクションと推奨との EV 差（僅差の局面の説明用）
 */
function evaluateDecision(handInfo, dealerValue, options, action) {
  const rec = getStrategyAction(handInfo, dealerValue, options);
  const best = rec.ev[rec.resolved];
  const chosen = rec.ev[action];
  const evLoss = (best === undefined || chosen === undefined) ? 0 : Math.max(0, best - chosen);
  const isCorrect = action === rec.resolved;
  const isBorderline = !isCorrect && evLoss < BORDERLINE_THRESHOLD;
  const severity = isCorrect ? 'correct'
    : evLoss < BORDERLINE_THRESHOLD ? 'close'
    : evLoss < SERIOUS_THRESHOLD ? 'moderate' : 'serious';

  let runnerUp = null;
  for (const [k, v] of Object.entries(rec.ev)) {
    if (k === rec.resolved) continue;
    const gap = best - v;
    if (!runnerUp || gap < runnerUp.gap) runnerUp = { action: k, gap };
  }

  return { recommended: { raw: rec.raw, resolved: rec.resolved }, row: rec.row, source: rec.source,
           ev: rec.ev, evLoss, isCorrect, isBorderline, severity, runnerUp };
}

// ── インシュランス / イーブンマネー ──

/**
 * インシュランスの EV（ベット 1 単位あたり）。カウンティングをしない前提なので
 * 山の構成は「フルシュー − 見えている 3 枚」で計算する。
 * @param {number} numDecks
 * @param {Array} playerCards
 * @param {boolean} evenMoney - プレイヤーがブラックジャック（イーブンマネーの選択）
 */
function insuranceEV(numDecks, playerCards, evenMoney) {
  const tensSeen = playerCards.filter(c => c.value === 10).length;
  const p = (16 * numDecks - tensSeen) / (52 * numDecks - 3); // ホールカードが 10 の確率
  if (evenMoney) return { E: 1, N: 1.5 * (1 - p), p };
  return { I: 0.5 * (3 * p - 1), N: 0, p };
}

function evaluateInsurance(numDecks, playerCards, evenMoney, action) {
  const ev = insuranceEV(numDecks, playerCards, evenMoney);
  const takeCode = evenMoney ? 'E' : 'I';
  const resolved = ev[takeCode] > ev.N ? takeCode : 'N';
  const evLoss = Math.max(0, ev[resolved] - ev[action]);
  const isCorrect = action === resolved;
  return {
    recommended: { raw: resolved, resolved },
    ev: { [takeCode]: ev[takeCode], N: ev.N },
    p: ev.p,
    evLoss,
    isCorrect,
    isBorderline: !isCorrect && evLoss < BORDERLINE_THRESHOLD,
    severity: isCorrect ? 'correct' : evLoss < BORDERLINE_THRESHOLD ? 'close'
      : evLoss < SERIOUS_THRESHOLD ? 'moderate' : 'serious',
    runnerUp: null,
    row: { type: 'insurance', key: evenMoney ? 'even' : 'ins', dIdx: 9 },
    source: 'table',
  };
}

// ── 表示用の表 ──
const TABLE_ROWS = {
  hard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(k => ({ key: k, label: String(k) })),
  soft: [13, 14, 15, 16, 17, 18, 19, 20].map(k => ({ key: k, label: `A,${k - 11}` })),
  pair: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => ({ key: k, label: k === 1 ? 'A,A' : k === 10 ? 'T,T' : `${k},${k}` })),
};

/**
 * 現在のルールでの戦略表（raw コード）
 * @returns {Array<{ key, label, values: string[] }>}
 */
function getTableRows(type, options) {
  const rules = normalizeRules({ ...options, advanced: false });
  return TABLE_ROWS[type].map(({ key, label }) => ({
    key, label,
    values: DEALER_VALUES.map((dv, dIdx) => {
      const ev = rowEV(type, key, dIdx, rules);
      // ハード 17 は 18 以上も含む（常にスタンドかサレンダー）
      return deriveRaw(ev);
    }),
  }));
}

/** 上級モードの例外一覧（説明用） */
function getAdvancedExceptions(options) {
  const rules = normalizeRules(options);
  const rs = ruleSet(rules);
  const list = [];
  for (const type of ['hard', 'soft']) {
    for (const [key, cols] of Object.entries(rs.multi[type])) {
      cols.forEach((arr, dIdx) => {
        if (!arr) return;
        const multi = evArr(arr);
        const two = rowEV(type, Number(key), dIdx, rules);
        if (!two) return;
        const twoAction = resolveAction(deriveRaw(two), false, false);
        const multiAction = argmax(multi, ['S', 'H']);
        if (twoAction !== multiAction) {
          list.push({ kind: 'multi', type, key: Number(key), dIdx, action: multiAction, gain: multi[multiAction] - multi[twoAction] });
        }
      });
    }
  }
  for (const [comp, cols] of Object.entries(rs.comp)) {
    const [a, b] = comp.split('-').map(Number);
    cols.forEach((arr, dIdx) => {
      if (!arr) return;
      const ev = evArr(arr);
      const tableRaw = deriveRaw(rowEV('hard', a + b, dIdx, rules));
      const compRaw = deriveRaw(ev);
      if (tableRaw !== compRaw) list.push({ kind: 'comp', cards: [a, b], total: a + b, dIdx, raw: compRaw, tableRaw });
    });
  }
  return list;
}

// ── アクション名の日本語表記 ──
const ACTION_LABELS = {
  H:  'ヒット',
  S:  'スタンド',
  D:  'ダブルダウン',
  Ds: 'ダブルダウン（なければスタンド）',
  P:  'スプリット',
  R:  'サレンダー',
  Rs: 'サレンダー（なければスタンド）',
  Rp: 'サレンダー（なければスプリット）',
  I:  'インシュランスを取る',
  E:  'イーブンマネーを受ける',
  N:  '断る',
};

function actionLabel(code) {
  return ACTION_LABELS[code] || code;
}

// ── グローバル公開 ──
window.Strategy = {
  BORDERLINE_THRESHOLD,
  SERIOUS_THRESHOLD,
  DEALER_VALUES,
  DEALER_LABELS,
  getStrategyAction,
  evaluateDecision,
  evaluateInsurance,
  insuranceEV,
  resolveAction,
  deriveRaw,
  actionLabel,
  dealerToIdx,
  dealerLabel,
  normalizeRules,
  getTableRows,
  getAdvancedExceptions,
};
