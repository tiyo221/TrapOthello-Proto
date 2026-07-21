/* cpu.js — CPU の思考（罠の設置判断・着手選択・見切りの切りどころ）。DOM に触れない。 */
(function () {
  "use strict";
  const TO = window.TO;
  const { EMPTY, HUMAN, CPU, DIRS, WEIGHTS, CPU_ARM_MIN, CPU_ARM_FORCE } = TO.config;
  const { inb, legalMoves, counts } = TO.rules;
  const game = TO.game;

  /** 角のマス番号（見切りを切る価値がある大物） */
  const CORNERS = [0, 7, 56, 63];

  /**
   * 罠を伏せるか判断し、価値があれば1個伏せる。
   * ※ 伏せた場合は state を更新する副作用あり。
   */
  function arm() {
    const S = game.state();
    if (S.hand[CPU] <= 0) return;
    let best = -1e9, at = -1;
    const humanNow = legalMoves(S.bd, HUMAN);
    for (let i = 0; i < 64; i++) {
      if (!game.canArm(i, CPU)) continue;
      // 石に隣接＝近いうちに戦場になるマスだけを候補にする
      const r = i >> 3, c = i & 7;
      let adj = false;
      for (const [dr, dc] of DIRS) { const rr = r + dr, cc = c + dc; if (inb(rr, cc) && S.bd[rr * 8 + cc] !== EMPTY) { adj = true; break; } }
      if (!adj) continue;
      let sc = WEIGHTS[i];
      const f = humanNow.get(i);
      if (f) sc += 18 + f.length * 6; // 今まさに人間が打てる＝踏ませやすい
      sc += Math.random() * 10;
      if (sc > best) { best = sc; at = i; }
    }
    const forced = S.ply >= CPU_ARM_FORCE;
    if (at >= 0 && (best >= CPU_ARM_MIN || forced)) game.armTrap(at, CPU);
  }

  /**
   * 着手と見切りの使用可否を選ぶ。
   * @returns {{idx:number, shield:boolean}|null} 選んだ手（打てる手が無ければ null）
   */
  function chooseMove() {
    const S = game.state();
    const moves = legalMoves(S.bd, CPU);
    if (!moves.size) return null;

    let empties = 0;
    for (let i = 0; i < 64; i++) if (S.bd[i] === EMPTY) empties++;
    const endgame = empties <= 10;

    let best = null, bestScore = -1e9;
    for (const [idx, f] of moves) {
      const nb = Uint8Array.from(S.bd);
      nb[idx] = CPU;
      for (const i of f) nb[i] = CPU;

      let sc;
      if (endgame) { const [b, w] = counts(nb); sc = (w - b) * 120; }
      else {
        sc = 0;
        for (let i = 0; i < 64; i++) { if (nb[i] === CPU) sc += WEIGHTS[i]; else if (nb[i] === HUMAN) sc -= WEIGHTS[i]; }
        const my = legalMoves(nb, CPU).size, op = legalMoves(nb, HUMAN).size;
        sc += 9 * (my - op);
      }
      // 相手を自分の罠へ誘い込む：横取り期待値で重み付け
      const oppMoves = legalMoves(nb, HUMAN);
      let lure = 0;
      for (const [k, kf] of oppMoves) if (S.trap[CPU].has(k)) lure += 12 + kf.length * 9;
      sc += lure;
      if (oppMoves.size && [...oppMoves.keys()].every((k) => S.trap[CPU].has(k))) sc += 140;

      sc += Math.random() * 4;
      if (sc > bestScore) { bestScore = sc; best = idx; }
    }

    // 見切りを切るか：相手が罠を伏せている状態で、角のような「怖くて取れない」大物を取りに行くとき
    let shield = false;
    if (S.shield[CPU] > 0 && S.trap[HUMAN].size > 0) {
      if (CORNERS.includes(best)) shield = true;
      else if (moves.get(best).length >= 6) shield = true;
      else if (S.ply >= 52) shield = true; // 使い残さない
    }
    return { idx: best, shield };
  }

  TO.cpu = { arm, chooseMove };
})();
