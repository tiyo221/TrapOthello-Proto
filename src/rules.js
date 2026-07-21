/* rules.js — オセロの純粋ルール。状態も DOM も持たない（引数の盤面だけを見る）。 */
(function () {
  "use strict";
  const TO = window.TO;
  const { N, EMPTY, BLACK, WHITE, DIRS } = TO.config;

  /**
   * 盤内判定。
   * @param {number} r - 行（0-7）
   * @param {number} c - 列（0-7）
   * @returns {boolean} 盤内なら true
   */
  const inb = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

  /**
   * マス番号を棋譜表記（a1〜h8）にする。
   * @param {number} i - マス番号（0-63）
   * @returns {string} 表記
   */
  const nameOf = (i) => "abcdefgh"[i & 7] + ((i >> 3) + 1);

  /**
   * そのマスに置いたとき裏返る石の一覧を返す。
   * @param {Uint8Array} bd - 盤面（64要素）
   * @param {number} idx - 着手マス（0-63）
   * @param {number} color - 手番の色（BLACK|WHITE）
   * @returns {number[]} 裏返るマス番号の配列（着手不可なら空配列）
   */
  function flipsAt(bd, idx, color) {
    if (bd[idx] !== EMPTY) return [];
    const r = idx >> 3, c = idx & 7, opp = 3 - color, out = [];
    for (const [dr, dc] of DIRS) {
      let rr = r + dr, cc = c + dc;
      const buf = [];
      while (inb(rr, cc) && bd[rr * 8 + cc] === opp) { buf.push(rr * 8 + cc); rr += dr; cc += dc; }
      if (buf.length && inb(rr, cc) && bd[rr * 8 + cc] === color) out.push(...buf);
    }
    return out;
  }

  /**
   * 合法手を列挙する。
   * @param {Uint8Array} bd - 盤面
   * @param {number} color - 手番の色
   * @returns {Map<number, number[]>} 着手マス → 裏返る石の一覧
   */
  function legalMoves(bd, color) {
    const m = new Map();
    for (let i = 0; i < 64; i++) {
      if (bd[i] !== EMPTY) continue;
      const f = flipsAt(bd, i, color);
      if (f.length) m.set(i, f);
    }
    return m;
  }

  /**
   * 石数を数える。
   * @param {Uint8Array} bd - 盤面
   * @returns {[number, number]} [黒, 白]
   */
  function counts(bd) {
    let b = 0, w = 0;
    for (let i = 0; i < 64; i++) { if (bd[i] === BLACK) b++; else if (bd[i] === WHITE) w++; }
    return [b, w];
  }

  TO.rules = { inb, nameOf, flipsAt, legalMoves, counts };
})();
