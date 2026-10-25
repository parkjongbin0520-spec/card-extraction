/* Run with Playwright installed and a local static server: GAME_URL=http://127.0.0.1:8017 node tests/browser-feedback.cjs */
'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.GAME_URL||'http://127.0.0.1:8000';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const errors=[];
 async function pageFor(viewport={width:1366,height:768},touch=false){
  const p=await browser.newPage({viewport,hasTouch:touch,isMobile:touch});p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/game.js*',async route=>{const res=await route.fetch();const body=(await res.text()).replace(/\}\)\(\);\s*$/, 'window.__feedback={state,cardFor,playCard,endTurn,resolveEnemyTurn,reroll,renderHUD,projection,showCollection,screens,save};})();');await route.fulfill({response:res,body});});
  await p.goto(base);await p.locator('#screen-root [data-action=deploy]').click();await p.locator('#route-standard').click();return p;
 }
 const p=await pageFor();
 const s0=await p.evaluate(()=>{const t=__feedback,s=t.state;t.playCard(0,s.enemies[0]);return {hand:[...s.hand],draw:[...s.draw],discard:[...s.discard]};});
 await p.locator('#end-turn-btn').click();await p.waitForFunction(()=>__feedback.state.phase==='player');
 const s1=await p.evaluate(()=>{const s=__feedback.state;return {hand:s.hand,draw:s.draw,discard:s.discard,energy:s.energy};});
 assert.deepEqual(s1.hand.slice(0,4),s0.hand);assert.equal(s1.hand.length,5);assert.equal(s1.draw.length,s0.draw.length-1);assert.deepEqual(s1.discard,s0.discard);assert.equal(s1.energy,3);
 console.log('PASS end turn retains exact hand UIDs and fills only missing slots');
 const exhausted=await p.evaluate(()=>{const t=__feedback,s=t.state;s.hand=s.bag.slice(0,3);s.draw=[];s.discard=s.bag.slice(3);t.renderHUD();const hand=[...s.hand],discard=[...s.discard];t.endTurn();t.resolveEnemyTurn();return {before:{hand,discard},after:{hand:s.hand,draw:s.draw,discard:s.discard}};});
 assert.deepEqual(exhausted.after,{hand:exhausted.before.hand,draw:[],discard:exhausted.before.discard});
 console.log('PASS normal refill cannot recycle used cards from an empty draw pile');
 const rolling=await p.evaluate(()=>{const t=__feedback,s=t.state;s.energy=0;const turn=s.turn;t.reroll();const pending={phase:s.phase,hand:s.hand.length,draw:s.draw.length,discard:s.discard.length,energy:s.energy};t.reroll();t.resolveEnemyTurn();return {turn,pending,result:{phase:s.phase,turn:s.turn,hand:s.hand.length,discard:s.discard.length,energy:s.energy,piles:[...s.hand,...s.draw,...s.discard],bag:s.bag}};});
 assert.equal(rolling.pending.phase,'enemy');assert.equal(rolling.pending.hand,0);assert.equal(rolling.pending.draw,12);assert.equal(rolling.pending.discard,0);assert.equal(rolling.pending.energy,0);assert.equal(rolling.result.turn,rolling.turn+1);assert.equal(rolling.result.hand,5);assert.equal(rolling.result.energy,3);assert.deepEqual([...rolling.result.piles].sort(),[...rolling.result.bag].sort());assert.equal(new Set(rolling.result.piles).size,12);
 console.log('PASS reroll recovers discard, consumes one turn at zero energy, redraws five and conserves ownership');
 const over=await p.evaluate(()=>{const t=__feedback,s=t.state;s.hand=s.bag.slice(0,8);s.draw=s.bag.slice(8);s.discard=[];t.renderHUD();const before=[...s.hand];t.endTurn();t.resolveEnemyTurn();return {before,hand:s.hand,draw:s.draw.length};});assert.deepEqual(over.hand,over.before);assert.equal(over.draw,4);
 console.log('PASS bonus draws above five survive turn end without truncation');
 // The exact user example is created only inside this isolated QA session.
 const sample=await p.evaluate(()=>{const t=__feedback,s=t.state;const c=CardLibrary.create('heal',{rarity:'unique',options:[{type:'heal',value:21,tier:'epic'},{type:'energyGain',value:1,tier:'rare'},{type:'draw',value:1,tier:'unique'}],risks:[{type:'seal',amount:1,turns:3}]});s.cards[c.uid]=c;s.hand=[c.uid];t.renderHUD();return c.uid;});
 await p.locator('#hand [data-index="0"]').hover();await p.locator('#inspect-details').waitFor({state:'visible'});
 const tooltip=await p.locator('[data-inspect-desc]').innerText();assert.match(tooltip,/12\(\+21\)/);assert.match(tooltip,/0\(\+1\)/);assert.match(await p.locator('[data-inspect-sections]').innerText(),/강화 옵션/);assert.match(await p.locator('[data-inspect-sections]').innerText(),/승화: 3턴/);assert.match(await p.locator('.card-brief').innerText(),/체력 33 회복/);assert.equal(await p.locator('#hand .card-risk').innerText(),'승화 3턴');assert.equal(await p.locator('#hand .card').getAttribute('data-instance'),sample);
 assert.equal(await p.locator('.added-value').count(),3);
 console.log('PASS exact base(+bonus) tooltip, separate options and risk, combined card summary');
 await p.evaluate(id=>{const t=__feedback;t.save.instances.push(structuredClone(t.state.cards[id]));t.save.campaign.pack.push(id);t.save.campaign.run=null;t.state.playing=false;t.screens.show('base');},sample);await p.locator(`[data-detail-card="${sample}"]`).hover();await p.waitForFunction(()=>document.querySelector('#inspect-details').dataset.catalog==='true'&&!document.querySelector('#inspect-details').classList.contains('hidden'));assert.match(await p.locator('[data-inspect-desc]').innerText(),/12\(\+21\)/);assert.equal(await p.locator('#inspect-details').evaluate(n=>getComputedStyle(n).zIndex),'22');
 console.log('PASS base inventory exposes real instance tooltips above the screen');
 for(const [w,h] of [[1920,1080],[390,844],[844,390],[568,320]]){
  const mobile=await pageFor({width:w,height:h},w<1000);
  await mobile.evaluate(()=>{const t=__feedback,s=t.state;s.hand=CardLibrary.rarities.map((rarity,i)=>{const c=CardLibrary.create(['shot','pierce','suppress','heal','bulwark','fieldAid'][i],{rarity,...(i===3?{options:[{type:'heal',value:21,tier:'epic'},{type:'energyGain',value:1,tier:'rare'},{type:'draw',value:1,tier:'unique'}],risks:[{type:'seal',amount:1,turns:3}]}:{})});s.cards[c.uid]=c;return c.uid});t.renderHUD();document.getElementById('scene-message').classList.remove('visible');});
  const cards=await mobile.locator('#hand .card').evaluateAll(nodes=>nodes.map(n=>({rarity:n.dataset.rarity,gradient:getComputedStyle(n,'::after').backgroundImage,display:getComputedStyle(n,'::after').display,mask:getComputedStyle(n,'::after').maskComposite,overflow:n.scrollHeight>n.clientHeight+1})));
  assert.equal(cards.length,6);assert.equal(new Set(cards.map(c=>c.gradient)).size,6);assert.ok(cards.every(c=>c.display==='block'&&c.mask.includes('exclude')));assert.ok(cards.every(c=>!c.overflow),JSON.stringify({w,h,cards}));
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mobile.close();
 }
 console.log('PASS six distinct metallic rarity gradients, no card overflow on desktop or mobile');
 await p.close();await browser.close();assert.deepEqual(errors,[]);console.log('PASS no browser errors');
})().catch(e=>{console.error(e);process.exit(1);});
