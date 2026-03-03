'use strict';

/**
 * main.js
 * UIコントローラー・ゲームフロー管理
 */

// ── デフォルト設定 ──
const DEFAULT_SETTINGS = {
  numDecks:    6,
  h17:         false,    // false = S17（スタンド）, true = H17（ヒット）
  das:         true,     // ダブルアフタースプリット
  surrender:   false,    // サレンダー
  startChips:  10000,
  minBet:      500,
  maxBet:      10000,
};

// ── 状態 ──
let state = null;
let settings = { ...DEFAULT_SETTINGS };
let sessionStats = { hands: 0, correct: 0, total: 0 };

// ── DOM 参照 ──
const $ = id => document.getElementById(id);

// ── 初期化 ──
document.addEventListener('DOMContentLoaded', () => {
  applySettingsToUI();
  bindSettingsEvents();
  bindActionButtons();
  bindOtherButtons();
  showPhase('start');
});

function applySettingsToUI() {
  $('set-decks').value       = settings.numDecks;
  $('set-dealer').value      = settings.h17 ? 'h17' : 's17';
  $('set-das').value         = settings.das ? 'yes' : 'no';
  $('set-surrender').value   = settings.surrender ? 'yes' : 'no';
  $('set-chips').value       = settings.startChips;
  $('set-min-bet').value     = settings.minBet;
  $('set-max-bet').value     = settings.maxBet;
}

function bindSettingsEvents() {
  $('settings-toggle').addEventListener('click', () => {
    const panel = $('settings-panel');
    const isOpen = panel.classList.toggle('open');
    $('settings-toggle').textContent = isOpen ? '設定 ▲' : '設定 ▼';
  });

  $('apply-settings').addEventListener('click', applySettings);
}

function applySettings() {
  const newNumDecks  = parseInt($('set-decks').value);
  const newH17       = $('set-dealer').value === 'h17';
  const newDas       = $('set-das').value === 'yes';
  const newSurrender = $('set-surrender').value === 'yes';
  const newChips     = parseInt($('set-chips').value);
  const newMinBet    = parseInt($('set-min-bet').value);
  const newMaxBet    = parseInt($('set-max-bet').value);

  if (isNaN(newChips) || newChips < 100) {
    alert('開始チップは100以上にしてください。');
    return;
  }
  if (isNaN(newMinBet) || newMinBet < 1) {
    alert('最小ベットは1以上にしてください。');
    return;
  }
  if (isNaN(newMaxBet) || newMaxBet < newMinBet) {
    alert('最大ベットは最小ベット以上にしてください。');
    return;
  }

  settings = {
    numDecks:   newNumDecks,
    h17:        newH17,
    das:        newDas,
    surrender:  newSurrender,
    startChips: newChips,
    minBet:     newMinBet,
    maxBet:     newMaxBet,
  };

  $('settings-panel').classList.remove('open');
  $('settings-toggle').textContent = '設定 ▼';
  alert('設定を更新しました。次のハンドから反映されます。');
}

function bindActionButtons() {
  $('btn-hit').addEventListener('click', () => playerAction('H'));
  $('btn-stand').addEventListener('click', () => playerAction('S'));
  $('btn-double').addEventListener('click', () => playerAction('D'));
  $('btn-split').addEventListener('click', () => playerAction('P'));
  $('btn-surrender').addEventListener('click', () => playerAction('R'));
}

function bindOtherButtons() {
  $('btn-deal').addEventListener('click', onDeal);
  $('btn-next-hand').addEventListener('click', onNextHand);
  $('btn-end-session').addEventListener('click', onEndSession);
  $('btn-start').addEventListener('click', onStart);
}

// ── セッション開始 ──
function onStart() {
  state = Game.createGameState(settings);
  // デッキ初期化
  state.deck = Game.shuffleDeck(Game.createDeck(settings.numDecks));

  sessionStats = { hands: 0, correct: 0, total: 0 };
  CSV.initSession();

  showPhase('betting');
  updateChipsDisplay();
  updateSessionStats();
  $('analysis-section').style.display = 'none';
}

