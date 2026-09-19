
"use strict";
const $=id=>document.getElementById(id);
const BASES=["https://data-api.binance.vision","https://api.binance.com","https://api1.binance.com"];
const WGT={monthly:25,ema:25,dow:20,onchain:15,etf:15};
const LAB={monthly:"月線連陽",ema:"EMA Ribbon",dow:"日線道氏",onchain:"鏈上成本",etf:"ETF資金流"};
let S={H4:[],D:[],W:[],M:[],ticker:null,etf:[],onchain:[],tf:"1D",locked:false,lockedTs:null,chart:null,candle:null,emaLines:[],phasePath:[],kedaPath:[]};

function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function mean(a){const z=a.filter(Number.isFinite);return z.length?z.reduce((s,v)=>s+v,0)/z.length:NaN}
function fmtP(v){return Number.isFinite(v)?"$"+Math.round(v).toLocaleString("en-US"):"N/A"}
function fmtPct(v,d=1){return Number.isFinite(v)?v.toFixed(d)+"%":"N/A"}
function day(ms){return new Date(ms).toISOString().slice(0,10)}
function mapK(k){return {ot:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5],ct:+k[6]}}
async function fj(url){const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error(r.status);return r.json()}
async function binance(path){let e;for(const b of BASES){try{return await fj(b+path)}catch(x){e=x}}throw e}
async function optional(path){try{return await fj(path+"?ts="+Date.now())}catch(e){return []}}
function mergeBars(a,b){return [...new Map([...a,...b].map(x=>[x.ot,x])).values()].sort((x,y)=>x.ot-y.ot)}
function tailAsOf(a,ts,max=600){let lo=0,hi=a.length-1,best=-1;while(lo<=hi){const m=(lo+hi)>>1;if(a[m].ct<=ts){best=m;lo=m+1}else hi=m-1}return best<0?[]:a.slice(Math.max(0,best-max+1),best+1)}
async function refreshKlines(){
 const [h4,d,w,m,t]=await Promise.all([
  binance("/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=1000"),
  binance("/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000"),
  binance("/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=500"),
  binance("/api/v3/klines?symbol=BTCUSDT&interval=1M&limit=180"),
  binance("/api/v3/ticker/24hr?symbol=BTCUSDT")
 ]);
 S.H4=mergeBars(S.H4,h4.map(mapK));S.D=mergeBars(S.D,d.map(mapK));S.W=mergeBars(S.W,w.map(mapK));S.M=mergeBars(S.M,m.map(mapK));S.ticker=t;
 buildPhasePath();buildKedaPath();renderCurrent();if(S.chart&&!S.locked)drawChart();
}

