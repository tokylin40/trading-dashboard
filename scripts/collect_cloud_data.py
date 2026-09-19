
import os, json, time, re
from pathlib import Path
from datetime import datetime, timezone
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HIST = DATA / "history"
DATA.mkdir(exist_ok=True)
HIST.mkdir(exist_ok=True)

def get_json(url, params=None, timeout=30):
    r = requests.get(url, params=params, timeout=timeout, headers={"User-Agent":"Mozilla/5.0"})
    r.raise_for_status()
    return r.json()

def get_text(url, timeout=30):
    r=requests.get(url, timeout=timeout, headers={"User-Agent":"Mozilla/5.0"})
    r.raise_for_status()
    return r.text

def parse_num(text, label):
    m=re.search(re.escape(label)+r"\s*([₿$]?\s*[\d,]+(?:\.\d+)?\s*[x%]?)", text, re.I)
    return m.group(1).strip() if m else None

# Binance market summary
ticker = get_json("https://api.binance.com/api/v3/ticker/24hr", {"symbol":"BTCUSDT"})

# Strategy official page, best-effort parse
strategy = {"connected": False, "source": "strategy.com"}
try:
    html = get_text("https://www.strategy.com/")
    txt = " ".join(BeautifulSoup(html,"html.parser").stripped_strings)
    strategy.update({
        "connected": True,
        "mstr_price": parse_num(txt,"MSTR Price"),
        "mnav": parse_num(txt,"mNAV"),
        "btc_holdings": parse_num(txt,"BTC"),
        "btc_reserve_m": parse_num(txt,"Reserve ($M)"),
        "amplification": parse_num(txt,"Amplification"),
    })
except Exception as e:
    strategy["error"] = str(e)

# Glassnode, optional secret
onchain = {"connected": False, "provider": "Glassnode"}
key = os.getenv("GLASSNODE_API_KEY","").strip()
if key:
    try:
        base="https://api.glassnode.com/v1/metrics"
        params={"a":"BTC","i":"24h","api_key":key}
        rp=get_json(base+"/market/price_realized_usd",params)
        up=get_json(base+"/blockchain/utxo_profit_relative",params)
        sl=get_json(base+"/supply/loss_sum",params)
        onchain={
            "connected": True,
            "provider":"Glassnode",
            "realized_price": rp[-1]["v"] if rp else None,
            "utxo_profit_relative": up[-1]["v"] if up else None,
            "utxo_loss_pct": (1-float(up[-1]["v"]))*100 if up else None,
            "supply_in_loss_btc": sl[-1]["v"] if sl else None
        }
    except Exception as e:
        onchain["error"]=str(e)
else:
    onchain["reason"]="GLASSNODE_API_KEY not configured"

now=datetime.now(timezone.utc)
stamp=now.strftime("%Y-%m-%dT%H:%M:%SZ")
day=now.strftime("%Y-%m-%d")
hour=now.strftime("%H%M")

existing=list(HIST.glob("*.json"))
payload={
    "generated_at":stamp,
    "market":{
        "symbol":"BTCUSDT",
        "last_price":float(ticker["lastPrice"]),
        "price_change_pct_24h":float(ticker["priceChangePercent"]),
        "high_24h":float(ticker["highPrice"]),
        "low_24h":float(ticker["lowPrice"])
    },
    "strategy":strategy,
    "onchain":onchain,
    "history_count":len(existing)+1
}

(DATA/"latest.json").write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
(HIST/f"{day}_{hour}.json").write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(payload,ensure_ascii=False,indent=2))
