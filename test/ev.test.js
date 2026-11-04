'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers.js');

const { Strategy } = global;

function hard(total, cardCount = 2) {
  return { total, isSoft: false, isPair: false, pairValue: null, cardCount };
}
function soft(total, cardCount = 2) {
  return { total, isSoft: true, isPair: false, pairValue: null, cardCount };
}
function pair(pairValue) {
  const total = pairValue === 1 ? 12 : pairValue * 2;
  return { total, isSoft: pairValue === 1, isPair: true, pairValue, cardCount: 2 };
}
function card(value) {
  const rank = value === 1 ? 'A' : String(value);
  return { value, rank, suit: '♠', display: rank + '♠', isRed: false };
}

const SIX = { numDecks: 6, h17: false, das: true, surrender: false };
const ONE = { numDecks: 1, h17: false, das: true, surrender: false };

// ── バグ2: デッキ数が推奨に反映される ──
describe('deck-specific strategy', () => {
  const raw = (h, d, o) => Strategy.getStrategyAction(h, d, o).raw;

  test('1デッキ: ハード11 vs A はダブル（6デッキS17はヒット）', () => {
    assert.equal(raw(hard(11), 1, ONE), 'D');
    assert.equal(raw(hard(11), 1, SIX), 'H');
  });
  test('1デッキ: ハード8 vs 5,6 はダブル', () => {
    assert.equal(raw(hard(8), 5, ONE), 'D');
    assert.equal(raw(hard(8), 6, ONE), 'D');
    assert.equal(raw(hard(8), 6, SIX), 'H');
  });
  test('1デッキ: ハード9 vs 2 はダブル', () => {
    assert.equal(raw(hard(9), 2, ONE), 'D');
    assert.equal(raw(hard(9), 2, SIX), 'H');
  });
  test('1デッキ: ソフト18 vs A はスタンド', () => {
    assert.equal(raw(soft(18), 1, ONE), 'S');
    assert.equal(raw(soft(18), 1, SIX), 'H');
  });
  test('1デッキ: 7,7 vs T はサレンダー（なければスタンド）', () => {
    assert.equal(raw(pair(7), 10, ONE), 'Rs');
  });
  test('2デッキ: ハード11 vs A はダブル', () => {
    assert.equal(raw(hard(11), 1, { ...SIX, numDecks: 2 }), 'D');
  });
  test('未対応のデッキ数は最も近いデータを使う', () => {
    assert.equal(Strategy.normalizeRules({ numDecks: 5 }).numDecks, 4);
    assert.equal(Strategy.normalizeRules({}).numDecks, 6);
  });
});

// ── バグ1・3: EV による境界ケース判定 ──
describe('evaluateDecision', () => {
  const ev = (h, d, o, a) => Strategy.evaluateDecision(h, d, o, a);

  test('正解なら EV 損失 0', () => {
    const r = ev(hard(16), 10, SIX, 'H');
    assert.equal(r.isCorrect, true);
    assert.equal(r.evLoss, 0);
    assert.equal(r.severity, 'correct');
  });

  test('ハード12 vs 2 のスタンドは境界ケースではない（EV差 約4%）', () => {
    const r = ev(hard(12), 2, SIX, 'S');
    assert.equal(r.isBorderline, false);
    assert.ok(r.evLoss > 0.03, `evLoss=${r.evLoss}`);
  });

  test('ハード16 vs 8 のスタンドは境界ケースではない', () => {
    const r = ev(hard(16), 8, SIX, 'S');
    assert.equal(r.isBorderline, false);
    assert.equal(r.severity, 'serious');
  });

  test('ハード12 vs 4 のヒットは境界ケース（EV差1%未満）', () => {
    const r = ev(hard(12), 4, SIX, 'H');
    assert.equal(r.isBorderline, true);
    assert.equal(r.severity, 'close');
  });

  test('ハード16 vs T のスタンドは境界ケース', () => {
    assert.equal(ev(hard(16), 10, SIX, 'S').isBorderline, true);
  });

  test('境界ケースでも僅差の2択以外を選べば「惜しい」にならない', () => {
    // ハード12 vs 4: ヒット/スタンドは僅差だが、ダブルは大きな損
    const r = ev(hard(12), 4, SIX, 'D');
    assert.equal(r.isBorderline, false);
    assert.equal(r.severity, 'serious');
  });

  test('T,T のスプリットは重大なミス', () => {
    const r = ev(pair(10), 6, SIX, 'P');
    assert.equal(r.severity, 'serious');
  });

  test('次点との差（runnerUp）を返す', () => {
    const r = ev(hard(16), 10, SIX, 'H');
    assert.equal(r.runnerUp.action, 'S');
    assert.ok(r.runnerUp.gap < Strategy.BORDERLINE_THRESHOLD);
  });

  test('実行できないアクションは EV に含めない', () => {
    const r = ev(hard(11), 6, { ...SIX, canDouble: false }, 'H');
    assert.equal(r.ev.D, undefined);
    assert.equal(r.isCorrect, true);
  });
});

