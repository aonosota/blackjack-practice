'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers.js');

const { Game } = global;

// ── calcHand ──
describe('calcHand', () => {
  function card(value, rank = String(value)) {
    return { value, rank, suit: '♠', display: rank + '♠', isRed: false };
  }
  const A = card(1, 'A');
  const K = card(10, 'K');

  test('hard total', () => {
    const info = Game.calcHand([card(7), card(8)]);
    assert.equal(info.total, 15);
    assert.equal(info.isSoft, false);
    assert.equal(info.isBust, false);
  });

  test('soft ace', () => {
    const info = Game.calcHand([A, card(7)]);
    assert.equal(info.total, 18);
    assert.equal(info.isSoft, true);
  });

  test('ace downgraded on bust risk', () => {
    const info = Game.calcHand([A, card(9), card(5)]);
    assert.equal(info.total, 15);
    assert.equal(info.isSoft, false);
  });

  test('bust', () => {
    const info = Game.calcHand([card(10), card(10), card(5)]);
    assert.equal(info.isBust, true);
    assert.ok(info.total > 21);
  });

  test('blackjack', () => {
    const info = Game.calcHand([A, K]);
    assert.equal(info.isBlackjack, true);
    assert.equal(info.total, 21);
  });

  test('pair detection', () => {
    const info = Game.calcHand([card(8), card(8)]);
    assert.equal(info.isPair, true);
    assert.equal(info.pairValue, 8);
  });

  test('no pair with 3+ cards', () => {
    const info = Game.calcHand([card(5), card(5), card(5)]);
    assert.equal(info.isPair, false);
  });

  test('soft 21 is not bust', () => {
    const info = Game.calcHand([A, card(10)]);
    assert.equal(info.isBust, false);
    assert.equal(info.total, 21);
  });
});

// ── createDeck / shuffleDeck ──
describe('deck', () => {
  test('6-deck has 312 cards', () => {
    const deck = Game.createDeck(6);
    assert.equal(deck.length, 312);
  });

  test('1-deck has 52 cards', () => {
    assert.equal(Game.createDeck(1).length, 52);
  });

  test('shuffle preserves count', () => {
    const deck = Game.createDeck(1);
    const shuffled = Game.shuffleDeck(deck);
    assert.equal(shuffled.length, 52);
  });
});

// ── settle ──
describe('settle', () => {
  const settings = { numDecks: 6, h17: false, das: true, surrender: false, startChips: 1000, minBet: 50, maxBet: 500 };

  function makeState(playerCards, dealerCards, bet = 100) {
    const state = Game.createGameState(settings);
    state.deck = Game.shuffleDeck(Game.createDeck(6));
    state.chips = settings.startChips;
    state.playerHands = [{
      cards: playerCards,
      bet,
      result: null,
      doubled: false,
      surrendered: false,
      splitFromAce: false,
    }];
    state.dealerCards = dealerCards;
    state.dealerUpCard = dealerCards[0];
    return state;
  }

  function card(value, rank = String(value)) {
    return { value, rank, suit: '♠', display: rank + '♠', isRed: false };
  }

  const A = card(1, 'A');
  const K = card(10, 'K');

  test('player wins: chips increase', () => {
    const state = makeState([card(10), card(9)], [card(10), card(8)]);
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, 100);
    assert.equal(state.chips, 1100);
    assert.equal(state.playerHands[0].result, 'win');
  });

  test('player loses: chips decrease', () => {
    const state = makeState([card(10), card(8)], [card(10), card(9)]);
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, -100);
    assert.equal(state.chips, 900);
    assert.equal(state.playerHands[0].result, 'lose');
  });

  test('push: no change', () => {
    const state = makeState([card(10), card(9)], [card(10), card(9)]);
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, 0);
    assert.equal(state.playerHands[0].result, 'push');
  });

  test('player blackjack: 1.5x payout', () => {
    const state = makeState([A, K], [card(10), card(8)]);
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, 150);
    assert.equal(state.playerHands[0].result, 'blackjack');
  });

  test('both blackjack: push', () => {
    const state = makeState([A, K], [A, K]);
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, 0);
    assert.equal(state.playerHands[0].result, 'push');
  });

  test('dealer blackjack: player loses', () => {
    const state = makeState([card(10), card(9)], [A, K]);
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, -100);
    assert.equal(state.playerHands[0].result, 'lose');
  });

  test('player bust: loses', () => {
    const state = makeState([card(10), card(10), card(5)], [card(10), card(8)]);
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, -100);
    assert.equal(state.playerHands[0].result, 'lose');
  });

  test('dealer bust: player wins', () => {
    const state = makeState([card(10), card(9)], [card(10), card(10), card(5)]);
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, 100);
    assert.equal(state.playerHands[0].result, 'win');
  });

  test('surrender: -half bet', () => {
    const state = makeState([card(10), card(6)], [card(10), card(8)]);
    state.playerHands[0].surrendered = true;
    const { totalDelta } = Game.settle(state);
    assert.equal(totalDelta, -50);
    assert.equal(state.playerHands[0].result, 'surrender');
  });
});

