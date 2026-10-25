/* Native touch and pause/resume regression; requires Playwright and a local server. */
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const errors = [];
  const p = await b.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.GAME_URL || "http://localhost:8000");
  await p.locator("#screen-root [data-action=deploy]").click();
  await p.locator("#route-standard").click();
  await p.locator("#end-turn-btn").click();
  await p.locator(".brand").click();
  await p.locator("#pause-to-menu").click();
  await p.reload();
  await p.locator("[data-action=resume]").click();
  await p.waitForTimeout(800);
  assert.equal(await p.locator("#turn-number").innerText(), "02");
  assert.equal(await p.locator("#hp-value").innerText(), "75");
  console.log(
    "PASS pausing/resuming across enemy phase cannot resolve the same attack twice",
  );
  await p.close();
  const m = await b.newPage({ ...devices["iPhone 13"] });
  m.on("pageerror", (e) => errors.push(e.message));
  await m.goto(process.env.GAME_URL || "http://localhost:8000");
  await m.locator("[data-page=base]").tap();
  const uid = await m
    .locator("[data-container=pack] [data-entry]")
    .first()
    .getAttribute("data-entry");
  await m.locator(`[data-container=pack] [data-entry="${uid}"]`).tap();
  await m.locator(".selection-detail [data-transfer=stash]").tap();
  assert.equal(
    await m.locator("[data-container=stash] [data-entry]").count(),
    1,
  );
  await m.locator(".selection-detail [data-transfer=pack]").tap();
  assert.equal(
    await m.locator("[data-container=stash] [data-entry]").count(),
    0,
  );
  console.log(
    "PASS mobile tap selection and quick transfers in both directions",
  );
  const grip = m.locator("[data-container=pack] [data-move-grip]").first();
  await grip.scrollIntoViewIfNeeded();
  const r = await grip.boundingBox(),
    from = { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 },
    cdp = await m.context().newCDPSession(m);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...from, y: from.y + ((830 - from.y) * i) / 12 }],
    });
    await m.waitForTimeout(15);
  }
  await m.waitForTimeout(900);
  const dest = await m
    .locator("[data-container=stash] .storage-title")
    .boundingBox();
  assert.ok(dest.y < 844 && dest.y > 0, JSON.stringify(dest));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { ...from, x: dest.x + dest.width / 2, y: dest.y + dest.height / 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.equal(
    await m.locator("[data-container=stash] [data-entry]").count(),
    1,
  );
  console.log("PASS native mobile inventory drag with edge auto-scroll");
  assert.deepEqual(errors, []);
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
