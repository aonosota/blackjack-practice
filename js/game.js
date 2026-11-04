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
    pendingSettings: null,    // ハンド途中に変更された設定（次のハンド開始時に反映）
    insurance: null,          // { evenMoney, amount, taken } ディーラーA時の判断
    drillTarget: null,        // ドリルモードで狙った局面 { type, key, dIdx }
  };
}

// ── 設定変更 ──

/**
 * セッション中の設定変更。ハンド進行中は保留し、次のハンド開始時に反映する。
 * startChips はセッション中は変更しない（次のセッションから有効）。
 */
function updateSettings(state, newSettings) {
  state.pendingSettings = { ...newSettings };
  if (state.phase === PHASE.BETTING) applyPendingSettings(state);
}

/** 保留中の設定を反映。デッキ数が変わった場合はシューを作り直す */
function applyPendingSettings(state) {
  const pending = state.pendingSettings;
  if (!pending) return;
  const decksChanged = pending.numDecks !== state.settings.numDecks;
  state.settings = { ...pending, startChips: state.settings.startChips };
  state.pendingSettings = null;
  if (decksChanged) {
    state.deck = shuffleDeck(createDeck(state.settings.numDecks));
    state.deckIndex = 0;
  }
}

// ── デッキ管理 ──
function reshuffle(state) {
  state.deck = shuffleDeck(createDeck(state.settings.numDecks));
  state.deckIndex = 0;
}

/** デッキ残り25%以下でシャッフル */
function ensureShoe(state) {
  if (!state.deck.length || state.deckIndex >= state.deck.length * 0.75) reshuffle(state);
}

function dealCard(state) {
  ensureShoe(state);
  return state.deck[state.deckIndex++];
}

/**
 * 条件に合うカードをシューから抜き出して配る（ドリルモード用）。
 * 見つからなければシャッフルし直して探す。
 */
function pullCard(state, pred) {
  ensureShoe(state);
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = state.deckIndex; i < state.deck.length; i++) {
      if (pred(state.deck[i])) {
        [state.deck[i], state.deck[state.deckIndex]] = [state.deck[state.deckIndex], state.deck[i]];
        return state.deck[state.deckIndex++];
      }
    }
    reshuffle(state);
  }
  return dealCard(state);
}

const DRILL_DEALER_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];

/** ドリル対象の局面からプレイヤー 2 枚の値を決める */
function playerValuesForTarget(target) {
  if (target.type === 'pair') return [target.key, target.key];
  if (target.type === 'soft') return [1, target.key - 11];
  const combos = [];
  for (let a = 2; a <= 10; a++) {
    for (let b = a + 1; b <= 10; b++) if (a + b === target.key) combos.push([a, b]);
  }
  const pick = combos[Math.floor(Math.random() * combos.length)];
  return Math.random() < 0.5 ? pick : [pick[1], pick[0]];
}

// ── ゲーム操作 ──

/**
 * 新しいハンドを開始（ベット確定後）
 * @param {object|null} target - ドリルモードの局面 { type: 'hard'|'soft'|'pair', key, dIdx }
 */
function startHand(state, bet, target = null) {
  applyPendingSettings(state);
  state.bet = bet;
  state.handNumber++;
  state.actionHistory = [];
  state.handResult = [];
  state.currentHandIdx = 0;
  state.insurance = null;
  state.drillTarget = target;

  let playerCards, dealerCards;
  if (target) {
    const [v1, v2] = playerValuesForTarget(target);
    const upValue = DRILL_DEALER_VALUES[target.dIdx];
    const p1 = pullCard(state, c => c.value === v1);
    const up = pullCard(state, c => c.value === upValue);
    const p2 = pullCard(state, c => c.value === v2);
    // 判断の練習が目的なので、ディーラーのブラックジャックは作らない
    const hole = pullCard(state, c => !(upValue === 1 && c.value === 10) && !(upValue === 10 && c.value === 1));
    playerCards = [p1, p2];
    dealerCards = [up, hole];
  } else {
    // 初期ディール: プレイヤー→ディーラー→プレイヤー→ディーラー（裏）
    const p1 = dealCard(state), up = dealCard(state), p2 = dealCard(state), hole = dealCard(state);
    playerCards = [p1, p2];
    dealerCards = [up, hole];
  }

  const hand = {
    cards: playerCards,
    bet: bet,
    result: null,    // 'win'|'lose'|'push'|'blackjack'|'surrender'|'even_money'
    doubled: false,
    surrendered: false,
    splitFromAce: false,
    isSplit: false,  // スプリットで作られたハンドか（A+10でもBJ扱いしない）
  };
  state.playerHands = [hand];
  state.dealerCards = dealerCards;
  state.dealerUpCard = state.dealerCards[0];
  state.phase = PHASE.PLAYER_TURN;
}

