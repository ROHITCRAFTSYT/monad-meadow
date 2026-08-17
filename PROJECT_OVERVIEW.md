# Monad Meadow - Complete Project Overview

## 🎮 What is Monad Meadow?

**Monad Meadow** is a **real-time multiplayer blockchain game** built for the Monad blockchain. It combines:
- A **calm 2D shared world** where players wander around gathering crystals
- A **fully on-chain NFT marketplace** where players trade these crystals for MON tokens
- **Live multiplayer** with other players visible in real-time

### Key Concept
Players gather glowing crystals → mint them as ERC-721 NFTs → trade them peer-to-peer for MON in a built-in marketplace.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     BROWSER (public/)                        │
│  • Vanilla JavaScript canvas game (zero dependencies)        │
│  • WASD movement + Space to gather crystals                 │
│  • MetaMask wallet integration                              │
│  • Raw JSON-RPC for blockchain calls                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                    WebSocket
                         │
┌────────────────────────▼────────────────────────────────────┐
│         CLOUDFLARE WORKER + DURABLE OBJECT (worker/)         │
│  • WorldRoom: Shared game state (players, crystals, chat)   │
│  • Real-time multiplayer sync                               │
│  • Server-side proximity checks for gathering               │
│  • Private team rooms with QR codes                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                    JSON-RPC
                         │
┌────────────────────────▼────────────────────────────────────┐
│           MONAD TESTNET (chainId 10143)                     │
│  • MonadMeadow.sol Smart Contract                           │
│  • ERC-721 NFT minting                                      │
│  • Escrow marketplace (list/buy/cancel)                     │
│  • On-chain SVG metadata                                    │
│  • Contract: 0xb1c49827eDB08AD2E34f002D962EB8B87B855296    │
└─────────────────────────────────────────────────────────────┘
```

---

## ✅ What You've Built (In Previous Sessions)

### 1. **Smart Contract (MonadMeadow.sol)**
- **ERC-721 NFT Collection** — each crystal is an NFT
- **On-Chain Marketplace** with escrow:
  - `mintItem(uint8 kind)` - Mint gathered crystals (0.01-0.05 MON)
  - `list(tokenId, price)` - List NFT for sale (tokens are escrowed)
  - `buy(tokenId)` - Buy listed NFT (pays seller, 2.5% fee to treasury)
  - `cancelListing(tokenId)` - Cancel sale and reclaim NFT
- **Fully On-Chain SVG Art** — metadata and artwork generated on-chain
- **16 Foundry tests** — comprehensive test coverage

### 2. **Real-Time Multiplayer Game**
- **Cloudflare Worker** — serves static client
- **Durable Object** — maintains shared world state
- **WebSocket multiplayer** — players see each other move in real-time
- **Private team rooms** — unique room codes + QR joining
- **Collision detection** — 143 solid colliders for spatial awareness
- **Kenney CC0 sprites** — hand-designed world with farm, dungeon, forest, ponds

### 3. **Game Features**
- **5 Crystal Types**: Dewdrop, Sunbloom, Moonpetal, Emberseed, Tidecrystal
- **Wallet Integration** — MetaMask connection, balance display
- **Chat System** — in-game messaging
- **Market UI** — see listings, buy/sell, manage inventory
- **Confetti celebration** — visual feedback for mints/trades
- **Mobile support** — joystick + tap-to-open sheets

### 4. **Live & Verified**
- ✅ **Live URL**: https://monad-meadow.lorq.workers.dev
- ✅ **Contract verified** on MonadScan
- ✅ **Real transactions** visible on blockchain
- ✅ **GitHub repo**: https://github.com/ROHITCRAFTSYT/monad-meadow

---

## 🆕 What Changed (Latest Session) — HARDENING + NEW FEATURES ⭐

### 1. Contract redeployed as a hardened, security-audited build

An earlier design had reward/dragon payout functions that were **drainable by anyone** — any caller could pull MON out of the contract's balance. These were **removed entirely** and the contract was **redeployed**:

```solidity
❌ REMOVED  claimReward(uint8 kind)     // was drainable-by-anyone
❌ REMOVED  claimDragonBounty()          // was drainable-by-anyone
❌ REMOVED  payDeathPenalty()            // no penalty logic anymore

