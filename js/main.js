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
  maxHands:    4,        // スプリットで作れる最大ハンド数（2 = 再スプリット不可）
  startChips:  10000,
  minBet:      500,
  maxBet:      10000,
  drillMode:   'normal', // 練習モード（Progress.DRILL_MODES）
  feedback:    'after',  // 'after' = ハンド終了後 / 'immediate' = アクションごと
  advanced:    false,    // 構成依存の例外も正解として扱う
};

// ── 状態 ──
let state = null;
// インシュランス / イーブンマネーの回答待ち
let awaitingInsurance = false;
// 設定パネルの値（次のセッション開始時に使う）。セッション中のゲーム・UIは state.settings を参照する
let settings = { ...DEFAULT_SETTINGS };
let sessionStats = newSessionStats();

function newSessionStats() {
  return { hands: 0, correct: 0, total: 0, evLossYen: 0, evLossUnits: 0 };
}

// ── DOM 参照 ──
const $ = id => document.getElementById(id);

// ── 初期化 ──
document.addEventListener('DOMContentLoaded', () => {
  applySettingsToUI();
  bindSettingsEvents();
  bindActionButtons();
  bindOtherButtons();
  showPhase('start');
  updateSessionStats();
});

function applySettingsToUI() {
  $('set-decks').value       = settings.numDecks;
  $('set-dealer').value      = settings.h17 ? 'h17' : 's17';
  $('set-das').value         = settings.das ? 'yes' : 'no';
  $('set-surrender').value   = settings.surrender ? 'yes' : 'no';
  $('set-resplit').value     = String(settings.maxHands);
  $('set-drill').value       = settings.drillMode;
  $('set-feedback').value    = settings.feedback;
  $('set-advanced').value    = settings.advanced ? 'yes' : 'no';
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

  $('progress-toggle').addEventListener('click', () => {
    const sec = $('progress-section');
    const open = sec.style.display === 'none';
    sec.style.display = open ? 'block' : 'none';
    if (open) renderProgress();
  });
  $('btn-reset-progress').addEventListener('click', () => {
    if (!confirm('現在のルールの弱点記録をリセットしますか？')) return;
    Progress.reset(currentSettings());
    renderProgress();
  });
}

/** 現在有効な設定（セッション中は state.settings、保留中の変更があればそれを優先） */
function currentSettings() {
  if (!state) return settings;
  return state.pendingSettings || state.settings;
}

function applySettings() {
  const newNumDecks  = parseInt($('set-decks').value);
  const newH17       = $('set-dealer').value === 'h17';
  const newDas       = $('set-das').value === 'yes';
  const newSurrender = $('set-surrender').value === 'yes';
  const newChips     = parseInt($('set-chips').value);
  const newMinBet    = parseInt($('set-min-bet').value);
  const newMaxBet    = parseInt($('set-max-bet').value);
  const newMaxHands  = parseInt($('set-resplit').value) === 2 ? 2 : 4;
  const newDrill     = $('set-drill').value;
  const newFeedback  = $('set-feedback').value === 'immediate' ? 'immediate' : 'after';
  const newAdvanced  = $('set-advanced').value === 'yes';

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
    maxHands:   newMaxHands,
    startChips: newChips,
    minBet:     newMinBet,
    maxBet:     newMaxBet,
    drillMode:  newDrill,
    feedback:   newFeedback,
    advanced:   newAdvanced,
  };

  if (state) {
    Game.updateSettings(state, settings);
    if (state.phase === Game.PHASE.BETTING) {
      updateBetInputRange();
      updateDrillIndicator();
    }
  }
  if ($('progress-section').style.display !== 'none') renderProgress();

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
  $('btn-insurance-take').addEventListener('click', () => onInsurance(true));
  $('btn-insurance-decline').addEventListener('click', () => onInsurance(false));
}

function bindOtherButtons() {
  $('btn-deal').addEventListener('click', onDeal);
  $('btn-next-hand').addEventListener('click', onNextHand);
  $('btn-end-session').addEventListener('click', onEndSession);
  $('btn-end-session-bet').addEventListener('click', onEndSession);
  $('btn-start').addEventListener('click', onStart);
}

