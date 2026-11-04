'use strict';

/**
 * analysis.js
 * ハンド後の多角的分析を生成する（EV ベース）
 */

const SEVERITY_LABELS = {
  correct:  '✅ 正解',
  close:    '△ 惜しい（境界ケース・EV差わずか）',
  moderate: '❌ 不正解',
  serious:  '❌ 重大なミス',
};

const EV_ORDER = ['H', 'S', 'D', 'P', 'R', 'I', 'E', 'N'];
const SHORT_LABELS = { H: 'ヒット', S: 'スタンド', D: 'ダブル', P: 'スプリット', R: 'サレンダー', I: '取る', E: '受ける', N: '断る' };

function pct(x, digits = 1) {
  const v = (x * 100).toFixed(digits);
  return (x > 0 ? '+' : '') + v + '%';
}

function yen(n) {
  return `¥${Math.round(n).toLocaleString()}`;
}

/** 分析に使うハンド情報（スプリットできないペアはペアとして扱わない） */
function effectiveHandInfo(record) {
  const isPairRow = record.row && record.row.type === 'pair';
  return { ...record.handInfo, isPair: isPairRow };
}

/** 判定に使ったのと同じ条件（実際のダブル/スプリット可否を含む） */
function decisionOptions(record, settings) {
  return { ...settings, ...record.options, cards: record.cards };
}

// ── EV 比較 ──
function evSummary(record) {
  const parts = EV_ORDER.filter(k => record.ev[k] !== undefined).map(k => {
    const mark = k === record.recommended.resolved ? '★' : (k === record.action ? '←あなた' : '');
    return `${SHORT_LABELS[k]} ${pct(record.ev[k])}${mark}`;
  });
  return `📈 EV（ベット1単位あたりの期待収支）: ${parts.join(' / ')}`;
}

// ── ルール変更による影響 ──
function getRuleVariationNotes(record, settings) {
  const notes = [];
  const handInfo = effectiveHandInfo(record);
  const dv = record.dealerUpCard.value;
  const opts = decisionOptions(record, settings);
  const current = Strategy.getStrategyAction(handInfo, dv, opts).resolved;

  // S17 / H17
  const altH17 = Strategy.getStrategyAction(handInfo, dv, { ...opts, h17: !settings.h17 }).resolved;
  if (altH17 !== current) {
    const altRule = settings.h17 ? 'S17' : 'H17';
    notes.push(`📋 ルール変更の影響: ${altRule}ルールでは「${Strategy.actionLabel(altH17)}」が推奨になります（現在: ${settings.h17 ? 'H17' : 'S17'}）。`);
  }

  // DAS（ペアの場合）
  if (handInfo.isPair) {
    const altDas = Strategy.getStrategyAction(handInfo, dv, { ...opts, das: !settings.das }).resolved;
    if (altDas !== current) {
      notes.push(`📋 DAS（スプリット後のダブル）${settings.das ? 'なし' : 'あり'}のルールでは「${Strategy.actionLabel(altDas)}」になります。`);
    }
  }

  // サレンダー（実際にサレンダーできる局面のみ）
  if (!settings.surrender && handInfo.cardCount === 2 && !opts.isSplit) {
    const altSurr = Strategy.getStrategyAction(handInfo, dv, { ...opts, surrender: true }).resolved;
    if (altSurr === 'R') notes.push('📋 サレンダーが使えるルールなら「サレンダー」が推奨です（現在のルールではサレンダー不可）。');
  }

  // デッキ数（6デッキとの違い）
  const altDecks = Number(settings.numDecks) === 6 ? 1 : 6;
  const altDeck = Strategy.getStrategyAction(handInfo, dv, { ...opts, numDecks: altDecks }).resolved;
  if (altDeck !== current) {
    notes.push(`📋 デッキ数の影響: ${altDecks}デッキでは「${Strategy.actionLabel(altDeck)}」が推奨です（現在: ${settings.numDecks}デッキ）。`);
  }

  return notes;
}

