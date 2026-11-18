// 감사용: 우리 엔진 측정(서버 접촉 없음). node analysis/scripts/audit_ours.mjs
import { Match, loadData } from '../../server/engine/index.js';
const data = loadData();
const U=1,D=2,L=4,R=8,B=16,C=32,A=64,S=128;
function fresh(){
  const m=new Match({seed:9,teams:[0,1],data,humans:[true,false],cpuLevels:[null,2]});
  let n=0; while((m.phase!=='play'||m.tip.on)&&n<4000){m.tick([0,0]);n++;}
  // 조작 선수를 내 사이드 내야 슬롯0 로 맞추기 위해 5프레임 안정화
  for(let i=0;i<20;i++)m.tick([0,0]);
  m.sides[0].ctrl=0; m.ball.mode=m.ball.mode; 
  return m;
}
function me(m){return m.players[0];}
const f=(v)=>v/65536;
function rec(m,pads,fn){const o=[];for(const p of pads){m.sides[0].ctrl=0;m.tick([p,0]);const q=me(m);o.push({x:f(q.x),y:f(q.y),z:f(q.z),vx:f(q.vx),vy:f(q.vy),vz:f(q.vz),st:q.st,tm:q.tm});}return o;}
let m=fresh(); let q=me(m);
console.log('ctrl pid',q.pid,'slot',q.slot,'pos',f(q.x),f(q.y),'stat',JSON.stringify(q.stat).slice(0,200),'frame',m.f,'ball mode',m.ball.mode);
const r=(a)=>JSON.stringify(a.map(v=>Math.round(v*100)/100));
let o;
m=fresh();o=rec(m,Array(40).fill(R));console.log('WALK R x',r(o.filter((_,i)=>i%3==0).map(x=>x.x)),'vx',r(o.slice(0,14).map(x=>x.vx)));
m=fresh();o=rec(m,Array(30).fill(U));console.log('WALK U y',r(o.filter((_,i)=>i%3==0).map(x=>x.y)),'vy',r(o.slice(0,10).map(x=>x.vy)));
m=fresh();o=rec(m,[R,R,0,0,0,0,...Array(50).fill(R)]);console.log('DASH vx',r(o.slice(6,50).filter((_,i)=>i%3==0).map(x=>x.vx)),'st',JSON.stringify(o.slice(6,50).filter((_,i)=>i%6==0).map(x=>x.st)));
m=fresh();o=rec(m,[C,...Array(80).fill(0)]);const z=o.map(x=>x.z);console.log('JUMP zmax',Math.max(...z).toFixed(2),'air',z.filter(v=>v>0.01).length,'vz0',r(o.slice(0,4).map(x=>x.vz)),'zs',r(z.filter((_,i)=>i%4==0).slice(0,15)));
m=fresh();o=rec(m,[R|C,...Array(60).fill(R)]);console.log('JUMP+R vx',r(o.filter((_,i)=>i%6==0).slice(0,10).map(x=>x.vx)),'zmax',Math.max(...o.map(x=>x.z)).toFixed(2));
m=fresh();o=rec(m,[B,...Array(40).fill(0)]);console.log('B st/tm',o.slice(0,24).map(x=>x.st+'/'+x.tm).join(' '));
m=fresh();o=rec(m,[A,...Array(50).fill(0)]);console.log('A st/tm',o.filter((_,i)=>i%3==0).slice(0,14).map(x=>x.st+'/'+x.tm).join(' '));
for (const [k,nm] of [[L,'L'],[R,'R'],[U,'U'],[D,'D']]){ m=fresh(); o=rec(m,Array(160).fill(k)); const q=o[o.length-1]; console.log('BOUND',nm,q.x.toFixed(2),q.y.toFixed(2)); }
// ---- 투구(지상): 공을 pid0 에게 주고 B ----
function throwTest(name,pads){
  m=fresh(); m.giveBall(m.players[0]); m.sides[0].ctrl=0;
  const out=[]; 
  for(let i=0;i<pads.length;i++){ m.sides[0].ctrl=0; m.tick([pads[i],0]); const b=m.ball,p=m.players[0];
    out.push([i,b.mode,+f(b.x).toFixed(1),+f(b.y).toFixed(1),+f(b.z).toFixed(1),+f(b.vx).toFixed(2),+f(b.vy).toFixed(2),+f(b.vz).toFixed(2),b.power,p.st,p.tm]); }
  console.log(name); out.filter((x,i)=>i<30&&(i%2==0)).forEach(x=>console.log('  ',JSON.stringify(x)));
}
throwTest('OURS ground B tap',[B,...Array(40).fill(0)]);
throwTest('OURS ground B hold5',[B,B,B,B,B,...Array(40).fill(0)]);
throwTest('OURS air B',[C,0,0,0,0,0,0,0,B|C,B,...Array(40).fill(0)]);
m=fresh(); for(let i=0;i<30;i++){m.sides[0].ctrl=0;m.tick([0,0]);} // 
{ m=fresh(); const q=m.players[0]; q.x=px0(); function px0(){return 236*65536;} 
  o=rec(m,[L,L,0,0,0,L,...Array(40).fill(L),...Array(30).fill(0)]); console.log('OURS DASH L vx',r(o.filter((_,i)=>i%2==0).slice(2,40).map(x=>x.vx)),'st',JSON.stringify(o.filter((_,i)=>i%8==0).map(x=>x.st))); }
{ m=fresh(); o=rec(m,[L,L,0,0,0,L,...Array(25).fill(L),L|C,...Array(60).fill(L)]); console.log('OURS DASHJUMP zmax',Math.max(...o.map(x=>x.z)).toFixed(2),'air',o.filter(x=>x.z>0.01).length); }
throwTest('OURS pass A',[A,...Array(30).fill(0)]);
m=fresh(); o=rec(m,[U,U,0,0,0,U,...Array(30).fill(U)]); console.log('OURS DASH U vy',r(o.filter((_,i)=>i%4==0).map(x=>x.vy)),JSON.stringify(o.filter((_,i)=>i%8==0).map(x=>x.st)));
m=fresh(); { const q=m.players[0]; q.x=240*65536; } o=rec(m,[R,R,0,0,0,R,...Array(20).fill(R),...Array(100).fill(0)]); console.log('OURS DASH over line: x',r(o.filter((_,i)=>i%10==0).map(x=>x.x)),JSON.stringify(o.filter((_,i)=>i%10==0).map(x=>x.st)));
