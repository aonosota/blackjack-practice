'use strict';

/**
 * csv.js
 * セッション記録のCSV管理とダウンロード
 */

const CSV_HEADERS = [
  '日時',             // 0
  'ハンド番号',       // 1
  'アクション番号',   // 2
  'ディーラーオープンカード', // 3
  'プレイヤーのカード',       // 4
  'プレイヤー合計',   // 5
  'ハンド種別',       // 6
  '取ったアクション', // 7
  '推奨アクション（表記）',     // 8
  '推奨アクション（実行可能）', // 9
  '評価',             // 10
  'デッキ数',         // 11
  'ディーラールール', // 12
  'DAS',              // 13
  'サレンダー',       // 14
  'ベット額',         // 15
  'ハンド結果',       // 16
  '収支',             // 17
  'EV損失（ベット比%）', // 18
  'EV損失（円）',     // 19
  '再スプリット',     // 20
  '練習モード',       // 21
];

const COL_RESULT = 16;
const COL_DELTA  = 17;

let sessionRecords = [];
let sessionStartTime = null;

function formatTimestamp(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatDateCompact(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function initSession() {
  sessionRecords = [];
  sessionStartTime = new Date();
}

/**
 * アクションを記録する
 * @param {object} params - { handNumber, actionNumber, record, settings, drillMode }
 *   record: state.actionHistory の 1 要素（Game.recordAction / recordInsurance の戻り値）
 */
function addRecord(params) {
  const { handNumber, actionNumber, record, settings, drillMode = 'normal' } = params;
  const { dealerUpCard, cards, handInfo, action, recommended, isCorrect, severity, evLoss = 0, bet } = record;

  const timestamp = formatTimestamp(new Date());

  const evalLabel = isCorrect ? '正解' : severity === 'close' ? '惜しい(境界)' : severity === 'serious' ? '重大なミス' : '不正解';
  let handTypeLabel;
  if (record.kind === 'insurance') handTypeLabel = record.evenMoney ? 'イーブンマネー' : 'インシュランス';
  else if (record.row && record.row.type === 'pair') handTypeLabel = 'ペア';
  else handTypeLabel = handInfo.isSoft ? 'ソフト' : 'ハード';

  const dealerLabel = dealerUpCard.rank === 'A' ? 'A' : String(dealerUpCard.value);
  const cardsLabel = cards.map(c => c.rank + c.suit).join(' ');
  const handSummary = Game.handSummary(handInfo);
  const drillLabel = (window.Progress && Progress.DRILL_MODES[drillMode]) || drillMode;

  sessionRecords.push([
    timestamp,
    handNumber,
    actionNumber,
    dealerLabel,
    cardsLabel,
    handSummary,
    handTypeLabel,
    Strategy.actionLabel(action),
    recommended.raw,
    Strategy.actionLabel(recommended.resolved),
    evalLabel,
    `${settings.numDecks}デッキ`,
    settings.h17 ? 'H17' : 'S17',
    settings.das ? 'あり' : 'なし',
    settings.surrender ? 'あり' : 'なし',
    bet || '-',
    '-',
    '-',
    (evLoss * 100).toFixed(2),
    Math.round(evLoss * (bet || 0)),
    Number(settings.maxHands) === 2 ? 'なし' : '4ハンドまで',
    drillLabel,
  ]);
}

/**
 * settle後にアクション履歴ごとの正しいハンド結果をCSV行へ書き込む
 * @param {Array} actionHistory - state.actionHistory
 * @param {Array} playerHands   - state.playerHands（settle後に result/delta が設定済み）
 * @param {object|null} insurance - state.insurance（インシュランスの結果を併記する）
 */
function updateLastHandResult(actionHistory, playerHands, insurance = null) {
  const len = sessionRecords.length;
  const numActions = actionHistory.length;
  for (let i = 0; i < numActions && i < len; i++) {
    const actionIdx = numActions - 1 - i;
    const row = sessionRecords[len - 1 - i];
    const action = actionHistory[actionIdx];
    if (!row || !action) continue;
    const hand = playerHands[action.handIdx];
    if (!hand) continue;
    let resultLabel = getResultLabel(hand.result);
    let delta = hand.delta;
    if (action.kind === 'insurance' && insurance && insurance.taken && !insurance.evenMoney) {
      const d = insurance.delta || 0;
      resultLabel += `（保険${d >= 0 ? '+' : ''}${d}）`;
      delta += d;
    }
    row[COL_RESULT] = resultLabel;
    row[COL_DELTA]  = delta >= 0 ? `+${delta}` : String(delta);
  }
}

function getResultLabel(result) {
  const map = {
    win: '勝ち',
    lose: '負け',
    push: '引き分け',
    blackjack: 'BJ勝ち',
    surrender: 'サレンダー',
    even_money: 'イーブンマネー',
  };
  return map[result] || result;
}

/**
 * CSVテキストを生成する
 */
function generateCSV() {
  const rows = [CSV_HEADERS, ...sessionRecords];
  return rows.map(row => row.map(cell => {
    const str = String(cell);
    // カンマ・改行・ダブルクォートを含む場合はクォート
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }).join(',')).join('\r\n');
}

/**
 * CSVファイルをダウンロードする
 */
function downloadCSV() {
  if (sessionRecords.length === 0) {
    alert('記録がありません。');
    return;
  }

  const csv = generateCSV();
  // BOM付きUTF-8（Excelで文字化けしないように）
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const filename = `blackjack_practice_${formatDateCompact(now)}.csv`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getRecordCount() {
  return sessionRecords.length;
}

// ── グローバル公開 ──
window.CSV = {
  initSession,
  addRecord,
  updateLastHandResult,
  generateCSV,
  downloadCSV,
  getRecordCount,
};
