/* DEAD HAND — fixed-camera, turn-based card extraction. No runtime dependencies. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const CARDS = {
    shot: {name:'정밀 사격', type:'attack', label:'ATTACK', cost:1, damage:9, desc:'적 하나에게 피해 9.', icon:'crosshair', code:'ATK–01'},
    burst: {name:'점사', type:'attack', label:'ATTACK', cost:2, damage:18, desc:'적 하나에게 피해 18.', icon:'crosshair', code:'ATK–02'},
    guard: {name:'방탄 엄폐', type:'defense', label:'DEFENSE', cost:1, block:12, desc:'이번 턴 방어 12 획득.', icon:'shield', code:'DEF–01'},
    scan: {name:'전술 스캔', type:'utility', label:'TACTICAL', cost:1, draw:2, desc:'카드를 2장 뽑습니다.', icon:'cards', code:'TAC–01'},
    heal: {name:'응급 처치', type:'utility', label:'MEDICAL', cost:1, heal:12, desc:'체력을 12 회복합니다.', icon:'plus', code:'MED–01'},
    pierce: {name:'철갑탄', type:'attack', label:'RARE / ATK', cost:2, damage:26, pierce:true, desc:'장갑·방어를 무시하고 피해 26.', icon:'crosshair', code:'ATK–03'},
    grenade: {name:'파편 수류탄', type:'attack', label:'RARE / AOE', cost:2, damage:14, aoe:true, desc:'모든 적에게 피해 14.', icon:'bolt', code:'ATK–04'},
    surge: {name:'과부하', type:'utility', label:'RARE / TAC', cost:0, surge:true, desc:'체력 3 소모. 에너지 +1, 카드 1장.', icon:'bolt', code:'TAC–02'}
  };
  const BASE_DECK = ['shot','shot','shot','shot','burst','burst','guard','guard','guard','scan','scan','heal'];
  const ZONES=[
    {name:'외곽 경계',english:'THE PERIMETER',risk:'I / 경계',reward:120,enemies:[
      {name:'경계병',hp:18,atk:6,pattern:['attack','guard','attack']},
      {name:'정찰 드론',hp:22,atk:8,drone:true,pattern:['charge','attack']}]},
    {name:'적재 구역',english:'THE LOADING BAY',risk:'II / 위험',reward:240,enemies:[
      {name:'진압병',hp:26,atk:8,armor:2,pattern:['guard','attack','attack']},
      {name:'정찰 드론',hp:20,atk:7,drone:true,pattern:['charge','attack']},
      {name:'경계병',hp:28,atk:9,pattern:['attack','guard','attack']}]},
    {name:'심층 벙커',english:'THE INNER VAULT',risk:'III / 치명적',reward:480,enemies:[
      {name:'중장갑병',hp:34,atk:10,armor:3,pattern:['guard','attack','attack']},
      {name:'공격 드론',hp:26,atk:9,drone:true,pattern:['charge','attack']},
      {name:'벙커 지휘관',hp:38,atk:12,armor:3,pattern:['charge','attack','guard','attack']}]}];
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
  const state={playing:false,mode:'briefing',phase:'player',zone:0,route:'standard',hp:80,armor:1,shield:0,energy:3,turn:1,
    loot:0,kills:0,cleared:0,hand:['shot','burst','guard','scan','shot'],draw:[],discard:[],runCards:[],
    selected:-1,target:0,enemies:[],battleReward:120,rewarded:false,time:0,shotAt:-1000,shotTarget:-1};
  const touchDevice=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
  document.documentElement.classList.toggle('touch-device',touchDevice);
  let activeModal=null,focusBeforeModal=null,soundOn=false,audio=null,inspector=null,toastTimer=null,sawHint=false,cardDrag=null;
  let pendingTimer=null,queuedReward=false,enemyResolutionPending=false,lastTimestamp=0;
  const scene=new BattlefieldScene($('world'));
  const alive=()=>state.enemies.filter(e=>e.hp>0);
  const isPlaying=()=>state.playing&&state.mode==='combat'&&state.phase==='player'&&!activeModal;
  const intentOf=e=>e.pattern[(state.turn-1)%e.pattern.length];
  const incomingRaw=()=>alive().reduce((n,e)=>n+(intentOf(e)==='attack'?e.atk:0),0);
  const incomingDamage=()=>alive().reduce((n,e)=>n+(intentOf(e)==='attack'?Math.max(0,e.atk-state.armor):0),0);
  const nextAction=e=>{
    let offset=0;while(offset<e.pattern.length&&e.pattern[(state.turn-1+offset)%e.pattern.length]==='charge')offset++;
    const type=e.pattern[(state.turn-1+offset)%e.pattern.length];
    return {type,turns:offset+1,value:type==='attack'?e.atk:6};
  };
  const keywords=text=>String(text).replace(/(장갑·방어를 무시|방어 무시|에너지 부족|처치|행동 취소|피해|방어|회복|에너지|전체|뽑기|공격|\d+(?:장)?|[+−]\d+)/g,'<strong class="combat-keyword">$1</strong>');
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
  function notify(text,duration=2200) {
    clearTimeout(toastTimer);$('scene-message').textContent=text;$('scene-message').classList.add('visible');
    toastTimer=setTimeout(()=>$('scene-message').classList.remove('visible'),duration);
  }
  function briefFor(c) {
    return c.damage?`${c.damage} 피해${c.aoe?' · 전체':''}`:c.block?`${c.block} 방어`:c.heal?`${c.heal} 회복`:c.draw?`${c.draw}장 뽑기`:'+1 에너지 · −3♥';
  }
  function previewFor(c,target) {
    if(!c)return '';
    if(c.damage&&target){const damage=damageFor(c,target).damage;return c.aoe?`전체 기본 ${c.damage} · 이 대상 ${damage}`:`피해 ${damage} · 예상 체력 ${Math.max(0,target.hp-damage)}`;}
    if(c.block)return `방어 +${c.block} · 예상 체력 감소 ${Math.max(0,incomingDamage()-state.shield-c.block)}`;
    if(c.heal)return `체력 +${Math.min(c.heal,80-state.hp)} 회복`;
    if(c.draw)return state.hand.length===8?'손패가 가득 찼습니다':`카드 ${Math.min(c.draw,9-state.hand.length)}장 뽑기`;
    if(c.surge)return '체력 −3 · 에너지 +1 · 카드 +1';
    return '';
  }
  function shuffle(items) {
    const list=[...items];
    for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}
    return list;
  }
  function cardMarkup(id,index,opts={}) {
    const c=CARDS[id];
    const disabled=opts.disabled?'disabled':'';
    return `<button class="card ${c.type} ${state.selected===index&&!opts.reward?'selected':''} ${opts.extraClass||''} ${opts.unavailable?'unavailable':''}" data-card="${id}" ${opts.reward?'data-reward="'+id+'"':'data-index="'+index+'"'} ${disabled} aria-label="${c.name}, 에너지 ${c.cost}, ${c.desc}" ${!opts.reward?'aria-pressed="'+(state.selected===index)+'"':''}>
      <span class="card-top"><span class="card-cost"><small>비용</small><b>${c.cost}</b></span><span class="card-grip" title="잡아서 적에게 끌기" aria-hidden="true">⠿</span><span class="card-type">${c.type==='attack'?'공격':c.type==='defense'?'방어':c.heal?'회복':'전술'}</span></span>
      <span class="card-art">${icon(c.icon)}</span><span class="card-name">${c.name}</span><span class="card-brief">${keywords(briefFor(c))}</span><span class="card-desc">${keywords(c.desc)}</span>
      <span class="card-bottom"><span>${opts.reward?'선택':index+1}</span><span>${opts.bottom||`에너지 ${c.cost} 사용`}</span></span></button>`;
  }

  function renderHand() {
    const scroll=$('hand').scrollLeft;
    $('hand').innerHTML=state.hand.map((id,i)=>cardMarkup(id,i,{disabled:!isPlaying(),unavailable:CARDS[id].cost>state.energy,bottom:CARDS[id].cost>state.energy?'에너지 부족':undefined})).join('')||'<div class="card empty">턴을 종료해 손패 보충</div>';
    $('hand').scrollLeft=scroll;
    $('hand').querySelectorAll('[data-index]').forEach(b=>b.addEventListener('click',()=>chooseCard(Number(b.dataset.index))));
    if(state.selected>=0)$('hand').querySelector('.selected')?.scrollIntoView({block:'nearest',inline:'nearest'});
    $('hand-count').textContent=String(state.hand.length).padStart(2,'0');
    $('draw-count').textContent=state.mode==='briefing'?'7':state.draw.length;
    $('discard-count').textContent=state.discard.length;
    $('hand-hint').textContent=state.selected>=0?`${CARDS[state.hand[state.selected]].name} 선택 · 효과 확인 후 사용`:'카드 선택 → 효과 확인 → 사용';
  }
  function positionTargets() {
    const scale=scene.width/Math.max(1,$('world').getBoundingClientRect().width);
    $('enemy-targets').style.setProperty('--enemy-hud-width',Math.min(184,$('viewport').clientWidth*(state.enemies.length>=3?.25:.32))+'px');
    scene.labelSpace=(Math.max(0,...[...$('enemy-targets').querySelectorAll('.enemy-caption')].map(e=>e.offsetHeight))+14)*scale;
    for(const rect of scene.getTargets(state.enemies)){
      const b=$('enemy-targets').querySelector(`[data-enemy="${rect.id}"]`);if(!b)continue;
      Object.assign(b.style,{left:rect.left+'%',top:rect.top+'%',width:rect.width+'%',height:rect.height+'%'});
    }
  }
  function renderEnemies() {
    $('enemy-targets').innerHTML=alive().map(e=>{
      const action=nextAction(e),now=state.phase==='enemy'&&action.turns===1;
      return `<button class="enemy-target ${state.target===e.id?'targeted':''}" data-enemy="${e.id}" aria-pressed="${state.target===e.id}" aria-label="${e.name}, 체력 ${e.hp}/${e.maxHp}, ${action.turns}턴 후 ${action.type==='attack'?'공격':'방어'} ${action.value}" ${!isPlaying()?'disabled':''}>
        <span class="enemy-caption"><strong class="enemy-name">${e.name}</strong>
          <span class="enemy-vitals"><span class="enemy-hp"><i class="hp-remaining" style="width:${e.hp/e.maxHp*100}%"></i><i class="hp-loss"></i></span><span class="enemy-hp-value"><b>${e.hp}</b><small>/${e.maxHp}</small></span></span>
          <span class="enemy-action ${action.type}"><span class="action-countdown"><b>${now?'지금':action.turns}</b><small>${now?'':'턴 후'}</small></span><span class="action-content">${action.type==='attack'?'공격':'방어'} <b>${action.type==='guard'?'+':''}${action.value}</b></span></span>
          <span class="enemy-preview hidden"></span>
        </span><span class="target-corners"></span></button>`;
    }).join('');
    $('enemy-targets').querySelectorAll('[data-enemy]').forEach(b=>b.addEventListener('click',()=>{
      if(!isPlaying())return;state.target=Number(b.dataset.enemy);renderHUD();
      if(state.selected>=0)inspector.select({kind:'card',index:state.selected,id:state.hand[state.selected]});
      else inspector.select({kind:'enemy',id:state.target});
    }));positionTargets();$('enemy-targets').classList.toggle('hidden',state.mode!=='combat');
  }
  function renderHUD() {
    cardDrag?.cancel();
    if(!alive().some(e=>e.id===state.target))state.target=alive()[0]?.id??-1;
    document.querySelector('.health-track').setAttribute('aria-valuenow',state.hp);$('armor-value').textContent=state.armor;
    $('hp-value').textContent=state.hp;$('hp-bar').style.width=`${state.hp/80*100}%`;
    $('hp-bar').style.background=state.hp<25?'var(--red)':'var(--green)';$('shield-value').textContent=state.shield;
    $('energy-value').textContent=state.energy;
    document.querySelector('.shield-label').classList.toggle('zero',state.shield===0);
    $('energy-pips').innerHTML=Array.from({length:Math.max(3,state.energy)},(_,i)=>`<i class="${i>=state.energy?'used':''}"></i>`).join('');
    $('turn-number').textContent=String(state.turn).padStart(2,'0');$('loot-value').textContent=state.loot.toLocaleString();
    $('enemy-count').textContent=String(alive().length).padStart(2,'0');$('collection-count').textContent=save.cards.length;
    $('player-state').textContent=({briefing:'출정 대기',route:'진입 경로 선택',combat:state.phase==='enemy'?'적 행동 진행':'카드 행동 선택',reward:'보상 선택',cleared:'회수 경로 확보',dead:'작전 실패',won:'귀환 완료'})[state.mode];
    const chosen=CARDS[state.hand[state.selected]],target=state.enemies.find(e=>e.id===state.target);
    $('end-turn-btn').disabled=!isPlaying();$('fire-btn').disabled=!isPlaying()||!chosen||chosen.cost>state.energy||(chosen.type==='attack'&&!target);
    $('fire-label').textContent=chosen?chosen.name:'카드를 선택하세요';
    $('fire-target').textContent=chosen?.type==='attack'?(target?.name||'대상 선택'):chosen?'나에게 사용':'';
    $('intent-text').textContent=incomingDamage()>state.shield?`−${incomingDamage()-state.shield}`:'0';
    $('enemy-intent').classList.toggle('safe',incomingDamage()<=state.shield);
    $('enemy-intent').setAttribute('aria-label',`턴 종료 예상 피해 ${Math.max(0,incomingDamage()-state.shield)}. 상세 정보 보기`);
    $('incoming-health').textContent=`예상 체력 감소 ${Math.max(0,incomingDamage()-state.shield)}`;
    $('preview-target').textContent=chosen&&chosen.type!=='attack'?'나에게 사용':target?`${target.name} · 체력 ${target.hp}`:'대상 없음';
    const preview=previewFor(chosen,target);
    $('action-preview').textContent=preview;
    $('preview-cost').textContent=chosen?`비용 ${chosen.cost} / 보유 ${state.energy}`:`에너지 ${state.energy} / 3`;
    $('enemy-intent').classList.toggle('hidden',state.mode!=='combat');
    $('phase-label').textContent=state.phase==='enemy'?'적 행동':`내 턴 · ${state.turn}`;
    const shortEffect=chosen?.damage&&target?`피해 ${damageFor(chosen,target).damage} · 비용 ${chosen.cost}`:chosen?.block?`방어 +${chosen.block} · 비용 ${chosen.cost}`:chosen?.heal?`회복 +${Math.min(chosen.heal,80-state.hp)} · 비용 ${chosen.cost}`:chosen?.draw?`카드 ${chosen.draw}장 · 비용 ${chosen.cost}`:chosen?.surge?'에너지 +1 · 체력 −3':'';
    $('phase-description').textContent=state.phase==='enemy'?'예고한 행동을 실행합니다':chosen?shortEffect:'대상 선택 → 카드 선택 → 사용';
    $('phase-banner').classList.toggle('enemy-phase',state.phase==='enemy');$('phase-banner').classList.toggle('hidden',state.mode!=='combat');
    $('extract-menu-btn').classList.toggle('hidden',state.mode!=='cleared');
    $('scene-location').textContent=`SEC.0${state.zone+1} / ${ZONES[state.zone].english}`;
    $('zone-name').textContent=ZONES[state.zone].name;$('danger-level').textContent=ZONES[state.zone].risk;
    $('mission-panel').classList.toggle('hidden',state.mode==='briefing');
    document.body.classList.toggle('in-battle',state.mode==='combat');
    document.body.classList.toggle('battle-cleared',state.mode==='cleared');
    document.body.dataset.mode=state.mode;
    document.body.classList.toggle('has-selection',!!chosen&&state.mode==='combat');
    $('sector-progress').querySelectorAll('span').forEach((s,i)=>{s.classList.toggle('active',i===state.zone);s.classList.toggle('completed',i<state.cleared);});
    renderHand();renderEnemies();inspector?.refresh();
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

  function openRoute(index) {
    clearTimeout(pendingTimer);state.zone=index;state.mode='route';state.phase='player';state.selected=-1;state.enemies=[];renderHUD();
    const z=ZONES[index],safeCount=index?z.enemies.length-1:z.enemies.length;
    showModal(`<div class="eyebrow">CHOOSE YOUR ENTRY / SECTOR 0${index+1}</div><h2 id="modal-title">${z.name}. <em>진입 경로 선택.</em></h2><p class="modal-copy">전투는 정해진 시점에서 진행됩니다. 적의 의도를 읽고 카드로 행동하세요.<br>현재 체력 <b>${state.hp}/80</b> · 미확정 전리품 <b>${state.loot} CR</b></p>
      <div class="route-options"><button id="route-standard" class="route-card"><span class="route-icon">${icon('crosshair')}</span><small>DIRECT ENTRY / ${z.risk}</small><strong>${index===0?'검문소 돌파':index===1?'적재장 돌파':'중앙 벙커 돌파'}</strong><p>${z.enemies.length}명과 전투 · 기본 보상 ${z.reward} CR</p><span class="route-benefit">높은 회수 가치 <b>진입 →</b></span></button><button id="route-supply" class="route-card supply"><span class="route-icon">${icon('plus')}</span><small>SUPPLY ROUTE / 위험 완화</small><strong>보급 창고 우회</strong><p>${safeCount}명과 전투 · 기본 보상 ${Math.round(z.reward*.65)} CR</p><span class="route-benefit">적 체력 −15% · 승리 시 체력 +8 <b>진입 →</b></span></button></div><p class="reward-note">모든 경로에서 보상 카드 1장을 발견합니다. 귀환해야 카드와 전리품이 확정됩니다.</p>`,true,'route');
    $('route-standard').addEventListener('click',()=>startZone(index,'standard'));
    $('route-supply').addEventListener('click',()=>startZone(index,'supply'));
  }
  function startZone(index,route='standard') {
    closeModal();state.zone=index;state.route=route;state.mode='combat';state.phase='player';state.energy=3;state.shield=0;state.turn=1;state.rewarded=false;
    const templates=route==='supply'&&index?ZONES[index].enemies.slice(0,-1):ZONES[index].enemies;
    state.enemies=templates.map((e,i)=>({...e,id:i,hp:Math.round(e.hp*(route==='supply'?.85:1)),maxHp:Math.round(e.hp*(route==='supply'?.85:1)),shield:0,hitAt:0,deadAt:0,attackAt:0}));
    state.battleReward=Math.round(ZONES[index].reward*(route==='supply'?.65:1));state.target=0;prepareDeck(index===0);renderHUD();sound('card');
    if(!sawHint){notify(touchDevice?'모서리를 잡아 적 위에 놓으면 사용':'카드를 적에게 끌어 놓으면 사용',3500);sawHint=true;}
  }
  function deploy() {
    clearTimeout(pendingTimer);enemyResolutionPending=false;queuedReward=false;closeModal();
    Object.assign(state,{playing:true,hp:80,loot:0,kills:0,cleared:0,runCards:[],selected:-1});
    $('briefing').classList.add('hidden');$('sector-stamp').classList.add('hidden');openRoute(0);
  }
  function chooseCard(index) {
    if(!isPlaying()||cardDrag?.active)return;const id=state.hand[index];if(!id)return;
    const deselect=state.selected===index;inspector?.hide();state.selected=deselect?-1:index;renderHUD();sound('click');
    if(!deselect)inspector?.select({kind:'card',id,index});
  }
  function fire(){if(!isPlaying()||cardDrag?.active)return;if(state.selected<0){notify('먼저 카드를 선택하세요.');return;}playCard(state.selected,state.enemies.find(e=>e.id===state.target&&e.hp>0));}
  function damageFor(card,enemy){
    const raw=Math.max(1,card.damage-(card.pierce?0:enemy.armor||0)),absorbed=card.pierce?0:Math.min(enemy.shield,raw);
    return {absorbed,damage:raw-absorbed};
  }
  function playCard(index,target) {
    const id=state.hand[index],c=CARDS[id];if(!c||!isPlaying()||c.cost>state.energy)return;
    if(c.type==='attack'&&!target){notify('공격할 적을 선택하세요.');return;}
    if(c.heal&&state.hp===80){notify('체력이 가득 찼습니다. 카드를 보존합니다.');return;}
    if(c.surge&&state.hp<=3){notify('과부하를 쓰려면 체력이 4 이상 필요합니다.');return;}
    if(c.draw&&state.hand.length===8){notify('손패 상한은 8장입니다. 다른 카드를 먼저 사용하세요.');return;}
    inspector?.hide();state.energy-=c.cost;state.hand.splice(index,1);state.discard.push(id);state.selected=-1;
    if(c.block){state.shield+=c.block;sound('guard');notify(`방어 +${c.block}`);}
    if(c.heal){const n=Math.min(c.heal,80-state.hp);state.hp+=n;sound('guard');notify(`체력 +${n}`);}
    if(c.draw){drawCards(c.draw);sound('card');notify('카드 +2');}
    if(c.surge){state.hp-=3;state.energy++;drawCards(1);sound('card');notify('에너지 +1 · 체력 −3');}
    if(c.damage){
      state.target=target.id;state.shotTarget=target.id;let kills=0;
      for(const e of c.aoe?alive():[target]){
        const {absorbed,damage}=damageFor(c,e);
        e.shield-=absorbed;e.hp=Math.max(0,e.hp-damage);e.lastDamage=damage;e.hitAt=performance.now();
        if(!e.hp){e.deadAt=performance.now();state.kills++;state.loot+=30*(state.zone+1);kills++;}
      }
      state.shotAt=performance.now();sound('shot');notify(kills?`+${30*(state.zone+1)*kills} CR`:'명중');
      if(!alive().length)finishCombat();
    }
    renderHUD();
  }
  function finishCombat(){
    state.mode='reward';state.rewarded=true;state.cleared=state.zone+1;state.loot+=state.battleReward;
    if(state.route==='supply')state.hp=Math.min(80,state.hp+8);
    pendingTimer=setTimeout(()=>{if(state.mode==='reward'){if(activeModal)queuedReward=true;else showReward();}},650);
  }
  function endTurn(){
    if(!isPlaying())return;cardDrag?.cancel();inspector?.hide();state.phase='enemy';state.selected=-1;renderHUD();
    for(const e of alive())if(intentOf(e)==='attack')e.attackAt=performance.now();
    pendingTimer=setTimeout(resolveEnemyTurn,420);
  }
  function resolveEnemyTurn(){
    if(state.mode!=='combat'||state.phase!=='enemy')return;
    if(activeModal){enemyResolutionPending=true;return;}enemyResolutionPending=false;
    const incoming=incomingDamage(),blocked=Math.min(state.shield,incoming),damage=Math.max(0,incoming-state.shield);
    for(const e of alive())if(intentOf(e)==='guard')e.shield+=6;
    state.hp=Math.max(0,state.hp-damage);state.shield=0;
    if(damage){$('damage-flash').classList.add('hit');setTimeout(()=>$('damage-flash').classList.remove('hit'),130);sound('hurt');}else sound('guard');
    if(!state.hp){state.mode='dead';state.playing=false;renderHUD();showOutcome(false);return;}
    state.discard.push(...state.hand);state.hand=[];state.energy=3;state.turn++;state.phase='player';drawCards(5);renderHUD();
    notify(damage?`체력 −${damage}`:incoming?'공격 방어':'내 턴');
  }
  function showModal(content,wide=false,kind='info'){
    cardDrag?.cancel();inspector?.hide();$('scene-message').classList.remove('visible');
    if(!activeModal)focusBeforeModal=document.activeElement;activeModal=kind;
    $('modal').className=`modal${wide?' wide':''}`;$('modal').innerHTML=content;$('modal-backdrop').classList.remove('hidden');$('modal').focus();renderHUD();
    $('modal').querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  }
  function closeModal(){
    const previous=activeModal;activeModal=null;$('modal-backdrop').classList.add('hidden');
    if(focusBeforeModal?.isConnected)focusBeforeModal.focus({preventScroll:true});renderHUD();
    if(enemyResolutionPending)resolveEnemyTurn();
    if(queuedReward&&state.mode==='reward'&&previous!=='reward'){queuedReward=false;showReward();}
  }
  function showReward(){
    queuedReward=false;const choices=state.zone===0?['pierce','grenade','surge']:shuffle(['pierce','grenade','surge','heal','guard','burst']).slice(0,3);
    showModal(`<div class="eyebrow">SECTOR 0${state.zone+1} / CLEARED</div><h2 id="modal-title">구역 확보. <em>덱을 강화하세요.</em></h2><p class="modal-copy">구역 보상 <b class="orange-text">+${state.battleReward} CR</b>${state.route==='supply'?' · 보급품으로 체력 +8 (최대 80)':''}<br>카드 한 장을 고르면 이번 탐사의 덱에 추가됩니다.</p><div class="reward-cards">${choices.map((id,i)=>cardMarkup(id,i,{reward:true,bottom:'탐사 덱에 추가'})).join('')}</div><p class="reward-note">현재 전리품 <b>${state.loot} CR</b> · 귀환 시 확정<br>카드를 고르면 바로 철수 또는 다음 구역을 결정합니다.</p>`,true,'reward');
    $('modal').querySelectorAll('[data-reward]').forEach(b=>b.addEventListener('click',()=>{
      state.runCards.push(b.dataset.reward);state.mode='cleared';state.selected=-1;closeModal();sound('win');showDecision();
    }));
  }
  function showDecision(){
    if(state.mode!=='cleared')return;const final=state.zone===2,next=ZONES[state.zone+1];
    showModal(`<div class="eyebrow">EXTRACTION ROUTE / SECURED</div><h2 id="modal-title">${final?'마지막 출구. <em>귀환하세요.</em>':'챙길 것인가. <em>더 들어갈 것인가.</em>'}</h2><p class="modal-copy">${final?'모든 구역을 돌파했습니다. 확보한 전리품을 가지고 귀환하세요.':'지금 철수하면 전리품과 발견한 카드를 보관함에 확보합니다.<br>더 들어가면 체력은 유지됩니다. 실패하면 이번 전리품을 모두 잃습니다.'}</p><div class="modal-stat-row"><div><small>미확정 전리품</small><strong>${state.loot}<em> CR</em></strong></div><div><small>체력</small><strong>${state.hp}<em> / 80</em></strong></div><div><small>발견한 카드</small><strong>${state.runCards.length}<em> 장</em></strong></div></div>${!final?`<div class="next-zone"><div><small>다음 목적지</small><strong>0${state.zone+2} ${next.name}</strong></div><span>보상 최대 +${next.reward} CR</span></div>`:''}<div class="modal-buttons"><button id="extract-btn" class="primary-btn">${icon('exit')} ${state.loot} CR 확보하고 귀환</button>${!final?'<button id="descend-btn" class="secondary-btn">다음 구역 선택 →</button>':''}</div><button class="modal-close" data-close aria-label="전장 보기">×</button>`,false,'decision');
    $('extract-btn').addEventListener('click',extract);$('descend-btn')?.addEventListener('click',()=>{closeModal();openRoute(state.zone+1);});
  }
  function extract(){
    if(state.mode!=='cleared')return;save.credits+=state.loot;save.runs++;
    for(const id of state.runCards)if(!BASE_DECK.includes(id)&&!save.cards.includes(id))save.cards.push(id);
    persist();state.mode='won';state.playing=false;state.phase='player';renderHUD();sound('win');showOutcome(true);
  }
  function showOutcome(success) {
    showModal(`<div class="ending-symbol ${success?'':'fail'}">${icon(success?'exit':'crosshair')}</div><div class="eyebrow">OPERATION BLACKOUT / ${success?'EXTRACTED':'SIGNAL LOST'}</div><h2 id="modal-title">${success?'무사 귀환. <em>전리품 확보.</em>':'작전 실패. <em>신호가 끊겼습니다.</em>'}</h2><p class="modal-copy">${success?'이번 탐사에서 확보한 전리품이 보관함에 저장되었습니다.':'이번 탐사의 미확정 전리품과 카드를 잃었습니다.<br>기본 덱과 이전에 회수한 카드는 안전하게 보존됩니다.'}</p><div class="modal-stat-row"><div><small>${success?'회수':'손실'} 전리품</small><strong>${state.loot} <em>CR</em></strong></div><div><small>적 제압</small><strong>${state.kills}</strong></div><div><small>돌파 구역</small><strong>${state.cleared}<em> / 3</em></strong></div></div><div class="outcome-list">${success?`회수 카드: ${state.runCards.map(id=>CARDS[id].name).join(', ')||'없음'}<br>누적 회수: ${save.credits.toLocaleString()} CR · 귀환 ${save.runs}회${storageAvailable?'':'<br>이 브라우저에서 저장소를 사용할 수 없어 이번 창에서만 보존됩니다.'}`:`보관함 잔액: ${save.credits.toLocaleString()} CR<br>방어 카드로 피해를 줄이고, 에너지를 모두 활용한 뒤 턴을 종료하세요.`}</div><div class="modal-buttons"><button id="replay-btn" class="primary-btn">다시 출정 ${icon('arrow')}</button><button id="home-btn" class="secondary-btn">작전 준비로</button></div>`,false,'outcome');
    $('replay-btn').addEventListener('click',deploy);$('home-btn').addEventListener('click',goHome);
  }

  function goHome(){
    clearTimeout(pendingTimer);queuedReward=false;enemyResolutionPending=false;
    Object.assign(state,{mode:'briefing',phase:'player',playing:false,zone:0,hp:80,armor:1,shield:0,energy:3,turn:1,loot:0,cleared:0,selected:-1,target:0,discard:[],hand:['shot','burst','guard','scan','shot']});
    state.enemies=ZONES[0].enemies.map((e,i)=>({...e,id:i,maxHp:e.hp,shield:0}));
    closeModal();$('briefing').classList.remove('hidden');$('sector-stamp').classList.remove('hidden');renderHUD();
  }
  function showGuide(){
    if(activeModal&&['reward','outcome','route'].includes(activeModal))return;
    showModal(`<button class="modal-close" data-close aria-label="가이드 닫기">×</button><div class="eyebrow">FIELD MANUAL / 03</div><h2 id="modal-title">움직이는 것은 <em>당신의 한 수.</em></h2><p class="modal-copy">정해진 시점에서 모든 적의 의도를 읽고 카드로 행동합니다. 시간 제한은 없습니다.</p><div class="guide-grid"><div class="guide-item"><b>01 / 경로를 선택하세요</b><p>돌파 경로는 높은 보상을 줍니다. 보급 경로는 적이 약하고 승리 시 체력을 8 회복하지만 보상이 적습니다.</p></div><div class="guide-item"><b>02 / 카드와 대상</b><p>적을 눌러 대상을 선택하고 카드를 고릅니다. 같은 카드를 다시 누르면 선택이 해제됩니다. 비용·효과를 확인한 뒤 사용으로 확정합니다. 공격 카드를 적에게 끌면 체력 바에 예상 피해가 표시되고, 그 위에서 손을 떼면 바로 사용됩니다. 적이 없는 곳에 놓으면 취소됩니다. 모바일은 카드 모서리의 ⠿ 손잡이로 끌 수 있습니다. 마우스 올리기·Tab 포커스·모바일 길게 누르기로도 설명을 볼 수 있습니다. 방어·회복·전술 카드도 같은 방식으로 사용합니다.</p></div><div class="guide-item"><b>03 / 적의 의도를 읽으세요</b><p>적 HUD에는 이름·체력·남은 턴·행동이 표시됩니다. 1턴 후는 이번 턴 종료, 2턴 후 공격은 이번 턴 조준 후 다음 턴 공격입니다. 처치하면 해당 행동이 취소됩니다. 방어구 Lv.1은 공격마다 피해를 1 줄입니다. 턴 종료 후 행동하며 내 방어는 그 턴만 유지됩니다.</p></div><div class="guide-item"><b>04 / 귀환해야 당신의 것</b><p>전투 승리 → 보상 카드 선택 → 철수 또는 다음 구역 선택. 실패하면 이번 탐사의 전리품을 잃고 기본 덱과 이전 회수 기록은 보존됩니다.</p></div></div><div class="guide-note">에너지 3 · 새 턴 손패 5장 · 손패 상한 8장. 뽑기 더미가 비면 버린 카드를 섞습니다.<br><span class="key">1–8</span> 카드 <span class="key">← →</span> 대상 <span class="key">F / ENTER</span> 카드 사용 <span class="key">SPACE</span> 턴 종료</div><div class="modal-buttons"><button class="primary-btn" data-close>확인 · 작전 복귀 ${icon('arrow')}</button></div>`,true,'guide');
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
    if(!state.playing||(activeModal&&activeModal!=='pile'))return;
    const pile=discard?state.discard:state.draw,counts={};pile.forEach(id=>counts[id]=(counts[id]||0)+1);
    showModal(`<button class="modal-close" data-close aria-label="카드 목록 닫기">×</button><div class="eyebrow">카드 더미</div><h2 id="modal-title">${discard?'버린 카드':'뽑기 더미'} <em>${pile.length}장</em></h2><div class="pile-tabs"><button data-pile="draw" class="${!discard?'active':''}">뽑기 ${state.draw.length}장</button><button data-pile="discard" class="${discard?'active':''}">버림 ${state.discard.length}장</button></div><p class="modal-copy">${discard?'뽑기 더미가 비면 이 카드들을 섞어서 다시 사용합니다.':'카드 목록이며, 뽑히는 순서는 공개되지 않습니다.'}</p><div class="pile-list">${Object.entries(counts).map(([id,n])=>`<div class="pile-item"><b>비용 ${CARDS[id].cost}</b>${CARDS[id].name}<small>× ${n}</small></div>`).join('')||'<p class="modal-copy">카드가 없습니다.</p>'}</div><div class="modal-buttons"><button class="secondary-btn" data-close>작전 복귀</button></div>`,false,'pile');
    $('modal').querySelectorAll('[data-pile]').forEach(b=>b.addEventListener('click',()=>showPile(b.dataset.pile==='discard')));
  }

  function findInspection(token) {
    if(token.kind==='card'){
      const n=$('hand').querySelector(`[data-index="${token.index}"]`);return n?.dataset.card===token.id?n:null;
    }
    if(token.kind==='enemy')return $('enemy-targets').querySelector(`[data-enemy="${token.id}"]`);
    if(token.kind==='hud')return document.querySelector(`[data-inspect="${token.id}"]`);
    if(token.kind==='danger')return $('enemy-intent');
    if(token.kind==='turn')return $('end-turn-btn');
    return null;
  }
  function inspectionData(token) {
    if(token.kind==='card'){
      const c=CARDS[token.id];if(!c||state.hand[token.index]!==token.id)return null;
      const target=state.enemies.find(e=>e.id===state.target&&e.hp>0);
      return {kicker:`${c.type==='attack'?'공격':c.type==='defense'?'방어':c.heal?'회복':'전술'} · 비용 ${c.cost}`,title:c.name,description:previewFor(c,target)||c.desc,
        rows:[{label:c.type==='attack'?'대상':'적용',value:c.type==='attack'?(target?.name||'적 선택'):'나'}],
        note:c.cost>state.energy?'에너지가 부족합니다.':c.desc+(state.selected===token.index?' · 사용으로 확정':' · 눌러서 선택')};
    }
    if(token.kind==='enemy'){
      const e=state.enemies.find(e=>e.id===token.id&&e.hp>0);if(!e)return null;
      const c=CARDS[state.hand[state.selected]],intent=intentOf(e);
      return {kicker:'적 정보',title:e.name,description:intent==='attack'?`턴 종료 시 ${e.atk} 피해를 줍니다.`:intent==='guard'?'턴 종료 시 방어 6을 얻습니다.':`이번 턴에는 공격하지 않고 다음 턴 ${e.atk} 피해를 준비합니다.`,
        rows:[{label:'체력',value:`${e.hp} / ${e.maxHp}`},...(e.armor||e.shield?[{label:'보호',value:`장갑 ${e.armor||0} · 방어 ${e.shield||0}`}]:[]),...(c?.damage?[{label:'선택 카드 피해',value:damageFor(c,e).damage}]:[])],note:state.target===e.id?'현재 선택한 대상':'눌러서 공격 대상으로 선택'};
    }
    if(token.kind==='danger')return {kicker:'턴 종료 예상',title:`체력 −${Math.max(0,incomingDamage()-state.shield)}`,description:'살아 있는 적이 예고한 행동만 실행합니다.',rows:[{label:'적 공격 합계',value:incomingRaw()},{label:'방어구로 감소',value:incomingRaw()-incomingDamage()},{label:'임시 방어',value:state.shield}],note:'적을 먼저 제압하면 그 적의 공격은 취소됩니다.'};
    if(token.kind==='turn')return {kicker:'턴 종료',title:'적 행동 시작',description:'남은 손패를 버리고 적의 예고 행동을 실행합니다.',rows:[{label:'다음 내 턴',value:'손패 5장 · 에너지 3'}],note:'내 방어는 이번 적 턴이 끝나면 사라집니다.'};
    if(token.kind==='hud'){
      if(token.id==='health')return {title:`체력 ${state.hp} / 80`,description:'체력이 0이 되면 이번 탐사의 전리품을 잃습니다.'};
      if(token.id==='energy')return {title:`에너지 ${state.energy}`,description:'카드의 숫자만큼 소모합니다. 새 턴에는 3으로 회복됩니다.'};
      if(token.id==='armor')return {title:`방어구 Lv.${state.armor}`,description:`적의 공격 한 번마다 피해를 ${state.armor} 줄입니다. 그다음 임시 방어로 흡수합니다. 기본 방어구는 탐사 내내 유지됩니다.`};
      if(token.id==='shield')return {title:`임시 방어 ${state.shield}`,description:'이번 적 턴의 피해를 먼저 흡수하고 턴이 끝나면 사라집니다.'};
    }
    return null;
  }
  function clearDragPreview(){
    state.dragTarget=-1;state.dragCard=false;
    for(const node of $('enemy-targets').querySelectorAll('[data-enemy]')){
      const e=state.enemies.find(e=>e.id===Number(node.dataset.enemy));if(!e)continue;
      node.classList.remove('drag-preview','drag-hover','preview-lethal','preview-unavailable');
      node.querySelector('.hp-remaining').style.width=e.hp/e.maxHp*100+'%';node.querySelector('.hp-loss').style.width='0%';
      node.querySelector('.enemy-preview').classList.add('hidden');
    }
  }
  function previewDrag(index,id){
    clearDragPreview();const c=CARDS[state.hand[index]],target=state.enemies.find(e=>e.id===id&&e.hp>0);if(!c?.damage||!target)return;
    state.dragTarget=id;state.dragCard=true;
    for(const e of c.aoe?alive():[target]){
      const node=$('enemy-targets').querySelector(`[data-enemy="${e.id}"]`);if(!node)continue;
      const {damage}=damageFor(c,e),after=Math.max(0,e.hp-damage),valid=c.cost<=state.energy;
      node.classList.add('drag-preview');node.classList.toggle('drag-hover',e.id===id);node.classList.toggle('preview-lethal',after===0);node.classList.toggle('preview-unavailable',!valid);
      node.querySelector('.hp-remaining').style.width=after/e.maxHp*100+'%';
      Object.assign(node.querySelector('.hp-loss').style,{left:after/e.maxHp*100+'%',width:(e.hp-after)/e.maxHp*100+'%'});
      const p=node.querySelector('.enemy-preview');p.classList.remove('hidden');p.innerHTML=`피해 <strong>${damage}</strong><span>${e.hp} → <b>${after}</b></span>${after===0?'<em>처치 · 행동 취소</em>':''}`;
    }
  }
  function selectNextTarget(direction){
    if(!isPlaying())return;const list=alive(),index=list.findIndex(e=>e.id===state.target);state.target=list[(index+direction+list.length)%list.length]?.id??-1;renderHUD();
  }
  document.addEventListener('keydown',e=>{
    const k=e.key.toLowerCase();
    if(activeModal){
      if(k==='escape'&&!['route','reward','outcome'].includes(activeModal)){e.preventDefault();closeModal();}
      if(k==='tab'){
        const buttons=[...$('modal').querySelectorAll('button:not(:disabled),[href],[tabindex="0"]')],first=buttons[0],last=buttons.at(-1);
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===$('modal'))){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===$('modal'))){e.preventDefault();first?.focus();}
      }
      return;
    }
    if([' ','arrowleft','arrowright'].includes(k)&&state.playing)e.preventDefault();
    if(e.repeat)return;
    if(k==='escape'&&state.playing){showGuide();return;}
    if(k==='e'&&state.mode==='cleared'){showDecision();return;}
    if(!isPlaying())return;
    if(/^[1-8]$/.test(k)){e.preventDefault();chooseCard(Number(k)-1);}
    if(k==='arrowleft')selectNextTarget(-1);if(k==='arrowright')selectNextTarget(1);
    if(k==='f'||(k==='enter'&&!e.target.closest('button,a,input,textarea,select'))){e.preventDefault();fire();}
    if(k===' '){document.activeElement?.blur();endTurn();}
  });
  $('viewport').addEventListener('pointermove',e=>{if(e.pointerType==='mouse'){const r=$('viewport').getBoundingClientRect();scene.hover=clamp((e.clientX-r.left)/r.width-.5,-.5,.5);}});
  $('viewport').addEventListener('pointerleave',()=>scene.hover=0);
  $('deploy-btn').addEventListener('click',deploy);$('end-turn-btn').addEventListener('click',endTurn);$('fire-btn').addEventListener('click',fire);
  $('extract-menu-btn').addEventListener('click',showDecision);$('help-btn').addEventListener('click',showGuide);$('collection-btn').addEventListener('click',showCollection);
  $('deck-inspect-btn').addEventListener('click',()=>showPile(false));
  function updateSoundButton(){const b=$('sound-btn');b.setAttribute('aria-pressed',String(soundOn));b.setAttribute('aria-label',soundOn?'사운드 끄기':'사운드 켜기');b.title=soundOn?'사운드 끄기':'사운드 켜기';b.querySelector('.mute-slash').classList.toggle('hidden',soundOn);}
  $('sound-btn').addEventListener('click',()=>{soundOn=!soundOn;updateSoundButton();if(soundOn)sound('click');});
  $('fullscreen-btn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('app').requestFullscreen();}catch{notify('이 브라우저에서는 전체 화면을 지원하지 않습니다.');}});
  $('modal-backdrop').addEventListener('click',e=>{if(e.target===$('modal-backdrop')&&!['route','reward','outcome'].includes(activeModal))closeModal();});
  function frame(timestamp){
    if(document.hidden){lastTimestamp=timestamp;requestAnimationFrame(frame);return;}
    if(timestamp-lastTimestamp<(touchDevice?1000/30:1000/60)-1){requestAnimationFrame(frame);return;}
    state.time+=Math.min(.05,(timestamp-lastTimestamp)/1000||0);lastTimestamp=timestamp;
    scene.draw(state,timestamp);positionTargets();inspector?.position();requestAnimationFrame(frame);
  }
  inspector=new ContextDetails($('inspect-details'),inspectionData,findInspection);
  cardDrag=new DragToPlay({hand:$('hand'),ghost:$('drag-ghost'),status:$('drag-status'),inspector,
    cardAt:index=>isPlaying()?CARDS[state.hand[index]]:null,
    markup:index=>cardMarkup(state.hand[index],index),
    start:()=>$('scene-message').classList.remove('visible'),
    available:c=>c.cost<=state.energy,
    preview:previewDrag,clear:clearDragPreview,
    use:(index,id)=>{const enemy=state.enemies.find(e=>e.id===id&&e.hp>0);if(enemy)playCard(index,enemy);}
  });
  inspector.connect($('hand'),'[data-index]',n=>({kind:'card',index:Number(n.dataset.index),id:n.dataset.card}));
  inspector.connect($('enemy-targets'),'[data-enemy]',n=>({kind:'enemy',id:Number(n.dataset.enemy)}));
  inspector.connect(document.querySelector('.combat-hud'),'[data-inspect]',n=>({kind:'hud',id:n.dataset.inspect}));
  inspector.connect(document.querySelector('.combat-hud'),'#enemy-intent',()=>({kind:'danger'}));
  inspector.connect(document.querySelector('.turn-controls'),'#end-turn-btn',()=>({kind:'turn'}));
  document.querySelectorAll('[data-inspect]').forEach(n=>n.addEventListener('click',()=>inspector.select({kind:'hud',id:n.dataset.inspect})));
  $('enemy-intent').addEventListener('click',()=>inspector.select({kind:'danger'}));
  document.querySelector('.combat-hud').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-inspect],#enemy-intent')){e.preventDefault();e.stopPropagation();e.target.click();}});
  goHome();requestAnimationFrame(frame);
})();
