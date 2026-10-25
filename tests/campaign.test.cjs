"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  Cards = require("../card-model.js"),
  C = require("../campaign.js");
const fresh = () => {
  const s = Cards.migrate();
  C.ensure(s);
  return s;
};
const ownership = (s) => [
  ...s.campaign.pack,
  ...s.campaign.stash,
  ...Object.values(s.campaign.equipment).filter(Boolean),
];
test("campaign migration is one-time and every physical card and item has exactly one location", () => {
  const s = fresh(),
    before = JSON.stringify(s.campaign);
  C.ensure(s);
  assert.equal(JSON.stringify(s.campaign), before);
  assert.equal(s.campaign.capacity, 60);
  assert.equal(
    new Set(ownership(s)).size,
    s.instances.length + s.campaign.items.length,
  );
  Cards.sync(s);
  assert.equal(s.campaign.pack.length, 12);
  assert.equal(s.campaign.items.length, 3);
});
test("warehouse transfer, partial move-all and sorting never duplicate or discard property", () => {
  const s = fresh();
  s.campaign.capacity = 60;
  for (let i = 0; i < 59; i++) {
    const x = C.createItem("scrap");
    s.campaign.items.push(x);
    s.campaign.stash.push(x.uid);
  }
  const before = ownership(s).sort();
  assert.equal(C.moveAll(s, "stash"), 1);
  assert.equal(s.campaign.pack.length, 11);
  assert.equal(s.campaign.stash.length, 60);
  C.sort(s);
  assert.deepEqual(ownership(s).sort(), before);
  assert.equal(C.move(s, s.campaign.pack[0], "stash").ok, false);
});
test("trades pay exactly once, reject insufficient funds or full storage and retain independent duplicates", () => {
  const s = fresh();
  C.build(s, "shop");
  s.credits = 200;
  assert.equal(C.buy(s, "card", "shot").ok, true);
  assert.equal(s.credits, 150);
  assert.equal(s.instances.length, 13);
  const id = s.campaign.stash[0];
  assert.equal(C.sell(s, id).ok, true);
  const balance = s.credits;
  assert.equal(C.sell(s, id).ok, false);
  assert.equal(s.credits, balance);
  s.credits = 0;
  assert.equal(C.buy(s, "item", "carbine").ok, false);
});
test("equipment supports card operations and incompatible slots leave ownership intact", () => {
  const s = fresh(),
    gun = C.createItem("carbine");
  s.campaign.items.push(gun);
  s.campaign.pack.push(gun.uid);
  const before = ownership(s).sort();
  assert.equal(C.equip(s, gun.uid, "armor").ok, false);
  assert.equal(C.equip(s, gun.uid, "primary").ok, true);
  assert.deepEqual(ownership(s).sort(), before);
  assert.equal(C.applyGear(Cards.compile("shot"), C.gear(s)).damage, 11);
  assert.equal(C.applyGear(Cards.compile("guard"), C.gear(s)).block, 12);
});
test("normal promotion preserves basis options and consumes two materials with guaranteed success", () => {
  const s = fresh();
  C.build(s, "forge");
  const input = s.instances.filter((x) => x.templateId === "shot").slice(0, 3);
  input[0].options = [{ type: "damage", value: 3, tier: "normal" }];
  const result = C.promote(
    s,
    input.map((x) => x.uid),
    0,
    () => 0.2,
  );
  assert.equal(result.ok, true);
  assert.equal(result.card.uid, input[0].uid);
  assert.equal(result.card.rarity, "rare");
  assert.deepEqual(result.card.options[0], input[0].options[0]);
  assert.equal(result.card.options.length, 2);
  assert.equal(s.instances.length, 10);
  assert.equal(
    new Set(ownership(s)).size,
    s.instances.length + s.campaign.items.length,
  );
  const before = JSON.stringify(s);
  assert.equal(
    C.promote(s, [result.card.uid, result.card.uid, result.card.uid]).ok,
    false,
  );
  assert.equal(JSON.stringify(s), before);
});
test("mystic reforge replaces old risks and follows five base stages plus descending bonus stages", () => {
  const s = fresh();
  C.build(s, "forge");
  const three = Array.from({ length: 3 }, () =>
    Cards.create("shot", {
      rarity: "mystic",
      options: [{ type: "damage", value: 99, tier: "mystic" }],
      risks: Array.from({ length: 3 }, () => ({
        type: "hp",
        amount: 3,
        turns: 1,
      })),
    }),
  );
  s.instances.push(...three);
  s.campaign.stash.push(...three.map((x) => x.uid));
  const r = C.promote(
    s,
    three.map((x) => x.uid),
    1,
    () => 0.4,
  );
  assert.equal(r.ok, true);
  assert.equal(r.card.options.length, 6);
  assert.equal(r.card.risks.length, 1);
  assert.deepEqual(
    r.card.options.map((x) => x.rollStage),
    ["rare", "epic", "unique", "legendary", "mystic", "mystic"],
  );
  assert.ok(r.card.options.every((x) => x.value !== 99));
});
test("risk capacity is validated before mutation and new bonus options begin at epic", () => {
  const s = fresh();
  C.build(s, "forge");
  const ids = s.instances.slice(0, 3).map((x) => x.uid),
    before = JSON.stringify(s);
  assert.equal(C.promote(s, ids, 1).ok, false);
  assert.equal(JSON.stringify(s), before);
});
test("quests, facilities and upgrades reject duplicate rewards and consume actual materials", () => {
  const s = fresh();
  assert.equal(C.build(s, "shop"), true);
  assert.equal(C.build(s, "shop"), false);
  C.quest(s, "return");
  s.campaign.stats.extracts = 1;
  assert.equal(C.quest(s, "return").claimed, true);
  const credits = s.credits;
  assert.equal(C.quest(s, "return").ok, false);
  assert.equal(s.credits, credits);
  assert.equal(s.campaign.capacity, 72);
  C.build(s, "forge");
  const scrap = C.createItem("scrap", 3);
  s.campaign.items.push(scrap);
  s.campaign.stash.push(scrap.uid);
  assert.equal(C.upgrade(s, "health").ok, true);
  assert.equal(C.materialCount(s, "scrap"), 0);
  assert.equal(C.gear(s).maxHp, 90);
});
test("death preserves stable cards and warehouse, loses unstable cards, all carried gear and cash, and settles once", () => {
  const s = fresh(),
    stored = C.createItem("circuit"),
    loose = C.createItem("medkit"),
    loot = Cards.create("pierce", { unstable: true });
  s.campaign.items.push(stored, loose);
  s.campaign.stash.push(stored.uid);
  s.campaign.pack.push(loose.uid);
  const run = {
    bag: [
      ...s.campaign.pack.filter((id) => s.instances.some((x) => x.uid === id)),
      loot.uid,
    ],
    cards: Object.fromEntries([...s.instances, loot].map((x) => [x.uid, x])),
    items: Object.fromEntries(s.campaign.items.map((x) => [x.uid, x])),
    packItems: [loose.uid],
    loot: 300,
    kills: 2,
    zone: 1,
  };
  s.campaign.run = structuredClone(run);
  assert.equal(C.settle(s, run, false), true);
  assert.equal(s.campaign.cash, 0);
  assert.equal(s.campaign.items.length, 1);
  assert.equal(s.campaign.items[0].uid, stored.uid);
  assert.equal(s.instances.length, 12);
  assert.equal(s.campaign.pack.length, 12);
  assert.ok(Object.values(s.campaign.equipment).every((x) => x === null));
  assert.equal(C.settle(s, run, false), false);
  assert.equal(s.campaign.stats.kills, 2);
});
test("successful extraction stabilizes duplicates in the pack and does not overflow the warehouse", () => {
  const s = fresh(),
    loot = Cards.create("shot", { unstable: true });
  const run = {
    bag: [...s.campaign.pack, loot.uid],
    cards: Object.fromEntries([...s.instances, loot].map((x) => [x.uid, x])),
    items: Object.fromEntries(s.campaign.items.map((x) => [x.uid, x])),
    packItems: [],
    loot: 300,
    kills: 2,
    zone: 2,
  };
  s.campaign.run = structuredClone(run);
  assert.equal(C.settle(s, run, true), true);
  assert.equal(s.instances.length, 13);
  assert.equal(s.instances.find((x) => x.uid === loot.uid).unstable, false);
  assert.equal(s.campaign.cash, 300);
  assert.equal(s.credits, 0);
  assert.equal(s.campaign.best, 3);
  assert.equal(s.campaign.pack.length, 13);
  assert.equal(s.runs, 1);
});

