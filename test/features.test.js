'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers.js');

const { Game, Analysis, Progress } = global;

const settings = {
  numDecks: 6, h17: false, das: true, surrender: false, maxHands: 4,
  startChips: 10000, minBet: 100, maxBet: 5000, drillMode: 'normal', feedback: 'after', advanced: false,
};

function card(value, suit = '♠') {
  const rank = value === 1 ? 'A' : String(value);
  return { value, rank, suit, display: rank + suit, isRed: false };
}
function hand(cards, bet = 100, extra = {}) {
  return { cards, bet, result: null, doubled: false, surrendered: false, splitFromAce: false, isSplit: false, ...extra };
}
/** deck を固定してゲームを作る（dealCard は deck[deckIndex] から順に配る） */
function stateWithDeck(values, s = settings) {
  const state = Game.createGameState(s);
  state.deck = values.map(v => card(v)).concat(Game.createDeck(6));
  state.deckIndex = 0;
  return state;
}

// ── バグ4: スプリット後に再びペアになった場合 ──
describe('re-paired hand after split', () => {
  test('再スプリット不可なら表の行はハード（ペアではない）', () => {
    const state = Game.createGameState({ ...settings, maxHands: 2 });
    state.playerHands = [hand([card(8), card(8)], 100, { isSplit: true }), hand([card(8), card(3)], 100, { isSplit: true })];
    state.currentHandIdx = 0;
    state.dealerUpCard = card(10);
    state.phase = Game.PHASE.PLAYER_TURN;
    const rec = Game.recordAction(state, 'H');
    assert.equal(rec.row.type, 'hard');
    assert.equal(rec.row.key, 16);

    const a = Analysis.analyzeAction(rec, state.settings);
    const reason = a.items.find(i => i.type === 'reason').text;
    assert.ok(!reason.includes('常にスプリット'), reason);
  });

  test('再スプリット可ならペアの行', () => {
    const state = Game.createGameState(settings);
    state.playerHands = [hand([card(8), card(8)], 100, { isSplit: true }), hand([card(8), card(3)], 100, { isSplit: true })];
    state.currentHandIdx = 0;
    state.dealerUpCard = card(10);
    const rec = Game.recordAction(state, 'P');
    assert.equal(rec.row.type, 'pair');
    assert.equal(rec.isCorrect, true);
  });
});

// ── バグ6: 分析のルール比較は実際の可否を使う ──
describe('rule variation notes respect availability', () => {
  test('ダブルできない 11 vs A では H17 の注記を出さない', () => {
    const state = Game.createGameState(settings);
    state.chips = 150; // ダブル不可
    state.playerHands = [hand([card(5), card(6)])];
    state.currentHandIdx = 0;
    state.dealerUpCard = card(1);
    const rec = Game.recordAction(state, 'H');
    assert.equal(rec.options.canDouble, false);
    const a = Analysis.analyzeAction(rec, state.settings);
    assert.ok(!a.items.some(i => i.type === 'rule_variation' && i.text.includes('H17')), JSON.stringify(a.items));
  });

  test('ダブルできる 11 vs A では H17 の注記を出す', () => {
    const state = Game.createGameState(settings);
    state.playerHands = [hand([card(5), card(6)])];
    state.currentHandIdx = 0;
    state.dealerUpCard = card(1);
    const rec = Game.recordAction(state, 'H');
    const a = Analysis.analyzeAction(rec, state.settings);
    assert.ok(a.items.some(i => i.type === 'rule_variation' && i.text.includes('H17')));
  });
});

// ── 改善6: 再スプリット ──
describe('resplit flow', () => {
  test('8,8 を割って 8 が来たら再スプリットできる', () => {
    // 初期: P1=8, Up=10, P2=8, Hole=7 → スプリットで 8 と 5 → 再スプリットで 2 と 3
    const state = stateWithDeck([8, 10, 8, 7, 8, 5, 2, 3]);
    Game.startHand(state, 100);
    Game.actionSplit(state);
    assert.equal(state.playerHands.length, 2);
    assert.deepEqual(state.playerHands[0].cards.map(c => c.value), [8, 8]);
    assert.equal(Game.canSplit(state.playerHands[0], state), true);
    Game.actionSplit(state);
    assert.equal(state.playerHands.length, 3);
    assert.deepEqual(state.playerHands.map(h => h.cards.map(c => c.value)), [[8, 2], [8, 3], [8, 5]]);
  });

  test('A スプリット後は両ハンドとも自動終了', () => {
    const state = stateWithDeck([1, 9, 1, 7, 1, 5]);
    Game.startHand(state, 100);
    const r = Game.actionSplit(state);
    assert.equal(r, 'dealer_turn');
    assert.equal(Game.canSplit(state.playerHands[0], state), false);
  });

  test('スプリット直後に 21 になったハンドは自動でスタンド', () => {
    // T,T を割って 1 枚目に A → 21 は飛ばして 2 枚目のハンドへ
    const state = stateWithDeck([10, 9, 10, 7, 1, 5]);
    Game.startHand(state, 100);
    const r = Game.actionSplit(state);
    assert.equal(r, 'next_hand');
    assert.equal(state.currentHandIdx, 1);
  });
});

