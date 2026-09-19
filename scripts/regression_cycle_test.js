const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
let src=fs.readFileSync(path.join(root,'app.js'),'utf8');
src=src.split('document.querySelectorAll(".tab")')[0];
const test=String.raw`
const fs2=require('fs'),path2=require('path');
const rd=n=>JSON.parse(fs2.readFileSync(path2.join(root,'data',n),'utf8'));
S.H4=rd('binance_4h.json').map(mapK);
S.D=rd('binance_1d.json').map(mapK);
S.W=rd('binance_1w.json').map(mapK);
S.M=rd('binance_1M.json').map(mapK);
S.etf=[];S.onchain=[];
buildPhasePath();
const expected={
 '2021-04-15':'MID_BULL',
 '2021-11-10':'LATE_BULL',
 '2022-03-06':'BEAR',
 '2022-11-20':'BEAR',
 '2023-01-15':'BEAR',
 '2023-12-31':'MID_BULL',
 '2024-06-30':'MID_BULL',
 '2024-12-31':'MID_BULL',
 '2025-06-30':'MID_BULL',
 '2025-09-30':'LATE_BULL',
 '2025-11-22':'BEAR',
 '2026-09-19':'RECOVERY'
};
let bad=0;
for(const [d,want] of Object.entries(expected)){
 const ts=Date.parse(d+'T23:59:59.999Z'),got=phaseAt(ts)?.phase||'NONE';
 const mark=got===want?'PASS':'FAIL';
 console.log(mark,d,'expected',want,'got',got);
 if(got!==want)bad++;
}
if(bad){console.error('Cycle regression failures:',bad);process.exit(1)}
console.log('CYCLE_REGRESSION_OK',Object.keys(expected).length,'checkpoints');
`;
eval(src+'\n'+test);
