/* game.js — 対局状態と状態遷移（罠・見切りを含むトラップ・オセロ固有ルール）。
   DOM に触れない。演出のタイミング制御と描画は main.js / view.js の責務。 */
(function () {
  "use strict";
  const TO = window.TO;
  const { EMPTY, BLACK, WHITE, HUMAN, CPU, TRAPS_HAND, SHIELD_COUNT, ARM_FROM_PLY } = TO.config;
  const { nameOf, flipsAt, legalMoves, counts } = TO.rules;

  /**
   * 対局状態。1局ぶんの全情報を持つ（view はこれを読むだけ）。
   * @typedef {Object} State
   * @property {Uint8Array} bd - 盤面（64要素・EMPTY|BLACK|WHITE）
   * @property {{1:Set<number>,2:Set<number>}} trap - 伏せてある罠（プレイヤーごとの独立レイヤー）
   * @property {{1:number,2:number}} hand - 未使用の罠の手札数
   * @property {Set<number>} fired - 発動済み（公開された）罠のマス
   * @property {Set<number>} stolen - 直近の横取り演出対象のマス
   * @property {Set<number>|null} preview - 通常解決を見せている中間フレームのマス
   * @property {boolean} busy - 演出中の入力ロック
   * @property {{1:number,2:number}} shield - 見切りの残数（公開情報）
   * @property {boolean} shieldOn - このターン、見切りを宣言中か
   * @property {number} turn - 手番の色
   * @property {number} ply - 手数
   * @property {"play"|"over"} phase - 進行フェーズ
   * @property {boolean} arming - 罠の設置マス選択中か
   * @property {number} armedThisTurn - この手番に設置した数
   * @property {number} last - 直前の着手マス（未着手なら -1）
   * @property {{t:string,cls:?string}[]} logs - 新しい順のログ
   */

  /** @type {State|null} */
  let S = null;

  /**
   * 現在の対局状態を返す。
   * @returns {State|null} newGame 前は null
   */
  function state() { return S; }

  /**
   * ある手番のプレイヤーが見てよい情報だけを写した対局状況のスナップショット。
   * **相手の罠の位置は含まない**（含めた時点でカンニングになる）。
   * また、相手の見切り宣言（`shieldOn`）も含めない。宣言は相手の手番中にしか立たず
   * `endTurn` で落ちるため、こちらの手番には存在しない情報だから。
   *
   * ここは「見てよい情報の定義」であり、現在の利用状況とは切り離す。
   * 使われていないフィールドがあっても、公開情報である限り残す。
   * @typedef {Object} PublicView
   * @property {Uint8Array} bd - 盤面のコピー
   * @property {number} ply - 手数
   * @property {"play"|"over"} phase - 進行フェーズ
   * @property {number} me - 見ている側の色
   * @property {number} foe - 相手の色
   * @property {number} armedThisTurn - この手番に自分が設置した数（上限は ARM_PER_TURN）。
   *   設置数は手番ごとのカウンタなので、手番でない側から見たときは常に 0
   * @property {Set<number>} myTraps - 自分が伏せてある罠の位置
   * @property {number} myHand - 自分の未使用の罠
   * @property {number} myShield - 自分の見切り残数
   * @property {number} foeTrapCount - 相手が伏せている罠の**数**（位置は不明）
   * @property {number} foeHand - 相手の未使用の罠
   * @property {number} foeShield - 相手の見切り残数
   * @property {Set<number>} fired - 発動済み（公開された）罠のマス
   */

  /**
   * 公開情報だけを写したビューを返す。CPU はこれ以外から状態を読まない。
   * 盤面と集合はコピーなので、受け取った側が書き換えても対局状態には影響しない。
   * @param {number} color - 見る側の色
   * @returns {PublicView} 公開情報のスナップショット
   */
  function publicView(color) {
    const foe = 3 - color;
    return {
      bd: Uint8Array.from(S.bd),
      ply: S.ply,
      phase: S.phase,
      me: color,
      foe,
      // 設置数は手番ごとのカウンタ（endTurn で 0 に戻る）。手番でない側の「今手番の設置数」は 0
      armedThisTurn: color === S.turn ? S.armedThisTurn : 0,
      myTraps: new Set(S.trap[color]),
      myHand: S.hand[color],
      myShield: S.shield[color],
      foeTrapCount: S.trap[foe].size,
      foeHand: S.hand[foe],
      foeShield: S.shield[foe],
      fired: new Set(S.fired),
    };
  }

  /**
   * ログを1行追加する（新しい順・最大60行）。
   * @param {string} t - 本文
   * @param {string} [cls] - 強調クラス（"hot" | "big"）
   */
  function say(t, cls) { S.logs.unshift({ t, cls }); if (S.logs.length > 60) S.logs.pop(); }

  /**
   * 新規対局の状態を作る。
   * @returns {State} 初期化された対局状態
   */
  function newGame() {
    S = {
      bd: new Uint8Array(64),
      trap: { 1: new Set(), 2: new Set() },
      hand: { 1: TRAPS_HAND, 2: TRAPS_HAND },
      fired: new Set(),
      stolen: new Set(),
      preview: null,
      busy: false,
      shield: { 1: SHIELD_COUNT, 2: SHIELD_COUNT },
      shieldOn: false,
      turn: BLACK, ply: 0,
      phase: "play",
      arming: false, armedThisTurn: 0,
      last: -1, logs: [],
    };
    S.bd[27] = WHITE; S.bd[28] = BLACK; S.bd[35] = BLACK; S.bd[36] = WHITE;
    say("対局開始。罠は" + TRAPS_HAND + "個、いつでも仕掛けられる。");
    return S;
  }

  /**
   * そのマスに罠を伏せられるかを、盤面と設置者の罠だけから判定する純粋関数。
   * 対局状態からも公開ビューからも同じ判定を使うため、条件式はここにしか置かない。
   * @param {Uint8Array} bd - 盤面
   * @param {number} ply - 手数
   * @param {Set<number>} traps - 設置者が既に伏せている罠
   * @param {number} idx - マス番号
   * @returns {boolean} 伏せられるなら true
   */
  function canArmOn(bd, ply, traps, idx) {
    if (idx < 0 || idx >= 64) return false; // CPU の難易度実装が任意の値を渡せる境界
    return ply >= ARM_FROM_PLY && bd[idx] === EMPTY && !traps.has(idx);
  }

  /**
   * そのマスに罠を伏せられるか（現在の対局状態で判定する）。
   * @param {number} idx - マス番号
   * @param {number} color - 設置者の色
   * @returns {boolean} 伏せられるなら true
   */
  function canArm(idx, color) { return canArmOn(S.bd, S.ply, S.trap[color], idx); }

  /**
   * 罠を1個伏せて手札を消費する（ログも残す）。
   * @param {number} idx - マス番号
   * @param {number} color - 設置者の色
   */
  function armTrap(idx, color) {
    S.trap[color].add(idx);
    S.hand[color]--;
    S.armedThisTurn++;
    if (color === HUMAN) say("罠を " + nameOf(idx) + " に伏せた（残り" + S.hand[HUMAN] + "）", "hot");
    else say("CPUが罠を仕掛けた（残り" + S.hand[CPU] + "）");
  }

  /**
   * 見切りの宣言／取り消しを切り替える（ログも残す）。
   */
  function toggleShield() {
    S.shieldOn = !S.shieldOn;
    say(S.shieldOn ? "見切りを宣言。この手番は罠を無効化する。" : "見切りを取り消した。", S.shieldOn ? "hot" : null);
  }

  /**
   * 着手の結果。fired が true の場合のみ doSteal で第2段階へ進む。
   * @typedef {Object} MoveInfo
   * @property {boolean} fired - 罠が発動するか
   * @property {number} idx - 着手マス
   * @property {number[]} f - 裏返った石
   * @property {number} foe - 相手（＝罠の設置者）の色
   * @property {number} color - 着手した色
   * @property {boolean} disarmed - 見切りで罠を解除したか
   */

  /**
   * 第1段階：通常どおり手を解決する（罠があっても、まず普通に決着させて見せる）。
   * @param {number} idx - 着手マス
   * @param {number} color - 着手する色
   * @param {boolean} shielded - この手番に見切りを宣言しているか
   * @returns {MoveInfo} 第2段階（横取り）の判断に使う結果
   */
  function applyMove(idx, color, shielded) {
    const foe = 3 - color;
    const hasTrap = S.trap[foe].has(idx);
    const willFire = hasTrap && !shielded;
    const f = flipsAt(S.bd, idx, color);

    S.bd[idx] = color;
    for (const i of f) S.bd[i] = color;
    S.stolen.clear();
    S.preview = new Set([idx, ...f]);

    const who = color === HUMAN ? "あなた" : "CPU";
    if (shielded) {
      S.shield[color]--;
      if (hasTrap) {
        S.trap[foe].delete(idx); S.fired.add(idx);
        say("見切り成功 " + nameOf(idx) + "！ 罠を解除して " + (f.length + 1) + "枚 を確保", "hot");
      } else {
        say(who + "の見切りは空振り（" + nameOf(idx) + " に罠はなかった）");
      }
    } else if (!willFire) {
      say(who + " " + nameOf(idx) + "（" + f.length + "枚）");
    }

    // 自分の罠を自分で踏んだ場合は無効化されるだけ
    if (S.trap[color].has(idx)) {
      S.trap[color].delete(idx);
      say(who + "は自分の罠を踏んで無効化。");
    }
    S.last = idx; S.ply++;
    return { fired: willFire, idx, f, foe, color, disarmed: !!(shielded && hasTrap) };
  }

  /**
   * 第2段階：成果（置いた石＋裏返った石）を丸ごと設置者が奪う。
   * @param {MoveInfo} info - applyMove の戻り値
   * @returns {{kind:"good"|"bad", n:number, cell:string}} バナー表示に使う情報
   */
  function doSteal(info) {
    const { idx, f, foe } = info;
    S.trap[foe].delete(idx);
    S.fired.add(idx);
    S.bd[idx] = foe;
    for (const i of f) S.bd[i] = foe;
    S.stolen = new Set([idx, ...f]);
    S.preview = null;
    const n = f.length + 1;
    say("罠発動 " + nameOf(idx) + "！ " + (foe === HUMAN ? "あなた" : "CPU") + "が " + n + "枚 を横取り", n >= 5 ? "big" : "hot");
    return { kind: foe === HUMAN ? "good" : "bad", n, cell: nameOf(idx) };
  }

  /**
   * 手番を渡す。打つ手が無ければパス、双方無ければ終局させる。
   * ※ 描画と CPU の起動は呼び出し側（main.js）が行う。
   */
  function endTurn() {
    S.turn = 3 - S.turn;
    S.armedThisTurn = 0;
    S.arming = false;
    S.shieldOn = false;
    if (!legalMoves(S.bd, S.turn).size) {
      if (!legalMoves(S.bd, 3 - S.turn).size) { endGame(); return; }
      say((S.turn === HUMAN ? "あなた" : "CPU") + "はパス。");
      S.turn = 3 - S.turn;
    }
  }

  /**
   * 終局させ、結果をログに残す。
   */
  function endGame() {
    S.phase = "over";
    const [b, w] = counts(S.bd);
    say(b > w ? "あなたの勝ち（" + b + "-" + w + "）" : b < w ? "CPUの勝ち（" + b + "-" + w + "）" : "引き分け（" + b + "-" + w + "）", "hot");
  }

  TO.game = { state, publicView, newGame, say, canArm, canArmOn, armTrap, toggleShield, applyMove, doSteal, endTurn, endGame };
})();