test("selling a carried item in the field cannot resurrect its old base copy after settlement", () => {
  const s = fresh(),
    x = C.createItem("medkit");
  s.campaign.items.push(x);
  s.campaign.pack.push(x.uid);
  const run = {
    bag: s.instances.map((x) => x.uid),
    cards: Object.fromEntries(s.instances.map((x) => [x.uid, x])),
    items: Object.fromEntries(s.campaign.items.map((x) => [x.uid, x])),
    departureItems: [
      x.uid,
      ...Object.values(s.campaign.equipment).filter(Boolean),
    ],
    packItems: [],
    loot: 18,
    kills: 0,
    zone: 0,
  };
  s.campaign.run = structuredClone(run);
  C.settle(s, run, true);
  assert.equal(
    s.campaign.items.some((v) => v.uid === x.uid),
    false,
  );
  assert.equal(s.campaign.stash.includes(x.uid), false);
  assert.equal(s.campaign.pack.includes(x.uid), false);
});

test("rescue loan deck survives saves but cannot be sold, promoted or repeatedly claimed", () => {
  const s = fresh();
  assert.equal(C.borrow(s).ok, true);
  const loans = s.instances.filter((x) => x.loan);
  assert.equal(loans.length, 12);
  C.build(s, "forge");
  C.build(s, "shop");
  assert.equal(C.sell(s, loans[0].uid).ok, false);
  assert.equal(
    C.promote(
      s,
      loans.slice(0, 3).map((x) => x.uid),
    ).ok,
    false,
  );
  assert.equal(C.borrow(s).ok, false);
  Cards.sync(s);
  assert.equal(s.instances.filter((x) => x.loan).length, 12);
});

test("voluntarily sold stable cards remain sold after death settlement", () => {
  const s = fresh(),
    sold = s.instances[0].uid,
    bag = s.campaign.pack.filter((id) => id !== sold);
  const run = {
    bag,
    cards: Object.fromEntries(s.instances.map((x) => [x.uid, x])),
    items: Object.fromEntries(s.campaign.items.map((x) => [x.uid, x])),
    packItems: [],
    soldCards: [sold],
    loot: 25,
    kills: 0,
    zone: 0,
  };
  s.campaign.run = structuredClone(run);
  C.settle(s, run, false);
  assert.equal(
    s.instances.some((x) => x.uid === sold),
    false,
  );
  assert.equal(s.campaign.pack.includes(sold), false);
  assert.equal(s.campaign.stash.includes(sold), false);
});
