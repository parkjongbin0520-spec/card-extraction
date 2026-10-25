/* Pointer dragging is a preview until release over a living enemy. */
(() => {
  'use strict';
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
        // Touch starts on the grip; moving capture to the whole card releases the grip's implicit capture.
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
    begin(e){
      const source=e.target.closest('[data-index]');if(!source||source.disabled||!e.isPrimary||e.button!==0||this.gesture)return;
      const index=Number(source.dataset.index),card=this.cardAt(index);if(!card)return;
      this.gesture={source,index,card,pointerId:e.pointerId,x:e.clientX,y:e.clientY,touch:e.pointerType!=='mouse',grip:!!e.target.closest('.card-grip'),active:false,target:null};
    }
    move(e){
      const g=this.gesture;if(!g||e.pointerId!==g.pointerId)return;
      const dx=e.clientX-g.x,dy=e.clientY-g.y;
      if(!g.active){
        if(Math.hypot(dx,dy)<10)return;
        // Card bodies keep native horizontal hand scrolling. The grip can drag in every direction.
        if(g.touch&&!g.grip&&Math.abs(dx)>Math.abs(dy)*1.15){this.gesture=null;return;}
        g.active=true;this.inspector.setSuspended(true);this.start?.();g.source.classList.add('drag-source');
        this.ghost.innerHTML=this.markup(g.index);this.ghost.classList.remove('hidden');
        this.status.classList.remove('hidden');document.body.classList.add('dragging-card');
        try{g.source.setPointerCapture(g.pointerId);}catch{}
      }
      e.preventDefault();this.update(e.clientX,e.clientY);
    }
    enemyAt(x,y){
      const node=document.elementFromPoint(x,y)?.closest('.enemy-target:not(:disabled)');
      return node?Number(node.dataset.enemy):null;
    }
    update(x,y){
      const g=this.gesture;if(!g?.active)return;
      const target=g.card.damage?this.enemyAt(x,y):null,valid=target!==null&&this.available(g.card);
      if(target!==g.target){g.target=target;this.preview(g.index,target);}
      this.ghost.classList.toggle('can-drop',valid);
      this.ghost.style.left=Math.max(4,Math.min(x-this.ghost.offsetWidth/2,innerWidth-this.ghost.offsetWidth-4))+'px';
      this.ghost.style.top=Math.max(4,Math.min(y+20,innerHeight-this.ghost.offsetHeight-4))+'px';
      const text=!g.card.damage?'방어·회복·전술은 선택 후 사용 버튼':!this.available(g.card)?'에너지 부족 · 놓아도 사용되지 않음':valid?'놓으면 사용':'적 위에 놓아 사용 · 밖에 놓으면 취소';
      if(this.status.textContent!==text)this.status.textContent=text;
      this.status.classList.toggle('valid',valid);
    }
    release(e){
      const g=this.gesture;if(!g||e.pointerId!==g.pointerId)return;
      if(!g.active){this.gesture=null;return;}
      e.preventDefault();const target=g.card.damage?this.enemyAt(e.clientX,e.clientY):null;
      const valid=target!==null&&this.cardAt(g.index)===g.card&&this.available(g.card);
      this.cancel();if(valid)this.use(g.index,target);
    }
    cancel(){
      const g=this.gesture;if(!g)return;this.gesture=null;
      if(!g.active)return;
      this.suppressClick=true;g.source.classList.remove('drag-source');
      try{if(g.source.hasPointerCapture(g.pointerId))g.source.releasePointerCapture(g.pointerId);}catch{}
      this.ghost.classList.add('hidden');this.ghost.replaceChildren();this.status.classList.add('hidden');
      document.body.classList.remove('dragging-card');this.clear();this.inspector.setSuspended(false);
    }
  }
  window.DragToPlay=DragToPlay;
})();