/** 現在のハンド情報を取得 */
function getCurrentHand(state) {
  return state.playerHands[state.currentHandIdx];
}

/** 現在のハンドで実際に取れるアクションと、戦略判定に渡すオプション */
function decisionOptions(state) {
  const hand = getCurrentHand(state);
  return {
    ...state.settings,
    isSplit: state.playerHands.length > 1,
    canDouble: canDouble(hand, state),
    canSplit: canSplit(hand, state),
    cards: hand.cards,
  };
}

/**
 * プレイヤーのアクションを EV で評価し、履歴に記録する
 * @returns {object} 記録したレコード
 */
function recordAction(state, action) {
  const hand = getCurrentHand(state);
  const handInfo = calcHand(hand.cards);
  const options = decisionOptions(state);
  const evaluation = window.Strategy.evaluateDecision(handInfo, state.dealerUpCard.value, options, action);

  const record = {
    kind: 'play',
    handIdx: state.currentHandIdx,
    cards: [...hand.cards],
    handInfo,
    action,
    dealerUpCard: state.dealerUpCard,
    bet: hand.bet,
    options: { canDouble: options.canDouble, canSplit: options.canSplit, isSplit: options.isSplit },
    ...evaluation,
  };
  state.actionHistory.push(record);
  return record;
}

// ── インシュランス / イーブンマネー ──

/**
 * ディーラーのアップカードが A のときの提示内容。提示しない場合は null
 * プレイヤーが BJ ならイーブンマネー、それ以外はベットの半額のインシュランス
 */
function insuranceOffer(state) {
  if (!state.dealerUpCard || state.dealerUpCard.value !== 1) return null;
  if (isNaturalBlackjack(state.playerHands[0])) return { evenMoney: true, amount: 0 };
  const amount = Math.floor(state.bet / 2);
  if (amount < 1 || state.chips < state.bet + amount) return null;
  return { evenMoney: false, amount };
}

/**
 * インシュランス / イーブンマネーの判断を記録する
 * @param {boolean} take - 取る（受ける）なら true
 */
function recordInsurance(state, take) {
  const offer = insuranceOffer(state);
  if (!offer) return null;
  state.insurance = { ...offer, taken: take };
  const hand = state.playerHands[0];
  const action = take ? (offer.evenMoney ? 'E' : 'I') : 'N';
  const evaluation = window.Strategy.evaluateInsurance(state.settings.numDecks, hand.cards, offer.evenMoney, action);
  const record = {
    kind: 'insurance',
    handIdx: 0,
    cards: [...hand.cards],
    handInfo: calcHand(hand.cards),
    action,
    dealerUpCard: state.dealerUpCard,
    bet: hand.bet,
    evenMoney: offer.evenMoney,
    options: {},
    ...evaluation,
  };
  state.actionHistory.push(record);
  return record;
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
  hand.isSplit = true;

  // 新しいハンドを2枚目のカードで作成
  const newHand = {
    cards: [card1, dealCard(state)],
    bet: state.bet,
    result: null,
    doubled: false,
    surrendered: false,
    splitFromAce: isAceSplit,
    isSplit: true,
  };

  state.playerHands.splice(state.currentHandIdx + 1, 0, newHand);

  // Aスプリット後は両ハンドとも追加操作なし（カジノルール）。
  // スプリット直後に 21 になったハンドも自動でスタンドする
  return skipFinishedHands(state);
}

