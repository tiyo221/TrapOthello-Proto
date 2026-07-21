/* main.js — 進行制御。入力の受け取り、着手の解決（演出の間合い）、手番の受け渡しを担う。
   ゲームの判定は game.js、思考は cpu.js、描画は view.js に委ねる。 */
(function () {
  "use strict";
  const TO = window.TO;
  const {
    HUMAN, CPU, ARM_PER_TURN,
    DELAY_MOVE, DELAY_STEAL, DELAY_AFTER_STEAL, DELAY_SHIELD, DELAY_CPU,
  } = TO.config;
  const { nameOf, legalMoves } = TO.rules;
  const game = TO.game;
  const cpu = TO.cpu;
  const view = TO.view;
  const { btnArm, btnShield, btnReset, selLevel } = view.els;

  /**
   * 1手を解決して手番を渡す。罠が発動する場合は通常解決を見せてから横取りへ進む。
   * @param {number} idx - 着手マス
   * @param {number} color - 着手する色
   * @param {boolean} shielded - この手番に見切りを宣言しているか
   */
  function commitMove(idx, color, shielded) {
    const S = game.state();
    S.busy = true;
    const fin = () => { S.busy = false; nextTurn(); };
    const info = game.applyMove(idx, color, shielded);
    view.render();

    if (info.fired) {
      setTimeout(() => {
        const banner = game.doSteal(info);
        view.render();
        view.showBanner(banner.kind, banner.n, banner.cell);
        setTimeout(fin, DELAY_AFTER_STEAL);
      }, DELAY_STEAL);
    } else if (info.disarmed) {
      view.showBanner("safe", info.f.length + 1, nameOf(info.idx));
      setTimeout(fin, DELAY_SHIELD);
    } else {
      setTimeout(fin, DELAY_MOVE);
    }
  }

  /**
   * 手番を渡して描き直し、CPU の番なら思考を予約する。
   */
  function nextTurn() {
    game.endTurn();
    view.render();
    const S = game.state();
    if (S.phase === "play" && S.turn === CPU) setTimeout(cpuTurn, DELAY_CPU);
  }

  /**
   * CPU の1手（罠の設置 → 着手の選択 → 解決）。
   */
  function cpuTurn() {
    const S = game.state();
    if (S.phase !== "play" || S.turn !== CPU) return;
    let choice;
    try {
      cpu.arm();
      choice = cpu.chooseMove();
    } catch (e) {
      // ここで落ちると手番が CPU のまま止まる。手番だけ進めても次の CPU 手番でまた
      // 落ちるだけなので、止まったことと復帰手段をログに出して原因を追えるようにする。
      // ログは innerHTML で展開されるため、例外の中身は console 側だけに出す。
      console.error(e);
      game.say("CPU の思考でエラーが発生しました。「最初から」でやり直してください（詳細はコンソール）。", "big");
      view.render();
      return;
    }
    if (!choice) { nextTurn(); return; }
    if (choice.shield) game.say("CPUが見切りを宣言（" + nameOf(choice.idx) + "）", "hot");
    commitMove(choice.idx, CPU, choice.shield);
  }

  /**
   * 盤のクリック。罠の設置中なら設置、そうでなければ着手として扱う。
   * @param {number} idx - クリックされたマス
   */
  function onCell(idx) {
    const S = game.state();
    if (S.phase !== "play" || S.turn !== HUMAN || S.busy) return;

    if (S.arming) {
      if (!game.canArm(idx, HUMAN)) return;
      game.armTrap(idx, HUMAN);
      S.arming = false;
      view.render();
      return;
    }

    if (!legalMoves(S.bd, HUMAN).has(idx)) return;
    commitMove(idx, HUMAN, S.shieldOn);
  }

  btnArm.addEventListener("click", () => {
    const S = game.state();
    if (S.phase !== "play" || S.turn !== HUMAN || S.busy) return;
    if (S.arming) { S.arming = false; view.render(); return; }
    if (S.hand[HUMAN] <= 0 || S.armedThisTurn >= ARM_PER_TURN) return;
    S.arming = true;
    view.render();
  });

  btnShield.addEventListener("click", () => {
    const S = game.state();
    if (S.phase !== "play" || S.turn !== HUMAN || S.busy || S.arming) return;
    if (!S.shieldOn && S.shield[HUMAN] <= 0) return;
    game.toggleShield();
    view.render();
  });

  btnReset.addEventListener("click", startGame);

  // 難易度の変更は進行中の対局には反映しない（方針と局面が食い違うのを防ぐ）。
  // 選択を控えておき、次の startGame で確定する。注記の更新のためだけに再描画する。
  selLevel.addEventListener("change", view.render);

  /**
   * 新規対局を開始する。選択中の難易度をこの対局に確定させる。
   */
  function startGame() {
    cpu.setLevel(selLevel.value);
    game.newGame();
    view.buildBoard(onCell);
    view.render();
  }

  selLevel.value = TO.config.CPU_LEVEL_DEFAULT;
  startGame();
})();
