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
 * @param {object} params
 */
function addRecord(params) {
  const {
    handNumber,
    actionNumber,
    dealerUpCard,
    playerCards,
    handInfo,
    action,
    recommended,
    isCorrect,
    isBorderline,
    settings,
    handResult = null,
    delta = null,
  } = params;

  const now = new Date();
  const timestamp = formatTimestamp(now);

  const evalLabel = isCorrect ? '正解' : (isBorderline ? '惜しい(境界)' : '不正解');
  const handTypeLabel = handInfo.isPair && handInfo.cardCount === 2
    ? 'ペア'
    : handInfo.isSoft ? 'ソフト' : 'ハード';

  const dealerLabel = dealerUpCard.rank === 'A' ? 'A' : String(dealerUpCard.value);
  const cardsLabel = playerCards.map(c => c.rank + c.suit).join(' ');
  const handSummary = Game.handSummary(handInfo);

  const resultLabel = handResult ? getResultLabel(handResult) : '-';
  const deltaLabel = delta !== null ? (delta >= 0 ? `+${delta}` : String(delta)) : '-';

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
    settings.betAmount || '-',
    resultLabel,
    deltaLabel,
  ]);
}

/**
 * settle後にアクション履歴ごとの正しいハンド結果をCSV行へ書き込む
 * @param {Array} actionHistory - state.actionHistory
 * @param {Array} playerHands   - state.playerHands（settle後に result/delta が設定済み）
 */
function updateLastHandResult(actionHistory, playerHands) {
  const len = sessionRecords.length;
  const numActions = actionHistory.length;
  for (let i = 0; i < numActions && i < len; i++) {
    const actionIdx = numActions - 1 - i;
    const row = sessionRecords[len - 1 - i];
    const action = actionHistory[actionIdx];
    if (!row || !action) continue;
    const hand = playerHands[action.handIdx];
    if (!hand) continue;
    row[COL_RESULT] = getResultLabel(hand.result);
    row[COL_DELTA]  = hand.delta >= 0 ? `+${hand.delta}` : String(hand.delta);
  }
}

function getResultLabel(result) {
  const map = {
    win: '勝ち',
    lose: '負け',
    push: '引き分け',
    blackjack: 'BJ勝ち',
    surrender: 'サレンダー',
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