// ── セッション開始 ──
function onStart() {
  state = Game.createGameState(settings);
  // デッキ初期化
  state.deck = Game.shuffleDeck(Game.createDeck(state.settings.numDecks));

  sessionStats = newSessionStats();
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

  const target = Progress.pickDrillTarget(state.settings.drillMode, state.settings);
  Game.startHand(state, betInput, target);
  clearHandMessage();
  clearLiveFeedback();
  renderTable();

  // ディーラーが A ならインシュランス / イーブンマネーの判断
  const offer = Game.insuranceOffer(state);
  if (offer) {
    showInsuranceOffer(offer);
    return;
  }
  continueAfterInsurance();
}

function showInsuranceOffer(offer) {
  $('insurance-title').textContent = offer.evenMoney ? 'イーブンマネー' : 'インシュランス';
  $('insurance-desc').textContent = offer.evenMoney
    ? 'ブラックジャックです。ディーラーのアップカードがAなので、イーブンマネー（ベットの1倍を確定で受け取る）を選べます。'
    : `ディーラーのアップカードはAです。インシュランス（¥${offer.amount.toLocaleString()}、ディーラーがBJなら2:1）を掛けますか？`;
  $('btn-insurance-take').textContent = offer.evenMoney ? '受ける' : '取る';
  awaitingInsurance = true;
  showPhase('insurance');
}

function onInsurance(take) {
  if (!state || state.phase !== Game.PHASE.PLAYER_TURN || !awaitingInsurance) return;
  awaitingInsurance = false;
  const record = Game.recordInsurance(state, take);
  if (record) logDecision(record);
  continueAfterInsurance();
}

/** インシュランスの判断後（または不要な場合）にハンドを進める */
function continueAfterInsurance() {
  const dealerInfo = Game.calcHand(state.dealerCards);
  const playerInfo = Game.calcHand(state.playerHands[0].cards);

  if (dealerInfo.isBlackjack || playerInfo.isBlackjack) {
    // BJ確定：アクションボタンを表示せずに精算へ
    handleBlackjack(dealerInfo.isBlackjack, playerInfo.isBlackjack);
    return;
  }

  renderTable();
  showPhase('player_turn');
  updateActionButtons();
}

function handleBlackjack(dealerBJ, playerBJ) {
  revealDealerCard();
  // BJ時はディーラーがヒットしないため playDealer 不要
  const { totalDelta, insuranceDelta } = Game.settle(state);
  sessionStats.hands++;
  if (state.actionHistory.length > 0) {
    CSV.updateLastHandResult(state.actionHistory, state.playerHands, state.insurance);
  }
  updateChipsDisplay();
  updateSessionStats();

  const evenMoney = state.insurance && state.insurance.taken && state.insurance.evenMoney;
  let msg = evenMoney ? '💰 イーブンマネーでベットの1倍を受け取りました。'
    : playerBJ && dealerBJ ? '⚖️ お互いブラックジャック！引き分けです。'
    : playerBJ ? '🎉 ブラックジャック！おめでとうございます！'
    : '⚠️ ディーラーがブラックジャックです。あなたの手番はありません。';
  if (insuranceDelta > 0) msg += `（インシュランス +¥${insuranceDelta.toLocaleString()}）`;

  renderTable(false);
  showHandMessage(msg, (playerBJ && !dealerBJ) || evenMoney ? 'good' : dealerBJ && !playerBJ ? 'bad' : 'neutral');
  showSettlementInfo(totalDelta);
  showPhase('settlement');
  showAnalysis();
  checkBankroll();
}

