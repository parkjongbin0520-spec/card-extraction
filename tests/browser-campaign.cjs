/* With a static server and Playwright: GAME_URL=http://localhost:8000 node tests/browser-campaign.cjs */
"use strict";
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/game.js*", async (r) => {
    const res = await r.fetch();
    await r.fulfill({
      response: res,
      body: (await res.text()).replace(
        /\}\)\(\);\s*$/,
        "window.__campaignTest={state,save,screens,cardFor,playCard,projection,endTurn,resolveEnemyTurn,reroll,persist,showMaintenance};})();",
      ),
    });
  });
  await p.goto(process.env.GAME_URL || "http://localhost:8000");
  await p.locator('[data-page="settings"]').click();
  await p.locator('[data-setting="sound"]').check();
  await p.locator('[data-setting="scale"]').fill("1.1");
  await p.reload();
  assert.equal(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("deadhand-save-v2")).campaign.settings
          .scale,
    ),
    1.1,
  );
  await p.locator('[data-page="base"]').click();
  assert.equal(
    await p.locator('[data-container="stash"] .empty-slot').count(),
    60,
  );
  const first = await p
    .locator('[data-container="pack"] [data-entry]')
    .first()
    .getAttribute("data-entry");
  await p
    .locator(`[data-entry="${first}"]`)
    .dragTo(p.locator('[data-container="stash"] h3'));
  assert.equal(
    await p.locator('[data-container="stash"] [data-entry]').count(),
    1,
  );
  await p.locator(`[data-container="stash"] [data-entry="${first}"]`).click();
  await p.locator('.storage-panel [data-transfer="pack"]').click();
  assert.equal(
    await p.locator('[data-container="pack"] [data-entry]').count(),
    12,
  );
  await p.locator('.base-tabs [data-tab="build"]').click();
  await p.locator('[data-build="shop"]').click();
  await p.locator('[data-build="forge"]').click();
  await p.locator('.base-tabs [data-tab="shop"]').click();
  await p.locator('[data-quest="return"]').click();
  await p.locator('.base-tabs [data-tab="warehouse"]').click();
  await p.locator('.money-controls [data-action="deploy"]').click();
  await p.locator("#route-standard").click();
  console.log(
    "PASS menu/settings persist, 60-cell storage, actual drag/tap transfers, free construction and quest acceptance",
  );
  let steps = 0;
  while (steps++ < 260) {
    const result = await p.evaluate(() => {
      const t = __campaignTest,
        s = t.state;
      if (s.mode === "reward") return "reward";
      if (["cleared", "won", "dead", "maintenance"].includes(s.mode))
        return s.mode;
      if (s.phase === "enemy") return "enemy";
      if (s.mode !== "combat") return s.mode;
      const plays = [];
      s.hand.forEach((ref, index) => {
        const c = t.cardFor(ref);
        for (const e of s.enemies.filter((e) => e.hp > 0)) {
          const v = t.projection(c, e);
          if (!v.ok) continue;
          const damage = v.targets.reduce((n, x) => n + x.expectedDamage, 0),
            kill = v.targets.reduce((n, x) => n + x.killChance, 0),
            saving = v.forecast
              ? CombatRules.forecast(s).damage - v.forecast.damage
              : 0;
          const score =
            damage +
            kill * 10 +
            Math.min(v.heal, s.maxHp - s.hp) * 0.7 +
            Math.max(0, saving) * 0.85 +
            (s.hand.length < 6 ? v.draw * 3 : 0) +
            v.energyGain * 5;
          if (score > 0)
            plays.push({
              index,
              target: e.id,
              score: score / Math.max(1, v.energyCost),
            });
        }
      });
      plays.sort((a, b) => b.score - a.score);
      const best = plays[0];
      if (best)
        t.playCard(
          best.index,
          s.enemies.find((e) => e.id === best.target),
        );
      else if (!s.draw.length && s.discard.length) t.reroll();
      else t.endTurn();
      const piles = [...s.hand, ...s.draw, ...s.discard];
      if (piles.length !== s.bag.length || new Set(piles).size !== piles.length)
        throw Error("pile UID conservation");
      return "played";
    });
    if (result === "enemy") {
      await p.waitForTimeout(450);
      continue;
    }
    if (result === "reward") {
      await p.locator("#open-chest").click();
      continue;
    }
    if (result === "maintenance") {
      await p.locator("[data-offer]").first().click();
      const ids = await p.evaluate(() =>
        __campaignTest.state.fieldLoot.filter((id) =>
          ["cash", "scrap"].includes(__campaignTest.state.items[id].templateId),
        ),
      );
      for (const id of ids)
        await p.locator(`[data-loot-id="${id}"][data-side="loot"]`).click();
      const before = await p.evaluate(
        () => __campaignTest.state.maintenanceTurns,
      );
      await p.locator("#confirm-loot").click();
      assert.equal(
        await p.evaluate(() => __campaignTest.state.maintenanceTurns),
        before - 1,
      );
      // Reload after a committed transfer: no repeated reward rolls or duplicated cash.
      const snap = await p.evaluate(() => ({
        cash: __campaignTest.state.loot,
        bag: __campaignTest.state.bag,
        turns: __campaignTest.state.maintenanceTurns,
      }));
      await p.reload();
      await p.locator('[data-action="resume"]').click();
      assert.deepEqual(
        await p.evaluate(() => ({
          cash: __campaignTest.state.loot,
          bag: __campaignTest.state.bag,
          turns: __campaignTest.state.maintenanceTurns,
        })),
        snap,
      );
      await p.locator(".modal details").evaluate((n) => (n.open = true));
      for (let i = 0; i < 2; i++) {
        const available = p.locator("[data-maint-card]:not(:disabled)");
        if (await available.count()) await available.first().click();
        else await p.locator("#finish-maintenance").click();
      }
      await p.locator("#extract-btn").waitFor();
      assert.equal(
        await p.evaluate(() => __campaignTest.state.mode),
        "cleared",
      );
      continue;
    }
    if (result === "cleared") {
      const zone = await p.evaluate(() => __campaignTest.state.zone);
      if (zone < 2) {
        if (zone === 0) {
          await p.locator("#field-shop-btn").click();
          const cash = await p.evaluate(() => __campaignTest.state.loot);
          await p.locator('[data-field-buy="medkit"]').click();
          assert.equal(
            await p.evaluate(() => __campaignTest.state.loot),
            cash - 45,
          );
          const sellId = await p.evaluate(() =>
            __campaignTest.state.packItems.at(-1),
          );
          await p.locator(`[data-field-sell="${sellId}"]`).click();
          await p.locator('[data-field-buy="card:heal"]').click();
          const bought = await p.evaluate(() =>
            __campaignTest.state.bag.at(-1),
          );
          await p.locator(`[data-field-sell="${bought}"]`).click();
          await p.locator("#modal details").evaluate((n) => (n.open = true));
          await p.locator('[data-field-quest="supply"]').click();
          await p.locator("#back-map").click();
        } else {
          await p.locator("#field-shop-btn").click();
          await p.locator("#modal details").evaluate((n) => (n.open = true));
          await p.locator('[data-field-quest="supply"]').click();
          assert.equal(
            await p.evaluate(() => __campaignTest.save.campaign.quests.supply),
            "done",
          );
          await p.locator("#back-map").click();
        }
        await p.locator("#descend-btn").click();
        await p.locator("#route-supply").click();
      } else await p.locator("#extract-btn").click();
      continue;
    }
    if (result === "won") break;
    if (result === "dead") throw Error("autoplay died");
  }
  assert.equal(await p.evaluate(() => __campaignTest.state.mode), "won");
  assert.equal(await p.evaluate(() => __campaignTest.save.runs), 1);
  assert.equal(await p.evaluate(() => __campaignTest.save.campaign.run), null);
  assert.equal(
    await p.evaluate(
      () => __campaignTest.save.instances.filter((x) => x.unstable).length,
    ),
    0,
  );
  await p.locator("#home-btn").click();
  await p.locator('[data-action="deposit"]').click();
  await p.locator('.base-tabs [data-tab="shop"]').click();
  await p.locator('[data-quest="return"]').click();
  assert.equal(
    await p.evaluate(() => __campaignTest.save.campaign.capacity),
    72,
  );
  for (let i = 0; i < 3; i++)
    await p.locator('[data-buy="card:pierce"]').click();
  await p.locator('.base-tabs [data-tab="forge"]').click();
  const rare = await p.evaluate(() =>
    __campaignTest.save.instances
      .filter((x) => x.templateId === "pierce" && x.rarity === "rare")
      .slice(-3)
      .map((x) => x.uid),
  );
  for (const id of rare) await p.locator(`[data-entry="${id}"]`).click();
  await p.locator("#forge-risk").selectOption("1");
  await p.locator('[data-action="promote"]').click();
  const made = await p.evaluate(
    (id) => __campaignTest.save.instances.find((x) => x.uid === id),
    rare[0],
  );
  assert.equal(made.rarity, "epic");
  assert.equal(made.options.length, 2);
  assert.equal(made.risks.length, 1);
  await p.locator('.base-tabs [data-tab="upgrades"]').click();
  await p.locator('[data-upgrade="health"]').click();
  assert.equal(
    await p.evaluate(() => __campaignTest.save.campaign.upgrades.health),
    1,
  );
  console.log(
    "PASS real 3-region extraction, per-action maintenance, resume without duplicate loot, field trader, quest reward, 3-card risk promotion and material upgrade",
  );
  await p.locator('.base-tabs [data-tab="warehouse"]').click();
  await p.locator('.money-controls [data-action="deploy"]').click();
  await p.locator("#route-standard").click();
  const stable = await p.evaluate(() => __campaignTest.state.bag.length);
  await p.evaluate(() => {
    __campaignTest.state.hp = 1;
    __campaignTest.endTurn();
  });
  await p.locator("#home-btn").waitFor();
  assert.equal(await p.evaluate(() => __campaignTest.state.mode), "dead");
  assert.equal(
    await p.evaluate(() => __campaignTest.save.campaign.pack.length),
    stable,
  );
  assert.equal(
    await p.evaluate(
      () =>
        Object.values(__campaignTest.save.campaign.equipment).filter(Boolean)
          .length,
    ),
    0,
  );
  assert.equal(await p.evaluate(() => __campaignTest.save.campaign.cash), 0);
  console.log(
    "PASS death settlement protects stable cards and warehouse while removing carried equipment and cash",
  );
  assert.deepEqual(errors, []);
  await b.close();
  console.log("PASS no browser errors");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
