'use strict';

/**
 * strategy.js
 * ベーシックストラテジー表と推奨アクション取得ロジック
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
 */

// ── ディーラーアップカード → インデックス変換 ──
// 0=2, 1=3, 2=4, 3=5, 4=6, 5=7, 6=8, 7=9, 8=10/J/Q/K, 9=A
function dealerToIdx(dealerValue) {
  if (dealerValue === 1 || dealerValue === 11) return 9; // Ace
  if (dealerValue >= 2 && dealerValue <= 9) return dealerValue - 2;
  return 8; // 10, J, Q, K
}

// ── ハードハンド戦略表 ──
// [合計][ディーラーインデックス 0-9]
const HARD_S17 = {
//        2    3    4    5    6    7    8    9    T    A
  4:  ['H','H','H','H','H','H','H','H','H','H'],
  5:  ['H','H','H','H','H','H','H','H','H','H'],
  6:  ['H','H','H','H','H','H','H','H','H','H'],
  7:  ['H','H','H','H','H','H','H','H','H','H'],
  8:  ['H','H','H','H','H','H','H','H','H','H'],
  9:  ['H','D','D','D','D','H','H','H','H','H'],
  10: ['D','D','D','D','D','D','D','D','H','H'],
  11: ['D','D','D','D','D','D','D','D','D','H'],  // vs A: H (S17 6デッキ)
  12: ['H','H','S','S','S','H','H','H','H','H'],
  13: ['S','S','S','S','S','H','H','H','H','H'],
  14: ['S','S','S','S','S','H','H','H','H','H'],
  15: ['S','S','S','S','S','H','H','H','R','H'],  // R vs T
  16: ['S','S','S','S','S','H','H','R','R','R'],  // R vs 9,T,A
  17: ['S','S','S','S','S','S','S','S','S','S'],
};

const HARD_H17 = {
//        2    3    4    5    6    7    8    9    T    A
  4:  ['H','H','H','H','H','H','H','H','H','H'],
  5:  ['H','H','H','H','H','H','H','H','H','H'],
  6:  ['H','H','H','H','H','H','H','H','H','H'],
  7:  ['H','H','H','H','H','H','H','H','H','H'],
  8:  ['H','H','H','H','H','H','H','H','H','H'],
  9:  ['H','D','D','D','D','H','H','H','H','H'],
  10: ['D','D','D','D','D','D','D','D','H','H'],
  11: ['D','D','D','D','D','D','D','D','D','D'],  // vs A: D (H17)
  12: ['H','H','S','S','S','H','H','H','H','H'],
  13: ['S','S','S','S','S','H','H','H','H','H'],
  14: ['S','S','S','S','S','H','H','H','H','H'],
  15: ['S','S','S','S','S','H','H','H','R','R'],  // R vs T and A (H17)
  16: ['S','S','S','S','S','H','H','R','R','R'],
  17: ['S','S','S','S','S','S','S','S','S','Rs'], // Rs vs A (H17)
};

// ── ソフトハンド戦略表 ──
// キー = ソフト合計（Aを11として計算: A,2=13 〜 A,9=20）
const SOFT_S17 = {
//        2     3     4     5     6     7     8     9     T     A
  13: ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,2
  14: ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,3
  15: ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,4
  16: ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,5
  17: ['H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,6
  18: ['Ds','Ds','Ds','Ds','Ds', 'S', 'S', 'H', 'H', 'H'], // A,7
  19: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],  // A,8
  20: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],  // A,9
};

// H17のソフトハンド（A,7 vs 2のDs追加など、本質的に同じ）
const SOFT_H17 = SOFT_S17;

// ── ペアスプリット戦略表（DASあり）──
// キー = カードの数値（1=A, 2-9, 10=T/J/Q/K）
const PAIR_DAS = {
//        2    3    4    5    6    7    8    9    T    A
  1:  ['P','P','P','P','P','P','P','P','P','P'],  // A,A 常にスプリット
  2:  ['P','P','P','P','P','P','H','H','H','H'],  // 2,2
  3:  ['P','P','P','P','P','P','H','H','H','H'],  // 3,3
  4:  ['H','H','H','P','P','H','H','H','H','H'],  // 4,4
  5:  ['D','D','D','D','D','D','D','D','H','H'],  // 5,5 → ハード10として扱う
  6:  ['P','P','P','P','P','H','H','H','H','H'],  // 6,6
  7:  ['P','P','P','P','P','P','H','H','H','H'],  // 7,7
  8:  ['P','P','P','P','P','P','P','P','P','P'],  // 8,8 常にスプリット
  9:  ['P','P','P','P','P','S','P','P','S','S'],  // 9,9
  10: ['S','S','S','S','S','S','S','S','S','S'],  // T,T スプリットしない
};