// ── アクションの戦略的理由 ──
function getStrategyReason(handInfo, dealerValue, recommended) {
  const { total, isSoft, isPair, pairValue } = handInfo;
  const rec = recommended.resolved;
  const raw = recommended.raw;
  const up = Strategy.dealerLabel(dealerValue);
  const weakDealer = dealerValue >= 2 && dealerValue <= 6;

  if (isPair) {
    if (pairValue === 1) return 'A,Aは常にスプリット。Aを2枚持つことで強いハンドを2つ作るチャンスです。';
    if (pairValue === 8) {
      if (rec === 'R') return '8,8 vs Aはサレンダーが最善（H17ルール）。スプリットしても損失が大きい局面です。';
      return '8,8は常にスプリット。16はブラックジャック最弱のハンドであり、8,8スプリットで2つのましなハンドに変えます。';
    }
    if (pairValue === 10) return 'T,Tはスプリットしません。20は非常に強いハンドで崩すリスクは取りません。';
    if (pairValue === 5) return '5,5はスプリットしません。ハード10として扱い、ダブルダウンの対象になります。';
    if (pairValue === 9) {
      if (rec === 'S') return `9,9 vs ${up}はスタンド。18で十分勝負になる（またはスプリットしても不利な）局面です。`;
      return `9,9 vs ${up}はスプリット。18のままより、9から始まる2つのハンドの方が期待値が高くなります。`;
    }
    if (rec === 'P') {
      return `${pairValue},${pairValue} vs ${up}はスプリット。${weakDealer ? 'ディーラーが弱いカードのときはベットを2倍にして勝負する価値があります。' : 'そのまま打つより2つのハンドに分けた方が損失が小さくなります。'}`;
    }
    if (rec === 'R') return `${pairValue},${pairValue} vs ${up}はサレンダー推奨。どう打っても損失がベットの50%を超えます。`;
    return `${pairValue},${pairValue} vs ${up}はスプリットせず、合計${total}のハンドとして扱います。`;
  }

  if (isSoft) {
    if (raw === 'Ds') return `ソフト${total} vs ${up}はダブルダウン推奨（できなければスタンド）。Aがあるため一枚引いても損しにくい状況です。`;
    if (raw === 'D') return `ソフト${total} vs ${up}はダブルダウン推奨。ディーラーが弱い場合にAを活かして積極的に。`;
    if (rec === 'S' && total === 18) return `ソフト18（A,7）vs ${up}はスタンド。すでに良いハンドのため、そのまま勝負します。`;
    if (rec === 'S') return `ソフト${total}はスタンド。十分に強いハンドです。`;
    if (rec === 'H') return `ソフト${total} vs ${up}はヒット推奨。Aが残っている限りバーストしないので、積極的に引けます。`;
    return `ソフト${total}：Aを活かした判断が必要な局面です。`;
  }

  if (rec === 'R') {
    return `ハード${total} vs ${up}はサレンダー推奨。期待損失がベットの50%を超えるため、半額回収が最善です。`;
  }
  if (rec === 'D') {
    if (total === 11) return `ハード11 vs ${up}はダブルダウン。次の1枚で20または21になる確率が高く、ベットを倍にする価値があります。`;
    if (total === 10) return `ハード10 vs ${up}はダブルダウン推奨。次の1枚で強いハンドになる可能性が高い局面です。`;
    return `ハード${total} vs ${up}はダブルダウン推奨。ディーラーが弱いカードを持つ局面でベットを増やします。`;
  }
  if (rec === 'S') {
    if (total >= 17) return `ハード${total}はスタンド。これ以上引くとバーストのリスクが高く、ディーラーの結果を待ちます。`;
    if (weakDealer) return `ハード${total} vs ${up}はスタンド。ディーラーが弱いカード（2-6）を持つ場合、バースト待ちが有利です。`;
    return `ハード${total} vs ${up}はスタンドが有利です。`;
  }
  if (rec === 'H') {
    if (total <= 11) return `ハード${total}はヒット。バーストのリスクなく引けます。`;
    return `ハード${total} vs ${up}はヒット推奨。ディーラーが強いカードを持つ場合、バーストリスクを取ってでも手を改善します。`;
  }
  return '基本戦略に従った判断です。';
}

