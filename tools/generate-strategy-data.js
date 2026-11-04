'use strict';

/**
 * generate-strategy-data.js
 * 全ルール組み合わせの EV 表を計算し js/strategy-data.js を生成する。
 *
 *   node tools/generate-strategy-data.js
 *
 * 出力する EV（ベット 1 単位あたり ×100000 の整数）
 *   hard[合計][ディーラー]  = [S, H, D]   2枚のハード（ペア以外を確率で加重平均。4=2,2 / 20=T,T）
 *   soft[合計][ディーラー]  = [S, H, D]   2枚のソフト（12=A,A）
 *   pair[値][ディーラー]    = [S, H, D]   ペアをスプリットしない場合
 *   split[DAS/再スプリット][値][ディーラー] = P
 *   multi.hard / multi.soft[合計][ディーラー] = [S, H]  3枚のハンドの加重平均
 *   comp["r1-r2"][ディーラー] = [S, H, D]  合計ベースの表と判断が変わる 2 枚の組み合わせのみ
 */

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { Calculator, VAL, bestTotal } = require('./bj-calc.js');

const DECKS = [1, 2, 4, 6, 8];
const SCALE = 100000;
const DEALER_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]; // 表の列順: 2..9, T, A（ランク index）
const rankValue = r => VAL[r]; // A=1

function computeRuleSet(numDecks, h17) {
  const out = { hard: {}, soft: {}, pair: {}, split: {}, multi: { hard: {}, soft: {} }, compRaw: {} };
  const SPLIT_KEYS = { 'das1-rs4': [true, 4], 'das1-rs2': [true, 2], 'das0-rs4': [false, 4], 'das0-rs2': [false, 2] };
  for (const k of Object.keys(SPLIT_KEYS)) out.split[k] = {};

  DEALER_ORDER.forEach((up, col) => {
    const calc = new Calculator(numDecks, h17, up);
    const hardAcc = {};
    const put = (obj, key, val) => { (obj[key] = obj[key] || [])[col] = val; };

    // ハード（ペア以外の 2 枚の組み合わせを加重平均）
    for (let r1 = 1; r1 <= 9; r1++) {
      for (let r2 = r1 + 1; r2 <= 9; r2++) {
        const total = VAL[r1] + VAL[r2];
        const w = calc.seqProb([r1, r2]);
        const ev = calc.twoCardEVs(r1, r2);
        const acc = hardAcc[total] = hardAcc[total] || { w: 0, S: 0, H: 0, D: 0 };
        acc.w += w; acc.S += w * ev.S; acc.H += w * ev.H; acc.D += w * ev.D;
        (out.compRaw[`${VAL[r1]}-${VAL[r2]}`] = out.compRaw[`${VAL[r1]}-${VAL[r2]}`] || [])[col] = [ev.S, ev.H, ev.D];
      }
    }
    for (const [t, a] of Object.entries(hardAcc)) put(out.hard, t, [a.S / a.w, a.H / a.w, a.D / a.w]);

    // ペア（スプリットしない EV とスプリット EV）
    for (let r = 0; r <= 9; r++) {
      const ev = calc.twoCardEVs(r, r);
      put(out.pair, rankValue(r), [ev.S, ev.H, ev.D]);
      for (const [k, [das, maxHands]] of Object.entries(SPLIT_KEYS)) {
        put(out.split[k], rankValue(r), calc.splitEV(r, das, maxHands));
      }
    }
    put(out.hard, 4, out.pair[2][col]);
    put(out.hard, 20, out.pair[10][col]);

    // ソフト（A + x）。12 = A,A
    put(out.soft, 12, out.pair[1][col]);
    for (let r = 1; r <= 8; r++) {
      const ev = calc.twoCardEVs(0, r);
      put(out.soft, 11 + VAL[r], [ev.S, ev.H, ev.D]);
    }

    // 3枚のハンド: 2枚目までの合計で「ヒット」していた経路のみ加重平均
    const multiAcc = { hard: {}, soft: {} };
    for (let a = 0; a <= 9; a++) for (let b = 0; b <= 9; b++) for (let c = 0; c <= 9; c++) {
      const ranks = [a, b, c];
      const hard2 = VAL[a] + VAL[b];
      const soft2 = a === 0 || b === 0;
      const t2 = bestTotal(hard2, soft2);
      if (t2 === 21) continue; // BJ
      if (a === b) continue;   // ペアはスプリットの判断が絡むので除外
      // 2枚の時点で最善がヒットだった場合のみ 3 枚目に到達する
      const ev2 = calc.twoCardEVs(a, b);
      if (!(ev2.H > ev2.S && ev2.H > ev2.D && ev2.H > -0.5)) continue;
      const hard3 = hard2 + VAL[c];
      const soft3 = soft2 || c === 0;
      const t3 = bestTotal(hard3, soft3);
      const isSoft3 = soft3 && hard3 + 10 <= 21;
      const type = isSoft3 ? 'soft' : 'hard';
      if (type === 'hard' && (t3 < 12 || t3 > 16)) continue;
      if (type === 'soft' && (t3 < 13 || t3 > 20)) continue;
      const w = calc.seqProb(ranks);
      if (w === 0) continue;
      const ev = calc.multiCardEVs(ranks);
      const acc = multiAcc[type][t3] = multiAcc[type][t3] || { w: 0, S: 0, H: 0 };
      acc.w += w; acc.S += w * ev.S; acc.H += w * ev.H;
    }
    for (const type of ['hard', 'soft']) {
      for (const [t, a] of Object.entries(multiAcc[type])) put(out.multi[type], t, [a.S / a.w, a.H / a.w]);
    }
  });
  return out;
}

