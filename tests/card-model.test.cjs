'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Cards = require('../card-model.js');

function storage(initial={}) {
  const data = new Map(Object.entries(initial));
  return {
    data, writes:[], failWrite:false,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) {
      if (this.failWrite) throw Error('quota exceeded');
      this.writes.push([key,String(value)]);data.set(key,String(value));
    }
  };
}

test('fresh ownership has distinct physical copies and does not use gameplay RNG for identity', () => {
  const previous=Math.random;
  Math.random=()=>{throw Error('UID creation must not consume gameplay RNG');};
  let save;
  try {save=Cards.migrate();} finally {Math.random=previous;}
  assert.equal(save.instances.length,12);
  assert.equal(new Set(save.instances.map(c=>c.uid)).size,12);
  assert.deepEqual(save.instances.map(c=>c.templateId),Cards.baseDeck);
  assert.deepEqual(Cards.starterRefs(save),save.instances.map(c=>c.uid));
  assert.equal(Cards.create('missing'),null);
  assert.equal(Cards.compile('missing'),null);
});

test('legacy migration preserves credits, runs, loadout and raw backup without duplicating starters on reload', () => {
  const legacy=JSON.stringify({credits:460,runs:7,cards:['pierce','pierce','grenade','shot','unknown'],loadout:['pierce','grenade','unknown']});
  const store=storage({[Cards.keys.legacy]:legacy});
  const loaded=Cards.load(store);
  assert.equal(loaded.storageAvailable,true);
  assert.equal(loaded.save.version,2);
  assert.equal(loaded.save.credits,460);
  assert.equal(loaded.save.runs,7);
  assert.deepEqual(loaded.save.cards,['pierce','grenade']);
  assert.deepEqual(loaded.save.loadout,['pierce','grenade']);
  assert.equal(loaded.save.instances.length,14);
  assert.equal(Cards.loadoutRefs(loaded.save).length,2);
  assert.equal(store.getItem(Cards.keys.legacy),legacy);
  assert.equal(store.getItem(Cards.keys.legacyBackup),legacy);
  const reloaded=Cards.load(store);
  assert.deepEqual(reloaded.save,loaded.save);
  assert.equal(reloaded.save.instances.length,14);
});

test('saving creates a recoverable previous-version backup', () => {
  const store=storage();
  const first=Cards.load(store).save;
  const previous=store.getItem(Cards.keys.current);
  first.credits=91;
  assert.equal(Cards.persist(store,first),true);
  assert.equal(store.getItem(Cards.keys.backup),previous);
  assert.equal(JSON.parse(store.getItem(Cards.keys.current)).credits,91);
});

test('damaged current save recovers from backup and archives the damaged original', () => {
  const backup=JSON.stringify(Cards.migrate({credits:230,runs:2}));
  const corrupt='{broken';
  const store=storage({[Cards.keys.current]:corrupt,[Cards.keys.backup]:backup});
  const loaded=Cards.load(store);
  assert.equal(loaded.storageAvailable,true);
  assert.equal(loaded.save.credits,230);
  assert.match(loaded.notice,/복구/);
  const archive=[...store.data.entries()].find(([key])=>key.startsWith(Cards.keys.corruptPrefix));
  assert.ok(archive);
  assert.equal(archive[1],corrupt);
  assert.deepEqual(JSON.parse(store.getItem(Cards.keys.current)),loaded.save);
});

test('unrecoverable or malformed legacy saves are preserved and cannot be overwritten', () => {
  for (const key of [Cards.keys.current,Cards.keys.legacy]) {
    const corrupt='{unreadable';
    const store=storage({[key]:corrupt});
    const loaded=Cards.load(store);
    assert.equal(loaded.storageAvailable,false);
    assert.ok(loaded.notice);
    loaded.save.credits=99;
    assert.equal(Cards.persist(store,loaded.save),false);
    assert.equal(store.getItem(key),corrupt);
    assert.equal(store.writes.length,0);
  }
});