function emaSeries(vals,p){let out=new Array(vals.length).fill(null);if(vals.length<p)return out;let e=mean(vals.slice(0,p)),a=2/(p+1);out[p-1]=e;for(let i=p;i<vals.length;i++){e=vals[i]*a+e*(1-a);out[i]=e}return out}
function pivots(c,l=2,r=2){let hi=[],lo=[];for(let i=l;i<c.length-r;i++){let H=true,L=true;for(let j=i-l;j<=i+r;j++){if(j===i)continue;if(c[j].h>=c[i].h)H=false;if(c[j].l<=c[i].l)L=false}if(H)hi.push({i,p:c[i].h,t:c[i].ot});if(L)lo.push({i,p:c[i].l,t:c[i].ot})}return {hi,lo}}
function sma(a,n){return a.length>=n?mean(a.slice(-n)):NaN}
function stdev(a){const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)*(x-m))))}
function macdInfo(bars){
 const vals=bars.map(x=>x.c),e12=emaSeries(vals,12),e26=emaSeries(vals,26);
 const line=vals.map((_,i)=>Number.isFinite(e12[i])&&Number.isFinite(e26[i])?e12[i]-e26[i]:NaN),valid=line.filter(Number.isFinite);
 if(valid.length<12)return {state:"N/A",score:NaN,line:NaN,signal:NaN,hist:NaN};
 const sig=emaSeries(valid,9),m=valid.at(-1),s=sig.at(-1),pm=valid.at(-2),ps=sig.at(-2),hist=m-s,prevHist=pm-ps,e20=emaSeries(vals,20).at(-1);
 const score=clamp((m>0?35:0)+(m>s?35:0)+(hist>prevHist?15:0)+(bars.at(-1).c>e20?15:0));
 const state=m>0&&m>s?"多頭":m<0&&m<s?"空頭":m>s?"修復中":"轉弱中";
 return {state,score,line:m,signal:s,hist};
}
function dowInfo(bars,price){
 const p=pivots(bars,2,2),hs=p.hi.slice(-2),ls=p.lo.slice(-2);
 if(hs.length<2||ls.length<2)return {state:"資料不足",score:NaN,high:"--",low:"--",event:"--"};
 const high=hs[1].p>hs[0].p?"HH":"LH",low=ls[1].p>ls[0].p?"HL":"LL";
 const state=high==="HH"&&low==="HL"?"多頭結構":high==="LH"&&low==="LL"?"空頭結構":"轉折／盤整";
 const score=state==="多頭結構"?100:state==="空頭結構"?0:50;
 let event="區間內";
 if(state==="多頭結構"&&price<ls[1].p)event="CHoCH ↓";
 else if(state==="空頭結構"&&price>hs[1].p)event="CHoCH ↑";
 else if(price>hs[1].p)event="BOS ↑";
 else if(price<ls[1].p)event="BOS ↓";
 return {state,score,high,low,event,lastHigh:hs[1].p,lastLow:ls[1].p};
}
function clusterLevels(points,tol=.012){
 const sorted=[...points].filter(Number.isFinite).sort((a,b)=>a-b),out=[];
 for(const p of sorted){let c=out.find(x=>Math.abs(p-x.price)/x.price<=tol);if(c){c.sum+=p;c.touches++;c.price=c.sum/c.touches}else out.push({price:p,sum:p,touches:1})}
 return out;
}
function supportResistance(bars,price){
 const x=bars.slice(-260),pv=pivots(x,3,3),levels=clusterLevels([...pv.hi.map(x=>x.p),...pv.lo.map(x=>x.p)]);
 let sup=levels.filter(x=>x.price<price*.997).sort((a,b)=>b.price-a.price)[0],res=levels.filter(x=>x.price>price*1.003).sort((a,b)=>a.price-b.price)[0];
 if(!sup){const v=Math.min(...x.slice(-60).map(b=>b.l));sup={price:v,touches:1}}
 if(!res){const v=Math.max(...x.slice(-60).map(b=>b.h));res={price:v,touches:1}}
 const sStrength=clamp(30+(sup.touches-1)*18),rStrength=clamp(30+(res.touches-1)*18);
 return {support:sup.price,resistance:res.price,sTouches:sup.touches,rTouches:res.touches,sStrength,rStrength,sDist:(price/sup.price-1)*100,rDist:(res.price/price-1)*100};
}
function atrValue(bars,n=14){if(bars.length<n+1)return NaN;const tr=[];for(let i=bars.length-n;i<bars.length;i++){const p=bars[i-1].c,b=bars[i];tr.push(Math.max(b.h-b.l,Math.abs(b.h-p),Math.abs(b.l-p)))}return mean(tr)}
function breakoutInfo(bars){
 const x=bars.slice(-180);if(x.length<80)return {score:NaN,direction:"N/A",atrScore:NaN,bbScore:NaN,volScore:NaN,rangeScore:NaN};
 const atrs=[];for(let i=35;i<x.length;i++)atrs.push(atrValue(x.slice(0,i+1),14));const aNow=atrs.at(-1),atrScore=100*atrs.filter(v=>v>=aNow).length/atrs.length;
 const widths=[];for(let i=20;i<=x.length;i++){const v=x.slice(i-20,i).map(b=>b.c),m=mean(v),sd=stdev(v);widths.push(m?4*sd/m:NaN)}const bw=widths.at(-1),bbScore=100*widths.filter(v=>v>=bw).length/widths.length;
 const v20=sma(x.map(b=>b.v),20),v60=sma(x.map(b=>b.v),60),volScore=clamp((1.15-v20/v60)/.55*100);
 const r20=(Math.max(...x.slice(-20).map(b=>b.h))-Math.min(...x.slice(-20).map(b=>b.l)))/x.at(-1).c;
 const r60=(Math.max(...x.slice(-60).map(b=>b.h))-Math.min(...x.slice(-60).map(b=>b.l)))/x.at(-1).c,rangeScore=clamp((1-r20/r60)*130);
 const m=macdInfo(x),e20=emaSeries(x.map(b=>b.c),20).at(-1),direction=x.at(-1).c>e20&&m.hist>0?"偏多":x.at(-1).c<e20&&m.hist<0?"偏空":"雙向等待";
 return {score:mean([atrScore,bbScore,volScore,rangeScore]),direction,atrScore,bbScore,volScore,rangeScore};
}
function wyckoffInfo(bars,price,trend,drawdown){
 const x=bars.slice(-140);if(x.length<90)return {stage:"資料不足",score:NaN,spring:false,utad:false};
 let springAt=-1,utadAt=-1;
 for(let i=Math.max(60,x.length-12);i<x.length;i++){
   const prior=x.slice(i-60,i),b=x[i],lo=Math.min(...prior.map(z=>z.l)),hi=Math.max(...prior.map(z=>z.h)),av=mean(prior.map(z=>z.v));
   const body=Math.max(Math.abs(b.c-b.o),b.c*.001),lw=Math.min(b.o,b.c)-b.l,uw=b.h-Math.max(b.o,b.c);
   if(b.l<lo*.995&&b.c>lo&&lw>body*1.2&&b.v>av*1.05)springAt=i;
   if(b.h>hi*1.005&&b.c<hi&&uw>body*1.2&&b.v>av*1.05)utadAt=i;
 }
 const spring=springAt>=0,utad=utadAt>=0,y=x.slice(-90),lo=Math.min(...y.map(b=>b.l)),hi=Math.max(...y.map(b=>b.h)),pos=(price-lo)/(hi-lo);
 let stage="局部 Trading Range",score=50;
 if(springAt>utadAt){stage="局部吸籌候選 / Spring";score=82}
 else if(utadAt>springAt){stage="局部派發候選 / UTAD";score=82}
 else if(trend==="BULLISH"&&pos>.55){stage="局部 Markup 候選";score=72}
 else if(trend==="BEARISH"&&pos<.45){stage="局部 Markdown 候選";score=72}
 else if(drawdown<=-20&&pos<.45){stage="局部吸籌區候選";score=60}
 else if(drawdown>-15&&pos>.72){stage="局部派發區候選";score=58}
 return {stage,score,spring,utad,position:clamp(pos*100),springAt,utadAt};
}
function technicalInfo(D,W,H4,price,trend,drawdown){
 const d4=dowInfo(H4,price),dd=dowInfo(D,price),dw=dowInfo(W,price),m4=macdInfo(H4),md=macdInfo(D),mw=macdInfo(W),sr=supportResistance(D,price),bo=breakoutInfo(H4),wy=wyckoffInfo(D,price,trend,drawdown);
 const dowScore=.2*d4.score+.5*dd.score+.3*dw.score,macdScore=.2*m4.score+.5*md.score+.3*mw.score;
 return {dow4h:d4,dowDaily:dd,dowWeekly:dw,dowScore,macd4h:m4,macdDaily:md,macdWeekly:mw,macdScore,levels:sr,breakout:bo,wyckoff:wy};
}

