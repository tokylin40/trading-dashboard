# 科幣託 Crypto Dashboard V4 Cloud

## 架構
- GitHub Pages：前端
- Binance Public API / WebSocket：即時 BTC 技術面
- GitHub Actions：每小時更新 Strategy + Glassnode JSON
- GitHub Secrets：保護 GLASSNODE_API_KEY
- `data/latest.json`：前端讀取最新雲端快照
- `data/history/*.json`：每小時歷史快照，可做回測

## 部署
把所有檔案放到 `tokylin40/trading-dashboard` 根目錄。

### Pages
Settings → Pages → Source: GitHub Actions

### Glassnode
Settings → Secrets and variables → Actions → New repository secret
Name:
`GLASSNODE_API_KEY`

Value:
你的 Glassnode API Key

如果沒有 Key，Action 仍可正常執行，只是 on-chain 顯示未連線。

## 更新頻率
GitHub Actions 每小時第 15 分執行一次。
BTC 即時價格仍由使用者開頁面時直接連 Binance WebSocket。

## 安全
- Glassnode Key 不進前端
- Repo 不存 API Key
- 沒有交易所私鑰
- 沒有自動下單


## V5：Signal History / Backtest

新增 `scripts/build_backtest.py` 與 `.github/workflows/backtest.yml`。

### 第一次建立回測
GitHub → Actions → `Build Signal Backtest` → `Run workflow`

完成後會產生：
`data/backtest.json`

Dashboard 會自動顯示：
- BULL / TRANSITION / DEFENSIVE 歷史樣本數
- 各模式之後 7 / 30 / 60 / 90 天平均報酬
- 30 天正報酬比例
- 最近狀態切換紀錄

### 排程
每天 02:35 UTC（台灣時間 10:35）重新建一次歷史回測。

### 回測邊界
目前是 **Technical Gate Backtest**：
- 月線連陽
- 週線 EMA Ribbon
- 週線 Dow Structure
- 日線 Support Zone
- 4H ATR / Spring

刻意不把目前 On-chain / MSTR 數值倒灌到歷史。
等取得可靠歷史資料後，再升級 Full System Backtest。


## GitHub Actions 寫入權限（重要）

因為 `update-data.yml` 與 `backtest.yml` 會把 JSON 結果 commit 回 repository，請確認：

`Settings → Actions → General → Workflow permissions → Read and write permissions`

然後按 Save。

若維持唯讀權限，資料蒐集本身可能成功，但最後 `git push` 會失敗。