// ── ベット → ディール ──
function onDeal() {
  const betInput = parseInt($('bet-input').value);
  if (isNaN(betInput) || betInput < settings.minBet || betInput > settings.maxBet) {
    alert(`ベットは ${settings.minBet}〜${settings.maxBet} の範囲で入力してください。`);
    return;
  }
  if (betInput > state.chips) {
    alert('チップが足りません。');
    return;
  }

  Game.startHand(state, betInput);

  // ナチュラルブラックジャックチェック（showPhase前に判定）
  const dealerInfo = Game.calcHand(state.dealerCards);
  const playerInfo = Game.calcHand(state.playerHands[0].cards);

  if (dealerInfo.isBlackjack || playerInfo.isBlackjack) {
    // BJ確定：アクションボタンを表示せずに精算へ
    renderTable();
    handleBlackjack(dealerInfo.isBlackjack, playerInfo.isBlackjack);
    return;
  }

  renderTable();
  showPhase('player_turn');
  clearHandMessage();
  updateActionButtons();
}

function handleBlackjack(dealerBJ, playerBJ) {
  revealDealerCard();
  // BJ時はディーラーがヒットしないため playDealer 不要
  const { totalDelta } = Game.settle(state);
  sessionStats.hands++;
  updateChipsDisplay();
  updateSessionStats();

  const msg = playerBJ && dealerBJ ? '⚖️ お互いブラックジャック！引き分けです。'
    : playerBJ ? '🎉 ブラックジャック！おめでとうございます！'
    : '⚠️ ディーラーがブラックジャックです。あなたの手番はありません。';

  renderTable();
  showHandMessage(msg, playerBJ && !dealerBJ ? 'good' : dealerBJ && !playerBJ ? 'bad' : 'neutral');
  showSettlementInfo(totalDelta);
  showPhase('settlement');
  $('analysis-section').style.display = 'none';
}

// ── プレイヤーアクション ──
function playerAction(action) {
  // フェーズガード：プレイヤーターン以外では無視
  if (!state || state.phase !== Game.PHASE.PLAYER_TURN) return;

  const hand = Game.getCurrentHand(state);
  if (!hand) return;
  const handInfo = Game.calcHand(hand.cards);
  const recommended = Strategy.getStrategyAction(handInfo, state.dealerUpCard.value, settings);

  Game.recordAction(state, action, recommended);

  // CSV記録（ハンド結果はあとで更新）
  CSV.addRecord({
    handNumber:   state.handNumber,
    actionNumber: state.actionHistory.length,
    dealerUpCard: state.dealerUpCard,
    playerCards:  [...hand.cards],
    handInfo,
    action,
    recommended,
    isCorrect:    action === recommended.resolved,
    isBorderline: state.actionHistory[state.actionHistory.length - 1].isBorderline,
    settings:     { ...settings, betAmount: hand.bet },
  });

  // 統計更新
  sessionStats.total++;
  if (action === recommended.resolved) sessionStats.correct++;
  updateSessionStats();

  // アクション実行
  let result;
  switch (action) {
    case 'H': result = Game.actionHit(state);       break;
    case 'S': result = Game.actionStand(state);     break;
    case 'D': result = Game.actionDouble(state);    break;
    case 'P': result = Game.actionSplit(state);     break;
    case 'R': result = Game.actionSurrender(state); break;
  }

  renderTable();

  if (state.phase === Game.PHASE.DEALER_TURN) {
    // すぐにアクションボタンを隠す（600ms間の誤操作を防ぐ）
    showPhase('dealer_turn');
    setTimeout(proceedToDealer, 600);
  } else {
    updateActionButtons();
  }
}

