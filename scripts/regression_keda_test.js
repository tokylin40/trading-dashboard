const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
let src=fs.readFileSync(path.join(root,'app.js'),'utf8');
src=src.split('document.querySelectorAll(".tab")')[0];
const test=String.raw`
const rd=n=>JSON.parse(fs.readFileSync(path.join(root,'data',n),'utf8'));
S.W=rd('binance_1w.json').map(mapK);
buildKedaPath();
const expected={
 '2021-04-15':'ON',
 '2022-03-06':'OFF',
 '2023-12-31':'ON',
 '2024-06-30':'ON',
 '2025-09-30':'ON',
 '2026-09-19':'OFF'
};
let bad=0;
for(const [d,want] of Object.entries(expected)){
 const ts=Date.parse(d+'T23:59:59.999Z'),got=kedaAt(ts)?.state||'NONE';
 const mark=got===want?'PASS':'FAIL';
 console.log(mark,d,'expected',want,'got',got);
 if(got!==want)bad++;
}
if(S.kedaPath.at(-1)?.ts>Date.now()){console.error('FAIL unclosed weekly bar leaked into kedaPath');bad++}
if(bad){console.error('Keda trend regression failures:',bad);process.exit(1)}
console.log('KEDA_TREND_REGRESSION_OK',Object.keys(expected).length,'checkpoints');
`;
eval(src+'\n'+test);