function kedaRawInfo(W){
 if(W.length<60)return {score:NaN,emaScore:NaN,macd:{state:"N/A",score:NaN},dow:{state:"資料不足",score:NaN,high:"--",low:"--",event:"--"},rawBull:false,rawExit:false,slopes:0,ordered:0,wtop:NaN,wbot:NaN,close:NaN};
 const periods=[20,25,30,35,40,45,50,55],vals=W.map(x=>x.c),close=W.at(-1).c;
 const es=periods.map(p=>{const s=emaSeries(vals,p);return {p,v:s.at(-1),prev:s.at(-2),slope:s.at(-1)-s.at(-2)}}).filter(x=>Number.isFinite(x.v));
 const wtop=Math.max(...es.map(x=>x.v)),wbot=Math.min(...es.map(x=>x.v)),slopes=es.filter(x=>x.slope>0).length;
 let ordered=0;for(let i=0;i<es.length-1;i++)if(es[i].v>es[i+1].v)ordered++;
 const pos=close>wtop?100:close<wbot?0:clamp((close-wbot)/(wtop-wbot)*100);
 const emaScore=.4*pos+.3*(slopes/8*100)+.3*(ordered/7*100);
 const macd=macdInfo(W),dow=dowInfo(W,close);
 const score=.5*emaScore+.25*macd.score+.25*dow.score;
 const rawBull=close>wtop&&slopes>=5&&ordered>=4&&macd.score>=50&&dow.score>=50;
 const rawExit=close<wbot||(score<45&&slopes<=3)||(macd.score<35&&dow.score===0);
 return {score,emaScore,macd,dow,rawBull,rawExit,slopes,ordered,wtop,wbot,close};
}
function buildKedaPath(){
 let state="OFF",bullCount=0,exitCount=0,since=null,path=[],acc=[],now=Date.now();
 for(const w of S.W){
   if(w.ct>now)break;
   acc.push(w);if(acc.length<60)continue;
   const info=kedaRawInfo(acc),prev=state;
   if(state==="OFF"){
     bullCount=info.rawBull?bullCount+1:0;exitCount=0;
     if(bullCount>=2){state="ON";since=w.ct;bullCount=0}
   }else{
     exitCount=info.rawExit?exitCount+1:0;bullCount=0;
     if(exitCount>=2){state="OFF";since=w.ct;exitCount=0}
   }
   if(!since)since=w.ct;
   path.push({...info,ts:w.ct,state,since,changed:state!==prev,close:w.c});
 }
 S.kedaPath=path;
}
function kedaAt(ts){
 const a=S.kedaPath;let lo=0,hi=a.length-1,best=null;
 while(lo<=hi){const m=(lo+hi)>>1;if(a[m].ts<=ts){best=a[m];lo=m+1}else hi=m-1}
 return best;
}
function kedaBacktestAsOf(ts){
 const a=S.kedaPath.filter(x=>x.ts<=ts);if(!a.length)return {trades:0,winRate:NaN,totalReturn:NaN,buyHold:NaN};
 let prev="OFF",entry=null,trades=[],firstEntry=null,lastClose=a.at(-1).close;
 for(const x of a){
   if(prev==="OFF"&&x.state==="ON"){entry={ts:x.ts,price:x.close};if(firstEntry==null)firstEntry=x.close}
   if(prev==="ON"&&x.state==="OFF"&&entry){trades.push({entry,exit:{ts:x.ts,price:x.close},ret:(x.close/entry.price-1)*100});entry=null}
   prev=x.state;
 }
 const wins=trades.filter(x=>x.ret>0).length,compound=trades.reduce((v,x)=>v*(1+x.ret/100),1);
 let eq=1,peak=1,mdd=0,bhPeak=1,bhMdd=0,started=false,prevRow=null;
 for(const x of a){
   if(!started&&x.state==="ON"){started=true;prevRow=x;continue}
   if(!started)continue;
   if(prevRow&&prevRow.state==="ON")eq*=x.close/prevRow.close;
   peak=Math.max(peak,eq);mdd=Math.min(mdd,(eq/peak-1)*100);
   const bh=x.close/firstEntry;bhPeak=Math.max(bhPeak,bh);bhMdd=Math.min(bhMdd,(bh/bhPeak-1)*100);
   prevRow=x;
 }
 return {trades:trades.length,winRate:trades.length?wins/trades.length*100:NaN,totalReturn:(compound-1)*100,buyHold:firstEntry?((lastClose/firstEntry)-1)*100:NaN,maxDrawdown:mdd,buyHoldMdd:bhMdd,open:entry};
}

function streak(c){let n=0,dir=0;for(let i=c.length-1;i>=0;i--){let d=c[i].c>c[i].o?1:c[i].c<c[i].o?-1:0;if(!d)break;if(!dir)dir=d;if(d!==dir)break;n++}return n*dir}
function partialMonth(ts,D){
 const dt=new Date(ts),y=dt.getUTCFullYear(),m=dt.getUTCMonth();
 const x=D.filter(c=>{const z=new Date(c.ot);return z.getUTCFullYear()===y&&z.getUTCMonth()===m&&c.ct<=ts});
 if(!x.length)return null;return {ot:x[0].ot,o:x[0].o,h:Math.max(...x.map(z=>z.h)),l:Math.min(...x.map(z=>z.l)),c:x.at(-1).c,ct:x.at(-1).ct};
}
function dim(items){const av=items.filter(x=>x.available),cov=av.reduce((s,x)=>s+x.weight,0),a=cov?av.reduce((s,x)=>s+x.achievement*x.weight,0)/cov:NaN;return {achievement:a,coverage:cov,items}}
function itm(name,achievement,weight,available,detail){return {name,achievement:available?clamp(achievement):NaN,weight,available,detail}}
function etfAsOf(ts){
 const date=day(ts),x=S.etf.filter(r=>r.date<=date);if(!x.length)return null;
 const last=x.at(-1),s7=x.slice(-7),s14=x.slice(-14);
 return {latest:last.total_usd_m,seven:s7.reduce((s,r)=>s+r.total_usd_m,0),fourteen:s14.length>=10?s14.reduce((s,r)=>s+r.total_usd_m,0):NaN,pos7:s7.filter(r=>r.total_usd_m>0).length,n7:s7.length};
}
function ocAsOf(ts){
 const date=day(ts),x=S.onchain.filter(r=>r.date<=date);return x.length?x.at(-1):null;
}