✅ mintItem(uint8 kind) payable          // the ONLY way MON enters (a price)
✅ list / cancelListing / buy            // escrowed marketplace, reentrancy-guarded
✅ setMintPrice / setFeeBps / withdrawTreasury   // Ownable-gated
✅ tokenURI / kindName + ERC-721/Ownable
```

The result: **no unbacked payout paths**. Every inbound MON is a mint price or a buyer's escrowed payment, so there is no pool for an attacker to drain. Deployed + verified on MonadScan + MonadVision.

### 2. Gathering is cosmetic (no auto-payout)

Gathering a crystal adds it to your satchel. It does **not** transfer MON to your wallet — the old "gather = MON reward" flow was part of the drainable `claimReward` path and is gone. You put value on-chain when you **mint** a gathered crystal, and you earn MON by **selling** on the marketplace.

### 3. Dragon boss is cosmetic PvE

Defeating the dungeon dragon drops a rare **Tidecrystal** into your satchel (mint it normally, like any crystal). There is **no on-chain bounty** and **no death penalty** — dying just respawns you. See `DRAGON_FEATURE.md`.

### 4. Idle auto-miner (RL-style autonomous agent)

After ~6 seconds of no input, an autonomous greedy policy takes over the sprite: it navigates to the highest value-weighted nearby crystal and gathers it. An optional **auto-mint** toggle also mints gathered crystals. Any keyboard/joystick/tap input hands control straight back to the player.

### 5. Server hardening

The `WorldRoom` Durable Object is **rate-limited**, enforces a **per-room player cap**, and **sanitizes room codes** before use.

---

## 📊 Crystal Mint Prices (Per Crystal)

| Crystal | Mint Cost |
|---------|-----------|
| Dewdrop | 0.01 MON |
| Sunbloom | 0.02 MON |
| Moonpetal | 0.03 MON |
| Emberseed | 0.04 MON |
| Tidecrystal | 0.05 MON |

> Gathering is free/cosmetic; you only spend MON when you choose to mint, and the marketplace is where MON actually changes hands (buyer pays seller, 2.5% fee to treasury).

---

## 🔐 Security Done Right

✅ **No unbacked payout paths in the contract** (only mint + escrowed marketplace)
✅ **Reentrancy guards on marketplace settlement**
✅ **Rate-limited multiplayer server with per-room caps + sanitized room codes**
✅ **Private key NEVER in codebase** (broadcast/cache files git-ignored)
✅ **Environment variables protected** (`.env.example` as safe template)
✅ **Verified with grep searches**

---

## 🚀 Hackathon Rubric Coverage

### ✅ Basic (100/100)
- [x] Public GitHub repo
- [x] README with live URL
- [x] Contract deployed on testnet
- [x] Publicly hosted game

### ✅ Advanced - Working (100/100)
- [x] Functions work (mint, list, buy, gather)
- [x] Contract verified on MonadScan
- [x] Real live transactions
- [x] README for self-deployment

### 🆕 **Advanced - Real Blockchain Impact**
- [x] Minting a crystal = a real ERC-721 mint transaction on Monad
- [x] Marketplace buy/sell = real MON transfers, escrow-settled on-chain
- [x] Balances and market counts read live from chain
- [x] **Meets hackathon requirement for real transactions** — without any drainable payout path

### ⏳ Advanced - Virality (100/100)
- Pending: Post on X/LinkedIn
- Pending: Record 30s demo video
- Pending: Chase 5K+ views (or 25 waitlist / 10 live users)

### 💰 Bonus Opportunities
- [ ] Mainnet deploy (+25 points)
- [ ] Custom domain (+15 points)
- [ ] DO hibernation (nice-to-have)

---

## 📁 Project Structure

```
monad-meadow/
├── contracts/              # Solidity smart contract
│   ├── src/
│   │   └── MonadMeadow.sol # ERC-721 + escrow marketplace (hardened)
│   ├── test/
│   │   └── MonadMeadow.t.sol # 16 tests (all passing)
│   └── script/
│       └── Deploy.s.sol     # Deployment script
├── worker/                 # Cloudflare Worker
│   ├── src/
│   │   └── index.ts        # WorldRoom Durable Object
│   └── wrangler.jsonc      # Config (contract address, chain)
├── public/                 # Game client
│   ├── game.js            # Main game logic (vanilla JS)
│   ├── index.html         # Entry point
│   ├── style.css          # Game UI styles
│   └── assets/            # Sprites (Kenney CC0)
├── README.md              # Main docs
├── STATUS.md              # Build status
├── MAINNET.md             # Mainnet deployment guide
└── DEPLOYMENT_GUIDE.md    # Deploy + hardening guide
```

---

## 💡 How This Wins the Hackathon

### The loop
- Players gather crystals → added to the satchel (cosmetic, free)
- Players mint crystals → real ERC-721 mint transaction on Monad
- Players trade → real MON transfers, escrow-settled on-chain
- Players best the dragon → a rare cosmetic Tidecrystal drop (mint it if they want)

### Why it holds up
- **Real blockchain impact** through mint + marketplace transactions, verified on the explorer
- **No drainable payout paths** — the hardened contract can only receive a mint price or a buyer's escrowed payment
- **Safe by construction** rather than relying on funding a reward pool

**This meets the core hackathon requirement** — real, explorer-verifiable on-chain activity — without exposing the contract to a drain.

---

## 🎬 Next Steps to Maximize Points

1. **Post on socials** (up to 100 points)
   - Tag @monad, @monad_dev, @geeky_kartikey
   - Record 30s+ demo showing a mint + a marketplace trade
   - Aim for 5K+ views

2. **Deploy to mainnet** (+25 bonus)
   - If you have real MON for gas
   - One command change in wrangler.jsonc

3. **Get a custom domain** (+15 bonus)
   - Cloudflare Workers → Route

---

## 🎮 Try It Live

1. Go to https://monad-meadow.lorq.workers.dev
2. Create/join a room
3. Walk around with WASD
4. Press Space near crystals to gather (or go idle and let the auto-miner do it)
5. Connect wallet (MetaMask on Monad Testnet)
6. Click a gathered crystal to mint it on-chain ✨
7. Optional: List/buy on the Meadow Market, or fight the dragon for a rare Tidecrystal

---

## 📞 Current Status

✅ **Hardened contract deployed & verified**: 0xb1c49827eDB08AD2E34f002D962EB8B87B855296
✅ **No unbacked payout paths**: only mint + escrowed marketplace, reentrancy-guarded
✅ **Cosmetic dragon + idle auto-miner** live
✅ **Server rate-limited** with per-room caps + sanitized room codes
✅ **All code pushed to GitHub**: Secure, no secrets leaked
✅ **Ready for demo & hackathon submission**

> Note: mainnet is **not** deployed — the project runs on Monad testnet (chainId 10143). See `MAINNET.md` for the optional mainnet path.
