/* Pure combat rules. Rendering, card ownership and pile movement live outside this module. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CombatRules = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const copy = value => typeof structuredClone === 'function'
    ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const integer = (value, fallback = 0) => Math.max(0, Math.floor(number(value, fallback)));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const statusAmount = entry => ['seal', 'curse'].includes(entry.type)
    ? Math.max(1, Math.abs(number(entry.amount, 1))) : Math.abs(number(entry.amount));

  function activeStatuses(state) {
    const effective = new Map();
    for (const status of state.statuses || []) {
      if (number(status.turns) <= 0) continue;
      const amount = statusAmount(status);
      if (!amount) continue;
      const old = effective.get(status.type);
      if (!old || old.amount < amount) effective.set(status.type, {...status, amount});
      else if (old.amount === amount) old.turns = Math.max(old.turns, status.turns);
    }
    return [...effective.values()];
  }

  const strongest = (state, type) => activeStatuses(state).find(s => s.type === type)?.amount || 0;
  const effectiveArmor = state => Math.max(0, number(state.armor) - strongest(state, 'vulnerable'));
  const accuracy = (state, card = {}) => clamp(number(card.accuracy ?? state.baseAccuracy, 100) - strongest(state, 'stress'), 0, 100);
  function shield(state) {
    if (strongest(state, 'seal')) return 0;
    if (!Array.isArray(state.shieldLayers)) return integer(state.shield);
    return state.shieldLayers.reduce((sum, layer) => sum + (number(layer.turns) > 0 ? integer(layer.amount) : 0), 0);
  }

  function normalize(state) {
    const next = copy(state);
    next.maxHp = Math.max(1, integer(next.maxHp, 80));
    next.hp = clamp(integer(next.hp), 0, next.maxHp);
    next.energy = integer(next.energy);
    next.statuses = (next.statuses || []).filter(s => number(s.turns) > 0).map(s => ({...s, amount:statusAmount(s), turns:integer(s.turns)}));
    next.shieldLayers = Array.isArray(next.shieldLayers)
      ? next.shieldLayers.filter(s => integer(s.amount) && number(s.turns) > 0).map(s => ({...s, amount:integer(s.amount), turns:integer(s.turns)}))
      : integer(next.shield) ? [{amount:integer(next.shield), turns:1}] : [];
    if (strongest(next, 'seal')) next.shieldLayers = [];
    next.shield = shield(next);
    next.enemies = (next.enemies || []).map(enemy => ({...enemy, hp:integer(enemy.hp), shield:integer(enemy.shield), wait:integer(enemy.wait)}));
    return next;
  }

  function addStatus(state, risk) {
    const amount = statusAmount(risk), turns = Math.max(1, integer(risk.turns, 1));
    const existing = state.statuses.find(s => s.type === risk.type && statusAmount(s) === amount);
    if (existing) existing.turns = Math.max(existing.turns, turns);
    else state.statuses.push({type:risk.type, amount, turns});
  }

  function costs(card) {
    let energyCost = integer(card.cost), hpCost = 0;
    for (const risk of card.risks || []) {
      if (risk.type === 'hp') hpCost += integer(risk.amount);
      if (risk.type === 'energy') energyCost += integer(risk.amount);
    }
    return {energyCost, hpCost};
  }

  function failure(state, errorCode, error) {
    return {ok:false, errorCode, error, state:copy(state), events:[]};
  }

  function prepare(state, card, targetId) {
    if (!card || typeof card !== 'object') return failure(state, 'card', '카드가 없습니다.');
    if (number(state.hp) <= 0) return failure(state, 'dead', '행동할 수 없습니다.');
    const {energyCost, hpCost} = costs(card);
    if (number(state.energy) < energyCost) return failure(state, 'energy', '에너지가 부족합니다.');
    if (number(state.hp) <= hpCost) return failure(state, 'hp', '체력이 부족합니다. 소모 후 체력이 남아야 합니다.');
    const needsEnemy = card.type === 'attack' || number(card.damage) > 0 || card.shatter || number(card.delay) > 0;
    const target = (state.enemies || []).find(enemy => enemy.id === targetId && number(enemy.hp) > 0);
    if (needsEnemy && !target) return failure(state, 'target', '공격 대상을 선택하세요.');

    const next = normalize(state), events = [];
    next.energy -= energyCost;
    next.hp -= hpCost;
    events.push({type:'cost', energy:energyCost, hp:hpCost});
    if (hpCost) events.push({type:'hp', delta:-hpCost, amount:hpCost, hp:next.hp, source:'risk'});
    for (const risk of card.risks || []) {
      if (['vulnerable', 'stress', 'seal', 'curse'].includes(risk.type)) {
        addStatus(next, risk);
        events.push({type:'status', status:risk.type, amount:statusAmount(risk), turns:Math.max(1, integer(risk.turns, 1))});
      } else if (risk.type === 'erosion' && integer(risk.amount)) {
        events.push({type:'erosion', amount:integer(risk.amount)});
      }
    }
    if (strongest(next, 'seal')) next.shieldLayers = [];
    next.shield = shield(next);
    if (strongest(next, 'curse')) events.push({type:'reroll'});
    const living=next.enemies.filter(e=>e.hp>0).map(e=>e.id);
    const ids = needsEnemy ? (card.aoe ? living : [targetId,...living.filter(id=>id!==targetId)].slice(0,Math.max(1,integer(card.targets,1)))) : [];
    return {ok:true, state:next, events, ids, energyCost, hpCost};
  }

  function hitEnemy(enemy, card, firstHit) {
    const shattered = firstHit && card.shatter ? enemy.shield : 0;
    if (firstHit && card.shatter) enemy.shield = 0;
    // Preserve the prototype's minimum 1 chip damage for a damaging hit.
    const raw = integer(card.damage) ? Math.max(1, integer(card.damage) - (card.pierce ? 0 : integer(enemy.armor))) : 0;
    const absorbed = Math.min(enemy.shield, raw), damage = raw - absorbed, before = enemy.hp;
    enemy.shield -= absorbed;
    enemy.hp = Math.max(0, enemy.hp - damage);
    return {damage, hpDamage:before - enemy.hp, absorbed, shattered, raw};
  }

  function independentEffects(state, card, events) {
    const requestedBlock = integer(card.block), blocked = !!strongest(state, 'seal');
    const block = blocked ? 0 : requestedBlock;
    if (block) state.shieldLayers.push({amount:block, turns:Math.max(1, integer(card.shieldDuration, 1))});
    if (requestedBlock) events.push({type:'block', amount:block, requested:requestedBlock, blocked});
    const heal = Math.min(integer(card.heal), state.maxHp - state.hp);
    if (heal) {
      state.hp += heal;
      events.push({type:'hp', delta:heal, amount:heal, hp:state.hp, source:'heal'});
    }
    const draw = integer(card.draw), energyGain = integer(card.energyGain);
    if (draw) events.push({type:'draw', count:draw});
    if (energyGain) {
      state.energy += energyGain;
      events.push({type:'energy', amount:energyGain});
    }
    state.shield = shield(state);
    return {heal, block, draw, energyGain};
  }

  function play(state, card, targetId, options = {}) {
    const prepared = prepare(state, card, targetId);
    if (!prepared.ok) return prepared;
    const {state:next, events, ids} = prepared, rng = options.rng || Math.random;
    const chance = accuracy(next, card) / 100, hits = Math.max(1, integer(card.hits, 1));
    for (const id of ids) {
      const enemy = next.enemies.find(e => e.id === id);
      let landed = false;
      for (let index = 0; index < hits && enemy.hp > 0; index++) {
        const success = chance === 1 || chance > 0 && number(rng(), 1) < chance;
        if (!success) { events.push({type:'miss', id, hit:index + 1}); continue; }
        const effect = hitEnemy(enemy, card, !landed);
        landed = true;
        events.push({type:'hit', id, hit:index + 1, ...effect});
      }
      if (landed && integer(card.delay)) {
        enemy.wait += integer(card.delay);
        events.push({type:'delay', id, amount:integer(card.delay), wait:enemy.wait});
      }
    }
    const effects = independentEffects(next, card, events);
    return {ok:true, error:null, ...prepared, ...effects, accuracy:accuracy(next, card), reroll:events.some(e => e.type === 'reroll')};
  }

  function probabilities(hits, chance) {
    let probabilities = [1];
    for (let i = 0; i < hits; i++) {
      const next = new Array(probabilities.length + 1).fill(0);
      for (let successes = 0; successes < probabilities.length; successes++) {
        next[successes] += probabilities[successes] * (1 - chance);
        next[successes + 1] += probabilities[successes] * chance;
      }
      probabilities = next;
    }
    return probabilities;
  }

  function targetPreview(enemy, card, hits, chance) {
    const chances = probabilities(hits, chance), simulated = copy(enemy), outcomes = [];
    let potential = 0;
    for (let successes = 0; successes <= hits; successes++) {
      const wait = enemy.wait + (successes ? integer(card.delay) : 0);
      if (chances[successes] > 0) outcomes.push({probability:chances[successes], hp:simulated.hp, shield:simulated.shield, wait,
        damage:enemy.hp - simulated.hp, potential, shattered:successes > 0 && card.shatter && enemy.shield > 0});
      if (successes < hits && simulated.hp > 0) potential += hitEnemy(simulated, card, successes === 0).damage;
    }
    const result = {id:enemy.id, minDamage:Math.min(...outcomes.map(o => o.damage)), maxDamage:Math.max(...outcomes.map(o => o.damage)),
      expectedDamage:outcomes.reduce((sum, o) => sum + o.damage * o.probability, 0), hitChance:chance,
      afterMin:Math.min(...outcomes.map(o => o.hp)), afterMax:Math.max(...outcomes.map(o => o.hp)),
      killChance:outcomes.filter(o => o.hp === 0).reduce((sum, o) => sum + o.probability, 0),
      shatterChance:outcomes.filter(o => o.shattered).reduce((sum, o) => sum + o.probability, 0),
      delayChance:integer(card.delay) ? 1 - Math.pow(1 - chance, hits) : 0,
      maxPotentialDamage:Math.max(...outcomes.map(o => o.potential)),
      afterWaitMin:Math.min(...outcomes.map(o => o.wait)), afterWaitMax:Math.max(...outcomes.map(o => o.wait))};
    const first = outcomes[0];
    const certain = outcomes.every(o => o.hp === first.hp && o.shield === first.shield && o.wait === first.wait);
    return {result, certain:certain ? first : null};
  }

  function preview(state, card, targetId) {
    const prepared = prepare(state, card, targetId);
    if (!prepared.ok) return {...prepared, targets:[], heal:0, block:0, draw:0, energyGain:0, reroll:false, ...costs(card || {})};
    const {state:next, events, ids} = prepared, chance = accuracy(next, card) / 100, hits = Math.max(1, integer(card.hits, 1)), targets = [];
    for (const id of ids) {
      const enemy = next.enemies.find(e => e.id === id), projection = targetPreview(enemy, card, hits, chance);
      targets.push(projection.result);
      // Only put guaranteed enemy changes in state; uncertain outcomes live in targets.
      if (projection.certain) Object.assign(enemy, {hp:projection.certain.hp, shield:projection.certain.shield, wait:projection.certain.wait});
    }
    const effects = independentEffects(next, card, events);
    return {ok:true, error:null, ...prepared, targets, ...effects, risks:copy(card.risks || []), accuracy:chance * 100,
      reroll:events.some(e => e.type === 'reroll'), forecast:forecast(next)};
  }

  function currentAction(enemy) {
    if (Array.isArray(enemy.actions) && enemy.actions.length) return enemy.actions[integer(enemy.actionIndex) % enemy.actions.length];
    return {type:'attack', amount:integer(enemy.atk), delay:integer(enemy.delay)};
  }

  function consumeShield(state, damage) {
    let remaining = damage;
    state.shieldLayers.sort((a, b) => a.turns - b.turns);
    for (const layer of state.shieldLayers) {
      const absorbed = Math.min(layer.amount, remaining);
      layer.amount -= absorbed;
      remaining -= absorbed;
      if (!remaining) break;
    }
    state.shieldLayers = state.shieldLayers.filter(layer => layer.amount > 0);
    state.shield = shield(state);
    return {damage:remaining, absorbed:damage - remaining};
  }

  function round(state) {
    const next = normalize(state), events = [];
    if (next.hp <= 0) return {state:next, events};
    for (const enemy of next.enemies) {
      if (enemy.hp <= 0) continue;
      if (enemy.wait > 0) { enemy.wait--; continue; }
      const action = currentAction(enemy);
      if (action.card) {
        // Each ready enemy resolves exactly one actual card using the same pipeline.
        // The enemy deck is restricted to deterministic attack/guard cards: no combos.
        const card=action.card;
        const mirror={hp:enemy.hp,maxHp:enemy.maxHp,armor:enemy.armor||0,energy:99,
          shieldLayers:enemy.shield?[{amount:enemy.shield,turns:9999}]:[],statuses:[],
          enemies:[{id:'player',hp:next.hp,maxHp:next.maxHp,armor:effectiveArmor(next),shield:shield(next),wait:0}]};
        const result=play(mirror,card,'player');
        if(result.ok){
          enemy.hp=result.state.hp;enemy.shield=result.state.shield;
          events.push({type:'enemy-card',id:enemy.id,name:card.name,card});
          if(card.block)events.push({type:'enemy-guard',id:enemy.id,amount:result.block,shield:enemy.shield});
          for(const hit of result.events.filter(e=>e.type==='hit')){
            if(hit.shattered)next.shieldLayers=[];
            const before=next.hp;consumeShield(next,hit.absorbed+hit.hpDamage);next.hp=Math.max(0,next.hp-hit.hpDamage);
            events.push({type:'enemy-hit',id:enemy.id,raw:integer(card.damage),armorBlocked:card.pierce?0:Math.max(0,integer(card.damage)-hit.raw),absorbed:hit.absorbed,damage:before-next.hp,hp:next.hp});
          }
        }
      } else if (action.type === 'guard') {
        const amount = integer(action.amount, 6);
        enemy.shield += amount;
        events.push({type:'enemy-guard', id:enemy.id, amount, shield:enemy.shield});
      } else if (action.type === 'attack') {
        const raw = integer(action.amount), armorBlocked = Math.min(raw, effectiveArmor(next));
        const hit = consumeShield(next, raw - armorBlocked), before = next.hp;
        next.hp = Math.max(0, next.hp - hit.damage);
        events.push({type:'enemy-hit', id:enemy.id, raw, armorBlocked, absorbed:hit.absorbed, damage:before - next.hp, hp:next.hp});
      }
      if (Array.isArray(enemy.actions) && enemy.actions.length) enemy.actionIndex = (integer(enemy.actionIndex) + 1) % enemy.actions.length;
      enemy.wait = integer(currentAction(enemy).delay);
      events.push({type:'enemy-ready', id:enemy.id, wait:enemy.wait, actionIndex:integer(enemy.actionIndex)});
      if (next.hp <= 0) { events.push({type:'death'}); break; }
    }
    next.statuses = next.statuses.map(status => ({...status, turns:status.turns - 1})).filter(status => status.turns > 0);
    next.shieldLayers = next.shieldLayers.map(layer => ({...layer, turns:layer.turns - 1})).filter(layer => layer.turns > 0 && layer.amount > 0);
    next.shield = shield(next);
    return {state:next, events};
  }

  function forecast(state) {
    const next = normalize(state), armor = effectiveArmor(next), due = next.enemies.filter(e => e.hp > 0 && e.wait === 0 && currentAction(e).type === 'attack');
    let raw = 0, armorBlocked = 0, shieldBlocked = 0, damage = 0;
    const sources = [];
    for (const enemy of due) {
      const action=currentAction(enemy),amount=integer(action.amount),armorAbsorbed=Math.min(Math.max(0,amount-(action.card&&amount>0?1:0)),armor),hit=consumeShield(next,amount-armorAbsorbed);
      raw += amount; armorBlocked += armorAbsorbed; shieldBlocked += hit.absorbed; damage += hit.damage;
      sources.push({id:enemy.id, raw:amount, armorBlocked:armorAbsorbed, shieldBlocked:hit.absorbed, damage:hit.damage});
    }
    return {raw, armorBlocked, shieldBlocked, damage, hpLoss:Math.min(next.hp, damage), hpAfter:Math.max(0, next.hp - damage), sources};
  }

  return Object.freeze({play, preview, round, effectiveArmor, accuracy, shield, activeStatuses, forecast});
});
