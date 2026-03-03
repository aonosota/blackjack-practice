'use strict';

/**
 * analysis.js
 * ハンド後の多角的分析を生成する
 */

// ── 境界ケースの詳細説明 ──
const BORDERLINE_NOTES = {
  // キー: `${total}_${isSoft ? 'S' : 'H'}_${dealerValue}`
  '12_H_2':  'ハード12 vs 2はヒットとスタンドのEV差が約0.2%しかありません。どちらでも大きな損はありませんが、基本戦略ではヒットです。',
  '12_H_3':  'ハード12 vs 3はヒットとスタンドのEV差が約0.1%と非常に僅差。実践では間違えやすい局面です。',
  '9_H_2':   'ハード9 vs 2はダブルとヒットのEV差が約0.1%。6デッキではヒットが推奨されます（少数デッキではダブルになることも）。',
  '16_H_8':  'ハード16 vs 8はスタンドとヒットのEV差が小さい境界ケース。スタンドとヒットのどちらを選んでも致命的ではありませんが、基本戦略ではヒットです。',
  '18_S_2':  'ソフト18 vs 2はダブルとスタンドがほぼ同じEV。スタンドが推奨されますが、ダブルを選んでも大きな誤りではありません。',
  '19_S_6':  'ソフト19(A,8) vs 6はスタンドとダブルが非常に近い。一部の上級者はダブルを選ぶこともあります。',
};

// ── ルール変更による影響を説明 ──
function getRuleVariationNote(handInfo, dealerValue, action, settings) {
  const notes = [];
  const { total, isSoft, isPair, pairValue } = handInfo;
  const dv = dealerValue;
  const { h17, das, surrender } = settings;

  // ── S17 vs H17 影響 ──
  const otherH17 = !h17;
  const altSettings = { ...settings, h17: otherH17 };
  const altRec = Strategy.getStrategyAction(handInfo, dealerValue, altSettings);

  if (altRec.resolved !== Strategy.getStrategyAction(handInfo, dealerValue, settings).resolved) {
    const ruleLabel = h17 ? 'S17（ディーラーはソフト17でスタンド）' : 'H17（ディーラーはソフト17でヒット）';
    const altRuleLabel = h17 ? 'H17' : 'S17';
    notes.push(
      `📋 ルール変更の影響: ${altRuleLabel}ルールでは「${Strategy.actionLabel(altRec.resolved)}」が推奨になります（現在: ${ruleLabel}）。`
    );
  }

  // ── DAS有無の影響（ペアの場合）──
  if (isPair) {
    const altDasSettings = { ...settings, das: !das };
    const altDasRec = Strategy.getStrategyAction(handInfo, dealerValue, altDasSettings);
    const currentRec = Strategy.getStrategyAction(handInfo, dealerValue, settings);
    if (altDasRec.resolved !== currentRec.resolved) {
      notes.push(
        `📋 DAS（スプリット後のダブル）${das ? 'なし' : 'あり'}のルールでは「${Strategy.actionLabel(altDasRec.resolved)}」になります。`
      );
    }
  }

  // ── サレンダー有無の影響 ──
  if (!surrender) {
    const altSurrSettings = { ...settings, surrender: true };
    const altSurrRec = Strategy.getStrategyAction(handInfo, dealerValue, altSurrSettings);
    if (altSurrRec.raw.startsWith('R')) {
      notes.push(
        `📋 サレンダーが使えるルールなら「サレンダー」が推奨です（現在のルールではサレンダー不可）。`
      );
    }
  }

  return notes;
}

