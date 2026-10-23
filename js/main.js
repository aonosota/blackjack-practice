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
// 設定パネルの値（次のセッション開始時に使う）。セッション中のゲーム・UIは state.settings を参照する
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

  if (state) {
    Game.updateSettings(state, settings);
    if (state.phase === Game.PHASE.BETTING) updateBetInputRange();
  }

  $('settings-panel').classList.remove('open');
  $('settings-toggle').textContent = '設定 ▼';
  alert(state
    ? '設定を更新しました。次のハンドから反映されます。\n（開始チップは次のセッションから反映されます）'
    : '設定を更新しました。');
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
  state.deck = Game.shuffleDeck(Game.createDeck(state.settings.numDecks));

  sessionStats = { hands: 0, correct: 0, total: 0 };
  CSV.initSession();

  showPhase('betting');
  updateChipsDisplay();
  updateSessionStats();
  $('analysis-section').style.display = 'none';
}

// ── ベット → ディール ──
function onDeal() {
  Game.applyPendingSettings(state);
  const { minBet, maxBet } = state.settings;
  const betInput = parseInt($('bet-input').value);
  if (isNaN(betInput) || betInput < minBet || betInput > maxBet) {
    alert(`ベットは ${minBet}〜${maxBet} の範囲で入力してください。`);
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
  const recommended = Strategy.getStrategyAction(handInfo, state.dealerUpCard.value, {
    ...state.settings,
    isSplit: state.playerHands.length > 1,
    canDouble: Game.canDouble(hand, state),
    canSplit: Game.canSplit(hand, state),
  });

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
    settings:     { ...state.settings, betAmount: hand.bet },
  });

  // 統計更新
  sessionStats.total++;
  if (action === recommended.resolved) sessionStats.correct++;
  updateSessionStats();

  // アクション実行
  switch (action) {
    case 'H': Game.actionHit(state);       break;
    case 'S': Game.actionStand(state);     break;
    case 'D': Game.actionDouble(state);    break;
    case 'P': Game.actionSplit(state);     break;
    case 'R': Game.actionSurrender(state); break;
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

    CSV.updateLastHandResult(state.actionHistory, state.playerHands);

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
  // ハンド中に変更された設定をベット画面から反映する
  Game.applyPendingSettings(state);
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

  const analyses = Analysis.generateHandAnalysis(state.actionHistory, state.settings);
  const container = $('analysis-content');
  container.innerHTML = '';

  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    const record = state.actionHistory[i];

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

    div.insertAdjacentHTML('beforeend',
      buildStrategyTableHTML(record.handInfo, record.dealerUpCard.value, state.settings));

    container.appendChild(div);
  }

  $('analysis-section').style.display = 'block';
}

// ── ストラテジー表 HTML 生成 ──
function buildStrategyTableHTML(handInfo, dealerValue, settings) {
  const { total, isSoft, isPair, pairValue, cardCount } = handInfo;
  const dIdx = Strategy.dealerToIdx(dealerValue);
  const { h17, das } = settings;

  const dealerLabels = ['2','3','4','5','6','7','8','9','T','A'];
  const dealerValues = [2,3,4,5,6,7,8,9,10,1];

  let rows = [];
  let title = '';
  let hlKey = null;

  if (isPair && cardCount === 2) {
    title = `ペア表 / DAS: ${das ? 'あり' : 'なし'} / ${h17 ? 'H17' : 'S17'}`;
    const pairKeys   = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const pairLabels = ['A,A','2,2','3,3','4,4','5,5','6,6','7,7','8,8','9,9','T,T'];
    pairKeys.forEach((key, i) => {
      const hi = { total: key === 1 ? 12 : key * 2, isSoft: key === 1, isPair: true, pairValue: key, cardCount: 2 };
      rows.push({ label: pairLabels[i], values: dealerValues.map(dv => Strategy.getStrategyAction(hi, dv, settings).raw), key });
    });
    hlKey = pairValue === 1 ? 1 : (pairValue >= 10 ? 10 : pairValue);
  } else if (isSoft) {
    title = `ソフトハンド表 / ${h17 ? 'H17' : 'S17'}`;
    const softKeys   = [13,14,15,16,17,18,19,20];
    const softLabels = ['A,2','A,3','A,4','A,5','A,6','A,7','A,8','A,9'];
    softKeys.forEach((key, i) => {
      const hi = { total: key, isSoft: true, isPair: false, pairValue: null, cardCount: 2 };
      rows.push({ label: softLabels[i], values: dealerValues.map(dv => Strategy.getStrategyAction(hi, dv, settings).raw), key });
    });
    hlKey = total;
  } else {
    title = `ハードハンド表 / ${h17 ? 'H17' : 'S17'}`;
    const hardKeys = [4,5,6,7,8,9,10,11,12,13,14,15,16,17];
    hardKeys.forEach(key => {
      const hi = { total: key, isSoft: false, isPair: false, pairValue: null, cardCount: 2 };
      rows.push({ label: String(key), values: dealerValues.map(dv => Strategy.getStrategyAction(hi, dv, settings).raw), key });
    });
    hlKey = Math.min(Math.max(total, 4), 17);
  }

  const saClass = raw => {
    switch ((raw || 'H')[0]) {
      case 'S': return 'sa-s';
      case 'D': return 'sa-d';
      case 'P': return 'sa-p';
      case 'R': return 'sa-r';
      default:  return 'sa-h';
    }
  };

  const colHeaders = dealerLabels.map((h, i) =>
    `<th class="strat-dh${i === dIdx ? ' strat-hl-col' : ''}">${h}</th>`).join('');

  const bodyRows = rows.map(row => {
    const isHlRow = row.key === hlKey;
    const cells = row.values.map((v, i) => {
      const hl = isHlRow && i === dIdx;
      return `<td class="${saClass(v)}${hl ? ' strat-hl-cell' : ''}">${v}</td>`;
    }).join('');
    return `<tr><th class="strat-rh${isHlRow ? ' strat-hl-row' : ''}">${row.label}</th>${cells}</tr>`;
  }).join('');

  return `<div class="strat-table-wrap">
    <div class="strat-title">${title}</div>
    <div class="strat-legend">
      <span class="sa-h">H=ヒット</span><span class="sa-s">S=スタンド</span>
      <span class="sa-d">D=ダブル</span><span class="sa-p">P=スプリット</span>
      <span class="sa-r">R=サレンダー</span>
    </div>
    <div class="strat-scroll">
      <table class="strat-table">
        <thead><tr><th class="strat-corner">手 \\ D</th>${colHeaders}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  </div>`;
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
    const totalStr = Game.isNaturalBlackjack(hand) ? 'BJ！'
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

  const canD = Game.canDouble(hand, state);
  const canP = Game.canSplit(hand, state);
  const canR = Game.canSurrender(hand, state);

  $('btn-double').disabled   = !canD;
  $('btn-split').disabled    = !canP;
  $('btn-surrender').disabled = !canR;
  $('btn-surrender').style.display = state.settings.surrender ? 'inline-block' : 'none';
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
    $('bet-input').value = state.settings.minBet;
    updateBetInputRange();
    if ($('player-hands')) $('player-hands').innerHTML = '';
    if ($('dealer-cards')) $('dealer-cards').innerHTML = '';
    if ($('dealer-total')) $('dealer-total').textContent = '';
  }
}

function updateBetInputRange() {
  $('bet-input').min = state.settings.minBet;
  $('bet-input').max = state.settings.maxBet;
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