// ── canDouble / canSplit / canSurrender ──
describe('can-action helpers', () => {
  const settings = { numDecks: 6, h17: false, das: true, surrender: true, startChips: 1000, minBet: 50, maxBet: 500 };

  function card(value) {
    return { value, rank: String(value), suit: '♠', display: String(value) + '♠', isRed: false };
  }

  function singleHandState(cards) {
    const state = Game.createGameState(settings);
    state.playerHands = [{ cards, bet: 100, result: null, doubled: false, surrendered: false, splitFromAce: false }];
    state.currentHandIdx = 0;
    return state;
  }

  test('canDouble: true with 2 cards, sufficient chips', () => {
    const state = singleHandState([card(5), card(6)]);
    assert.equal(Game.canDouble(state.playerHands[0], state), true);
  });

  test('canDouble: false after 3+ cards', () => {
    const state = singleHandState([card(5), card(6), card(4)]);
    assert.equal(Game.canDouble(state.playerHands[0], state), false);
  });

  test('canDouble: false on splitFromAce hand', () => {
    const state = singleHandState([card(1), card(9)]);
    state.playerHands[0].splitFromAce = true;
    assert.equal(Game.canDouble(state.playerHands[0], state), false);
  });

  test('canDouble: false when chips < 2x bet', () => {
    // chips=150, bet=100 → needs 200 to double
    const state = singleHandState([card(5), card(6)]);
    state.chips = 150;
    assert.equal(Game.canDouble(state.playerHands[0], state), false);
  });

  test('canDouble: true when chips exactly 2x bet', () => {
    const state = singleHandState([card(5), card(6)]);
    state.chips = 200;
    assert.equal(Game.canDouble(state.playerHands[0], state), true);
  });

  test('canSplit: true for matching value pair with sufficient chips', () => {
    const state = singleHandState([card(8), card(8)]);
    assert.equal(Game.canSplit(state.playerHands[0], state), true);
  });

  test('canSplit: false when already split (2 hands)', () => {
    const state = singleHandState([card(8), card(8)]);
    state.playerHands.push({ cards: [card(8), card(3)], bet: 100 });
    assert.equal(Game.canSplit(state.playerHands[0], state), false);
  });

  test('canSplit: false when chips < 2x bet', () => {
    const state = singleHandState([card(8), card(8)]);
    state.chips = 150; // bet=100, needs 200
    assert.equal(Game.canSplit(state.playerHands[0], state), false);
  });

  test('canSplit: false for non-pair', () => {
    const state = singleHandState([card(7), card(8)]);
    assert.equal(Game.canSplit(state.playerHands[0], state), false);
  });

  test('canSurrender: true on first action with surrender enabled', () => {
    const state = singleHandState([card(10), card(6)]);
    assert.equal(Game.canSurrender(state.playerHands[0], state), true);
  });

  test('canSurrender: false when surrender setting off', () => {
    const noSurrSettings = { ...settings, surrender: false };
    const state = Game.createGameState(noSurrSettings);
    state.playerHands = [{ cards: [card(10), card(6)], bet: 100 }];
    assert.equal(Game.canSurrender(state.playerHands[0], state), false);
  });
});

// ── playDealer ──
describe('playDealer', () => {
  function card(value, rank = String(value)) {
    return { value, rank, suit: '♠', display: rank + '♠', isRed: false };
  }

  function makeState(dealerCards, opts = {}) {
    const settings = { numDecks: 6, h17: opts.h17 || false, das: true, surrender: false, startChips: 1000, minBet: 50, maxBet: 500 };
    const state = Game.createGameState(settings);
    state.deck = Game.shuffleDeck(Game.createDeck(6));
    state.deckIndex = 0;
    state.dealerCards = dealerCards;
    state.playerHands = [{ cards: [card(10), card(9)], bet: 100, surrendered: false, result: null }];
    return state;
  }

  test('S17: dealer stands on hard 17', () => {
    const state = makeState([card(10), card(7)]);
    Game.playDealer(state);
    assert.equal(state.dealerCards.length, 2);
  });

  test('S17: dealer stands on soft 17', () => {
    const state = makeState([card(1, 'A'), card(6)]);
    Game.playDealer(state);
    assert.equal(state.dealerCards.length, 2);
  });

  test('H17: dealer hits soft 17', () => {
    const state = makeState([card(1, 'A'), card(6)], { h17: true });
    Game.playDealer(state);
    assert.ok(state.dealerCards.length >= 3, 'should hit on soft 17');
  });

  test('dealer skips when all players bust', () => {
    const settings = { numDecks: 6, h17: false, das: true, surrender: false, startChips: 1000, minBet: 50, maxBet: 500 };
    const state = Game.createGameState(settings);
    state.deck = Game.shuffleDeck(Game.createDeck(6));
    state.dealerCards = [card(6), card(5)]; // dealer 11
    state.playerHands = [{ cards: [card(10), card(10), card(5)], bet: 100, surrendered: false, result: null }];
    Game.playDealer(state);
    assert.equal(state.dealerCards.length, 2, 'dealer should not draw when all players bust');
  });
});
