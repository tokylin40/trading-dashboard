const fs=require('fs');
const path=require('path');
const root='C:\\Users\\toton\\trading-dashboard';
const outDir=path.join(root,'data');
const BASES=['https://data-api.binance.vision','https://api.binance.com','https://api1.binance.com'];
const START=Date.UTC(2017,7,17);
const intervals=['4h','1d','1w','1M'];

async function getJSON(url){
  const r=await fetch(url);
  if(!r.ok) throw new Error(r.status+' '+url);
  return r.json();
}
async function fetchPage(interval,startTime){
  let err;
  for(const b of BASES){
    try{
      return await getJSON(b+'/api/v3/klines?symbol=BTCUSDT&interval='+interval+'&startTime='+startTime+'&limit=1000');
    }catch(e){err=e}
  }
  throw err;
}
function slim(k){
  return [Number(k[0]),Number(k[1]),Number(k[2]),Number(k[3]),Number(k[4]),Number(k[5]),Number(k[6]),Number(k[8])];
}
async function backfill(interval){
  let all=[],start=START,pages=0;
  for(;;){
    const a=await fetchPage(interval,start);
    if(!a.length) break;
    all.push(...a.map(slim)); pages++;
    const next=Number(a[a.length-1][6])+1;
    if(next<=start) break;
    start=next;
    process.stdout.write(interval+' page '+pages+' rows '+all.length+'\r\n');
    if(a.length<1000) break;
    await new Promise(r=>setTimeout(r,80));
  }
  const dedup=[...new Map(all.map(k=>[k[0],k])).values()].sort((a,b)=>a[0]-b[0]);
  fs.writeFileSync(path.join(outDir,'binance_'+interval+'.json'),JSON.stringify(dedup));
  console.log(interval,'done',dedup.length,new Date(dedup[0][0]).toISOString(),new Date(dedup.at(-1)[0]).toISOString());
}
(async()=>{for(const i of intervals)await backfill(i)})().catch(e=>{console.error(e);process.exit(1)});
