/* One low-resolution pixel grid for the fixed-camera Cardkov diorama. */
(() => {
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const SPRITE_W=48,SPRITE_H=72,FOOT=69;
  class BattlefieldScene {
    constructor(canvas) {
      this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.width=1;this.height=1;
      this.hover=0;this.look=0;this.tiles=[];this.edges=[];this.shadows=[];
      this.roomCache=document.createElement('canvas');this.roomKey='';
      this.plates=this.loadImage('assets/pixel/field-plates.png?v=10','assets/field-plates.svg',()=>this.preparePlates());
      this.weapon=this.loadImage('assets/pixel/weapon.png?v=10','assets/weapon-plate.svg',()=>this.prepareWeapon());
      this.environments=Array.from({length:3},(_,zone)=>this.loadImage(`assets/pixel/environment-${zone}.png?v=10`,null,()=>{this.roomKey='';}));
      this.reducedMotion=matchMedia('(prefers-reduced-motion:reduce)').matches;
      // The DOM HUD stays full resolution; only the entire world shares this pixel grid.
      canvas.style.imageRendering='pixelated';
      new ResizeObserver(()=>this.resize()).observe(canvas);this.resize();
    }
    loadImage(source,fallback,onload){
      const image=new Image();image.decoding='async';image.onload=onload;
      image.onerror=()=>{image.onerror=null;if(fallback)image.src=fallback;};
      image.src=source;return image;
    }
    get ready(){return this.plates.complete&&this.plates.naturalWidth>0&&this.weapon.complete&&this.weapon.naturalWidth>0&&this.tiles.length===6;}
    preparePlates(){
      for(let tile=0;tile<6;tile++){
        const image=document.createElement('canvas');image.width=SPRITE_W;image.height=SPRITE_H;
        const q=image.getContext('2d');q.imageSmoothingEnabled=false;
        const sourceWidth=this.plates.naturalWidth/6;
        q.drawImage(this.plates,tile*sourceWidth,0,sourceWidth,this.plates.naturalHeight,0,0,SPRITE_W,SPRITE_H);
        this.tiles[tile]=image;
        for(const [list,color] of [[this.edges,'#1c2527'],[this.shadows,'#111719']]){
          const mask=document.createElement('canvas');mask.width=SPRITE_W;mask.height=SPRITE_H;
          const m=mask.getContext('2d');m.imageSmoothingEnabled=false;m.drawImage(image,0,0);
          m.globalCompositeOperation='source-in';m.fillStyle=color;m.fillRect(0,0,SPRITE_W,SPRITE_H);list[tile]=mask;
        }
      }
    }
    prepareWeapon(){
      this.weaponTile=document.createElement('canvas');this.weaponTile.width=160;this.weaponTile.height=125;
      const q=this.weaponTile.getContext('2d');q.imageSmoothingEnabled=false;q.drawImage(this.weapon,0,0,160,125);
    }
    resize(){
      const r=this.canvas.getBoundingClientRect();
      this.pixelScale=Math.max(2,Math.ceil(Math.max(r.width/640,r.height/360)));
      this.width=Math.max(1,Math.round(r.width/this.pixelScale));this.height=Math.max(1,Math.round(r.height/this.pixelScale));
      this.canvas.width=this.width;this.canvas.height=this.height;this.ctx.imageSmoothingEnabled=false;this.roomKey='';
    }
    project(x,y,z){const h=this.height;return {x:Math.round(this.width/2+(x+this.look*.08)*h*1.55/z),y:Math.round((this.horizon??h*.43)+(1.4-y)*h*1.55/z)};}
    quad(points,fill,stroke){
      const p=this.ctx;p.beginPath();points.forEach(([x,y,z],i)=>{const s=this.project(x,y,z);i?p.lineTo(s.x,s.y):p.moveTo(s.x,s.y);});p.closePath();p.fillStyle=fill;p.fill();
      if(stroke){p.strokeStyle=stroke;p.lineWidth=1;p.stroke();}
    }
    line(points,color,width=1){const p=this.ctx;p.beginPath();points.forEach(([x,y,z],i)=>{const s=this.project(x,y,z);i?p.lineTo(s.x,s.y):p.moveTo(s.x,s.y);});p.strokeStyle=color;p.lineWidth=Math.max(1,Math.round(width));p.lineJoin='miter';p.stroke();}
    room(zone,time,cleared){
      const key=[zone,this.width,this.height,this.horizon,!!cleared].join(':');
      if(this.roomKey!==key){
        this.roomCache.width=this.width;this.roomCache.height=this.height;
        const context=this.ctx,look=this.look;this.ctx=this.roomCache.getContext('2d',{alpha:false});this.ctx.imageSmoothingEnabled=false;this.look=0;
        try{this.buildRoom(zone,cleared);this.roomKey=key;}finally{this.ctx=context;this.look=look;}
      }
      this.ctx.imageSmoothingEnabled=false;this.ctx.drawImage(this.roomCache,0,0);
    }
    buildRoom(zone,cleared){
      const p=this.ctx,w=this.width,h=this.height,environment=this.environments[zone]||this.environments[0];
      if(environment?.complete&&environment.naturalWidth){
        const scale=Math.max(w/environment.naturalWidth,h/environment.naturalHeight),
          width=Math.ceil(environment.naturalWidth*scale),height=Math.ceil(environment.naturalHeight*scale),
          y=clamp(Math.round((this.horizon??h*.43)-height*.42),h-height,0);
        p.imageSmoothingEnabled=false;p.drawImage(environment,Math.round((w-width)/2),y,width,height);return;
      }
      // Small, quiet fallback shapes keep the same art grammar when an image is unavailable.
      p.fillStyle='#1c2527';p.fillRect(0,0,w,h);
      this.quad([[-6,0,1],[6,0,1],[6,0,14],[-6,0,14]],'#414c4b');
      this.quad([[-6,0,14],[6,0,14],[6,4,14],[-6,4,14]],'#59645f');
      this.quad([[-6,0,14],[6,0,14],[6,1.15,14],[-6,1.15,14]],'#46523b');
      for(const side of [-1,1]){
        const x=6*side;
        this.quad([[x,0,1],[x,0,14],[x,4,14],[x,4,1]],side<0?'#2b3536':'#414c4b');
        this.quad([[x,.1,1],[x,.1,14],[x,1.15,14],[x,1.15,1]],'#303a2d');
        this.line([[x-side*.06,3,1],[x-side*.06,3,14]],'#798479',2);
        this.line([[side*3.7,.01,2],[side*3.7,.01,12]],'#8b7655',1);
      }
      this.quad([[-1.8,0,13.8],[1.8,0,13.8],[1.8,3.2,13.8],[-1.8,3.2,13.8]],'#1c2527');
      this.quad([[-1.5,.05,13.7],[1.5,.05,13.7],[1.5,3,13.7],[-1.5,3,13.7]],cleared?'#64724b':'#414c4b','#798479');
      for(let y=.3;y<3;y+=.45)this.line([[-1.5,y,13.6],[1.5,y,13.6]],'#2b3536');
      this.quad([[2.5,2.1,13.7],[5.1,2.1,13.7],[5.1,3.6,13.7],[2.5,3.6,13.7]],'#63848b','#1c2527');
      this.line([[3.8,2.1,13.6],[3.8,3.6,13.6]],'#1c2527',2);
      this.line([[2.5,2.85,13.6],[5.1,2.85,13.6]],'#1c2527',2);
      this.quad([[-4.9,2.4,13.6],[-4.1,2.4,13.6],[-4.1,2.7,13.6],[-4.9,2.7,13.6]],'#8b7655','#1c2527');
      this.quad([[-4.75,2.47,13.5],[-4.25,2.47,13.5],[-4.25,2.62,13.5],[-4.75,2.62,13.5]],'#d69a58');
      for(const z of [4,8,12]){
        this.line([[-6,3.8,z],[6,3.8,z]],'#1c2527',3);
        this.quad([[-.8,3.75,z],[.8,3.75,z],[.8,3.75,z+.15],[-.8,3.75,z+.15]],'#9da899');
      }
      for(const z of [4,7,10])this.line([[-6,.005,z],[6,.005,z]],'#2b3536');
    }
    castShadow(a,e){
      const p=this.ctx,mask=this.shadows[e.drone?2:e.armor?1:0];if(!mask)return;
      p.save();p.translate(Math.round(a.x),Math.round(a.foot));p.globalAlpha=e.drone?.2:.3;
      p.transform(1,0,.45,e.drone?.08:.12,0,0);p.imageSmoothingEnabled=false;
      p.drawImage(mask,-Math.round(a.width/2),-Math.round(a.height*FOOT/SPRITE_H),Math.round(a.width),Math.round(a.height));p.restore();
    }
    floorMark(x,y,rx,ry,color,fill=false){
      const p=this.ctx;p.beginPath();
      for(let i=0;i<8;i++){const a=i*Math.PI/4,sx=Math.round(x+Math.cos(a)*rx),sy=Math.round(y+Math.sin(a)*ry);i?p.lineTo(sx,sy):p.moveTo(sx,sy);}
      p.closePath();p.lineWidth=1;if(fill){p.fillStyle=color;p.fill();}else{p.strokeStyle=color;p.stroke();}
    }
    plate(tile,x,foot,height,opacity=1){
      const image=this.tiles[tile];if(!image)return;const p=this.ctx,h=Math.max(1,Math.round(height)),w=Math.max(1,Math.round(h*SPRITE_W/SPRITE_H));
      p.save();p.globalAlpha=opacity;p.imageSmoothingEnabled=false;
      p.drawImage(image,Math.round(x-w/2),Math.round(foot-h*FOOT/SPRITE_H),w,h);p.restore();
    }
    layout(enemies){
      const w=this.width,h=this.height,n=enemies.length,places=n===1?[.5]:n===2?[.32,.68]:[.23,.5,.77];
      const labels=this.labelSpace??Math.min(40,h*.24),heightLimit=Math.max(12,Math.min(h*.56,(h-labels-7)*.94,w/(n+.65)*1.6));
      this.horizon=Math.round(Math.max(h*.43,labels+heightLimit*.264));
      return enemies.map((e,i)=>{
        const height=Math.round(heightLimit*(e.drone?.94:1)),z=h*1.55*2/height,worldX=(places[i]-.5)*w*z/(h*1.55),point=this.project(worldX,0,z);
        return {id:e.id,x:point.x,foot:point.y,height,width:Math.round(height*SPRITE_W/SPRITE_H),z,worldX};
      });
    }
    getTargets(enemies){return this.layout(enemies).map(s=>({id:s.id,left:(s.x-s.width*.44)/this.width*100,top:(s.foot-s.height*.92)/this.height*100,width:s.width*.88/this.width*100,height:s.height*.92/this.height*100}));}
    draw(state,timestamp){
      const p=this.ctx,w=this.width,h=this.height,now=timestamp||performance.now();
      p.imageSmoothingEnabled=false;
      // A one-pixel stage shift preserves parallax without subpixel swimming or rotation.
      this.look=this.reducedMotion?0:Math.round(this.hover*2)/2;
      const actors=this.layout(state.enemies),items=[];
      this.room(state.zone,state.time,state.mode==='cleared'||state.mode==='won');
      for(let i=0;i<actors.length;i++)if(state.enemies[i].hp>0)this.castShadow(actors[i],state.enemies[i]);
      for(const side of [-1,1]){
        for(const z of [7.7,12]){const pos=this.project(side*Math.min(4.6,w/(h*1.55)*6),0,z);items.push({z,draw:()=>this.plate(4,pos.x,pos.y,h*1.55*3.4/z)});}
        const z=3.9,pos=this.project(side*Math.min(3.8,w*3.9/(h*1.55)*.55),0,z);items.push({z,draw:()=>this.plate(3,pos.x,pos.y,h*1.55*1.15/z)});
      }
      const terminal=this.project(Math.min(3.7,w*10/(h*1.55)*.4),0,10);items.push({z:10,draw:()=>this.plate(5,terminal.x,terminal.y,h*1.55*2/10)});
      for(let i=0;i<actors.length;i++){
        const a=actors[i],e=state.enemies[i];
        if(e.hp<=0&&now-e.deadAt>650)continue;
        items.push({z:a.z,draw:()=>{
          const death=e.hp<=0?clamp((now-e.deadAt)/650,0,1):0,hit=e.hitAt>0?clamp(1-(now-e.hitAt)/250,0,1):0,
            attack=e.attackAt>0&&now-e.attackAt<280,selected=(state.dragTarget>=0?state.dragTarget:state.target)===e.id&&e.hp>0;
          this.floorMark(a.x,a.foot-1,a.width*.4,Math.max(1,a.height*.025),e.drone?'#11171977':'#111719bb',true);
          if(selected&&state.mode==='combat')this.floorMark(a.x,a.foot,a.width*.54,Math.max(2,a.height*.055),state.selected>=0||state.dragCard?'#d69a58':'#b1b87c');
          const bob=this.reducedMotion||!e.drone?0:Math.floor(now/420+i)%2,
            shake=this.reducedMotion||!hit?0:(Math.floor(now/45)%2?1:-1),
            lunge=this.reducedMotion||!attack?0:now-e.attackAt<140?-2:-1,
            poseHeight=death?a.height*[1,.7,.35][Math.min(2,Math.floor(death*3))]:a.height;
          this.plate(e.drone?2:e.armor?1:0,a.x+shake,a.foot+bob+lunge,poseHeight,death>.7?.4:1);
          if(state.mode==='combat'&&e.hp>0){
            const charging=e.action?e.action.type==='attack'&&e.wait>0:Array.isArray(e.pattern)&&e.pattern[(state.turn-1)%e.pattern.length]==='charge';
            if(charging){p.fillStyle='#d69a58';p.fillRect(Math.round(a.x-1),Math.round(a.foot-a.height*(e.drone?.57:.78)),2,1);}
          }
          if(hit&&e.hp>0){p.fillStyle='#efd18b';p.font=`bold ${Math.max(8,Math.round(h*.035))}px monospace`;p.textAlign='center';p.fillText(`−${e.lastDamage}`,Math.round(a.x+a.width*.42),Math.round(a.foot-a.height*.6-Math.floor((1-hit)*6)));p.textAlign='left';}
          if(e.shield&&e.hp>0){p.strokeStyle='#9da899';p.lineWidth=1;const sx=Math.round(a.x-a.width*.51),sy=Math.round(a.foot-a.height*.82);p.strokeRect(sx+.5,sy+.5,Math.round(a.width*1.02),Math.round(a.height*.82));}
        }});
      }
      items.sort((a,b)=>b.z-a.z).forEach(s=>s.draw());
      this.drawWeapon(state,now);
      if(state.mode==='briefing'){p.fillStyle='#111719b8';p.fillRect(0,0,Math.ceil(w*.47),h);}
      if(state.phase==='enemy'){p.fillStyle='#785047';p.fillRect(0,0,w,1);p.fillRect(0,h-1,w,1);}
    }
    drawWeapon(state,now){
      if(!this.weaponTile)return;const p=this.ctx,w=this.width,h=this.height,
        elapsed=state.shotAt>0?now-state.shotAt:Infinity,recoil=this.reducedMotion?0:elapsed<90?3:elapsed<170?1:0,
        width=Math.max(1,Math.round(Math.min(w*.47,h*.8))),height=Math.round(width*125/160),
        x=Math.round(w*.61),y=Math.round(h-height*.8+recoil);
      p.imageSmoothingEnabled=false;p.drawImage(this.weaponTile,x,y,width,height);
      if(elapsed>=0&&elapsed<95){
        const legacy=!this.weapon.src.includes('/pixel/'),mx=Math.round(x+width*(legacy?.17:.1)),my=Math.round(y+height*(legacy?.14:.1));
        p.fillStyle='#d69a58';p.fillRect(mx-4,my-1,8,3);p.fillRect(mx-1,my-4,3,8);p.fillStyle='#efd18b';p.fillRect(mx-1,my-1,3,3);
        const target=this.layout(state.enemies).find(e=>e.id===(state.shotTarget??state.target));
        if(target){p.strokeStyle='#b29a70';p.lineWidth=1;p.beginPath();p.moveTo(mx,my);p.lineTo(target.x,Math.round(target.foot-target.height*.55));p.stroke();}
      }
    }
  }
  window.BattlefieldScene=BattlefieldScene;
})();
