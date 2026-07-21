/* cpu.js — CPU のファサードと共通処理。DOM に触れない。
   難易度ごとの判断は src/cpu/<id>.js が TO.cpuLevels に載せる。
   ここが唯一 game に触れる層で、各難易度には公開ビュー（PublicView）しか渡さない。
   ＝ 難易度側は相手の罠の位置を構造上参照できない。 */
(function () {
  "use strict";
  const TO = window.TO;
  const {
    EMPTY, WHITE, CPU, DIRS, WEIGHTS,
    CPU_ENDGAME_EMPTIES, CPU_ENDGAME_DISC_WEIGHT, CPU_MOBILITY_WEIGHT, CPU_TIE_NOISE,
  } = TO.config;
  const { inb, legalMoves, counts } = TO.rules;

  /** 難易度の実体を載せる場所。各ファイルが TO.cpuLevels["<id>"] = {...} で登録する。 */
  const levels = (TO.cpuLevels = TO.cpuLevels || {});

  /**
   * 難易度が実装する判断。共通処理はこの3つだけを呼ぶ。
   * @typedef {Object} CpuLevel
   * @property {(view: PublicView) => number|null} armAt - 罠を伏せるマス（伏せないなら null）
   * @property {(view: PublicView, nb: Uint8Array, idx: number, flips: number[]) => number} moveBonus - 着手の加点
   * @property {(view: PublicView, idx: number, flips: number[]) => boolean} shouldShield - 見切りを切るか
   */

  /** @type {string} 現在の難易度 */
  let currentId = "beginner";

  /**
   * 難易度を切り替える。
   * @param {string} id - 難易度ID（TO.cpuLevels のキー）
   */
  function setLevel(id) {
    if (!levels[id]) throw new Error("未登録の難易度: " + id);
    currentId = id;
  }

  /**
   * 現在の難易度IDを返す。
   * @returns {string} 難易度ID
   */
  function level() { return currentId; }

  /**
   * 現在の難易度の実体を返す。
   * @returns {CpuLevel} 難易度の実装
   */
  function impl() {
    const lv = levels[currentId];
    if (!lv) throw new Error("難易度が読み込まれていない: " + currentId);
    return lv;
  }

  /* ---------- 難易度から使う共通ヘルパ ---------- */

  /**
   * そのマスに罠を伏せられるか（公開ビューだけで判定する）。
   * 判定式は game.canArmOn に一本化してあり、ここは公開ビューを繋ぐだけ。
   * @param {PublicView} view - 公開情報
   * @param {number} idx - マス番号
   * @returns {boolean} 伏せられるなら true
   */
  function canArmAt(view, idx) {
    return TO.game.canArmOn(view.bd, view.ply, view.myTraps, idx);
  }

  /**
   * 石が隣接しているマスか（近いうちに戦場になる ＝ 罠の設置候補）。
   * @param {Uint8Array} bd - 盤面
   * @param {number} idx - マス番号
   * @returns {boolean} 隣接する石があれば true
   */
  function hasNeighborStone(bd, idx) {
    const r = idx >> 3, c = idx & 7;
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (inb(rr, cc) && bd[rr * 8 + cc] !== EMPTY) return true;
    }
    return false;
  }

  /**
   * 空きマスを数える。終盤かどうかの判定に使う（判定は**着手前**の盤で行う）。
   * @param {Uint8Array} bd - 盤面
   * @returns {number} 空きマス数
   */
  function emptyCount(bd) {
    let n = 0;
    for (let i = 0; i < 64; i++) if (bd[i] === EMPTY) n++;
    return n;
  }

  /**
   * 盤面の基礎評価。終盤は石数差、それ以外はマス評価＋着手可能数の差。
   * @param {Uint8Array} nb - 着手後の盤面
   * @param {number} me - 自分の色
   * @param {number} foe - 相手の色
   * @param {boolean} endgame - 終盤として評価するか
   * @returns {number} 評価値（自分から見て大きいほど良い）
   */
  function baseScore(nb, me, foe, endgame) {
    if (endgame) {
      const [b, w] = counts(nb);
      return (me === WHITE ? w - b : b - w) * CPU_ENDGAME_DISC_WEIGHT;
    }
    let sc = 0;
    for (let i = 0; i < 64; i++) { if (nb[i] === me) sc += WEIGHTS[i]; else if (nb[i] === foe) sc -= WEIGHTS[i]; }
    return sc + CPU_MOBILITY_WEIGHT * (legalMoves(nb, me).size - legalMoves(nb, foe).size);
  }

  /* ---------- 進行制御（main.js）から呼ばれる入口 ---------- */

  /**
   * 罠を伏せるか難易度に問い、伏せるなら実際に設置する。
   * ※ 設置した場合は対局状態を更新する副作用あり。
   */
  function arm() {
    const view = TO.game.publicView(CPU);
    if (view.myHand <= 0) return;
    const at = impl().armAt(view);
    if (at !== null && at >= 0 && TO.game.canArm(at, CPU)) TO.game.armTrap(at, CPU);
  }

  /**
   * 着手と見切りの使用可否を選ぶ。合法手の列挙・盤面評価は共通、
   * 罠まわりの加点と見切りの判断は難易度に委ねる。
   * @returns {{idx:number, shield:boolean}|null} 選んだ手（打てる手が無ければ null）
   */
  function chooseMove() {
    const view = TO.game.publicView(CPU);
    const lv = impl();
    const moves = legalMoves(view.bd, view.me);
    if (!moves.size) return null;

    const endgame = emptyCount(view.bd) <= CPU_ENDGAME_EMPTIES;
    let best = null, bestScore = -1e9, bestFlips = null;
    for (const [idx, f] of moves) {
      const nb = Uint8Array.from(view.bd);
      nb[idx] = view.me;
      for (const i of f) nb[i] = view.me;

      // 同点手が続くと毎回同じ対局になるので、小さな揺らぎを加える
      const sc = baseScore(nb, view.me, view.foe, endgame) + lv.moveBonus(view, nb, idx, f)
        + Math.random() * CPU_TIE_NOISE;
      if (sc > bestScore) { bestScore = sc; best = idx; bestFlips = f; }
    }
    return { idx: best, shield: lv.shouldShield(view, best, bestFlips) };
  }

  // 公開するのは進行制御から使う入口と、難易度から使うヘルパだけ。
  // baseScore / emptyCount は共通処理の内部で完結するので出さない。
  TO.cpu = { arm, chooseMove, setLevel, level, canArmAt, hasNeighborStone };
})();