// ── よくある間違いの指摘 ──
function getCommonMistakeNote(handInfo, wrongAction, correctAction) {
  const { total, isSoft, isPair, pairValue } = handInfo;

  if (isPair) {
    if (pairValue === 10 && wrongAction === 'P') {
      return '⚠️ よくある間違い: T,Tをスプリットしたくなりますが、20は非常に強く崩すべきではありません。';
    }
    if (pairValue === 8 && correctAction === 'P' && wrongAction !== 'P') {
      return '⚠️ よくある間違い: 8,8は「16を2つに分けるだけ」と思われがちですが、ディーラーの強いカードに対してもスプリットが正解です。';
    }
    if (pairValue === 5 && wrongAction === 'P') {
      return '⚠️ よくある間違い: 5,5はハード10として扱います。スプリットしないでください。';
    }
  }

  if (!isSoft && total === 16 && correctAction === 'H' && wrongAction === 'S') {
    return '⚠️ よくある間違い: ハード16はバーストを恐れてスタンドしたくなりますが、ディーラーが強いカードを持つ場合はヒットが正解です。';
  }
  if (!isSoft && total >= 12 && total <= 16 && correctAction === 'H' && wrongAction === 'S') {
    return '⚠️ よくある間違い: 「バーストが怖い」という心理が働きますが、ディーラーが強いカードの場合は積極的なヒットが必要です。';
  }
  if (isSoft && total === 18 && wrongAction === 'H' && correctAction !== 'H') {
    return '⚠️ よくある間違い: ソフト18（A,7）でヒットすると手が悪化するリスクがあります。';
  }
  if (correctAction === 'D' && wrongAction === 'H') {
    return '⚠️ よくある間違い: ダブルダウンのチャンスを逃しています。有利な局面でベットを増やすことが長期的な利益につながります。';
  }
  return null;
}

// ── 上級モード（構成依存）の注記 ──
function getAdvancedNote(record, settings) {
  if (record.source === 'table') return null;
  const handInfo = effectiveHandInfo(record);
  const dv = record.dealerUpCard.value;
  const base = Strategy.getStrategyAction(handInfo, dv, { ...decisionOptions(record, settings), advanced: false });
  if (base.resolved === record.recommended.resolved) return null;
  const hand = Game.handSummary(handInfo);
  if (record.source === 'multi') {
    return `🧠 構成依存（上級）: 3枚以上で作った${hand}は、2枚のときの表（${Strategy.actionLabel(base.resolved)}）と違い「${Strategy.actionLabel(record.recommended.resolved)}」が有利です。小さいカードを引いた分、山に10が多く残るためです。`;
  }
  const vals = record.cards.map(c => (c.value === 10 ? 'T' : c.value)).join('+');
  return `🧠 構成依存（上級）: ${vals}という組み合わせでは、合計ベースの表（${Strategy.actionLabel(base.resolved)}）と違い「${Strategy.actionLabel(record.recommended.resolved)}」が有利です。`;
}

// ── インシュランスの分析 ──
function analyzeInsurance(record) {
  const items = [];
  items.push({ type: 'result', label: SEVERITY_LABELS[record.severity], severity: record.severity, isCorrect: record.isCorrect, isBorderline: record.isBorderline });
  if (!record.isCorrect) {
    items.push({ type: 'correct_action', text: `正解: 「${Strategy.actionLabel(record.recommended.resolved)}」` });
  }
  const p = (record.p * 100).toFixed(1);
  if (record.evenMoney) {
    const decline = (1.5 * (1 - record.p) * 100).toFixed(1);
    items.push({ type: 'reason', text: `💡 理由: イーブンマネーは「ベットの1倍が確定」。断るとディーラーがBJでない${(100 - record.p * 100).toFixed(1)}%の場合に1.5倍もらえるので、期待値は${decline}% > 100%。カードカウンティングをしないなら常に断ります。` });
  } else {
    items.push({ type: 'reason', text: `💡 理由: ホールカードが10である確率は約${p}%。インシュランスは2:1配当なので33.3%を超えないと損な賭けです。ベーシックストラテジーでは常に断ります。` });
  }
  items.push({ type: 'ev', text: evSummary(record) });
  if (record.evLoss > 0) {
    items.push({ type: 'ev_loss', text: `💸 期待損失: ベットの${(record.evLoss * 100).toFixed(1)}%（約${yen(record.evLoss * record.bet)}）` });
  }
  return items;
}

/**
 * 1アクションの分析を生成する
 * @param {object} record - actionHistoryの1要素
 * @param {object} settings - ゲーム設定
 * @returns {object} 分析結果
 */