function actionSurrender(state) {
  const hand = getCurrentHand(state);
  hand.surrendered = true;
  return advanceHand(state);
}

/** 次のハンドへ、なければディーラーターンへ */
function advanceHand(state) {
  state.currentHandIdx++;
  return skipFinishedHands(state);
}

/** 操作の必要がないハンド（Aスプリット・21）を飛ばす */
function skipFinishedHands(state) {
  while (state.currentHandIdx < state.playerHands.length) {
    const hand = state.playerHands[state.currentHandIdx];
    if (!hand.splitFromAce && calcHand(hand.cards).total !== 21) break;
    state.currentHandIdx++;
  }
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
  const ins = state.insurance;

  state.handResult = [];

  for (const hand of state.playerHands) {
    const playerInfo = calcHand(hand.cards);
    const playerBJ = isNaturalBlackjack(hand);
    let result, delta;

    if (ins && ins.taken && ins.evenMoney) {
      result = 'even_money';
      delta = hand.bet;
    } else if (hand.surrendered) {
      result = 'surrender';
      delta = -Math.floor(hand.bet / 2);
    } else if (playerInfo.isBust) {
      result = 'lose';
      delta = -hand.bet;
    } else if (playerBJ && !dealerInfo.isBlackjack) {
      result = 'blackjack';
      delta = Math.floor(hand.bet * 1.5);
    } else if (!playerBJ && dealerInfo.isBlackjack) {
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

  // インシュランス（2:1）
  let insuranceDelta = 0;
  if (ins && ins.taken && !ins.evenMoney) {
    insuranceDelta = dealerInfo.isBlackjack ? ins.amount * 2 : -ins.amount;
    ins.delta = insuranceDelta;
    totalDelta += insuranceDelta;
  }

  state.chips += totalDelta;
  state.phase = PHASE.BETTING;
  return { totalDelta, dealerInfo, insuranceDelta };
}

// ── ユーティリティ ──

/** ナチュラルBJか（スプリット後の A+10 は通常の21として扱う） */
function isNaturalBlackjack(hand) {
  return !hand.isSplit && calcHand(hand.cards).isBlackjack;
}

function canDouble(hand, state) {
  if (hand.cards.length !== 2 || hand.splitFromAce) return false;
  // DASなしの場合、スプリット後のハンドはダブル不可
  if (!state.settings.das && state.playerHands.length > 1) return false;
  const totalBets = state.playerHands.reduce((s, h) => s + h.bet, 0);
  return state.chips >= totalBets + hand.bet;
}

function canSplit(hand, state) {
  if (hand.cards.length !== 2) return false;
  const v0 = hand.cards[0].value;
  const v1 = hand.cards[1].value;
  if (v0 !== v1) return false;
  // A の再スプリットは不可。それ以外は設定のハンド数まで
  if (hand.splitFromAce) return false;
  const maxHands = Number(state.settings.maxHands) === 2 ? 2 : 4;
  if (state.playerHands.length >= maxHands) return false;
  const totalBets = state.playerHands.reduce((s, h) => s + h.bet, 0);
  return state.chips >= totalBets + hand.bet;
}

function canSurrender(hand, state) {
  return state.settings.surrender && hand.cards.length === 2 && state.playerHands.length === 1;
}

function handSummary(handInfo) {
  return handInfo.isSoft ? `ソフト${handInfo.total}` : `ハード${handInfo.total}`;
}

function resultLabel(result) {
  const map = {
    win: '勝ち',
    lose: '負け',
    push: '引き分け',
    blackjack: 'ブラックジャック！',
    surrender: 'サレンダー',
    even_money: 'イーブンマネー',
  };
  return map[result] || result;
}

// ── グローバル公開 ──
window.Game = {
  PHASE,
  createGameState,
  updateSettings,
  applyPendingSettings,
  startHand,
  getCurrentHand,
  calcHand,
  isNaturalBlackjack,
  recordAction,
  decisionOptions,
  insuranceOffer,
  recordInsurance,
  pullCard,
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
  handSummary,
  resultLabel,
  shuffleDeck,
  createDeck,
};
