
import json,re,os,time
from pathlib import Path
from datetime import datetime,timezone,timedelta
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/"data";S=requests.Session();S.headers.update({"User-Agent":"Mozilla/5.0 KedaRegimeDashboard/6.0"})
DATA.mkdir(exist_ok=True)

def get(url,**kw):
    r=S.get(url,timeout=30,**kw);r.raise_for_status();return r

BINANCE_BASES=["https://data-api.binance.vision","https://api.binance.com","https://api1.binance.com"]
START_MS=int(datetime(2017,8,17,tzinfo=timezone.utc).timestamp()*1000)

def fetch_binance_klines(interval,start_ms):
    err=None
    for base in BINANCE_BASES:
        try:
            return get(base+"/api/v3/klines",params={"symbol":"BTCUSDT","interval":interval,"startTime":int(start_ms),"limit":1000}).json()
        except Exception as e:err=e
    raise err

def slim_kline(k):
    return [int(k[0]),float(k[1]),float(k[2]),float(k[3]),float(k[4]),float(k[5]),int(k[6]),int(k[8])]

def update_binance_history(interval):
    p=DATA/f"binance_{interval}.json"
    try: rows=json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    except: rows=[]
    start=int(rows[-1][0]) if rows else START_MS
    merged={int(x[0]):x for x in rows}
    for _ in range(40):
        page=fetch_binance_klines(interval,start)
        if not page:break
        for k in page: merged[int(k[0])]=slim_kline(k)
        nxt=int(page[-1][6])+1
        if nxt<=start:break
        start=nxt
        if len(page)<1000:break
        time.sleep(0.05)
    out=[merged[k] for k in sorted(merged)]
    p.write_text(json.dumps(out,separators=(",",":")),encoding="utf-8")
    return len(out)
def parse_farside():
    soup=BeautifulSoup(get("https://farside.co.uk/bitcoin-etf-flow-all-data/").text,"html.parser");out=[]
    for tr in soup.select("tr"):
        td=[x.get_text(" ",strip=True) for x in tr.select("td")]
        if len(td)<2 or not re.match(r"\d{1,2}\s+[A-Z][a-z]{2}\s+20\d\d",td[0]):continue
        s=td[-1].replace(",","").strip()
        if s in ("","-"):continue
        neg=s.startswith("(");s=s.strip("()")
        try:v=float(s)*(-1 if neg else 1)
        except:continue
        out.append({"date":datetime.strptime(td[0],"%d %b %Y").date().isoformat(),"total_usd_m":v})
    if not out:raise RuntimeError("Farside parse returned no rows")
    return out

def pick_date(x):
    if not isinstance(x,dict):return None
    for k in ("date","day","d","time","timestamp","t"):
        if k in x:
            v=x[k]
            if isinstance(v,(int,float)):
                return datetime.fromtimestamp(v/1000 if v>1e12 else v,tz=timezone.utc).date().isoformat()
            s=str(v)
            m=re.search(r"\d{4}-\d{2}-\d{2}",s)
            if m:return m.group(0)
    return None
def pick_value(x,metric):
    if not isinstance(x,dict):return None
    prefs={"realized-price":["realized_price","value","v"],"mvrv":["mvrv","value","v"],"profit-loss":["profit_loss","value","v","profit"],"realized-cap":["realized_cap","value","v"]}
    for k in prefs.get(metric,[]):
        if k in x:
            try:return float(x[k])
            except:pass
    for k,v in x.items():
        if re.search(r"date|day|time|timestamp|height|block|delayed|message",k,re.I):continue
        try:return float(v)
        except:pass
    return None
def series(metric):
    obj=get(f"https://bitcoin-data.com/v1/{metric}").json()
    arr=obj if isinstance(obj,list) else obj.get("data",[]) if isinstance(obj,dict) else []
    out={}
    for x in arr:
        d=pick_date(x);v=pick_value(x,metric)
        if d and v is not None:out[d]=v
    return out

def onchain_due():
    p=DATA/"onchain_history.json"
    if not p.exists() or p.stat().st_size<10:return True
    meta=DATA/"onchain_meta.json"
    if not meta.exists():return True
    try:
        last=datetime.fromisoformat(json.loads(meta.read_text())["generated_at"].replace("Z","+00:00"))
        return datetime.now(timezone.utc)-last>=timedelta(hours=12)
    except:return True

def build_onchain():
    rp=series("realized-price");mv=series("mvrv");pl=series("profit-loss");rc=series("realized-cap")
    dates=sorted(set(rp)|set(mv)|set(pl)|set(rc));out=[]
    rcdates=sorted(rc)
    for d in dates:
        profit=pl.get(d)
        if profit is not None and profit<=1.5:profit*=100
        rec={"date":d,"realized_price":rp.get(d),"mvrv":mv.get(d),"profit_pct":profit,"loss_pct":100-profit if profit is not None else None,"realized_cap":rc.get(d)}
        if d in rc:
            idx=rcdates.index(d)
            if idx>=30 and rc[rcdates[idx-30]]:
                rec["realized_cap_30d_change_pct"]=(rc[d]/rc[rcdates[idx-30]]-1)*100
            else:rec["realized_cap_30d_change_pct"]=None
        else:rec["realized_cap_30d_change_pct"]=None
        out.append(rec)
    (DATA/"onchain_history.json").write_text(json.dumps(out,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    (DATA/"onchain_meta.json").write_text(json.dumps({"generated_at":datetime.now(timezone.utc).isoformat(),"source":"BGeometrics","note":"Free endpoints may be delayed."},ensure_ascii=False,indent=2),encoding="utf-8")

def main():
    for interval in ("4h","1d","1w","1M"):
        try:print("Binance",interval,update_binance_history(interval),"rows")
        except Exception as e:print("Binance",interval,"update failed:",e)
    try:(DATA/"etf_history.json").write_text(json.dumps(parse_farside(),ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    except Exception as e:print("ETF update failed:",e)
    if onchain_due():
        try:build_onchain()
        except Exception as e:print("On-chain update failed:",e)
    t=get("https://data-api.binance.vision/api/v3/ticker/24hr",params={"symbol":"BTCUSDT"}).json()
    latest={"generated_at":datetime.now(timezone.utc).isoformat(),"market":{"symbol":"BTCUSDT","last_price":float(t["lastPrice"]),"change_24h_pct":float(t["priceChangePercent"])}}
    (DATA/"latest.json").write_text(json.dumps(latest,ensure_ascii=False,indent=2),encoding="utf-8")
if __name__=="__main__":main()
