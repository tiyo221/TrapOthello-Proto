/* cpu/intermediate.js — 中級。公開情報を使い切る。
   相手の伏せ数から「罠を踏む期待損失」を見積もって着手と見切りを決め、
   相手の見切り残数で罠の伏せ方を変える。相手の罠の位置は参照できない。 */
(function () {
  "use strict";
  const TO = window.TO;
  const { WEIGHTS, INTERMEDIATE } = TO.config;
  const { legalMoves } = TO.rules;
  // TO.cpu は呼び出し時に参照する（読み込み順が前後しても未定義で即死しないため）

  /** 角のマス番号（相手が見切りを切ってでも取りに来る大物） */
  const CORNERS = [0, 7, 56, 63];

  /**
   * そのマスへ打ったときに罠を踏む期待損失（石差）。
   * 相手の罠は空きマスのどこかにあるので「伏せ数 ÷ 空きマス数」を踏む確率とみなす粗いモデル。
   * 踏むと置いた石＋裏返った石がまるごと相手のものになるので、石差は枚数の 2倍動く。
   * @param {PublicView} view - 公開情報
   * @param {number[]} flips - その手で裏返る石
   * @returns {number} 期待損失（石差・0以上）
   */
  function trapRisk(view, flips) {
    if (view.foeTrapCount <= 0) return 0;
    const empties = TO.cpu.emptyCount(view.bd);
    if (empties <= 0) return 0;
    const p = Math.min(1, view.foeTrapCount / empties);
    return p * (flips.length + 1) * 2;
  }

  /**
   * 罠を伏せるマスを選ぶ。石に隣接するマスだけを候補にし、
   * 「今まさに相手が打てるマス」を高く買う。相手の見切り残数で強気／慎重を切り替える。
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
      if (f) sc += INTERMEDIATE.ARM_PLAYABLE_BASE + f.length * INTERMEDIATE.ARM_PLAYABLE_PER_FLIP;
      // 見切りが残っている相手は、角のような大物ほど警戒して切ってくる
      if (view.foeShield > 0 && CORNERS.includes(i)) sc -= INTERMEDIATE.ARM_CORNER_VS_SHIELD;
      sc += Math.random() * INTERMEDIATE.ARM_NOISE;
      if (sc > best) { best = sc; at = i; }
    }
    // 相手の見切りが尽きていれば罠は確実に効く。踏み切る基準を下げる
    const min = view.foeShield > 0 ? INTERMEDIATE.ARM_MIN : INTERMEDIATE.ARM_MIN_NO_SHIELD;
    const forced = view.ply >= INTERMEDIATE.ARM_FORCE_PLY; // 使い残さない
    return at !== null && (best >= min || forced) ? at : null;
  }

  /**
   * 罠まわりの加点。相手を自分の罠へ誘い込む手を高く買い、
   * 相手の罠を踏む期待損失を引く（大きく裏返す手ほど踏んだときの傷が深い）。
   * @param {PublicView} view - 公開情報
   * @param {Uint8Array} nb - 着手後の盤面
   * @param {number} idx - 着手マス（未使用）
   * @param {number[]} flips - 裏返る石
   * @returns {number} 加点
   */
  function moveBonus(view, nb, idx, flips) {
    const foeMoves = legalMoves(nb, view.foe);
    let sc = 0;
    for (const [k, kf] of foeMoves) {
      if (view.myTraps.has(k)) sc += INTERMEDIATE.LURE_BASE + kf.length * INTERMEDIATE.LURE_PER_FLIP;
    }
    // 相手の合法手が全部こちらの罠＝どこへ打っても踏む
    if (foeMoves.size && [...foeMoves.keys()].every((k) => view.myTraps.has(k))) sc += INTERMEDIATE.ALL_TRAPPED;
    return sc - trapRisk(view, flips) * INTERMEDIATE.RISK_DISC_WEIGHT;
  }

  /**
   * 見切りを切るか。踏んだときの期待損失が閾値を超えたときに切る
   * （「角だから」「何枚以上だから」という決め打ちはしない）。
   * @param {PublicView} view - 公開情報
   * @param {number} idx - 着手予定のマス（未使用）
   * @param {number[]} flips - 裏返る石
   * @returns {boolean} 見切りを宣言するなら true
   */
  function shouldShield(view, idx, flips) {
    if (view.myShield <= 0 || view.foeTrapCount <= 0) return false;
    if (trapRisk(view, flips) >= INTERMEDIATE.SHIELD_MIN_RISK) return true;
    return view.ply >= INTERMEDIATE.SHIELD_FORCE_PLY; // 使い残しても価値が無い
  }

  // cpu.js より先に読まれても落ちないよう、登録先が無ければ作る
  (TO.cpuLevels = TO.cpuLevels || {}).intermediate = { armAt, moveBonus, shouldShield };
})();