// ── プレイヤーアクション ──
function playerAction(action) {
  // フェーズガード：プレイヤーターン以外では無視
  if (!state || state.phase !== Game.PHASE.PLAYER_TURN || awaitingInsurance) return;

  const hand = Game.getCurrentHand(state);
  if (!hand) return;

  const record = Game.recordAction(state, action);
  logDecision(record);

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

/** 判断 1 回ぶんの記録（CSV・セッション統計・弱点マップ・即時フィードバック） */
function logDecision(record) {
  CSV.addRecord({
    handNumber:   state.handNumber,
    actionNumber: state.actionHistory.length,
    record,
    settings:     state.settings,
    drillMode:    state.settings.drillMode,
  });

  sessionStats.total++;
  if (record.isCorrect) sessionStats.correct++;
  sessionStats.evLossUnits += record.evLoss;
  sessionStats.evLossYen += record.evLoss * record.bet;
  updateSessionStats();

  Progress.recordDecision(state.settings, record);
  if ($('progress-section').style.display !== 'none') renderProgress();

  if (state.settings.feedback === 'immediate') addLiveFeedback(record);
}

function proceedToDealer() {
  clearHandMessage();
  revealDealerCard();
  Game.playDealer(state);
  renderDealerCards();

  setTimeout(() => {
    const { totalDelta } = Game.settle(state);
    sessionStats.hands++;

    CSV.updateLastHandResult(state.actionHistory, state.playerHands, state.insurance);

    updateChipsDisplay();
    updateSessionStats();
    renderPlayerHands();
    showSettlementInfo(totalDelta);
    showAnalysis();
    showPhase('settlement');
    checkBankroll();
  }, 800);
}

/** チップが最小ベットに届かなければセッションを終了する */
function checkBankroll() {
  const minBet = currentSettings().minBet;
  $('btn-next-hand').disabled = state.chips < minBet;
  if (state.chips >= minBet) return;
  const sessionState = state;
  setTimeout(() => {
    if (state !== sessionState) return; // すでに終了済み
    alert(state.chips <= 0
      ? 'チップがなくなりました。セッションを終了します。'
      : `チップ（¥${state.chips.toLocaleString()}）が最小ベット（¥${minBet.toLocaleString()}）を下回りました。セッションを終了します。`);
    onEndSession();
  }, 1500);
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
  if (!state) return;
  if (CSV.getRecordCount() > 0) {
    CSV.downloadCSV();
  }
  state = null;
  awaitingInsurance = false;
  showPhase('start');
  $('analysis-section').style.display = 'none';
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
    const dealerCard = state.dealerUpCard.rank === 'A' ? 'A' : String(state.dealerUpCard.value);
    const handLabel = state.playerHands.length > 1 && record.kind === 'play' ? `ハンド${record.handIdx + 1} ` : '';
    header.innerHTML = `<span class="action-num">アクション ${a.actionNumber}</span>
      <span class="action-cards">${escapeHTML(a.cards)}</span>
      <span class="action-summary">${handLabel}${escapeHTML(a.handSummary)} vs ディーラー${dealerCard}</span>
      <span class="action-taken">→ ${escapeHTML(a.action)}</span>`;
    div.appendChild(header);

    for (const item of a.items) {
      const p = document.createElement('p');
      p.className = `analysis-item type-${item.type}`;
      if (item.type === 'result') {
        p.textContent = item.label;
        p.classList.add(...severityClass(item.severity).split(' '));
      } else {
        p.textContent = item.text;
      }
      div.appendChild(p);
    }

    if (record.kind === 'play') {
      div.insertAdjacentHTML('beforeend', buildStrategyTableHTML(record.row, state.settings));
    }
    container.appendChild(div);
  }

  $('analysis-section').style.display = 'block';
}

