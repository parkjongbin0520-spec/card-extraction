'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../combat.js');

const enemy = (overrides = {}) => ({id:0, hp:100, maxHp:100, armor:0, shield:0, wait:0, actionIndex:0,
  actions:[{type:'attack', amount:6, delay:0}], ...overrides});
const state = (overrides = {}) => ({hp:80, maxHp:80, armor:1, energy:3, shieldLayers:[], statuses:[], enemies:[enemy()], ...overrides});
const attack = (overrides = {}) => ({type:'attack', cost:1, damage:9, ...overrides});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('risks precede the current card; each hit rolls; independent effects and delay happen once', () => {
  const original = state({hp:6, enemies:[enemy({armor:2, shield:50})]});
  const before = structuredClone(original), rolls = [.9, .1, .2];
  const card = attack({cost:2, hits:3, shatter:true, delay:1, heal:4, draw:2, energyGain:1,
    risks:[{type:'hp', amount:5}, {type:'stress', amount:20, turns:2}]});
  const result = Rules.play(original, card, 0, {rng:() => rolls.shift()});
  assert.equal(result.ok, true);
  assert.equal(result.state.hp, 5);
  assert.equal(result.state.energy, 2);
  assert.equal(result.state.enemies[0].hp, 86);
  assert.equal(result.state.enemies[0].shield, 0);
  assert.equal(result.state.enemies[0].wait, 1);
  assert.equal(result.events.filter(e => e.type === 'miss').length, 1);
  assert.equal(result.events.filter(e => e.type === 'hit').length, 2);
  assert.equal(result.events.filter(e => e.type === 'delay').length, 1);
  assert.deepEqual(result.events.filter(e => e.type === 'draw'), [{type:'draw', count:2}]);
  assert.equal(result.accuracy, 80);
  assert.deepEqual(original, before);
});

test('HP at or below cost is rejected before paying or rolling, even on a healing card', () => {
  for (const hp of [3, 5]) {
    const original = state({hp});
    const result = Rules.play(original, attack({heal:12, risks:[{type:'hp', amount:5}]}), 0, {rng:() => {throw Error('must not roll');}});
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'hp');
    assert.deepEqual(result.state, original);
    assert.deepEqual(result.events, []);
  }
  assert.equal(Rules.play(state({hp:6}), {type:'utility', cost:1, heal:12, risks:[{type:'hp', amount:5}]}).state.hp, 13);
});

test('effective energy cost includes risks and cannot be paid by the same card energy gain', () => {
  const original = state({energy:1});
  const card = attack({cost:1, energyGain:3, risks:[{type:'energy', amount:1}]});
  const result = Rules.play(original, card, 0);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'energy');
  assert.deepEqual(result.state, original);
});

test('all misses still heal, draw and grant energy; they do not shatter or delay', () => {
  const result = Rules.play(state({hp:50, enemies:[enemy({shield:50})]}), attack({hits:3, shatter:true, delay:2, heal:12, draw:2, energyGain:1,
    risks:[{type:'stress', amount:100, turns:1}]}), 0);
  assert.equal(result.state.hp, 62);
  assert.equal(result.state.energy, 3);
  assert.equal(result.state.enemies[0].hp, 100);
  assert.equal(result.state.enemies[0].shield, 50);
  assert.equal(result.state.enemies[0].wait, 0);
  assert.equal(result.events.filter(e => e.type === 'draw').length, 1);
  assert.equal(result.events.filter(e => e.type === 'miss').length, 3);
});

test('pierce ignores armor but shield still absorbs; shatter removes the entire shield first', () => {
  const original = state({enemies:[enemy({armor:8, shield:20})]});
  const pierce = Rules.play(original, attack({damage:12, pierce:true}), 0);
  assert.equal(pierce.state.enemies[0].hp, 100);
  assert.equal(pierce.state.enemies[0].shield, 8);
  const shatter = Rules.play(original, attack({damage:12, shatter:true}), 0);
  assert.equal(shatter.state.enemies[0].hp, 96);
  assert.equal(shatter.state.enemies[0].shield, 0);
  assert.equal(shatter.events.find(e => e.type === 'hit').shattered, 20);
});

