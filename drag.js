/* A card drag previews one legal area and commits once, on release. */
(() => {
  'use strict';
  const sameTarget=(a,b)=>a===b||!!(a&&b&&a.kind===b.kind&&a.id===b.id);
  class DragToPlay {
    constructor(options){
      Object.assign(this,options);this.gesture=null;this.suppressClick=false;
      this.hand.addEventListener('pointerdown',e=>this.begin(e));
      this.hand.addEventListener('dragstart',e=>e.preventDefault());
      document.addEventListener('pointerdown',e=>{
        if(this.gesture&&e.pointerId!==this.gesture.pointerId){this.cancel();return;}
        this.suppressClick=false;
      },true);
      document.addEventListener('pointermove',e=>this.move(e),{capture:true,passive:false});
      document.addEventListener('pointerup',e=>this.release(e),{capture:true,passive:false});
      document.addEventListener('pointercancel',e=>{if(e.pointerId===this.gesture?.pointerId)this.cancel();},true);
      this.hand.addEventListener('lostpointercapture',e=>{
        const g=this.gesture;
        // Moving touch capture from the grip to its card must not cancel the drag.
        if(g&&e.pointerId===g.pointerId&&!g.source.hasPointerCapture(g.pointerId))this.cancel();
      });
      document.addEventListener('click',e=>{
        if(this.suppressClick&&e.detail>0){e.preventDefault();e.stopImmediatePropagation();this.suppressClick=false;}
      },true);
      document.addEventListener('keydown',e=>{
        if(!this.active)return;
        if(e.key==='Escape'){this.cancel();e.preventDefault();e.stopImmediatePropagation();}
        else if(e.key==='Tab')this.cancel();
        else if(/^[1-8]$/.test(e.key)||['f','F','Enter',' ','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();}
      },true);
      window.addEventListener('blur',()=>this.cancel());window.addEventListener('resize',()=>this.cancel());
      document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancel();});
    }
    get active(){return !!this.gesture?.active;}
    key(index){
      if(this.keyAt)return this.keyAt(index);
      const node=this.hand.querySelector(`[data-index="${index}"]`);
      return node?.dataset.instance||node?.dataset.card||null;
    }
    begin(e){
      const source=e.target.closest('[data-index]');if(!source||source.disabled||!e.isPrimary||e.button!==0||this.gesture)return;
      const index=Number(source.dataset.index),card=this.cardAt(index);if(!card)return;
      this.gesture={source,index,card,key:this.key(index),pointerId:e.pointerId,x:e.clientX,y:e.clientY,touch:e.pointerType!=='mouse',grip:!!e.target.closest('.card-grip'),active:false,target:null};
    }
    move(e){
      const g=this.gesture;if(!g||e.pointerId!==g.pointerId)return;
      const dx=e.clientX-g.x,dy=e.clientY-g.y;
      if(!g.active){
        if(Math.hypot(dx,dy)<10)return;
        if(g.touch&&!g.grip&&Math.abs(dx)>Math.abs(dy)*1.15){this.gesture=null;return;}
        g.active=true;this.inspector.setSuspended(true);this.start?.();g.source.classList.add('drag-source');
        this.ghost.innerHTML=this.markup(g.index);this.ghost.classList.remove('hidden');
        this.status.classList.remove('hidden');document.body.classList.add('dragging-card');this.highlight(g.card);
        try{g.source.setPointerCapture(g.pointerId);}catch{}
      }
      e.preventDefault();this.update(e.clientX,e.clientY);
    }
    areaAt(x,y,card){
      if(this.targetAt)return this.targetAt(x,y,card);
      const node=document.elementFromPoint(x,y)?.closest('.enemy-target:not(:disabled)');
      return node&&card.type==='attack'?{kind:'enemy',id:Number(node.dataset.enemy)}:null;
    }
    areaNode(target){
      if(target?.kind==='enemy')return document.querySelector(`[data-enemy="${target.id}"]`);
      if(target?.kind==='player')return document.getElementById('player-status');
      if(target?.kind==='bag')return document.getElementById('bag-btn');
      return null;
    }
    highlight(card){
      const type=card.type==='attack'?'enemy':card.type==='defense'||card.heal?'player':'bag';
      const nodes=type==='enemy'?[...document.querySelectorAll('.enemy-target:not(:disabled)')]:[document.getElementById(type==='player'?'player-status':'bag-btn')];
      nodes.filter(Boolean).forEach(n=>n.classList.add('drop-eligible'));
      const shade=document.getElementById('drag-shade');
      if(shade){shade.classList.remove('hidden');this.positionShade(nodes.filter(Boolean));}
      document.body.dataset.dragTarget=type;
    }
    positionShade(nodes){
      // Transparent holes keep eligible targets readable; the layer never takes input.
      const shade=document.getElementById('drag-shade');if(!shade)return;
      const boxes=nodes.map(n=>{
        const list=[n,...n.querySelectorAll('.enemy-caption,.enemy-preview:not(.hidden),.drop-effect-preview:not(.hidden)')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);
        return {left:Math.min(...list.map(r=>r.left)),top:Math.min(...list.map(r=>r.top)),right:Math.max(...list.map(r=>r.right)),bottom:Math.max(...list.map(r=>r.bottom)),width:list.length?1:0,height:list.length?1:0};
      }).filter(r=>r.width&&r.height),w=innerWidth,h=innerHeight;
      let path=`M0 0H${w}V${h}H0Z`;
      for(const r of boxes){const l=Math.max(0,r.left-5),t=Math.max(0,r.top-5),rr=Math.min(w,r.right+5),bb=Math.min(h,r.bottom+5);path+=`M${l} ${t}V${bb}H${rr}V${t}Z`;}
      shade.style.clipPath=`path(evenodd, "${path}")`;
    }
    update(x,y){
      const g=this.gesture;if(!g?.active)return;
      const target=this.areaAt(x,y,g.card),valid=target!==null&&this.available(g.card,g.index,target);
      if(!sameTarget(target,g.target)){
        this.areaNode(g.target)?.classList.remove('drop-hover');g.target=target;
        this.areaNode(target)?.classList.add('drop-hover');this.preview(g.index,target);
      }
      this.ghost.classList.toggle('can-drop',valid);
      this.ghost.style.left=Math.max(4,Math.min(x-this.ghost.offsetWidth/2,innerWidth-this.ghost.offsetWidth-4))+'px';
      this.ghost.style.top=Math.max(4,Math.min(y+20,innerHeight-this.ghost.offsetHeight-4))+'px';
      const area=g.card.type==='attack'?'적':g.card.type==='defense'||g.card.heal?'내 상태':'배낭';
      const text=!this.available(g.card,g.index,target)?'사용 조건 부족 · 놓아도 소모되지 않음':valid?'놓으면 사용':`${area} 위에 놓아 사용 · 밖에 놓으면 취소`;
      if(this.status.textContent!==text)this.status.textContent=text;
      this.status.classList.toggle('valid',valid);
      this.positionShade([...document.querySelectorAll('.drop-eligible')]);
    }
    release(e){
      const g=this.gesture;if(!g||e.pointerId!==g.pointerId)return;
      if(!g.active){this.gesture=null;return;}
      e.preventDefault();const target=this.areaAt(e.clientX,e.clientY,g.card),card=this.cardAt(g.index);
      const valid=target!==null&&card&&this.key(g.index)===g.key&&this.available(card,g.index,target);
      this.cancel();if(valid)this.use(g.index,target);
    }
    cancel(){
      const g=this.gesture;if(!g)return;this.gesture=null;
      if(!g.active)return;
      this.suppressClick=true;g.source.classList.remove('drag-source');
      try{if(g.source.hasPointerCapture(g.pointerId))g.source.releasePointerCapture(g.pointerId);}catch{}
      this.ghost.classList.add('hidden');this.ghost.replaceChildren();this.status.classList.add('hidden');
      document.getElementById('drag-shade')?.classList.add('hidden');
      document.querySelectorAll('.drop-eligible,.drop-hover').forEach(n=>n.classList.remove('drop-eligible','drop-hover'));
      document.body.classList.remove('dragging-card');delete document.body.dataset.dragTarget;
      this.clear();this.inspector.setSuspended(false);
    }
  }
  window.DragToPlay=DragToPlay;
})();
