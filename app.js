
"use strict";
const $=id=>document.getElementById(id);
const BASES=["https://data-api.binance.vision","https://api.binance.com","https://api1.binance.com"];
const WGT={monthly:25,ema:25,dow:20,onchain:15,etf:15};
const LAB={monthly:"月線連陽",ema:"EMA Ribbon",dow:"日線道氏",onchain:"鏈上成本",etf:"ETF資金流"};
let S={D:[],W:[],M:[],ticker:null,etf:[],onchain:[],tf:"1D",locked:false,lockedTs:null,chart:null,candle:null,emaLines:[],phasePath:[]};

function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function mean(a){const z=a.filter(Number.isFinite);return z.length?z.reduce((s,v)=>s+v,0)/z.length:NaN}
function fmtP(v){return Number.isFinite(v)?"$"+Math.round(v).toLocaleString("en-US"):"N/A"}
function fmtPct(v,d=1){return Number.isFinite(v)?v.toFixed(d)+"%":"N/A"}
function day(ms){return new Date(ms).toISOString().slice(0,10)}
function mapK(k){return {ot:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5],ct:+k[6]}}
async function fj(url){const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error(r.status);return r.json()}
async function binance(path){let e;for(const b of BASES){try{return await fj(b+path)}catch(x){e=x}}throw e}
async function optional(path){try{return await fj(path+"?ts="+Date.now())}catch(e){return []}}