test('seal clears existing shield and blocks the same card shield grant without restoring it later', () => {
  const result = Rules.play(state({shieldLayers:[{amount:7, turns:3}]}), {type:'defense', cost:1, block:12,
    risks:[{type:'seal', turns:1}]});
  assert.equal(result.block, 0);
  assert.equal(result.state.shield, 0);
  assert.deepEqual(result.state.shieldLayers, []);
  const after = Rules.round(result.state);
  assert.equal(after.state.shield, 0);
  assert.deepEqual(after.state.statuses, []);
});

test('curse emits one reroll before draw and never creates a second card-use event', () => {
  const result = Rules.play(state({statuses:[{type:'curse', amount:1, turns:3}]}), {type:'utility', cost:1, draw:2,
    risks:[{type:'curse', turns:1}]});
  assert.equal(result.events.filter(e => e.type === 'reroll').length, 1);
  assert.ok(result.events.findIndex(e => e.type === 'reroll') < result.events.findIndex(e => e.type === 'draw'));
  assert.equal(result.state.statuses.find(s => s.type === 'curse').turns, 3);
});

test('different status strengths keep their clocks; weak layers expire while masked', () => {
  let result = Rules.play(state({armor:5, enemies:[], statuses:[{type:'vulnerable', amount:3, turns:2}]}),
    {type:'utility', cost:0, risks:[{type:'vulnerable', amount:1, turns:3}]}).state;
  assert.equal(Rules.effectiveArmor(result), 2);
  result = Rules.round(result).state;
  assert.equal(Rules.effectiveArmor(result), 2);
  result = Rules.round(result).state;
  assert.equal(Rules.effectiveArmor(result), 4);
  result = Rules.round(result).state;
  assert.equal(Rules.effectiveArmor(result), 5);
  let masked = state({armor:5, enemies:[], statuses:[{type:'vulnerable', amount:3, turns:3}, {type:'vulnerable', amount:1, turns:1}]});
  masked = Rules.round(masked).state;
  assert.deepEqual(masked.statuses, [{type:'vulnerable', amount:3, turns:2}]);
});

test('same status strength uses max duration rather than addition or shortening', () => {
  const result = Rules.play(state({statuses:[{type:'stress', amount:20, turns:3}]}), {type:'utility', cost:0,
    risks:[{type:'stress', amount:20, turns:1}]}).state;
  assert.deepEqual(result.statuses, [{type:'stress', amount:20, turns:3}]);
  const extended = Rules.play(result, {type:'utility', cost:0, risks:[{type:'stress', amount:20, turns:5}]}).state;
  assert.deepEqual(extended.statuses, [{type:'stress', amount:20, turns:5}]);
  assert.equal(Rules.accuracy(extended), 80);
});

test('wait 1 becomes ready but does not attack until the next round', () => {
  const original = state({enemies:[enemy({wait:1})]});
  const first = Rules.round(original);
  assert.equal(first.state.hp, 80);
  assert.equal(first.state.enemies[0].wait, 0);
  assert.equal(first.events.filter(e => e.type === 'enemy-hit').length, 0);
  const second = Rules.round(first.state);
  assert.equal(second.state.hp, 75);
  assert.equal(second.events.filter(e => e.type === 'enemy-hit').length, 1);
  assert.equal(original.enemies[0].wait, 1);
});

test('wait 5 rests for five round boundaries, then attacks', () => {
  let result = state({enemies:[enemy({wait:5})]});
  for (let wait = 4; wait >= 0; wait--) {
    result = Rules.round(result).state;
    assert.equal(result.enemies[0].wait, wait);
    assert.equal(result.hp, 80);
  }
  assert.equal(Rules.round(result).state.hp, 75);
});

test('a delayed ready enemy acts exactly one round later and one card delays once across hits', () => {
  const card = attack({damage:1, hits:3, delay:1});
  const played = Rules.play(state(), card, 0).state;
  assert.equal(played.enemies[0].wait, 1);
  const first = Rules.round(played).state;
  assert.equal(first.hp, 80);
  assert.equal(first.enemies[0].wait, 0);
  assert.equal(Rules.round(first).state.hp, 75);
});