test('storage exceptions return usable in-memory ownership and report persistence failure', () => {
  const store=storage();store.failWrite=true;
  const loaded=Cards.load(store);
  assert.equal(loaded.storageAvailable,false);
  assert.equal(loaded.save.instances.length,12);
  assert.equal(Cards.persist(store,loaded.save),false);
  const unreadable={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(Cards.load(unreadable).storageAvailable,false);
});

test('normalization rejects unknown cards and duplicate IDs; unstable discoveries stay separate from stable collection', () => {
  const save=Cards.migrate();
  const rare=Cards.create('pierce',{uid:'owned-pierce'});
  const duplicate=Cards.create('grenade',{uid:'owned-pierce'});
  const found=Cards.create('breach',{uid:'found-breach',unstable:true,erosion:140});
  save.instances.push(rare,duplicate,found,{uid:'bad',templateId:'missing'});
  save.starterIds.push(save.starterIds[0],'missing-id');
  save.loadout=['pierce','breach','pierce'];
  save.credits=Infinity;save.runs=-20;
  Cards.sync(save);
  assert.equal(save.instances.length,14);
  assert.equal(save.credits,0);
  assert.equal(save.runs,0);
  assert.equal(save.starterIds.length,12);
  assert.deepEqual(save.cards,['pierce']);
  assert.deepEqual(save.loadout,['pierce']);
  assert.deepEqual(Cards.loadoutRefs(save),['owned-pierce']);
  assert.equal(save.instances.find(c=>c.uid==='found-breach').erosion,100);
  assert.equal(save.instances.find(c=>c.uid==='found-breach').unstable,true);
  assert.equal(Cards.normalize({version:1,instances:[]}),null);
});

test('duplicate normal affixes sum without losing their own value, tier or origin', () => {
  const instance=Cards.create('shot',{rarity:'unique',options:[
    {type:'damage',value:3,tier:'rare',rollStage:'rare'},
    {type:'damage',value:5,tier:'epic',rollStage:'epic'},
    {type:'heal',value:4,tier:'unique',bonus:true,riskId:'risk-1'},
    {type:'hits',value:2,tier:'rare'}
  ]});
  const before=JSON.stringify(instance);
  const compiled=Cards.compile(instance);
  assert.equal(compiled.damage,17);
  assert.equal(compiled.heal,4);
  assert.equal(compiled.hits,3);
  assert.equal(instance.options.length,4);
  assert.deepEqual(instance.options.slice(0,2),[
    {type:'damage',value:3,tier:'rare',rollStage:'rare'},
    {type:'damage',value:5,tier:'epic',rollStage:'epic'}
  ]);
  assert.equal(JSON.stringify(instance),before);
});

test('different unique affixes coexist while duplicate unique kinds occupy one slot', () => {
  const card=Cards.create('shot',{rarity:'mystic',options:[
    {type:'pierce',tier:'unique'},
    {type:'shatter',tier:'legendary'},
    {type:'delay',value:2,tier:'mystic'},
    {type:'pierce',tier:'mystic'},
    {type:'delay',value:4,tier:'mystic'}
  ]});
  assert.equal(card.options.length,3);
  const compiled=Cards.compile(card);
  assert.equal(compiled.pierce,true);
  assert.equal(compiled.shatter,true);
  assert.equal(compiled.delay,2);
});

test('six grades expose the agreed risk-slot staircase without rolling progression probabilities', () => {
  assert.deepEqual(Cards.rarities,['normal','rare','epic','unique','legendary','mystic']);
  assert.deepEqual(Cards.rarities.map(Cards.riskCapacity),[0,0,1,2,3,4]);
  const card=Cards.create('shot',{rarity:'rare',options:[{type:'damage',value:8,tier:'mystic'}]});
  assert.equal(card.options[0].tier,'rare');
});

test('template risks and added risks compile independently and never mutate templates', () => {
  const card=Cards.create('surge',{risks:[{type:'energy',amount:1,turns:2}]});
  const compiled=Cards.compile(card);
  assert.equal(compiled.draw,1);
  assert.equal(compiled.energyGain,1);
  assert.deepEqual(compiled.risks,[{type:'hp',amount:3,turns:1},{type:'energy',amount:1,turns:2}]);
  compiled.risks[0].amount=100;
  assert.equal(Cards.compile(card).risks[0].amount,3);
  assert.equal(Cards.templates.surge.risks[0].amount,3);
});