function emaSeries(vals,p){let out=new Array(vals.length).fill(null);if(vals.length<p)return out;let e=mean(vals.slice(0,p)),a=2/(p+1);out[p-1]=e;for(let i=p;i<vals.length;i++){e=vals[i]*a+e*(1-a);out[i]=e}return out}
function pivots(c,l=2,r=2){let hi=[],lo=[];for(let i=l;i<c.length-r;i++){let H=true,L=true;for(let j=i-l;j<=i+r;j++){if(j===i)continue;if(c[j].h>=c[i].h)H=false;if(c[j].l<=c[i].l)L=false}if(H)hi.push({i,p:c[i].h,t:c[i].ot});if(L)lo.push({i,p:c[i].l,t:c[i].ot})}return {hi,lo}}
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
function phaseProgress(phase,q){
 if(phase==="BEAR")return clamp((q.drawdown<=-25?35:10)+(q.price>q.wbot?25:0)+Math.min(q.slopes/3,1)*20+(q.bosMinor?20:0));
 if(phase==="BOTTOMING")return clamp((q.price>q.wtop?30:q.price>q.wbot?15:0)+Math.min(q.slopes/4,1)*30+(q.bosMinor?25:0)+Math.min(q.stClosed/2,1)*15);
 if(phase==="RECOVERY")return clamp(Math.min(q.stClosed/3,1)*40+(q.price>q.wtop?20:0)+Math.min(q.slopes/5,1)*20+(q.bosMinor?10:0)+(q.et&&q.et.seven>0?10:0));
 if(phase==="EARLY_BULL")return clamp(Math.min(q.ordered/6,1)*50+(q.weekBull?25:0)+(q.price>q.wtop?15:0)+Math.min(q.slopes/8,1)*10);
 if(phase==="MID_BULL")return clamp((q.drawdown>-10?50:25)+(q.ordered>=5?20:0)+(q.weekBull?20:0)+(q.et&&q.et.fourteen>1000?10:0));
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
function transitionPhase(phase,q,counter,age){
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
   const agingBull=age>=90&&q.drawdown>-10&&q.ordered>=5&&q.slopes>=6;
   if(hold(counter,"mid_late",agingBull,10)>=10)return "LATE_BULL";
   if(hold(counter,"mid_fail",weeklyBreak,14)>=14)return "EARLY_BULL";
 }else if(phase==="LATE_BULL"){
   if(hold(counter,"late_dist",q.distWarn,7)>=7)return "DISTRIBUTION";
   if(hold(counter,"late_mid",q.trend==="BULLISH"&&q.drawdown>-8&&!q.distWarn,14)>=14)return "MID_BULL";
 }else if(phase==="DISTRIBUTION"){
   if(hold(counter,"dist_bear",q.hardBear||(weeklyBreak&&q.drawdown<=-20),7)>=7)return "BEAR";
   if(hold(counter,"dist_recover",q.trend==="BULLISH"&&q.drawdown>-10,14)>=14)return "LATE_BULL";
 }
 return phase;
}
function buildPhasePath(){
 let phase=null,counter={},age=0,path=[];
 for(const d of S.D){
   const q=calc(d.ct,null,true);
   if(!q)continue;
   if(!phase){phase=initialPhase(q);age=1;}
   else{
     const next=transitionPhase(phase,q,counter,age);
     if(next!==phase){phase=next;counter={};age=1;}else age++;
   }
   path.push({ts:d.ct,phase,age});
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
 const base={ts,price,confidence:conf,coverage:cov,dims,stLive,stClosed,signedLive,signedClosed,slopes,ordered,bosMinor,bosMajor,minor,major,keylow,et,delta,mvrv,wtop,wbot,weekBull,weekBear,cycleHigh,drawdown,trend,recoveryStrong,earlyConfirmed,midBull,hardBear,distWarn};
 if(rawOnly)return base;
 const ps=phaseAt(ts),phase=ps?.phase||initialPhase(base);
 base.phase=phase;
 base.regime=PHASE_LABEL[phase];
 base.nextProgress=phaseProgress(phase,base);
 base.nextLabel=NEXT_LABEL[phase];
 return base;
}
function cls(v){return !Number.isFinite(v)?"na":v>=70?"good":v>=40?"watch":"risk"}
function renderSnapshot(q,live=false){
 if(!q)return;
 $("snapDate").textContent=live?"現在":day(q.ts);$("snapPrice").textContent=fmtP(q.price);$("snapRegime").textContent=q.regime;$("snapConfidence").textContent=fmtPct(q.confidence);$("snapCoverage").textContent=fmtPct(q.coverage);
 $("snapTrend").textContent=q.trend==="BULLISH"?"偏多":q.trend==="BEARISH"?"偏空":"中性";
 $("snapNext").textContent=fmtPct(q.nextProgress);$("snapNextLabel").textContent=q.nextLabel||"--";
 $("snapMonth").textContent=`即時 ${q.stLive} / 已收 ${q.stClosed}`;$("snapWeekSlope").textContent=`${q.slopes}/8`;$("snapWeekAlign").textContent=`${q.ordered}/7`;
 $("snapBos").textContent=q.bosMajor?"主要 BOS":q.bosMinor?"小波段 BOS":"未突破";$("snapEtf7").textContent=q.et?`${q.et.seven>=0?"+":""}${q.et.seven.toFixed(1)}M`:"N/A";$("snapRp").textContent=Number.isFinite(q.delta)?`${q.delta>=0?"+":""}${q.delta.toFixed(1)}%`:"N/A";
 $("lockState").textContent=live?"LIVE":S.locked?"LOCKED":"HOVER";$("detailTitle").textContent=live?"當下指標達成率":`${day(q.ts)} 當時指標達成率`;
 renderDetails(q);
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
function setupChart(){
 const el=$("chart");S.chart=LightweightCharts.createChart(el,{layout:{background:{color:"#07131e"},textColor:"#9db0c1"},grid:{vertLines:{color:"#102434"},horzLines:{color:"#102434"}},rightPriceScale:{borderColor:"#20384c"},timeScale:{borderColor:"#20384c",timeVisible:true},crosshair:{mode:LightweightCharts.CrosshairMode.Normal}});
 S.candle=S.chart.addCandlestickSeries({upColor:"#34d399",downColor:"#fb7185",borderVisible:false,wickUpColor:"#34d399",wickDownColor:"#fb7185"});
 new ResizeObserver(()=>S.chart.applyOptions({width:el.clientWidth,height:el.clientHeight})).observe(el);
 S.chart.subscribeCrosshairMove(p=>{if(S.locked||!p.time)return;const ts=timeVal(p.time)+86399999,q=calc(Math.min(ts,Date.now()));if(q)renderSnapshot(q,false)});
 S.chart.subscribeClick(p=>{if(!p.time)return;S.locked=true;S.lockedTs=timeVal(p.time)+86399999;const q=calc(Math.min(S.lockedTs,Date.now()));if(q)renderSnapshot(q,false)});
 drawChart();
}
function chartRows(){return S.tf==="1D"?S.D:S.tf==="1W"?S.W:S.M}
function drawChart(){
 if(!S.chart)return;const rows=chartRows(),max=S.tf==="1D"?500:S.tf==="1W"?260:120,x=rows.slice(-max);
 S.candle.setData(x.map(c=>({time:Math.floor(c.ot/1000),open:c.o,high:c.h,low:c.l,close:c.c})));
 for(const s of S.emaLines)S.chart.removeSeries(s);S.emaLines=[];
 const periods=S.tf==="1M"?[20]:[20,35,55],colors=["#34d399","#60a5fa","#fbbf24"];
 for(let j=0;j<periods.length;j++){const p=periods[j],es=emaSeries(x.map(c=>c.c),p),ls=S.chart.addLineSeries({color:colors[j],lineWidth:2,priceLineVisible:false,lastValueVisible:false});ls.setData(es.map((v,i)=>Number.isFinite(v)?{time:Math.floor(x[i].ot/1000),value:v}:null).filter(Boolean));S.emaLines.push(ls)}
 S.chart.timeScale().fitContent();
}
async function load(){
 const [d,w,m,t,e,o]=await Promise.all([
  binance("/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000"),
  binance("/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=500"),
  binance("/api/v3/klines?symbol=BTCUSDT&interval=1M&limit=180"),
  binance("/api/v3/ticker/24hr?symbol=BTCUSDT"),
  optional("data/etf_history.json"),optional("data/onchain_history.json")
 ]);
 S.D=d.map(mapK);S.W=w.map(mapK);S.M=m.map(mapK);S.ticker=t;S.etf=Array.isArray(e)?e:[];S.onchain=Array.isArray(o)?o:[];
 buildPhasePath();setupChart();renderCurrent();setInterval(async()=>{try{S.ticker=await binance("/api/v3/ticker/24hr?symbol=BTCUSDT");renderCurrent()}catch(e){}},15000);
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{S.tf=b.dataset.tf;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("on",x===b));drawChart()});
$("nowBtn").onclick=()=>{S.locked=false;S.lockedTs=null;renderCurrent();S.chart.timeScale().scrollToRealTime()};
$("goDate").onclick=()=>{const v=$("datePick").value;if(!v)return;const ts=new Date(v+"T23:59:59Z").getTime();S.locked=true;S.lockedTs=ts;const q=calc(ts);if(q)renderSnapshot(q,false)};
load().catch(e=>{$("liveMeta").textContent="資料載入失敗："+e.message});
