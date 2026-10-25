/* Card ownership and save migration. A card's UID survives every combat pile move. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const KEYS = Object.freeze({current:'deadhand-save-v2', backup:'deadhand-save-v2.backup', legacy:'deadhand-save-v1', legacyBackup:'deadhand-save-v1.backup', corruptPrefix:'deadhand-save-v2.corrupt-'});
  const rarities = Object.freeze(['normal','rare','epic','unique','legendary','mystic']);
  const baseDeck = Object.freeze(['shot','shot','shot','shot','burst','burst','guard','guard','guard','scan','scan','heal']);
  const baseTypes = new Set(baseDeck);
  const templates = {
    shot:{name:'정밀 사격',type:'attack',label:'ATTACK',cost:1,damage:9,desc:'적 하나에게 피해 9.',icon:'crosshair',code:'ATK–01',rarity:'normal'},
    burst:{name:'점사',type:'attack',label:'ATTACK',cost:2,damage:18,desc:'적 하나에게 피해 18.',icon:'crosshair',code:'ATK–02',rarity:'normal'},
    guard:{name:'방탄 엄폐',type:'defense',label:'DEFENSE',cost:1,block:12,shieldDuration:1,desc:'이번 게임 턴 동안 쉴드 12 획득.',icon:'shield',code:'DEF–01',rarity:'normal'},
    scan:{name:'전술 스캔',type:'utility',label:'TACTICAL',cost:1,draw:2,desc:'카드를 2장 뽑습니다.',icon:'cards',code:'TAC–01',rarity:'normal'},
    heal:{name:'응급 처치',type:'utility',label:'MEDICAL',cost:1,heal:12,desc:'체력을 12 회복합니다.',icon:'plus',code:'MED–01',rarity:'normal'},
    pierce:{name:'철갑탄',type:'attack',label:'RARE / ATK',cost:2,damage:26,pierce:true,desc:'장갑을 무시하고 피해 26. 쉴드는 피해를 흡수합니다.',icon:'crosshair',code:'ATK–03',rarity:'rare'},
    grenade:{name:'파편 수류탄',type:'attack',label:'RARE / AOE',cost:2,damage:14,aoe:true,desc:'모든 적에게 피해 14.',icon:'bolt',code:'ATK–04',rarity:'rare'},
    surge:{name:'과부하',type:'utility',label:'RARE / TAC',cost:0,surge:true,draw:1,energyGain:1,risks:[{type:'hp',amount:3,turns:1}],desc:'체력 3을 먼저 소모. 에너지 +1, 카드 1장.',icon:'bolt',code:'TAC–02',rarity:'rare'},
    suppress:{name:'제압 사격',type:'attack',label:'TACTICAL / ATK',cost:2,damage:6,hits:2,delay:1,risks:[{type:'stress',amount:20,turns:2}],desc:'스트레스 20%·2턴. 피해 6 × 2회. 명중한 적의 행동 대기 +1.',icon:'crosshair',code:'ATK–05',rarity:'epic'},
    breach:{name:'차폐 파쇄',type:'attack',label:'TACTICAL / ATK',cost:2,damage:12,shatter:true,risks:[{type:'hp',amount:3,turns:1}],desc:'체력 3을 먼저 소모. 첫 명중에 쉴드 전량 제거 후 피해 12.',icon:'crosshair',code:'ATK–06',rarity:'epic'},
    fieldAid:{name:'긴급 수혈',type:'utility',label:'MEDICAL / TAC',cost:1,heal:18,draw:1,risks:[{type:'seal',amount:1,turns:2}],desc:'승화 2턴으로 쉴드 획득 차단. 체력 18 회복, 카드 1장.',icon:'plus',code:'MED–02',rarity:'epic'},
    bulwark:{name:'장기 엄폐',type:'defense',label:'TACTICAL / DEF',cost:1,block:16,shieldDuration:2,risks:[{type:'curse',amount:1,turns:1}],desc:'저주로 남은 손패 교체. 쉴드 16을 2게임 턴 유지.',icon:'shield',code:'DEF–02',rarity:'epic'}
  };
  for (const item of Object.values(templates)) {
    if (item.risks) { item.risks.forEach(Object.freeze); Object.freeze(item.risks); }
    Object.freeze(item);
  }
  Object.freeze(templates);
  const known = id => typeof id==='string' && Object.prototype.hasOwnProperty.call(templates,id);
  const optionTypes = new Set(['damage','block','heal','draw','energyGain','hits','shieldDuration','targets','pierce','shatter','delay','cost']);
  const riskTypes = new Set(['hp','energy','vulnerable','stress','seal','curse','erosion']);
  const blockedStorage = new WeakSet();
  let sequence = 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = value => (typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value));
  const number = (value, fallback=0, min=0, max=9999) => finite(value) ? Math.max(min,Math.min(max,Number(value))) : fallback;
  const integer = (value, fallback=0, min=0, max=9999) => Math.floor(number(value,fallback,min,max));
  const rank = value => rarities.includes(value) ? value : 'normal';
  const uidValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
  function nextUid() {
    try { if (root.crypto && typeof root.crypto.randomUUID === 'function') return 'c-' + root.crypto.randomUUID(); } catch {}
    sequence++;
    return 'c-' + Date.now().toString(36) + '-' + sequence.toString(36);
  }
  function normalizeOptions(items, cardRarity) {
    if (!Array.isArray(items)) return [];
    const uniqueSeen = new Set();
    return items.slice(0,64).flatMap(item => {
      if (!item || typeof item !== 'object' || !optionTypes.has(item.type)) return [];
      const unique = ['pierce','shatter'].includes(item.type);
      if (!unique && !finite(item.value)) return [];
      if (['pierce','shatter','delay'].includes(item.type)) {
        if (uniqueSeen.has(item.type)) return [];
        uniqueSeen.add(item.type);
      }
      let tier = rarities.includes(item.tier) ? item.tier : 'normal';
      if (rarities.indexOf(tier)>rarities.indexOf(cardRarity)) tier=cardRarity;
      const out = {type:item.type,value:unique?(item.value===false||item.value===0?0:1):number(item.value,0,0,9999),tier};
      if (rarities.includes(item.rollStage)) out.rollStage=item.rollStage;
      if (typeof item.bonus === 'boolean') out.bonus=item.bonus;
      if (uidValid(item.riskId)) out.riskId=item.riskId;
      return [out];
    });
  }
  function normalizeRisks(items) {
    if (!Array.isArray(items)) return [];
    return items.slice(0,64).flatMap(item => {
      if (!item || typeof item !== 'object' || !riskTypes.has(item.type)) return [];
      const flag = ['seal','curse'].includes(item.type);
      if (!flag && !finite(item.amount)) return [];
      const out={type:item.type,amount:flag?1:number(item.amount,0,0,item.type==='stress'||item.type==='erosion'?100:9999),turns:integer(item.turns,1,1,9999)};
      if (uidValid(item.uid)) out.uid=item.uid;
      return [out];
    });
  }
  function create(templateId, overrides={}) {
    const template=known(templateId)?templates[templateId]:null;if (!template) return null;
    const rarity=rarities.includes(overrides.rarity)?overrides.rarity:template.rarity;
    return {uid:uidValid(overrides.uid)?overrides.uid:nextUid(),templateId,rarity,
      options:normalizeOptions(overrides.options,rarity),risks:normalizeRisks(overrides.risks),
      erosion:number(overrides.erosion,0,0,100),unstable:overrides.unstable===true};
  }
  function compile(source) {
    const instance=typeof source==='string'?null:source;
    const templateId=typeof source==='string'?source:source&&source.templateId;
    const template=known(templateId)?templates[templateId]:null;if (!template) return null;
    const rarity=instance&&rarities.includes(instance.rarity)?instance.rarity:template.rarity;
    const card={...template,templateId,rarity,hits:template.hits||1,shieldDuration:template.shieldDuration||1,
      risks:clone(template.risks||[])};
    if (instance) {
      card.uid=instance.uid;
      card.erosion=number(instance.erosion,0,0,100);card.unstable=instance.unstable===true;
      const options=normalizeOptions(instance.options,rarity);
      for (const item of options) {
        if (item.type==='pierce'||item.type==='shatter') { card[item.type]=!!(card[item.type]||item.value); continue; }
        if (item.type==='delay') { card.delay=Math.max(card.delay||0,item.value); continue; }
        if (item.type==='targets') { card.targets=(card.targets||1)+item.value;continue; }
        card[item.type]=(card[item.type]||0)+item.value;
      }
      card.risks.push(...normalizeRisks(instance.risks));
    }
    for (const type of ['cost','damage','block','heal','draw','energyGain','delay']) if (card[type]!==undefined) card[type]=integer(card[type]);
    card.hits=integer(card.hits,1,1,9999);card.shieldDuration=integer(card.shieldDuration,1,1,9999);
    if (card.targets!==undefined) card.targets=integer(card.targets,1,1,9999);
    return card;
  }
  function riskCapacity(rarity) { return [0,0,1,2,3,4][rarities.indexOf(rank(rarity))]; }
  function newSave(legacy={}) {
    const starters=baseDeck.map(id=>create(id));
    const unlocked=[...new Set((Array.isArray(legacy.cards)?legacy.cards:[]).filter(id=>known(id)&&!baseTypes.has(id)))];
    const save={version:2,credits:integer(legacy.credits,0,0,Number.MAX_SAFE_INTEGER),runs:integer(legacy.runs,0,0,Number.MAX_SAFE_INTEGER),cards:unlocked,
      loadout:Array.isArray(legacy.loadout)?legacy.loadout.slice():[],instances:[...starters,...unlocked.map(id=>create(id))],starterIds:starters.map(c=>c.uid)};
    return sync(save);
  }
  function normalize(raw) {
    if (!raw || typeof raw!=='object' || Array.isArray(raw) || raw.version!==2 || !Array.isArray(raw.instances)) return null;
    const seen=new Set(),instances=[];
    for (const item of raw.instances.slice(0,20000)) {
      if (!item || typeof item!=='object' || !uidValid(item.uid)||seen.has(item.uid)||!known(item.templateId)) continue;
      seen.add(item.uid);instances.push(create(item.templateId,item));
    }
    const present=new Set(instances.map(c=>c.uid));
    const starterIds=[...new Set((Array.isArray(raw.starterIds)?raw.starterIds:[]).filter(id=>present.has(id)))];
    const cards=[...new Set(instances.filter(c=>!c.unstable&&!baseTypes.has(c.templateId)).map(c=>c.templateId))];
    const loadout=[...new Set((Array.isArray(raw.loadout)?raw.loadout:[]).filter(id=>typeof id==='string'&&cards.includes(id)))].slice(0,2);
    return {version:2,credits:integer(raw.credits,0,0,Number.MAX_SAFE_INTEGER),runs:integer(raw.runs,0,0,Number.MAX_SAFE_INTEGER),cards,loadout,instances,starterIds};
  }
  function sync(save) {
    const normalized=normalize(save);if (!normalized) return null;
    Object.assign(save,normalized);return save;
  }
  function starterRefs(save) {
    const present=new Set((save.instances||[]).map(c=>c.uid));
    return (save.starterIds||[]).filter(id=>present.has(id));
  }
  function loadoutRefs(save) {
    const used=new Set(starterRefs(save)),refs=[];
    for (const templateId of save.loadout||[]) {
      const item=(save.instances||[]).find(c=>c.templateId===templateId&&!c.unstable&&!used.has(c.uid));
      if (item) {used.add(item.uid);refs.push(item.uid);}
    }
    return refs;
  }
  function parseV2(raw) { try {return raw===null?null:normalize(JSON.parse(raw));} catch {return null;} }
  function readStorage(storage) {
    if (storage) return storage;
    try {return root.localStorage;} catch {return null;}
  }
  function writable(storage) {return storage&&typeof storage.getItem==='function'&&typeof storage.setItem==='function'&&!blockedStorage.has(storage);}
  function archiveCorrupt(storage, raw) {
    const key=KEYS.corruptPrefix+Date.now().toString(36)+'-'+(++sequence).toString(36);
    storage.setItem(key,raw);
  }
  function persist(storage, save) {
    storage=readStorage(storage);
    if (!writable(storage)) return false;
    const normalized=normalize(save);if (!normalized) return false;
    try {
      const current=storage.getItem(KEYS.current);
      if (current!==null) {
        if (!parseV2(current)) {blockedStorage.add(storage);return false;}
        storage.setItem(KEYS.backup,current);
      }
      storage.setItem(KEYS.current,JSON.stringify(normalized));
      return true;
    } catch {return false;}
  }
  function load(storage) {
    storage=readStorage(storage);
    if (!storage || typeof storage.getItem!=='function' || typeof storage.setItem!=='function') return {save:newSave(),storageAvailable:false,notice:'저장소를 사용할 수 없어 현재 창에서만 보존됩니다.'};
    try {
      const current=storage.getItem(KEYS.current);
      if (current!==null) {
        const parsed=parseV2(current);
        if (parsed) return {save:parsed,storageAvailable:true,notice:''};
        const backup=storage.getItem(KEYS.backup),recovered=parseV2(backup);
        if (recovered) {
          try {archiveCorrupt(storage,current);storage.setItem(KEYS.current,JSON.stringify(recovered));blockedStorage.delete(storage);return {save:recovered,storageAvailable:true,notice:'저장 백업에서 보관함을 복구했습니다.'};}
          catch {blockedStorage.add(storage);return {save:recovered,storageAvailable:false,notice:'백업을 읽었지만 저장할 수 없어 현재 창에서만 진행합니다.'};}
        }
        blockedStorage.add(storage);
        let legacy={};try {legacy=JSON.parse(storage.getItem(KEYS.legacy)||'null')||{};}catch{}
        return {save:newSave(legacy),storageAvailable:false,notice:'손상된 저장 원본을 보존했습니다. 현재 창에서만 진행합니다.'};
      }
      const legacyRaw=storage.getItem(KEYS.legacy);
      let legacy={};
      if (legacyRaw!==null) {
        try {legacy=JSON.parse(legacyRaw)||{};if(typeof legacy!=='object'||Array.isArray(legacy))throw new Error('invalid legacy');}
        catch {blockedStorage.add(storage);return {save:newSave(),storageAvailable:false,notice:'이전 저장 원본을 읽을 수 없어 보존했습니다. 현재 창에서만 진행합니다.'};}
      }
      const save=newSave(legacy);
      try {if (legacyRaw!==null && storage.getItem(KEYS.legacyBackup)===null) storage.setItem(KEYS.legacyBackup,legacyRaw);}
      catch {return {save,storageAvailable:false,notice:'이전 보관함을 읽었지만 저장할 수 없어 현재 창에서만 진행합니다.'};}
      const available=persist(storage,save);
      return {save,storageAvailable:available,notice:available?(legacyRaw!==null?'기존 보관함을 카드별 저장 형식으로 옮겼습니다.':''):'저장할 수 없어 현재 창에서만 진행합니다.'};
    } catch {return {save:newSave(),storageAvailable:false,notice:'저장소를 사용할 수 없어 현재 창에서만 보존됩니다.'};}
  }
  return Object.freeze({templates,baseDeck,rarities,keys:KEYS,create,compile,riskCapacity,load,persist,normalize,sync,starterRefs,loadoutRefs,migrate:newSave});
});
