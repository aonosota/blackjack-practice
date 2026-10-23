'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers.js');

const { Strategy } = global;

// ── ヘルパー ──
// handInfo を作る
function hard(total, cardCount = 2) {
  return { total, isSoft: false, isPair: false, pairValue: null, cardCount };
}
function soft(total, cardCount = 2) {
  return { total, isSoft: true, isPair: false, pairValue: null, cardCount };
}
function pair(pairValue, cardCount = 2) {
  const total = pairValue === 1 ? 12 : pairValue * 2;
  return { total, isSoft: pairValue === 1, isPair: true, pairValue, cardCount };
}

// resolved アクションを取得するショートハンド
function rec(handInfo, dealerValue, opts = {}) {
  return Strategy.getStrategyAction(handInfo, dealerValue, opts).resolved;
}
function raw(handInfo, dealerValue, opts = {}) {
  return Strategy.getStrategyAction(handInfo, dealerValue, opts).raw;
}

// デフォルト設定: 6デッキ, S17, DASあり, サレンダーなし
const S17_DAS    = { h17: false, das: true,  surrender: false };
const S17_DAS_R  = { h17: false, das: true,  surrender: true  };
const H17_DAS    = { h17: true,  das: true,  surrender: false  };
const H17_DAS_R  = { h17: true,  das: true,  surrender: true  };
const S17_NODAS  = { h17: false, das: false, surrender: false };

// ── dealerToIdx ──
describe('dealerToIdx', () => {
  test('2-9 are indices 0-7', () => {
    for (let v = 2; v <= 9; v++) {
      assert.equal(Strategy.dealerToIdx(v), v - 2);
    }
  });
  test('10 → 8', () => assert.equal(Strategy.dealerToIdx(10), 8));
  test('A (value=1) → 9', () => assert.equal(Strategy.dealerToIdx(1), 9));
});