// ── ペアスプリット戦略表（DASなし）──
const PAIR_NODAS = {
//        2    3    4    5    6    7    8    9    T    A
  1:  ['P','P','P','P','P','P','P','P','P','P'],
  2:  ['H','H','P','P','P','P','H','H','H','H'],  // P vs 4-7のみ
  3:  ['H','H','P','P','P','P','H','H','H','H'],  // P vs 4-7のみ
  4:  ['H','H','H','H','H','H','H','H','H','H'],  // スプリットしない
  5:  ['D','D','D','D','D','D','D','D','H','H'],
  6:  ['H','P','P','P','P','H','H','H','H','H'],  // P vs 3-6のみ
  7:  ['P','P','P','P','P','P','H','H','H','H'],  // 同じ
  8:  ['P','P','P','P','P','P','P','P','P','P'],
  9:  ['P','P','P','P','P','S','P','P','S','S'],
  10: ['S','S','S','S','S','S','S','S','S','S'],
};

// ── H17でのサレンダー追加ケース（8,8 vs A）──
// S17: 8,8 vs A = P（スプリット）
// H17: 8,8 vs A = Rp（サレンダーでなければスプリット）
function getPairActionH17Surrender(pairValue, dealerIdx) {
  if (pairValue === 8 && dealerIdx === 9) return 'Rp';
  return null;
}

/**
 * 推奨アクションを取得する
 * @param {object} handInfo - { total, isSoft, isPair, pairValue, cardCount }
 * @param {number} dealerValue - ディーラーのアップカード数値 (1 or 11=A, 2-10)
 * @param {object} options - { h17, das, surrender }
 * @returns {{ raw: string, resolved: string }}
 *   raw: 表上のアクション（Ds, Rp等含む）
 *   resolved: 実際にプレイ可能なアクション（H/S/D/P/R）
 */
function getStrategyAction(handInfo, dealerValue, options) {
  const { total, isSoft, isPair, pairValue, cardCount } = handInfo;
  const { h17 = false, das = true, surrender = false } = options;
  const dIdx = dealerToIdx(dealerValue);

  let raw;

  // ── ペア判定（最初の2枚のみ）──
  if (isPair && cardCount === 2) {
    const pairTable = das ? PAIR_DAS : PAIR_NODAS;
    const key = pairValue === 10 ? 10 : (pairValue === 1 ? 1 : pairValue);

    // H17サレンダー特例（8,8 vs A）
    if (h17 && surrender) {
      const special = getPairActionH17Surrender(key, dIdx);
      if (special) { raw = special; }
    }
    if (!raw) {
      raw = pairTable[key] ? pairTable[key][dIdx] : 'H';
    }
  }
  // ── ソフトハンド ──
  else if (isSoft && total >= 13 && total <= 20) {
    const table = h17 ? SOFT_H17 : SOFT_S17;
    raw = table[total] ? table[total][dIdx] : 'S';
  }
  // ── ハードハンド ──
  else {
    const table = h17 ? HARD_H17 : HARD_S17;
    const lookupTotal = Math.min(Math.max(total, 4), 17);
    raw = table[lookupTotal] ? table[lookupTotal][dIdx] : (total >= 17 ? 'S' : 'H');
    if (total > 17) raw = 'S';
  }

  const canDouble = cardCount === 2;
  const canSurrender = surrender && cardCount === 2;
  const resolved = resolveAction(raw, canDouble, canSurrender);

  return { raw, resolved };
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
};

function actionLabel(code) {
  return ACTION_LABELS[code] || code;
}

// ── グローバル公開 ──
window.Strategy = {
  getStrategyAction,
  resolveAction,
  actionLabel,
  dealerToIdx,
  HARD_S17,
  HARD_H17,
  SOFT_S17,
  SOFT_H17,
  PAIR_DAS,
  PAIR_NODAS,
};
