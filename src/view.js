/* view.js — 描画とアニメーション。状態は読むだけで、対局ロジックを持たない。 */
(function () {
  "use strict";
  const TO = window.TO;
  const { EMPTY, BLACK, WHITE, HUMAN, CPU, TRAPS_HAND, SHIELD_COUNT, ARM_PER_TURN, ARM_FROM_PLY } = TO.config;
  const { legalMoves, counts } = TO.rules;
  const game = TO.game;

  const boardEl = document.getElementById("board");
  const phaseEl = document.getElementById("phase");
  const logEl = document.getElementById("log");
  const bannerEl = document.getElementById("banner");
  const btnArm = document.getElementById("btnArm");
  const btnShield = document.getElementById("btnShield");
  const btnReset = document.getElementById("btnReset");
  const selLevel = document.getElementById("selLevel");
  const levelNote = document.getElementById("levelNote");

  /** 難易度IDの表示名 */
  const LEVEL_LABEL = { beginner: "初級", intermediate: "中級", advanced: "上級" };

  /** バナーの見出し・符号。bad＝踏んだ / good＝横取り成功 / safe＝見切り成功 */
  const BANNER_TEXT = {
    bad: ["罠 に か か っ た", "−"],
    good: ["罠 発 動", "+"],
    safe: ["見 切 り 成 功", "+"],
  };

  /**
   * 盤の 64 マスを生成し、クリックハンドラを結線する。
   * @param {(idx:number)=>void} onCell - マスがクリックされたときに呼ぶ
   */
  function buildBoard(onCell) {
    boardEl.innerHTML = "";
    for (let i = 0; i < 64; i++) {
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.i = i;
      d.addEventListener("click", () => onCell(i));
      boardEl.appendChild(d);
    }
  }

  /**
   * 盤・スコア・操作ボタン・ログを現在の状態から描き直す。
   */
  function render() {
    const S = game.state();
    const myTurn = S.phase === "play" && S.turn === HUMAN && !S.busy;
    const moves = myTurn && !S.arming ? legalMoves(S.bd, HUMAN) : new Map();
    boardEl.classList.toggle("arming", S.arming);
    boardEl.classList.toggle("shielded", S.shieldOn && !S.arming);

    btnShield.textContent = S.shieldOn ? "見切り 発動中" : "見切り（残" + S.shield[HUMAN] + "）";
    btnShield.classList.toggle("on", S.shieldOn);
    btnShield.disabled = !myTurn || S.arming || S.shield[HUMAN] <= 0;
    btnShield.style.display = S.phase === "over" ? "none" : "";

    renderBoard(S, moves);
    renderScore(S, myTurn);
    renderPhase(S, myTurn);
    renderLevel();

    logEl.innerHTML = S.logs.map((l) => '<div class="' + (l.cls || "") + '">' + l.t + "</div>").join("");
  }

  /**
   * 難易度セレクトの状態を反映する。選択中（次局の難易度）が今の対局の難易度
   * （`cpu.level()`・startGame で確定）と食い違っていれば、次局から反映される旨を注記する。
   */
  function renderLevel() {
    const selected = selLevel.value;
    levelNote.textContent =
      selected !== TO.cpu.level() ? "「" + LEVEL_LABEL[selected] + "」は次の「最初から」で反映されます。" : "";
  }

  /**
   * 盤面のマスと石を更新する。
   * @param {Object} S - 対局状態
   * @param {Map<number, number[]>} moves - 着手可能マス
   */
  function renderBoard(S, moves) {
    for (let i = 0; i < 64; i++) {
      const el = boardEl.children[i];
      el.className = "cell";
      if (S.fired.has(i)) el.classList.add("fired");
      if (S.trap[HUMAN].has(i)) el.classList.add("mytrap");
      if (S.arming && game.canArm(i, HUMAN)) el.classList.add("selectable");
      if (moves.has(i)) el.classList.add("playable");
      if (i === S.last) el.classList.add("last");
      if (S.stolen.has(i)) el.classList.add("stolen");

      const want = S.bd[i];
      let disc = el.querySelector(".disc");
      if (want === EMPTY) { if (disc) disc.remove(); continue; }
      if (!disc) {
        disc = document.createElement("div");
        disc.className = "disc pop";
        el.appendChild(disc);
      } else {
        const anim = S.stolen.has(i) ? "stolen" : (S.preview && S.preview.has(i) ? "preview" : null);
        // 同じアニメーションを再生し直すため、一度外して reflow を挟む
        if (anim) { disc.classList.remove("stolen", "preview"); void disc.offsetWidth; disc.classList.add(anim); }
      }
      disc.classList.remove("b", "w");
      disc.classList.add(want === BLACK ? "b" : "w");
    }
  }

  /**
   * 石数・罠の手札・見切り残数を更新する。
   * @param {Object} S - 対局状態
   * @param {boolean} myTurn - 人間の操作可能な手番か
   */
  function renderScore(S, myTurn) {
    const [b, w] = counts(S.bd);
    document.getElementById("nB").textContent = b;
    document.getElementById("nW").textContent = w;
    const dots = (n, t) => "◆".repeat(n) + "◇".repeat(Math.max(0, t - n));
    const shTxt = (c) => '<span class="sh' + (S.shield[c] ? " on" : "") + '">見切り ' +
      ("●".repeat(S.shield[c]) + "○".repeat(SHIELD_COUNT - S.shield[c])) + "</span>";
    const eB = document.getElementById("trB"), eW = document.getElementById("trW");
    eB.innerHTML = "手札 " + dots(S.hand[BLACK], TRAPS_HAND) + "  伏 " + S.trap[BLACK].size + "<br>" + shTxt(BLACK);
    eB.className = "tr" + (S.hand[BLACK] || S.trap[BLACK].size ? " on" : "");
    eW.innerHTML = "手札 " + dots(S.hand[WHITE], TRAPS_HAND) + "  伏 " + S.trap[WHITE].size + "（不明）<br>" + shTxt(WHITE);
    eW.className = "tr" + (S.hand[WHITE] || S.trap[WHITE].size ? " on" : "");
    document.getElementById("scB").classList.toggle("active", myTurn);
    document.getElementById("scW").classList.toggle("active", S.phase === "play" && S.turn === CPU);
  }

  /**
   * 手番の案内文と「罠を仕掛ける」ボタンを更新する。
   * @param {Object} S - 対局状態
   * @param {boolean} myTurn - 人間の操作可能な手番か
   */
  function renderPhase(S, myTurn) {
    const [b, w] = counts(S.bd);
    if (S.phase === "over") {
      phaseEl.innerHTML = "<b>終了</b> — " + (b > w ? "あなたの勝ち" : b < w ? "CPUの勝ち" : "引き分け") + "　" + b + " - " + w;
      btnArm.style.display = "none";
    } else if (S.arming) {
      phaseEl.innerHTML = '<b>罠を伏せる</b><br>空きマスをクリック。<br><span style="color:var(--muted)">相手の手が大きいほど横取りも大きい。</span>';
      btnArm.textContent = "やめる"; btnArm.disabled = false; btnArm.style.display = "";
    } else if (myTurn) {
      const canA = S.hand[HUMAN] > 0 && S.armedThisTurn < ARM_PER_TURN && S.ply >= ARM_FROM_PLY;
      phaseEl.innerHTML = "<b>あなたの手番</b><br>" +
        (S.ply < ARM_FROM_PLY
          ? "罠は " + ARM_FROM_PLY + " 手目から設置可能（あと" + (ARM_FROM_PLY - S.ply) + "手）。"
          : "石を置く前に罠を1個まで伏せられます。") +
        (S.trap[CPU].size ? '<br><span style="color:var(--gold)">CPUの罠が ' + S.trap[CPU].size + " 個、どこかに伏せてある。</span>" : "") +
        (S.shieldOn ? '<br><span style="color:#6fc9f0">見切り発動中 — この手番に踏んだ罠は解除される。</span>' : "");
      btnArm.textContent = "罠を仕掛ける（残り" + S.hand[HUMAN] + "）";
      btnArm.disabled = !canA; btnArm.style.display = "";
    } else {
      phaseEl.innerHTML = "<b>CPU 思考中…</b>";
      btnArm.disabled = true; btnArm.style.display = "";
    }
  }

  /**
   * 罠の結果を大きく告知する。
   * @param {"bad"|"good"|"safe"} kind - 告知の種類
   * @param {number} n - 動いた石の枚数
   * @param {string} cell - 対象マスの表記（a1 形式）
   */
  function showBanner(kind, n, cell) {
    const T = BANNER_TEXT[kind];
    document.getElementById("bnrTtl").textContent = T[0];
    document.getElementById("bnrAmt").textContent = T[1] + n;
    document.getElementById("bnrSub").textContent =
      kind === "safe"
        ? cell + " ／ 罠を解除　" + n + "枚をそのまま確保"
        : cell + " ／ " + n + "枚が" + (kind === "good" ? "こちらのもの" : "奪われた") + "　差 " + T[1] + n * 2;
    bannerEl.className = "banner " + kind;
    void bannerEl.offsetWidth; // アニメーションを再生し直す
    bannerEl.classList.add("show");
    if (kind === "bad") {
      boardEl.classList.add("shake");
      setTimeout(() => boardEl.classList.remove("shake"), 450);
    }
  }

  TO.view = { buildBoard, render, showBanner, els: { btnArm, btnShield, btnReset, selLevel } };
})();
