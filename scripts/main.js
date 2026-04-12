import { ChiliCatcherApp } from "./app.js";
const MODULE_ID = "chili-catcher";

Hooks.once("init", async () => {
  game.settings.register(MODULE_ID, "leaderboard", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Register API early
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    const api = {
      open: (opts={}) => { const app = new ChiliCatcherApp(opts); app.render(true); return app; }
    };
    mod.api = api;
    game.chiliCatcher = api;
  }
});

Hooks.once("ready", () => {
  console.log(`[${MODULE_ID}] socket ready as ${game.user.name} (GM=${game.user.isGM})`);

  // Ensure API is available (backup registration)
  const mod = game.modules.get(MODULE_ID);
  if (mod && !mod.api) {
    const api = {
      open: (opts={}) => { const app = new ChiliCatcherApp(opts); app.render(true); return app; }
    };
    mod.api = api;
    game.chiliCatcher = api;
  }

  // Socket relay
  game.socket.on(`module.${MODULE_ID}`, async (data) => {
    if (!data || !data.type) return;

    if (data.type === "submitScore" && game.user.isGM) {
      await saveScore(data.payload, data.requestId);
      if (data.senderId && data.requestId) {
        game.socket.emit(`module.${MODULE_ID}`, { type: "ackSubmit", requestId: data.requestId, to: data.senderId });
      }
    }

    if (data.type === "ackSubmit") {
      if (data.to && data.to !== game.user.id) return;
      Hooks.callAll(`${MODULE_ID}:ackSubmit`, data);
    }

    if (data.type === "leaderboardUpdated") {
      Hooks.callAll(`${MODULE_ID}:leaderboardUpdated`);
    }
  });

  // ChatMessage fallback relay
  Hooks.on("createChatMessage", async (msg) => {
    try {
      const flag = msg.getFlag(MODULE_ID, "score");
      if (!flag) return;
      if (!game.user.isGM) return;
      await saveScore(flag.payload, flag.requestId);
      // Clean up message to keep chat clear
      msg.delete?.();
    } catch (e) {
      console.error(`[${MODULE_ID}] GM chat relay failed`, e);
    }
  });

  async function saveScore(payload, requestId) {
    try {
      const current = game.settings.get(MODULE_ID, "leaderboard") ?? [];
      if (requestId && current.some(e => e.rid === requestId)) return;
      current.push({
        rid: requestId ?? null,
        actorId: payload.actorId ?? null,
        name: payload.name,
        img: payload.img,
        score: payload.score,
        ts: Date.now()
      });
      current.sort((a,b) => b.score - a.score);
      await game.settings.set(MODULE_ID, "leaderboard", current.slice(0, 15));
      console.log(`[${MODULE_ID}] GM stored score for ${payload.name}: ${payload.score}`);
      game.socket.emit(`module.${MODULE_ID}`, { type: "leaderboardUpdated" });
    } catch (err) {
      console.error(`[${MODULE_ID}] GM failed to store score`, err);
    }
  }
});


// Auto-create ChiliCatcher macro for GMs
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  const startName = "ChiliCatcher: Start";
  const baseIcon = `modules/${MODULE_ID}/assets/chili.svg`;

  const startCmd = `(() => {
    const api = game.modules.get("${MODULE_ID}")?.api;
    if (api?.open) api.open();
    else ui.notifications.error(game.i18n.localize("CHILI-CATCHER.Notifications.NotReady"));
  })();`;

  try {
    // Start macro
    let m1 = game.macros?.getName(startName);
    if (!m1) {
      await Macro.create({ name: startName, type: "script", command: startCmd, img: baseIcon }, { renderSheet: false });
    } else {
      const upd = {};
      if (m1.command !== startCmd) upd.command = startCmd;
      if (m1.img !== baseIcon) upd.img = baseIcon;
      if (Object.keys(upd).length) await m1.update(upd);
    }

    // Remove old clear macro if it exists
    const oldClearName = "ChiliCatcher: Bestenliste löschen";
    const oldMacro = game.macros?.getName(oldClearName);
    if (oldMacro) {
      await oldMacro.delete();
      console.log(`[${MODULE_ID}] Removed old clear leaderboard macro`);
    }
  } catch (e) {
    console.error(`[${MODULE_ID}] Macro create/update failed`, e);
  }
});
