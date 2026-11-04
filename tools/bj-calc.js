'use strict';

/**
 * bj-calc.js
 * 有限デッキのブラックジャック期待値（EV）計算エンジン（データ生成用・ブラウザでは使わない）
 *
 * 前提ルール（アプリのゲームロジックと同じ）
 *   - ディーラーはピーク済み（A/10 のときブラックジャックでないことが確定している）
 *   - 最初の2枚ならどんな合計でもダブル可
 *   - レイトサレンダー（EV = -0.5）
 *   - A スプリット後は1枚ずつ・再スプリット不可、スプリット後の A+10 は 21（BJ ではない）
 *
 * ランク index: 0=A, 1=2, ..., 8=9, 9=T(10/J/Q/K)
 * EV はすべて「最初のベット 1 単位あたり」
 */

const VAL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function freshShoe(numDecks) {
  const c = new Array(10).fill(4 * numDecks);
  c[9] = 16 * numDecks;
  return c;
}

function bestTotal(hard, soft) {
  return soft && hard + 10 <= 21 ? hard + 10 : hard;
}

/** ディーラー EV 計算機（ルールとアップカードごとに 1 インスタンス） */
class Calculator {
  constructor(numDecks, h17, upIdx) {
    this.numDecks = numDecks;
    this.h17 = h17;
    this.upIdx = upIdx;
    this.base = freshShoe(numDecks);
    this.base[upIdx]--;
    // ピーク後のホールカード除外ランク
    this.excluded = upIdx === 0 ? 9 : upIdx === 9 ? 0 : -1;
    this.dealerMemo = new Map();
    this.playerMemo = new Map();
  }

  /** counts からのディーラー最終分布 [17,18,19,20,21,bust] */
  dealerDist(counts) {
    const key = counts.join(',');
    const hit = this.dealerMemo.get(key);
    if (hit) return hit;
    const res = new Float64Array(6);
    const c = counts.slice();
    const h17 = this.h17;
    const ex = this.excluded;
    let n = 0;
    for (const x of c) n += x;
    const rec = (hard, soft, ncards, prob, n) => {
      const t = bestTotal(hard, soft);
      if (t > 21) { res[5] += prob; return; }
      if (t >= 17) {
        const soft17 = t === 17 && soft && hard + 10 === 17;
        if (!(h17 && soft17)) { res[t - 17] += prob; return; }
      }
      let denom = n;
      if (ncards === 1 && ex >= 0) denom -= c[ex];
      for (let r = 0; r < 10; r++) {
        if (c[r] === 0) continue;
        if (ncards === 1 && r === ex) continue;
        const p = c[r] / denom;
        c[r]--;
        rec(hard + VAL[r], soft || r === 0, ncards + 1, prob * p, n - 1);
        c[r]++;
      }
    };
    rec(VAL[this.upIdx], this.upIdx === 0, 1, 1, n);
    this.dealerMemo.set(key, res);
    return res;
  }

  /**
   * プレイヤーが次に引くカードの確率。
   * ピークで「ホールは 10（または A）ではない」と分かっているので、
   * ホールカードを期待値で（分数的に）取り除いた山から引くものとして近似する。
   */
  drawProbs(counts) {
    let n = 0;
    for (const x of counts) n += x;
    const p = new Float64Array(10);
    const ex = this.excluded;
    if (ex < 0) {
      for (let r = 0; r < 10; r++) p[r] = counts[r] / n;
      return p;
    }
    const nonEx = n - counts[ex];
    for (let r = 0; r < 10; r++) {
      p[r] = r === ex ? counts[r] / (n - 1) : counts[r] * (1 - 1 / nonEx) / (n - 1);
    }
    return p;
  }

  standEV(counts, hard, soft) {
    const pt = bestTotal(hard, soft);
    if (pt > 21) return -1;
    const d = this.dealerDist(counts);
    let ev = d[5];
    for (let t = 17; t <= 21; t++) {
      if (pt > t) ev += d[t - 17];
      else if (pt < t) ev -= d[t - 17];
    }
    return ev;
  }

  /** ヒット/スタンドのみ可能なハンドの最適 EV */
  optEV(counts, hard, soft) {
    const key = counts.join(',') + '|' + hard + (soft ? 's' : 'h');
    const m = this.playerMemo.get(key);
    if (m !== undefined) return m;
    const s = this.standEV(counts, hard, soft);
    const h = this.hitEV(counts, hard, soft);
    const v = Math.max(s, h);
    this.playerMemo.set(key, v);
    return v;
  }