// ── 子プロセス: 1 デッキ数ぶんを計算して返す ──
if (process.argv[2] === '--child') {
  const numDecks = Number(process.argv[3]);
  const res = {};
  for (const h17 of [false, true]) res[h17 ? 'H17' : 'S17'] = computeRuleSet(numDecks, h17);
  process.send(res, () => process.exit(0));
  return;
}

// ── 親プロセス ──
function enc(x) {
  if (x === null || x === undefined) return null;
  if (Array.isArray(x)) return x.map(enc);
  if (typeof x === 'number') return Math.round(x * SCALE);
  const o = {};
  for (const [k, v] of Object.entries(x)) o[k] = enc(v);
  return o;
}

async function main() {
  const t0 = Date.now();
  const results = await Promise.all(DECKS.map(d => new Promise((resolve, reject) => {
    const child = fork(__filename, ['--child', String(d)]);
    child.on('message', m => resolve([d, m]));
    child.on('error', reject);
  })));

  // 合計ベースの表と判断が異なる組み合わせを抽出するため strategy.js の deriveRaw を使う
  global.window = global;
  require('../js/strategy.js');
  const { deriveRaw, resolveAction } = global.Strategy;

  const data = { scale: SCALE, rules: {} };
  for (const [d, byRule] of results) {
    for (const [rule, rs] of Object.entries(byRule)) {
      const comp = {};
      for (const [key, cols] of Object.entries(rs.compRaw)) {
        const [a, b] = key.split('-').map(Number);
        const total = a + b;
        const row = rs.hard[total];
        // 合計ベースの表に従った場合と比べ、構成どおりに打つと 0.2% 以上得をする局面があれば例外として採用
        let differs = false;
        cols.forEach((ev, col) => {
          const evC = { S: ev[0], H: ev[1], D: ev[2] };
          const evT = { S: row[col][0], H: row[col][1], D: row[col][2] };
          const rc = deriveRaw(evC), rt = deriveRaw(evT);
          if (rc === rt) return;
          for (const canD of [true, false]) for (const canR of [true, false]) {
            const val = code => (code === 'R' ? -0.5 : evC[code]);
            const gain = val(resolveAction(rc, canD, canR)) - val(resolveAction(rt, canD, canR));
            if (gain >= 0.002) differs = true;
          }
        });
        if (differs) comp[key] = cols;
      }
      delete rs.compRaw;
      rs.comp = comp;
      data.rules[`${d}D-${rule}`] = enc(rs);
    }
  }

  const header = `'use strict';\n\n` +
    `/**\n * strategy-data.js（自動生成ファイル・手で編集しない）\n` +
    ` * 生成: node tools/generate-strategy-data.js\n` +
    ` * 有限デッキの組み合わせ解析で求めた各アクションの EV（×${SCALE}）。\n */\n`;
  const body = `window.STRATEGY_DATA = ${JSON.stringify(data)};\n`;
  fs.writeFileSync(path.join(__dirname, '..', 'js', 'strategy-data.js'), header + body);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(body.length / 1024).toFixed(0)} KB`);
}

main().catch(e => { console.error(e); process.exit(1); });