function proceedToDealer() {
  clearHandMessage();
  revealDealerCard();
  Game.playDealer(state);
  renderDealerCards();

  setTimeout(() => {
    const { totalDelta } = Game.settle(state);
    sessionStats.hands++;

    // CSV: ハンド結果を更新
    const mainHand = state.playerHands[0];
    CSV.updateLastHandResult(
      mainHand.result,
      totalDelta,
      state.actionHistory.length
    );

    updateChipsDisplay();
    updateSessionStats();
    showSettlementInfo(totalDelta);
    showAnalysis();
    showPhase('settlement');

    if (state.chips <= 0) {
      setTimeout(() => {
        alert('チップがなくなりました。セッションを終了します。');
        onEndSession();
      }, 1500);
    }
  }, 800);
}

// ── 次のハンドへ ──
function onNextHand() {
  $('analysis-section').style.display = 'none';
  showPhase('betting');
  updateChipsDisplay();
}

// ── セッション終了 ──
function onEndSession() {
  if (CSV.getRecordCount() > 0) {
    CSV.downloadCSV();
  }
  showPhase('start');
  state = null;
}

// ── 分析表示 ──
function showAnalysis() {
  if (state.actionHistory.length === 0) {
    $('analysis-section').style.display = 'none';
    return;
  }

  const analyses = Analysis.generateHandAnalysis(state.actionHistory, settings);
  const container = $('analysis-content');
  container.innerHTML = '';

  for (const a of analyses) {
    const div = document.createElement('div');
    div.className = 'action-analysis';

    const header = document.createElement('div');
    header.className = 'action-header';

    const handType = a.handSummary;
    const dealerCard = state.dealerUpCard.rank === 'A' ? 'A' : String(state.dealerUpCard.value);

    header.innerHTML = `<span class="action-num">アクション ${a.actionNumber}</span>
      <span class="action-cards">${a.cards}</span>
      <span class="action-summary">${handType} vs ディーラー${dealerCard}</span>
      <span class="action-taken">→ ${a.action}</span>`;

    div.appendChild(header);

    for (const item of a.items) {
      const p = document.createElement('p');
      p.className = `analysis-item type-${item.type}`;
      if (item.type === 'result') {
        p.textContent = item.label;
        p.classList.add(item.isCorrect ? 'correct' : (item.isBorderline ? 'borderline' : 'incorrect'));
      } else {
        p.textContent = item.text;
      }
      div.appendChild(p);
    }

    container.appendChild(div);
  }

  $('analysis-section').style.display = 'block';
}

// ── レンダリング関数 ──

function renderTable() {
  renderDealerCards(true); // ホールカード隠す
  renderPlayerHands();
}

function renderDealerCards(hideHole = false) {
  const container = $('dealer-cards');
  container.innerHTML = '';

  for (let i = 0; i < state.dealerCards.length; i++) {
    const card = state.dealerCards[i];
    if (i === 1 && hideHole) {
      container.appendChild(createCardEl(null, true));
    } else {
      container.appendChild(createCardEl(card));
    }
  }

  const info = Game.calcHand(hideHole ? [state.dealerCards[0]] : state.dealerCards);
  $('dealer-total').textContent = hideHole
    ? (state.dealerCards[0].value === 1 ? 'A' : state.dealerCards[0].value) + ' + ?'
    : (info.isSoft && info.total <= 21 ? `ソフト${info.total}` : info.total);
}

