'use strict';

/**
 * game.js
 * カード・デッキ・ハンド管理とゲームロジック
 */

// ── カード ──
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function createCard(suit, rank) {
  const rankIdx = RANKS.indexOf(rank);
  let value;
  if (rank === 'A') value = 1;
  else if (['J','Q','K'].includes(rank)) value = 10;
  else value = parseInt(rank);

  return {
    suit,
    rank,
    value,          // 数値（A=1, J/Q/K=10, その他は額面）
    display: rank + suit,
    isRed: suit === '♥' || suit === '♦',
  };
}

// ── デッキ ──
function createDeck(numDecks = 6) {
  const cards = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push(createCard(suit, rank));
      }
    }
  }
  return cards;
}

function shuffleDeck(cards) {
  const arr = [...cards];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── ハンド計算 ──
/**
 * カード配列からハンド情報を計算する
 * @returns {object} { total, isSoft, isPair, pairValue, isBlackjack, isBust }
 */
function calcHand(cards) {
  let total = 0;
  let aceCount = 0;

  for (const c of cards) {
    if (c.value === 1) {
      aceCount++;
      total += 11;
    } else {
      total += c.value;
    }
  }

  // バストを回避するためAを1として計算し直す
  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount--;
  }

  const isSoft = aceCount > 0 && total <= 21;
  const isBust = total > 21;

  // ペア判定（最初の2枚）
  let isPair = false;
  let pairValue = null;
  if (cards.length === 2) {
    const v0 = cards[0].value;
    const v1 = cards[1].value;
    if (v0 === v1) {
      isPair = true;
      pairValue = v0;
    }
  }

  // ブラックジャック（最初の2枚がA+10価値のカード）
  const isBlackjack = cards.length === 2 &&
    ((cards[0].value === 1 && cards[1].value === 10) ||
     (cards[0].value === 10 && cards[1].value === 1));

  return { total, isSoft, isPair, pairValue, isBlackjack, isBust, cardCount: cards.length };
}

// ── ゲーム状態 ──
const PHASE = {
  BETTING: 'betting',
  PLAYER_TURN: 'player_turn',
  DEALER_TURN: 'dealer_turn',
  SETTLEMENT: 'settlement',
};

function createGameState(settings) {
  return {
    phase: PHASE.BETTING,
    deck: [],
    deckIndex: 0,
    dealerCards: [],          // ディーラーの全カード
    dealerUpCard: null,       // ディーラーのオープンカード
    playerHands: [],          // 複数ハンド（スプリット後）
    currentHandIdx: 0,
    bet: settings.minBet,
    chips: settings.startChips,
    handNumber: 0,
    actionHistory: [],        // [{handIdx, cards, handInfo, action, dealerUpCard, recommended, isCorrect}]
    handResult: [],           // ハンドごとの結果
    settings: { ...settings },
  };
}

// ── デッキ管理 ──
function dealCard(state) {
  // デッキ残り25%以下でシャッフル
  if (state.deckIndex >= state.deck.length * 0.75) {
    state.deck = shuffleDeck(createDeck(state.settings.numDecks));
    state.deckIndex = 0;
  }
  return state.deck[state.deckIndex++];
}

// ── ゲーム操作 ──

/** 新しいハンドを開始（ベット確定後） */
function startHand(state, bet) {
  state.bet = bet;
  state.handNumber++;
  state.actionHistory = [];
  state.handResult = [];
  state.currentHandIdx = 0;

  // 初期ディール: プレイヤー→ディーラー→プレイヤー→ディーラー（裏）
  const hand = {
    cards: [dealCard(state), dealCard(state)],
    bet: bet,
    result: null,    // 'win'|'lose'|'push'|'blackjack'|'surrender'
    doubled: false,
    surrendered: false,
    splitFromAce: false,
  };
  state.playerHands = [hand];
  state.dealerCards = [dealCard(state), dealCard(state)];
  state.dealerUpCard = state.dealerCards[0];
  state.phase = PHASE.PLAYER_TURN;
}

/** 現在のハンド情報を取得 */
function getCurrentHand(state) {
  return state.playerHands[state.currentHandIdx];
}

/** アクションを記録する */
function recordAction(state, action, recommended) {
  const hand = getCurrentHand(state);
  const handInfo = calcHand(hand.cards);
  const isCorrect = action === recommended.resolved;
  const isBorderline = checkBorderlineCase(handInfo, state.dealerUpCard.value, state.settings);

  state.actionHistory.push({
    handIdx: state.currentHandIdx,
    cards: [...hand.cards],
    handInfo,
    action,
    dealerUpCard: state.dealerUpCard,
    recommended,
    isCorrect,
    isBorderline,
  });
}

/**
 * 境界ケースかどうかを判定する
 * EVの差が小さく、どちらでも大きな損はないケース
 */
function checkBorderlineCase(handInfo, dealerValue, settings) {
  const total = handInfo.total;
  const isSoft = handInfo.isSoft;
  const dv = dealerValue === 1 ? 'A' : dealerValue;

  // ハード12 vs 2,3: スタンドとヒットのEV差が非常に小さい
  if (!isSoft && total === 12 && (dealerValue === 2 || dealerValue === 3)) return true;
  // ソフト18 vs 2: ダブルとスタンドが近い
  if (isSoft && total === 18 && dealerValue === 2) return true;
  // ハード9 vs 2: ダブルとヒットが近い
  if (!isSoft && total === 9 && dealerValue === 2) return true;
  // ハード16 vs 8: スタンドとヒットが近い
  if (!isSoft && total === 16 && dealerValue === 8) return true;
  // ハード15 vs 10: サレンダーとヒット/スタンドが近い
  if (!isSoft && total === 15 && dealerValue === 10) return true;
  // ソフト19 vs 6: スタンドとダブルが近い（A,8 vs 6）
  if (isSoft && total === 19 && dealerValue === 6) return true;

  return false;
}

