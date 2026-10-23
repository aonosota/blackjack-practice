'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers.js');

const { Game } = global;

const BASE = {
  numDecks: 6, h17: false, das: true, surrender: false,
  startChips: 10000, minBet: 500, maxBet: 10000,
};

function newSession(overrides = {}) {
  const state = Game.createGameState({ ...BASE, ...overrides });
  state.deck = Game.shuffleDeck(Game.createDeck(state.settings.numDecks));
  return state;
}

// ── セッション中の設定変更 ──
describe('updateSettings', () => {
  test('ベット中の変更は即時に state.settings へ反映される', () => {
    const state = newSession();
    Game.updateSettings(state, { ...BASE, h17: true, surrender: true });
    assert.equal(state.settings.h17, true);
    assert.equal(state.settings.surrender, true);
    assert.equal(state.pendingSettings, null);
  });

  test('ハンド途中の変更は保留され、次のハンド開始時に反映される', () => {
    const state = newSession();
    Game.startHand(state, 500);
    Game.updateSettings(state, { ...BASE, h17: true, surrender: true });

    // ハンド中は旧設定のまま（ディーラー挙動・サレンダー可否が一貫）
    assert.equal(state.settings.h17, false);
    assert.equal(Game.canSurrender(state.playerHands[0], state), false);

    Game.actionStand(state);
    Game.playDealer(state);
    Game.settle(state);
    assert.equal(state.settings.h17, false, '精算直後（分析表示時）もそのハンドの設定のまま');

    Game.startHand(state, 500);
    assert.equal(state.settings.h17, true);
    assert.equal(Game.canSurrender(state.playerHands[0], state), true);
    assert.equal(state.pendingSettings, null);
  });

  test('startChips はセッション中は変わらない', () => {
    const state = newSession();
    Game.updateSettings(state, { ...BASE, startChips: 50000 });
    assert.equal(state.settings.startChips, 10000);
    assert.equal(state.chips, 10000);
  });

  test('デッキ数変更時はシューを作り直す', () => {
    const state = newSession();
    Game.startHand(state, 500);
    Game.updateSettings(state, { ...BASE, numDecks: 2 });
    assert.equal(state.deck.length, 6 * 52, 'ハンド中はシューを変えない');

    Game.actionStand(state);
    Game.playDealer(state);
    Game.settle(state);
    Game.startHand(state, 500);
    assert.equal(state.settings.numDecks, 2);
    assert.equal(state.deck.length, 2 * 52);
    assert.equal(state.deckIndex, 4, '新しいシューから配られている');
  });

  test('デッキ数が同じならシューは維持される', () => {
    const state = newSession();
    Game.startHand(state, 500);
    const deck = state.deck;
    Game.actionStand(state);
    Game.playDealer(state);
    Game.settle(state);
    const idx = state.deckIndex;
    Game.updateSettings(state, { ...BASE, das: false });
    assert.equal(state.deck, deck);
    assert.equal(state.deckIndex, idx);
  });
});
