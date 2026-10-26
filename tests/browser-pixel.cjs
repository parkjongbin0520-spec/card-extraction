/* GAME_URL=http://localhost:8025 node tests/browser-pixel.cjs (Playwright/Chromium). */
"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const base = (process.env.GAME_URL || "http://localhost:8000").replace(/\/$/, "");

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const errors = [], failed = [], oldArtwork = [];
  function observe(page, fallback = false) {
    page.on("pageerror", (error) => errors.push(error.message));
    if (!fallback) {
      page.on("response", (response) => {
        if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
      });
      page.on("request", (request) => {
        if (request.url().includes("/assets/generated/")) oldArtwork.push(request.url());
      });
    }
  }
  async function expose(page) {
    await page.route("**/game.js*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(/\}\)\(\);\s*$/, "window.__pixelQA={state,scene};})();"),
      });
    });
  }
  const sourcePage = await browser.newPage();
  observe(sourcePage);
  await sourcePage.goto(`${base}/assets.html?v=10`);
  const manifestResponse = await sourcePage.request.get(`${base}/assets/art-manifest.json?v=10`);
  assert.equal(manifestResponse.status(), 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.version, 10);
  assert.equal(manifest.files.length, 38);
  assert.equal(manifest.palette.length, 24);
  const imageChecks = await sourcePage.evaluate(async ({ files, palette }) => {
    const allowed = new Set(palette.map((color) => color.toLowerCase()));
    return Promise.all(files.map(async (file) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(Error(`Image failed: ${file.path}`));
        img.src = `${file.path}?v=10`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(img, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set(), invalid = new Set();
      let transparent = 0, partial = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) { transparent++; continue; }
        if (pixels[i + 3] !== 255) partial++;
        const color = "#" + [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
        colors.add(color);
        if (!allowed.has(color)) invalid.add(color);
      }
      return { path: file.path, width: img.naturalWidth, height: img.naturalHeight, colors: colors.size, invalid: [...invalid], transparent, partial };
    }));
  }, manifest);
  for (const check of imageChecks) {
    const name = check.path;
    const expected = /\/actors\/|\/props\//.test(name) ? [48, 72]
      : name.includes("/items/") ? [32, 32]
      : name.includes("/cards/") ? [96, 64]
      : name.endsWith("field-plates.png") ? [288, 72]
      : name.endsWith("weapon.png") ? [160, 125]
      : name.endsWith("operator.png") ? [32, 32] : [480, 270];
    assert.deepEqual([check.width, check.height], expected, name);
    assert.deepEqual(check.invalid, [], `${name}: colors outside the shared palette`);
    assert.equal(check.partial, 0, `${name}: partially transparent pixel edges`);
    if (/\/actors\//.test(name)) {
      assert.ok(check.colors >= 8 && check.colors <= 12, `${name}: ${check.colors} opaque colors`);
      assert.ok(check.transparent > 0, `${name}: no transparent silhouette`);
    }
  }
  console.log("PASS38 actual PNGs: native dimensions, shared24-color palette, binary alpha,8–12-color actors");

  await sourcePage.locator("img[loading=lazy]").evaluateAll((images) => images.forEach((img) => { img.loading = "eager"; }));
  await sourcePage.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth));
  assert.equal(await sourcePage.locator("figure img").count(), 51);
  assert.equal(await sourcePage.locator(".native-size").count(), 51);
  assert.equal(await sourcePage.locator(".palette i").count(), 24);
  assert.ok(await sourcePage.locator("figure img").evaluateAll((images) => images.every((img) => getComputedStyle(img).imageRendering === "pixelated" && img.src.includes("v=10"))));
  await sourcePage.locator("[data-filter=items]").click();
  assert.equal(await sourcePage.locator(".collection:visible").count(), 1);
  const zip = await sourcePage.request.get(`${base}/assets/cardkov-art-pack.zip?v=10`);
  assert.equal(zip.status(), 200);
  assert.equal((await zip.body()).subarray(0, 4).toString("hex"), "504b0304");
  console.log("PASS51 gallery images, native-size labels, category filter, versioned cache URLs and ZIP download");
  await sourcePage.close();

  async function model(page) {
    return page.evaluate(() => {
      const s = __pixelQA.state;
      return { energy: s.energy, hp: s.hp, shield: s.shield, hand: [...s.hand], discard: [...s.discard], enemyHp: s.enemies.map((e) => e.hp) };
    });
  }
  async function drag(page, kind, touch) {
    const template = { player: "guard", enemy: "shot", bag: "scan" }[kind];
    const card = page.locator(`#hand [data-card="${template}"]`).first();
    const uid = await card.getAttribute("data-instance");
    const grip = card.locator(".card-grip");
    await grip.scrollIntoViewIfNeeded();
    const a = await grip.boundingBox();
    const target = page.locator(kind === "player" ? "#player-status" : kind === "bag" ? "#bag-btn" : ".enemy-target:not(:disabled)").first();
    const d = await target.boundingBox();
    assert.ok(a && d, `Missing ${kind} drag geometry`);
    const from = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const to = { x: d.x + d.width / 2, y: d.y + d.height * .55 };
    const before = await model(page);
    let cdp;
    if (touch) {
      cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
      for (let step = 1; step <= 14; step++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * step / 14, y: from.y + (to.y - from.y) * step / 14, id: 1 }] });
      }
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 14 });
    }
    assert.deepEqual(await model(page), before, `${kind} preview mutated combat before release`);
    assert.equal(await target.evaluate((node) => node.classList.contains("drop-hover")), true);
    assert.equal(await page.locator("#drag-ghost").evaluate((node) => node.classList.contains("can-drop")), true);
    if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    else await page.mouse.up();
    const after = await model(page);
    assert.equal(after.energy, before.energy - 1);
    assert.equal(after.discard.filter((id) => id === uid).length, 1);
    assert.ok(!after.hand.includes(uid));
    if (kind === "player") assert.equal(after.shield, 12);
    if (kind === "enemy") assert.equal(after.enemyHp[0], before.enemyHp[0] - 9);
    if (kind === "bag") assert.equal(after.hand.length, before.hand.length + 1);
  }
  const cases = [[1920, 1080, "player"], [1366, 768], [390, 844, "enemy"], [320, 568], [844, 390, "bag"], [568, 320, "player"]];
  for (const [width, height, target] of cases) {
    const touch = width < 1000;
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
    observe(page);
    await expose(page);
    await page.goto(`${base}/?v=10`);
    await page.locator("#screen-root [data-action=deploy]").click();
    await page.locator("#route-standard").click();
    await page.locator("img[loading=lazy]").evaluateAll((images) => images.forEach((img) => { img.loading = "eager"; }));
    await page.waitForFunction(() => __pixelQA.scene.ready && __pixelQA.scene.environments.every((img) => img.complete && img.naturalWidth));
    await page.mouse.move(5, 5);
    const geometry = await page.evaluate(() => {
      const c = document.getElementById("world"), r = c.getBoundingClientRect(), hud = document.getElementById("player-status").getBoundingClientRect();
      return { w: c.width, h: c.height, displayW: r.width, displayH: r.height, scale: __pixelQA.scene.pixelScale, smoothing: c.getContext("2d").imageSmoothingEnabled, rendering: getComputedStyle(c).imageRendering, overflow: document.documentElement.scrollWidth > innerWidth, cardOverflow: [...document.querySelectorAll("#hand .card")].some((card) => card.scrollHeight > card.clientHeight + 1), hudInside: hud.left >= 0 && hud.top >= 0 && hud.right <= innerWidth + 1 && hud.bottom <= innerHeight + 1 };
    });
    assert.ok(geometry.w <= 640 && geometry.h <= 360, JSON.stringify(geometry));
    assert.ok(Number.isInteger(geometry.scale) && geometry.scale >= 2);
    assert.ok(Math.abs(geometry.w * geometry.scale - geometry.displayW) <= geometry.scale);
    assert.ok(Math.abs(geometry.h * geometry.scale - geometry.displayH) <= geometry.scale);
    assert.equal(geometry.smoothing, false);
    assert.equal(geometry.rendering, "pixelated");
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.cardOverflow, false);
    assert.equal(geometry.hudInside, true);
    if (target) await drag(page, target, touch);
    await page.close();
    console.log(`PASS ${width}×${height}: common pixel grid, readable controls${target ? `, native ${target} preview/release once` : ""}`);
  }
  const fallback = await browser.newPage();
  observe(fallback, true);
  await fallback.route("**/assets/pixel/**", (route) => route.abort());
  await expose(fallback);
  await fallback.goto(`${base}/?v=10`);
  await fallback.locator("[data-page=base]").click();
  await fallback.waitForFunction(() => document.querySelector(".inventory-tile .asset-visual")?.classList.contains("asset-missing"));
  assert.equal(await fallback.locator(".inventory-tile .asset-fallback").first().evaluate((node) => getComputedStyle(node).display), "block");
  await fallback.locator(".money-controls [data-action=deploy]").click();
  await fallback.locator("#route-standard").click();
  await fallback.waitForFunction(() => __pixelQA.scene.ready);
  assert.equal(await fallback.evaluate(() => __pixelQA.scene.plates.src.endsWith("/assets/field-plates.svg")), true);
  assert.equal(await fallback.evaluate(() => __pixelQA.scene.tiles.length), 6);
  assert.equal(await fallback.evaluate(() => __pixelQA.scene.ctx.imageSmoothingEnabled), false);
  console.log("PASS blocked PNG downloads retain vector UI, legacy plates and low-resolution procedural fallback");
  await fallback.close();
  await browser.close();
  assert.deepEqual(oldArtwork, []);
  assert.deepEqual(failed, []);
  assert.deepEqual(errors, []);
  console.log("PASS no photographic art requests, failed normal loads or browser exceptions");
})().catch((error) => { console.error(error); process.exit(1); });
