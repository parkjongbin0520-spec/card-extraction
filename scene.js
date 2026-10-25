/* Fixed-camera diorama. Original SVG plates are composited in a shared perspective space. */
(() => {
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  class BattlefieldScene {
    constructor(canvas) {
      this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.width=1;this.height=1;
      this.hover=0;this.look=0;this.tiles=[];this.edges=[];this.shadows=[];this.plates=new Image();this.plates.onload=()=>this.preparePlates();this.plates.src='assets/field-plates.svg';
      this.weapon=new Image();this.weapon.src='assets/weapon-plate.svg';
      this.reducedMotion=matchMedia('(prefers-reduced-motion:reduce)').matches;
      this.texture=document.createElement('canvas');this.texture.width=this.texture.height=128;
      const p=this.texture.getContext('2d');let seed=17;
      for(let i=0;i<2000;i++){seed=(seed*1664525+1013904223)>>>0;const x=seed%128;seed=(seed*1664525+1013904223)>>>0;const y=seed%128;p.fillStyle=i%3?'#d4c6a312':'#060b0966';p.fillRect(x,y,i%5?1:3,1);}
      this.grain=this.ctx.createPattern(this.texture,'repeat');
      new ResizeObserver(()=>this.resize()).observe(canvas);this.resize();
    }
    get ready(){return this.plates.complete&&this.plates.naturalWidth>0&&this.weapon.complete&&this.weapon.naturalWidth>0&&this.tiles.length===6;}
    preparePlates(){
      // Bake a common key light into each transparent plate once, not every frame.
      for(let tile=0;tile<6;tile++){
        const image=document.createElement('canvas');image.width=256;image.height=384;const q=image.getContext('2d');
        q.drawImage(this.plates,tile*256,0,256,384,0,0,256,384);
        q.globalCompositeOperation='source-atop';const light=q.createLinearGradient(0,0,250,300);light.addColorStop(0,'#ffe5aa55');light.addColorStop(.45,'#ffe5aa08');light.addColorStop(1,'#0c202f55');q.fillStyle=light;q.fillRect(0,0,256,384);q.globalCompositeOperation='source-over';
        this.tiles[tile]=image;
        for(const [list,color] of [[this.edges,'#3c2e1e'],[this.shadows,'#08100d']]){
          const mask=document.createElement('canvas');mask.width=256;mask.height=384;const m=mask.getContext('2d');m.drawImage(image,0,0);m.globalCompositeOperation='source-in';m.fillStyle=color;m.fillRect(0,0,256,384);list[tile]=mask;
        }
      }
    }
    castShadow(a,e){
      const p=this.ctx,tile=e.drone?2:e.armor?1:0,mask=this.shadows[tile];if(!mask)return;
      p.save();p.translate(a.x,a.foot);p.globalAlpha=e.drone?.17:.27;
      // Flatten the same alpha silhouette onto the floor, away from the overhead light.
      p.transform(1,.035,-.62,e.drone?.105:.15,0,0);p.drawImage(mask,-a.width/2,-a.height*370/384,a.width,a.height);p.restore();
    }
    resize(){const r=this.canvas.getBoundingClientRect();this.width=Math.max(1,Math.min(1280,Math.round(r.width)));this.height=Math.max(1,Math.round(r.height*this.width/Math.max(1,r.width)));this.canvas.width=this.width;this.canvas.height=this.height;}
    project(x,y,z){const h=this.height;return {x:this.width/2+(x+this.look*.08)*h*1.55/z,y:(this.horizon??h*.43)+(1.4-y)*h*1.55/z};}
    quad(points,fill,stroke){const p=this.ctx;p.beginPath();points.forEach(([x,y,z],i)=>{const s=this.project(x,y,z);i?p.lineTo(s.x,s.y):p.moveTo(s.x,s.y);});p.closePath();p.fillStyle=fill;p.fill();if(stroke){p.strokeStyle=stroke;p.lineWidth=1;p.stroke();}}
    room(zone,time,cleared) {
      const p=this.ctx,w=this.width,h=this.height;
      const backgrounds=[['#171c17','#444b38'],['#211e16','#504731'],['#181a18','#414a42']][zone];
      const sky=p.createLinearGradient(0,0,0,h);sky.addColorStop(0,backgrounds[0]);sky.addColorStop(.55,backgrounds[1]);sky.addColorStop(1,'#161b15');p.fillStyle=sky;p.fillRect(0,0,w,h);
      for(let z=16;z>=1;z--)for(let x=-9;x<9;x++){
        const s=(x*x*13+z*23+zone*7)%13,c=35+s;
        this.quad([[x,0,z],[x+1,0,z],[x+1,0,z+1],[x,0,z+1]],`rgb(${c+8},${c+12},${c+2})`,'#a6a27a18');
        if((x*7+z*11)%17===0)this.quad([[x+.15,.002,z+.2],[x+.75,.002,z+.16],[x+.8,.002,z+.7],[x+.3,.002,z+.8]],'#111c1650');
      }
      this.quad([[-6,0,14],[6,0,14],[6,4,14],[-6,4,14]],'#4b503d','#9b987255');
      for(let x=-6;x<6;x++){
        this.quad([[x+.06,.18,13.98],[x+.94,.18,13.98],[x+.94,3.85,13.98],[x+.06,3.85,13.98]],x%2?'#525641':'#434c39','#b2ab7433');
      }
      // Recessed blast door: the farthest, low-contrast scenic plate.
      this.quad([[-1.7,0,13.8],[1.7,0,13.8],[1.7,3.5,13.8],[-1.7,3.5,13.8]],'#222c23','#a3986a');
      this.quad([[-1.45,.1,13.7],[1.45,.1,13.7],[1.45,3.22,13.7],[-1.45,3.22,13.7]],'#62664a','#9f9d70');
      for(let y=.2;y<3.1;y+=.34)this.quad([[-1.36,y,13.65],[1.36,y,13.65],[1.36,y+.07,13.65],[-1.36,y+.07,13.65]],'#29392c');
      this.quad([[-.04,.1,13.6],[.04,.1,13.6],[.04,3.25,13.6],[-.04,3.25,13.6]],'#1b281f');
      const door=this.project(0,2.3,13.5);p.fillStyle='#d0c399';p.font=`900 ${h*.065}px monospace`;p.textAlign='center';p.fillText(`0${zone+1}`,door.x,door.y);p.font=`${Math.max(6,h*.013)}px monospace`;p.fillStyle='#bab895';p.fillText(cleared?'EXIT SECURED':'RESTRICTED',door.x,door.y+h*.026);p.textAlign='left';
      // Walls are fixed planes; recesses and pipes share their perspective.
      for(let z=13;z>=1;z--)for(const side of [-1,1]){
        const x=6*side,c=41+(z%3)*6;
        this.quad([[x,0,z],[x,0,z+1],[x,4,z+1],[x,4,z]],`rgb(${c+5},${c+12},${c-2})`,'#afb08a44');
        this.quad([[x-.015*side,.2,z+.08],[x-.015*side,.2,z+.92],[x-.015*side,2.9,z+.92],[x-.015*side,2.9,z+.08]],z%2?'#26382a':'#394833','#b8b28222');
        this.quad([[x-.025*side,.78,z],[x-.025*side,.78,z+1],[x-.025*side,.94,z+1],[x-.025*side,.94,z]],'#b08049');
        this.quad([[x-.03*side,3.23,z],[x-.03*side,3.23,z+1],[x-.03*side,3.36,z+1],[x-.03*side,3.36,z]],'#85856a');
      }
      this.quad([[-6,4,.7],[6,4,.7],[6,4,14],[-6,4,14]],'#222c23');
      for(const z of [3,6,9,12]){
        this.quad([[-6,3.84,z],[6,3.84,z],[6,3.84,z+.3],[-6,3.84,z+.3]],'#646b51','#adb18b55');
        this.quad([[-1.7,3.78,z],[1.7,3.78,z],[1.7,3.78,z+.13],[-1.7,3.78,z+.13]],zone===2?'#d4bb8a':'#e4dfb0');
      }
      const glow=p.createRadialGradient(w*.5,h*.24,0,w*.5,h*.3,h*.9);glow.addColorStop(0,'#cfbe7825');glow.addColorStop(1,'#cfbe7800');p.fillStyle=glow;p.fillRect(0,0,w,h);
      // Oil and painted hazard marks are on the floor, below actors.
      for(const side of [-1,1])for(let z=2;z<12;z+=1.3)this.quad([[side*3.9,.004,z],[side*4.2,.004,z],[side*4.2,.004,z+.62],[side*3.9,.004,z+.62]],'#b2994b55');
      p.fillStyle=this.grain;p.globalAlpha=.65;p.fillRect(0,0,w,h);p.globalAlpha=1;
    }
    plate(tile,x,foot,height,opacity=1,tilt=0){
      if(!this.plates.naturalWidth)return;const p=this.ctx,width=height*256/384;
      p.save();p.translate(x,foot);p.rotate(tilt);p.globalAlpha=opacity*Math.min(1,.77+height/this.height*.38);p.imageSmoothingEnabled=false;
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
      const lamp=p.createRadialGradient(w*.28,h*.16,0,w*.32,h*.4,h*.85);lamp.addColorStop(0,'#f1cf8d22');lamp.addColorStop(.5,'#e9c27b0b');lamp.addColorStop(1,'#e9c27b00');p.fillStyle=lamp;p.fillRect(0,0,w,h);
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
          const death=e.hp<=0?clamp((now-e.deadAt)/650,0,1):0,hit=clamp(1-(now-(e.hitAt||0))/250,0,1),attack=clamp(1-Math.abs(now-(e.attackAt||0)-140)/180,0,1);
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
            const charging=e.pattern[(state.turn-1)%e.pattern.length]==='charge',pulse=this.reducedMotion?1:.7+Math.sin(now*.004+i)*.3;
            if(charging){const ey=a.foot-a.height*(e.drone?.585:.815),r=Math.max(5,a.height*.065);const glow=p.createRadialGradient(a.x,ey,0,a.x,ey,r);glow.addColorStop(0,`rgba(255,192,92,${.36*pulse})`);glow.addColorStop(1,'#ffbd6600');p.fillStyle=glow;p.fillRect(a.x-r,ey-r,r*2,r*2);}
          }
          if(hit&&e.hp>0){p.fillStyle='#f3d2a3';p.font=`bold ${Math.max(17,h*.035)}px monospace`;p.textAlign='center';p.fillText(`−${e.lastDamage}`,a.x+a.width*.42,a.foot-a.height*.6-(1-hit)*25);p.textAlign='left';}
          if(e.shield&&e.hp>0){p.strokeStyle='#d4d9b477';p.lineWidth=3;p.beginPath();p.ellipse(a.x,a.foot-a.height*.42,a.width*.51,a.height*.42,0,0,Math.PI*2);p.stroke();}
        }});
      }
      items.sort((a,b)=>b.z-a.z).forEach(s=>s.draw());
      // Fine dust and haze separate the back wall from the silhouettes.
      p.fillStyle='#e5d3a033';for(let i=0;i<17;i++){const x=(i*137.7+Math.sin(state.time*.15+i)*18)%w,y=(i*57.3+state.time*.8)%h;p.fillRect(x,y,1,1);}
      const vignette=p.createRadialGradient(w*.5,h*.5,h*.12,w*.5,h*.5,Math.max(w*.62,h*.8));vignette.addColorStop(0,'#0a0e0800');vignette.addColorStop(.6,'#0a0e0822');vignette.addColorStop(1,'#060b08d9');p.fillStyle=vignette;p.fillRect(0,0,w,h);
      this.drawWeapon(state,now);
      if(state.mode==='briefing') {const fade=p.createLinearGradient(0,0,w,0);fade.addColorStop(0,'#141914ef');fade.addColorStop(.45,'#141914b8');fade.addColorStop(1,'#14191400');p.fillStyle=fade;p.fillRect(0,0,w,h);}
      if(state.phase==='enemy'){p.fillStyle='#8c46240b';p.fillRect(0,0,w,h);}
    }
    drawWeapon(state,now){
      if(!this.weapon.naturalWidth)return;const p=this.ctx,w=this.width,h=this.height;
      const recoil=clamp(1-(now-state.shotAt)/230,0,1),width=Math.min(w*.47,h*.8),height=width*500/640;
      const x=w*.61,y=h-height*.8+recoil*12;
      p.imageSmoothingEnabled=false;p.drawImage(this.weapon,x,y,width,height);
      if(now-state.shotAt<95){
        const mx=x+width*.17,my=y+height*.14;p.save();p.translate(mx,my);p.fillStyle='#ffe3a0';p.shadowColor='#ffb855';p.shadowBlur=25;p.beginPath();p.moveTo(0,-31);p.lineTo(9,-10);p.lineTo(27,-18);p.lineTo(13,0);p.lineTo(30,14);p.lineTo(7,9);p.lineTo(-7,26);p.lineTo(-9,6);p.lineTo(-30,-4);p.lineTo(-10,-10);p.closePath();p.fill();p.restore();
        const target=this.layout(state.enemies).find(e=>e.id===(state.shotTarget??state.target));if(target){p.strokeStyle='#f8d89588';p.lineWidth=1;p.beginPath();p.moveTo(mx,my);p.lineTo(target.x,target.foot-target.height*.55);p.stroke();}
      }
    }
  }
  window.BattlefieldScene=BattlefieldScene;
})();