function analyzeAction(record, settings) {
  const base = {
    cards: record.cards.map(c => c.display).join(' '),
    action: Strategy.actionLabel(record.action),
    recommended: Strategy.actionLabel(record.recommended.resolved),
    isCorrect: record.isCorrect,
    isBorderline: record.isBorderline,
    severity: record.severity,
    kind: record.kind,
  };

  if (record.kind === 'insurance') {
    return { ...base, handSummary: record.evenMoney ? 'イーブンマネー' : 'インシュランス', items: analyzeInsurance(record) };
  }

  const { action, recommended, isCorrect, dealerUpCard } = record;
  const handInfo = effectiveHandInfo(record);
  const dealerValue = dealerUpCard.value;
  const items = [];

  // 1. 正誤判定（EV 差による重さ付き）
  items.push({ type: 'result', label: SEVERITY_LABELS[record.severity], severity: record.severity, isCorrect, isBorderline: record.isBorderline });

  // 2. 推奨アクション
  if (!isCorrect) {
    items.push({ type: 'correct_action', text: `正解: 「${Strategy.actionLabel(recommended.resolved)}」（表記: ${recommended.raw}）` });
  }

  // 3. 戦略的理由
  items.push({ type: 'reason', text: `💡 理由: ${getStrategyReason(handInfo, dealerValue, recommended)}` });

  // 4. EV 比較と期待損失
  items.push({ type: 'ev', text: evSummary(record) });
  if (record.evLoss > 0) {
    items.push({ type: 'ev_loss', text: `💸 期待損失: ベットの${(record.evLoss * 100).toFixed(1)}%（約${yen(record.evLoss * record.bet)}）` });
  }

  // 5. 境界ケース（EV 差が小さい局面）
  if (record.severity === 'close') {
    items.push({ type: 'borderline', text: `⚖️ 境界ケース: 「${Strategy.actionLabel(recommended.resolved)}」と「${Strategy.actionLabel(action)}」のEV差は${(record.evLoss * 100).toFixed(2)}%しかありません。長期的には推奨の方が有利ですが、大きな損ではありません。` });
  } else if (isCorrect && record.runnerUp && record.runnerUp.gap < Strategy.BORDERLINE_THRESHOLD) {
    items.push({ type: 'borderline', text: `⚖️ 僅差の局面: 次点の「${Strategy.actionLabel(record.runnerUp.action)}」とのEV差は${(record.runnerUp.gap * 100).toFixed(2)}%。迷いやすいので覚えておきましょう。` });
  }

  // 6. 上級モードの構成依存
  const adv = getAdvancedNote(record, settings);
  if (adv) items.push({ type: 'advanced', text: adv });

  // 7. ルール変更の影響
  for (const n of getRuleVariationNotes(record, settings)) items.push({ type: 'rule_variation', text: n });

  // 8. よくある間違いの指摘
  if (!isCorrect) {
    const mistakeNote = getCommonMistakeNote(handInfo, action, recommended.resolved);
    if (mistakeNote) items.push({ type: 'mistake', text: mistakeNote });
  }

  return { ...base, handSummary: Game.handSummary(handInfo), items };
}

/** 即時フィードバック用の 1 行メッセージ */
function quickFeedback(record) {
  const label = SEVERITY_LABELS[record.severity];
  if (record.isCorrect) {
    const close = record.runnerUp && record.runnerUp.gap < Strategy.BORDERLINE_THRESHOLD
      ? `（次点「${Strategy.actionLabel(record.runnerUp.action)}」と僅差）` : '';
    return `${label}: ${Strategy.actionLabel(record.action)}${close}`;
  }
  return `${label}: あなた「${Strategy.actionLabel(record.action)}」→ 正解「${Strategy.actionLabel(record.recommended.resolved)}」` +
    `（EV差 ${(record.evLoss * 100).toFixed(1)}% ≒ ${yen(record.evLoss * record.bet)}）`;
}

/**
 * ハンド全体の分析サマリーを生成する
 * @param {Array} actionHistory - state.actionHistory
 * @param {object} settings - ゲーム設定
 * @returns {Array} 各アクションの分析
 */
function generateHandAnalysis(actionHistory, settings) {
  return actionHistory.map((record, idx) => ({
    actionNumber: idx + 1,
    ...analyzeAction(record, settings),
  }));
}

// ── グローバル公開 ──
window.Analysis = {
  SEVERITY_LABELS,
  analyzeAction,
  generateHandAnalysis,
  quickFeedback,
  getStrategyReason,
};
