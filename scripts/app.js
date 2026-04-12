const MODULE_ID = "chili-catcher";
const MUSIC_PATH = `modules/${MODULE_ID}/assets/chili.mp3`;

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const esc = (s) => String(s ?? "")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;");

export class ChiliCatcherApp extends HandlebarsApplicationMixin(ApplicationV2) {

  gameState = "start"; // "start", "gaming", "gameover"

  static DEFAULT_OPTIONS = {
    id: "chili-catcher-app",
    classes: ["chili-catcher"],
    tag: "div",
    window: {
      title: "CHILI-CATCHER.Title",
      resizable: true
    },
    position: {
      width: 960,
      height: 840
    },
    actions: {
      start: ChiliCatcherApp.#onStart,
      retry: ChiliCatcherApp.#onRetry,
      clearLeaderboard: ChiliCatcherApp.#onClearLeaderboard
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/app.hbs`
    }
  };

  async _prepareContext(options) {
    return {
      isStart: this.gameState === "start",
      isGaming: this.gameState === "gaming",
      isGameOver: this.gameState === "gameover",
      isGM: game.user.isGM,
      i18n: {
        startButton: game.i18n.localize("CHILI-CATCHER.StartButton"),
        retryButton: game.i18n.localize("CHILI-CATCHER.RetryButton"),
        clearLeaderboard: game.i18n.localize("CHILI-CATCHER.ClearLeaderboard"),
        gameOver: game.i18n.localize("CHILI-CATCHER.GameOver"),
        score: game.i18n.localize("CHILI-CATCHER.Score"),
        leaderboard: game.i18n.localize("CHILI-CATCHER.Leaderboard"),
        redChili: game.i18n.localize("CHILI-CATCHER.Legend.RedChili"),
        blackChili: game.i18n.localize("CHILI-CATCHER.Legend.BlackChili"),
        bug: game.i18n.localize("CHILI-CATCHER.Legend.Bug")
      }
    };
  }

  _onRender(context, options) {
    this._refreshLeaderboardPanel();

    if (this.gameState === "gaming") {
      // If the game stage is now in the DOM, boot the game engine.
      if (!this._pixi) {
        requestAnimationFrame(() => this._initializeGame());
      } else {
        // This is a retry, just restart the round.
        requestAnimationFrame(() => this._restartRound());
      }
    }

    if (this.gameState === "gameover") {
      const finalScoreEl = this.element.querySelector("#final-score");
      if (finalScoreEl) finalScoreEl.textContent = this._score ?? 0;
    }
  }

  _onClose(options) {
    try { this._music?.stop?.(); } catch(e) {}
    try { this._ro?.disconnect?.(); } catch(e) {}
    this._clearRound();
  }

  _startMusic() {
    try { this._music?.stop?.(); } catch(e) {}
    const src = MUSIC_PATH;
    if (typeof Howl !== "undefined") {
      try {
        const hl = new Howl({ src: [src], volume: 0.0, loop: true, autoplay: true });
        this._music = {
          _h: hl,
          stop: () => { try { hl.stop(); hl.unload(); } catch(e) {} },
          fade: (from, to, dur) => { try { hl.volume(from); hl.fade(from, to, dur); } catch(e) {} },
          setRate: (rate) => { try { hl.rate(rate); } catch(e) {} }
        };
        this._music.fade?.(0.0, 0.25, 1000);
        return;
      } catch(e) {}
    }
    // Fallback to Audio API
    try {
      const audio = new Audio(src);
      audio.loop = true;
      audio.volume = 0.0;
      audio.play().catch(()=>{});
      this._music = {
        _a: audio,
        stop: () => { try { audio.pause(); audio.currentTime = 0; } catch(e) {} },
        fade: (from, to, dur) => {
          try {
            audio.volume = from;
            const steps = 30;
            const step = (to - from) / steps;
            const iv = Math.max(16, Math.floor(dur / steps));
            let i = 0;
            const timer = setInterval(() => {
              i++;
              let v = audio.volume + step;
              v = v < 0 ? 0 : v > 1 ? 1 : v;
              audio.volume = v;
              if (i >= steps) clearInterval(timer);
            }, iv);
          } catch(e) {}
        },
        setRate: (rate) => { try { audio.playbackRate = rate; } catch(e) {} }
      };
      this._music.fade?.(0.0, 0.25, 1000);
    } catch(e) {}
  }

  _updateMusicRate() {
    if (!this._music?.setRate) return;
    const rate = 1.0 + Math.min(Math.max(this._score, 0) * 0.003, 0.3);
    this._music.setRate(rate);
  }

  async _initializeGame() {
    const html = this.element;
    Hooks.on(`${MODULE_ID}:leaderboardUpdated`, () => this._refreshLeaderboardPanel());

    const host = html.querySelector("#chili-stage");
    if (!host) return; // Should not happen if gameState is correct

    const setupPixi = () => {
      const w = Math.max(640, Math.floor(host.clientWidth || 960));
      const h = Math.floor(w * 9/16);
      if (!this._pixi) {
        const app = new PIXI.Application({ width: w, height: h, backgroundAlpha: 0 });
        host.insertBefore(app.view, host.firstChild);
        this._pixi = app;
        this._buildPixelBackground(app);
        this._setupPlayer(app);
      } else {
        this._pixi.renderer.resize(w, h);
        this._redrawBackground?.();
        this._positionPlayer();
      }
    };

    this._ro = new ResizeObserver(() => setupPixi());
    this._ro.observe(host);
    setupPixi();
    
    // Now that the game is set up, start the first round.
    this._startRound();
  }

  async _setupPlayer(app) {
    const { sprite, shadow, meta } = await this._createPlayerSprite(app);
    this._player = sprite; this._shadow = shadow; this._playerMeta = meta;
    this._positionPlayer();
  }

  _positionPlayer() {
    if (!this._pixi || !this._player || !this._shadow) return;
    const app = this._pixi;
    const groundY = app.renderer.height - 60;
    this._player.y = groundY;
    this._shadow.y = app.renderer.height - 20;
    this._player.x = this._shadow.x = app.renderer.width / 2;

    const canvasEl = app.view;
    if (!this._dragBound) {
      let dragging = false;
      const onPointerMove = (ev) => {
        if (!dragging) return;
        this._moveToEvent(app, this._player, ev, groundY);
        this._shadow.x = this._player.x;
      };
      const stopDrag = () => dragging = false;

      canvasEl.addEventListener("pointerdown", (ev) => {
        dragging = true;
        canvasEl.setPointerCapture?.(ev.pointerId);
        onPointerMove(ev);
      });
      canvasEl.addEventListener("pointermove", onPointerMove);
      canvasEl.addEventListener("pointerup", stopDrag);
      canvasEl.addEventListener("pointerleave", stopDrag);
      canvasEl.addEventListener("pointercancel", stopDrag);
      this._dragBound = true;
    }
  }

  _moveToEvent(app, player, ev, yFixed) {
    const rect = app.view.getBoundingClientRect();
    const x = Math.max(30, Math.min(app.renderer.width - 30, ev.clientX - rect.left));
    player.x = x; player.y = yFixed;
  }

  async _createPlayerSprite(app) {
    const token = canvas?.tokens?.controlled?.[0];
    let img, name, actorId;
    const defaultPlayer = game.i18n.localize("CHILI-CATCHER.DefaultPlayer");
    if (token) {
      img = token.document.texture.src || token.document.texture?.src;
      name = token.name;
      actorId = token.actor?.id ?? null;
    }
    else if (game.user?.character) {
      img = game.user.character.prototypeToken?.texture?.src || game.user.character.img;
      name = game.user.character.name;
      actorId = game.user.character.id;
    }
    else {
      img = "icons/svg/mystery-man.svg";
      name = game.user?.name ?? defaultPlayer;
      actorId = null;
    }
    const tx = await PIXI.Assets.load(img);
    const sprite = new PIXI.Sprite(tx);
    const maxW = 64; const scale = Math.min(1, maxW / sprite.width);
    sprite.scale.set(scale); sprite.anchor.set(0.5, 0.5); sprite.x = 0;

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.14).drawEllipse(0,0, 48, 8).endFill();
    this._pixi.stage.addChild(shadow); this._pixi.stage.addChild(sprite);
    return { sprite, shadow, meta: { img, name, actorId } };
  }

  static #onStart(event, target) {
    this.gameState = "gaming";
    this.render();
  }

  static #onRetry(event, target) {
    this.gameState = "gaming";
    this.render();
  }

  static async #onClearLeaderboard(event, target) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("CHILI-CATCHER.Notifications.GMOnly"));
      return;
    }
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("CHILI-CATCHER.Dialog.ClearTitle") },
      content: `<p>${game.i18n.localize("CHILI-CATCHER.Dialog.ClearContent")}</p>`,
      yes: { default: false },
      no: { default: true }
    });
    if (!confirmed) return;
    await game.settings.set(MODULE_ID, "leaderboard", []);
    game.socket.emit(`module.${MODULE_ID}`, { type: "leaderboardUpdated" });
    ui.notifications.info(game.i18n.localize("CHILI-CATCHER.Notifications.LeaderboardCleared"));
  }

  _startRound() {
    const html = this.element;
    this._clearRound();

    this._score = 0; html.querySelector("#chili-score").textContent = this._score;
    this._remain = 60; html.querySelector("#chili-timer").textContent = this._remain;

    try { this._music?.stop?.(); this._startMusic(); } catch(e) {}

    const app = this._pixi;
    const items = this._items = new Set();
    const randX = () => Math.random() * (app.renderer.width - 60) + 30;
    const rand = (min, max) => Math.random() * (max - min) + min;
    const getSpeedMultiplier = () => 1.0 + Math.min(Math.max(this._score, 0) * 0.01, 1.0);

    const spawnRed = () => {
      const g = this._drawChili(0xff3a2e, 0xd21e12);
      g.x = randX(); g.y = -30; g.vy = rand(2.0, 3.0) * getSpeedMultiplier(); g.points = 1; g.rotation = rand(-0.12, 0.12);
      app.stage.addChild(g); items.add(g);
    };
    const spawnBlack = () => {
      const g = this._drawChili(0x2b2b2b, 0x101010);
      g.x = randX(); g.y = -30; g.vy = rand(4.0, 6.1) * getSpeedMultiplier(); g.points = 3; g.rotation = rand(-0.18, 0.18);
      app.stage.addChild(g); items.add(g);
    };
    const spawnBug = () => {
      const g = this._drawBug([0x7ac943, 0xffc20e, 0x5ec0f6, 0xb83df6].at(Math.floor(Math.random()*4)));
      g.x = randX(); g.y = -30; g.vy = rand(2.8, 4.0) * getSpeedMultiplier(); g.points = -2; g.rotation = rand(-0.08, 0.08);
      app.stage.addChild(g); items.add(g);
    };
    this._spawners = [ setInterval(spawnRed, 520), setInterval(spawnBlack, 1350), setInterval(spawnBug, 880) ];

    this._alive = true;
    const tick = (delta) => {
      if (!this._alive) return;
      for (const s of Array.from(items)) {
        s.y += s.vy * delta;
        if (s.y > app.renderer.height + 40) { app.stage.removeChild(s); items.delete(s); continue; }
        if (this._intersects(this._player, s)) {
          this._addScore(s.points);
          this._popEffect(app, s.x, s.y, s.points >= 0 ? 0x3cf27a : 0xff5555);
          app.stage.removeChild(s); items.delete(s);
        }
      }
    };
    app.ticker.add(tick); this._tickerFn = tick;

    this._timer = setInterval(() => {
      this._remain -= 1; this.element.querySelector("#chili-timer").textContent = this._remain;
      if (this._remain <= 0) this._endRound();
    }, 1000);
  }

  _endRound() {
    if (!this._alive) return;
    this._alive = false;
    this._clearRound();
    try { this._music?.fade?.(0.25, 0.0, 800); setTimeout(()=>this._music?.stop?.(), 820); } catch(e) { try { this._music?.stop?.(); } catch(_) {} }
    
    this._submitScore(this._playerMeta, this._score).then((ok) => {
      if (!ok) {
        console.warn(`[${MODULE_ID}] ${game.i18n.localize("CHILI-CATCHER.Notifications.NoGMResponse")}`);
        setTimeout(() => this._refreshLeaderboardPanel(), 1200);
      }
    });

    this.gameState = "gameover";
    this.render();
  }

  _restartRound() {
    for (const s of Array.from(this._items ?? [])) this._pixi.stage.removeChild(s);
    this._items = new Set();
    this._startRound();
  }

  _clearRound() {
    this._alive = false;
    this._spawners?.forEach(clearInterval);
    this._spawners = [];
    if (this._pixi && this._tickerFn) this._pixi.ticker.remove(this._tickerFn);
    clearInterval(this._timer);
  }

  _addScore(delta) {
    this._score += delta;
    this.element.querySelector("#chili-score").textContent = this._score;
    const wrap = this.element.querySelector(".hud.score");
    wrap.classList.add("flash");
    setTimeout(() => wrap.classList.remove("flash"), 120);
    this._updateMusicRate();
  }

  _drawChili(colorLight, colorDark) {
    const g = new PIXI.Graphics();
    g.lineStyle(2, 0x000000, 0.15);
    g.beginFill(colorLight);
    g.moveTo(0,-24); g.bezierCurveTo(14,-22, 16,0, 0,24);
    g.bezierCurveTo(-16,0, -14,-22, 0,-24); g.endFill();
    g.beginFill(colorDark, 0.45);
    g.moveTo(6,-18); g.bezierCurveTo(12,-10, 12,4, 0,18);
    g.bezierCurveTo(6,8, 8,-6, 6,-18); g.endFill();
    g.beginFill(0x2f8f2f).drawEllipse(0,-20, 8,4).endFill();
    g.lineStyle(3, 0x2f8f2f).moveTo(0,-22).bezierCurveTo(6,-30, 12,-26, 13,-18);
    g.beginFill(0x3aa03a).drawEllipse(-6,-22, 5,3).endFill();
    g.beginFill(0xffffff, 0.25).drawEllipse(-5,-8, 4,9).endFill();
    return g;
  }

  _drawBug(color) {
    const g = new PIXI.Graphics();
    g.lineStyle(2, 0x000000, 0.15);
    g.beginFill(color).drawEllipse(0,0, 12, 16).endFill();
    g.lineStyle(1.5, 0x111111, 0.6).moveTo(0,-14).lineTo(0,14);
    g.beginFill(0x191919).drawCircle(0,-14, 6).endFill();
    g.beginFill(0xffffff).drawCircle(-2,-15,1.5).drawCircle(2,-15,1.5).endFill();
    g.lineStyle(2, 0x222222, 0.9);
    for (let i=-1; i<=1; i++) { g.moveTo(-10, i*6).lineTo(-16, i*6 - 3); g.moveTo(10, i*6).lineTo(16, i*6 - 3); }
    g.lineStyle(1.5, 0x222222).moveTo(-3,-20).lineTo(-6,-24).moveTo(3,-20).lineTo(6,-24);
    g.beginFill(0x000000, 0.25).drawCircle(-5,3,2).drawCircle(5,-2,2).endFill();
    return g;
  }

  _intersects(a, b) { const A = a.getBounds(); const B = b.getBounds(); return !(A.right < B.left || A.left > B.right || A.bottom < B.top || A.top > B.bottom); }

  _popEffect(app, x, y, color=0xffffff) {
    const g = new PIXI.Graphics();
    g.lineStyle(3, color).drawCircle(0,0, 4); g.x = x; g.y = y; app.stage.addChild(g);
    let life = 18;
    const tick = () => { life--; g.scale.set(1 + (18-life)/12); g.alpha = life/18; if (life<=0) { app.stage.removeChild(g); app.ticker.remove(tick); } };
    app.ticker.add(tick);
  }

  async _submitScore(meta, score) {
    const makeId = () => (foundry?.utils?.randomID?.() ?? (window.randomID ? window.randomID() : Math.random().toString(36).slice(2, 10)));
    const requestId = makeId();
    const defaultPlayer = game.i18n.localize("CHILI-CATCHER.DefaultPlayer");
    const payload = { actorId: meta.actorId ?? null, name: meta.name ?? game.user?.name ?? defaultPlayer, img: meta.img ?? "icons/svg/mystery-man.svg", score };

    if (game.user.isGM) {
      try {
        let current = game.settings.get(MODULE_ID, "leaderboard") ?? [];
        if (requestId && current.some(e => e.rid === requestId)) return true;
        current.push({ rid: requestId, actorId: payload.actorId, name: payload.name, img: payload.img, score, ts: Date.now() });
        current.sort((a,b)=> b.score - a.score);
        await game.settings.set(MODULE_ID, "leaderboard", current.slice(0,15));
        game.socket.emit(`module.${MODULE_ID}`, { type: "leaderboardUpdated" });
        return true;
      } catch (e) { console.error(`[${MODULE_ID}] GM set failed`, e); return false; }
    } else {
      const waitAck = new Promise((resolve) => {
        const onAck = (data) => { if (data.requestId === requestId) { Hooks.off(`${MODULE_ID}:ackSubmit`, onAck); resolve(true); } };
        Hooks.on(`${MODULE_ID}:ackSubmit`, onAck);
        game.socket.emit(`module.${MODULE_ID}`, { type: "submitScore", payload, senderId: game.user.id, requestId });
        setTimeout(() => { Hooks.off(`${MODULE_ID}:ackSubmit`, onAck); resolve(false); }, 2500);
      });
      if (await waitAck) return true;
      try {
        const gmIds = game.users.filter(u=>u.isGM).map(u=>u.id);
        await ChatMessage.create({
          speaker: { alias: "ChiliCatcher" },
          content: `<span style="display:none">score</span>`,
          whisper: gmIds,
          flags: { [MODULE_ID]: { score: { payload, requestId } } }
        }, { chatBubble: false });
        return true;
      } catch (e) { console.error(`[${MODULE_ID}] Chat fallback failed`, e); return false; }
    }
  }

  _buildPixelBackground(app) {
    const c = new PIXI.Container(); this._bg = c; app.stage.addChildAt(c, 0);
    this._redrawBackground = () => {
      c.removeChildren();
      const g = new PIXI.Graphics();
      const W = app.renderer.width, H = app.renderer.height, px = 4;
      const bands = [0xd3e1f1, 0xc7dbef, 0xbdd5ec, 0xb3cfeb, 0xa8c8e8];
      const bandH = Math.ceil(H*0.6 / bands.length);
      let y = 0; for (const col of bands) { g.beginFill(col).drawRect(0, y, W, bandH).endFill(); y += bandH; }
      const cloud = (cx, cy, s=1) => {
        g.beginFill(0xffffff, 0.9).drawRoundedRect(cx, cy, 22*s, 10*s, 2).endFill();
        g.beginFill(0xffffff, 0.9).drawRoundedRect(cx+6*s, cy-4*s, 16*s, 8*s, 2).endFill();
        g.beginFill(0xffffff, 0.9).drawRoundedRect(cx+12*s, cy, 16*s, 10*s, 2).endFill();
      };
      for (let i=0;i<7;i++) cloud(Math.floor(Math.random()*W*0.9), Math.floor(Math.random()*H*0.35)+8, 1+Math.random()*1.6);
      const groundH = Math.floor(H*0.24);
      g.beginFill(0x8f7f6b).drawRect(0, H-groundH, W, groundH).endFill();
      g.beginFill(0x7a6b58);
      for (let x=0; x<W; x+=px) if (Math.random()<0.18) g.drawRect(x, H-groundH + Math.floor(Math.random()*groundH/2), px, px);
      g.endFill();
      const rows = 3;
      for (let r=0; r<rows; r++) {
        const yBase = H - groundH - (rows-r)*Math.floor(18*px/8);
        for (let x=px*2; x<W; x+= Math.floor(36*px/8)) {
          g.beginFill(0x2d6b2d).drawRect(x, yBase-20, px, 20).endFill();
          g.beginFill(0x3fa03f).drawRect(x-px*2, yBase-16, px*3, px*2).drawRect(x+px, yBase-13, px*3, px*2).endFill();
          const fruitColor = (Math.random()<0.15) ? 0x202020 : 0xd93025;
          g.beginFill(fruitColor).drawRect(x+px*2, yBase-10, px*2, px*3).endFill();
          g.beginFill(0xffffff, 0.6).drawRect(x+px*2, yBase-9, px, px).endFill();
        }
      }
      c.addChild(g);
    };
    this._redrawBackground();
  }

  _refreshLeaderboardPanel() {
    const list = this.element.querySelector("#chili-leaderboard");
    if (!list) return;
    let board = [];
    try { board = game.settings.get(MODULE_ID, "leaderboard") ?? []; } catch(e) { board = []; }
    const unknownPlayer = game.i18n.localize("CHILI-CATCHER.UnknownPlayer");
    const noEntries = game.i18n.localize("CHILI-CATCHER.NoEntries");
    const rows = board.map((e, idx) => {
      const safe = esc(e.name ?? unknownPlayer); const img = e.img || "icons/svg/mystery-man.svg";
      return `<div class="cc-row"><div class="cc-rank">${idx+1}</div><img class="cc-avatar" src="${img}" alt="${safe}"><div class="cc-name">${safe}</div><div class="cc-score">${e.score}</div></div>`;
    }).join("") || `<div class="cc-empty">${noEntries}</div>`;
    list.innerHTML = rows;
  }
}
