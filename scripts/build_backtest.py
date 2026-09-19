import json, math, statistics, time
from pathlib import Path
from datetime import datetime, timezone
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "backtest.json"
BINANCE = "https://api.binance.com"
SYMBOL = "BTCUSDT"

def req(path, params=None):
    r = requests.get(
        BINANCE + path,
        params=params,
        timeout=30,
        headers={"User-Agent": "kebitu-dashboard-backtest/1.0"},
    )
    r.raise_for_status()
    return r.json()

def fetch_all(interval, start_ms, end_ms):
    rows = []
    cursor = start_ms
    while cursor < end_ms:
        batch = req("/api/v3/klines", {
            "symbol": SYMBOL,
            "interval": interval,
            "startTime": cursor,
            "endTime": end_ms,
            "limit": 1000,
        })
        if not batch:
            break
        rows.extend(batch)
        nxt = int(batch[-1][0]) + 1
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
        time.sleep(0.08)
    return rows

def parse(rows):
    return [{
        "t": int(k[0]), "o": float(k[1]), "h": float(k[2]), "l": float(k[3]),
        "c": float(k[4]), "v": float(k[5]), "ct": int(k[6])
    } for k in rows]

def ema_last(vals, p):
    if not vals:
        return float("nan")
    a = 2 / (p + 1)
    e = vals[0]
    for x in vals[1:]:
        e = x * a + e * (1 - a)
    return e

def atr(a, p=14):
    if len(a) < 2:
        return float("nan")
    tr = []
    for i in range(1, len(a)):
        tr.append(max(
            a[i]["h"] - a[i]["l"],
            abs(a[i]["h"] - a[i-1]["c"]),
            abs(a[i]["l"] - a[i-1]["c"]),
        ))
    x = tr[-p:]
    return sum(x) / len(x) if x else float("nan")

def pivots(a, w=3):
    hi, lo = [], []
    for i in range(w, len(a)-w):
        H, L = True, True
        for j in range(i-w, i+w+1):
            if j == i:
                continue
            if a[j]["h"] >= a[i]["h"]:
                H = False
            if a[j]["l"] <= a[i]["l"]:
                L = False
        if H: hi.append(a[i])
        if L: lo.append(a[i])
    return hi, lo

def dow(a):
    hi, lo = pivots(a, 3)
    H, L = hi[-2:], lo[-2:]
    if len(H) < 2 or len(L) < 2:
        return "MIXED"
    hh = H[1]["h"] > H[0]["h"]
    hl = L[1]["l"] > L[0]["l"]
    if hh and hl: return "HH / HL"
    if (not hh) and (not hl): return "LH / LL"
    return "MIXED"

def monthly_streak(a):
    n = 0
    for k in reversed(a):
        if k["c"] > k["o"]:
            n += 1
        else:
            break
    return n

def support_zone(d):
    x = d[-70:]
    _, pls = pivots(x, 3)
    da = atr(d, 14)
    base = pls[-1]["l"] if pls else min(k["l"] for k in d[-30:])
    return {
        "base": base,
        "low": base - da * 0.35,
        "high": base + da * 0.35,
        "atr": da,
    }

def spring_signal(h, support_low):
    x = h[-24:]
    if len(x) < 22:
        return False
    vol20 = sum(k["v"] for k in x[-21:-1]) / 20
    for k in x[-2:]:
        rng = (k["h"] - k["l"]) or 1.0
        lower = min(k["o"], k["c"]) - k["l"]
        wick = lower / rng
        if k["l"] < support_low and k["c"] > support_low and wick >= 0.45 and k["v"] > vol20 * 1.25:
            return True
    return False

def value_at_or_before(rows, ct, start_idx=0):
    i = start_idx
    while i + 1 < len(rows) and rows[i+1]["ct"] <= ct:
        i += 1
    return i

def safe_mean(xs):
    x=[v for v in xs if v is not None and math.isfinite(v)]
    return sum(x)/len(x) if x else None

def safe_median(xs):
    x=[v for v in xs if v is not None and math.isfinite(v)]
    return statistics.median(x) if x else None

def positive_rate(xs):
    x=[v for v in xs if v is not None and math.isfinite(v)]
    return (sum(v > 0 for v in x) / len(x) * 100) if x else None

def pct(v):
    return None if v is None else round(v * 100, 3)

def aggregate(rows, key):
    groups={}
    for r in rows:
        groups.setdefault(r[key], []).append(r)
    out={}
    for name, rs in groups.items():
        item={"samples":len(rs)}
        for h in (7,30,60,90):
            vals=[r["forward"].get(str(h)) for r in rs]
            item[str(h)]={
                "mean_pct": pct(safe_mean(vals)),
                "median_pct": pct(safe_median(vals)),
                "positive_rate_pct": None if positive_rate(vals) is None else round(positive_rate(vals),1),
                "n": len([v for v in vals if v is not None]),
            }
        out[name]=item
    return out