const PHASE_LABEL={
 BEAR:"熊市",BOTTOMING:"築底期",RECOVERY:"復甦期",EARLY_BULL:"牛初確認",
 MID_BULL:"牛市中期",LATE_BULL:"牛末期",DISTRIBUTION:"高檔派發期"
};
const NEXT_LABEL={
 BEAR:"築底期",BOTTOMING:"復甦期",RECOVERY:"牛初確認",EARLY_BULL:"牛市中期",
 MID_BULL:"牛末期",LATE_BULL:"高檔派發期",DISTRIBUTION:"熊市確認"
};
function halvingDaysAt(ts){
 const halvings=[Date.UTC(2016,6,9),Date.UTC(2020,4,11),Date.UTC(2024,3,20)];
 let last=null;for(const h of halvings)if(h<=ts)last=h;return last==null?NaN:(ts-last)/86400000;
}
function phaseProgress(phase,q){
 if(phase==="BEAR")return clamp((q.drawdown<=-25?35:10)+(q.price>q.wbot?25:0)+Math.min(q.slopes/3,1)*20+(q.bosMinor?20:0));
 if(phase==="BOTTOMING")return clamp((q.price>q.wtop?30:q.price>q.wbot?15:0)+Math.min(q.slopes/4,1)*30+(q.bosMinor?25:0)+Math.min(q.stClosed/2,1)*15);
 if(phase==="RECOVERY")return clamp(Math.min(q.stClosed/3,1)*40+(q.price>q.wtop?20:0)+Math.min(q.slopes/5,1)*20+(q.bosMinor?10:0)+(q.et&&q.et.seven>0?10:0));
 if(phase==="EARLY_BULL")return clamp(Math.min(q.ordered/6,1)*50+(q.weekBull?25:0)+(q.price>q.wtop?15:0)+Math.min(q.slopes/8,1)*10);
 if(phase==="MID_BULL"){const hd=q.halvingDays||0,maturity=(hd>900||hd<150)?0:clamp((hd-150)/300*100),ath=clamp((q.drawdown+20)/15*100),structure=mean([q.ordered/7*100,q.slopes/8*100]);return clamp(maturity*.45+ath*.25+structure*.30);}
 if(phase==="LATE_BULL")return clamp((q.distWarn?60:20)+(q.price<q.wtop?20:0)+(q.weekBear?20:0));
 if(phase==="DISTRIBUTION")return clamp((q.hardBear?70:0)+(q.price<q.wbot?15:0)+(q.weekBear?15:0));
 return 0;
}
function initialPhase(q){
 if(q.hardBear)return "BEAR";
 if(q.midBull)return "MID_BULL";
 if(q.earlyConfirmed)return "EARLY_BULL";
 if(q.recoveryStrong)return "RECOVERY";
 return "BOTTOMING";
}
function hold(counter,key,cond){
 counter[key]=cond?(counter[key]||0)+1:0;
 return counter[key];
}
function transitionPhase(phase,q,counter,age,cycleAge){
 const weeklyBreak=q.price<q.wbot&&q.slopes<=3;
 const bottomCandidate=q.drawdown<=-20&&q.price>q.wbot&&q.slopes>=2&&q.trend!=="BEARISH";
 if(phase==="BEAR"){
   if(hold(counter,"bear_bottom",bottomCandidate,7)>=7)return "BOTTOMING";
 }else if(phase==="BOTTOMING"){
   if(hold(counter,"bottom_recovery",q.recoveryStrong&&q.stClosed>=1,7)>=7)return "RECOVERY";
   if(hold(counter,"bottom_bear",q.hardBear,7)>=7)return "BEAR";
 }else if(phase==="RECOVERY"){
   if(hold(counter,"recovery_early",q.earlyConfirmed,7)>=7)return "EARLY_BULL";
   if(hold(counter,"recovery_fail",weeklyBreak||q.hardBear,14)>=14)return "BOTTOMING";
 }else if(phase==="EARLY_BULL"){
   if(hold(counter,"early_mid",q.midBull,14)>=14)return "MID_BULL";
   if(hold(counter,"early_fail",weeklyBreak,14)>=14)return "RECOVERY";
 }else if(phase==="MID_BULL"){
   const finalExpansion=q.halvingDays>=450&&q.halvingDays<=900&&q.drawdown>-8&&q.ordered>=6&&q.slopes>=6&&q.price>q.wtop;
   const structuralBreak=q.halvingDays>=180&&(q.hardBear||(q.drawdown<=-25&&q.trend==="BEARISH"&&q.slopes<=2));
   if(hold(counter,"mid_late_expansion",finalExpansion,14)>=14)return "LATE_BULL";
   if(hold(counter,"mid_late_break",structuralBreak,7)>=7)return "LATE_BULL";
 }else if(phase==="LATE_BULL"){
   const breakdown=q.hardBear||(weeklyBreak&&q.drawdown<=-20);
   if(hold(counter,"late_breakdown",breakdown,7)>=7)return "DISTRIBUTION";
   if(age>=21&&hold(counter,"late_dist",q.distWarn,14)>=14)return "DISTRIBUTION";
 }else if(phase==="DISTRIBUTION"){
   if(hold(counter,"dist_bear",q.hardBear||(weeklyBreak&&q.drawdown<=-20),7)>=7)return "BEAR";
 }
 return phase;
}
function buildPhasePath(){
 let phase=null,counter={},age=0,cycleAge=0,path=[];
 for(const d of S.D){
   const q=calc(d.ct,null,true);
   if(!q)continue;
   const prev=phase;
   if(!phase){phase=initialPhase(q);age=1;cycleAge=phase==="BEAR"?0:1;}
   else{
     const next=transitionPhase(phase,q,counter,age,cycleAge);
     if(next!==phase){phase=next;counter={};age=1;}else age++;
     if(phase==="BEAR")cycleAge=0;
     else if(prev==="BEAR"&&phase==="BOTTOMING")cycleAge=1;
     else cycleAge=cycleAge?cycleAge+1:1;
   }
   path.push({ts:d.ct,phase,age,cycleAge});
 }
 S.phasePath=path;
}
function phaseAt(ts){
 let a=S.phasePath,lo=0,hi=a.length-1,best=null;
 while(lo<=hi){
   const mid=(lo+hi)>>1;
   if(a[mid].ts<=ts){best=a[mid];lo=mid+1}else hi=mid-1;
 }
 return best;
}
function calc(ts,livePriceOverride=null,rawOnly=false){
 const D=S.D.filter(c=>c.ct<=ts),W=S.W.filter(c=>c.ct<=ts),Mclosed=S.M.filter(c=>c.ct<=ts);
 if(D.length<60||W.length<60||Mclosed.length<12)return null;
 let price=livePriceOverride??D.at(-1).c;
 const pm=partialMonth(ts,S.D),mLive=pm?[...Mclosed,pm]:Mclosed;
 const signedLive=streak(mLive),signedClosed=streak(Mclosed);
 const stLive=Math.max(0,signedLive),stClosed=Math.max(0,signedClosed);
 const periods=[20,25,30,35,40,45,50,55], wc=W.map(x=>x.c),dc=D.map(x=>x.c);
 let we=periods.map(p=>{const s=emaSeries(wc,p);return {p,v:s.at(-1),prev:s.at(-2),slope:s.at(-1)-s.at(-2)}}).filter(x=>Number.isFinite(x.v));
 const wtop=Math.max(...we.map(x=>x.v)),wbot=Math.min(...we.map(x=>x.v)),slopes=we.filter(x=>x.slope>0).length;
 let ordered=0;for(let i=0;i<we.length-1;i++)if(we[i].v>we[i+1].v)ordered++;
 let de=periods.map(p=>emaSeries(dc,p).at(-1)),dord=0;for(let i=0;i<de.length-1;i++)if(de[i]>de[i+1])dord++;
 const pv=pivots(D,2,2),hi=pv.hi,lo=pv.lo,minor=hi.at(-1)?.p,major=hi.length?Math.max(...hi.slice(-3).map(x=>x.p)):NaN,keylow=lo.at(-1)?.p;
 const bosMinor=Number.isFinite(minor)&&price>minor,bosMajor=Number.isFinite(major)&&price>major,protect=Number.isFinite(keylow)&&price>keylow;
 const wpv=pivots(W,2,2),wh=wpv.hi.slice(-2),wl=wpv.lo.slice(-2);
 const weekBull=wh.length===2&&wl.length===2&&wh[1].p>wh[0].p&&wl[1].p>wl[0].p;
 const weekBear=wh.length===2&&wl.length===2&&wh[1].p<wh[0].p&&wl[1].p<wl[0].p;
 const cycleHigh=Math.max(...D.slice(-365).map(x=>x.h));
 const drawdown=Number.isFinite(cycleHigh)?(price/cycleHigh-1)*100:NaN;
 const trend=price>wtop&&slopes>=5?"BULLISH":price<wbot&&slopes<=3?"BEARISH":"NEUTRAL";
 const recoveryStrong=price>wtop&&slopes>=4;
 const earlyConfirmed=stClosed>=3&&W.at(-1).c>wtop&&slopes>=5;
 const midBull=earlyConfirmed&&ordered>=5&&slopes>=6;
 const hardBear=drawdown<=-20&&price<wbot&&slopes<=3&&(signedClosed<=-1||weekBear);
 const distWarn=drawdown<=-12&&(price<wtop||slopes<=4||weekBear);
 const et=etfAsOf(ts),oc=ocAsOf(ts);
 let month=dim([itm("3根月陽－即時進度",stLive/3*100,60,true,`即時連陽 ${stLive} 根`),itm("3根月陽－收盤確認",stClosed/3*100,40,true,`已收盤連陽 ${stClosed} 根`)]);
 let ema=dim([
   itm("週線價格站上 Ribbon",price>wtop?100:price<wbot?0:(price-wbot)/(wtop-wbot)*100,25,true,`週線帶 ${fmtP(wbot)} ~ ${fmtP(wtop)}`),
   itm("週線 EMA 斜率廣度",slopes/8*100,25,true,`${slopes}/8 條向上`),
   itm("週線完整多頭排列",ordered/7*100,20,true,`${ordered}/7 相鄰關係成立`),
   itm("日線站上完整 Ribbon",D.at(-1).c>Math.max(...de)?100:0,15,true,`日收 ${fmtP(D.at(-1).c)}`),
   itm("日線 Ribbon 多頭排列",dord/7*100,15,true,`${dord}/7 相鄰關係成立`)
 ]);
 let dow=dim([
   itm("最近小波段 BOS",bosMinor?100:Number.isFinite(minor)?clamp((price/minor-.97)/.03*100):0,35,Number.isFinite(minor),Number.isFinite(minor)?`前高 ${fmtP(minor)}`:"N/A"),
   itm("主要波段 BOS",bosMajor?100:Number.isFinite(major)?clamp((price/major-.95)/.05*100):0,35,Number.isFinite(major),Number.isFinite(major)?`主要前高 ${fmtP(major)}`:"N/A"),
   itm("關鍵前低保護",protect?100:0,30,Number.isFinite(keylow),Number.isFinite(keylow)?`前低 ${fmtP(keylow)}`:"N/A")
 ]);
 const rp=oc?.realized_price,delta=Number.isFinite(rp)?(price/rp-1)*100:NaN,mvrv=oc?.mvrv,rc=oc?.realized_cap_30d_change_pct,loss=oc?.loss_pct;
 let onchain=dim([
   itm("Realized Price Delta",Number.isFinite(delta)?clamp((delta+5)/20*100):0,35,Number.isFinite(delta),Number.isFinite(delta)?`Delta ${delta.toFixed(1)}%`:"N/A"),
   itm("UTXO / Supply Loss 清洗",Number.isFinite(loss)?clamp((45-loss)/35*100):0,25,Number.isFinite(loss),Number.isFinite(loss)?`Loss ${loss.toFixed(1)}%`:"N/A"),
   itm("Realized Cap 30D 資本流",Number.isFinite(rc)?clamp((rc+2)/6*100):0,25,Number.isFinite(rc),Number.isFinite(rc)?`30D ${rc.toFixed(2)}%`:"N/A"),
   itm("MVRV 脫離深熊",Number.isFinite(mvrv)?clamp((mvrv-.8)/1.2*100):0,15,Number.isFinite(mvrv),Number.isFinite(mvrv)?`MVRV ${mvrv.toFixed(2)}`:"N/A")
 ]);
 let etfd=dim([
   itm("最新交易日淨流入",et?et.latest>0?100:0:0,20,!!et,et?`${et.latest>=0?"+":""}${et.latest.toFixed(1)}M`:"N/A"),
   itm("7交易日累計淨流入",et?clamp(et.seven/1000*100):0,35,!!et,et?`${et.seven>=0?"+":""}${et.seven.toFixed(1)}M`:"N/A"),
   itm("14交易日累計淨流入",et&&Number.isFinite(et.fourteen)?clamp(et.fourteen/2000*100):0,30,!!et&&Number.isFinite(et.fourteen),et&&Number.isFinite(et.fourteen)?`${et.fourteen>=0?"+":""}${et.fourteen.toFixed(1)}M`:"N/A"),
   itm("7日正流入連續性",et&&et.n7?et.pos7/et.n7*100:0,15,!!et&&et.n7>0,et?`${et.pos7}/${et.n7} 個交易日為正`:"N/A")
 ]);
 const dims={monthly:month,ema,dow,onchain,etf:etfd};
 let effective=0,pts=0;for(const k of Object.keys(WGT)){effective+=WGT[k]*dims[k].coverage/100;pts+=WGT[k]*dims[k].coverage/100*(Number.isFinite(dims[k].achievement)?dims[k].achievement:0)/100}
 const conf=effective?pts/effective*100:NaN,cov=effective;
 const halvingDays=halvingDaysAt(ts);
 const base={ts,price,confidence:conf,coverage:cov,dims,stLive,stClosed,signedLive,signedClosed,slopes,ordered,bosMinor,bosMajor,minor,major,keylow,et,delta,mvrv,wtop,wbot,weekBull,weekBear,cycleHigh,drawdown,trend,recoveryStrong,earlyConfirmed,midBull,hardBear,distWarn,halvingDays};
 if(rawOnly)return base;
 const ps=phaseAt(ts),phase=ps?.phase||initialPhase(base);
 base.phase=phase;base.cycleAge=ps?.cycleAge||0;
 base.regime=PHASE_LABEL[phase];
 base.nextProgress=phaseProgress(phase,base);
 base.nextLabel=NEXT_LABEL[phase];
 const H4=tailAsOf(S.H4,ts,600);
 base.tech=technicalInfo(D,W,H4,price,trend,drawdown);
 base.keda=kedaAt(ts);
 return base;
}
function cls(v){return !Number.isFinite(v)?"na":v>=70?"good":v>=40?"watch":"risk"}
function renderSnapshot(q,live=false){
 if(!q)return;
 $("snapDate").textContent=live?"現在":day(q.ts);$("snapPrice").textContent=fmtP(q.price);$("snapRegime").textContent=q.regime;$("snapConfidence").textContent=fmtPct(q.confidence);$("snapCoverage").textContent=fmtPct(q.coverage);
 $("snapTrend").textContent=q.trend==="BULLISH"?"偏多":q.trend==="BEARISH"?"偏空":"中性";
 $("snapNext").textContent=fmtPct(q.nextProgress);$("snapNextLabel").textContent=q.nextLabel||"--";
 $("snapKeda").textContent=q.keda?q.keda.state:"N/A";
 $("snapMonth").textContent=`即時 ${q.stLive} / 已收 ${q.stClosed}`;$("snapWeekSlope").textContent=`${q.slopes}/8`;$("snapWeekAlign").textContent=`${q.ordered}/7`;
 $("snapBos").textContent=q.bosMajor?"主要 BOS":q.bosMinor?"小波段 BOS":"未突破";$("snapEtf7").textContent=q.et?`${q.et.seven>=0?"+":""}${q.et.seven.toFixed(1)}M`:"N/A";$("snapRp").textContent=Number.isFinite(q.delta)?`${q.delta>=0?"+":""}${q.delta.toFixed(1)}%`:"N/A";
 $("lockState").textContent=live?"LIVE":S.locked?"LOCKED":"HOVER";$("detailTitle").textContent=live?"當下指標達成率":`${day(q.ts)} 當時指標達成率`;
 $("techTitle").textContent=live?"技術分析層":`${day(q.ts)} 技術分析層`;
 renderKeda(q);renderTech(q);renderDetails(q);
}