// ── 改善4: インシュランス ──
describe('insurance', () => {
  test('インシュランスは常に断るのが正解', () => {
    for (const decks of [1, 2, 6, 8]) {
      const r = Strategy.evaluateInsurance(decks, [card(5), card(6)], false, 'I');
      assert.equal(r.recommended.resolved, 'N');
      assert.ok(r.evLoss > 0);
    }
  });
  test('イーブンマネーも断るのが正解', () => {
    for (const decks of [1, 6]) {
      const r = Strategy.evaluateInsurance(decks, [card(1), card(10)], true, 'E');
      assert.equal(r.recommended.resolved, 'N');
      assert.equal(r.isCorrect, false);
    }
  });
  test('断れば正解', () => {
    const r = Strategy.evaluateInsurance(6, [card(5), card(6)], false, 'N');
    assert.equal(r.isCorrect, true);
    assert.equal(r.evLoss, 0);
  });
});

// ── 改善6: 上級モード（構成依存） ──
describe('advanced (composition-dependent)', () => {
  const three16 = [card(4), card(5), card(7)];

  test('6デッキ: 3枚の16 vs T は上級モードでスタンド', () => {
    const r = Strategy.getStrategyAction(hard(16, 3), 10, { ...SIX, advanced: true, cards: three16 });
    assert.equal(r.resolved, 'S');
    assert.equal(r.source, 'multi');
  });
  test('上級モードでなければ合計ベースの表（ヒット）', () => {
    const r = Strategy.getStrategyAction(hard(16, 3), 10, { ...SIX, cards: three16 });
    assert.equal(r.resolved, 'H');
    assert.equal(r.source, 'table');
  });
  test('2枚の16 vs T は上級モードでもヒット', () => {
    const r = Strategy.getStrategyAction(hard(16), 10, { ...SIX, advanced: true, cards: [card(10), card(6)] });
    assert.equal(r.resolved, 'H');
  });
  test('1デッキ: 10+2 vs 4 は上級モードでヒット（表はスタンド）', () => {
    const opts = { ...ONE, advanced: true, cards: [card(10), card(2)] };
    assert.equal(Strategy.getStrategyAction(hard(12), 4, opts).resolved, 'H');
    assert.equal(Strategy.getStrategyAction(hard(12), 4, { ...opts, advanced: false }).resolved, 'S');
  });
  test('例外一覧を取得できる', () => {
    const list = Strategy.getAdvancedExceptions(SIX);
    assert.ok(list.some(e => e.kind === 'multi' && e.type === 'hard' && e.key === 16 && e.dIdx === 8));
  });
});

describe('getTableRows', () => {
  test('ハード14行・ソフト8行・ペア10行 × 10列', () => {
    assert.equal(Strategy.getTableRows('hard', SIX).length, 14);
    assert.equal(Strategy.getTableRows('soft', SIX).length, 8);
    assert.equal(Strategy.getTableRows('pair', SIX).length, 10);
    for (const r of Strategy.getTableRows('pair', SIX)) assert.equal(r.values.length, 10);
  });
});
