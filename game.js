/* DEAD HAND — fixed-camera, turn-based card extraction. No runtime dependencies. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const fieldIcons = { shield: "shield", bolt: "energy", plus: "health", cards: "draw", box: "warehouse", backpack: "backpack", reroll: "reroll", exit: "extract" };
  const icon = (name) =>
    `<svg aria-hidden="true"><use href="${fieldIcons[name] ? "assets/ui/field-icons.svg#" + fieldIcons[name] : "#i-" + name}"/></svg>`;
  const CARDS = CardLibrary.templates,
    BASE_DECK = CardLibrary.baseDeck,
    Rules = CombatRules;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const statusNames = {
    vulnerable: "취약",
    stress: "스트레스",
    seal: "승화",
    curse: "저주",
  };
  const rarityNames = {
    normal: "노말",
    rare: "레어",
    epic: "에픽",
    unique: "유니크",
    legendary: "레전드리",
    mystic: "미스틱",
  };
  const ZONES = [
    {
      name: "외곽 경계",
      english: "THE PERIMETER",
      risk: "I / 경계",
      reward: 120,
      enemies: [
        {
          name: "경계병",
          hp: 18,
          atk: 6,
          pattern: ["attack", "guard", "attack"],
        },
        {
          name: "정찰 드론",
          hp: 22,
          atk: 8,
          drone: true,
          pattern: ["charge", "attack"],
        },
      ],
    },
    {
      name: "적재 구역",
      english: "THE LOADING BAY",
      risk: "II / 위험",
      reward: 240,
      enemies: [
        {
          name: "진압병",
          hp: 26,
          atk: 8,
          armor: 2,
          pattern: ["guard", "attack", "attack"],
        },
        {
          name: "정찰 드론",
          hp: 20,
          atk: 7,
          drone: true,
          pattern: ["charge", "attack"],
        },
        {
          name: "경계병",
          hp: 28,
          atk: 9,
          pattern: ["attack", "guard", "attack"],
        },
      ],
    },
    {
      name: "심층 벙커",
      english: "THE INNER VAULT",
      risk: "III / 치명적",
      reward: 480,
      enemies: [
        {
          name: "중장갑병",
          hp: 34,
          atk: 10,
          armor: 3,
          pattern: ["guard", "attack", "attack"],
        },
        {
          name: "공격 드론",
          hp: 26,
          atk: 9,
          drone: true,
          pattern: ["charge", "attack"],
        },
        {
          name: "벙커 지휘관",
          hp: 38,
          atk: 12,
          armor: 3,
          pattern: ["charge", "attack", "guard", "attack"],
        },
      ],
    },
  ];
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {}
  const loaded = CardLibrary.load(storage);
  let save = loaded.save,
    storageAvailable = loaded.storageAvailable;
  Campaign.ensure(save);
  function persist() {
    if (state.playing && !state.settled) save.campaign.run = clone(state);
    CardLibrary.sync(save);
    storageAvailable = CardLibrary.persist(storage, save);
    if (!storageAvailable)
      notice("현재 창에서만 보존됩니다. 브라우저 저장소를 확인하세요.");
  }
  const state = {
    playing: false,
    mode: "briefing",
    phase: "player",
    zone: 0,
    route: "standard",
    hp: 80,
    maxHp: 80,
    armor: 1,
    shield: 0,
    energy: 3,
    turn: 1,
    loot: 0,
    kills: 0,
    cleared: 0,
    hand: ["shot", "burst", "guard", "scan", "shot"],
    draw: [],
    discard: [],
    runCards: [],
    selected: -1,
    target: 0,
    enemies: [],
    items: {},
    packItems: [],
    fieldLoot: [],
    maintenanceTurns: 0,
    maintenanceUsed: [],
    hazards: [],
    settled: false,
    cards: {},
    bag: [],
    shieldLayers: [],
    statuses: [],
    battleReward: 120,
    rewarded: false,
    time: 0,
    shotAt: -1000,
    shotTarget: -1,
  };
  const instanceFor = (ref) =>
    state.playing
      ? state.cards[ref] || save.instances.find((c) => c.uid === ref) || ref
      : save.instances.find((c) => c.uid === ref) || state.cards[ref] || ref;
  const rawCardFor = (ref) => CardLibrary.compile(instanceFor(ref));
  const runSave = () => ({
    campaign: {
      ...save.campaign,
      items: Object.values(state.items),
      equipment: state.equipment || save.campaign.equipment,
    },
  });
  const runCapacity = () => Campaign.capacity(runSave());
  const cardFor = (ref) => {
    const c = rawCardFor(ref);
    return state.playing ? Campaign.applyGear(c, state.gear || {}) : c;
  };
  const battleState = () => ({
    hp: state.hp,
    maxHp: state.maxHp,
    armor: state.armor,
    energy: state.energy,
    shieldLayers: state.shieldLayers,
    statuses: state.statuses,
    enemies: state.enemies,
  });
  function applyBattle(next) {
    for (const key of ["hp", "energy", "shieldLayers", "statuses", "enemies"])
      state[key] = next[key];
    state.shield = Rules.shield(state);
    for (const e of state.enemies) e.action = e.actions?.[e.actionIndex || 0];
  }
  function makeEnemies(templates, scale = 1) {
    return templates.map((e, id) => {
      const actions = [];
      let delay = 0;
      for (const type of e.pattern) {
        if (type === "charge") {
          delay++;
          continue;
        }
        const card = {
          ...CardLibrary.compile(type === "attack" ? "shot" : "guard"),
          name:
            type === "attack"
              ? e.drone
                ? "드론 사격"
                : "경계 사격"
              : "방탄 엄폐",
          cost: 0,
          damage: type === "attack" ? e.atk : 0,
          block: type === "guard" ? 6 : 0,
          risks: [],
        };
        actions.push({
          type,
          amount: type === "attack" ? e.atk : 6,
          delay,
          card,
        });
        delay = 0;
      }
      if (delay && actions.length) actions[0].delay += delay;
      return {
        ...e,
        id,
        hp: Math.round(e.hp * scale),
        maxHp: Math.round(e.hp * scale),
        shield: 0,
        actions,
        actionIndex: 0,
        action: actions[0],
        wait: actions[0]?.delay || 0,
        hitAt: 0,
        deadAt: 0,
        attackAt: 0,
        weapon: e.drone ? "기관포" : "표준 소총",
        loot: [],
      };
    });
  }
  const touchDevice =
    matchMedia("(pointer:coarse)").matches || navigator.maxTouchPoints > 0;
  document.documentElement.classList.toggle("touch-device", touchDevice);
  let activeModal = null,
    focusBeforeModal = null,
    soundOn = false,
    audio = null,
    inspector = null,
    toastTimer = null,
    sawHint = false,
    cardDrag = null;
  let pendingTimer = null,
    queuedReward = false,
    enemyResolutionPending = false,
    lastTimestamp = 0,
    screens = null,
    noticeTimer = null;
  const scene = new BattlefieldScene($("world"));
  const alive = () => state.enemies.filter((e) => e.hp > 0);
  const isPlaying = () =>
    state.playing &&
    state.mode === "combat" &&
    state.phase === "player" &&
    !activeModal;
  const forecast = () => Rules.forecast(battleState());
  const incomingRaw = () => forecast().raw;
  const incomingDamage = () => forecast().damage;
  const nextAction = (e) => ({
    type: e.actions?.[e.actionIndex || 0]?.type || "attack",
    turns: e.wait || 0,
    value: e.actions?.[e.actionIndex || 0]?.amount || e.atk,
  });
  const projection = (c, target) =>
    Rules.preview(battleState(), c, target?.id ?? state.target);
  const keywords = (text) =>
    String(text).replace(
      /(장갑·방어를 무시|방어 무시|에너지 부족|처치|행동 취소|피해|방어|회복|에너지|전체|뽑기|공격|\d+(?:장)?|[+−]\d+)/g,
      '<strong class="combat-keyword">$1</strong>',
    );
  function sound(kind) {
    if (!soundOn || save.campaign.settings.volume === 0) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") void audio.resume();
      const o = audio.createOscillator(),
        g = audio.createGain(),
        now = audio.currentTime;
      const freq =
        {
          shot: 110,
          hit: 75,
          guard: 420,
          card: 660,
          win: 780,
          hurt: 55,
          click: 300,
        }[kind] || 300;
      o.type = kind === "shot" || kind === "hurt" ? "sawtooth" : "sine";
      o.frequency.setValueAtTime(freq, now);
      o.frequency.exponentialRampToValueAtTime(
        Math.max(30, freq * 0.35),
        now + 0.15,
      );
      g.gain.setValueAtTime(
        (kind === "shot" ? 0.08 : 0.035) * save.campaign.settings.volume,
        now,
      );
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      o.connect(g);
      g.connect(audio.destination);
      o.start();
      o.stop(now + 0.23);
    } catch {
      soundOn = false;
      updateSoundButton();
    }
  }
  function notice(text) {
    const n = $("campaign-toast");
    n.textContent = text;
    n.classList.remove("hidden");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => n.classList.add("hidden"), 3200);
  }
  function applySettings() {
    const x = save.campaign.settings;
    soundOn = x.sound;
    scene.reducedMotion =
      !x.motion || matchMedia("(prefers-reduced-motion:reduce)").matches;
    document.documentElement.style.setProperty("--ui-factor", x.scale);
    updateSoundButton();
  }
  function notify(text, duration = 2200) {
    clearTimeout(toastTimer);
    $("scene-message").textContent = text;
    $("scene-message").classList.add("visible");
    toastTimer = setTimeout(
      () => $("scene-message").classList.remove("visible"),
      duration,
    );
  }
  function riskBrief(c) {
    return (c.risks || [])
      .map((r) =>
        r.type === "hp"
          ? `체력 −${r.amount}`
          : r.type === "energy"
            ? `비용 +${r.amount}`
            : r.type === "erosion"
              ? `침식 +${r.amount}%`
              : `${statusNames[r.type] || r.type}${r.type === "stress" ? ` ${r.amount}%` : r.type === "vulnerable" ? ` −${r.amount}` : ""} ${r.turns}턴`,
      )
      .join(" · ");
  }
  function briefFor(c) {
    return [
      c.damage
        ? `${c.damage} 피해${c.hits > 1 ? ` ×${c.hits}` : ""}${c.aoe ? " · 전체" : ""}`
        : "",
      c.block ? `${c.block} 쉴드 · ${c.shieldDuration}턴` : "",
      c.heal ? `체력 ${c.heal} 회복` : "",
      c.energyGain ? `에너지 +${c.energyGain}` : "",
      c.draw ? `카드 +${c.draw}` : "",
      c.shatter ? "쉴드 해제" : "",
      c.pierce ? "장갑 무시" : "",
      c.delay ? `무력화 +${c.delay}` : "",
      c.targets > 1 && !c.aoe ? `${c.targets}대상` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  function summaryMarkup(c) {
    const text = briefFor(c);
    return text
      .replace(/\d+/g, (n) => `<b class="effect-value">${n}</b>`)
      .replace(
        /\+<b class="effect-value">(\d+)<\/b>/g,
        '<b class="effect-value">+$1</b>',
      );
  }
  const optionNames = {
    damage: "피해",
    block: "쉴드",
    heal: "회복",
    draw: "드로우",
    energyGain: "에너지 획득",
    hits: "공격 횟수",
    shieldDuration: "쉴드 지속",
    targets: "대상 수",
    pierce: "철갑탄",
    shatter: "해제",
    delay: "무력화",
    cost: "에너지 비용",
  };
  function riskDetails(r) {
    const t = r.turns || 1,
      n = r.amount || 0;
    return (
      {
        hp: `체력 소모: 사용 전에 체력 ${n}을 소모합니다. 현재 체력이 ${n}보다 커야 합니다.`,
        energy: `추가 비용: 에너지를 ${n} 더 소모합니다.`,
        vulnerable: `취약: ${t}턴 동안 장갑이 ${n} 감소합니다.`,
        stress: `스트레스: ${t}턴 동안 각 타격의 명중률이 ${n}%p 감소합니다. 이 카드부터 적용됩니다.`,
        seal: `승화: ${t}턴 동안 쉴드가 0으로 고정되며 쉴드를 얻을 수 없습니다.`,
        curse: `저주: ${t}턴 동안 카드 사용 시 남은 손패를 버리고 같은 장수를 다시 뽑습니다.`,
        erosion: `파멸의식: 사용한 카드의 침식이 ${n}%p 증가합니다.`,
      }[r.type] || ""
    );
  }
  function cardDetails(ref, c) {
    const data = CardLibrary.breakdown(instanceFor(ref)),
      e = data.effects;
    const gearBonus =
      state.playing && c.type === "attack" ? state.gear?.damage || 0 : 0;
    const value = (type) =>
      `${e[type].base}${e[type].bonus ? "(" + (e[type].bonus > 0 ? "+" : "") + e[type].bonus + ")" : ""}`;
    const lines = [];
    if (c.damage)
      lines.push(
        `피해를 ${value("damage")}${gearBonus ? " [장비 +" + gearBonus + "]" : ""} 줍니다.${c.aoe ? " 모든 적에게 적용합니다." : ""}`,
      );
    if (c.hits > 1)
      lines.push(
        `${value("hits")}회 공격합니다. 각 타격의 명중을 따로 판정합니다.`,
      );
    if (c.block)
      lines.push(
        `쉴드를 ${value("block")} 얻어 ${value("shieldDuration")}턴 유지합니다.`,
      );
    if (c.heal) lines.push(`체력을 ${value("heal")} 회복합니다.`);
    if (c.energyGain) lines.push(`에너지를 ${value("energyGain")} 얻습니다.`);
    if (c.draw) lines.push(`카드를 ${value("draw")}장 뽑습니다.`);
    if (c.pierce)
      lines.push("철갑탄: 장갑을 무시합니다. 쉴드는 피해를 흡수합니다.");
    if (c.shatter)
      lines.push(
        "해제: 첫 명중의 피해 계산 전에 대상의 쉴드를 전량 제거합니다.",
      );
    if (c.delay)
      lines.push(
        `무력화: 명중한 대상의 행동 대기를 ${value("delay")} 늘립니다. 카드당 한 번 적용합니다.`,
      );
    if (c.targets > 1 && !c.aoe) lines.push(`대상 수 ${value("targets")}.`);
    const sections = [];
    if (
      state.playing &&
      c.type === "attack" &&
      (gearBonus || state.gear?.accuracy)
    )
      sections.push({
        title: "장비 보정",
        items: [
          ...(gearBonus ? [`주무기: 타격당 피해 +${gearBonus}`] : []),
          ...(state.gear.accuracy
            ? [`보조무기: 명중 +${state.gear.accuracy}%p (최대 100%)`]
            : []),
        ],
      });
    if (data.options.length)
      sections.push({
        title: "강화 옵션",
        items: data.options.map(
          (o) =>
            `${rarityNames[o.tier]} · ${optionNames[o.type]}${["pierce", "shatter"].includes(o.type) ? "" : ` +${o.value}`}${o.bonus ? " · 리스크 보너스" : ""}`,
        ),
      });
    if (data.risks.length)
      sections.push({
        title: "리스크 · 본효과보다 먼저 적용",
        items: data.risks.map(riskDetails),
      });
    return { description: lines.join("\n"), sections };
  }
  function damageText(t) {
    return t.minDamage === t.maxDamage
      ? String(t.maxDamage)
      : `${t.minDamage}–${t.maxDamage}`;
  }
  function previewFor(c, target) {
    if (!c) return "";
    const p = projection(c, target);
    if (!p.ok) return p.error;
    const t = p.targets.find((t) => t.id === target?.id),
      parts = [];
    if (t)
      parts.push(
        `피해 ${damageText(t)}${p.accuracy < 100 ? ` · 타격마다 명중 ${p.accuracy}%` : ""}`,
        `남은 체력 ${t.afterMin === t.afterMax ? t.afterMin : `${t.afterMin}–${t.afterMax}`}`,
      );
    if (c.block)
      parts.push(
        p.block
          ? `쉴드 +${p.block} · ${c.shieldDuration}턴`
          : "승화 · 쉴드 획득 차단",
      );
    if (c.heal) parts.push(`체력 +${p.heal}`);
    if (p.draw) parts.push(`카드 ${p.draw}장`);
    if (p.energyGain) parts.push(`에너지 +${p.energyGain}`);
    if (p.reroll)
      parts.push(`남은 손패 ${Math.max(0, state.hand.length - 1)}장 교체`);
    return parts.join(" · ");
  }
  function shuffle(items) {
    const list = [...items];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  function cardMarkup(id, index, opts = {}) {
    const c = cardFor(id);
    const disabled = opts.disabled ? "disabled" : "";
    return `<button class="card ${c.type} ${state.selected === index && !opts.reward ? "selected" : ""} ${opts.extraClass || ""} ${opts.unavailable ? "unavailable" : ""}" data-options="${instanceFor(id)?.options?.length || 0}" data-rarity="${c.rarity}" data-card="${c.templateId}" data-instance="${id}" ${opts.reward ? 'data-reward="' + (opts.rewardId || id) + '"' : 'data-index="' + index + '"'} ${disabled} aria-label="${c.name}, ${rarityNames[c.rarity]}, 에너지 ${c.cost}, ${briefFor(c)}, ${riskBrief(c)}" ${!opts.reward ? 'aria-pressed="' + (state.selected === index) + '"' : ""}>
      <span class="card-top"><span class="card-cost"><small>비용</small><b>${c.cost}</b></span><span class="card-grip" title="잡아서 대상에게 끌기" aria-hidden="true">⠿</span><span class="card-type">${c.loan ? "대여" : rarityNames[c.rarity]}</span></span>
      <span class="card-art">${GameArt.visual("card", c.templateId, c.icon, "card-illustration")}</span><span class="card-name">${c.name}</span><span class="card-brief">${summaryMarkup(c)}</span><span class="card-desc">${keywords(c.desc)}</span>
      ${riskBrief(c) ? `<span class="card-risk">${riskBrief(c)}</span>` : ""}<span class="card-bottom"><span>${opts.reward ? rarityNames[c.rarity] : index + 1}</span><span>${opts.bottom || `에너지 ${c.cost} 사용`}</span></span></button>`;
  }

  function renderHand() {
    const scroll = $("hand").scrollLeft;
    $("hand").innerHTML =
      state.hand
        .map((id, i) =>
          cardMarkup(id, i, {
            disabled: !isPlaying(),
            unavailable: !projection(
              cardFor(id),
              state.enemies.find((e) => e.id === state.target),
            ).ok,
            bottom: cardFor(id).cost > state.energy ? "에너지 부족" : undefined,
          }),
        )
        .join("") ||
      '<div class="card empty">턴 종료로 보충 · 뽑기 더미가 비면 리롤</div>';
    $("hand").scrollLeft = scroll;
    $("hand")
      .querySelectorAll("[data-index]")
      .forEach((b) =>
        b.addEventListener("click", () => chooseCard(Number(b.dataset.index))),
      );
    if (state.selected >= 0)
      $("hand")
        .querySelector(".selected")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    $("hand-count").textContent = String(state.hand.length).padStart(2, "0");
    $("draw-count").textContent =
      state.mode === "briefing" ? "7" : state.draw.length;
    $("discard-count").textContent = state.discard.length;
    $("hand-hint").textContent =
      state.selected >= 0
        ? `${cardFor(state.hand[state.selected]).name} 선택 · 효과 확인 후 사용`
        : "카드 선택 → 효과 확인 → 사용";
  }
  function positionTargets() {
    const scale =
      scene.width / Math.max(1, $("world").getBoundingClientRect().width);
    $("enemy-targets").style.setProperty(
      "--enemy-hud-width",
      Math.min(
        184,
        $("viewport").clientWidth * (state.enemies.length >= 3 ? 0.25 : 0.32),
      ) + "px",
    );
    scene.labelSpace =
      (Math.max(
        0,
        ...[...$("enemy-targets").querySelectorAll(".enemy-caption")].map(
          (e) => e.offsetHeight,
        ),
      ) +
        14) *
      scale;
    for (const rect of scene.getTargets(state.enemies)) {
      const b = $("enemy-targets").querySelector(`[data-enemy="${rect.id}"]`);
      if (!b) continue;
      Object.assign(b.style, {
        left: rect.left + "%",
        top: rect.top + "%",
        width: rect.width + "%",
        height: rect.height + "%",
      });
    }
  }
  function renderEnemies() {
    $("enemy-targets").innerHTML = alive()
      .map((e) => {
        const action = nextAction(e),
          now = action.turns === 0;
        return `<button class="enemy-target ${state.target === e.id ? "targeted" : ""}" data-enemy="${e.id}" aria-pressed="${state.target === e.id}" aria-label="${e.name}, 체력 ${e.hp}/${e.maxHp}, ${now ? "이번 적 차례" : action.turns + "턴 대기 후"} ${action.type === "attack" ? "공격" : "방어"} ${action.value}" ${!isPlaying() ? "disabled" : ""}>
        <span class="enemy-caption"><strong class="enemy-name">${e.name}</strong>
          <span class="enemy-vitals"><span class="enemy-hp"><i class="hp-remaining" style="width:${(e.hp / e.maxHp) * 100}%"></i><i class="hp-loss"></i></span><span class="enemy-hp-value"><b>${e.hp}</b><small>/${e.maxHp}</small></span></span>
          <span class="enemy-action ${action.type}"><span class="action-countdown"><b>${now ? "준비" : action.turns}</b><small>${now ? "이번 차례" : "턴 대기"}</small></span><span class="action-content">${action.type === "attack" ? "공격" : "방어"} <b>${action.type === "guard" ? "+" : ""}${action.value}</b></span></span>
          <span class="enemy-loadout">${e.weapon || "소총"} · 장갑 ${e.armor || 0}</span><span class="enemy-preview hidden"></span>
        </span><span class="target-corners"></span></button>`;
      })
      .join("");
    $("enemy-targets")
      .querySelectorAll("[data-enemy]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          if (!isPlaying()) return;
          state.target = Number(b.dataset.enemy);
          renderHUD();
          if (state.selected >= 0)
            inspector.select({
              kind: "card",
              index: state.selected,
              id: state.hand[state.selected],
            });
          else inspector.select({ kind: "enemy", id: state.target });
        }),
      );
    positionTargets();
    $("enemy-targets").classList.toggle("hidden", state.mode !== "combat");
  }
  function renderHUD() {
    cardDrag?.cancel();
    if (!alive().some((e) => e.id === state.target))
      state.target = alive()[0]?.id ?? -1;
    document
      .querySelector(".health-track")
      .setAttribute("aria-valuenow", state.hp);
    $("armor-value").textContent = state.armor;
    $("hp-value").textContent = state.hp;
    $("hp-max").textContent = state.maxHp;
    document
      .querySelector(".health-track")
      .setAttribute("aria-valuemax", state.maxHp);
    $("hp-bar").style.width = `${(state.hp / state.maxHp) * 100}%`;
    $("hp-bar").style.background =
      state.hp < 25 ? "var(--red)" : "var(--green)";
    $("shield-value").textContent = state.shield;
    $("energy-value").textContent = state.energy;
    document
      .querySelector(".shield-label")
      .classList.toggle("zero", state.shield === 0);
    $("energy-pips").innerHTML = Array.from(
      { length: Math.max(3, state.energy) },
      (_, i) => `<i class="${i >= state.energy ? "used" : ""}"></i>`,
    ).join("");
    $("turn-number").textContent = String(state.turn).padStart(2, "0");
    $("loot-value").textContent = state.loot.toLocaleString();
    $("enemy-count").textContent = String(alive().length).padStart(2, "0");
    $("collection-count").textContent = save.campaign.stash.length;
    $("player-state").textContent = {
      briefing: "출정 대기",
      route: "진입 경로 선택",
      combat: state.phase === "enemy" ? "적 행동 진행" : "카드 행동 선택",
      reward: "상자 발견",
      maintenance: "정비 중",
      cleared: "회수 경로 확보",
      dead: "작전 실패",
      won: "귀환 완료",
    }[state.mode];
    const chosen = cardFor(state.hand[state.selected]),
      target = state.enemies.find((e) => e.id === state.target);
    $("end-turn-btn").disabled = !isPlaying();
    $("fire-btn").disabled =
      !isPlaying() || !chosen || !projection(chosen, target).ok;
    $("fire-label").textContent = chosen ? chosen.name : "카드를 선택하세요";
    $("fire-target").textContent =
      chosen?.type === "attack"
        ? target?.name || "대상 선택"
        : chosen
          ? "나에게 사용"
          : "";
    $("intent-text").textContent = incomingDamage()
      ? `−${incomingDamage()}`
      : "0";
    $("enemy-intent").classList.toggle("safe", incomingDamage() === 0);
    $("enemy-intent").setAttribute(
      "aria-label",
      `턴 종료 예상 피해 ${incomingDamage()}. 상세 정보 보기`,
    );
    $("incoming-health").textContent = `예상 체력 감소 ${incomingDamage()}`;
    $("preview-target").textContent =
      chosen && chosen.type !== "attack"
        ? "나에게 사용"
        : target
          ? `${target.name} · 체력 ${target.hp}`
          : "대상 없음";
    const preview = previewFor(chosen, target);
    $("action-preview").textContent = preview;
    $("preview-cost").textContent = chosen
      ? `비용 ${chosen.cost} / 보유 ${state.energy}`
      : `에너지 ${state.energy} / 3`;
    $("enemy-intent").classList.toggle("hidden", state.mode !== "combat");
    $("phase-label").textContent =
      state.phase === "enemy" ? "적 행동" : `내 턴 · ${state.turn}`;
    const shortEffect = chosen ? previewFor(chosen, target) : "";
    $("phase-description").textContent =
      state.phase === "enemy"
        ? "예고한 행동을 실행합니다"
        : chosen
          ? shortEffect
          : "대상 선택 → 카드 선택 → 사용";
    $("phase-banner").classList.toggle("enemy-phase", state.phase === "enemy");
    $("phase-banner").classList.toggle("hidden", state.mode !== "combat");
    $("extract-menu-btn").classList.toggle("hidden", state.mode !== "cleared");
    $("scene-location").textContent =
      `SEC.0${state.zone + 1} / ${ZONES[state.zone].english}`;
    $("zone-name").textContent = ZONES[state.zone].name;
    $("danger-level").textContent = ZONES[state.zone].risk;
    $("mission-panel").classList.toggle("hidden", state.mode === "briefing");
    document.body.classList.toggle("in-battle", state.mode === "combat");
    document.body.classList.toggle("battle-cleared", state.mode === "cleared");
    document.body.dataset.mode = state.mode;
    document.body.classList.toggle(
      "has-selection",
      !!chosen && state.mode === "combat",
    );
    $("sector-progress")
      .querySelectorAll("span")
      .forEach((s, i) => {
        s.classList.toggle("active", i === state.zone);
        s.classList.toggle("completed", i < state.cleared);
      });
    $("reroll-btn").disabled = !isPlaying() || !state.bag.length;
    $("status-effects").textContent = Rules.activeStatuses(state)
      .map(
        (s) =>
          `${statusNames[s.type]} ${s.type === "stress" ? s.amount + "% · " : s.type === "vulnerable" ? "−" + s.amount + " · " : ""}${s.turns}턴`,
      )
      .join(" / ");
    $("equipment-summary").textContent = state.playing
      ? `${state.gear?.primary || "비무장"} · 장갑 ${state.armor}`
      : "";
    $("last-player-card").textContent = state.lastPlayerCard || "";
    $("last-enemy-card").textContent = state.lastEnemyCard || "";
    $("hazard-indicator").textContent = state.hazards.length
      ? `투척물 ${state.hazards.map((x) => "적 진영 " + x.turns + "턴").join(" / ")}`
      : "";
    renderHand();
    renderEnemies();
    inspector?.refresh();
  }
  function drawCards(count, recycleDiscard = false) {
    for (let i = 0; i < count; i++) {
      if (state.hand.length >= 8) {
        notify("손패는 최대 8장입니다.");
        break;
      }
      if (!state.draw.length && recycleDiscard) {
        state.draw = shuffle(state.discard);
        state.discard = [];
      }
      if (!state.draw.length) break;
      state.hand.push(state.draw.pop());
    }
  }
  function syncPiles() {
    const valid = new Set(state.bag),
      used = new Set();
    for (const key of ["hand", "draw", "discard"])
      state[key] = state[key].filter((id) => {
        if (!valid.has(id) || used.has(id)) return false;
        used.add(id);
        return true;
      });
    const added = state.bag.filter((id) => !used.has(id));
    if (added.length) state.draw = shuffle([...state.draw, ...added]);
  }
  function prepareDeck(first = false) {
    const deck = [...state.bag];
    state.hand = [];
    state.discard = [];
    if (first) {
      for (const type of ["shot", "burst", "guard", "scan", "shot"]) {
        const i = deck.findIndex((ref) => cardFor(ref).templateId === type);
        if (i >= 0) state.hand.push(deck.splice(i, 1)[0]);
      }
    }
    state.draw = shuffle(deck);
    if (!first) drawCards(5);
    state.selected = -1;
  }
  function reroll() {
    if (!isPlaying() || !state.bag.length) return;
    inspector?.hide();
    cardDrag?.cancel();
    state.draw = shuffle([...state.draw, ...state.discard, ...state.hand]);
    state.hand = [];
    state.discard = [];
    state.selected = -1;
    sound("card");
    endTurn();
    notify("리롤 · 버림 카드 회수 · 적 행동 후 손패 보충");
  }
  function openRoute(index) {
    clearTimeout(pendingTimer);
    state.zone = index;
    state.mode = "route";
    state.phase = "player";
    state.selected = -1;
    state.enemies = [];
    renderHUD();
    const z = ZONES[index],
      safeCount = index ? z.enemies.length - 1 : z.enemies.length;
    showModal(
      `<div class="eyebrow">CHOOSE YOUR ENTRY / SECTOR 0${index + 1}</div><h2 id="modal-title">${z.name}. <em>진입 경로 선택.</em></h2><p class="modal-copy">전투는 정해진 시점에서 진행됩니다. 적의 의도를 읽고 카드로 행동하세요.<br>현재 체력 <b>${state.hp}/${state.maxHp}</b> · 휴대금 <b>${state.loot} CR</b></p>
      <div class="route-options"><button id="route-standard" class="route-card"><span class="route-icon">${icon("crosshair")}</span><small>DIRECT ENTRY / ${z.risk}</small><strong>${index === 0 ? "검문소 돌파" : index === 1 ? "적재장 돌파" : "중앙 벙커 돌파"}</strong><p>${z.enemies.length}명과 전투 · 기본 보상 ${z.reward} CR</p><span class="route-benefit">높은 회수 가치 <b>진입 →</b></span></button><button id="route-supply" class="route-card supply"><span class="route-icon">${icon("plus")}</span><small>SUPPLY ROUTE / 위험 완화</small><strong>보급 창고 우회</strong><p>${safeCount}명과 전투 · 기본 보상 ${Math.round(z.reward * 0.65)} CR</p><span class="route-benefit">적 체력 −15% · 승리 시 체력 +8 <b>진입 →</b></span></button></div><p class="reward-note">모든 경로에서 보상 카드 1장을 발견합니다. 귀환해야 카드와 전리품이 확정됩니다.</p>`,
      true,
      "route",
    );
    $("route-standard").addEventListener("click", () =>
      startZone(index, "standard"),
    );
    $("route-supply").addEventListener("click", () =>
      startZone(index, "supply"),
    );
  }
  function startZone(index, route = "standard") {
    closeModal();
    state.zone = index;
    state.route = route;
    state.mode = "combat";
    state.phase = "player";
    state.energy = 3;
    state.shield = index ? Rules.shield(state) : 0;
    state.shieldLayers = index ? state.shieldLayers : [];
    state.statuses = index ? state.statuses : [];
    state.turn = 1;
    state.rewarded = false;
    const templates =
      route === "supply" && index
        ? ZONES[index].enemies.slice(0, -1)
        : ZONES[index].enemies;
    state.enemies = makeEnemies(templates, route === "supply" ? 0.85 : 1);
    for (const e of state.enemies) {
      const loot = [
        Campaign.createItem(e.drone ? "circuit" : "rifle"),
        Campaign.createItem("scrap"),
        ...(e.armor
          ? [Campaign.createItem(e.armor >= 2 ? "heavyVest" : "vest")]
          : []),
      ];
      for (const x of loot) state.items[x.uid] = x;
      e.loot = loot.map((x) => x.uid);
      e.cash = 30 * (index + 1);
    }
    save.campaign.best = Math.max(save.campaign.best, index + 1);
    state.battleReward = Math.round(
      ZONES[index].reward * (route === "supply" ? 0.65 : 1),
    );
    state.target = 0;
    if (index === 0) prepareDeck(true);
    else {
      syncPiles();
      drawCards(Math.max(0, 5 - state.hand.length));
    }
    renderHUD();
    sound("card");
    persist();
    if (!sawHint) {
      notify(
        touchDevice
          ? "⠿ 손잡이로 대상에게 끌어 놓아 사용"
          : "공격→적 · 방어/회복→내 상태 · 전술→배낭",
        3500,
      );
      sawHint = true;
    }
  }
  function deploy() {
    if (save.campaign.run) {
      notice("진행 중 탐사를 먼저 계속하세요.");
      return;
    }
    const c = save.campaign;
    if (c.pack.length > Campaign.capacity(save)) {
      notice("배낭 용량을 초과했습니다. 창고로 정리한 뒤 출정하세요.");
      screens.show("base");
      return;
    }
    const refs = c.pack.filter((id) =>
      save.instances.some((x) => x.uid === id),
    );
    if (!refs.length) {
      notice("배낭에 카드를 한 장 이상 넣어주세요.");
      screens.show("base");
      return;
    }
    clearTimeout(pendingTimer);
    enemyResolutionPending = false;
    queuedReward = false;
    closeModal();
    screens.hide();
    const gear = Campaign.gear(save);
    Object.assign(state, {
      playing: true,
      settled: false,
      hp: gear.maxHp,
      maxHp: gear.maxHp,
      armor: gear.armor,
      gear,
      loot: c.cash,
      kills: 0,
      cleared: 0,
      runCards: [],
      soldCards: [],
      hand: [],
      draw: [],
      discard: [],
      shield: 0,
      shieldLayers: [],
      statuses: [],
      selected: -1,
      items: Object.fromEntries(c.items.map((x) => [x.uid, clone(x)])),
      equipment: clone(c.equipment),
      packItems: c.pack.filter((id) => c.items.some((x) => x.uid === id)),
      departureItems: [
        ...c.pack.filter((id) => c.items.some((x) => x.uid === id)),
        ...Object.values(c.equipment).filter(Boolean),
      ],
      hazards: [],
      lastPlayerCard: "",
      lastEnemyCard: "",
      fieldShopUsed: false,
    });
    state.cards = Object.fromEntries(
      save.instances.map((x) => [x.uid, clone(x)]),
    );
    state.bag = [...refs];
    c.run = clone(state);
    persist();
    $("briefing").classList.add("hidden");
    $("sector-stamp").classList.add("hidden");
    openRoute(0);
  }
  function resumeRun() {
    const r = save.campaign.run;
    if (!r) return;
    if (
      !Array.isArray(r.bag) ||
      !r.cards ||
      r.bag.some(
        (id) => !CardLibrary.create(r.cards[id]?.templateId, r.cards[id]),
      )
    ) {
      notice("탐사 기록을 읽을 수 없습니다. 저장 원본을 보존했습니다.");
      return;
    }
    Object.assign(state, clone(r));
    state.soldCards ||= [];
    screens.hide();
    state.playing = true;
    for (const e of state.enemies) {
      e.hitAt = 0;
      e.attackAt = 0;
    }
    $("briefing").classList.add("hidden");
    $("sector-stamp").classList.add("hidden");
    renderHUD();
    if (state.mode === "combat" && state.phase === "enemy") resolveEnemyTurn();
    else if (state.mode === "route") openRoute(state.zone);
    else if (state.mode === "reward") showReward();
    else if (state.mode === "maintenance") {
      if (state.maintenanceTurns <= 0) finishMaintenance();
      else showMaintenance();
    } else if (state.mode === "cleared") showDecision();
  }
  function chooseCard(index) {
    if (!isPlaying() || cardDrag?.active) return;
    const id = state.hand[index];
    if (!id) return;
    const deselect = state.selected === index;
    inspector?.hide();
    state.selected = deselect ? -1 : index;
    renderHUD();
    sound("click");
    if (!deselect) inspector?.select({ kind: "card", id, index });
  }
  function fire() {
    if (!isPlaying() || cardDrag?.active) return;
    if (state.selected < 0) {
      notify("먼저 카드를 선택하세요.");
      return;
    }
    playCard(
      state.selected,
      state.enemies.find((e) => e.id === state.target && e.hp > 0),
    );
  }
  function playCard(index, target) {
    if (!isPlaying()) return;
    const ref = state.hand[index],
      c = cardFor(ref);
    if (!c) return;
    const result = Rules.play(battleState(), c, target?.id ?? state.target);
    if (!result.ok) {
      notify(result.error);
      return;
    }
    inspector?.hide();
    const before = new Set(alive().map((e) => e.id)),
      hitTotals = new Map();
    state.hand.splice(index, 1);
    state.selected = -1;
    applyBattle(result.state);
    for (const event of result.events) {
      if (event.type === "reroll") {
        const count = state.hand.length;
        state.discard.push(...state.hand);
        state.hand = [];
        drawCards(count, true);
      }
      if (event.type === "draw") drawCards(event.count);
      if (event.type === "erosion" && state.cards[ref])
        state.cards[ref].erosion = clamp(
          state.cards[ref].erosion + event.amount,
          0,
          100,
        );
      if (event.type === "hit") {
        const e = state.enemies.find((e) => e.id === event.id);
        e.hitAt = performance.now();
        hitTotals.set(e.id, (hitTotals.get(e.id) || 0) + event.hpDamage);
        e.lastDamage = hitTotals.get(e.id);
      }
    }
    // Keep the resolving card outside both recyclable piles until curse/draw finish.
    state.discard.push(ref);
    let kills = 0;
    for (const e of state.enemies)
      if (before.has(e.id) && e.hp === 0) {
        e.deadAt = performance.now();
        state.kills++;
        kills++;
      }
    if (c.type === "attack") {
      state.target = target?.id ?? state.target;
      state.shotTarget = state.target;
      state.shotAt = performance.now();
      sound("shot");
    } else sound(c.block || c.heal ? "guard" : "card");
    const misses = result.events.filter((e) => e.type === "miss").length;
    state.lastPlayerCard = c.name;
    notify(
      kills
        ? `${kills}명 제압 · 전리품 회수 가능`
        : misses
          ? `빗나감 ${misses}회${result.events.some((e) => e.type === "hit") ? " · 일부 명중" : ""}`
          : c.type === "attack"
            ? "명중"
            : briefFor(c),
    );
    if (!alive().length) finishCombat();
    renderHUD();
    persist();
  }
  function finishCombat() {
    state.shieldLayers = [];
    state.statuses = [];
    state.shield = 0;
    state.mode = "reward";
    state.rewarded = true;
    state.cleared = state.zone + 1;
    state.fieldLoot = state.enemies.flatMap((e) => e.loot || []);
    const cash = {
      uid: "cash-" + state.zone,
      templateId: "cash",
      qty: state.battleReward + state.enemies.reduce((n, e) => n + e.cash, 0),
    };
    state.items[cash.uid] = cash;
    state.fieldLoot.push(cash.uid);
    state.rewardOptions = (
      state.zone === 0
        ? ["pierce", "suppress", "bulwark"]
        : shuffle(["grenade", "surge", "breach", "fieldAid", "bulwark"]).slice(
            0,
            3,
          )
    ).map((id) => {
      const c = CardLibrary.create(id, { unstable: true });
      state.cards[c.uid] = c;
      return c.uid;
    });
    state.maintenanceTurns = Campaign.tuning.maintenanceTurns;
    state.maintenanceUsed = [];
    if (state.route === "supply")
      state.hp = Math.min(state.maxHp, state.hp + 8);
    pendingTimer = setTimeout(() => {
      if (state.mode === "reward") {
        if (activeModal) queuedReward = true;
        else showReward();
      }
    }, 650);
  }
  function endTurn() {
    if (!isPlaying()) return;
    cardDrag?.cancel();
    inspector?.hide();
    state.phase = "enemy";
    state.selected = -1;
    renderHUD();
    for (const e of alive())
      if (e.wait === 0 && nextAction(e).type === "attack")
        e.attackAt = performance.now();
    persist();
    pendingTimer = setTimeout(resolveEnemyTurn, 420);
  }
  function resolveEnemyTurn() {
    if (state.mode !== "combat" || state.phase !== "enemy") return;
    if (activeModal) {
      enemyResolutionPending = true;
      return;
    }
    enemyResolutionPending = false;
    const before = state.hp,
      result = Rules.round(battleState());
    applyBattle(result.state);
    const damage = before - state.hp;
    if (damage) {
      $("damage-flash").classList.add("hit");
      setTimeout(() => $("damage-flash").classList.remove("hit"), 130);
      sound("hurt");
    } else sound("guard");
    state.lastEnemyCard = result.events
      .filter((x) => x.type === "enemy-card")
      .map((x) => x.name)
      .join(" · ");
    if (!state.hp) {
      state.statuses = [];
      state.shieldLayers = [];
      state.shield = 0;
      state.mode = "dead";
      settleRun(false);
      renderHUD();
      showOutcome(false);
      return;
    }
    for (const h of state.hazards) h.turns--;
    for (const h of state.hazards.filter((x) => x.turns <= 0)) {
      if (!alive().length) break;
      const living = new Set(alive().map((e) => e.id)),
        statuses = state.statuses,
        r = Rules.play(
          {
            ...battleState(),
            statuses: statuses.filter((x) => x.type !== "stress"),
          },
          { type: "attack", cost: 0, damage: h.damage, aoe: true, hits: 1 },
          alive()[0].id,
        );
      applyBattle({ ...r.state, statuses });
      for (const e of state.enemies)
        if (living.has(e.id) && e.hp <= 0) {
          e.deadAt = performance.now();
          state.kills++;
        }
      notify(`수류탄 폭발 · 전체 기본 피해 ${h.damage}`);
    }
    state.hazards = state.hazards.filter((x) => x.turns > 0);
    if (!alive().length) {
      finishCombat();
      renderHUD();
      persist();
      return;
    }
    state.energy = 3;
    state.turn++;
    state.phase = "player";
    drawCards(Math.max(0, 5 - state.hand.length));
    renderHUD();
    notify(damage ? `체력 −${damage}` : "내 턴");
    persist();
  }
  function showModal(content, wide = false, kind = "info") {
    cardDrag?.cancel();
    inspector?.hide();
    $("scene-message").classList.remove("visible");
    if (!activeModal) focusBeforeModal = document.activeElement;
    activeModal = kind;
    $("modal").dataset.kind = kind;
    $("modal").className =
      `modal${wide ? " wide" : ""}${kind === "inventory" ? " inventory-modal" : ""}`;
    $("modal").innerHTML = content;
    $("modal-backdrop").classList.remove("hidden");
    $("modal").focus();
    renderHUD();
    $("modal")
      .querySelectorAll("[data-close]")
      .forEach((b) => b.addEventListener("click", closeModal));
  }
  function closeModal() {
    const previous = activeModal;
    activeModal = null;
    $("modal-backdrop").classList.add("hidden");
    if (focusBeforeModal?.isConnected)
      focusBeforeModal.focus({ preventScroll: true });
    renderHUD();
    if (enemyResolutionPending) resolveEnemyTurn();
    if (queuedReward && state.mode === "reward" && previous !== "reward") {
      queuedReward = false;
      showReward();
    }
  }
  function showReward() {
    queuedReward = false;
    showModal(
      `<div class="chest-scene"><div class="eyebrow">SECTOR ${state.zone + 1} / LOOT ROOM</div><h2 id="modal-title">구역 확보. <em>남겨진 보급품.</em></h2><button id="open-chest" class="chest-button"><span class="asset-visual chest-art" aria-hidden="true"><img class="asset-icon" data-art-image src="assets/generated/props/crate.webp" alt="" draggable="false"><svg class="asset-fallback"><use href="#i-box"/></svg></span><strong>상자 열기 · 정비 시작</strong><small>적 장비·물품 회수 / 정비 ${Campaign.tuning.maintenanceTurns}턴</small></button></div>`,
      true,
      "reward",
    );
    $("open-chest").addEventListener("click", () => {
      state.mode = "maintenance";
      state.energy = 3;
      persist();
      showMaintenance();
    });
  }
  let lootDraft = null;
  const runName = (id) =>
    state.cards[id]
      ? cardFor(id).name
      : state.items[id]?.templateId === "cash"
        ? `${state.items[id].qty} CR`
        : Campaign.items[state.items[id]?.templateId]?.name || "물품";
  const runArt = (id) =>
    GameArt.visual(
      state.cards[id] ? "card" : "item",
      (state.cards[id] || state.items[id])?.templateId,
      state.cards[id] ? "cards" : "box",
      "compact-art",
    );
  function showMaintenance(reset = true) {
    if (state.mode !== "maintenance") return;
    const expanded = !!$("modal")
      .querySelector(".maintenance-cards")
      ?.closest("details")?.open;
    if (reset || !lootDraft)
      lootDraft = {
        pack: [...state.bag, ...state.packItems],
        loot: [...state.fieldLoot],
        choice: null,
      };
    const tiles = (ids, side) =>
      ids
        .map(
          (id) =>
            `<button data-loot-id="${id}" data-side="${side}" class="loot-entry">${runArt(id)}<strong>${runName(id)}</strong><small>${state.cards[id] ? (state.cards[id].unstable ? "불안정 카드" : "안정 카드") : state.items[id]?.templateId === "cash" ? "휴대금" : Campaign.items[state.items[id]?.templateId]?.desc || ""}</small><span>${side === "loot" ? "← 회수" : "반환 →"}</span></button>`,
        )
        .join("");
    showModal(
      `<div class="eyebrow">STAGE ${state.zone + 1} / MAINTENANCE</div><h2 id="modal-title">정비 <em>${state.maintenanceTurns}턴</em></h2><p class="modal-copy">이동은 횟수 제한 없이 편집하고 확정에 1턴. 카드·아이템 사용은 각각 1턴입니다. 남은 턴이 0이면 맵 선택으로 이동하며 남긴 전리품은 회수하지 않습니다.</p><div class="maintenance-status">체력 ${state.hp}/${state.maxHp} · 에너지 ${state.energy} · 휴대금 ${state.loot} CR · 배낭 ${lootDraft.pack.filter((id) => state.items[id]?.templateId !== "cash").length}/${runCapacity()}${
        Rules.activeStatuses(state).length
          ? " · " +
            Rules.activeStatuses(state)
              .map((x) => `${statusNames[x.type]} ${x.turns}턴`)
              .join(" / ")
          : ""
      }</div><div class="loot-columns"><section><h3>내 배낭</h3><div class="loot-list">${tiles(lootDraft.pack, "pack")}</div></section><section><h3>적 전리품·상자 <button id="loot-all">가능한 만큼 회수</button></h3><div class="loot-list">${tiles(lootDraft.loot, "loot")}</div>${state.rewardOptions.length ? `<h4>카드 1장 선택</h4><div class="reward-options">${state.rewardOptions.map((id) => `<button data-offer="${id}" class="${lootDraft.choice === id ? "chosen" : ""}">${runArt(id)}${cardFor(id).name}<small>${briefFor(cardFor(id))}</small></button>`).join("")}</div>` : ""}</section></div><div class="maintenance-controls"><button id="confirm-loot" class="primary-btn">이동 확정 · 1턴</button><button id="cancel-loot">이동 취소</button><button id="finish-maintenance">정비 종료 → 맵</button></div><details ${expanded ? "open" : ""}><summary>카드·아이템 사용 (각 1턴 · 카드 비용/리스크 적용)</summary><div class="maintenance-cards">${state.bag
        .map((id) => {
          const c = cardFor(id),
            allowed =
              c.type !== "attack" &&
              (c.heal || c.block || c.energyGain) &&
              !state.maintenanceUsed.includes(id),
            p = Rules.preview({ ...battleState(), enemies: [] }, c);
          return `<button data-maint-card="${id}" ${!allowed || !p.ok ? "disabled" : ""}>${runArt(id)}${c.name}<small>${briefFor(c)}${riskBrief(c) ? "<br>" + riskBrief(c) : ""}</small></button>`;
        })
        .join("")}${state.packItems
        .filter((id) =>
          ["consumable", "throwable"].includes(
            Campaign.items[state.items[id].templateId]?.kind,
          ),
        )
        .map(
          (id) =>
            `<button data-maint-item="${id}">${runArt(id)}${runName(id)}<small>${Campaign.items[state.items[id].templateId].desc}</small></button>`,
        )
        .join("")}${state.packItems
        .filter((id) =>
          ["weapon", "armor", "backpack"].includes(
            Campaign.items[state.items[id].templateId]?.kind,
          ),
        )
        .map((id) => {
          const kind = Campaign.items[state.items[id].templateId].kind;
          return (kind === "weapon" ? ["primary", "secondary"] : [kind])
            .map(
              (slot) =>
                `<button data-run-equip="${id}" data-slot="${slot}">${runArt(id)}${runName(id)}<small>${slot === "primary" ? "주무기 1" : slot === "secondary" ? "주무기 2" : kind === "armor" ? "방어구" : "배낭"}로 장착 · 1턴</small></button>`,
            )
            .join("");
        })
        .join("")}</div></details>`,
      true,
      "maintenance",
    );
    $("modal")
      .querySelectorAll("[data-loot-id]")
      .forEach(
        (n) =>
          (n.onclick = () => {
            const id = n.dataset.lootId,
              side = n.dataset.side,
              from = side === "loot" ? "loot" : "pack",
              to = side === "loot" ? "pack" : "loot";
            if (
              side === "pack" &&
              state.cards[id] &&
              !state.cards[id].unstable
            ) {
              notice(
                "안정 카드는 이곳에 버리지 않습니다. 기지에서 정리하세요.",
              );
              return;
            }
            if (
              to === "pack" &&
              state.items[id]?.templateId !== "cash" &&
              lootDraft.pack.filter(
                (x) => state.items[x]?.templateId !== "cash",
              ).length >= runCapacity()
            ) {
              notice("배낭이 가득 찼습니다.");
              return;
            }
            lootDraft[from] = lootDraft[from].filter((x) => x !== id);
            lootDraft[to].push(id);
            showMaintenance(false);
          }),
      );
    $("modal")
      .querySelectorAll("[data-offer]")
      .forEach(
        (n) =>
          (n.onclick = () => {
            if (lootDraft.choice)
              lootDraft.pack = lootDraft.pack.filter(
                (x) => x !== lootDraft.choice,
              );
            if (lootDraft.pack.length >= runCapacity()) {
              notice("배낭 공간이 필요합니다.");
              return;
            }
            lootDraft.choice = n.dataset.offer;
            lootDraft.pack.push(n.dataset.offer);
            showMaintenance(false);
          }),
      );
    $("loot-all").onclick = () => {
      for (const id of [...lootDraft.loot]) {
        if (
          state.items[id]?.templateId === "cash" ||
          lootDraft.pack.filter((x) => state.items[x]?.templateId !== "cash")
            .length < runCapacity()
        ) {
          lootDraft.loot = lootDraft.loot.filter((x) => x !== id);
          lootDraft.pack.push(id);
        }
      }
      showMaintenance(false);
    };
    $("confirm-loot").onclick = () => {
      if (
        JSON.stringify([...state.bag, ...state.packItems]) ===
          JSON.stringify(lootDraft.pack) &&
        !lootDraft.choice
      ) {
        notice("이동한 물건이 없습니다.");
        return;
      }
      for (const id of lootDraft.pack.filter(
        (id) => state.items[id]?.templateId === "cash",
      ))
        state.loot += state.items[id].qty;
      const pack = lootDraft.pack.filter(
        (id) => state.items[id]?.templateId !== "cash",
      );
      state.bag = pack.filter((id) => !!state.cards[id]);
      state.packItems = pack.filter((id) => !!state.items[id]);
      state.fieldLoot = lootDraft.loot;
      if (lootDraft.choice) {
        state.runCards.push(lootDraft.choice);
        state.rewardOptions = [];
      }
      syncPiles();
      maintenanceStep();
    };
    $("cancel-loot").onclick = () => showMaintenance(true);
    $("finish-maintenance").onclick = finishMaintenance;
    $("modal")
      .querySelectorAll("[data-maint-card]")
      .forEach(
        (n) =>
          (n.onclick = () => {
            if (draftDirty()) {
              notice("먼저 물건 이동을 확정하거나 취소하세요.");
              return;
            }
            const id = n.dataset.maintCard,
              c = cardFor(id),
              r = Rules.play({ ...battleState(), enemies: [] }, c);
            if (!r.ok) {
              notice(r.error);
              return;
            }
            applyBattle({ ...r.state, enemies: state.enemies });
            state.maintenanceUsed.push(id);
            for (const key of ["hand", "draw", "discard"])
              state[key] = state[key].filter((x) => x !== id);
            for (const e of r.events) {
              if (e.type === "erosion")
                state.cards[id].erosion = clamp(
                  state.cards[id].erosion + e.amount,
                  0,
                  100,
                );
              if (e.type === "reroll") {
                const count = state.hand.length;
                state.discard.push(...state.hand);
                state.hand = [];
                drawCards(count, true);
              }
              if (e.type === "draw") drawCards(e.count);
            }
            state.discard.push(id);
            maintenanceStep();
          }),
      );
    $("modal")
      .querySelectorAll("[data-run-equip]")
      .forEach(
        (n) =>
          (n.onclick = () => {
            if (draftDirty()) {
              notice("이동을 먼저 확정하거나 취소하세요.");
              return;
            }
            const id = n.dataset.runEquip,
              slot = n.dataset.slot,
              old = state.equipment[slot],
              before = [...state.packItems];
            state.packItems = state.packItems.filter((x) => x !== id);
            if (old) state.packItems.push(old);
            state.equipment[slot] = id;
            if (state.packItems.length + state.bag.length > runCapacity()) {
              state.equipment[slot] = old;
              state.packItems = before;
              notice("배낭 공간이 부족합니다.");
              return;
            }
            state.gear = Campaign.gear(runSave());
            state.armor = state.gear.armor;
            maintenanceStep();
          }),
      );
    $("modal")
      .querySelectorAll("[data-maint-item]")
      .forEach(
        (n) =>
          (n.onclick = () => {
            if (draftDirty()) {
              notice("먼저 물건 이동을 확정하거나 취소하세요.");
              return;
            }
            const id = n.dataset.maintItem,
              d = Campaign.items[state.items[id].templateId];
            if (d.heal) state.hp = Math.min(state.maxHp, state.hp + d.heal);
            if (d.damage)
              state.hazards.push({ damage: d.damage, turns: d.turns });
            state.packItems = state.packItems.filter((x) => x !== id);
            maintenanceStep();
          }),
      );
  }
  function maintenanceStep() {
    state.maintenanceTurns--;
    state.turn++;
    const r = Rules.round({ ...battleState(), enemies: [] });
    applyBattle({ ...r.state, enemies: state.enemies });
    persist();
    if (state.maintenanceTurns <= 0) finishMaintenance();
    else showMaintenance();
  }
  function draftDirty() {
    return (
      !!lootDraft &&
      (!!lootDraft.choice ||
        JSON.stringify([...state.bag, ...state.packItems]) !==
          JSON.stringify(lootDraft.pack))
    );
  }
  function finishMaintenance() {
    if (state.maintenanceTurns > 0 && draftDirty()) {
      notice("먼저 물건 이동을 확정하거나 취소하세요.");
      return;
    }
    lootDraft = null;
    state.fieldLoot = [];
    state.rewardOptions = [];
    state.mode = "cleared";
    persist();
    showDecision();
  }
  function showDecision() {
    if (state.mode !== "cleared") return;
    const final = state.zone === 2;
    showModal(
      `<div class="eyebrow">REGION MAP / STAGE ${state.zone + 1}</div><h2 id="modal-title">${final ? "최종 탈출 지점." : "다음 지역을 선택하세요."}</h2><p class="modal-copy">체력 ${state.hp}/${state.maxHp} · 휴대금 ${state.loot} CR · 소지 카드 ${state.bag.length}장<br>귀환하면 불안정 카드가 안정화됩니다.</p><div class="map-options"><button id="extract-btn" class="primary-btn">${icon("exit")} 기지로 귀환</button>${!final ? `<button id="descend-btn">다음 지역 ${state.zone + 2} →</button><button id="field-shop-btn">보급 상인 경유</button>` : ""}</div>`,
      false,
      "decision",
    );
    $("extract-btn").onclick = extract;
    $("descend-btn")?.addEventListener("click", () => {
      state.fieldShopUsed = false;
      closeModal();
      openRoute(state.zone + 1);
    });
    $("field-shop-btn")?.addEventListener("click", showFieldShop);
  }
  function showFieldShop() {
    const offers = [
      "medkit",
      "carbine",
      "vest",
      "scrap",
      "card:heal",
      "card:pierce",
    ];
    const priceOf = (key) =>
      key.startsWith("card:")
        ? 50 + CardLibrary.rarities.indexOf(CARDS[key.slice(5)].rarity) * 35
        : Campaign.items[key].price;
    showModal(
      `<div class="eyebrow">FIELD TRADER</div><h2 id="modal-title">보급 <em>상인.</em></h2><p>휴대금 ${state.loot} CR · 배낭 ${state.bag.length + state.packItems.length}/${runCapacity()}</p><div class="field-offers">${offers
        .map((key) => {
          const d = key.startsWith("card:")
            ? CARDS[key.slice(5)]
            : Campaign.items[key];
          return `<button data-field-buy="${key}">${GameArt.visual(key.startsWith("card:") ? "card" : "item", key.replace(/^card:/, ""), d.icon, "compact-art")}${d.name}<small>${d.desc}</small><b>${priceOf(key)} CR 구매</b></button>`;
        })
        .join(
          "",
        )}</div><h3>소지품 판매</h3><div class="field-sales">${[...state.packItems, ...state.bag.filter((id) => !state.cards[id].loan)].map((id) => `<button data-field-sell="${id}">${runArt(id)}${runName(id)} · ${state.cards[id] ? 25 + CardLibrary.rarities.indexOf(state.cards[id].rarity) * 20 : Math.floor(Campaign.items[state.items[id].templateId].price * 0.4) * state.items[id].qty} CR 판매</button>`).join("")}</div><details><summary>상인 의뢰</summary>${Object.entries(
        Campaign.quests,
      )
        .map(
          ([id, q]) =>
            `<button data-field-quest="${id}" ${save.campaign.quests[id] === "done" ? "disabled" : ""}>${q.name} · ${q.desc} · ${save.campaign.quests[id] === "done" ? "완료" : save.campaign.quests[id] ? "완료 보고" : "수락"}</button>`,
        )
        .join("")}</details><button id="back-map">맵으로</button>`,
      true,
      "trader",
    );
    $("back-map").onclick = showDecision;
    $("modal")
      .querySelectorAll("[data-field-buy]")
      .forEach(
        (n) =>
          (n.onclick = () => {
            const key = n.dataset.fieldBuy,
              price = priceOf(key);
            if (
              state.loot < price ||
              state.bag.length + state.packItems.length >= runCapacity()
            ) {
              notice("자금이나 공간이 부족합니다.");
              return;
            }
            state.loot -= price;
            if (key.startsWith("card:")) {
              const x = CardLibrary.create(key.slice(5), { unstable: true });
              state.cards[x.uid] = x;
              state.bag.push(x.uid);
              state.runCards.push(x.uid);
              syncPiles();
            } else {
              const x = Campaign.createItem(key);
              state.items[x.uid] = x;
              state.packItems.push(x.uid);
            }
            persist();
            showFieldShop();
          }),
      );
    $("modal")
      .querySelectorAll("[data-field-sell]")
      .forEach(
        (n) =>
          (n.onclick = () => {
            const id = n.dataset.fieldSell;
            if (state.bag.includes(id)) {
              if (state.bag.length <= 1) {
                notice("마지막 전투 카드는 판매할 수 없습니다.");
                return;
              }
              state.loot +=
                25 + CardLibrary.rarities.indexOf(state.cards[id].rarity) * 20;
              state.bag = state.bag.filter((x) => x !== id);
              state.soldCards.push(id);
              syncPiles();
            } else if (state.packItems.includes(id)) {
              state.loot +=
                Math.floor(
                  Campaign.items[state.items[id].templateId].price * 0.4,
                ) * state.items[id].qty;
              state.packItems = state.packItems.filter((x) => x !== id);
            } else return;
            persist();
            showFieldShop();
          }),
      );
    $("modal")
      .querySelectorAll("[data-field-quest]")
      .forEach(
        (n) =>
          (n.onclick = () => {
            const owned = new Set([
                ...state.packItems,
                ...Object.values(state.equipment).filter(Boolean),
              ]),
              shadow = {
                credits: 0,
                runs: save.runs,
                instances: state.bag.map((id) => clone(state.cards[id])),
                campaign: {
                  ...clone(save.campaign),
                  run: null,
                  pack: [...state.bag, ...state.packItems],
                  stash: [],
                  items: Object.values(state.items)
                    .filter((x) => owned.has(x.uid))
                    .map(clone),
                  equipment: clone(state.equipment),
                  facilities: { shop: true, forge: false },
                  stats: {
                    ...save.campaign.stats,
                    kills: save.campaign.stats.kills + state.kills,
                  },
                },
              };
            const r = Campaign.quest(shadow, n.dataset.fieldQuest);
            if (!r.ok) {
              notice(r.error);
              return;
            }
            save.campaign.quests = shadow.campaign.quests;
            save.campaign.capacity = shadow.campaign.capacity;
            state.loot += shadow.credits;
            const remain = new Map(
              shadow.campaign.items.map((x) => [x.uid, x]),
            );
            for (const id of state.packItems)
              if (remain.has(id)) state.items[id] = remain.get(id);
            state.packItems = state.packItems.filter((id) => remain.has(id));
            persist();
            showFieldShop();
          }),
      );
  }
  function settleRun(success) {
    if (!Campaign.settle(save, state, success)) return;
    state.playing = false;
    state.mode = success ? "won" : "dead";
    state.phase = "player";
    persist();
  }
  function extract() {
    if (state.mode !== "cleared") return;
    settleRun(true);
    renderHUD();
    sound("win");
    showOutcome(true);
  }
  function showOutcome(success) {
    showModal(
      `<div class="ending-symbol ${success ? "" : "fail"}">${icon(success ? "exit" : "crosshair")}</div><div class="eyebrow">EXPEDITION ENDED</div><h2 id="modal-title">탐사 종료. <em>${success ? "생존" : "사망"}</em></h2><div class="modal-stat-row"><div><small>도달 스테이지</small><strong>${state.zone + 1}<em>/3</em></strong></div><div><small>최고 스테이지</small><strong>${save.campaign.best}<em>/3</em></strong></div><div><small>${success ? "회수" : "손실"} 휴대금</small><strong>${state.loot}<em> CR</em></strong></div></div><p class="modal-copy">${success ? "회수한 카드가 안정화되었고 소지품은 배낭에 보존되었습니다." : "소지 장비·아이템·재료·돈과 불안정 카드를 잃었습니다. 안정 카드와 기지 창고는 보존됩니다."}</p><button id="home-btn" class="primary-btn">기지로 이동 →</button>`,
      false,
      "outcome",
    );
    $("home-btn").onclick = () => {
      goHome();
      screens.show("base");
    };
  }
  function goHome() {
    clearTimeout(pendingTimer);
    queuedReward = false;
    enemyResolutionPending = false;
    const gear = Campaign.gear(save);
    Object.assign(state, {
      mode: "briefing",
      phase: "player",
      playing: false,
      settled: false,
      zone: 0,
      hp: gear.maxHp,
      maxHp: gear.maxHp,
      armor: gear.armor,
      gear,
      shield: 0,
      energy: 3,
      turn: 1,
      loot: 0,
      cleared: 0,
      selected: -1,
      target: 0,
      discard: [],
      hand: ["shot", "burst", "guard", "scan", "shot"],
      lastPlayerCard: "",
      lastEnemyCard: "",
      hazards: [],
    });
    state.shieldLayers = [];
    state.statuses = [];
    state.enemies = makeEnemies(ZONES[0].enemies);
    closeModal();
    $("briefing").classList.remove("hidden");
    $("sector-stamp").classList.remove("hidden");
    renderHUD();
  }

  function pauseMenu() {
    if (!state.playing) {
      screens.show("menu");
      return;
    }
    showModal(
      `<h2 id="modal-title">작전 일시 정지</h2><p>현재 행동까지 자동 저장되었습니다.</p><div class="modal-buttons"><button class="primary-btn" data-close>작전 계속</button><button id="pause-to-menu">메인메뉴</button><button id="abandon-run">탐사 포기</button></div>`,
      false,
      "pause",
    );
    $("pause-to-menu").onclick = () => {
      persist();
      clearTimeout(pendingTimer);
      enemyResolutionPending = false;
      queuedReward = false;
      state.playing = false;
      activeModal = null;
      $("modal-backdrop").classList.add("hidden");
      screens.show("menu");
    };
    $("abandon-run").onclick = () => {
      showModal(
        '<h2 id="modal-title">탐사를 포기할까요?</h2><p>소지 장비·물품·돈과 불안정 카드를 잃습니다. 안정 카드와 창고는 보존됩니다.</p><button id="confirm-abandon" class="primary-btn">포기하고 사망 정산</button><button data-close>돌아가기</button>',
        false,
        "pause",
      );
      $("confirm-abandon").onclick = () => {
        clearTimeout(pendingTimer);
        enemyResolutionPending = false;
        queuedReward = false;
        settleRun(false);
        showOutcome(false);
      };
    };
  }
  function showGuide() {
    if (
      activeModal &&
      ["reward", "outcome", "route", "maintenance"].includes(activeModal)
    )
      return;
    showModal(
      `<button class="modal-close" data-close aria-label="가이드 닫기">×</button><div class="eyebrow">FIELD MANUAL / 08</div><h2 id="modal-title">움직이는 것은 <em>당신의 한 수.</em></h2><p class="modal-copy">정해진 시점에서 모든 적의 의도를 읽고 카드로 행동합니다. 시간 제한은 없습니다.</p><div class="guide-grid"><div class="guide-item"><b>01 / 경로를 선택하세요</b><p>돌파 경로는 높은 보상을 줍니다. 보급 경로는 적이 약하고 승리 시 체력을 8 회복하지만 보상이 적습니다.</p></div><div class="guide-item"><b>02 / 카드와 대상</b><p>적을 눌러 대상을 선택하고 카드를 고릅니다. 같은 카드를 다시 누르면 선택이 해제됩니다. 비용·효과를 확인한 뒤 사용으로 확정합니다. 공격 카드를 적에게 끌면 체력 바에 예상 피해가 표시되고, 그 위에서 손을 떼면 바로 사용됩니다. 적이 없는 곳에 놓으면 취소됩니다. 모바일은 카드 모서리의 ⠿ 손잡이로 끌 수 있습니다. 마우스 올리기·Tab 포커스·모바일 길게 누르기로도 설명을 볼 수 있습니다. 방어·회복은 좌측 내 상태, 전술은 우측 배낭 위에 놓습니다. 올바른 대상이 강조되고 주변은 어두워집니다.</p></div><div class="guide-item"><b>03 / 적의 의도를 읽으세요</b><p>적 HUD에는 이름·체력·남은 턴·행동이 표시됩니다. ‘준비 / 이번 차례’는 이번 적 차례에 행동합니다. 대기 1은 이번 종료에 0이 되고, 다음 게임 턴 적 차례에 행동합니다. 처치하면 해당 행동이 취소됩니다. 장갑은 적의 타격마다 피해를 줄입니다. 쉴드는 카드에 적힌 기간 동안 잔량이 유지되고 자동 충전되지 않습니다. 리스크를 먼저 적용한 뒤 본효과가 발동하며, 스트레스 명중률은 각 타격에 따로 적용됩니다.</p></div><div class="guide-item"><b>04 / 귀환해야 당신의 것</b><p>전투 승리 → 상자방 → 정비 → 지역 맵 → 다음 지역 또는 귀환. 정비는 물건 이동 확정·카드 사용·아이템 사용에 각각 1턴을 씁니다. 사망하면 소지 장비·물품·돈과 불안정 카드를 잃고 안정 카드·기지 창고는 보존됩니다.</p></div></div><div class="guide-note">에너지 3 · 턴 종료 시 손패를 유지하고 5장까지 보충 · 상한 8장. 리롤은 턴을 넘기며 버림·남은 손패를 회수해 섞고 새로 5장을 뽑습니다. 일반 보충은 버림 카드를 회수하지 않습니다.<br><span class="key">1–8</span> 카드 <span class="key">← →</span> 대상 <span class="key">F / ENTER</span> 카드 사용 <span class="key">SPACE</span> 턴 종료</div><div class="modal-buttons"><button class="primary-btn" data-close>확인 · 작전 복귀 ${icon("arrow")}</button></div>`,
      true,
      "guide",
    );
  }
  function showCollection() {
    if (state.playing) {
      showInventory();
      return;
    }
    if (save.campaign.run) {
      screens.show("menu");
      return;
    }
    closeModal();
    screens.show("base", "warehouse");
  }
  function showPile(discard = false) {
    if (!state.playing || (activeModal && activeModal !== "pile")) return;
    const pile = discard ? state.discard : state.draw,
      counts = {};
    pile.forEach((ref) => {
      const id = cardFor(ref).templateId;
      counts[id] = (counts[id] || 0) + 1;
    });
    showModal(
      `<button class="modal-close" data-close aria-label="카드 목록 닫기">×</button><div class="eyebrow">카드 더미</div><h2 id="modal-title">${discard ? "버린 카드" : "뽑기 더미"} <em>${pile.length}장</em></h2><div class="pile-tabs"><button data-pile="draw" class="${!discard ? "active" : ""}">뽑기 ${state.draw.length}장</button><button data-pile="discard" class="${discard ? "active" : ""}">버림 ${state.discard.length}장</button></div><p class="modal-copy">${discard ? "사용한 카드입니다. 리롤하면 뽑기 더미로 회수합니다. 저주의 손패 교체는 별도 효과입니다." : "다음 보충에 쓰는 남은 카드입니다. 뽑히는 순서는 공개되지 않습니다."}</p><div class="pile-list">${
        Object.entries(counts)
          .map(
            ([id, n]) =>
              `<div class="pile-item"><b>비용 ${CARDS[id].cost}</b>${CARDS[id].name}<small>× ${n}</small></div>`,
          )
          .join("") || '<p class="modal-copy">카드가 없습니다.</p>'
      }</div><div class="modal-buttons"><button class="secondary-btn" data-close>작전 복귀</button></div>`,
      false,
      "pile",
    );
    $("modal")
      .querySelectorAll("[data-pile]")
      .forEach((b) =>
        b.addEventListener("click", () =>
          showPile(b.dataset.pile === "discard"),
        ),
      );
  }

  function findInspection(token) {
    if (token.kind === "card") {
      if (token.catalog)
        return $(
          token.container === "screen" ? "screen-root" : "modal",
        ).querySelector(
          `[${token.container === "screen" ? "data-detail-card" : "data-instance"}="${token.id}"]`,
        );
      const n = $("hand").querySelector(`[data-index="${token.index}"]`);
      return (n?.dataset.instance || n?.dataset.card) === token.id ? n : null;
    }
    if (token.kind === "enemy")
      return $("enemy-targets").querySelector(`[data-enemy="${token.id}"]`);
    if (token.kind === "hud")
      return document.querySelector(`[data-inspect="${token.id}"]`);
    if (token.kind === "danger") return $("enemy-intent");
    if (token.kind === "turn") return $("end-turn-btn");
    return null;
  }
  function inspectionData(token) {
    if (token.kind === "card") {
      const c = cardFor(token.id);
      if (!c || (!token.catalog && state.hand[token.index] !== token.id))
        return null;
      const target = state.enemies.find(
        (e) => e.id === state.target && e.hp > 0,
      );
      const details = cardDetails(token.id, c),
        check = projection(c, target);
      return {
        kicker: `${rarityNames[c.rarity]} · ${c.type === "attack" ? "공격" : c.type === "defense" ? "방어" : c.heal ? "회복" : "전술"} · 비용 ${check.energyCost ?? c.cost}`,
        title: c.name,
        ...details,
        rows: token.catalog
          ? []
          : [
              { label: "현재 예상", value: previewFor(c, target) },
              {
                label: c.type === "attack" ? "대상" : "적용",
                value:
                  c.type === "attack"
                    ? target?.name || "적 선택"
                    : c.type === "defense" || c.heal
                      ? "플레이어"
                      : "배낭",
              },
            ],
        note: token.catalog
          ? "기본 수치와 강화 옵션을 합산한 효과입니다."
          : !check.ok
            ? check.error
            : state.selected === token.index
              ? "대상에 끌어 놓거나 사용 버튼으로 확정"
              : "클릭하여 선택 · 대상에 끌어 놓으면 사용",
      };
    }
    if (token.kind === "enemy") {
      const e = state.enemies.find((e) => e.id === token.id && e.hp > 0);
      if (!e) return null;
      const c = cardFor(state.hand[state.selected]),
        action = nextAction(e);
      return {
        kicker: "적 정보",
        title: e.name,
        description: `${action.turns === 0 ? "이번 적 차례" : action.turns + "게임 턴 대기 후"} ${action.type === "attack" ? "공격" : "쉴드 획득"} ${action.value}.`,
        rows: [
          { label: "무기", value: e.weapon || "소총" },
          { label: "체력", value: `${e.hp} / ${e.maxHp}` },
          ...(e.armor || e.shield
            ? [
                {
                  label: "보호",
                  value: `장갑 ${e.armor || 0} · 방어 ${e.shield || 0}`,
                },
              ]
            : []),
          ...(c?.damage
            ? [{ label: "선택 카드 피해", value: previewFor(c, e) }]
            : []),
        ],
        note:
          state.target === e.id
            ? "현재 선택한 대상"
            : "눌러서 공격 대상으로 선택",
      };
    }
    if (token.kind === "danger")
      return {
        kicker: "턴 종료 예상",
        title: `체력 −${incomingDamage()}`,
        description: "살아 있는 적이 예고한 행동만 실행합니다.",
        rows: [
          { label: "적 공격 합계", value: incomingRaw() },
          { label: "방어구로 감소", value: forecast().armorBlocked },
          { label: "임시 방어", value: state.shield },
        ],
        note: "적을 먼저 제압하면 그 적의 공격은 취소됩니다.",
      };
    if (token.kind === "turn")
      return {
        kicker: "턴 종료",
        title: "적 행동 시작",
        description: "남은 손패를 유지하고 적의 예고 행동을 실행합니다.",
        rows: [
          { label: "다음 내 턴", value: "손패 5장까지 빈자리 보충 · 에너지 3" },
        ],
        note: "쉴드·지속 효과의 남은 기간이 1 줄어듭니다. 잔여 쉴드는 자동 충전되지 않습니다.",
      };
    if (token.kind === "hud") {
      if (token.id === "health")
        return {
          title: `체력 ${state.hp} / ${state.maxHp}`,
          description: "체력이 0이 되면 이번 탐사의 전리품을 잃습니다.",
        };
      if (token.id === "energy")
        return {
          title: `에너지 ${state.energy}`,
          description:
            "카드의 숫자만큼 소모합니다. 새 턴에는 3으로 회복됩니다.",
        };
      if (token.id === "armor")
        return {
          title: `방어구 Lv.${state.armor}`,
          description: `현재 장갑 ${Rules.effectiveArmor(state)}. 적의 공격 한 번마다 피해를 ${Rules.effectiveArmor(state)} 줄입니다. 그다음 임시 방어로 흡수합니다. 기본 방어구는 탐사 내내 유지됩니다.`,
        };
      if (token.id === "shield")
        return {
          title: `임시 방어 ${state.shield}`,
          description: `피해를 흡수한 잔량이 각 획득원의 남은 기간 동안 유지됩니다. 자동 리필되지 않습니다. ${state.shieldLayers.map((s) => s.amount + " 쉴드 / " + s.turns + "턴").join(" · ")}`,
        };
    }
    return null;
  }
  function clearDragPreview() {
    state.dragTarget = -1;
    state.dragCard = false;
    $("player-preview").classList.add("hidden");
    $("bag-preview").classList.add("hidden");
    for (const node of $("enemy-targets").querySelectorAll("[data-enemy]")) {
      const e = state.enemies.find((e) => e.id === Number(node.dataset.enemy));
      if (!e) continue;
      node.classList.remove(
        "drag-preview",
        "drag-hover",
        "preview-lethal",
        "preview-unavailable",
      );
      node.querySelector(".hp-remaining").style.width =
        (e.hp / e.maxHp) * 100 + "%";
      node.querySelector(".hp-loss").style.width = "0%";
      node.querySelector(".enemy-preview").classList.add("hidden");
    }
  }
  function previewDrag(index, area) {
    clearDragPreview();
    const c = cardFor(state.hand[index]);
    if (!c || !area) return;
    const target = state.enemies.find((e) => e.id === area.id),
      p = projection(c, target);
    state.dragCard = true;
    if (area.kind !== "enemy") {
      const node = $(area.kind === "player" ? "player-preview" : "bag-preview");
      node.textContent = p.ok ? previewFor(c, target) : p.error;
      node.classList.remove("hidden");
      return;
    }
    state.dragTarget = area.id;
    for (const t of p.targets) {
      const e = state.enemies.find((e) => e.id === t.id),
        node = $("enemy-targets").querySelector(`[data-enemy="${t.id}"]`);
      if (!node) continue;
      node.classList.add("drag-preview");
      node.classList.toggle("drag-hover", e.id === area.id);
      node.classList.toggle("preview-lethal", t.killChance === 1);
      node.querySelector(".hp-remaining").style.width =
        (t.afterMin / e.maxHp) * 100 + "%";
      Object.assign(node.querySelector(".hp-loss").style, {
        left: (t.afterMin / e.maxHp) * 100 + "%",
        width: ((e.hp - t.afterMin) / e.maxHp) * 100 + "%",
      });
      const text = node.querySelector(".enemy-preview");
      text.classList.remove("hidden");
      text.innerHTML = `피해 <strong>${damageText(t)}</strong><span>${p.accuracy < 100 ? `각 타격 명중 ${p.accuracy}% · ` : ""}HP ${t.afterMin === t.afterMax ? t.afterMin : `${t.afterMin}–${t.afterMax}`}</span>${t.killChance === 1 ? "<em>처치 · 행동 취소</em>" : t.killChance > 0 ? `<em>처치 확률 ${Math.round(t.killChance * 100)}%</em>` : ""}${c.delay ? `<span>명중 시 대기 +${c.delay}</span>` : ""}`;
    }
    if (!p.ok) {
      const node = $("enemy-targets").querySelector(
        `[data-enemy="${area.id}"] .enemy-preview`,
      );
      if (node) {
        node.textContent = p.error;
        node.classList.remove("hidden");
      }
    }
  }
  function dragTargetAt(x, y, c) {
    const node = document.elementFromPoint(x, y);
    if (c.type === "attack") {
      const e = node?.closest(".enemy-target:not(:disabled)");
      return e ? { kind: "enemy", id: Number(e.dataset.enemy) } : null;
    }
    if (c.type === "defense" || c.heal)
      return node?.closest("#player-status") ? { kind: "player" } : null;
    return node?.closest("#bag-btn") ? { kind: "bag" } : null;
  }
  function showInventory() {
    if (
      activeModal &&
      ["reward", "outcome", "route", "maintenance"].includes(activeModal)
    )
      return;
    const refs = state.playing
      ? state.bag
      : save.campaign.pack.filter((id) =>
          save.instances.some((x) => x.uid === id),
        );
    const owned = state.playing
      ? state.cards
      : Object.fromEntries(save.instances.map((c) => [c.uid, c]));
    showModal(
      `<button class="modal-close" data-close aria-label="배낭 닫기">×</button><div class="eyebrow">FIELD INVENTORY / LIVE DECK</div><h2 id="modal-title">탐사 <em>배낭.</em></h2><p class="modal-copy">소지 카드 ${refs.length}장 · 배낭의 모든 카드는 전투 덱에 포함됩니다.<br>불안정 카드는 사망 시 소멸하고 귀환 시 안정화됩니다.</p><div class="pile-list">${refs
        .map((ref) => {
          const item = owned[ref],
            c = CardLibrary.compile(item);
          return `<div class="pile-item"><b>${rarityNames[c.rarity]}</b><span>${c.name}<small>${item.unstable ? "불안정 · 사망 시 소멸" : "안정"}${item.erosion ? " · 침식 " + item.erosion + "%" : ""}</small></span><small>ϟ${c.cost}</small></div>`;
        })
        .join(
          "",
        )}</div><h3>장비</h3><p class="modal-copy">주무기 1: ${state.gear?.primary || "없음"} · 주무기 2: ${state.gear?.secondary || "없음"}<br>방어구: ${state.gear?.armorName || "없음"} · 휴대금 ${state.loot} CR</p><h3>소지 아이템</h3><div class="pile-list">${state.playing ? state.packItems.map((id) => `<div class="pile-item">${runName(id)}</div>`).join("") : ""}</div><p class="reward-note">전투 중에는 조회만 가능합니다. 기지 창고에서 소지품을 정리할 수 있습니다.</p>`,
      false,
      "inventory",
    );
  }
  function selectNextTarget(direction) {
    if (!isPlaying()) return;
    const list = alive(),
      index = list.findIndex((e) => e.id === state.target);
    state.target =
      list[(index + direction + list.length) % list.length]?.id ?? -1;
    renderHUD();
  }
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (activeModal) {
      if (
        k === "escape" &&
        !["route", "reward", "outcome", "maintenance"].includes(activeModal)
      ) {
        e.preventDefault();
        closeModal();
      }
      if (k === "tab") {
        const buttons = [
            ...$("modal").querySelectorAll(
              'button:not(:disabled),[href],[tabindex="0"]',
            ),
          ],
          first = buttons[0],
          last = buttons.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === $("modal"))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === $("modal"))
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
      return;
    }
    if ([" ", "arrowleft", "arrowright"].includes(k) && state.playing)
      e.preventDefault();
    if (e.repeat) return;
    if (k === "escape" && state.playing) {
      pauseMenu();
      return;
    }
    if (k === "e" && state.mode === "cleared") {
      showDecision();
      return;
    }
    if (!isPlaying()) return;
    if (/^[1-8]$/.test(k)) {
      e.preventDefault();
      chooseCard(Number(k) - 1);
    }
    if (k === "arrowleft") selectNextTarget(-1);
    if (k === "arrowright") selectNextTarget(1);
    if (
      k === "f" ||
      (k === "enter" && !e.target.closest("button,a,input,textarea,select"))
    ) {
      e.preventDefault();
      fire();
    }
    if (k === " ") {
      document.activeElement?.blur();
      endTurn();
    }
  });
  $("viewport").addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") {
      const r = $("viewport").getBoundingClientRect();
      scene.hover = clamp((e.clientX - r.left) / r.width - 0.5, -0.5, 0.5);
    }
  });
  $("viewport").addEventListener("pointerleave", () => (scene.hover = 0));
  $("bag-btn").addEventListener("click", showInventory);
  $("reroll-btn").addEventListener("click", reroll);
  $("deploy-btn").addEventListener("click", deploy);
  $("end-turn-btn").addEventListener("click", endTurn);
  $("fire-btn").addEventListener("click", fire);
  $("extract-menu-btn").addEventListener("click", showDecision);
  $("help-btn").addEventListener("click", showGuide);
  $("collection-btn").addEventListener("click", showCollection);
  $("deck-inspect-btn").addEventListener("click", () => showPile(false));
  function updateSoundButton() {
    const b = $("sound-btn");
    b.setAttribute("aria-pressed", String(soundOn));
    b.setAttribute("aria-label", soundOn ? "사운드 끄기" : "사운드 켜기");
    b.title = soundOn ? "사운드 끄기" : "사운드 켜기";
    b.querySelector(".mute-slash").classList.toggle("hidden", soundOn);
  }
  $("sound-btn").addEventListener("click", () => {
    soundOn = !soundOn;
    save.campaign.settings.sound = soundOn;
    persist();
    updateSoundButton();
    if (soundOn) sound("click");
  });
  $("fullscreen-btn").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("app").requestFullscreen();
    } catch {
      notify("이 브라우저에서는 전체 화면을 지원하지 않습니다.");
    }
  });
  $("modal-backdrop").addEventListener("click", (e) => {
    if (
      e.target === $("modal-backdrop") &&
      !["route", "reward", "outcome", "maintenance"].includes(activeModal)
    )
      closeModal();
  });
  function frame(timestamp) {
    if (document.hidden) {
      lastTimestamp = timestamp;
      requestAnimationFrame(frame);
      return;
    }
    if (
      timestamp - lastTimestamp <
      (save.campaign.settings.battery ? 1000 / 30 : 1000 / 60) - 1
    ) {
      requestAnimationFrame(frame);
      return;
    }
    state.time += Math.min(0.05, (timestamp - lastTimestamp) / 1000 || 0);
    lastTimestamp = timestamp;
    if (!screens || screens.root.classList.contains("hidden")) {
      scene.draw(state, timestamp);
      positionTargets();
    }
    inspector?.position();
    requestAnimationFrame(frame);
  }
  inspector = new ContextDetails(
    $("inspect-details"),
    inspectionData,
    findInspection,
  );
  cardDrag = new DragToPlay({
    hand: $("hand"),
    ghost: $("drag-ghost"),
    status: $("drag-status"),
    inspector,
    cardAt: (index) => (isPlaying() ? cardFor(state.hand[index]) : null),
    keyAt: (index) => state.hand[index],
    targetAt: dragTargetAt,
    markup: (index) => cardMarkup(state.hand[index], index),
    start: () => $("scene-message").classList.remove("visible"),
    available: (c, index, area) =>
      projection(
        c,
        state.enemies.find((e) => e.id === (area?.id ?? state.target)),
      ).ok,
    preview: previewDrag,
    clear: clearDragPreview,
    use: (index, area) =>
      playCard(
        index,
        state.enemies.find((e) => e.id === area.id && e.hp > 0),
      ),
  });
  inspector.connect($("screen-root"), "[data-detail-card]", (n) => ({
    kind: "card",
    catalog: true,
    container: "screen",
    id: n.dataset.detailCard,
  }));
  inspector.connect($("modal"), "[data-reward]", (n) => ({
    kind: "card",
    catalog: true,
    id: n.dataset.instance,
  }));
  inspector.connect($("hand"), "[data-index]", (n) => ({
    kind: "card",
    index: Number(n.dataset.index),
    id: n.dataset.instance || n.dataset.card,
  }));
  inspector.connect($("enemy-targets"), "[data-enemy]", (n) => ({
    kind: "enemy",
    id: Number(n.dataset.enemy),
  }));
  inspector.connect($("player-status"), "[data-inspect]", (n) => ({
    kind: "hud",
    id: n.dataset.inspect,
  }));
  inspector.connect(
    document.querySelector(".combat-hud"),
    "#enemy-intent",
    () => ({ kind: "danger" }),
  );
  inspector.connect(
    document.querySelector(".turn-controls"),
    "#end-turn-btn",
    () => ({ kind: "turn" }),
  );
  document
    .querySelectorAll("[data-inspect]")
    .forEach((n) =>
      n.addEventListener("click", () =>
        inspector.select({ kind: "hud", id: n.dataset.inspect }),
      ),
    );
  $("enemy-intent").addEventListener("click", () =>
    inspector.select({ kind: "danger" }),
  );
  $("app").addEventListener("keydown", (e) => {
    if (
      (e.key === "Enter" || e.key === " ") &&
      e.target.matches("[data-inspect],#enemy-intent")
    ) {
      e.preventDefault();
      e.stopPropagation();
      e.target.click();
    }
  });
  screens = new CampaignScreens($("screen-root"), {
    save: () => save,
    persist,
    deploy,
    resume: resumeRun,
    settings: applySettings,
    message: notice,
    rarity: (id) => rarityNames[id],
    brief: briefFor,
    risk: riskBrief,
    details: (id) => cardDetails(id, rawCardFor(id)),
  });
  document.querySelector(".brand").onclick = (e) => {
    e.preventDefault();
    pauseMenu();
  };
  $("settings-btn").onclick = () => {
    if (state.playing) {
      showGuide();
      return;
    }
    screens.show("settings");
  };
  goHome();
  applySettings();
  screens.show("menu");
  persist();
  if (loaded.notice) notify(loaded.notice, 4000);
  requestAnimationFrame(frame);
})();
