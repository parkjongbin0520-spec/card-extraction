/* Persistent ownership, facilities, trading and guaranteed three-card promotion. */
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./card-model.js")
      : root.CardLibrary,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Campaign = api;
})(globalThis, function (Cards) {
  "use strict";
  const copy = (x) => JSON.parse(JSON.stringify(x)),
    num = (x, d = 0, max = 999999) =>
      Number.isFinite(Number(x))
        ? Math.max(0, Math.min(max, Math.floor(Number(x))))
        : d;
  const items = Object.freeze({
    rifle: {
      name: "표준 소총",
      kind: "weapon",
      icon: "crosshair",
      price: 70,
      damage: 0,
      accuracy: 0,
      desc: "기본 카드 수치를 유지하는 소총",
    },
    carbine: {
      name: "정밀 카빈",
      kind: "weapon",
      icon: "crosshair",
      price: 180,
      damage: 2,
      accuracy: 5,
      desc: "주무기: 공격 카드 피해 +2 / 보조무기: 명중 +5%",
    },
    pistol: {
      name: "전술 권총",
      kind: "weapon",
      icon: "crosshair",
      price: 110,
      damage: 1,
      accuracy: 5,
      desc: "주무기: 피해 +1 / 보조무기: 명중 +5%",
    },
    vest: {
      name: "경량 방탄복",
      kind: "armor",
      icon: "shield",
      price: 90,
      armor: 1,
      desc: "장갑 1",
    },
    heavyVest: {
      name: "강화 방탄복",
      kind: "armor",
      icon: "shield",
      price: 200,
      armor: 2,
      desc: "장갑 2",
    },
    backpack: {
      name: "정찰 배낭",
      kind: "backpack",
      icon: "backpack",
      price: 65,
      capacity: 24,
      desc: "소지품 24칸",
    },
    largePack: {
      name: "수색 배낭",
      kind: "backpack",
      icon: "backpack",
      price: 160,
      capacity: 32,
      desc: "소지품 32칸",
    },
    scrap: {
      name: "금속 부품",
      kind: "material",
      icon: "box",
      price: 20,
      desc: "시설과 능력 강화 재료",
    },
    circuit: {
      name: "전자 회로",
      kind: "material",
      icon: "bolt",
      price: 45,
      desc: "고급 정비 재료",
    },
    medkit: {
      name: "구급 키트",
      kind: "consumable",
      icon: "plus",
      price: 45,
      heal: 20,
      desc: "정비 1턴으로 체력 20 회복",
    },
    grenade: {
      name: "지연 수류탄",
      kind: "throwable",
      icon: "bolt",
      price: 60,
      damage: 12,
      turns: 2,
      desc: "정비에서 설치 시 다음 전투 2턴 뒤 적 전체에 피해 12",
    },
  });
  const table = Object.freeze({
    rare: [70, 30],
    epic: [30, 45, 25],
    unique: [15, 25, 35, 25],
    legendary: [5, 15, 25, 30, 25],
    mystic: [0, 10, 15, 25, 30, 20],
  });
  const tuning = Object.freeze({
    maintenanceTurns: 3,
    warehouse: 60,
    bag: 24,
    optionTables: table,
    provisional: true,
  });
  const uid = () => Cards.create("shot").uid.replace(/^c-/, "i-");
  function createItem(templateId, qty = 1) {
    return items[templateId]
      ? { uid: uid(), templateId, qty: Math.max(1, num(qty, 1, 99)) }
      : null;
  }
  function ensure(save) {
    let c = save.campaign;
    if (!c || c.version !== 1) {
      const pack = [...Cards.starterRefs(save), ...Cards.loadoutRefs(save)],
        gear = ["rifle", "vest", "backpack"].map((id) => createItem(id));
      c = {
        version: 1,
        pack,
        stash: save.instances
          .filter((x) => !pack.includes(x.uid))
          .map((x) => x.uid),
        items: gear,
        equipment: {
          primary: gear[0].uid,
          secondary: null,
          armor: gear[1].uid,
          backpack: gear[2].uid,
        },
        capacity: 60,
        facilities: { shop: false, forge: false },
        upgrades: { health: 0, armor: 0 },
        cash: 0,
        best: 0,
        stats: { kills: 0, extracts: save.runs || 0 },
        quests: {},
        settings: {
          volume: 0.35,
          sound: false,
          scale: 1,
          motion: true,
          battery: true,
        },
        run: null,
      };
      save.campaign = c;
    }
    c.items = (Array.isArray(c.items) ? c.items : [])
      .filter(
        (x) => x && /^i-[a-zA-Z0-9_-]+$/.test(x.uid) && items[x.templateId],
      )
      .map((x) => ({ ...x, qty: Math.max(1, num(x.qty, 1, 99)) }));
    const byId = new Map(c.items.map((x) => [x.uid, x]));
    c.items = [...byId.values()];
    const all = new Set([...save.instances.map((x) => x.uid), ...byId.keys()]),
      used = new Set();
    c.equipment = c.equipment || {};
    for (const slot of ["primary", "secondary", "armor", "backpack"]) {
      const id = c.equipment[slot],
        item = byId.get(id),
        kind = slot === "primary" || slot === "secondary" ? "weapon" : slot;
      if (!item || items[item.templateId].kind !== kind || used.has(id))
        c.equipment[slot] = null;
      else used.add(id);
    }
    for (const location of ["pack", "stash"]) {
      c[location] = [
        ...new Set(Array.isArray(c[location]) ? c[location] : []),
      ].filter((id) => {
        if (!all.has(id) || used.has(id)) return false;
        used.add(id);
        return true;
      });
    }
    for (const id of all) if (!used.has(id)) c.stash.push(id);
    c.capacity = Math.max(60, num(c.capacity, 60, 240));
    c.cash = num(c.cash);
    c.best = num(c.best, 0, 3);
    c.facilities = { shop: !!c.facilities?.shop, forge: !!c.facilities?.forge };
    c.upgrades = {
      health: num(c.upgrades?.health, 0, 10),
      armor: num(c.upgrades?.armor, 0, 5),
    };
    c.stats = { kills: num(c.stats?.kills), extracts: num(c.stats?.extracts) };
    c.quests = Object.fromEntries(
      Object.entries(c.quests || {}).filter(
        ([id, status]) =>
          ["return", "hunter", "supply"].includes(id) &&
          ["active", "done"].includes(status),
      ),
    );
    const s = c.settings || {};
    c.settings = {
      volume: Math.max(0, Math.min(1, Number(s.volume) || 0)),
      sound: !!s.sound,
      scale: Math.max(0.9, Math.min(1.2, Number(s.scale) || 1)),
      motion: s.motion !== false,
      battery: s.battery !== false,
    };
    if (!c.run || typeof c.run !== "object") c.run = null;
    return c;
  }
  function entity(save, id) {
    return (
      save.instances.find((x) => x.uid === id) ||
      save.campaign.items.find((x) => x.uid === id)
    );
  }
  function definition(save, id) {
    const x = entity(save, id);
    return x ? (x.rarity ? Cards.compile(x) : items[x.templateId]) : null;
  }
  function capacity(save) {
    const c = save.campaign,
      x = c.items.find((x) => x.uid === c.equipment.backpack);
    return x ? items[x.templateId].capacity : 16;
  }
  function move(save, id, to) {
    if (!["pack", "stash"].includes(to))
      return { ok: false, error: "이동할 보관 공간을 선택하세요." };
    const c = save.campaign,
      from = to === "stash" ? "pack" : "stash";
    if (c.run)
      return {
        ok: false,
        error: "탐사 중에는 기지 창고를 조작할 수 없습니다.",
      };
    if (!c[from].includes(id))
      return { ok: false, error: "물건이 이동되었거나 없습니다." };
    if (c[to].length >= (to === "stash" ? c.capacity : capacity(save)))
      return { ok: false, error: "공간이 부족합니다." };
    c[from] = c[from].filter((x) => x !== id);
    c[to].push(id);
    return { ok: true };
  }
  function moveAll(save, to) {
    let moved = 0;
    const from = to === "stash" ? "pack" : "stash";
    for (const id of [...save.campaign[from]])
      if (move(save, id, to).ok) moved++;
    return moved;
  }
  function sort(save) {
    save.campaign.stash.sort((a, b) => {
      const x = definition(save, a),
        y = definition(save, b);
      return (
        (x.type || x.kind).localeCompare(y.type || y.kind) ||
        Cards.rarities.indexOf(y.rarity) - Cards.rarities.indexOf(x.rarity) ||
        x.name.localeCompare(y.name)
      );
    });
  }
  function equip(save, id, slot) {
    const c = save.campaign,
      item = c.items.find((x) => x.uid === id),
      kind = slot === "primary" || slot === "secondary" ? "weapon" : slot;
    if (
      c.run ||
      !item ||
      items[item.templateId].kind !== kind ||
      !c.pack.includes(id)
    )
      return { ok: false, error: "배낭의 장비를 선택하세요." };
    const old = c.equipment[slot];
    c.pack = c.pack.filter((x) => x !== id);
    if (old) c.pack.push(old);
    c.equipment[slot] = id;
    if (c.pack.length > capacity(save)) {
      c.pack = c.pack.filter((x) => x !== old);
      c.pack.push(id);
      c.equipment[slot] = old;
      return { ok: false, error: "배낭 용량이 부족합니다." };
    }
    return { ok: true };
  }
  function unequip(save, slot) {
    const c = save.campaign,
      id = c.equipment[slot];
    if (c.run || !id) return { ok: false, error: "해제할 장비가 없습니다." };
    const cap = slot === "backpack" ? 16 : capacity(save);
    if (c.pack.length >= cap)
      return { ok: false, error: "먼저 배낭에 공간을 만드세요." };
    c.pack.push(id);
    c.equipment[slot] = null;
    return { ok: true };
  }
  function gear(save) {
    const c = save.campaign,
      find = (slot) => {
        const x = c.items.find((x) => x.uid === c.equipment[slot]);
        return x ? items[x.templateId] : null;
      };
    return {
      maxHp: 80 + c.upgrades.health * 10,
      armor: (find("armor")?.armor || 0) + c.upgrades.armor,
      damage: find("primary")?.damage || 0,
      accuracy: find("secondary")?.accuracy || 0,
      primary: find("primary")?.name || "비무장",
      secondary: find("secondary")?.name || "없음",
      armorName: find("armor")?.name || "없음",
    };
  }
  function applyGear(card, mod) {
    if (!card) return null;
    const out = copy(card);
    if (out.type === "attack") {
      out.damage = (out.damage || 0) + (mod.damage || 0);
      out.accuracy = 100 + (mod.accuracy || 0);
    }
    return out;
  }
  function buy(save, kind, id, to = "stash") {
    const c = save.campaign;
    if (!c.facilities.shop || c.run)
      return { ok: false, error: "기지 상점에서 거래하세요." };
    const d = kind === "card" ? Cards.templates[id] : items[id],
      price =
        kind === "card"
          ? 50 + (Cards.rarities.indexOf(d?.rarity) || 0) * 35
          : d?.price;
    if (
      !d ||
      !["pack", "stash"].includes(to) ||
      save.credits < price ||
      c[to].length >= (to === "stash" ? c.capacity : capacity(save))
    )
      return { ok: false, error: "자금이나 공간이 부족합니다." };
    const x = kind === "card" ? Cards.create(id) : createItem(id);
    if (kind === "card") save.instances.push(x);
    else c.items.push(x);
    c[to].push(x.uid);
    save.credits -= price;
    return { ok: true, id: x.uid };
  }
  function sell(save, id) {
    const c = save.campaign;
    if (c.run || !c.facilities.shop)
      return { ok: false, error: "기지 상점에서 거래하세요." };
    const x = entity(save, id),
      from = c.pack.includes(id)
        ? "pack"
        : c.stash.includes(id)
          ? "stash"
          : null;
    if (!x || !from) return { ok: false, error: "소지품을 선택하세요." };
    if (x.loan) return { ok: false, error: "대여 카드는 판매할 수 없습니다." };
    const price = x.rarity
      ? Math.max(15, 25 + Cards.rarities.indexOf(x.rarity) * 20)
      : Math.floor(items[x.templateId].price * 0.4) * x.qty;
    c[from] = c[from].filter((v) => v !== id);
    save.instances = save.instances.filter((v) => v.uid !== id);
    c.items = c.items.filter((v) => v.uid !== id);
    save.starterIds = save.starterIds.filter((v) => v !== id);
    save.credits += price;
    return { ok: true, price };
  }
  function materialCount(save, id) {
    return save.campaign.items
      .filter((x) => x.templateId === id)
      .reduce((sum, x) => sum + x.qty, 0);
  }
  function consume(save, id, qty) {
    const c = save.campaign;
    for (const x of c.items.filter((x) => x.templateId === id)) {
      const n = Math.min(qty, x.qty);
      x.qty -= n;
      qty -= n;
      if (!x.qty) {
        c.pack = c.pack.filter((v) => v !== x.uid);
        c.stash = c.stash.filter((v) => v !== x.uid);
      }
      if (!qty) break;
    }
    c.items = c.items.filter((x) => x.qty > 0);
  }
  function upgrade(save, type) {
    const c = save.campaign,
      config = {
        health: [100, 3, 10],
        armor: [150, 4, 5],
        warehouse: [50, 2, 15],
      }[type];
    if (c.run || !c.facilities.forge || !config)
      return { ok: false, error: "기지 강화소가 필요합니다." };
    const level =
      type === "warehouse" ? (c.capacity - 60) / 12 : c.upgrades[type];
    if (
      level >= config[2] ||
      save.credits < config[0] ||
      materialCount(save, "scrap") < config[1]
    )
      return {
        ok: false,
        error: "자금/금속 부품이 부족하거나 최대 단계입니다.",
      };
    save.credits -= config[0];
    consume(save, "scrap", config[1]);
    if (type === "warehouse") c.capacity += 12;
    else c.upgrades[type]++;
    return { ok: true };
  }
  function build(save, facility) {
    if (
      save.campaign.run ||
      !["shop", "forge"].includes(facility) ||
      save.campaign.facilities[facility]
    )
      return false;
    save.campaign.facilities[facility] = true;
    return true;
  }
  function rollTier(stage, rng) {
    const weights = table[stage];
    let r = rng() * 100;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return Cards.rarities[i];
    }
    return stage;
  }
  function rollOption(card, stage, rng) {
    const tier = rollTier(stage, rng),
      rank = Cards.rarities.indexOf(tier),
      used = new Set([
        ...card.options.map((o) => o.type),
        ...["pierce", "shatter", "delay"].filter((k) => Cards.compile(card)[k]),
      ]);
    let pool = ["block", "heal", "draw", "energyGain"];
    if (Cards.templates[card.templateId].type === "attack")
      pool.push(
        "damage",
        "hits",
        "targets",
        ...(rank >= 3
          ? ["pierce", "shatter", "delay"].filter((x) => !used.has(x))
          : []),
      );
    if (Cards.compile(card).block) pool.push("shieldDuration");
    const type =
      pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    const value = ["pierce", "shatter"].includes(type)
      ? 1
      : [
            "draw",
            "energyGain",
            "hits",
            "delay",
            "targets",
            "shieldDuration",
          ].includes(type)
        ? 1
        : 2 + rank * 2;
    return { type, value, tier, rollStage: stage };
  }
  function rollRisk(rng) {
    const pool = [
      { type: "energy", amount: 1, turns: 1 },
      { type: "hp", amount: 3, turns: 1 },
      { type: "vulnerable", amount: 1, turns: 2 },
      { type: "stress", amount: 15, turns: 2 },
      { type: "seal", amount: 1, turns: 2 },
      { type: "curse", amount: 1, turns: 1 },
    ];
    return {
      ...pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))],
    };
  }
  function promote(save, ids, riskCount = 0, rng = Math.random) {
    const c = save.campaign;
    if (c.run || !c.facilities.forge)
      return { ok: false, error: "기지 강화소에서 합성하세요." };
    if (!Array.isArray(ids) || new Set(ids).size !== 3 || ids.length !== 3)
      return { ok: false, error: "서로 다른 카드 3장을 선택하세요." };
    if (!Number.isInteger(riskCount) || riskCount < 0 || riskCount > 4)
      return { ok: false, error: "리스크는 0~4개 중에서 선택하세요." };
    const input = ids.map((id) => save.instances.find((x) => x.uid === id)),
      locations = ids.map((id) =>
        c.pack.includes(id) ? "pack" : c.stash.includes(id) ? "stash" : null,
      );
    if (input.some((x) => x?.loan))
      return {
        ok: false,
        error: "대여 카드는 합성 재료로 사용할 수 없습니다.",
      };
    if (
      input.some((x) => !x || x.unstable || x.loan) ||
      locations.some((x) => !x) ||
      input.some((x) => x.rarity !== input[0].rarity)
    )
      return { ok: false, error: "같은 등급의 안정 카드 3장이 필요합니다." };
    const basis = input[0],
      mystic = basis.rarity === "mystic",
      next =
        Cards.rarities[Math.min(5, Cards.rarities.indexOf(basis.rarity) + 1)];
    riskCount = num(riskCount, 0, 4);
    const currentRisks = mystic ? 0 : basis.risks.length;
    if (riskCount > Cards.riskCapacity(next) - currentRisks)
      return { ok: false, error: "리스크 슬롯 한도를 초과했습니다." };
    const result = Cards.create(basis.templateId, {
      ...copy(basis),
      rarity: next,
      options: mystic ? [] : basis.options,
      risks: mystic ? [] : basis.risks,
    });
    for (const stage of mystic ? Cards.rarities.slice(1) : [next])
      result.options.push(rollOption(result, stage, rng));
    for (let i = 0; i < riskCount; i++) {
      const stage =
        Cards.rarities[Math.max(2, Cards.rarities.indexOf(next) - i)];
      result.options.push({ ...rollOption(result, stage, rng), bonus: true });
      result.risks.push(rollRisk(rng));
    }
    save.instances = save.instances.filter((x) => !ids.includes(x.uid));
    save.instances.push(result);
    for (const location of ["pack", "stash"])
      c[location] = c[location].filter(
        (id) => !ids.includes(id) || id === basis.uid,
      );
    save.starterIds = save.starterIds.filter(
      (id) => !ids.slice(1).includes(id),
    );
    Cards.sync(save);
    return { ok: true, card: result };
  }
  const quests = Object.freeze({
    return: {
      name: "첫 생환",
      desc: "탐사에서 1회 생존 귀환",
      reward: 150,
      capacity: 12,
    },
    hunter: { name: "폐쇄구역 정리", desc: "적 5명 제압", reward: 200 },
    supply: { name: "작업대 보급", desc: "금속 부품 3개 납품", reward: 120 },
  });
  function questReady(save, id) {
    const c = save.campaign;
    return id === "return"
      ? c.stats.extracts >= 1
      : id === "hunter"
        ? c.stats.kills >= 5
        : id === "supply"
          ? materialCount(save, "scrap") >= 3
          : false;
  }
  function quest(save, id) {
    const c = save.campaign;
    if (c.run || !c.facilities.shop || !quests[id] || c.quests[id] === "done")
      return { ok: false, error: "완료했거나 접근할 수 없는 의뢰입니다." };
    if (!c.quests[id]) {
      c.quests[id] = "active";
      return { ok: true, accepted: true };
    }
    if (!questReady(save, id))
      return { ok: false, error: "의뢰 조건을 충족하지 못했습니다." };
    if (id === "supply") consume(save, "scrap", 3);
    c.quests[id] = "done";
    save.credits += quests[id].reward;
    c.capacity += quests[id].capacity || 0;
    return { ok: true, claimed: true };
  }
  function borrow(save) {
    const c = save.campaign;
    if (c.run || save.instances.some((x) => x.loan))
      return { ok: false, error: "대여 덱은 한 세트만 보유할 수 있습니다." };
    if (capacity(save) - c.pack.length < 12)
      return { ok: false, error: "배낭에 12칸을 비워주세요." };
    const cards = Cards.baseDeck.map((id) => Cards.create(id, { loan: true }));
    save.instances.push(...cards);
    c.pack.push(...cards.map((x) => x.uid));
    return { ok: true };
  }
  function settle(save, run, success) {
    const c = save.campaign;
    if (run.settled || !c.run) return false;
    run.settled = true;
    c.stats.kills += run.kills;
    c.best = Math.max(c.best, run.zone + 1);
    if (success) {
      c.stats.extracts++;
      save.runs++;
    }
    const sold = new Set(run.soldCards || []);
    save.instances = save.instances.filter((x) => !sold.has(x.uid));
    save.starterIds = save.starterIds.filter((id) => !sold.has(id));
    for (const id of run.bag) {
      const source = run.cards[id];
      if (!source || (!success && source.unstable)) continue;
      const card = Cards.create(source.templateId, {
          ...source,
          unstable: false,
        }),
        index = save.instances.findIndex((x) => x.uid === id);
      if (index < 0) save.instances.push(card);
      else save.instances[index] = card;
    }
    c.pack = run.bag.filter((id) => success || !run.cards[id].unstable);
    c.cash = success ? run.loot : 0;
    const equipped = [
        ...new Set(
          [
            ...Object.values(c.equipment),
            ...Object.values(run.equipment || {}),
          ].filter(Boolean),
        ),
      ],
      lost = new Set([
        ...(run.departureItems || []),
        ...run.packItems,
        ...equipped,
      ]);
    c.items = c.items.filter((x) => !lost.has(x.uid));
    if (success) {
      if (run.equipment) c.equipment = copy(run.equipment);
      const gear = c.items;
      for (const id of [...run.packItems, ...equipped]) {
        const item = run.items[id];
        if (item && !gear.some((x) => x.uid === id)) gear.push(copy(item));
      }
      c.pack.push(...run.packItems);
    } else
      for (const slot of Object.keys(c.equipment)) c.equipment[slot] = null;
    c.run = null;
    Cards.sync(save);
    ensure(save);
    return true;
  }
  return Object.freeze({
    items,
    tuning,
    quests,
    createItem,
    ensure,
    entity,
    definition,
    capacity,
    move,
    moveAll,
    sort,
    equip,
    unequip,
    gear,
    applyGear,
    buy,
    sell,
    materialCount,
    upgrade,
    build,
    promote,
    questReady,
    quest,
    borrow,
    settle,
  });
});
