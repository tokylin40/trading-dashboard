const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
let src=fs.readFileSync(path.join(root,'app.js'),'utf8');
src=src.split('document.querySelectorAll(".tab")')[0];
const test=String.raw`
const rd=n=>JSON.parse(fs.readFileSync(path.join(root,'data',n),'utf8'));
S.H4=rd('binance_4h.json').map(mapK);S.D=rd('binance_1d.json').map(mapK);S.W=rd('binance_1w.json').map(mapK);S.M=rd('binance_1M.json').map(mapK);S.etf=[];S.onchain=[];
buildPhasePath();buildKedaPath();
const checks=[['2022-03-06','DOWN'],['2024-06-30','DOWN'],['2026-09-21','UP']];
let bad=0;
for(const [d,dir] of checks){
 const ts=Date.parse(d+'T23:59:59.999Z'),q=calc(ts),f=q?.tech?.fib;
 const ok=!!f?.available&&f.direction===dir&&f.endTs<=ts&&f.support?.price<q.price&&f.resistance?.price>q.price&&
  Number.isFinite(f.levels['0.236'])&&Number.isFinite(f.levels['0.618'])&&Number.isFinite(f.levels['1.618']);
 console.log(ok?'PASS':'FAIL',d,'dir',f?.direction,'anchorEnd',f?.endTs?day(f.endTs):'NA','support',f?.support?.price,'price',q?.price,'resistance',f?.resistance?.price);
 if(!ok)bad++;
}
if(bad){console.error('Fib regression failures:',bad);process.exit(1)}
console.log('FIB_REGRESSION_OK',checks.length,'checkpoints');
`;
eval(src+'\n'+test);