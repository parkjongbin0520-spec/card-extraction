/* DEAD HAND — self-contained canvas renderer and tactical card game. No assets or libraries. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const CARDS = {
    shot: {name:'정밀 사격', type:'attack', label:'ATTACK', cost:1, damage:9, desc:'적 하나에게 피해 9.', icon:'crosshair', code:'ATK–01'},
    burst: {name:'점사', type:'attack', label:'ATTACK', cost:2, damage:18, desc:'적 하나에게 피해 18.', icon:'crosshair', code:'ATK–02'},
    guard: {name:'방탄 엄폐', type:'defense', label:'DEFENSE', cost:1, block:12, desc:'이번 턴 방어 12 획득.', icon:'shield', code:'DEF–01'},
    scan: {name:'전술 스캔', type:'utility', label:'TACTICAL', cost:1, draw:2, desc:'카드를 2장 뽑습니다.', icon:'cards', code:'TAC–01'},
    heal: {name:'응급 처치', type:'utility', label:'MEDICAL', cost:1, heal:12, desc:'체력을 12 회복합니다.', icon:'plus', code:'MED–01'},
    pierce: {name:'철갑탄', type:'attack', label:'RARE / ATK', cost:2, damage:26, pierce:true, desc:'장갑을 무시하고 피해 26.', icon:'crosshair', code:'ATK–03'},
    grenade: {name:'파편 수류탄', type:'attack', label:'RARE / AOE', cost:2, damage:14, aoe:true, desc:'시야 내 모든 적에게 피해 14.', icon:'bolt', code:'ATK–04'},
    surge: {name:'과부하', type:'utility', label:'RARE / TAC', cost:0, surge:true, desc:'체력 3 소모. 에너지 +1, 카드 1장.', icon:'bolt', code:'TAC–02'}
  };
  const BASE_DECK = ['shot','shot','shot','shot','burst','burst','guard','guard','guard','scan','scan','heal'];
  const ZONES = [
    {name:'외곽 경계', english:'THE PERIMETER', description:'버려진 검문소. 경계병을 무력화하고 회수 단말에 도달하세요.', risk:'낮음 / I', reward:120, enemies:[{x:7.5,y:8.1,hp:18,atk:6,name:'경계병'},{x:9.5,y:4.5,hp:22,atk:8,name:'정찰 드론',drone:true}]},
    {name:'적재 구역', english:'THE LOADING BAY', description:'보안 병력이 집결했습니다. 장갑병의 방어를 뚫고 전리품을 확보하세요.', risk:'높음 / II', reward:240, enemies:[{x:7.5,y:8.5,hp:26,atk:8,name:'진압병',armor:2},{x:4.5,y:6.5,hp:20,atk:7,name:'정찰 드론',drone:true},{x:9.5,y:3.5,hp:28,atk:10,name:'진압병',armor:2}]},
    {name:'심층 벙커', english:'THE INNER VAULT', description:'시설의 마지막 방어선. 모든 적을 제압하고 최종 회수 지점에 도달하세요.', risk:'치명적 / III', reward:480, enemies:[{x:7.5,y:9,hp:34,atk:10,name:'중장갑병',armor:3},{x:5.5,y:5.5,hp:26,atk:9,name:'공격 드론',drone:true},{x:9.5,y:4.5,hp:38,atk:12,name:'벙커 지휘관',armor:3}]}
  ];
  const MAP = [
    '111111111111111','111110000011111','100000000000001','100000000000001',
    '100110000011001','100110000011001','100000000000001','100000000000001',
    '101100000001101','100000000000001','100000000000001','100110000011001',
    '100110000011001','100000000000001','100000000000001','111110000011111','111111111111111'
  ];
  const terminal = {x:7.5,y:1.9};
  const STORAGE_KEY = 'deadhand-save-v1';
  let storageAvailable = true;
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!s) return {credits:0,runs:0,cards:[],loadout:[]};
      return {credits:Math.max(0,Number(s.credits)||0),runs:Math.max(0,Number(s.runs)||0),cards:[...new Set((Array.isArray(s.cards)?s.cards:[]).filter(id=>CARDS[id]&&!BASE_DECK.includes(id)))],loadout:[...new Set((Array.isArray(s.loadout)?s.loadout:[]).filter(id=>CARDS[id]&&(s.cards||[]).includes(id)))].slice(0,2)};
    } catch { storageAvailable=false; return {credits:0,runs:0,cards:[],loadout:[]}; }
  }
  let save = loadSave();
  function persist() { try {localStorage.setItem(STORAGE_KEY,JSON.stringify(save));} catch {storageAvailable=false;} }
  const state = {
    mode:'briefing',zone:0,hp:80,shield:0,energy:3,turn:1,loot:0,kills:0,
    hand:['shot','burst','guard','scan','shot'],draw:[],discard:[],runCards:[],selected:-1,
    enemies:[],x:7.5,y:13.5,angle:-1.85,seen:new Set(),rewarded:false,
    shotAt:0,hitAt:0,weaponKick:0,time:0,playing:false
  };
  const keys = new Set();
  const touchPointers = new Map();
  const touchDevice = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
  let aimPointerId=null,pointerStart=null,pointerLast=null,dragged=false;
  document.documentElement.classList.toggle('touch-device',touchDevice);
  function clearInput() {
    keys.clear();touchPointers.clear();aimPointerId=null;pointerStart=pointerLast=null;
    document.querySelectorAll('.touch-controls .pressed').forEach(b=>b.classList.remove('pressed'));
  }
  let messageUntil = 0;
  let activeModal = null;
  let focusBeforeModal = null;
  let queuedHelp = false;
  let soundOn = false;
  let audio = null;
  let lastTimestamp = 0;
  let pendingTimer = null;
  let lastInteraction = false;
  const canvas = $('world'), ctx = canvas.getContext('2d', {alpha:false});
  const mini = $('minimap').getContext('2d');
  let W=1000,H=450,projection=700,horizon=220,depths=[];

  function sound(kind) {
    if (!soundOn) return;
    try {
      audio ||= new (window.AudioContext||window.webkitAudioContext)();
      if(audio.state==='suspended') void audio.resume();
      const o=audio.createOscillator(),g=audio.createGain(),now=audio.currentTime;
      const freq={shot:110,hit:75,guard:420,card:660,win:780,hurt:55,click:300}[kind]||300;
      o.type=kind==='shot'||kind==='hurt'?'sawtooth':'sine';o.frequency.setValueAtTime(freq,now);
      o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.35),now+.15);
      g.gain.setValueAtTime(kind==='shot'?.08:.035,now);g.gain.exponentialRampToValueAtTime(.001,now+.22);
      o.connect(g);g.connect(audio.destination);o.start();o.stop(now+.23);
    } catch {soundOn=false;updateSoundButton();}
  }
  function notify(text, duration=2800) {
    $('scene-message').textContent=text;$('scene-message').classList.add('visible');messageUntil=performance.now()+duration;
  }
  function shuffle(items) {
    const list=[...items];
    for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}
    return list;
  }
  const wall = (x,y) => MAP[Math.floor(y)]?.[Math.floor(x)]!=='0';
  function lineOfSight(x,y) {
    const dx=x-state.x,dy=y-state.y,d=Math.hypot(dx,dy),steps=Math.ceil(d*12);
    for(let i=1;i<steps;i++) if(wall(state.x+dx*i/steps,state.y+dy*i/steps)) return false;
    return true;
  }
  const alive = () => state.enemies.filter(e=>e.hp>0);
  const activeEnemies = () => alive().filter(e=>e.active);
  function isPlaying() {return state.playing && ['explore','combat'].includes(state.mode) && !activeModal;}
  function cardMarkup(id,index,opts={}) {
    const c=CARDS[id];
    const disabled=opts.disabled?'disabled':'';
    return `<button class="card ${c.type} ${state.selected===index&&!opts.reward?'selected':''} ${opts.extraClass||''}" data-card="${id}" ${opts.reward?'data-reward="'+id+'"':'data-index="'+index+'"'} ${disabled} aria-label="${c.name}, 에너지 ${c.cost}, ${c.desc}" ${!opts.reward?'aria-pressed="'+(state.selected===index)+'"':''}>
      <span class="card-top"><span class="card-cost">${c.cost}</span><span class="card-type">${c.label}</span></span>
      <span class="card-art">${icon(c.icon)}</span><span class="card-name">${c.name}</span><span class="card-desc">${c.desc}</span>
      <span class="card-bottom"><span>${opts.reward?'선택':index+1}</span><span>${opts.bottom||c.code}</span></span></button>`;
  }
  function renderHand() {
    const briefing=state.mode==='briefing';
    const scroll=$('hand').scrollLeft;
    $('hand').innerHTML=state.hand.map((id,i)=>cardMarkup(id,i,{disabled:briefing||!state.playing||!['explore','combat'].includes(state.mode)||CARDS[id].cost>state.energy})).join('') || '<div class="card empty">손패 없음</div>';
    $('hand').querySelectorAll('[data-index]').forEach(b=>b.addEventListener('click',()=>chooseCard(Number(b.dataset.index))));
    $('hand-count').textContent=String(state.hand.length).padStart(2,'0');
    $('draw-count').textContent=briefing?'7':state.draw.length;
    $('discard-count').textContent=state.discard.length;
    $('hand-hint').textContent=state.selected>=0?`${CARDS[state.hand[state.selected]].name} 장전됨 · 적을 클릭하거나 F로 사용`:'공격 카드를 선택한 뒤 적을 클릭해 사격';
    $('crosshair').classList.toggle('armed',state.selected>=0);
    $('hand').scrollLeft=scroll;
    if(state.selected>=0)$('hand').querySelector('.selected')?.scrollIntoView({block:'nearest',inline:'nearest'});
    $('touch-fire-btn').disabled=state.selected<0||!isPlaying();
    $('touch-fire-btn').querySelector('small').textContent=state.selected>=0?'조준 후 탭':'카드 선택';
  }
  function renderHUD() {
    $('hp-value').textContent=state.hp;$('hp-bar').style.width=`${state.hp/80*100}%`;
    $('hp-bar').style.background=state.hp<25?'var(--red)':'var(--green)';
    $('shield-value').textContent=state.shield;$('energy-value').textContent=`${state.energy}/3`;
    $('energy-pips').innerHTML=Array.from({length:Math.max(3,state.energy)},(_,i)=>`<i class="${i>=state.energy?'used':''}"></i>`).join('');
    $('turn-number').textContent=String(state.turn).padStart(2,'0');$('loot-value').textContent=state.loot.toLocaleString();
    $('enemy-count').textContent=String(alive().length).padStart(2,'0');
    $('player-state').textContent=({briefing:'출정 대기 중',explore:'구역 탐사 중',combat:'전투 진행 중',reward:'구역 확보',dead:'작전 실패',won:'귀환 완료'})[state.mode]||'구역 탐사 중';
    $('end-turn-btn').disabled=!state.playing||!['explore','combat'].includes(state.mode)||!!activeModal;
    const enemies=activeEnemies();
    const incoming=enemies.reduce((n,e)=>n+e.atk,0);
    $('intent-text').textContent=`턴 종료 시 ${incoming} 피해${state.shield?' · 방어 '+state.shield:''}`;
    $('enemy-intent').classList.toggle('hidden',!enemies.length||!state.playing);
    $('combat-banner').classList.toggle('hidden',state.mode!=='combat');
    $('collection-count').textContent=save.cards.length;
    const cleared=state.playing&&!alive().length;
    $('objective-text').textContent=cleared?'회수 단말로 이동하세요':'구역의 적을 처치하세요';
    $('objective-marker').textContent=cleared?'✓':'◇';
    renderHand();
  }
  function drawCards(count) {
    for(let i=0;i<count;i++) {
      if(state.hand.length>=8){notify('손패는 최대 8장입니다.');break;}
      if(!state.draw.length){state.draw=shuffle(state.discard);state.discard=[];}
      if(!state.draw.length)break;
      state.hand.push(state.draw.pop());
    }
  }
  function prepareDeck(first=false) {
    const deck=[...BASE_DECK,...save.loadout,...state.runCards];
    state.hand=[];state.discard=[];
    if(first){
      const opening=['shot','burst','guard','scan','shot'];
      for(const id of opening){const i=deck.indexOf(id);deck.splice(i,1);}
      state.hand=opening;state.draw=shuffle(deck);
    } else {state.draw=shuffle(deck);drawCards(5);}
    state.selected=-1;
  }
  function startZone(index) {
    state.zone=index;state.mode='explore';state.energy=3;state.shield=0;state.turn=1;
    state.x=7.5;state.y=13.5;state.angle=-Math.PI/2;state.seen.clear();state.rewarded=false;lastInteraction=false;
    state.enemies=ZONES[index].enemies.map((e,i)=>({...e,id:i,maxHp:e.hp,active:false,hitAt:0,deadAt:0}));
    prepareDeck(index===0);
    const zone=ZONES[index];
    $('zone-name').textContent=zone.name;$('zone-description').textContent=zone.description;$('danger-level').textContent=zone.risk;
    $('map-sector').textContent=`SEC.0${index+1}`;
    $('sector-progress').querySelectorAll('span').forEach((s,i)=>{s.classList.toggle('active',i===index);s.classList.toggle('completed',i<index);});
    $('interaction').classList.add('hidden');renderHUD();
    notify(index===0?(touchDevice?'왼쪽 방향 버튼으로 이동 · 화면을 드래그해 조준 · 카드 선택 후 사격 버튼':'WASD로 전진하세요. 마우스를 드래그하거나 ← → 키로 시점을 돌릴 수 있습니다.'):`${zone.name} 진입. 체력은 유지되고 에너지와 덱이 보충됩니다.`,4500);
  }
  function deploy() {
    closeModal();clearTimeout(pendingTimer);clearInput();
    state.playing=true;state.hp=80;state.loot=0;state.kills=0;state.runCards=[];
    $('briefing').classList.add('hidden');$('sector-stamp').classList.add('hidden');
    ['mission-panel','crosshair','minimap-wrap','touch-controls','touch-fire-btn'].forEach(id=>$(id).classList.remove('hidden'));
    startZone(0);sound('card');
  }
  function chooseCard(index) {
    if(!isPlaying())return;
    const id=state.hand[index];if(!id)return;
    const c=CARDS[id];
    if(c.cost>state.energy){notify('에너지가 부족합니다. 턴을 종료하면 3으로 회복됩니다.');return;}
    if(c.type==='attack') {
      state.selected=index;renderHand();sound('click');
      notify(`${c.name} 장전 · 적을 클릭하거나 조준 후 F로 사격하세요.`,2300);
    } else playCard(index);
  }
  function targetInAim() {
    return alive().filter(e=>lineOfSight(e.x,e.y)&&Math.abs(wrap(Math.atan2(e.y-state.y,e.x-state.x)-state.angle))<.28)
      .sort((a,b)=>Math.hypot(a.x-state.x,a.y-state.y)-Math.hypot(b.x-state.x,b.y-state.y))[0];
  }
  function fire(target) {
    if(!isPlaying())return;
    if(state.selected<0){notify('먼저 하단의 공격 카드를 선택하세요. 단축키 1–8로도 선택할 수 있습니다.');return;}
    playCard(state.selected,target||targetInAim());
  }
  function playCard(index,target) {
    const id=state.hand[index],c=CARDS[id];
    if(!c||c.cost>state.energy||!isPlaying())return;
    if(c.type==='attack'&&(!target||target.hp<=0||!lineOfSight(target.x,target.y))){notify('시야에 있는 적을 조준하세요. 공격 카드와 에너지는 소모되지 않습니다.');return;}
    if(c.heal&&state.hp===80){notify('체력이 이미 가득 찼습니다.');return;}
    if(c.surge&&state.hp<=3){notify('과부하를 사용하려면 체력이 4 이상 필요합니다.');return;}
    if(c.draw&&state.hand.length>=8){notify('손패가 가득 찼습니다. 다른 카드를 먼저 사용하세요.');return;}
    state.energy-=c.cost;state.hand.splice(index,1);state.discard.push(id);state.selected=-1;
    if(c.block){state.shield+=c.block;sound('guard');notify(`방어 +${c.block}. 이번 적 턴의 피해를 먼저 흡수합니다.`);}
    if(c.heal){const n=Math.min(c.heal,80-state.hp);state.hp+=n;sound('guard');notify(`응급 처치 · 체력 +${n}`);}
    if(c.draw){drawCards(c.draw);sound('card');notify(`전술 스캔 · 카드 ${c.draw}장 보충`);}
    if(c.surge){state.hp-=3;state.energy++;drawCards(1);sound('card');notify('과부하 · 에너지 +1 / 카드 +1 / 체력 −3');}
    if(c.damage) {
      state.angle=Math.atan2(target.y-state.y,target.x-state.x);
      const victims=c.aoe?alive().filter(e=>lineOfSight(e.x,e.y)&&Math.abs(wrap(Math.atan2(e.y-state.y,e.x-state.x)-state.angle))<Math.atan(W/(projection*2))):[target];
      let kills=0;
      for(const e of victims){
        const damage=Math.max(1,c.damage-(c.pierce?0:e.armor||0));e.hp=Math.max(0,e.hp-damage);e.active=true;e.hitAt=performance.now();e.lastDamage=damage;
        if(!e.hp){e.deadAt=performance.now();state.kills++;state.loot+=30*(state.zone+1);kills++;}
      }
      state.shotAt=performance.now();state.weaponKick=1;sound('shot');
      notify(kills?`대상 제압 · +${30*(state.zone+1)*kills} CR${c.aoe?' / 광역 공격':''}`:`${target.name}에게 ${Math.max(1,c.damage-(c.pierce?0:target.armor||0))} 피해`);
      if(activeEnemies().length)state.mode='combat';
      if(!alive().length) {
        state.mode='reward';state.rewarded=true;state.loot+=ZONES[state.zone].reward;
        pendingTimer=setTimeout(()=>{if(state.mode==='reward'){if(activeModal)queuedHelp=true;else showReward();}},650);
      }
    }
    if(state.mode==='combat'&&!activeEnemies().length)state.mode='explore';
    renderHUD();
  }
  function endTurn() {
    if(!isPlaying())return;
    let incoming=0;
    for(const enemy of activeEnemies()) {
      incoming+=enemy.atk;
      const dx=state.x-enemy.x,dy=state.y-enemy.y,d=Math.hypot(dx,dy);
      if(d>2.1){const nx=enemy.x+dx/d*.65,ny=enemy.y+dy/d*.65;if(!wall(nx,enemy.y))enemy.x=nx;if(!wall(enemy.x,ny))enemy.y=ny;}
    }
    const damage=Math.max(0,incoming-state.shield),blocked=Math.min(state.shield,incoming);
    state.hp=Math.max(0,state.hp-damage);state.shield=0;
    if(damage){state.hitAt=performance.now();$('damage-flash').classList.add('hit');setTimeout(()=>$('damage-flash').classList.remove('hit'),100);sound('hurt');}
    else sound('card');
    if(state.hp<=0){state.mode='dead';state.playing=false;renderHUD();showOutcome(false);return;}
    state.discard.push(...state.hand);state.hand=[];state.energy=3;state.turn++;state.selected=-1;drawCards(5);
    renderHUD();notify(incoming?`적 공격 ${incoming} · 방어 ${blocked} · 받은 피해 ${damage}. 새 손패와 에너지 3 보충.`:'새로운 턴 · 손패 5장과 에너지 3 보충.');
  }

  function showModal(content,wide=false,kind='info') {
    if(!activeModal) focusBeforeModal=document.activeElement;
    activeModal=kind;clearInput();$('modal').className=`modal${wide?' wide':''}`;$('modal').innerHTML=content;$('modal-backdrop').classList.remove('hidden');
    $('modal').focus();$('end-turn-btn').disabled=true;
    $('modal').querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  }
  function closeModal() {
    const kind=activeModal;activeModal=null;$('modal-backdrop').classList.add('hidden');clearInput();
    if(focusBeforeModal?.isConnected)focusBeforeModal.focus({preventScroll:true});
    renderHUD();
    if(queuedHelp&&state.mode==='reward'&&kind!=='reward'){queuedHelp=false;showReward();}
  }
  function showReward() {
    queuedHelp=false;
    const choices=state.zone===0?['pierce','grenade','surge']:shuffle(['pierce','grenade','surge','heal','guard','burst']).slice(0,3);
    showModal(`<div class="eyebrow">SECTOR 0${state.zone+1} / CLEARED</div><h2 id="modal-title">구역 확보. <em>덱을 강화하세요.</em></h2><p class="modal-copy">구역 보상 <b class="orange-text">+${ZONES[state.zone].reward} CR</b>를 확보했습니다.<br>카드 한 장을 선택하면 즉시 이번 탐사의 덱에 추가됩니다.</p><div class="reward-cards">${choices.map((id,i)=>cardMarkup(id,i,{reward:true,bottom:'탐사 덱에 추가'})).join('')}</div><p class="reward-note">현재 전리품 <b>${state.loot} CR</b> · 아직 미확정<br>카드를 고른 뒤 구역 북쪽의 <b>녹색 회수 단말</b>로 이동하세요.</p>`,true,'reward');
    $('modal').querySelectorAll('[data-reward]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.dataset.reward;state.runCards.push(id);state.hand.push(id);state.mode='explore';closeModal();
      notify(`${CARDS[id].name} 획득! W로 북쪽 전진 → 녹색 회수 단말 근처에서 E.`,4500);sound('win');
    }));
  }
  function interact() {
    if(!isPlaying())return;
    if(alive().length){notify('적이 남아 있습니다. 구역을 확보해야 회수 단말이 열립니다.');return;}
    if(Math.hypot(state.x-terminal.x,state.y-terminal.y)>2.15){notify('북쪽의 녹색 회수 단말로 이동하세요. 미니맵의 녹색 지점입니다.');return;}
    const final=state.zone===2,next=ZONES[state.zone+1];
    showModal(`<div class="eyebrow">EXTRACTION TERMINAL / CONNECTED</div><h2 id="modal-title">${final?'마지막 출구.':'챙길 것인가. <em>더 들어갈 것인가.</em>'}</h2><p class="modal-copy">${final?'모든 구역을 돌파했습니다. 확보한 전리품을 가지고 귀환하세요.':'지금 철수하면 전리품과 발견한 카드를 보관함에 확보합니다.<br>다음 구역에 진입하면 체력은 유지됩니다. 실패하면 이번 전리품을 모두 잃습니다.'}</p><div class="modal-stat-row"><div><small>미확정 전리품</small><strong>${state.loot} <em>CR</em></strong></div><div><small>현재 체력</small><strong>${state.hp}<em> / 80</em></strong></div><div><small>발견한 카드</small><strong>${state.runCards.length}<em> 장</em></strong></div></div>${!final?`<div class="next-zone"><div><small>다음 목적지 / 위험도 상승</small><strong>0${state.zone+2} ${next.name}</strong></div><span>${next.enemies.length} HOSTILES<br>+${next.reward} CR</span></div>`:''}<div class="modal-buttons"><button id="extract-btn" class="primary-btn">${icon('exit')} ${state.loot} CR 확보하고 귀환</button>${!final?'<button id="descend-btn" class="secondary-btn">다음 구역 진입 →</button>':''}</div><button class="modal-close" data-close aria-label="단말 닫기">×</button>`,false,'terminal');
    $('extract-btn').addEventListener('click',extract);
    $('descend-btn')?.addEventListener('click',()=>{closeModal();startZone(state.zone+1);sound('card');});
  }
  function extract() {
    save.credits+=state.loot;save.runs++;
    for(const id of state.runCards)if(!BASE_DECK.includes(id)&&!save.cards.includes(id))save.cards.push(id);
    persist();state.mode='won';state.playing=false;renderHUD();sound('win');showOutcome(true);
  }
  function showOutcome(success) {
    showModal(`<div class="ending-symbol ${success?'':'fail'}">${icon(success?'exit':'crosshair')}</div><div class="eyebrow">OPERATION BLACKOUT / ${success?'EXTRACTED':'SIGNAL LOST'}</div><h2 id="modal-title">${success?'무사 귀환. <em>전리품 확보.</em>':'작전 실패. <em>신호가 끊겼습니다.</em>'}</h2><p class="modal-copy">${success?'이번 탐사에서 확보한 전리품이 보관함에 저장되었습니다.':'이번 탐사의 미확정 전리품과 카드를 잃었습니다.<br>기본 덱과 이전에 회수한 카드는 안전하게 보존됩니다.'}</p><div class="modal-stat-row"><div><small>${success?'회수':'손실'} 전리품</small><strong>${state.loot} <em>CR</em></strong></div><div><small>적 제압</small><strong>${state.kills}</strong></div><div><small>돌파 구역</small><strong>${state.zone+(state.rewarded?1:0)}<em> / 3</em></strong></div></div><div class="outcome-list">${success?`회수 카드: ${state.runCards.map(id=>CARDS[id].name).join(', ')||'없음'}<br>누적 회수: ${save.credits.toLocaleString()} CR · 귀환 ${save.runs}회${storageAvailable?'':'<br>이 브라우저에서 저장소를 사용할 수 없어 이번 창에서만 보존됩니다.'}`:`보관함 잔액: ${save.credits.toLocaleString()} CR<br>방어 카드로 피해를 줄이고, 에너지를 모두 활용한 뒤 턴을 종료하세요.`}</div><div class="modal-buttons"><button id="replay-btn" class="primary-btn">다시 출정 ${icon('arrow')}</button><button id="home-btn" class="secondary-btn">작전 준비로</button></div>`,false,'outcome');
    $('replay-btn').addEventListener('click',deploy);$('home-btn').addEventListener('click',goHome);
  }
  function goHome() {
    closeModal();clearTimeout(pendingTimer);queuedHelp=false;
    state.playing=false;state.mode='briefing';state.zone=0;state.hp=80;state.energy=3;state.shield=0;state.turn=1;state.loot=0;state.hand=['shot','burst','guard','scan','shot'];state.discard=[];state.selected=-1;
    state.x=7.5;state.y=13.5;state.angle=-1.85;state.enemies=ZONES[0].enemies.map((e,i)=>({...e,id:i,maxHp:e.hp,active:false}));
    $('briefing').classList.remove('hidden');$('sector-stamp').classList.remove('hidden');
    ['mission-panel','crosshair','minimap-wrap','enemy-intent','combat-banner','interaction','touch-controls','touch-fire-btn'].forEach(id=>$(id).classList.add('hidden'));
    $('sector-progress').querySelectorAll('span').forEach((s,i)=>{s.classList.toggle('active',i===0);s.classList.remove('completed');});
    $('target-label').textContent='';renderHUD();
  }
  function showGuide() {
    if(activeModal&&['reward','outcome'].includes(activeModal))return;
    showModal(`<button class="modal-close" data-close aria-label="가이드 닫기">×</button><div class="eyebrow">FIELD MANUAL / 01</div><h2 id="modal-title">모든 판단은 <em>당신의 손에.</em></h2><p class="modal-copy">탐사는 1인칭, 전투는 턴제입니다. 서두를 필요 없이 다음 한 수를 고르세요.</p><div class="guide-grid"><div class="guide-item"><b>01 / 이동과 조준</b><p><span class="key">W A S D</span> 이동, <span class="key">← →</span> 또는 화면 드래그로 회전합니다. 모바일에서는 왼쪽 방향 버튼을 누른 채 다른 손으로 화면을 드래그해 조준할 수 있습니다.</p></div><div class="guide-item"><b>02 / 카드를 장전하세요</b><p>하단 카드 클릭 또는 <span class="key">1–8</span>로 선택. 공격 카드는 적을 클릭하거나 조준 후 <span class="key">F</span>로 사용합니다. 모바일은 공격 카드 선택 후 오른쪽 사격 버튼을 누르세요. 방어·전술 카드는 즉시 사용됩니다.</p></div><div class="guide-item"><b>03 / 턴을 계획하세요</b><p>기본 에너지는 3. <span class="key">SPACE</span>로 턴을 끝내면 활성화된 적이 공격합니다. 남은 손패를 버리고 새 카드 5장과 에너지 3을 받습니다. 방어는 이번 턴만 유지됩니다.</p></div><div class="guide-item"><b>04 / 귀환해야 당신의 것</b><p>적을 모두 처치하고 보상 카드를 선택하세요. 북쪽 녹색 단말 근처에서 <span class="key">E</span>를 누르면 철수 또는 다음 구역 진입을 결정합니다.</p></div></div><div class="guide-note">적은 빨간 경고가 표시된 뒤 턴 종료 시 공격합니다. 뽑기 더미가 비면 버린 카드를 섞어 다시 사용합니다. 실패 시 이번 전리품만 잃습니다.</div><div class="modal-buttons"><button class="primary-btn" data-close>확인 · ${state.playing?'작전 복귀':'준비 완료'} ${icon('arrow')}</button></div>`,true,'guide');
  }
  function showCollection() {
    if(activeModal&&['reward','outcome'].includes(activeModal))return;
    const content=`<button class="modal-close" data-close aria-label="보관함 닫기">×</button><div class="eyebrow">PERSONAL STASH / PERSISTENT</div><h2 id="modal-title">카드 <em>보관함.</em></h2><div class="collection-summary"><span>누적 회수 <b>${save.credits.toLocaleString()} CR</b></span><span>귀환 <b>${save.runs}회</b></span><span>추가 장착 <b>${save.loadout.length}/2</b></span></div><div class="collection-grid">${Object.keys(CARDS).map((id,i)=>{
      const base=BASE_DECK.includes(id),owned=base||save.cards.includes(id),equipped=save.loadout.includes(id);
      return cardMarkup(id,i,{reward:true,extraClass:!owned?'locked':equipped?'equipped':'',bottom:base?'기본 덱':!owned?'탐사 후 귀환 시 해금':equipped?'✓ 다음 출정 장착':'클릭하여 장착',disabled:!owned||base||state.playing});
    }).join('')}</div><p class="loadout-note">기본 덱 12장은 항상 유지됩니다. 회수한 희귀 카드는 최대 2장까지 추가 장착할 수 있습니다.<br>${state.playing?'현재 출정 중입니다. 장착 변경은 작전 준비 화면에서 가능합니다.':'주황색 테두리는 다음 출정에 가져갈 카드입니다. 클릭하면 장착을 해제합니다.'}<br>전리품과 해금 카드는 ${storageAvailable?'이 브라우저에 자동 저장됩니다.':'현재 창에서만 보존됩니다. 브라우저 저장소가 비활성화되어 있습니다.'}</p>`;
    showModal(content,true,'collection');
    $('modal').querySelectorAll('[data-reward]:not(:disabled)').forEach(b=>b.addEventListener('click',()=>{
      const id=b.dataset.reward;
      if(save.loadout.includes(id))save.loadout=save.loadout.filter(c=>c!==id);
      else if(save.loadout.length<2)save.loadout.push(id);
      else {const note=$('modal').querySelector('.loadout-note');note.textContent='최대 2장까지 장착할 수 있습니다. 장착 중인 카드를 먼저 해제하세요.';return;}
      persist();sound('click');showCollection();
    }));
  }
  function showPile(discard=false) {
    if(!state.playing||activeModal)return;
    const pile=discard?state.discard:state.draw,counts={};pile.forEach(id=>counts[id]=(counts[id]||0)+1);
    showModal(`<button class="modal-close" data-close aria-label="카드 목록 닫기">×</button><div class="eyebrow">DECK INSPECTION</div><h2 id="modal-title">${discard?'버린 카드':'뽑기 더미'} <em>${pile.length}장</em></h2><p class="modal-copy">${discard?'뽑기 더미가 비면 이 카드들을 섞어서 다시 사용합니다.':'포함된 카드 목록입니다. 뽑히는 순서는 공개되지 않습니다.'}</p><div class="pile-list">${Object.entries(counts).map(([id,n])=>`<div class="pile-item"><b>${CARDS[id].cost}</b>${CARDS[id].name}<small>× ${n}</small></div>`).join('')||'<p class="modal-copy">카드가 없습니다.</p>'}</div><div class="modal-buttons"><button class="secondary-btn" data-close>작전 복귀</button></div>`,false,'pile');
  }

  // Procedural sprites: painted once, then projected into the raycast world.
  function makeSprite(drone=false) {
    const c=document.createElement('canvas');c.width=160;c.height=220;const p=c.getContext('2d');
    const poly=(points,fill,stroke)=>{p.beginPath();points.forEach(([x,y],i)=>i?p.lineTo(x,y):p.moveTo(x,y));p.closePath();p.fillStyle=fill;p.fill();if(stroke){p.strokeStyle=stroke;p.lineWidth=1.5;p.stroke();}};
    p.shadowColor='#000';p.shadowBlur=12;p.fillStyle='#0007';p.beginPath();p.ellipse(80,208,48,7,0,0,Math.PI*2);p.fill();p.shadowBlur=0;
    if(drone) {
      poly([[25,70],[55,48],[108,48],[139,70],[123,104],[38,104]],'#46534c','#9aa28a');
      poly([[55,53],[80,38],[108,53],[104,98],[57,98]],'#293732','#7c8977');
      p.fillStyle='#141e1c';p.fillRect(64,61,33,25);p.shadowBlur=15;p.shadowColor='#fc6947';p.fillStyle='#fa7652';p.fillRect(67,70,26,5);p.shadowBlur=0;
      poly([[36,86],[18,124],[36,128],[54,93]],'#38453e','#73816e');poly([[122,86],[142,124],[123,128],[108,93]],'#38453e','#73816e');
      p.fillStyle='#8ca48d';p.fillRect(30,114,10,6);p.fillRect(121,114,10,6);p.fillStyle='#24322d';p.fillRect(69,98,22,25);p.fillStyle='#d38e58';p.fillRect(74,121,12,8);
      p.strokeStyle='#9cc6b44d';p.lineWidth=3;p.beginPath();p.ellipse(29,69,24,5,0,0,Math.PI*2);p.stroke();p.beginPath();p.ellipse(129,69,24,5,0,0,Math.PI*2);p.stroke();
    } else {
      poly([[52,133],[77,132],[75,191],[63,207],[45,207],[49,185]],'#303e36','#64705b');
      poly([[83,132],[107,133],[113,185],[120,206],[98,208],[88,190]],'#26342d','#637359');
      poly([[52,146],[73,146],[69,169],[51,169]],'#4d5947');poly([[89,146],[108,146],[111,169],[92,169]],'#45523f');
      p.fillStyle='#18231e';p.fillRect(43,201,24,11);p.fillRect(99,201,25,11);
      poly([[44,66],[65,52],[98,52],[118,68],[111,126],[100,145],[59,145],[47,125]],'#53604d','#899276');
      poly([[59,69],[99,69],[104,110],[91,130],[65,130],[55,108]],'#344635','#84916d');
      p.strokeStyle='#a6ac84';p.lineWidth=2;p.beginPath();p.moveTo(61,75);p.lineTo(96,75);p.moveTo(65,116);p.lineTo(93,116);p.stroke();
      p.fillStyle='#74805a';for(let i=0;i<4;i++)p.fillRect(60+i*10,92,7,15);
      poly([[40,66],[52,70],[49,109],[34,130],[21,117],[27,79]],'#384c3c','#7a8a6a');
      poly([[111,66],[125,72],[140,108],[130,125],[115,112],[105,83]],'#46573f','#899477');
      poly([[24,111],[34,110],[60,123],[55,135],[34,132],[19,122]],'#354936','#77896c');
      poly([[130,110],[137,122],[99,137],[84,129],[89,119]],'#36452f','#87906f');
      poly([[61,122],[111,109],[145,112],[147,120],[108,127],[79,142],[68,138]],'#17201d','#697566');
      p.fillStyle='#d48e5b';p.fillRect(136,112,9,3);p.fillStyle='#080e0b';p.fillRect(73,134,9,17);p.fillStyle='#6d775f';p.fillRect(101,106,12,5);
      poly([[57,24],[69,15],[93,16],[106,30],[103,57],[94,68],[68,67],[55,51]],'#384b3c','#8b987e');
      poly([[57,24],[64,12],[95,13],[106,29],[103,35],[58,35]],'#64725a','#9da58b');
      p.fillStyle='#101c17';p.fillRect(58,36,47,16);p.shadowColor='#fb784e';p.shadowBlur=12;p.fillStyle='#f58454';p.fillRect(62,40,37,5);p.shadowBlur=0;
      poly([[65,53],[96,53],[92,65],[72,65]],'#26382a','#697d59');
      p.fillStyle='#c3bc8b';p.fillRect(44,72,6,9);p.fillStyle='#ed8353';p.fillRect(110,73,8,5);
    }
    return c;
  }
  const soldierSprite=makeSprite(),droneSprite=makeSprite(true);
  function resize() {
    const r=canvas.getBoundingClientRect();W=Math.max(1,Math.round(r.width));H=Math.max(1,Math.round(r.height));canvas.width=W;canvas.height=H;
    projection=Math.min(touchDevice&&W<600?Math.max(W*.73,H*.8):W*.73,H*1.85);horizon=H*.46;depths=new Float32Array(Math.ceil(W/3)+2);
  }
  new ResizeObserver(resize).observe(canvas);

  function raycast() {
    const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#0b1413');sky.addColorStop(.44,'#2f4139');sky.addColorStop(.5,'#263b31');sky.addColorStop(1,'#121c18');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    const floor=ctx.createLinearGradient(0,horizon,0,H);floor.addColorStop(0,'#344438');floor.addColorStop(.3,'#29392e');floor.addColorStop(1,'#1b2822');ctx.fillStyle=floor;ctx.fillRect(0,horizon,W,H-horizon);
    // Project floor seams and ceiling beams in world space, so they follow the camera.
    const fx=Math.cos(state.angle),fy=Math.sin(state.angle),rx=-fy,ry=fx;
    function projectFloor(x,y,height=0){const dx=x-state.x,dy=y-state.y,d=dx*fx+dy*fy;if(d<.06)return null;return {x:W/2+(dx*rx+dy*ry)*projection/d,y:horizon+(.5-height)*projection/d,d};}
    ctx.lineWidth=1;
    ctx.strokeStyle='rgba(141,159,126,.065)';
    for(let grid=0;grid<=17;grid++) {
      for(let axis=0;axis<2;axis++) {
        let last=null;
        ctx.beginPath();
        for(let n=0;n<=34;n++) {
          const x=axis?n*.5:grid,y=axis?grid:n*.5;
          const pt=projectFloor(x,y);
          if(pt&&last&&pt.d<17&&last.d<17){ctx.moveTo(last.x,last.y);ctx.lineTo(pt.x,pt.y);}
          last=pt;
        }
        ctx.stroke();
      }
    }
    for(let z=2;z<=14;z+=4){
      const a=projectFloor(5.1,z,1),b=projectFloor(9.9,z,1);
      if(a&&b){ctx.strokeStyle='#a7bf8955';ctx.lineWidth=Math.max(1,projection/a.d*.025);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.strokeStyle='#c7d3aa44';ctx.lineWidth=Math.max(1,projection/a.d*.008);ctx.beginPath();ctx.moveTo(a.x,a.y+4);ctx.lineTo(b.x,b.y+4);ctx.stroke();}
    }
    const tanHalf=W/(2*projection);
    for(let px=0,ri=0;px<W;px+=3,ri++) {
      const cam=(2*px/W-1)*tanHalf,dx=fx+rx*cam,dy=fy+ry*cam;
      let mx=Math.floor(state.x),my=Math.floor(state.y);
      const ddx=Math.abs(1/(dx||.00001)),ddy=Math.abs(1/(dy||.00001)),sx=dx<0?-1:1,sy=dy<0?-1:1;
      let tx=(dx<0?state.x-mx:mx+1-state.x)*ddx,ty=(dy<0?state.y-my:my+1-state.y)*ddy,side=0,steps=0;
      while(steps++<48){if(tx<ty){tx+=ddx;mx+=sx;side=0;}else{ty+=ddy;my+=sy;side=1;}if(MAP[my]?.[mx]!=='0')break;}
      const d=Math.max(.04,side?ty-ddy:tx-ddx);depths[ri]=d;
      const size=projection/d,top=horizon-size*.5,bottom=horizon+size*.5;
      const hit=side?state.x+d*dx:state.y+d*dy,u=hit-Math.floor(hit);
      const base=side?66:79,fog=Math.min(.92,d/22),light=(1-fog)*(u<.018||u>.982?.64:1);
      const strip=mx===0||mx===14;
      const green=base*(strip?1.02:1.11)*light,red=base*.81*light,blue=base*.85*light;
      ctx.fillStyle=`rgb(${red+7},${green+10},${blue+9})`;ctx.fillRect(px,top,3.5,size);
      // Concrete panels, recessed baseboard, utilitarian orange safety band.
      ctx.fillStyle=`rgba(12,23,18,${.4*(1-fog)})`;ctx.fillRect(px,top+size*.21,3.5,Math.max(1,size*.009));ctx.fillRect(px,top+size*.7,3.5,Math.max(1,size*.012));
      ctx.fillStyle=`rgba(4,13,9,${.52*(1-fog)})`;ctx.fillRect(px,bottom-size*.09,3.5,size*.09);
      if((my===4||my===5||my===11||my===12||mx===0||mx===14)&&u>.08&&u<.92){ctx.fillStyle=`rgba(179,130,70,${.45*(1-fog)})`;ctx.fillRect(px,top+size*.61,3.5,size*.045);}
      if(u>.08&&u<.12){ctx.fillStyle=`rgba(135,151,119,${.2*(1-fog)})`;ctx.fillRect(px,top+size*.24,3.5,size*.4);}
    }
    // Extraction beacon, visible through the central aisle but occluded by walls.
    drawTerminal(fx,fy,rx,ry);
    const ordered=state.enemies.filter(e=>e.hp>0||performance.now()-e.deadAt<500).sort((a,b)=>Math.hypot(b.x-state.x,b.y-state.y)-Math.hypot(a.x-state.x,a.y-state.y));
    for(const e of ordered)drawEnemy(e,fx,fy,rx,ry);
    // Fine drifting dust, filmic vignette, and the player's weapon.
    ctx.fillStyle='#dce1bb33';for(let i=0;i<26;i++){const x=(i*137.3+Math.sin(state.time*.12+i)*25)%W,y=(i*61.7+state.time*(i%3+1)*1.8)%H;ctx.fillRect(x,y,1,1);}
    const vignette=ctx.createRadialGradient(W*.53,H*.45,H*.1,W*.5,H*.5,Math.max(W*.66,H*.8));vignette.addColorStop(0,'#020a0300');vignette.addColorStop(.6,'#020a0329');vignette.addColorStop(1,'#020a03c2');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
    if(state.mode==='briefing'){const fade=ctx.createLinearGradient(0,0,W,0);fade.addColorStop(0,'#0d1714f2');fade.addColorStop(.4,'#0d1714b8');fade.addColorStop(.8,'#0d171400');ctx.fillStyle=fade;ctx.fillRect(0,0,W,H);}
    drawWeapon();
  }
  function drawTerminal(fx,fy,rx,ry) {
    const dx=terminal.x-state.x,dy=terminal.y-state.y,d=dx*fx+dy*fy;if(d<.1)return;
    const x=W/2+(dx*rx+dy*ry)*projection/d,s=projection/d,left=x-s*.28,top=horizon-s*.37;
    if(x<-s||x>W+s)return;
    const blocked=depths[clamp(Math.floor(x/3),0,depths.length-1)]<d-.4;if(blocked)return;
    const ready=state.playing&&!alive().length;
    ctx.fillStyle='#0c1c15';ctx.fillRect(left,top,s*.56,s*.88);ctx.strokeStyle=ready?'#b9db99':'#65785d';ctx.lineWidth=Math.max(1,s*.01);ctx.strokeRect(left,top,s*.56,s*.88);
    ctx.fillStyle=ready?'#668c56':'#43593e';ctx.fillRect(left+s*.07,top+s*.07,s*.42,s*.5);
    ctx.fillStyle=ready?'#def5bb':'#8fa27d';ctx.font=`bold ${Math.max(7,s*.085)}px monospace`;ctx.textAlign='center';ctx.fillText(ready?'EXTRACT':'LOCKED',x,top+s*.29);ctx.font=`${Math.max(5,s*.045)}px monospace`;ctx.fillText(ready?'[ E ] CONNECT':'CLEAR SECTOR',x,top+s*.43);
    ctx.fillStyle='#b1c78d';ctx.fillRect(left+s*.08,top+s*.68,s*.13,s*.025);
    if(ready){ctx.shadowColor='#b1da83';ctx.shadowBlur=Math.min(25,s*.2);ctx.fillStyle='#badc8b';ctx.fillRect(left,top-s*.1,s*.56,s*.04);ctx.shadowBlur=0;}
    ctx.textAlign='left';
  }
  function drawEnemy(e,fx,fy,rx,ry) {
    e.screen=null;
    const dx=e.x-state.x,dy=e.y-state.y,d=dx*fx+dy*fy;if(d<.15)return;
    const now=performance.now(),fall=e.hp<=0?clamp((now-e.deadAt)/450,0,1):0;
    const x=W/2+(dx*rx+dy*ry)*projection/d,scale=projection/d*1.02,sw=scale*160/220;
    const bob=e.drone?Math.sin(state.time*2+e.id)*scale*.035:0;
    const top=horizon+projection*.5/d-scale+bob+fall*scale*.65,left=x-sw/2;
    e.screen={x,left,top,width:sw,height:scale,depth:d};
    if(left>W||left+sw<0)return;
    const sprite=e.drone?droneSprite:soldierSprite;
    ctx.globalAlpha=(1-fall)*clamp(1-d/30,.3,1);
    for(let px=Math.max(0,Math.floor(left/3)*3);px<Math.min(W,left+sw);px+=3){
      const ri=Math.floor(px/3);if(depths[ri]<d-.2)continue;
      const sourceX=clamp((px-left)/sw*160,0,159);ctx.drawImage(sprite,sourceX,0,Math.min(160-sourceX,3/sw*160),220,px,top,3.5,scale*(1-fall*.7));
    }
    ctx.globalAlpha=1;
    if(e.hp<=0||!state.playing||!lineOfSight(e.x,e.y))return;
    if(e.active||Math.abs(wrap(Math.atan2(dy,dx)-state.angle))<.2){
      const barW=clamp(sw*.85,38,90),barY=top-10;
      ctx.fillStyle='#0b1713d9';ctx.fillRect(x-barW/2-4,barY-19,barW+8,27);
      ctx.fillStyle='#c1c7ac';ctx.font=`${clamp(scale*.055,8,11)}px Arial`;ctx.textAlign='center';ctx.fillText(`${e.name}${e.armor?' ◈'+e.armor:''}`,x,barY-7);
      ctx.fillStyle='#54392c';ctx.fillRect(x-barW/2,barY,barW,3);ctx.fillStyle='#e7915f';ctx.fillRect(x-barW/2,barY,barW*e.hp/e.maxHp,3);
      if(e.active){ctx.fillStyle='#edac7d';ctx.font='9px monospace';ctx.fillText(`↘ ${e.atk} DMG`,x,barY+18);}
      if(now-e.hitAt<650){ctx.fillStyle='#ffb38d';ctx.font='bold 20px monospace';ctx.fillText(`−${e.lastDamage}`,x+sw*.6,top+scale*.3-(now-e.hitAt)/25);}
      ctx.textAlign='left';
    }
  }
  function drawWeapon() {
    const now=performance.now(),kick=state.weaponKick;
    const mobile=W<600,scale=Math.min(W/1100,H/430)*(mobile?1.1:1),baseX=W*(state.mode==='briefing'?.77:.69),baseY=H+18;
    ctx.save();ctx.translate(baseX+Math.sin(state.time*1.8)*2,baseY+kick*24);ctx.scale(scale,scale);
    const poly=(pts,fill,stroke)=>{ctx.beginPath();pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.lineWidth=1.5;ctx.strokeStyle=stroke;ctx.stroke();}};
    // Sleeve, glove, and a hard-surface weapon with a holographic sight.
    poly([[26,-11],[74,-95],[122,-87],[209,5]],'#354234','#6d7659');
    poly([[170,0],[115,-81],[99,-129],[122,-151],[153,-123],[169,-76],[241,0]],'#2a372c','#56644e');
    poly([[49,0],[53,-84],[74,-119],[97,-121],[117,-73],[118,0]],'#141f19','#5b6c52');
    poly([[39,-84],[55,-144],[84,-142],[104,-109],[88,-69]],'#26352a','#6a795d');
    poly([[73,-120],[40,-179],[-22,-239],[-27,-256],[-10,-273],[8,-269],[82,-216],[170,-159],[183,-111],[148,-83]],'#1b2723','#637665');
    poly([[-22,-239],[-27,-256],[-10,-273],[6,-268],[16,-247],[-1,-233]],'#405446','#7f9380');
    poly([[15,-239],[47,-220],[116,-185],[133,-149],[83,-173]],'#53604b','#8c987b');
    poly([[41,-206],[89,-181],[115,-143],[85,-150],[48,-179]],'#22382a','#768b68');
    poly([[89,-139],[142,-126],[151,-92],[118,-93]],'#101c16','#566b52');
    poly([[54,-166],[92,-150],[96,-135],[62,-146]],'#647151','#909775');
    ctx.fillStyle='#111c16';for(let i=0;i<4;i++)ctx.fillRect(53+i*8,-189+i*5,4,12);
    poly([[4,-251],[21,-261],[66,-227],[50,-215]],'#12231b','#758e72');
    poly([[17,-260],[17,-289],[41,-281],[51,-237],[38,-241],[33,-269],[26,-273],[26,-252]],'#0b1712','#859a7d');
    ctx.fillStyle='#b8d28b';ctx.fillRect(25,-267,2,3);ctx.fillStyle='#f08a4e';ctx.fillRect(103,-156,26,4);
    ctx.fillStyle='#b5c0a0';ctx.font='7px monospace';ctx.save();ctx.translate(110,-136);ctx.rotate(.3);ctx.fillText('DH / 07',0,0);ctx.restore();
    if(now-state.shotAt<100){
      ctx.shadowColor='#ffd38a';ctx.shadowBlur=45;poly([[-25,-267],[-55,-291],[-31,-288],[-28,-323],[-14,-293],[5,-311],[1,-280],[22,-271],[-3,-263]],'#ffd59a');ctx.shadowBlur=0;
    }
    ctx.restore();
    if(now-state.shotAt<100){ctx.strokeStyle='#ffdca377';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(baseX-15*scale,baseY-270*scale);ctx.lineTo(W/2,horizon);ctx.stroke();}
  }
  function drawMinimap() {
    const mw=150,mh=170,cell=9;mini.fillStyle='#121e17';mini.fillRect(0,0,mw,mh);
    for(let y=0;y<MAP.length;y++)for(let x=0;x<MAP[y].length;x++) {
      const known=state.seen.has(`${x},${y}`),isWall=MAP[y][x]==='1';
      mini.fillStyle=isWall?(known?'#526348':'#26362a'):(known?'#334b36':'#17291e');mini.fillRect(7+x*cell,8+y*cell,cell-1,cell-1);
    }
    mini.fillStyle=!alive().length?'#c0e39c':'#6f875c';mini.fillRect(7+terminal.x*cell-3,8+terminal.y*cell-3,6,6);
    for(const e of alive())if(state.seen.has(`${Math.floor(e.x)},${Math.floor(e.y)}`)){mini.fillStyle='#f09660';mini.beginPath();mini.arc(7+e.x*cell,8+e.y*cell,2.7,0,Math.PI*2);mini.fill();}
    mini.save();mini.translate(7+state.x*cell,8+state.y*cell);mini.rotate(state.angle);mini.fillStyle='#e6efd1';mini.beginPath();mini.moveTo(5,0);mini.lineTo(-3,-3);mini.lineTo(-1,0);mini.lineTo(-3,3);mini.closePath();mini.fill();mini.restore();
  }
  function update(dt) {
    state.time+=dt;state.weaponKick=Math.max(0,state.weaponKick-dt*5);
    if(performance.now()>messageUntil)$('scene-message').classList.remove('visible');
    if(!isPlaying())return;
    const speed=2.35*dt;
    if(keys.has('arrowleft'))state.angle-=dt*1.9;if(keys.has('arrowright'))state.angle+=dt*1.9;
    const forward=(keys.has('w')||keys.has('arrowup')?1:0)-(keys.has('s')||keys.has('arrowdown')?1:0),strafe=(keys.has('d')?1:0)-(keys.has('a')?1:0),norm=Math.max(1,Math.hypot(forward,strafe));
    const dx=(Math.cos(state.angle)*forward-Math.sin(state.angle)*strafe)*speed/norm,dy=(Math.sin(state.angle)*forward+Math.cos(state.angle)*strafe)*speed/norm;
    const canStand=(x,y)=>![[.19,.19],[-.19,.19],[.19,-.19],[-.19,-.19]].some(([ox,oy])=>wall(x+ox,y+oy));
    if(canStand(state.x+dx,state.y))state.x+=dx;if(canStand(state.x,state.y+dy))state.y+=dy;
    for(let y=Math.max(0,Math.floor(state.y)-4);y<Math.min(17,Math.ceil(state.y)+4);y++)for(let x=Math.max(0,Math.floor(state.x)-4);x<Math.min(15,Math.ceil(state.x)+4);x++)state.seen.add(`${x},${y}`);
    let newlyActive=false;
    for(const e of alive())if(!e.active&&Math.hypot(e.x-state.x,e.y-state.y)<5.8&&lineOfSight(e.x,e.y)){e.active=true;newlyActive=true;}
    if(newlyActive){state.mode='combat';renderHUD();notify('전투 접촉! 공격 카드 선택 → 적 클릭. 적은 턴 종료 후 공격합니다.',4500);sound('click');}
    const interactReady=!alive().length&&Math.hypot(state.x-terminal.x,state.y-terminal.y)<2.15;
    if(interactReady!==lastInteraction){lastInteraction=interactReady;$('interaction').classList.toggle('hidden',!interactReady);}
    const target=targetInAim();
    $('target-label').textContent=target?`${target.name} · ${target.hp}/${target.maxHp} HP${target.armor?' · 장갑 '+target.armor:''}`:'';
    const heading=((state.angle*180/Math.PI+90)%360+360)%360;
    $('heading').textContent=`${Math.round(heading).toString().padStart(3,'0')}°`;
    drawMinimap();
  }
  function frame(timestamp) {
    if(document.hidden){lastTimestamp=timestamp;requestAnimationFrame(frame);return;}
    if(timestamp-lastTimestamp<(touchDevice?1000/30:1000/60)-1){requestAnimationFrame(frame);return;}
    const dt=Math.min(.05,(timestamp-lastTimestamp)/1000||0);lastTimestamp=timestamp;update(dt);raycast();requestAnimationFrame(frame);
  }
  // Input remains inside the page: no pointer lock or browser permission is required.
  canvas.addEventListener('pointerdown',e=>{
    if(!isPlaying()||aimPointerId!==null)return;
    aimPointerId=e.pointerId;
    canvas.setPointerCapture(e.pointerId);pointerStart={x:e.clientX,y:e.clientY};pointerLast={x:e.clientX,y:e.clientY};dragged=false;
  });
  canvas.addEventListener('pointermove',e=>{
    if(e.pointerId!==aimPointerId||!pointerLast||!isPlaying())return;
    if(Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5)dragged=true;
    if(dragged)state.angle+=(e.clientX-pointerLast.x)*.005;
    pointerLast={x:e.clientX,y:e.clientY};
  });
  canvas.addEventListener('pointerup',e=>{
    if(e.pointerId!==aimPointerId||!pointerStart)return;
    if(!dragged&&isPlaying()) {
      const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      const clicked=alive().filter(enemy=>{
        const s=enemy.screen;return s&&s.depth>.15&&lineOfSight(enemy.x,enemy.y)&&x>s.left-15&&x<s.left+s.width+15&&y>s.top-12&&y<s.top+s.height;
      }).sort((a,b)=>a.screen.depth-b.screen.depth)[0];
      if(clicked)fire(clicked);
      else if(!alive().length&&Math.hypot(state.x-terminal.x,state.y-terminal.y)<2.15)interact();
      else fire();
    }
    aimPointerId=null;pointerStart=pointerLast=null;
  });
  for(const event of ['pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{
    if(e.pointerId===aimPointerId){aimPointerId=null;pointerStart=pointerLast=null;}
  });
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('keydown',e=>{
    const k=e.key.toLowerCase();
    if(activeModal) {
      if(k==='escape'&&!['reward','outcome'].includes(activeModal)){e.preventDefault();closeModal();}
      if(k==='tab'){
        const focusables=[...$('modal').querySelectorAll('button:not(:disabled),[href],[tabindex="0"]')];
        const first=focusables[0],last=focusables.at(-1);
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===$('modal'))){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===$('modal'))){e.preventDefault();first?.focus();}
      }
      return;
    }
    if(!state.playing)return;
    const onButton=document.activeElement?.tagName==='BUTTON';
    if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();
    if(k==='escape'){showGuide();return;}
    if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k))keys.add(k);
    if(e.repeat)return;
    if(/^[1-8]$/.test(k)){e.preventDefault();chooseCard(Number(k)-1);}
    if(k===' '){if(onButton)document.activeElement.blur();endTurn();}
    if(k==='f')fire();if(k==='e')interact();
  });
  document.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur',clearInput);
  window.addEventListener('orientationchange',clearInput);
  document.addEventListener('visibilitychange',clearInput);
  $('touch-controls').querySelectorAll('button').forEach(b=>{
    b.addEventListener('pointerdown',e=>{
      if(!isPlaying())return;e.preventDefault();b.setPointerCapture(e.pointerId);
      touchPointers.set(e.pointerId,b.dataset.key);keys.add(b.dataset.key);b.classList.add('pressed');
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,e=>{
      touchPointers.delete(e.pointerId);
      if(![...touchPointers.values()].includes(b.dataset.key)){keys.delete(b.dataset.key);b.classList.remove('pressed');}
    });
    b.addEventListener('contextmenu',e=>e.preventDefault());
  });
  $('touch-fire-btn').addEventListener('click',()=>fire());
  function updateSoundButton(){
    $('sound-btn').setAttribute('aria-pressed',String(soundOn));$('sound-btn').setAttribute('aria-label',soundOn?'사운드 끄기':'사운드 켜기');$('sound-btn').title=soundOn?'사운드 끄기':'사운드 켜기';$('sound-btn').querySelector('.mute-slash').classList.toggle('hidden',soundOn);
  }
  $('deploy-btn').addEventListener('click',deploy);$('end-turn-btn').addEventListener('click',endTurn);$('interact-btn').addEventListener('click',interact);
  $('help-btn').addEventListener('click',showGuide);$('collection-btn').addEventListener('click',showCollection);
  $('draw-pile-btn').addEventListener('click',()=>showPile(false));$('discard-pile-btn').addEventListener('click',()=>showPile(true));
  $('sound-btn').addEventListener('click',()=>{soundOn=!soundOn;updateSoundButton();if(soundOn)sound('click');});
  $('fullscreen-btn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('app').requestFullscreen();}catch{notify('이 브라우저에서는 전체 화면을 지원하지 않습니다.');}});
  $('modal-backdrop').addEventListener('click',e=>{if(e.target===$('modal-backdrop')&&!['reward','outcome'].includes(activeModal))closeModal();});
  goHome();resize();requestAnimationFrame(frame);
})();