test('enemy action is fixed during waiting and a newly scheduled delay is not decremented again', () => {
  const original = state({turn:8, enemies:[enemy({wait:0, actionIndex:0, extraRenderField:'preserved', actions:[
    {type:'attack', amount:6, delay:0}, {type:'guard', amount:6, delay:2}]})]});
  const acted = Rules.round(original).state;
  assert.equal(acted.enemies[0].actionIndex, 1);
  assert.equal(acted.enemies[0].wait, 2);
  assert.equal(acted.turn, 8);
  assert.equal(acted.enemies[0].extraRenderField, 'preserved');
  assert.equal(Rules.round(acted).state.enemies[0].wait, 1);
  const ready = Rules.round(Rules.round(acted).state).state;
  assert.equal(ready.enemies[0].actionIndex, 1);
  assert.equal(ready.enemies[0].shield, 0);
  assert.equal(Rules.round(ready).state.enemies[0].shield, 6);
});

test('a one-turn vulnerability affects the current enemy phase then expires', () => {
  const played = Rules.play(state({armor:3}), {type:'utility', cost:0, risks:[{type:'vulnerable', amount:2, turns:1}]}).state;
  assert.equal(Rules.forecast(played).damage, 5);
  const result = Rules.round(played).state;
  assert.equal(result.hp, 75);
  assert.deepEqual(result.statuses, []);
  assert.equal(Rules.effectiveArmor(result), 3);
});

test('shield layers consume the earliest expiry, preserve residuals and never refill', () => {
  let result = state({armor:0, shieldLayers:[{amount:12, turns:2, id:'long'}, {amount:5, turns:1, id:'short'}], enemies:[enemy({actions:[{type:'attack', amount:10, delay:1}]})]});
  assert.equal(Rules.forecast(result).shieldBlocked, 10);
  result = Rules.round(result).state;
  assert.equal(result.hp, 80);
  assert.deepEqual(result.shieldLayers, [{amount:7, turns:1, id:'long'}]);
  result = Rules.round(result).state;
  assert.equal(result.hp, 80);
  assert.deepEqual(result.shieldLayers, []);
  assert.equal(result.shield, 0);
});

test('forecast only includes currently ready attacks and accounts for armor and shield per attack', () => {
  const original = state({armor:2, shieldLayers:[{amount:5, turns:1}], enemies:[
    enemy({id:0, actions:[{type:'attack', amount:8, delay:0}]}),
    enemy({id:1, actions:[{type:'attack', amount:6, delay:0}]}),
    enemy({id:2, wait:1, actions:[{type:'attack', amount:90, delay:0}]}),
    enemy({id:3, actions:[{type:'guard', amount:6, delay:0}]})]});
  const result = Rules.forecast(original);
  assert.deepEqual([result.raw, result.armorBlocked, result.shieldBlocked, result.damage, result.hpAfter], [14, 4, 5, 5, 75]);
  assert.equal(original.shieldLayers[0].amount, 5);
  assert.equal(Rules.round(original).state.hp, result.hpAfter);
});

test('preview never consumes randomness or changes input; distribution uses independent hits', () => {
  const original = state({hp:50, enemies:[enemy({hp:18, maxHp:18})]});
  const before = structuredClone(original), oldRandom = Math.random;
  Math.random = () => {throw Error('preview must not roll');};
  let result;
  try { result = Rules.preview(original, attack({hits:3, heal:4, risks:[{type:'stress', amount:20, turns:2}]}), 0); }
  finally { Math.random = oldRandom; }
  assert.deepEqual(original, before);
  assert.equal(result.targets[0].minDamage, 0);
  assert.equal(result.targets[0].maxDamage, 18);
  assert.equal(result.targets[0].afterMin, 0);
  assert.equal(result.targets[0].afterMax, 18);
  near(result.targets[0].killChance, .896);
  near(result.targets[0].expectedDamage, 16.992);
  assert.equal(result.heal, 4);
  assert.equal(result.state.hp, 54);
  assert.equal(result.accuracy, 80);
  assert.equal(result.state.enemies[0].hp, 18, 'uncertain enemy state is not presented as certain');
});

