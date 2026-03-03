'use strict';

/**
 * csv.js
 * セッション記録のCSV管理とダウンロード
 */

const CSV_HEADERS = [
  '日時',
  'ハンド番号',
  'アクション番号',
  'ディーラーオープンカード',
  'プレイヤーのカード',
  'プレイヤー合計',
  'ハンド種別',
  '取ったアクション',
  '推奨アクション（表記）',
  '推奨アクション（実行可能）',
  '評価',
  'デッキ数',
  'ディーラールール',
  'DAS',
  'サレンダー',
  'ベット額',
  'ハンド結果',
  '収支',
];

let sessionRecords = [];
let sessionStartTime = null;

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
  const timestamp = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  const evalLabel = isCorrect ? '正解' : (isBorderline ? '惜しい(境界)' : '不正解');
  const handTypeLabel = handInfo.isPair && handInfo.cardCount === 2
    ? 'ペア'
    : handInfo.isSoft ? 'ソフト' : 'ハード';

  const dealerLabel = dealerUpCard.rank === 'A' ? 'A' : String(dealerUpCard.value);
  const cardsLabel = playerCards.map(c => c.rank + c.suit).join(' ');
  const handSummary = handInfo.isSoft
    ? `ソフト${handInfo.total}`
    : `ハード${handInfo.total}`;

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
 * ハンド結果ラベルの取得（CSV保存後に結果が確定した場合に更新）
 */
function updateLastHandResult(handResult, delta, numActions) {
  const len = sessionRecords.length;
  for (let i = 0; i < numActions && i < len; i++) {
    const row = sessionRecords[len - 1 - i];
    if (row) {
      row[16] = getResultLabel(handResult);
      row[17] = delta >= 0 ? `+${delta}` : String(delta);
    }
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
  const filename = `blackjack_practice_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.csv`;

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
