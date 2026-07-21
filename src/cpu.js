/* cpu.js — CPU のファサードと共通処理。DOM に触れない。
   難易度ごとの判断は src/cpu/<id>.js が TO.cpuLevels に載せる。
   CPU 系のうち game に触れるのはここだけで、各難易度には公開ビュー（PublicView）しか渡さない。
   ただし classic script なので難易度からも window.TO は見えている。「相手の罠の位置を見ない」は
   規約であり、CLAUDE.md の grep で担保する（構造で不可能にはできない）。 */
(function () {
  "use strict";
  const TO = window.TO;
  const {
    EMPTY, WHITE, CPU, DIRS, WEIGHTS, ARM_PER_TURN, CPU_LEVEL_DEFAULT,
    CPU_ENDGAME_EMPTIES, CPU_ENDGAME_DISC_WEIGHT, CPU_MOBILITY_WEIGHT, CPU_TIE_NOISE,
  } = TO.config;
  const { inb, legalMoves, counts } = TO.rules;

  /* 盤面評価のパラメータ（終盤の閾値・重み・揺らぎ）は難易度に依らない共通の値として
     config.js に置く。難易度ごとに上書きできる仕組みは、必要になるまで作らない。 */

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
  let currentId = CPU_LEVEL_DEFAULT;

  /**
   * 難易度を切り替える。
   * @param {string} id - 難易度ID（TO.cpuLevels のキー）
   */
  function setLevel(id) {
    if (!levels[id]) throw new Error("未登録の難易度: " + id);
    currentId = id;
    // 計画は1手番だけ有効。startGame（main.js）が新規対局のたびに setLevel を呼ぶので、
    // ここで捨てて前局の計画が残らないようにする（同一手番の arm→chooseMove の共有には影響しない）。
    plan = null;
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

  /* ---------- 着手の計画 ---------- */

  /**
   * これから打つ手（副作用なし）。
   * @typedef {Object} PlannedMove
   * @property {number} idx - 着手マス
   * @property {number[]} flips - 裏返る石
   */

  /**
   * 直近に立てた計画。同じ局面で立て直さないためのキャッシュ。
   * @type {{me:number, ply:number, bd:Uint8Array, move:PlannedMove|null}|null}
   */
  let plan = null;

  /**
   * 盤面が同一か（キャッシュが同じ局面のものかの判定に使う）。
   * @param {Uint8Array} a - 盤面
   * @param {Uint8Array} b - 盤面
   * @returns {boolean} 全マス一致なら true
   */
  function samePosition(a, b) {
    for (let i = 0; i < 64; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /**
   * これから打つ手を選ぶ（対局状態は変えない）。合法手の列挙・盤面評価は共通で、
   * 罠まわりの加点だけを難易度に委ねる。
   *
   * 罠を伏せる前に着手を知りたい難易度（上級の「相手の応手を覆う」）があるため、
   * 難易度からも呼べる形にしてある。伏せると `moveBonus` の評価が変わるので、
   * 呼ぶたびに立て直すと「伏せる前提にした手」と「実際に打つ手」がずれる。
   * それを防ぐため、同じ局面（手番の色・手数・盤面）の間は同じ計画を返す。
   * @param {PublicView} view - 公開情報
   * @returns {PlannedMove|null} 打つ手（打てる手が無ければ null）
   */
  function planMove(view) {
    if (plan && plan.me === view.me && plan.ply === view.ply && samePosition(plan.bd, view.bd)) return plan.move;

    const lv = impl();
    const moves = legalMoves(view.bd, view.me);
    let move = null;
    if (moves.size) {
      const endgame = emptyCount(view.bd) <= CPU_ENDGAME_EMPTIES;
      let bestScore = -Infinity;
      for (const [idx, f] of moves) {
        const nb = Uint8Array.from(view.bd);
        nb[idx] = view.me;
        for (const i of f) nb[i] = view.me;

        // 同点手が続くと毎回同じ対局になるので、小さな揺らぎを加える
        const sc = baseScore(nb, view.me, view.foe, endgame) + lv.moveBonus(view, nb, idx, f)
          + Math.random() * CPU_TIE_NOISE;
        if (sc > bestScore) { bestScore = sc; move = { idx, flips: f }; }
      }
      // moveBonus が NaN を返すと比較が常に false になり、手を選べないまま抜ける
      if (move === null) {
        console.warn("[cpu] 難易度 " + currentId + " の評価が手を選べなかった。先頭の合法手で代替する。");
        const [idx, f] = [...moves.entries()][0];
        move = { idx, flips: f };
      }
    }
    // view.bd は publicView が作ったコピーなので、そのまま持っておいてよい
    plan = { me: view.me, ply: view.ply, bd: view.bd, move };
    return move;
  }

  /* ---------- 進行制御（main.js）から呼ばれる入口 ---------- */

  /* 色を引数に取るのは、難易度どうしを先後入れ替えて戦わせる自動対局を
     この実装のまま回せるようにするため。通常の対局は既定値（白）で足りる。 */

  /**
   * 罠を伏せるか難易度に問い、伏せるなら実際に設置する。
   * ※ 設置した場合は対局状態を更新する副作用あり。
   * @param {number} [color] - 思考する側の色（既定は CPU）
   */
  function arm(color = CPU) {
    const view = TO.game.publicView(color);
    if (view.myHand <= 0 || view.armedThisTurn >= ARM_PER_TURN) return;
    const at = impl().armAt(view);
    if (at === null) return;
    // 難易度が伏せられないマスを返したら実装のバグ。握り潰さず表に出す。
    if (!TO.game.canArm(at, color)) {
      console.warn("[cpu] 難易度 " + currentId + " が設置できないマスを返した: " + at);
      return;
    }
    TO.game.armTrap(at, color);
  }

  /**
   * 着手と見切りの使用可否を選ぶ。見切りの判断は難易度に委ねる。
   * @param {number} [color] - 思考する側の色（既定は CPU）
   * @returns {{idx:number, shield:boolean}|null} 選んだ手（打てる手が無ければ null）
   */
  function chooseMove(color = CPU) {
    const view = TO.game.publicView(color);
    const move = planMove(view);
    if (!move) return null;

    // 見切りは残数を消費する。難易度が残数を見落としても -1 にならないよう共通側で検算する
    let shield = impl().shouldShield(view, move.idx, move.flips);
    if (shield && view.myShield <= 0) {
      console.warn("[cpu] 難易度 " + currentId + " が残っていない見切りを切ろうとした");
      shield = false;
    }
    return { idx: move.idx, shield };
  }

  // 公開するのは進行制御から使う入口と、難易度から使うヘルパだけ。
  // baseScore は共通処理の内部で完結するので出さない。
  TO.cpu = { arm, chooseMove, setLevel, level, canArmAt, hasNeighborStone, emptyCount, planMove };
})();
