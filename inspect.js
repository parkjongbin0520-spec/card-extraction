/* One contextual inspector, shared by mouse, keyboard and touch. Never spends game resources. */
(() => {
  'use strict';
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emphasize=text=>String(text??'').split(/(장갑·방어를 무시|에너지 부족|처치|행동 취소|피해|방어|회복|에너지|전체|뽑기|공격|\d+(?:장)?|[+−]\d+)/g).map((part,i)=>i%2?`<strong class="combat-keyword">${escape(part)}</strong>`:escape(part)).join('');
  class ContextDetails {
    constructor(element,build,find) {
      this.el=element;this.build=build;this.find=find;this.canHover=matchMedia('(any-hover:hover)').matches;this.current=null;this.pin=null;this.hoverTimer=null;this.leaveTimer=null;this.holdTimer=null;this.keyboard=false;
      document.addEventListener('pointermove',e=>{
        if(e.pointerType!=='mouse')return;this.mouse={x:e.clientX,y:e.clientY};
        if(this.current?.mode==='hover'){const a=this.find(this.current.token);if(!a?.contains(e.target)&&!this.el.contains(e.target))this.scheduleLeave();else clearTimeout(this.leaveTimer);}
      },true);
      this.el.querySelector('[data-inspect-close]').addEventListener('click',()=>this.hide(true));
      this.el.addEventListener('pointerenter',()=>clearTimeout(this.leaveTimer));
      this.el.addEventListener('pointerleave',()=>{if(this.current?.mode==='hover')this.scheduleLeave();});
      document.addEventListener('keydown',e=>{
        this.keyboard=true;
        if(e.key==='Escape'&&this.current){e.preventDefault();e.stopImmediatePropagation();this.hide(true);}
      },true);
      document.addEventListener('pointerdown',e=>{
        this.keyboard=false;if(!this.hold)this.suppressed=null;
        if(this.current&&!this.el.contains(e.target)&&!this.find(this.current.token)?.contains(e.target))this.hide();
      },true);
      document.addEventListener('click',e=>{
        if(this.suppressed&&performance.now()<this.suppressed.until&&e.detail>0&&this.find(this.suppressed.token)?.contains(e.target)){
          e.preventDefault();e.stopImmediatePropagation();this.suppressed=null;
        }
      },true);
      window.addEventListener('resize',()=>this.position());
      window.addEventListener('blur',()=>{this.cancelHold();this.hide();});
    }
    connect(root,selector,tokenFor) {
      const nodeFor=e=>{const n=e.target.closest(selector);return n&&root.contains(n)?n:null;};
      root.addEventListener('pointerover',e=>{
        const n=nodeFor(e);if(!this.canHover||e.pointerType!=='mouse'||!n||n.contains(e.relatedTarget))return;
        clearTimeout(this.leaveTimer);clearTimeout(this.hoverTimer);
        const token=tokenFor(n);if(this.pin)return;
        this.hoverTimer=setTimeout(()=>{const a=this.find(token),m=this.mouse;if(a&&m&&a.contains(document.elementFromPoint(m.x,m.y)))this.show(token,'hover');},180);
      });
      root.addEventListener('pointerout',e=>{
        const n=nodeFor(e);if(!n||n.contains(e.relatedTarget))return;clearTimeout(this.hoverTimer);
        if(this.current?.mode==='hover')this.scheduleLeave();
      });
      root.addEventListener('focusin',e=>{const n=nodeFor(e);if(n&&this.keyboard)this.show(tokenFor(n),'focus');});
      root.addEventListener('focusout',e=>{if(nodeFor(e)&&!this.el.contains(e.relatedTarget)&&this.current?.mode==='focus')this.scheduleLeave();});
      root.addEventListener('pointerdown',e=>{
        const n=nodeFor(e);if(!n||e.pointerType==='mouse')return;this.cancelHold();
        this.hold={x:e.clientX,y:e.clientY,id:e.pointerId,token:tokenFor(n)};
        this.holdTimer=setTimeout(()=>{
          const token=this.hold?.token;if(!token)return;
          this.suppressed={token,until:performance.now()+900};this.select(token);this.holdTimer=null;
        },420);
      });
      root.addEventListener('pointermove',e=>{if(this.hold&&e.pointerId===this.hold.id&&Math.hypot(e.clientX-this.hold.x,e.clientY-this.hold.y)>9)this.cancelHold();});
      for(const event of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(event,()=>this.cancelHold());
      root.addEventListener('contextmenu',e=>{if(nodeFor(e))e.preventDefault();});
    }
    cancelHold(){clearTimeout(this.holdTimer);this.holdTimer=null;this.hold=null;}
    setSuspended(value){this.suspended=value;if(value)this.hide();}
    select(token){if(this.suspended)return;clearTimeout(this.hoverTimer);clearTimeout(this.leaveTimer);this.pin=token;this.show(token,'selection');}
    show(token,mode='hover') {
      if(this.suspended)return;
      const anchor=this.find(token),data=this.build(token);if(!anchor||!data||!anchor.getClientRects().length)return;
      if(this.current)this.find(this.current.token)?.removeAttribute('aria-describedby');
      this.current={token,mode};this.el.classList.remove('hidden');this.el.dataset.source=mode;this.el.dataset.kind=token.kind;
      this.el.setAttribute('role',mode==='selection'?'dialog':'tooltip');
      this.el.querySelector('[data-inspect-close]').classList.toggle('hidden',mode!=='selection');
      this.el.querySelector('[data-inspect-kicker]').textContent=data.kicker||'상세 정보';
      this.el.querySelector('#inspect-title').textContent=data.title;
      this.el.querySelector('[data-inspect-desc]').innerHTML=emphasize(data.description||'');
      this.el.querySelector('[data-inspect-rows]').innerHTML=(data.rows||[]).map(r=>`<div><span>${escape(r.label)}</span><b>${emphasize(r.value)}</b></div>`).join('');
      this.el.querySelector('[data-inspect-note]').innerHTML=emphasize(data.note||'');
      anchor.setAttribute('aria-describedby','inspect-details');this.sizeDirty=true;this.position();
    }
    position(){
      if(!this.current)return;const anchor=this.find(this.current.token);if(!anchor?.getClientRects().length){this.hide();return;}const a=anchor.getBoundingClientRect();
      const host=this.el.closest('#app').getBoundingClientRect(),drawer=this.current.token.kind==='card'&&this.current.mode==='selection';
      const area=drawer?document.querySelector('.hand-area').getBoundingClientRect():null,key=[host.width,host.height,area?.width,area?.height,drawer].join(':');
      if(this.sizeDirty||key!==this.sizeKey){
        this.el.style.width='';this.el.style.maxHeight='';
        if(drawer){const field=document.querySelector('#viewport').getBoundingClientRect();this.el.style.width=Math.min(this.el.offsetWidth,field.width-20)+'px';this.el.style.maxHeight=Math.max(100,Math.min(260,field.height*.62))+'px';}
        this.sizeDirty=false;this.sizeKey=key;
      }
      const w=this.el.offsetWidth,h=this.el.offsetHeight;
      let x=a.x+a.width/2-w/2,y=a.y-h-12;
      if(drawer){const field=document.querySelector('#viewport').getBoundingClientRect();x=Math.max(field.left+10,Math.min(x,field.right-w-10));y=field.bottom-h-8;}
      else if(y<host.top+10)y=a.bottom+12;
      x=Math.max(host.left+10,Math.min(x,host.right-w-10));y=Math.max(host.top+10,Math.min(y,host.bottom-h-10));
      this.el.style.left=x+'px';this.el.style.top=y+'px';
    }
    refresh(){
      if(!this.current)return;const {token,mode}=this.current;if(!this.find(token)?.getClientRects().length||!this.build(token)){this.hide();return;}this.show(token,mode);
    }
    scheduleLeave(){clearTimeout(this.leaveTimer);this.leaveTimer=setTimeout(()=>{if(this.pin&&this.find(this.pin))this.show(this.pin,'selection');else this.hide();},180);}
    hide(focus=false){
      clearTimeout(this.hoverTimer);clearTimeout(this.leaveTimer);this.cancelHold();
      const anchor=this.current&&this.find(this.current.token);anchor?.removeAttribute('aria-describedby');
      this.current=null;this.pin=null;this.el.classList.add('hidden');if(focus&&anchor?.isConnected){const keyboard=this.keyboard;this.keyboard=false;anchor.focus({preventScroll:true});this.keyboard=keyboard;}
    }
  }
  window.ContextDetails=ContextDetails;
})();
