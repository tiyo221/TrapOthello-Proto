/* cpu/beginner.js — 初級。罠を早い段階から吐き出し、相手が伏せている罠を気にしない。
   受け取れるのは公開ビューだけで、相手の罠の位置は参照できない。 */
(function () {
  "use strict";
  const TO = window.TO;
  const { WEIGHTS, BEGINNER } = TO.config;
  const { legalMoves } = TO.rules;
  // TO.cpu は呼び出し時に参照する（読み込み順が前後しても未定義で即死しないため）

  /** 角のマス番号（見切りを切る価値がある大物） */
  const CORNERS = [0, 7, 56, 63];

  /**
   * 罠を伏せるマスを選ぶ。石に隣接するマスだけを候補にし、
   * 「今まさに相手が打てるマス」を高く買う。
   * @param {PublicView} view - 公開情報
   * @returns {number|null} 伏せるマス（伏せないなら null）
   */
  function armAt(view) {
    let best = -Infinity, at = null;
    const foeNow = legalMoves(view.bd, view.foe);
    for (let i = 0; i < 64; i++) {
      if (!TO.cpu.canArmAt(view, i)) continue;
      if (!TO.cpu.hasNeighborStone(view.bd, i)) continue;
      let sc = WEIGHTS[i];
      const f = foeNow.get(i);
      // 今まさに相手が打てる＝踏ませやすい
      if (f) sc += BEGINNER.ARM_PLAYABLE_BASE + f.length * BEGINNER.ARM_PLAYABLE_PER_FLIP;
      sc += Math.random() * BEGINNER.ARM_NOISE;
      if (sc > best) { best = sc; at = i; }
    }
    const forced = view.ply >= BEGINNER.ARM_FORCE_PLY; // 使い残さない
    return at !== null && (best >= BEGINNER.ARM_MIN || forced) ? at : null;
  }

  /**
   * 罠まわりの加点。相手を自分の罠へ誘い込む手を高く買う。
   * @param {PublicView} view - 公開情報
   * @param {Uint8Array} nb - 着手後の盤面
   * @param {number} idx - 着手マス（未使用）
   * @param {number[]} flips - 裏返る石（未使用）
   * @returns {number} 加点
   */
  function moveBonus(view, nb, idx, flips) {
    const foeMoves = legalMoves(nb, view.foe);
    let sc = 0;
    for (const [k, kf] of foeMoves) {
      if (view.myTraps.has(k)) sc += BEGINNER.LURE_BASE + kf.length * BEGINNER.LURE_PER_FLIP;
    }
    // 相手の合法手が全部こちらの罠＝どこへ打っても踏む
    if (foeMoves.size && [...foeMoves.keys()].every((k) => view.myTraps.has(k))) sc += BEGINNER.ALL_TRAPPED;
    return sc;
  }

  /**
   * 見切りを切るか。相手が罠を伏せている状態で、
   * 角のような「怖くて取れない」大物を取りに行くときに使う。
   * @param {PublicView} view - 公開情報
   * @param {number} idx - 着手予定のマス
   * @param {number[]} flips - 裏返る石
   * @returns {boolean} 見切りを宣言するなら true
   */
  function shouldShield(view, idx, flips) {
    if (view.myShield <= 0 || view.foeTrapCount <= 0) return false;
    if (CORNERS.includes(idx)) return true;
    if (flips.length >= BEGINNER.SHIELD_MIN_FLIPS) return true;
    return view.ply >= BEGINNER.SHIELD_FORCE_PLY; // 使い残さない
  }

  // cpu.js より先に読まれても落ちないよう、登録先が無ければ作る
  (TO.cpuLevels = TO.cpuLevels || {}).beginner = { armAt, moveBonus, shouldShield };
})();
