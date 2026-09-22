const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
let src=fs.readFileSync(path.join(root,'app.js'),'utf8');
src=src.split('document.querySelectorAll(".tab")')[0];
const test=String.raw`
const W=JSON.parse(fs.readFileSync(path.join(root,'data','binance_1w.json'),'utf8')).map(mapK);
const expected={
 '2021-11-14':130.463,
 '2022-03-06':-88.431,
 '2024-06-30':31.796,
 '2025-09-28':8.395
};
let bad=0;
for(const [d,want] of Object.entries(expected)){
 const ts=Date.parse(d+'T23:59:59.999Z'),b=W.filter(x=>x.ot<=ts),v=trendScalpSeries(b,12,8,.7,false),got=v.filter(Number.isFinite).at(-1);
 const ok=Number.isFinite(got)&&Math.abs(got-want)<0.15;
 console.log(ok?'PASS':'FAIL',d,'expected',want,'got',got?.toFixed(3));
 if(!ok)bad++;
}
if(bad){console.error('Trend Scalp regression failures:',bad);process.exit(1)}
console.log('TREND_SCALP_REGRESSION_OK',Object.keys(expected).length,'checkpoints');
`;
eval(src+'\n'+test);