// ── プレイヤーアクション ──

function actionHit(state) {
  const hand = getCurrentHand(state);
  hand.cards.push(dealCard(state));
  const info = calcHand(hand.cards);
  if (info.isBust || info.total === 21) {
    return advanceHand(state);
  }
  return null;
}

function actionStand(state) {
  return advanceHand(state);
}

function actionDouble(state) {
  const hand = getCurrentHand(state);
  hand.cards.push(dealCard(state));
  hand.doubled = true;
  hand.bet *= 2;
  return advanceHand(state);
}

function actionSplit(state) {
  const hand = getCurrentHand(state);
  const card0 = hand.cards[0];
  const card1 = hand.cards[1];
  const isAceSplit = card0.value === 1;

  // 元のハンドを1枚目のカードで更新
  hand.cards = [card0, dealCard(state)];
  hand.splitFromAce = isAceSplit;

  // 新しいハンドを2枚目のカードで作成
  const newHand = {
    cards: [card1, dealCard(state)],
    bet: state.bet,
    result: null,
    doubled: false,
    surrendered: false,
    splitFromAce: isAceSplit,
  };

  state.playerHands.splice(state.currentHandIdx + 1, 0, newHand);

  // Aスプリット後：両ハンドとも追加操作なし（カジノルール）
  // advanceHand を2回呼んで両ハンドをスキップ → ディーラーターンへ
  if (isAceSplit) {
    advanceHand(state);        // hand 0 → hand 1
    return advanceHand(state); // hand 1 → dealer_turn
  }
  return null;
}

function actionSurrender(state) {
  const hand = getCurrentHand(state);
  hand.surrendered = true;
  return advanceHand(state);
}

/** 次のハンドへ、なければディーラーターンへ */
function advanceHand(state) {
  state.currentHandIdx++;
  if (state.currentHandIdx >= state.playerHands.length) {
    state.phase = PHASE.DEALER_TURN;
    return 'dealer_turn';
  }
  return 'next_hand';
}

// ── ディーラーターン ──

function playDealer(state) {
  const { h17 } = state.settings;
  // 全プレイヤーハンドがバスト or サレンダーの場合はディーラー不要
  const allDone = state.playerHands.every(h => {
    const info = calcHand(h.cards);
    return info.isBust || h.surrendered;
  });

  if (!allDone) {
    // ディーラーがヒットし続ける
    while (true) {
      const info = calcHand(state.dealerCards);
      if (info.total > 17) break;
      if (info.total === 17) {
        if (!h17) break;           // S17: ソフト17でもスタンド
        if (!info.isSoft) break;   // H17: ハード17はスタンド
        // H17 && soft17: ヒット
      }
      state.dealerCards.push(dealCard(state));
    }
  }
}

// ── 精算 ──

function settle(state) {
  const dealerInfo = calcHand(state.dealerCards);
  let totalDelta = 0;

  state.handResult = [];

  for (const hand of state.playerHands) {
    const playerInfo = calcHand(hand.cards);
    let result, delta;

    if (hand.surrendered) {
      result = 'surrender';
      delta = -Math.floor(hand.bet / 2);
    } else if (playerInfo.isBust) {
      result = 'lose';
      delta = -hand.bet;
    } else if (playerInfo.isBlackjack && !dealerInfo.isBlackjack) {
      result = 'blackjack';
      delta = Math.floor(hand.bet * 1.5);
    } else if (!playerInfo.isBlackjack && dealerInfo.isBlackjack) {
      result = 'lose';
      delta = -hand.bet;
    } else if (dealerInfo.isBust) {
      result = 'win';
      delta = hand.bet;
    } else if (playerInfo.total > dealerInfo.total) {
      result = 'win';
      delta = hand.bet;
    } else if (playerInfo.total < dealerInfo.total) {
      result = 'lose';
      delta = -hand.bet;
    } else {
      result = 'push';
      delta = 0;
    }

    hand.result = result;
    hand.delta = delta;
    state.handResult.push({ result, delta, cards: hand.cards });
    totalDelta += delta;
  }

  state.chips += totalDelta;
  state.phase = PHASE.BETTING;
  return { totalDelta, dealerInfo };
}

// ── ユーティリティ ──

function canDouble(hand) {
  return hand.cards.length === 2 && !hand.splitFromAce;
}

function canSplit(hand, state) {
  if (hand.cards.length !== 2) return false;
  const v0 = hand.cards[0].value;
  const v1 = hand.cards[1].value;
  if (v0 !== v1) return false;
  // 再スプリット不可（既にスプリット済みの場合）
  if (state.playerHands.length > 1) return false;
  return true;
}

function canSurrender(hand, state) {
  return state.settings.surrender && hand.cards.length === 2 && state.playerHands.length === 1;
}

function resultLabel(result) {
  const map = {
    win: '勝ち',
    lose: '負け',
    push: '引き分け',
    blackjack: 'ブラックジャック！',
    surrender: 'サレンダー',
  };
  return map[result] || result;
}

// ── グローバル公開 ──
window.Game = {
  PHASE,
  createGameState,
  startHand,
  getCurrentHand,
  calcHand,
  recordAction,
  checkBorderlineCase,
  actionHit,
  actionStand,
  actionDouble,
  actionSplit,
  actionSurrender,
  playDealer,
  settle,
  canDouble,
  canSplit,
  canSurrender,
  resultLabel,
  shuffleDeck,
  createDeck,
};
