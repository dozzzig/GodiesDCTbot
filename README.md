# GodiesDCTbot

NFT sticker tracker for the DKT community on TON blockchain.
Monitors 13 wallets via TonAPI, stores data in Neon PostgreSQL,
and exposes analytics via a personal Telegram bot.

---

## Prerequisites

- Node.js >= 18
- PM2 (`npm install -g pm2`)
- Neon account → https://neon.tech
- TonAPI key → https://tonconsole.com (free tier, 1 req/s)
- Telegram bot token from @BotFather

---

## Setup

### 1. Clone & install

```bash
cd /path/to/GodiesDCTbot
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
nano .env   # fill in all values
```

Required variables:
- `DATABASE_URL` — Neon connection string (from Project → Connection Details)
- `TONAPI_KEY` — API key from tonconsole.com
- `BOT_TOKEN` — Telegram bot token
- `ADMIN_CHAT_ID` — Your Telegram user ID (get from @userinfobot)

### 3. Apply database schema

Open **Neon Console → SQL Editor**, paste the contents of `database/schema.sql` and run.

### 4. Test the parser (single run)

```bash
node src/parser.js
```

Check Neon → Tables → `current_inventory` for data.

### 5. Deploy with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed command to enable autostart
```

Check status:
```bash
pm2 status
pm2 logs dkt-parser --lines 50
pm2 logs dkt-bot --lines 50
```

---

## Bot Commands

| Command | Description |
|---|---|
| `/stats` | Total balance + collection breakdown |
| `/wallets` | All 13 wallets with sticker counts |
| `/wallet 1` … `/wallet 13` | Detailed view for specific wallet |
| `/collections` | Per-collection stats with wallet breakdown |
| `/moves` | NFT movements in the last 24 h |
| `/refresh` | Force an immediate parser run |
| `/status` | Technical status: last sync time, errors |
| `/help` | Command reference |

---

## Wallet Registry

| # | Name | Address |
|---|---|---|
| 1 | Alex1 | UQDq8mAR0vaK1iHEq_1UuLoXmPLwZ5nUdjM_GTRX87YZdnhp |
| 2 | Alex2 | UQDNItVDUjs9tefv7xdrQgW44jWzF7xzoEI11fQXCJGOrojE |
| 3 | Alex3 | UQA_MxFfYpkF0yXSyugYme5pZQEre92BOgxELUonYAI6nXEn |
| 4 | Alex4 | UQDQ30x50nf3aHz7Olj2xxBXV_b3_364DXyqyEPsxTKCDVal |
| 5 | Den1 | UQDSG8EPkjDOTMtNPcv3FMZfkmT1VmFq_nHGBsfqgF932xDf |
| 6 | Den2 | UQBiBU93tYPlTDX56vH6uijzHw3ijgaKCaR4aVwH0pnntoLF |
| 7 | Den3 | UQA8uBHC92bjMnICa8WdrrL905R5OBkD__7X86GdTwweNd8P |
| 8 | ONE | UQBWj_9jtZ6Id_hDutwp-vl1XGvt4DSP9--tq69qJX4TBF1a |
| 9 | Doz | UQAhFo1T0sFVXqK0puPS-XKHOsdbl9Ksg9idXqRsijmu1soe |
| 10 | Disco | UQBfyS-Oiw5vmmdToSBZ9P2sh-Rau2YcAuEYD3BMR5E6_ZN- |
| 11 | Mih | UQAlPVUKrM8wmsef5lvZkCMBFObDSsR5RvSfAlsdUnT9rhF0 |
| 12 | Vnutri | UQD_wyvs5P-vFVClETT-iOxG_0AUZob4eXqW9eqkdLehp9Id |
| 13 | Zuk | UQDdeVyZGT_W-oN8znwilG9hHiutw0FQHfAt4LyggYXRTBk2 |

---

## Architecture

```
src/
├── config.js     — Wallet registry, address normalization
├── db.js         — PostgreSQL pool (Neon)
├── tonapi.js     — TonAPI v2 client (retry, rate-limit)
├── parser.js     — Inventory sync + transfer detection
├── scheduler.js  — Runs parser every 30 min (PM2 entry)
└── bot.js        — Telegram bot (polling, admin-only)
```

Transfer classification logic:
- `from ∈ DKT && to ∈ DKT` → **internal** 🔄
- `from ∉ DKT && to ∈ DKT` → **incoming** 📈
- `from ∈ DKT && to ∉ DKT` → **outgoing** 📉