// ── ハードハンド S17 ──
// 参照: Wizard of Odds 6-deck S17 basic strategy
describe('hard S17', () => {
  const dealer = [2,3,4,5,6,7,8,9,10,1]; // 1=A

  // H4-H8: always H
  for (let t = 4; t <= 8; t++) {
    test(`H${t}: always H`, () => {
      for (const d of dealer) assert.equal(rec(hard(t), d, S17_DAS), 'H', `H${t} vs ${d}`);
    });
  }

  test('H9: D vs 3-6, H otherwise', () => {
    const expected = { 2:'H', 3:'D', 4:'D', 5:'D', 6:'D', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(hard(9), Number(d), S17_DAS), e, `H9 vs ${d}`);
  });

  test('H10: D vs 2-9, H vs T/A', () => {
    const expected = { 2:'D', 3:'D', 4:'D', 5:'D', 6:'D', 7:'D', 8:'D', 9:'D', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(hard(10), Number(d), S17_DAS), e, `H10 vs ${d}`);
  });

  test('H11 S17: D vs 2-T, H vs A', () => {
    const expected = { 2:'D', 3:'D', 4:'D', 5:'D', 6:'D', 7:'D', 8:'D', 9:'D', 10:'D', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(hard(11), Number(d), S17_DAS), e, `H11 vs ${d}`);
  });

  test('H12: S vs 4-6, H otherwise', () => {
    const expected = { 2:'H', 3:'H', 4:'S', 5:'S', 6:'S', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(hard(12), Number(d), S17_DAS), e, `H12 vs ${d}`);
  });

  test('H13-H16: S vs 2-6, H vs 7+', () => {
    for (const t of [13, 14]) {
      const expected = { 2:'S', 3:'S', 4:'S', 5:'S', 6:'S', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
      for (const [d, e] of Object.entries(expected))
        assert.equal(rec(hard(t), Number(d), S17_DAS), e, `H${t} vs ${d}`);
    }
  });

  test('H15: S vs 2-6, R vs T, H vs 7-9/A (S17 no surrender)', () => {
    const expected = { 2:'S', 3:'S', 4:'S', 5:'S', 6:'S', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(hard(15), Number(d), S17_DAS), e, `H15 vs ${d}`);
  });

  test('H15 with surrender: R vs T', () => {
    assert.equal(rec(hard(15), 10, S17_DAS_R), 'R');
    assert.equal(rec(hard(15), 1,  S17_DAS_R), 'H');
  });

  test('H16: S vs 2-6, R vs 9/T/A (with surrender), H otherwise', () => {
    assert.equal(rec(hard(16), 9,  S17_DAS_R), 'R');
    assert.equal(rec(hard(16), 10, S17_DAS_R), 'R');
    assert.equal(rec(hard(16), 1,  S17_DAS_R), 'R');
    assert.equal(rec(hard(16), 7,  S17_DAS_R), 'H');
    assert.equal(rec(hard(16), 2,  S17_DAS_R), 'S');
  });

  test('H17+: always S', () => {
    for (const t of [17, 18, 19, 20]) {
      for (const d of dealer)
        assert.equal(rec(hard(t), d, S17_DAS), 'S', `H${t} vs ${d}`);
    }
  });
});

// ── ハードハンド H17 ──
describe('hard H17', () => {
  test('H11 H17: D vs 2-A (including A)', () => {
    for (const d of [2,3,4,5,6,7,8,9,10,1])
      assert.equal(rec(hard(11), d, H17_DAS), 'D', `H11 vs ${d}`);
  });

  test('H15 H17+surrender: R vs T and A', () => {
    assert.equal(rec(hard(15), 10, H17_DAS_R), 'R');
    assert.equal(rec(hard(15), 1,  H17_DAS_R), 'R');
  });

  test('H17 H17+surrender: Rs vs A → S', () => {
    // Raw は Rs、resolved（surrender可）→ R
    assert.equal(raw(hard(17), 1, H17_DAS_R), 'Rs');
    assert.equal(rec(hard(17), 1, H17_DAS_R), 'R');
    // surrender不可 → S
    assert.equal(rec(hard(17), 1, H17_DAS),   'S');
  });
});

// ── ソフトハンド S17 ──
describe('soft S17', () => {
  test('soft 13 (A,2): D vs 5-6, H otherwise', () => {
    const expected = { 2:'H', 3:'H', 4:'H', 5:'D', 6:'D', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(soft(13), Number(d), S17_DAS), e, `S13 vs ${d}`);
  });

  test('soft 14 (A,3): D vs 5-6, H otherwise', () => {
    const expected = { 2:'H', 3:'H', 4:'H', 5:'D', 6:'D', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(soft(14), Number(d), S17_DAS), e, `S14 vs ${d}`);
  });

  test('soft 15 (A,4): D vs 4-6, H otherwise', () => {
    const expected = { 2:'H', 3:'H', 4:'D', 5:'D', 6:'D', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(soft(15), Number(d), S17_DAS), e, `S15 vs ${d}`);
  });

  test('soft 16 (A,5): D vs 4-6, H otherwise', () => {
    const expected = { 2:'H', 3:'H', 4:'D', 5:'D', 6:'D', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(soft(16), Number(d), S17_DAS), e, `S16 vs ${d}`);
  });

  test('soft 17 (A,6): D vs 3-6, H otherwise', () => {
    const expected = { 2:'H', 3:'D', 4:'D', 5:'D', 6:'D', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(soft(17), Number(d), S17_DAS), e, `S17 vs ${d}`);
  });

  test('soft 18 (A,7): Ds vs 2-6, S vs 7-8, H vs 9-A (raw)', () => {
    // raw
    assert.equal(raw(soft(18), 2,  S17_DAS), 'Ds');
    assert.equal(raw(soft(18), 6,  S17_DAS), 'Ds');
    assert.equal(raw(soft(18), 7,  S17_DAS), 'S');
    assert.equal(raw(soft(18), 8,  S17_DAS), 'S');
    assert.equal(raw(soft(18), 9,  S17_DAS), 'H');
    assert.equal(raw(soft(18), 10, S17_DAS), 'H');
    assert.equal(raw(soft(18), 1,  S17_DAS), 'H');
    // resolved (no double after 2 cards → must always be canDouble=true here)
    assert.equal(rec(soft(18), 2,  S17_DAS), 'D');
    assert.equal(rec(soft(18), 7,  S17_DAS), 'S');
  });

  test('soft 19 (A,8): always S', () => {
    for (const d of [2,3,4,5,6,7,8,9,10,1])
      assert.equal(rec(soft(19), d, S17_DAS), 'S', `S19 vs ${d}`);
  });

  test('soft 20 (A,9): always S', () => {
    for (const d of [2,3,4,5,6,7,8,9,10,1])
      assert.equal(rec(soft(20), d, S17_DAS), 'S', `S20 vs ${d}`);
  });
});

// ── ペアスプリット DASあり ──
describe('pair DAS', () => {
  test('A,A: always P', () => {
    for (const d of [2,3,4,5,6,7,8,9,10,1])
      assert.equal(rec(pair(1), d, S17_DAS), 'P', `AA vs ${d}`);
  });

  test('2,2 and 3,3: P vs 2-7, H vs 8-A', () => {
    for (const pv of [2, 3]) {
      const expected = { 2:'P', 3:'P', 4:'P', 5:'P', 6:'P', 7:'P', 8:'H', 9:'H', 10:'H', 1:'H' };
      for (const [d, e] of Object.entries(expected))
        assert.equal(rec(pair(pv), Number(d), S17_DAS), e, `${pv},${pv} vs ${d}`);
    }
  });

  test('4,4: P vs 5-6, H otherwise (DAS)', () => {
    const expected = { 2:'H', 3:'H', 4:'H', 5:'P', 6:'P', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(pair(4), Number(d), S17_DAS), e, `4,4 vs ${d}`);
  });

  test('5,5: never P → D vs 2-9, H vs T/A', () => {
    const expected = { 2:'D', 3:'D', 4:'D', 5:'D', 6:'D', 7:'D', 8:'D', 9:'D', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(pair(5), Number(d), S17_DAS), e, `5,5 vs ${d}`);
  });

  test('6,6: P vs 2-6, H vs 7-A', () => {
    const expected = { 2:'P', 3:'P', 4:'P', 5:'P', 6:'P', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(pair(6), Number(d), S17_DAS), e, `6,6 vs ${d}`);
  });

  test('7,7: P vs 2-7, H vs 8-A', () => {
    const expected = { 2:'P', 3:'P', 4:'P', 5:'P', 6:'P', 7:'P', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(pair(7), Number(d), S17_DAS), e, `7,7 vs ${d}`);
  });

  test('8,8: always P (S17, no surrender)', () => {
    for (const d of [2,3,4,5,6,7,8,9,10,1])
      assert.equal(rec(pair(8), d, S17_DAS), 'P', `8,8 vs ${d}`);
  });

  test('8,8 H17 with surrender: Rp vs A → R', () => {
    assert.equal(raw(pair(8), 1, H17_DAS_R), 'Rp');
    assert.equal(rec(pair(8), 1, H17_DAS_R), 'R');
    // surrender不可 → P
    assert.equal(rec(pair(8), 1, H17_DAS),   'P');
  });

  test('9,9: P vs 2-9 except 7, S vs 7/T/A', () => {
    const expected = { 2:'P', 3:'P', 4:'P', 5:'P', 6:'P', 7:'S', 8:'P', 9:'P', 10:'S', 1:'S' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(pair(9), Number(d), S17_DAS), e, `9,9 vs ${d}`);
  });

  test('T,T: always S', () => {
    for (const d of [2,3,4,5,6,7,8,9,10,1])
      assert.equal(rec(pair(10), d, S17_DAS), 'S', `T,T vs ${d}`);
  });
});

// ── ソフトハンド H17（S17との差分）──
describe('soft H17 differences from S17', () => {
  test('soft 19 (A,8) vs 6: H17=Ds, S17=S', () => {
    assert.equal(raw(soft(19), 6, H17_DAS), 'Ds', 'H17 raw should be Ds');
    assert.equal(rec(soft(19), 6, H17_DAS), 'D',  'H17 resolved should be D');
    assert.equal(rec(soft(19), 6, S17_DAS), 'S',  'S17 should stay S');
  });

  test('soft 19 vs non-6: always S regardless of H17/S17', () => {
    for (const d of [2,3,4,5,7,8,9,10,1])
      assert.equal(rec(soft(19), d, H17_DAS), 'S', `S19 H17 vs ${d}`);
  });

  test('soft 18: identical between S17 and H17', () => {
    for (const d of [2,3,4,5,6,7,8,9,10,1])
      assert.equal(rec(soft(18), d, H17_DAS), rec(soft(18), d, S17_DAS), `S18 vs ${d}`);
  });
});

// ── isSplit オプション ──
describe('isSplit option', () => {
  test('surrender not available after split (isSplit=true)', () => {
    // H16 vs T: with surrender=true normally → R, but with isSplit=true → H
    const opts_r   = { h17: false, das: true, surrender: true, isSplit: false };
    const opts_spl = { h17: false, das: true, surrender: true, isSplit: true  };
    assert.equal(rec(hard(16), 10, opts_r),   'R', 'without split: surrender ok');
    assert.equal(rec(hard(16), 10, opts_spl), 'H', 'after split: no surrender');
  });

  test('no-DAS after split: D resolves to H, Ds resolves to S', () => {
    const nodasSplit = { ...S17_NODAS, isSplit: true };
    assert.equal(raw(hard(11), 6, nodasSplit), 'D');
    assert.equal(rec(hard(11), 6, nodasSplit), 'H', 'H11 vs 6: no double after split');
    assert.equal(raw(soft(18), 4, nodasSplit), 'Ds');
    assert.equal(rec(soft(18), 4, nodasSplit), 'S', 'A,7 vs 4: no double after split');
  });

  test('no-DAS without split: D still available', () => {
    assert.equal(rec(hard(11), 6, { ...S17_NODAS, isSplit: false }), 'D');
    assert.equal(rec(soft(18), 4, { ...S17_NODAS, isSplit: false }), 'D');
  });

  test('DAS after split: D still available', () => {
    assert.equal(rec(hard(11), 6, { ...S17_DAS, isSplit: true }), 'D');
    assert.equal(rec(soft(18), 4, { ...S17_DAS, isSplit: true }), 'D');
  });
});

// ── DASなし ──
describe('pair no-DAS', () => {
  test('2,2 no-DAS: P vs 4-7 only', () => {
    const expected = { 2:'H', 3:'H', 4:'P', 5:'P', 6:'P', 7:'P', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(pair(2), Number(d), S17_NODAS), e, `2,2 no-DAS vs ${d}`);
  });

  test('3,3 no-DAS: P vs 4-7 only', () => {
    const expected = { 2:'H', 3:'H', 4:'P', 5:'P', 6:'P', 7:'P', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(pair(3), Number(d), S17_NODAS), e, `3,3 no-DAS vs ${d}`);
  });

  test('6,6 no-DAS: P vs 3-6', () => {
    const expected = { 2:'H', 3:'P', 4:'P', 5:'P', 6:'P', 7:'H', 8:'H', 9:'H', 10:'H', 1:'H' };
    for (const [d, e] of Object.entries(expected))
      assert.equal(rec(pair(6), Number(d), S17_NODAS), e, `6,6 no-DAS vs ${d}`);
  });
});

// ── resolveAction ──
describe('resolveAction', () => {
  test('D → D when canDouble', () => {
    assert.equal(Strategy.resolveAction('D', true, false), 'D');
  });
  test('D → H when cannot double', () => {
    assert.equal(Strategy.resolveAction('D', false, false), 'H');
  });
  test('Ds → D when canDouble', () => {
    assert.equal(Strategy.resolveAction('Ds', true, false), 'D');
  });
  test('Ds → S when cannot double', () => {
    assert.equal(Strategy.resolveAction('Ds', false, false), 'S');
  });
  test('R → R when canSurrender', () => {
    assert.equal(Strategy.resolveAction('R', false, true), 'R');
  });
  test('R → H when cannot surrender', () => {
    assert.equal(Strategy.resolveAction('R', false, false), 'H');
  });
  test('Rs → S when cannot surrender', () => {
    assert.equal(Strategy.resolveAction('Rs', false, false), 'S');
  });
  test('Rp → P when cannot surrender', () => {
    assert.equal(Strategy.resolveAction('Rp', false, false), 'P');
  });
  test('P passthrough', () => {
    assert.equal(Strategy.resolveAction('P', true, true), 'P');
  });
});