function renderPlayerHands() {
  const container = $('player-hands');
  container.innerHTML = '';

  state.playerHands.forEach((hand, idx) => {
    const handDiv = document.createElement('div');
    handDiv.className = 'hand' + (idx === state.currentHandIdx && state.phase === Game.PHASE.PLAYER_TURN ? ' active-hand' : '');

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'cards';
    hand.cards.forEach(c => cardsDiv.appendChild(createCardEl(c)));

    const info = Game.calcHand(hand.cards);
    const totalStr = info.isBlackjack ? 'BJ！'
      : info.isBust ? `バスト(${info.total})`
      : info.isSoft ? `ソフト${info.total}`
      : String(info.total);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'hand-info';
    infoDiv.innerHTML = `<span class="hand-total">${totalStr}</span>
      <span class="hand-bet">ベット: ¥${hand.bet.toLocaleString()}</span>`;

    if (hand.result) {
      const resultEl = document.createElement('span');
      resultEl.className = `hand-result result-${hand.result}`;
      resultEl.textContent = Game.resultLabel(hand.result);
      infoDiv.appendChild(resultEl);
    }

    handDiv.appendChild(cardsDiv);
    handDiv.appendChild(infoDiv);
    container.appendChild(handDiv);
  });
}

function createCardEl(card, hidden = false) {
  const el = document.createElement('div');
  el.className = 'card';
  if (hidden) {
    el.classList.add('card-back');
    el.textContent = '🂠';
    return el;
  }
  el.classList.add(card.isRed ? 'card-red' : 'card-black');
  el.innerHTML = `<span class="card-rank">${card.rank}</span><span class="card-suit">${card.suit}</span>`;
  return el;
}

function revealDealerCard() {
  renderDealerCards(false);
}

function showSettlementInfo(totalDelta) {
  const el = $('settlement-info');
  el.className = 'settlement-info ' + (totalDelta > 0 ? 'win' : totalDelta < 0 ? 'lose' : 'push');
  const sign = totalDelta > 0 ? '+' : '';
  el.textContent = `${sign}¥${totalDelta.toLocaleString()}`;
  el.style.display = 'block';
}

// ── ボタンの有効/無効制御 ──
function updateActionButtons() {
  const hand = Game.getCurrentHand(state);
  if (!hand) return;

  const info = Game.calcHand(hand.cards);
  const canD = Game.canDouble(hand);
  const canP = Game.canSplit(hand, state);
  const canR = Game.canSurrender(hand, state);

  $('btn-double').disabled   = !canD;
  $('btn-split').disabled    = !canP;
  $('btn-surrender').disabled = !canR;
  $('btn-surrender').style.display = settings.surrender ? 'inline-block' : 'none';
}

// ── チップ・統計表示 ──
function updateChipsDisplay() {
  if (!state) return;
  $('chips-display').textContent = `¥${state.chips.toLocaleString()}`;
}

function updateSessionStats() {
  $('stat-hands').textContent = sessionStats.hands;
  const rate = sessionStats.total > 0
    ? Math.round(sessionStats.correct / sessionStats.total * 100)
    : 0;
  $('stat-correct-rate').textContent = `${rate}%（${sessionStats.correct}/${sessionStats.total}手）`;
}

// ── フェーズ切り替え ──
function showPhase(phase) {
  // 表示/非表示を切り替えるパネル（dealer_turnはパネルなし = 全パネル非表示）
  const panels = ['start', 'betting', 'player_turn', 'settlement'];
  panels.forEach(p => {
    const el = $(`phase-${p}`);
    if (el) el.style.display = p === phase ? 'block' : 'none';
  });

  // ゲームテーブルはstart以外で表示
  const table = $('game-table');
  if (table) table.style.display = phase === 'start' ? 'none' : 'block';

  if (phase === 'betting') {
    $('settlement-info').style.display = 'none';
    clearHandMessage();
    $('bet-input').value = settings.minBet;
    $('bet-input').min   = settings.minBet;
    $('bet-input').max   = settings.maxBet;
    if ($('player-hands')) $('player-hands').innerHTML = '';
    if ($('dealer-cards')) $('dealer-cards').innerHTML = '';
    if ($('dealer-total')) $('dealer-total').textContent = '';
  }
}

// ── ハンドメッセージ表示 ──
function showHandMessage(text, type = 'neutral') {
  const el = $('hand-message');
  el.textContent = text;
  el.className = 'hand-message ' + type;
  el.style.display = 'block';
}

function clearHandMessage() {
  const el = $('hand-message');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}