// ── アクションの戦略的理由を生成 ──
function getStrategyReason(handInfo, dealerValue, recommended) {
  const { total, isSoft, isPair, pairValue } = handInfo;
  const rec = recommended.resolved;
  const raw = recommended.raw;

  // ペア
  if (isPair) {
    if (pairValue === 1) return 'A,Aは常にスプリット。Aを2枚持つことで強いハンドを2つ作るチャンスです。';
    if (pairValue === 8) return '8,8は常にスプリット。16はブラックジャック最弱のハンドであり、8,8スプリットで2つの強いハンドに変えます。';
    if (pairValue === 10) return 'T,Tはスプリットしません。20は非常に強いハンドで崩すリスクは取りません。';
    if (pairValue === 5) return '5,5は絶対にスプリットしません。ハード10として扱い、ダブルダウンの対象になります。';
    if (pairValue === 4) {
      if (rec === 'P') return '4,4をスプリットして8を2つ作るのは中程度の手。ダブルが使えるルール（DAS）でのみ有効です。';
      return '4,4は通常スプリットしません（DASなし）。ハード8として扱います。';
    }
    if (pairValue === 9) {
      if (rec === 'S') return '9,9 vs ' + (dealerValue === 10 ? 'T' : (dealerValue === 1 ? 'A' : dealerValue)) + 'はスタンド。ディーラーの弱いカードがないため、18をキープします。';
      return '9,9をスプリットして9を2つ。ディーラーが弱いカードを持つ場合に有効です。';
    }
  }

  // ソフトハンド
  if (isSoft) {
    if (raw === 'Ds') return `ソフト${total} vs ${dealerValue}はダブルダウン推奨（できなければスタンド）。Aがあるため一枚引いても損しにくい状況です。`;
    if (raw === 'D') return `ソフト${total} vs ${dealerValue}はダブルダウン推奨。ディーラーが弱い場合にAを活かして積極的に。`;
    if (rec === 'S' && total === 18) return 'ソフト18（A,7）はスタンドが基本。すでに良いハンドのため、ディーラーが中程度なら維持します。';
    if (rec === 'H') return `ソフト${total}はヒット推奨。Aが残っている限りバーストのリスクは低く、積極的に引けます。`;
    return `ソフト${total}：Aを活かした判断が必要な局面です。`;
  }

  // ハードハンド
  if (rec === 'R' || rec === 'Rs') {
    return `ハード${total} vs ${dealerValue === 1 ? 'A' : dealerValue}はサレンダー推奨。期待損失がベットの50%を超えるため、半額回収が最善です。`;
  }
  if (raw === 'D') {
    if (total === 11) return 'ハード11は最強のダブルダウン局面。次の1枚で20または21になる確率が高く、ベットを倍にする価値があります。';
    if (total === 10) return `ハード10 vs ${dealerValue === 1 ? 'A' : dealerValue}はダブルダウン推奨。次の1枚で強いハンドになる可能性が高い局面です。`;
    if (total === 9) return `ハード9 vs ${dealerValue}はダブルダウン推奨。ディーラーが弱いカードを持つ局面でベットを増やします。`;
  }
  if (rec === 'S') {
    if (total >= 17) return `ハード${total}はスタンド。これ以上引くとバーストのリスクが高く、ディーラーの結果を待ちます。`;
    if (total >= 12 && total <= 16) {
      const dealerLabel = dealerValue === 1 ? 'A' : dealerValue;
      if (dealerValue >= 2 && dealerValue <= 6) {
        return `ハード${total} vs ${dealerLabel}はスタンド。ディーラーが弱いカード（2-6）を持つ場合、バースト待ちが有利です。`;
      }
    }
  }
  if (rec === 'H') {
    if (total <= 11) return `ハード${total}はヒット。バーストのリスクなく（またはリスクが低く）引けます。`;
    const dealerLabel = dealerValue === 1 ? 'A' : dealerValue;
    return `ハード${total} vs ${dealerLabel}はヒット推奨。ディーラーが強いカードを持つ場合、バーストリスクを取ってでも手を改善します。`;
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
    if (pairValue === 8 && wrongAction !== 'P') {
      return '⚠️ よくある間違い: 8,8は「16を2つに分けるだけ」と思われがちですが、ディーラーの強いカードに対しても常にスプリットが正解です。';
    }
    if (pairValue === 5 && wrongAction === 'P') {
      return '⚠️ よくある間違い: 5,5はハード10として扱います。絶対にスプリットしないでください。';
    }
  }

  if (!isSoft && total === 16 && correctAction === 'H' && wrongAction === 'S') {
    return '⚠️ よくある間違い: ハード16はバーストを恐れてスタンドしたくなりますが、ディーラーが強いカードを持つ場合はヒットが正解です。';
  }
  if (!isSoft && total >= 12 && total <= 16 && correctAction === 'H' && wrongAction === 'S') {
    return '⚠️ よくある間違い: 「バーストが怖い」という心理が働きますが、ディーラーが強いカードの場合は積極的なヒットが必要です。';
  }
  if (isSoft && total === 18 && wrongAction === 'H') {
    return '⚠️ よくある間違い: ソフト18（A,7）でヒットすると手が悪化するリスクがあります。ディーラーの弱いカード以外ではスタンドが基本です。';
  }
  if (correctAction === 'D' && wrongAction === 'H') {
    return '⚠️ よくある間違い: ダブルダウンのチャンスを逃しています。有利な局面でベットを増やすことが長期的な利益につながります。';
  }

  return null;
}

/**
 * 1アクションの分析を生成する
 * @param {object} record - actionHistoryの1要素
 * @param {object} settings - ゲーム設定
 * @returns {object} 分析結果
 */
function analyzeAction(record, settings) {
  const { handInfo, action, recommended, isCorrect, isBorderline, dealerUpCard, cards } = record;
  const dealerValue = dealerUpCard.value;
  const items = [];

  // 1. 正誤判定
  const evalLabel = isCorrect ? '✅ 正解' : (isBorderline && action !== recommended.resolved ? '△ 惜しい（境界ケース）' : '❌ 不正解');
  items.push({ type: 'result', label: evalLabel, isCorrect, isBorderline });

  // 2. 推奨アクション
  if (!isCorrect) {
    items.push({
      type: 'correct_action',
      text: `正解: 「${Strategy.actionLabel(recommended.resolved)}」（表記: ${recommended.raw}）`,
    });
  }

  // 3. 戦略的理由
  const reason = getStrategyReason(handInfo, dealerValue, recommended);
  items.push({ type: 'reason', text: `💡 理由: ${reason}` });

  // 4. 境界ケースの注記
  if (isBorderline) {
    const key = `${handInfo.total}_${handInfo.isSoft ? 'S' : 'H'}_${dealerValue}`;
    const note = BORDERLINE_NOTES[key];
    if (note) {
      items.push({ type: 'borderline', text: `⚖️ 境界ケース: ${note}` });
    }
  }

  // 5. ルール変更の影響
  const ruleNotes = getRuleVariationNote(handInfo, dealerValue, action, settings);
  for (const n of ruleNotes) {
    items.push({ type: 'rule_variation', text: n });
  }

  // 6. よくある間違いの指摘
  if (!isCorrect) {
    const mistakeNote = getCommonMistakeNote(handInfo, action, recommended.resolved);
    if (mistakeNote) {
      items.push({ type: 'mistake', text: mistakeNote });
    }
  }

  return {
    cards: cards.map(c => c.display).join(' '),
    handSummary: handInfo.isSoft ? `ソフト${handInfo.total}` : `ハード${handInfo.total}`,
    action: Strategy.actionLabel(action),
    recommended: Strategy.actionLabel(recommended.resolved),
    isCorrect,
    isBorderline,
    items,
  };
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
  analyzeAction,
  generateHandAnalysis,
};
