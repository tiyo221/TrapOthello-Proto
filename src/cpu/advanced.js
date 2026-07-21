/* cpu/advanced.js — 上級。盤の判断は中級に委譲し、罠と見切りの「運用」だけを変える。
   罠を終盤まで温存し、自分の着手のあと相手の合法手になるマスを覆う。 */
(function () {
  "use strict";
  const TO = window.TO;
  const { WEIGHTS, ADVANCED } = TO.config;
  const { legalMoves } = TO.rules;
  // TO.cpu / TO.cpuLevels は呼び出し時に参照する（読み込み順が前後しても未定義で即死しないため）

  /**
   * 委譲先の中級。上級は探索の深さも盤評価も中級と共通で、変えるのは罠と見切りの運用だけ。
   * @returns {CpuLevel} 中級の判断
   */
  function base() { return TO.cpuLevels.intermediate; }

  /**
   * 罠を伏せるマスを選ぶ。`ADVANCED.ARM_FROM_PLY` までは伏せずに温存し、
   * それ以降は「これから打つ手のあと、相手の合法手になるマス」のうち
   * 最も裏返りが大きいものを覆う。
   * @param {PublicView} view - 公開情報
   * @returns {number|null} 伏せるマス（伏せないなら null）
   */
  function armAt(view) {
    if (view.ply < ADVANCED.ARM_FROM_PLY) return null;

    // 罠は石を置く前にしか伏せられないので、先に着手を決めてから覆う先を選ぶ
    const move = TO.cpu.planMove(view);
    const nb = Uint8Array.from(view.bd);
    if (move) {
      nb[move.idx] = view.me;
      for (const i of move.flips) nb[i] = view.me;
    }

    let best = -1, at = null;
    for (const [k, kf] of legalMoves(nb, view.foe)) {
      if (!TO.cpu.canArmAt(view, k)) continue;
      if (kf.length > best) { best = kf.length; at = k; }
    }
    return at !== null ? at : spareAt(view);
  }

  /**
   * 覆える相手の合法手が無いときの逃がし先。温存した罠を死に札にしないため、
   * 石に隣接する空きマスのうちマス評価が最も高いところへ伏せる。
   * @param {PublicView} view - 公開情報
   * @returns {number|null} 伏せるマス（伏せられるマスが無ければ null）
   */
  function spareAt(view) {
    let best = -Infinity, at = null;
    for (let i = 0; i < 64; i++) {
      if (!TO.cpu.canArmAt(view, i)) continue;
      if (!TO.cpu.hasNeighborStone(view.bd, i)) continue;
      if (WEIGHTS[i] > best) { best = WEIGHTS[i]; at = i; }
    }
    return at;
  }

  /**
   * 罠まわりの加点。中級と同じ（誘い込みの加点と、踏む期待損失の減点）。
   * @param {PublicView} view - 公開情報
   * @param {Uint8Array} nb - 着手後の盤面
   * @param {number} idx - 着手マス
   * @param {number[]} flips - 裏返る石
   * @returns {number} 加点
   */
  function moveBonus(view, nb, idx, flips) { return base().moveBonus(view, nb, idx, flips); }

  /**
   * 見切りを切るか。終盤に相手が合法手を覆ってきたときの突破口として温存し、
   * `ADVANCED.SHIELD_FROM_PLY` 以降は中級と同じく期待損失で判断する。
   * @param {PublicView} view - 公開情報
   * @param {number} idx - 着手予定のマス
   * @param {number[]} flips - 裏返る石
   * @returns {boolean} 見切りを宣言するなら true
   */
  function shouldShield(view, idx, flips) {
    if (view.ply < ADVANCED.SHIELD_FROM_PLY) return false;
    return base().shouldShield(view, idx, flips);
  }

  // cpu.js より先に読まれても落ちないよう、登録先が無ければ作る
  (TO.cpuLevels = TO.cpuLevels || {}).advanced = { armAt, moveBonus, shouldShield };
})();