// ── 改善4: インシュランス ──
describe('insurance flow', () => {
  test('ディーラー A でインシュランスを提示、取ってディーラー BJ なら相殺', () => {
    const state = stateWithDeck([10, 1, 9, 10]); // P: 10,9  D: A,10(BJ)
    state.chips = 1000;
    Game.startHand(state, 100);
    const offer = Game.insuranceOffer(state);
    assert.deepEqual(offer, { evenMoney: false, amount: 50 });
    const rec = Game.recordInsurance(state, true);
    assert.equal(rec.isCorrect, false);
    const { totalDelta, insuranceDelta } = Game.settle(state);
    assert.equal(insuranceDelta, 100);
    assert.equal(totalDelta, 0); // -100（本体）+100（保険）
    assert.equal(state.chips, 1000);
  });

  test('インシュランスを取ってディーラー BJ でなければ保険分を失う', () => {
    const state = stateWithDeck([10, 1, 9, 6]); // P: 19, D: A,6
    state.chips = 1000;
    Game.startHand(state, 100);
    Game.recordInsurance(state, true);
    Game.playDealer(state);
    const { insuranceDelta } = Game.settle(state);
    assert.equal(insuranceDelta, -50);
  });

  test('プレイヤー BJ ならイーブンマネーで確定 1 倍', () => {
    const state = stateWithDeck([1, 1, 10, 10]); // P: A,10  D: A,10
    Game.startHand(state, 100);
    const offer = Game.insuranceOffer(state);
    assert.equal(offer.evenMoney, true);
    Game.recordInsurance(state, true);
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, 100);
    assert.equal(state.playerHands[0].result, 'even_money');
  });

  test('チップが足りなければインシュランスは提示しない', () => {
    const state = stateWithDeck([10, 1, 9, 6]);
    state.chips = 120;
    Game.startHand(state, 100);
    assert.equal(Game.insuranceOffer(state), null);
  });

  test('アップカードが A 以外なら提示しない', () => {
    const state = stateWithDeck([10, 9, 9, 6]);
    Game.startHand(state, 100);
    assert.equal(Game.insuranceOffer(state), null);
  });
});

// ── 改善1・2: ドリルモードと弱点記録 ──
describe('drill & progress', () => {
  beforeEach(() => {
    Progress._resetMemory();
    Progress.reset();
  });

  test('ドリル対象どおりのカードが配られる', () => {
    for (const target of [
      { type: 'hard', key: 16, dIdx: 8 },
      { type: 'soft', key: 18, dIdx: 0 },
      { type: 'pair', key: 8, dIdx: 9 },
      { type: 'pair', key: 10, dIdx: 4 },
    ]) {
      const state = Game.createGameState(settings);
      state.deck = Game.shuffleDeck(Game.createDeck(6));
      Game.startHand(state, 100, target);
      const info = Game.calcHand(state.playerHands[0].cards);
      if (target.type === 'pair') {
        assert.equal(info.isPair, true);
        assert.equal(info.pairValue, target.key);
      } else {
        assert.equal(info.total, target.key);
        assert.equal(info.isSoft, target.type === 'soft');
        assert.equal(info.isPair, false);
      }
      assert.equal(global.Strategy.dealerToIdx(state.dealerUpCard.value), target.dIdx);
      assert.equal(Game.calcHand(state.dealerCards).isBlackjack, false, 'ドリルではディーラー BJ を作らない');
    }
  });

  test('モードごとの出題タイプ', () => {
    assert.equal(Progress.pickDrillTarget('normal', settings), null);
    for (let i = 0; i < 30; i++) {
      assert.equal(Progress.pickDrillTarget('soft', settings).type, 'soft');
      assert.equal(Progress.pickDrillTarget('pair', settings).type, 'pair');
      const h = Progress.pickDrillTarget('hard', settings);
      assert.equal(h.type, 'hard');
      assert.ok(h.key >= 8 && h.key <= 17);
    }
  });

  test('判断を記録し、苦手なマスを EV 損失順で返す', () => {
    const mk = (type, key, dIdx, isCorrect, evLoss) => ({ row: { type, key, dIdx }, isCorrect, evLoss });
    Progress.recordDecision(settings, mk('hard', 16, 6, false, 0.06));
    Progress.recordDecision(settings, mk('hard', 12, 2, false, 0.003));
    Progress.recordDecision(settings, mk('hard', 12, 2, true, 0));
    Progress.recordDecision(settings, mk('soft', 18, 0, true, 0));
    const cells = Progress.getCells(settings);
    assert.deepEqual(cells['hard:12:2'], { n: 2, correct: 1, evLoss: 0.003 });
    const weak = Progress.weakest(settings);
    assert.equal(weak[0].key, 'hard:16:6');
    assert.equal(weak.length, 2);
  });

  test('ルールが違えば記録は別', () => {
    Progress.recordDecision(settings, { row: { type: 'hard', key: 16, dIdx: 8 }, isCorrect: false, evLoss: 0.01 });
    assert.deepEqual(Progress.getCells({ ...settings, numDecks: 1 }), {});
  });

  test('表の範囲外（ハード18以上）は記録しない', () => {
    Progress.recordDecision(settings, { row: { type: 'hard', key: 19, dIdx: 0 }, isCorrect: true, evLoss: 0 });
    assert.deepEqual(Progress.getCells(settings), {});
  });

  test('苦手優先: 間違えたマスほど重みが大きい', () => {
    assert.ok(Progress.cellWeight({ n: 5, correct: 0, evLoss: 0.3 }) > Progress.cellWeight({ n: 5, correct: 5, evLoss: 0 }));
    assert.ok(Progress.cellWeight(undefined) > Progress.cellWeight({ n: 10, correct: 10, evLoss: 0 }));
  });
});

// ── 改善5: 即時フィードバック ──
describe('quickFeedback', () => {
  test('不正解なら正解と EV 差を含む', () => {
    const state = Game.createGameState(settings);
    state.playerHands = [hand([card(10), card(6)])];
    state.currentHandIdx = 0;
    state.dealerUpCard = card(7);
    const rec = Game.recordAction(state, 'S');
    const msg = Analysis.quickFeedback(rec);
    assert.ok(msg.includes('ヒット'), msg);
    assert.ok(msg.includes('EV差'), msg);
  });
});