test('preview includes risk-first HP and seal effects and applies certain enemy projections', () => {
  const result = Rules.preview(state({hp:6}), attack({damage:12, heal:12, block:20,
    risks:[{type:'hp', amount:5}, {type:'seal', turns:2}]}), 0);
  assert.equal(result.hpCost, 5);
  assert.equal(result.heal, 12);
  assert.equal(result.state.hp, 13);
  assert.equal(result.block, 0);
  assert.equal(result.targets[0].maxDamage, 12);
  assert.equal(result.state.enemies[0].hp, 88);
});

test('shatter preview probability follows at least one hit and sequential armor/shield math', () => {
  const original = state({enemies:[enemy({armor:2, shield:50})]});
  const result = Rules.preview(original, attack({damage:9, hits:3, shatter:true, delay:1, risks:[{type:'stress', amount:20, turns:1}]}), 0);
  near(result.targets[0].shatterChance, .992);
  near(result.targets[0].delayChance, .992);
  near(result.targets[0].expectedDamage, 16.8);
  assert.equal(result.targets[0].maxDamage, 21);
  assert.equal(result.targets[0].afterWaitMin, 0);
  assert.equal(result.targets[0].afterWaitMax, 1);
  assert.equal(original.enemies[0].shield, 50);
});

test('AoE independently projects and resolves each target, with self effects once', () => {
  const original = state({hp:40, enemies:[enemy({id:0, armor:2}), enemy({id:1, armor:0, shield:5})]});
  const card = attack({damage:9, hits:2, aoe:true, heal:12, draw:2, energyGain:1, delay:1});
  const projected = Rules.preview(original, card, 0), actual = Rules.play(original, card, 0);
  assert.deepEqual(projected.targets.map(t => t.maxDamage), [14, 13]);
  assert.deepEqual(actual.state.enemies.map(e => e.hp), [86, 87]);
  assert.deepEqual(actual.state.enemies.map(e => e.wait), [1, 1]);
  assert.equal(actual.state.hp, 52);
  assert.equal(actual.events.filter(e => e.type === 'draw').length, 1);
  assert.equal(actual.events.filter(e => e.type === 'energy').length, 1);
});

test('death interrupts remaining enemy attacks and each result stays isolated', () => {
  const original = state({hp:2, armor:0, enemies:[enemy({id:0}), enemy({id:1})]});
  const result = Rules.round(original);
  assert.equal(result.state.hp, 0);
  assert.equal(result.events.filter(e => e.type === 'enemy-hit').length, 1);
  assert.equal(result.events.filter(e => e.type === 'death').length, 1);
  assert.equal(original.hp, 2);
});

test('invalid or dead targets do not spend; empty utility casts do not require enemies', () => {
  const original = state({enemies:[enemy({hp:0})]});
  assert.equal(Rules.play(original, attack(), 0).errorCode, 'target');
  assert.equal(Rules.play(original, {type:'utility', cost:0, energyGain:1}).state.energy, 4);
  assert.equal(Rules.preview(original, attack(), 0).ok, false);
});

test('preview agrees with every possible three-hit result through armor, shield and lethal damage', () => {
  for (const modifiers of [{}, {pierce:true}, {shatter:true}]) {
    const original = state({enemies:[enemy({hp:13, maxHp:13, armor:2, shield:6})]});
    const card = attack({damage:9, hits:3, delay:1, ...modifiers,
      risks:[{type:'stress', amount:50, turns:2}]});
    const projection = Rules.preview(original, card, 0).targets[0], damages = [];
    let kills = 0;
    for (let mask = 0; mask < 8; mask++) {
      let hit = 0;
      const result = Rules.play(original, card, 0, {rng:() => (mask >> hit++ & 1) ? .25 : .75});
      const remaining = result.state.enemies[0].hp;
      damages.push(13 - remaining);
      if (remaining === 0) kills++;
    }
    assert.equal(projection.minDamage, Math.min(...damages));
    assert.equal(projection.maxDamage, Math.max(...damages));
    near(projection.expectedDamage, damages.reduce((sum, damage) => sum + damage, 0) / 8);
    near(projection.killChance, kills / 8);
  }
});