  /** 1枚引いた後は最適にヒット/スタンドする場合の EV */
  hitEV(counts, hard, soft) {
    const p = this.drawProbs(counts);
    let ev = 0;
    for (let r = 0; r < 10; r++) {
      if (p[r] === 0) continue;
      counts[r]--;
      const nh = hard + VAL[r];
      const ns = soft || r === 0;
      const t = bestTotal(nh, ns);
      let v;
      if (t > 21) v = -1;
      else if (t === 21) v = this.standEV(counts, nh, ns); // 21 は自動スタンド
      else v = this.optEV(counts, nh, ns);
      counts[r]++;
      ev += p[r] * v;
    }
    return ev;
  }

  doubleEV(counts, hard, soft) {
    const p = this.drawProbs(counts);
    let ev = 0;
    for (let r = 0; r < 10; r++) {
      if (p[r] === 0) continue;
      counts[r]--;
      const nh = hard + VAL[r];
      const ns = soft || r === 0;
      ev += p[r] * (bestTotal(nh, ns) > 21 ? -1 : this.standEV(counts, nh, ns));
      counts[r]++;
    }
    return 2 * ev;
  }

  /** プレイヤーカード（ランク index 配列）を除いた山 */
  countsWithout(ranks) {
    const c = this.base.slice();
    for (const r of ranks) c[r]--;
    return c;
  }

  /** 2枚の手の S/H/D EV */
  twoCardEVs(r1, r2) {
    const c = this.countsWithout([r1, r2]);
    const hard = VAL[r1] + VAL[r2];
    const soft = r1 === 0 || r2 === 0;
    return {
      S: this.standEV(c, hard, soft),
      H: this.hitEV(c, hard, soft),
      D: this.doubleEV(c, hard, soft),
    };
  }

  /**
   * ペア r のスプリット EV
   * @param {boolean} das - スプリット後のダブル可
   * @param {number} maxHands - 最大ハンド数（2=再スプリット不可, 4=4ハンドまで）
   */
  splitEV(r, das, maxHands) {
    const c = this.countsWithout([r, r]);
    const p = this.drawProbs(c);
    const hard0 = VAL[r];
    const soft0 = r === 0;
    // 2枚目を引いた後の 1 ハンドの価値
    const handValue = (r2) => {
      c[r2]--;
      const hard = hard0 + VAL[r2];
      const soft = soft0 || r2 === 0;
      let v;
      if (r === 0) {
        v = this.standEV(c, hard, soft); // A スプリットは 1 枚のみ
      } else if (bestTotal(hard, soft) === 21) {
        v = this.standEV(c, hard, soft);
      } else {
        v = Math.max(this.standEV(c, hard, soft), this.hitEV(c, hard, soft));
        if (das) v = Math.max(v, this.doubleEV(c, hard, soft));
      }
      c[r2]++;
      return v;
    };
    const q = p[r];
    let eNon = 0;
    for (let r2 = 0; r2 < 10; r2++) {
      if (r2 === r || p[r2] === 0) continue;
      eNon += p[r2] * handValue(r2);
    }
    eNon = q < 1 ? eNon / (1 - q) : 0;
    const ePair = q > 0 ? handValue(r) : 0; // 同じカードが来たがスプリットできない場合
    const canResplit = r !== 0 && maxHands > 2;
    // f(open, hands): 2枚目待ちのハンドが open 個あるときの残り EV 合計
    const memo = new Map();
    const f = (open, hands) => {
      if (open === 0) return 0;
      const k = open * 10 + hands;
      if (memo.has(k)) return memo.get(k);
      let v = (1 - q) * (eNon + f(open - 1, hands));
      if (canResplit && hands < maxHands) v += q * f(open + 1, hands + 1);
      else v += q * (ePair + f(open - 1, hands));
      memo.set(k, v);
      return v;
    };
    return f(2, 2);
  }

  /** 3枚目以降のハンド（ダブル・サレンダー不可）の S/H EV */
  multiCardEVs(ranks) {
    const c = this.countsWithout(ranks);
    let hard = 0, soft = false;
    for (const r of ranks) { hard += VAL[r]; if (r === 0) soft = true; }
    return { S: this.standEV(c, hard, soft), H: this.hitEV(c, hard, soft) };
  }

  /** 山からランク列を順に引く確率 */
  seqProb(ranks) {
    const c = this.base.slice();
    let n = 0;
    for (const x of c) n += x;
    let p = 1;
    for (const r of ranks) {
      if (c[r] <= 0) return 0;
      p *= c[r] / n;
      c[r]--; n--;
    }
    return p;
  }
}

module.exports = { Calculator, VAL, bestTotal, freshShoe };