function renderKeda(q){
 const k=q.keda,bt=kedaBacktestAsOf(q.ts);
 if(!k){$("kedaStatus").textContent="N/A";return}
 $("kedaStatus").textContent=k.state;
 $("kedaStatus").className="kedaStatus "+(k.state==="ON"?"good":"watch");
 $("kedaSince").textContent=k.state==="ON"?("多頭趨勢成立｜自 "+day(k.since)+" 起｜僅已收週線可改變狀態"):("多頭趨勢未成立｜自 "+day(k.since)+" 起｜OFF ≠ 做空");
 $("kedaScore").textContent=fmtPct(k.score);
 $("kedaEma").textContent=fmtPct(k.emaScore);$("kedaEmaDetail").textContent="斜率 "+k.slopes+"/8 · 排列 "+k.ordered+"/7";
 $("kedaMacd").textContent=k.macd.state;$("kedaMacdDetail").textContent="MACD分數 "+fmtPct(k.macd.score);
 $("kedaDow").textContent=k.dow.state;$("kedaDowDetail").textContent=k.dow.high+"/"+k.dow.low+" · "+k.dow.event;
 $("btTrades").textContent=bt.trades;$("btWinRate").textContent=fmtPct(bt.winRate);$("btReturn").textContent=fmtPct(bt.totalReturn);$("btBuyHold").textContent=fmtPct(bt.buyHold);$("btMdd").textContent=fmtPct(bt.maxDrawdown);$("btBhMdd").textContent=fmtPct(bt.buyHoldMdd);
}
function renderTech(q){
 const t=q.tech;if(!t){$("techCards").innerHTML="";return}
 const d4=t.dow4h,d=t.dowDaily,w=t.dowWeekly,m4=t.macd4h,m=t.macdDaily,mw=t.macdWeekly,l=t.levels,b=t.breakout,y=t.wyckoff;
 const wyEvent=y.springAt>y.utadAt?"最近事件：Spring":y.utadAt>y.springAt?"最近事件：UTAD":"未偵測到明確 Spring / UTAD";
 $("techCards").innerHTML=`
 <div class="tech"><h3>道氏結構</h3><div class="main ${cls(t.dowScore)}">${d.high}/${d.low}</div><div class="subline">4H：${d4.high}/${d4.low} · ${d4.event}<br>日線：${d.state} · ${d.event}<br>週線：${w.high}/${w.low} · ${w.state}</div><div class="miniPct ${cls(t.dowScore)}">多頭結構 ${fmtPct(t.dowScore)}</div></div>
 <div class="tech"><h3>MACD 趨勢</h3><div class="main ${cls(t.macdScore)}">${m.state}</div><div class="subline">4H：${m4.state}<br>日線：${m.state} · Hist ${Number.isFinite(m.hist)?m.hist.toFixed(0):"N/A"}<br>週線：${mw.state}</div><div class="miniPct ${cls(t.macdScore)}">趨勢達成 ${fmtPct(t.macdScore)}</div></div>
 <div class="tech"><h3>支撐 / 壓力</h3><div class="main">${fmtP(l.support)} / ${fmtP(l.resistance)}</div><div class="subline">距支撐 ${fmtPct(l.sDist)} · ${l.sTouches} 次反應<br>距壓力 ${fmtPct(l.rDist)} · ${l.rTouches} 次反應</div><div class="miniPct ${cls(mean([l.sStrength,l.rStrength]))}">區域強度 ${fmtPct(mean([l.sStrength,l.rStrength]))}</div></div>
 <div class="tech"><h3>4H 爆發準備度</h3><div class="main ${cls(b.score)}">${fmtPct(b.score)}</div><div class="subline">${b.direction}<br>ATR壓縮 ${fmtPct(b.atrScore)} · BB壓縮 ${fmtPct(b.bbScore)}<br>量縮 ${fmtPct(b.volScore)} · 區間壓縮 ${fmtPct(b.rangeScore)}</div></div>
 <div class="tech"><h3>局部 Wyckoff</h3><div class="main">${y.stage}</div><div class="subline">90D 區間位置 ${fmtPct(y.position)}<br>${wyEvent}</div><div class="miniPct ${cls(y.score)}">候選信心 ${fmtPct(y.score)}</div></div>`;
}
function renderDetails(q){
 $("dimensionCards").innerHTML=Object.keys(WGT).map(k=>{const d=q.dims[k];return `<div class="dim"><h3>${LAB[k]} · ${WGT[k]}%</h3><div class="pct ${cls(d.achievement)}">${fmtPct(d.achievement)}</div><small>資料覆蓋 ${d.coverage.toFixed(0)}%</small><div class="bar"><i style="width:${Number.isFinite(d.achievement)?d.achievement:0}%"></i></div></div>`}).join("");
 let rows=[];for(const k of Object.keys(WGT))for(const x of q.dims[k].items)rows.push(`<tr><td><b>${LAB[k]}</b></td><td>${x.name}</td><td class="value ${cls(x.achievement)}">${fmtPct(x.achievement)}</td><td>${x.weight}%</td><td class="muted">${x.detail}</td></tr>`);
 $("detailBody").innerHTML=rows.join("");
}
function current(){
 const now=Date.now(),price=+(S.ticker?.lastPrice||S.D.at(-1)?.c);return calc(now,price);
}
function renderCurrent(){
 const q=current();if(!q)return;$("livePrice").textContent=fmtP(q.price);$("liveMeta").textContent=`Binance · ${new Date().toLocaleTimeString("zh-TW")}`;$("currentRegime").textContent=q.regime;$("currentConfidence").textContent=fmtPct(q.confidence);$("currentCoverage").textContent=fmtPct(q.coverage);
 $("currentTrend").textContent=q.trend==="BULLISH"?"偏多":q.trend==="BEARISH"?"偏空":"中性";
 $("currentNext").textContent=fmtPct(q.nextProgress);$("currentNextLabel").textContent="→ "+(q.nextLabel||"--");
 $("currentDesc").textContent=`正式週期鎖定為「${q.regime}」；短期趨勢${q.trend==="BULLISH"?"偏多":q.trend==="BEARISH"?"偏空":"中性"}。近365日高點回撤 ${fmtPct(q.drawdown)}；月線已收連陽 ${q.stClosed} 根。`;
 if(!S.locked)renderSnapshot(q,true);
}
function timeVal(t){if(typeof t==="number")return t*1000;if(t&&typeof t==="object"&&"year"in t)return Date.UTC(t.year,t.month-1,t.day);return NaN}
function pointEndTs(t){const b=timeVal(t);if(!Number.isFinite(b))return NaN;if(S.tf==="4H")return b+4*3600000-1;if(S.tf==="1D")return b+86400000-1;if(S.tf==="1W")return b+7*86400000-1;if(S.tf==="1M"){const d=new Date(b);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)-1}return b}
function setupChart(){
 const el=$("chart");S.chart=LightweightCharts.createChart(el,{layout:{background:{color:"#07131e"},textColor:"#9db0c1"},grid:{vertLines:{color:"#102434"},horzLines:{color:"#102434"}},rightPriceScale:{borderColor:"#20384c"},timeScale:{borderColor:"#20384c",timeVisible:true},crosshair:{mode:LightweightCharts.CrosshairMode.Normal}});
 S.candle=S.chart.addCandlestickSeries({upColor:"#34d399",downColor:"#fb7185",borderVisible:false,wickUpColor:"#34d399",wickDownColor:"#fb7185"});
 new ResizeObserver(()=>S.chart.applyOptions({width:el.clientWidth,height:el.clientHeight})).observe(el);
 S.chart.subscribeCrosshairMove(p=>{if(S.locked||!p.time)return;const ts=pointEndTs(p.time),q=calc(Math.min(ts,Date.now()));if(q)renderSnapshot(q,false)});
 S.chart.subscribeClick(p=>{if(!p.time)return;S.locked=true;S.lockedTs=pointEndTs(p.time);const q=calc(Math.min(S.lockedTs,Date.now()));if(q)renderSnapshot(q,false)});
 drawChart();
}
function chartRows(){return S.tf==="4H"?S.H4:S.tf==="1D"?S.D:S.tf==="1W"?S.W:S.M}
function drawChart(){
 if(!S.chart)return;const x=chartRows(),win=S.tf==="4H"?420:S.tf==="1D"?365:S.tf==="1W"?156:72;
 S.candle.setData(x.map(c=>({time:Math.floor(c.ot/1000),open:c.o,high:c.h,low:c.l,close:c.c})));
 for(const s of S.emaLines)S.chart.removeSeries(s);S.emaLines=[];
 const periods=S.tf==="1M"?[20]:[20,35,55],colors=["#34d399","#60a5fa","#fbbf24"];
 for(let j=0;j<periods.length;j++){const p=periods[j],es=emaSeries(x.map(c=>c.c),p),ls=S.chart.addLineSeries({color:colors[j],lineWidth:2,priceLineVisible:false,lastValueVisible:false});ls.setData(es.map((v,i)=>Number.isFinite(v)?{time:Math.floor(x[i].ot/1000),value:v}:null).filter(Boolean));S.emaLines.push(ls)}
 if(x.length)S.chart.timeScale().setVisibleLogicalRange({from:Math.max(0,x.length-win),to:x.length+3});
}
function focusChart(ts){if(!S.chart)return;const dayMs=86400000,span=S.tf==="4H"?45*dayMs:S.tf==="1D"?220*dayMs:S.tf==="1W"?900*dayMs:1800*dayMs;S.chart.timeScale().setVisibleRange({from:Math.floor((ts-span)/1000),to:Math.floor((ts+span)/1000)})}
async function load(){
 const [h4h,dh,wh,mh,e,o]=await Promise.all([
  optional("data/binance_4h.json"),optional("data/binance_1d.json"),optional("data/binance_1w.json"),optional("data/binance_1M.json"),
  optional("data/etf_history.json"),optional("data/onchain_history.json")
 ]);
 S.H4=(Array.isArray(h4h)?h4h:[]).map(mapK);S.D=(Array.isArray(dh)?dh:[]).map(mapK);S.W=(Array.isArray(wh)?wh:[]).map(mapK);S.M=(Array.isArray(mh)?mh:[]).map(mapK);
 S.etf=Array.isArray(e)?e:[];S.onchain=Array.isArray(o)?o:[];
 await refreshKlines();setupChart();renderCurrent();
 setInterval(async()=>{try{S.ticker=await binance("/api/v3/ticker/24hr?symbol=BTCUSDT");renderCurrent()}catch(e){}},15000);
 setInterval(async()=>{try{await refreshKlines()}catch(e){}},300000);
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{S.tf=b.dataset.tf;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("on",x===b));drawChart()});
$("nowBtn").onclick=()=>{S.locked=false;S.lockedTs=null;drawChart();renderCurrent();S.chart.timeScale().scrollToRealTime()};
$("goDate").onclick=()=>{const v=$("datePick").value;if(!v)return;const ts=new Date(v+"T23:59:59.999Z").getTime();S.locked=true;S.lockedTs=ts;const q=calc(ts);if(q){renderSnapshot(q,false);focusChart(ts)}};
load().catch(e=>{$("liveMeta").textContent="資料載入失敗："+e.message});