def main():
    # Warmup from 2018 so weekly EMA55 and pivots are available.
    start_ms = int(datetime(2018,1,1,tzinfo=timezone.utc).timestamp()*1000)
    end_ms = int(datetime.now(timezone.utc).timestamp()*1000)

    M = parse(fetch_all("1M", start_ms, end_ms))
    W = parse(fetch_all("1w", start_ms, end_ms))
    D = parse(fetch_all("1d", start_ms, end_ms))
    H = parse(fetch_all("4h", start_ms, end_ms))

    # Backtest begins only after sufficient warmup.
    min_date = datetime(2020,1,1,tzinfo=timezone.utc).timestamp()*1000
    wi=mi=hi=0
    states=[]

    for di in range(len(D)):
        day = D[di]
        if day["ct"] < min_date or di < 70:
            continue

        while mi + 1 < len(M) and M[mi+1]["ct"] <= day["ct"]:
            mi += 1
        while wi + 1 < len(W) and W[wi+1]["ct"] <= day["ct"]:
            wi += 1
        while hi + 1 < len(H) and H[hi+1]["ct"] <= day["ct"]:
            hi += 1

        mhist=[x for x in M[:mi+1] if x["ct"] <= day["ct"]]
        whist=[x for x in W[:wi+1] if x["ct"] <= day["ct"]]
        hhist=[x for x in H[:hi+1] if x["ct"] <= day["ct"]]
        dhist=D[:di+1]
        if len(mhist)<4 or len(whist)<60 or len(hhist)<30:
            continue

        streak = monthly_streak(mhist)
        periods=[20,25,30,35,40,45,50,55]
        closes=[x["c"] for x in whist]
        ev=[ema_last(closes,p) for p in periods]
        aligned=sum(ev[i]>ev[i+1] for i in range(len(ev)-1))/7
        structure=dow(whist[-90:])
        wc=whist[-1]["c"]
        ribbon_top=max(ev); ribbon_bottom=min(ev)

        zone=support_zone(dhist)
        near=(day["c"] >= zone["low"]-zone["atr"]*0.25 and
              day["c"] <= zone["high"]+zone["atr"]*0.75)
        spr=spring_signal(hhist, zone["low"])
        hatr=atr(hhist,14)
        hatr_pct=hatr/hhist[-1]["c"]*100

        month_ok=streak>=3
        week_bull=(aligned>=0.85 and wc>ribbon_top and structure=="HH / HL")
        week_bear=(aligned<=0.15 and wc<ribbon_bottom and structure=="LH / LL")

        if month_ok and week_bull:
            mode="BULL"
            state="EXECUTION" if near and spr else "RIGHT_SIDE_CONFIRM"
        elif (not month_ok) and week_bear:
            mode="DEFENSIVE"
            state="CASH_DEFENSE"
        else:
            mode="TRANSITION"
            state="WAIT_CONFIRM"

        forward={}
        for horizon in (7,30,60,90):
            j=di+horizon
            forward[str(horizon)] = (D[j]["c"]/day["c"]-1) if j<len(D) else None

        states.append({
            "date": datetime.fromtimestamp(day["ct"]/1000,timezone.utc).strftime("%Y-%m-%d"),
            "price": round(day["c"],2),
            "mode":mode,
            "state":state,
            "monthly_green_streak":streak,
            "weekly_alignment":round(aligned,4),
            "dow_structure":structure,
            "support_low":round(zone["low"],2),
            "support_high":round(zone["high"],2),
            "near_support":near,
            "spring":spr,
            "h4_atr_pct":round(hatr_pct,3),
            "forward":forward,
        })

    # State changes are more useful to read than every daily row.
    changes=[]
    prev=None
    for r in states:
        sig=(r["mode"],r["state"])
        if sig != prev:
            changes.append(r)
            prev=sig

    result={
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "methodology":{
            "scope":"Technical gate only",
            "symbol":"BTCUSDT",
            "evaluation_frequency":"Daily close",
            "start": states[0]["date"] if states else None,
            "end": states[-1]["date"] if states else None,
            "lookahead_control":"Only candles closed by each historical evaluation timestamp are used.",
            "important_limit":"On-chain and MSTR/STRC are NOT included in this historical backtest yet."
        },
        "summary_by_mode":aggregate(states,"mode"),
        "summary_by_state":aggregate(states,"state"),
        "state_change_count":len(changes),
        "daily_sample_count":len(states),
        "recent_state_changes":changes[-40:],
    }
    OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(result["summary_by_mode"],ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