function severityClass(severity) {
  return severity === 'correct' ? 'correct' : severity === 'close' ? 'borderline' : severity === 'serious' ? 'incorrect serious' : 'incorrect';
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TABLE_TITLES = { hard: 'ハードハンド表', soft: 'ソフトハンド表', pair: 'ペア表' };

function tableTitle(type, s) {
  const parts = [TABLE_TITLES[type], `${s.numDecks}デッキ`, s.h17 ? 'H17' : 'S17'];
  if (type === 'pair') {
    parts.push(`DAS: ${s.das ? 'あり' : 'なし'}`);
    parts.push(Number(s.maxHands) === 2 ? '再スプリットなし' : '再スプリットあり');
  }
  return parts.join(' / ');
}

function saClass(raw) {
  switch ((raw || 'H')[0]) {
    case 'S': return 'sa-s';
    case 'D': return 'sa-d';
    case 'P': return 'sa-p';
    case 'R': return 'sa-r';
    default:  return 'sa-h';
  }
}

// ── ストラテジー表 HTML 生成 ──
/**
 * @param {object} row - 判断した局面 { type, key, dIdx }（ハイライト用）
 */
function buildStrategyTableHTML(row, settings) {
  const type = row.type;
  const rows = Strategy.getTableRows(type, settings);
  // ハード 18 以上は 17 の行（常にスタンド）、ソフト 12（スプリットできない A,A）はハイライトなし
  const hlKey = type === 'hard' ? Math.min(Math.max(row.key, 4), 17) : row.key;
  const dIdx = row.dIdx;

  const colHeaders = Strategy.DEALER_LABELS.map((h, i) =>
    `<th class="strat-dh${i === dIdx ? ' strat-hl-col' : ''}">${h}</th>`).join('');

  const bodyRows = rows.map(r => {
    const isHlRow = r.key === hlKey;
    const cells = r.values.map((v, i) => {
      const hl = isHlRow && i === dIdx;
      return `<td class="${saClass(v)}${hl ? ' strat-hl-cell' : ''}">${v}</td>`;
    }).join('');
    return `<tr><th class="strat-rh${isHlRow ? ' strat-hl-row' : ''}">${r.label}</th>${cells}</tr>`;
  }).join('');

  return `<div class="strat-table-wrap">
    <div class="strat-title">${tableTitle(type, settings)}</div>
    <div class="strat-legend">
      <span class="sa-h">H=ヒット</span><span class="sa-s">S=スタンド</span>
      <span class="sa-d">D/Ds=ダブル</span><span class="sa-p">P=スプリット</span>
      <span class="sa-r">R/Rs/Rp=サレンダー</span>
    </div>
    <div class="strat-scroll">
      <table class="strat-table">
        <thead><tr><th class="strat-corner">手 \\ D</th>${colHeaders}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  </div>`;
}

// ── 弱点マップ ──
function cellLabel(key) {
  const [type, k, d] = key.split(':');
  if (type === 'insurance') return k === 'even' ? 'イーブンマネー' : 'インシュランス';
  const dl = Strategy.DEALER_LABELS[Number(d)];
  const n = Number(k);
  const hand = type === 'pair' ? (n === 1 ? 'A,A' : n === 10 ? 'T,T' : `${n},${n}`)
    : type === 'soft' ? `ソフト${n}（A,${n - 11}）` : `ハード${n}`;
  return `${hand} vs ${dl}`;
}

function heatClass(stat) {
  if (!stat || stat.n === 0) return 'heat-none';
  const acc = stat.correct / stat.n;
  if (acc >= 0.9) return 'heat-good';
  if (acc >= 0.6) return 'heat-mid';
  return 'heat-bad';
}

function renderProgress() {
  const s = currentSettings();
  const cells = Progress.getCells(s);
  const container = $('progress-content');

  const totals = Object.values(cells).reduce((acc, c) => {
    acc.n += c.n; acc.correct += c.correct; acc.evLoss += c.evLoss; return acc;
  }, { n: 0, correct: 0, evLoss: 0 });

  let html = `<p class="progress-summary">ルール: ${s.numDecks}デッキ / ${s.h17 ? 'H17' : 'S17'} / DAS${s.das ? 'あり' : 'なし'} / サレンダー${s.surrender ? 'あり' : 'なし'} / 再スプリット${Number(s.maxHands) === 2 ? 'なし' : 'あり'}<br>` +
    (totals.n > 0
      ? `累計 ${totals.n}判断・正解率 ${Math.round(totals.correct / totals.n * 100)}%・平均EV損失 ${(totals.evLoss / totals.n * 100).toFixed(2)}%/判断`
      : 'まだ記録がありません。プレイするとマスごとの正解率がここに表示されます。') +
    '</p>';

  const weak = Progress.weakest(s, 5);
  if (weak.length > 0) {
    html += '<div class="weak-list"><strong>苦手なマス（EV損失の大きい順）</strong><ol>' +
      weak.map(w => `<li>${cellLabel(w.key)}：${w.correct}/${w.n}回正解・損失合計 ${(w.evLoss * 100).toFixed(1)}%</li>`).join('') +
      '</ol></div>';
  }

  const ins = ['ins', 'even'].map(k => ({ k, c: cells[`insurance:${k}`] })).filter(x => x.c);
  if (ins.length > 0) {
    html += '<p class="progress-summary">' + ins.map(({ k, c }) =>
      `${k === 'even' ? 'イーブンマネー' : 'インシュランス'}: ${c.correct}/${c.n}回正解`).join(' / ') + '</p>';
  }

  html += '<div class="heat-legend"><span class="heat-good">90%以上</span><span class="heat-mid">60〜89%</span><span class="heat-bad">60%未満</span><span class="heat-none">未経験</span>（文字は正解のアクション）</div>';

  for (const type of ['hard', 'soft', 'pair']) {
    const rows = Strategy.getTableRows(type, s);
    const head = Strategy.DEALER_LABELS.map(h => `<th class="strat-dh">${h}</th>`).join('');
    const body = rows.map(r => {
      const tds = r.values.map((v, dIdx) => {
        const stat = cells[`${type}:${r.key}:${dIdx}`];
        const title = stat ? `${stat.correct}/${stat.n}回正解・EV損失合計 ${(stat.evLoss * 100).toFixed(1)}%` : '未経験';
        return `<td class="${heatClass(stat)}" title="${title}">${v}${stat ? `<small>${stat.correct}/${stat.n}</small>` : ''}</td>`;
      }).join('');
      return `<tr><th class="strat-rh">${r.label}</th>${tds}</tr>`;
    }).join('');
    html += `<div class="strat-table-wrap"><div class="strat-title">${tableTitle(type, s)}</div>
      <div class="strat-scroll"><table class="strat-table heat-table"><thead><tr><th class="strat-corner">手 \\ D</th>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  if (s.advanced) {
    const ex = Strategy.getAdvancedExceptions(s);
    if (ex.length > 0) {
      html += '<div class="weak-list"><strong>上級: このルールの構成依存の例外</strong><ul>' + ex.map(e => {
        const dl = Strategy.DEALER_LABELS[e.dIdx];
        if (e.kind === 'multi') {
          return `<li>3枚以上の${e.type === 'soft' ? 'ソフト' : 'ハード'}${e.key} vs ${dl}：${Strategy.actionLabel(e.action)}</li>`;
        }
        const cardsLabel = e.cards.map(v => (v === 10 ? 'T' : v)).join('+');
        return `<li>${cardsLabel} vs ${dl}：${Strategy.actionLabel(e.raw)}（表では ${Strategy.actionLabel(e.tableRaw)}）</li>`;
      }).join('') + '</ul></div>';
    }
  }

  container.innerHTML = html;
}

// ── レンダリング関数 ──

function renderTable(hideHole = true) {
  renderDealerCards(hideHole); // ホールカード隠す
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
  const avg = sessionStats.total > 0 ? sessionStats.evLossUnits / sessionStats.total * 100 : 0;
  $('stat-ev-loss').textContent = `¥${Math.round(sessionStats.evLossYen).toLocaleString()}（平均${avg.toFixed(2)}%/判断）`;
}

// ── フェーズ切り替え ──
function showPhase(phase) {
  // 表示/非表示を切り替えるパネル（dealer_turnはパネルなし = 全パネル非表示）
  const panels = ['start', 'betting', 'insurance', 'player_turn', 'settlement'];
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
    clearLiveFeedback();
    updateDrillIndicator();
  }
}

function updateDrillIndicator() {
  const mode = currentSettings().drillMode || 'normal';
  const el = $('drill-indicator');
  el.textContent = mode === 'normal' ? '' : `🎯 練習モード: ${Progress.DRILL_MODES[mode]}（ディーラーBJなしで出題）`;
}

// ── 即時フィードバック ──
function addLiveFeedback(record) {
  const el = $('live-feedback');
  const p = document.createElement('p');
  p.className = `analysis-item ${severityClass(record.severity)}`;
  p.textContent = Analysis.quickFeedback(record);
  el.appendChild(p);
  el.style.display = 'block';
}

function clearLiveFeedback() {
  const el = $('live-feedback');
  if (el) { el.innerHTML = ''; el.style.display = 'none'; }
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
