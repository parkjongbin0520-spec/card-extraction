/* Fixed-camera industrial diorama. Original plates share a floor, light and depth. */
(() => {
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  class BattlefieldScene {
    constructor(canvas) {
      this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.width=1;this.height=1;
      this.hover=0;this.look=0;this.tiles=[];this.edges=[];this.shadows=[];
      this.plates=this.loadImage('assets/generated/field-plates.webp','assets/field-plates.svg',()=>this.preparePlates());
      this.weapon=this.loadImage('assets/generated/weapon.webp','assets/weapon-plate.svg',()=>this.prepareWeapon());
      this.environments=Array.from({length:3},(_,zone)=>this.loadImage(`assets/generated/environment-${zone}.webp`,null,()=>{this.roomKey='';}));
      this.reducedMotion=matchMedia('(prefers-reduced-motion:reduce)').matches;
      this.texture=document.createElement('canvas');this.texture.width=this.texture.height=128;
      const p=this.texture.getContext('2d');let seed=17;
      for(let i=0;i<2400;i++){seed=(seed*1664525+1013904223)>>>0;const x=seed%128;seed=(seed*1664525+1013904223)>>>0;const y=seed%128;p.fillStyle=i%3?'#d0d3c81a':'#080e1455';p.fillRect(x,y,i%5?1:3,1);}
      this.grain=this.ctx.createPattern(this.texture,'repeat');
      this.roomCache=document.createElement('canvas');this.roomKey='';
      new ResizeObserver(()=>this.resize()).observe(canvas);this.resize();
    }
    loadImage(source,fallback,onload){
      const image=new Image();image.decoding='async';image.onload=onload;
      image.onerror=()=>{image.onerror=null;if(fallback)image.src=fallback;};
      image.src=source;return image;
    }
    get ready(){return this.plates.complete&&this.plates.naturalWidth>0&&this.weapon.complete&&this.weapon.naturalWidth>0&&this.tiles.length===6;}
    preparePlates(){
      // Bake a common key light into each transparent plate once, not every frame.
      for(let tile=0;tile<6;tile++){
        const image=document.createElement('canvas');image.width=256;image.height=384;const q=image.getContext('2d');
        q.imageSmoothingEnabled=true;q.imageSmoothingQuality='high';
        const sourceWidth=this.plates.naturalWidth/6;
        q.drawImage(this.plates,tile*sourceWidth,0,sourceWidth,this.plates.naturalHeight,0,0,256,384);
        q.globalCompositeOperation='source-atop';const light=q.createLinearGradient(250,0,10,360);light.addColorStop(0,'#dcebf31f');light.addColorStop(.45,'#d9e3df04');light.addColorStop(1,'#12223224');q.fillStyle=light;q.fillRect(0,0,256,384);q.globalCompositeOperation='source-over';
        this.tiles[tile]=image;
        for(const [list,color] of [[this.edges,'#252d27'],[this.shadows,'#090e13']]){
          const mask=document.createElement('canvas');mask.width=256;mask.height=384;const m=mask.getContext('2d');m.drawImage(image,0,0);m.globalCompositeOperation='source-in';m.fillStyle=color;m.fillRect(0,0,256,384);list[tile]=mask;
        }
      }
    }
    prepareWeapon(){
      this.weaponTile=document.createElement('canvas');this.weaponTile.width=this.weapon.naturalWidth;this.weaponTile.height=this.weapon.naturalHeight;
      const q=this.weaponTile.getContext('2d');q.drawImage(this.weapon,0,0);q.globalCompositeOperation='source-atop';
      const light=q.createLinearGradient(this.weaponTile.width,0,0,this.weaponTile.height);light.addColorStop(0,'#b7c8d31a');light.addColorStop(.5,'#8f9b9004');light.addColorStop(1,'#10202e24');q.fillStyle=light;q.fillRect(0,0,this.weaponTile.width,this.weaponTile.height);
    }
    castShadow(a,e){
      const p=this.ctx,tile=e.drone?2:e.armor?1:0,mask=this.shadows[tile];if(!mask)return;
      p.save();p.translate(a.x,a.foot);p.globalAlpha=e.drone?.17:.27;
      // Flatten the same alpha silhouette onto the floor, away from the overhead light.
      p.transform(1,.035,.52,e.drone?.105:.15,0,0);p.drawImage(mask,-a.width/2,-a.height*370/384,a.width,a.height);p.restore();
    }
    resize(){const r=this.canvas.getBoundingClientRect();this.width=Math.max(1,Math.min(1280,Math.round(r.width)));this.height=Math.max(1,Math.round(r.height*this.width/Math.max(1,r.width)));this.canvas.width=this.width;this.canvas.height=this.height;}
    project(x,y,z){const h=this.height;return {x:this.width/2+(x+this.look*.08)*h*1.55/z,y:(this.horizon??h*.43)+(1.4-y)*h*1.55/z};}
    quad(points,fill,stroke){const p=this.ctx;p.beginPath();points.forEach(([x,y,z],i)=>{const s=this.project(x,y,z);i?p.lineTo(s.x,s.y):p.moveTo(s.x,s.y);});p.closePath();p.fillStyle=fill;p.fill();if(stroke){p.strokeStyle=stroke;p.lineWidth=1;p.stroke();}}
    line(points,color,width=1){const p=this.ctx;p.beginPath();points.forEach(([x,y,z],i)=>{const s=this.project(x,y,z);i?p.lineTo(s.x,s.y):p.moveTo(s.x,s.y);});p.strokeStyle=color;p.lineWidth=width;p.lineJoin='round';p.stroke();}
    room(zone,time,cleared) {
      // The architectural stage does not animate. Bake materials and scars once per layout.
      const key=[zone,this.width,this.height,Math.round(this.horizon||0),!!cleared].join(':');
      if(this.roomKey!==key){
        this.roomCache.width=this.width;this.roomCache.height=this.height;
        const context=this.ctx,look=this.look;this.ctx=this.roomCache.getContext('2d',{alpha:false});this.look=0;
        try{this.buildRoom(zone,cleared);this.roomKey=key;}finally{this.ctx=context;this.look=look;}
      }
      this.ctx.drawImage(this.roomCache,0,0);
    }
    buildRoom(zone,cleared) {
      const p=this.ctx,w=this.width,h=this.height;
      const environment=this.environments[zone]||this.environments[0];
      if(environment?.complete&&environment.naturalWidth){
        // Match the painted vanishing line to the same horizon as the upright plates.
        // This entire crop and material pass is baked once, including on mobile.
        const scale=Math.max(w/environment.naturalWidth,h/environment.naturalHeight),
          width=environment.naturalWidth*scale,height=environment.naturalHeight*scale,
          y=clamp((this.horizon??h*.43)-height*.42,h-height,0);
        p.imageSmoothingEnabled=true;p.imageSmoothingQuality='high';
        p.drawImage(environment,(w-width)/2,y,width,height);
        const shade=p.createLinearGradient(0,0,0,h);
        shade.addColorStop(0,'#07101014');shade.addColorStop(.55,'#18261e00');shade.addColorStop(1,'#0a100e26');
        p.fillStyle=shade;p.fillRect(0,0,w,h);
        if(cleared){p.fillStyle='#a7ba8308';p.fillRect(0,0,w,h);}
        p.fillStyle=this.grain;p.globalAlpha=.12;p.fillRect(0,0,w,h);p.globalAlpha=1;
        return;
      }
      const themes=[['#121d25','#69716c','#414b47'],['#192125','#74716a','#4e5147'],['#101a22','#5c6969','#3c4949']],theme=themes[zone]||themes[0];
      const sky=p.createLinearGradient(0,0,0,h);sky.addColorStop(0,theme[0]);sky.addColorStop(.6,theme[1]);sky.addColorStop(1,'#1e2827');p.fillStyle=sky;p.fillRect(0,0,w,h);
      // Large poured-concrete slabs, expansion joints, oil and old tire tracks.
      for(let z=16;z>=1;z-=1.5)for(let x=-9;x<9;x+=1.5){
        const seed=Math.abs(Math.sin(x*17+z*23+zone*7)),c=45+Math.floor(seed*13);
        this.quad([[x,0,z],[x+1.5,0,z],[x+1.5,0,z+1.5],[x,0,z+1.5]],`rgb(${c+1},${c+7},${c+5})`,'#111b2080');
        if(seed>.5)this.quad([[x+.1,.002,z+.2],[x+1.3,.002,z+.13],[x+1.12,.002,z+.83],[x+.32,.002,z+1.19]],'#171f2240');
        if(seed>.8)this.line([[x+.3,.004,z],[x+.54,.004,z+.45],[x+.37,.004,z+.8],[x+.7,.004,z+1.5]],'#131d2355');
      }
      for(const x of [-1.9,-1.6,1.6,1.9])this.quad([[x,.003,1],[x+.09,.003,1],[x+.09,.003,13],[x,.003,13]],'#111b1e36');
      // Rough back wall: patched slabs above a worn olive service band.
      this.quad([[-6,0,14],[6,0,14],[6,4,14],[-6,4,14]],theme[1],'#8b979055');
      for(let x=-6;x<6;x+=2){
        this.quad([[x+.04,.08,13.98],[x+1.96,.08,13.98],[x+1.96,3.94,13.98],[x+.04,3.94,13.98]],x%4?'#747b72':'#626d68','#c1c8b51f');
        this.quad([[x+.04,.1,13.96],[x+1.96,.1,13.96],[x+1.96,1.15,13.96],[x+.04,1.15,13.96]],theme[2]);
        this.quad([[x+.05,.12,13.93],[x+1.96,.12,13.93],[x+1.96,.22,13.93],[x+.05,.22,13.93]],'#202c2c');
        // Each panel has its own chipped paint and damp seam.
        this.quad([[x+.06,.15,13.92],[x+.19,.15,13.92],[x+.13,3.91,13.92],[x+.07,3.91,13.92]],'#22302c66');
        for(let i=0;i<6;i++){
          const y=.32+i*.48,dx=.23+(i*13%7)*.16;
          this.quad([[x+dx,y,13.91],[x+dx+.24,y+.02,13.91],[x+dx+.2,y+.075,13.91],[x+dx-.03,y+.045,13.91]],i%2?'#a0a49145':'#2635324d');
        }
      }
      // Recessed loading shutter with a rusted frame and a single large sector stencil.
      this.quad([[-1.8,0,13.83],[1.8,0,13.83],[1.8,3.35,13.83],[-1.8,3.35,13.83]],'#1a2529','#b0a28a');
      this.quad([[-1.64,.04,13.79],[1.64,.04,13.79],[1.64,3.2,13.79],[-1.64,3.2,13.79]],'#775b43');
      this.quad([[-1.47,.05,13.73],[1.47,.05,13.73],[1.47,3.1,13.73],[-1.47,3.1,13.73]],cleared?'#526455':'#535e54','#9b9e88');
      for(let y=.2;y<3.1;y+=.23){
        this.quad([[-1.45,y,13.69],[1.45,y,13.69],[1.45,y+.035,13.69],[-1.45,y+.035,13.69]],'#1d2d2d');
        this.line([[-1.45,y+.05,13.68],[1.45,y+.05,13.68]],'#a0a58a45');
      }
      this.quad([[-.05,.12,13.64],[.05,.12,13.64],[.05,3.06,13.64],[-.05,3.06,13.64]],'#253532');
      const door=this.project(0,1.9,13.6);p.fillStyle='#d4d2ad';p.font=`900 ${h*.077}px monospace`;p.textAlign='center';p.fillText(`0${zone+1}`,door.x,door.y);p.textAlign='left';
      for(const side of [-1,1]){
        this.line([[side*1.61,.1,13.58],[side*1.61,3.24,13.58],[side*.3,3.24,13.58]],'#293831',Math.max(1,h*.007));
        const bolt=this.project(side*1.6,2.9,13.52);p.fillStyle='#a7ad99';p.fillRect(bolt.x,bolt.y,2,2);
      }
      // Opaque, dusty high windows supply the cold key light.
      this.quad([[2.45,2.05,13.84],[5.35,2.05,13.84],[5.35,3.68,13.84],[2.45,3.68,13.84]],'#25393f','#a2b4ad');
      for(let x=2.56;x<5.2;x+=.65)for(let y=2.16;y<3.6;y+=.66){
        this.quad([[x,y,13.76],[x+.55,y,13.76],[x+.55,y+.53,13.76],[x,y+.53,13.76]],x>4.2&&y<2.5?'#50645f':'#9cb8bb','#20353a');
        this.line([[x+.04,y+.04,13.72],[x+.48,y+.39,13.72]],'#d4d9c23b');
      }
      // Conduits, shut-off boxes and hanging cable use the wall's real projection.
      this.line([[-5.5,3.2,13.7],[-3.1,3.2,13.7],[-3.1,1.6,13.7],[-2.4,1.6,13.7]],'#17282a',Math.max(3,h*.012));
      this.line([[-5.5,3.21,13.67],[-3.09,3.21,13.67],[-3.09,1.61,13.67],[-2.4,1.61,13.67]],'#9b9f8270',Math.max(1,h*.003));
      this.quad([[-4.8,.6,13.64],[-4.0,.6,13.64],[-4.0,1.55,13.64],[-4.8,1.55,13.64]],'#33423d','#9a9e86');
      this.quad([[-4.68,.74,13.59],[-4.13,.74,13.59],[-4.13,1.39,13.59],[-4.68,1.39,13.59]],'#57624e','#182c2c');
      this.line([[-4.4,1.6,13.55],[-4.2,1.9,13.55],[-4.55,2.3,13.55],[-4.3,2.6,13.55]],'#101f24',Math.max(1,h*.003));
      // A restrained amber emergency lamp contrasts with the window light.
      this.quad([[-4.85,2.45,13.58],[-4.1,2.45,13.58],[-4.1,2.78,13.58],[-4.85,2.78,13.58]],'#202b2a','#979b87');
      this.quad([[-4.75,2.51,13.52],[-4.2,2.51,13.52],[-4.2,2.71,13.52],[-4.75,2.71,13.52]],cleared?'#b7c9a0':'#e2a85f');
      const lamp=this.project(-4.48,2.6,13.48),amber=p.createRadialGradient(lamp.x,lamp.y,0,lamp.x,lamp.y,h*.23);amber.addColorStop(0,'#efb46336');amber.addColorStop(1,'#efb46300');p.fillStyle=amber;p.fillRect(lamp.x-h*.23,lamp.y-h*.23,h*.46,h*.46);
      // Side walls carry lower service paint, impact scars and long utility pipes.
      for(let z=13;z>=1;z--)for(const side of [-1,1]){
        const x=6*side,c=58+(z%3)*7;
        this.quad([[x,0,z],[x,0,z+1],[x,4,z+1],[x,4,z]],`rgb(${c+1},${c+8},${c+7})`,'#b8c0ab20');
        this.quad([[x-.016*side,.15,z],[x-.016*side,.15,z+1],[x-.016*side,1.12,z+1],[x-.016*side,1.12,z]],'#3b4c44','#8e9c7522');
        this.quad([[x-.03*side,.32,z],[x-.03*side,.32,z+1],[x-.03*side,.43,z+1],[x-.03*side,.43,z]],'#1b2b2c');
        this.quad([[x-.04*side,2.92,z],[x-.04*side,2.92,z+1],[x-.04*side,3.07,z+1],[x-.04*side,3.07,z]],'#273b3e','#9aa99166');
        this.quad([[x-.05*side,3.16,z],[x-.05*side,3.16,z+1],[x-.05*side,3.22,z+1],[x-.05*side,3.22,z]],'#887962');
        if(z%3===0){
          this.line([[x-.06*side,.58,z+.14],[x-.06*side,1.92,z+.39],[x-.06*side,2.43,z+.13]],'#1c2a2d80');
          this.quad([[x-.08*side,1.72,z+.37],[x-.08*side,1.72,z+.48],[x-.08*side,2.08,z+.47],[x-.08*side,2.08,z+.39]],'#35433b');
        }
      }
      this.quad([[-6,4,.7],[6,4,.7],[6,4,14],[-6,4,14]],'#202e31');
      for(const z of [3.5,7,10.5,13]){
        this.quad([[-6,3.82,z],[6,3.82,z],[6,3.82,z+.25],[-6,3.82,z+.25]],'#3c4c4b','#81938d55');
        for(const side of [-1,1])this.line([[side*5.6,3.9,z],[side*3.4,3.23,z],[side*1.4,3.9,z]],'#111f28',Math.max(1,h*.006));
        this.quad([[-1.3,3.73,z],[1.3,3.73,z],[1.3,3.73,z+.15],[-1.3,3.73,z+.15]],z===7?'#363e39':'#b7c6be','#41544f');
      }
      // Window light falls across the common floor; the plates later cast shadows over it.
      this.quad([[2.7,.008,13],[-3.9,.008,3.4],[-2.55,.008,2.8],[4.8,.008,13]],'#b6ced111');
      this.quad([[3.4,.009,13],[-1.75,.009,3.1],[-1.1,.009,2.9],[4.0,.009,13]],'#d8e4dc10');
      for(const side of [-1,1]){
        this.line([[side*3.75,.012,2],[side*3.75,.012,11.8]],'#b1ae7c55',2);
        for(let z=5;z<12;z+=1.5)this.quad([[side*3.8,.014,z],[side*4.04,.014,z],[side*4.04,.014,z+.52],[side*3.8,.014,z+.52]],'#bfaa6273');
      }
      // Scattered impacts and streaks live in the architecture cache, not the frame loop.
      for(let i=0;i<27;i++){
        const x=-5.5+(i*1.73%11),y=.4+(i*.47%2.6),s=.018+(i%3)*.008;
        if(Math.abs(x)<1.85||x>2.35&&y>1.95)continue;
        const a=this.project(x,y,13.62),b=this.project(x+.05,y+.12,13.62);p.fillStyle='#1a2b2e88';p.beginPath();p.ellipse(a.x,a.y,Math.max(1,h*s*.1),Math.max(1,h*s*.07),0,0,Math.PI*2);p.fill();p.strokeStyle='#92998040';p.beginPath();p.moveTo(a.x,a.y);p.lineTo(b.x,b.y);p.stroke();
      }
      const cold=p.createRadialGradient(w*.79,h*.26,0,w*.7,h*.4,h*.9);cold.addColorStop(0,'#bddee323');cold.addColorStop(1,'#bddee300');p.fillStyle=cold;p.fillRect(0,0,w,h);
      p.fillStyle=this.grain;p.globalAlpha=.8;p.fillRect(0,0,w,h);p.globalAlpha=1;
    }
    plate(tile,x,foot,height,opacity=1,tilt=0){
      if(!this.plates.naturalWidth)return;const p=this.ctx,width=height*256/384;
      p.save();p.translate(x,foot);p.rotate(tilt);p.globalAlpha=opacity*Math.min(1,.9+height/this.height*.15);p.imageSmoothingEnabled=true;p.imageSmoothingQuality='high';
      const edge=Math.max(1,Math.min(4,height*.012));
      if(this.edges[tile])p.drawImage(this.edges[tile],-width/2+edge,-height*370/384+edge,width,height);
      if(this.tiles[tile])p.drawImage(this.tiles[tile],-width/2,-height*370/384,width,height);
      else p.drawImage(this.plates,tile*256,0,256,384,-width/2,-height*370/384,width,height);
      p.restore();
    }
    layout(enemies){
      const w=this.width,h=this.height,n=enemies.length,places=n===1?[.5]:n===2?[.32,.68]:[.23,.5,.77];
      const heightLimit=Math.max(24,Math.min(h*.56,(h-(this.labelSpace||80)-14)*.94,w/(n+.65)*1.6));
      this.horizon=Math.max(h*.43,(this.labelSpace||80)+heightLimit*.264);
      return enemies.map((e,i)=>{
        const height=heightLimit*(e.drone?.94:1),z=h*1.55*2/height,worldX=(places[i]-.5)*w*z/(h*1.55),point=this.project(worldX,0,z);
        return {id:e.id,x:point.x,foot:point.y,height,width:height*256/384,z,worldX};
      });
    }
    getTargets(enemies){return this.layout(enemies).map(s=>({id:s.id,left:(s.x-s.width*.44)/this.width*100,top:(s.foot-s.height*.92)/this.height*100,width:s.width*.88/this.width*100,height:s.height*.92/this.height*100}));}
    draw(state,timestamp) {
      const p=this.ctx,w=this.width,h=this.height,now=timestamp||performance.now();
      this.look=this.reducedMotion?0:this.look+(this.hover-this.look)*.08;
      const actors=this.layout(state.enemies),items=[];
      this.room(state.zone,state.time,state.mode==='cleared'||state.mode==='won');
      const lamp=p.createRadialGradient(w*.78,h*.16,0,w*.72,h*.4,h*.85);lamp.addColorStop(0,'#c4dce51c');lamp.addColorStop(.5,'#d1dedb08');lamp.addColorStop(1,'#d1dedb00');p.fillStyle=lamp;p.fillRect(0,0,w,h);
      for(let i=0;i<actors.length;i++)if(state.enemies[i].hp>0)this.castShadow(actors[i],state.enemies[i]);
      // Three kinds of midground prop plates; the nearer columns frame the scene.
      for(const side of [-1,1]){
        for(const z of [7.7,12]){const pos=this.project(side*Math.min(4.6,w/(h*1.55)*6),0,z);items.push({z,draw:()=>this.plate(4,pos.x,pos.y,h*1.55*3.4/z)});}
        const z=3.9,pos=this.project(side*Math.min(3.8,w*3.9/(h*1.55)*.55),0,z);items.push({z,draw:()=>this.plate(3,pos.x,pos.y,h*1.55*1.15/z)});
      }
      const consolePoint=this.project(Math.min(3.7,w*10/(h*1.55)*.4),0,10);items.push({z:10,draw:()=>this.plate(5,consolePoint.x,consolePoint.y,h*1.55*2.0/10)});
      for(let i=0;i<actors.length;i++){
        const a=actors[i],e=state.enemies[i];
        if(e.hp<=0&&now-e.deadAt>650)continue;
        items.push({z:a.z,draw:()=>{
          const death=e.hp<=0?clamp((now-e.deadAt)/650,0,1):0,hit=e.hitAt>0?clamp(1-(now-e.hitAt)/250,0,1):0,attack=e.attackAt>0?clamp(1-Math.abs(now-e.attackAt-140)/180,0,1):0;
          const selected=(state.dragTarget>=0?state.dragTarget:state.target)===e.id&&e.hp>0,shake=this.reducedMotion?0:Math.sin(now*.065)*hit*5;
          // Grounding shadows remain independent from the upright sprite.
          p.fillStyle=e.drone?'#080e0b77':'#080e0bb5';p.beginPath();p.ellipse(a.x,a.foot-2,a.width*.43,a.height*(e.drone?.045:.035),0,0,Math.PI*2);p.fill();
          if(selected&&state.mode==='combat'){
            p.strokeStyle=state.selected>=0||state.dragCard?'#e6a867':'#c0c795';p.lineWidth=1.5;p.setLineDash([6,5]);p.beginPath();p.ellipse(a.x,a.foot,a.width*.54,a.height*.065,0,0,Math.PI*2);p.stroke();p.setLineDash([]);
          }
          const bob=this.reducedMotion?0:e.drone?Math.sin(now*.0016+i)*5:0;
          const breath=this.reducedMotion?0:Math.sin(now*.00115+i)*.008,idleTilt=this.reducedMotion?0:Math.sin(now*.0009+i)*.008;
          p.save();p.translate(0,a.foot);p.scale(1,1-death*.85);p.translate(0,-a.foot);
          this.plate(e.drone?2:e.armor?1:0,a.x+shake,a.foot+bob,a.height*(1+breath+(this.reducedMotion?0:attack*.1)),1-death,idleTilt+(this.reducedMotion?0:attack*.025)*(i%2?1:-1));p.restore();
          if(state.mode==='combat'&&e.hp>0){
            const charging=e.action?e.action.type==='attack'&&e.wait>0:Array.isArray(e.pattern)&&e.pattern[(state.turn-1)%e.pattern.length]==='charge',pulse=this.reducedMotion?1:.7+Math.sin(now*.004+i)*.3;
            if(charging){const ey=a.foot-a.height*(e.drone?.585:.815),r=Math.max(5,a.height*.065);const glow=p.createRadialGradient(a.x,ey,0,a.x,ey,r);glow.addColorStop(0,`rgba(255,192,92,${.36*pulse})`);glow.addColorStop(1,'#ffbd6600');p.fillStyle=glow;p.fillRect(a.x-r,ey-r,r*2,r*2);}
          }
          if(hit&&e.hp>0){p.fillStyle='#f3d2a3';p.font=`bold ${Math.max(17,h*.035)}px monospace`;p.textAlign='center';p.fillText(`−${e.lastDamage}`,a.x+a.width*.42,a.foot-a.height*.6-(1-hit)*25);p.textAlign='left';}
          if(e.shield&&e.hp>0){p.strokeStyle='#d4d9b477';p.lineWidth=3;p.beginPath();p.ellipse(a.x,a.foot-a.height*.42,a.width*.51,a.height*.42,0,0,Math.PI*2);p.stroke();}
        }});
      }
      items.sort((a,b)=>b.z-a.z).forEach(s=>s.draw());
      // Fine dust and haze separate the back wall from the silhouettes.
      p.fillStyle='#d5e1d42b';for(let i=0;i<17;i++){const drift=this.reducedMotion?0:state.time*.8,x=(i*137.7+(this.reducedMotion?0:Math.sin(state.time*.15+i)*18))%w,y=(i*57.3+drift)%h;p.fillRect(x,y,1,1);}
      const vignette=p.createRadialGradient(w*.5,h*.5,h*.12,w*.5,h*.5,Math.max(w*.62,h*.8));vignette.addColorStop(0,'#08131a00');vignette.addColorStop(.6,'#08131a12');vignette.addColorStop(1,'#050d1480');p.fillStyle=vignette;p.fillRect(0,0,w,h);
      this.drawWeapon(state,now);
      if(state.mode==='briefing') {const fade=p.createLinearGradient(0,0,w,0);fade.addColorStop(0,'#141914ef');fade.addColorStop(.45,'#141914b8');fade.addColorStop(1,'#14191400');p.fillStyle=fade;p.fillRect(0,0,w,h);}
      if(state.phase==='enemy'){p.fillStyle='#8c46240b';p.fillRect(0,0,w,h);}
    }
    drawWeapon(state,now){
      if(!this.weapon.naturalWidth)return;const p=this.ctx,w=this.width,h=this.height;
      const recoil=clamp(1-(now-state.shotAt)/230,0,1),width=Math.min(w*.47,h*.8),height=width*500/640;
      const x=w*.61,y=h-height*.8+recoil*12;
      p.imageSmoothingEnabled=true;p.imageSmoothingQuality='high';p.drawImage(this.weaponTile||this.weapon,x,y,width,height);
      if(now-state.shotAt<95){
        const raster=this.weapon.src.includes('/generated/'),mx=x+width*(raster?.10:.17),my=y+height*(raster?.10:.14);p.save();p.translate(mx,my);p.fillStyle='#ffe3a0';p.shadowColor='#ffb855';p.shadowBlur=25;p.beginPath();p.moveTo(0,-31);p.lineTo(9,-10);p.lineTo(27,-18);p.lineTo(13,0);p.lineTo(30,14);p.lineTo(7,9);p.lineTo(-7,26);p.lineTo(-9,6);p.lineTo(-30,-4);p.lineTo(-10,-10);p.closePath();p.fill();p.restore();
        const target=this.layout(state.enemies).find(e=>e.id===(state.shotTarget??state.target));if(target){p.strokeStyle='#f8d89588';p.lineWidth=1;p.beginPath();p.moveTo(mx,my);p.lineTo(target.x,target.foot-target.height*.55);p.stroke();}
      }
    }
  }
  window.BattlefieldScene=BattlefieldScene;
})();
