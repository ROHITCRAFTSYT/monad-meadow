<p align="center">
  <img src="https://img.shields.io/badge/Monad-Testnet-8B5CF6?style=for-the-badge&logo=ethereum&logoColor=white" alt="Monad Testnet" />
  <img src="https://img.shields.io/badge/Solidity-0.8.28-363636?style=for-the-badge&logo=solidity&logoColor=white" alt="Solidity" />
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/ERC--721-NFT-3C3C3D?style=for-the-badge&logo=ethereum&logoColor=white" alt="ERC-721" />
  <img src="https://img.shields.io/badge/License-MIT-22C55E?style=for-the-badge" alt="MIT License" />
</p>

<h1 align="center">🌿 Monad Meadow</h1>

<p align="center">
  <strong>A real-time multiplayer blockchain game with a fully on-chain NFT economy — built on Monad.</strong>
</p>

<p align="center">
  Explore a shared pixel-art world · Gather mystical crystals · Mint them as NFTs · Trade peer-to-peer on an escrow marketplace · Best a dragon boss for a rare Tidecrystal drop
</p>

<p align="center">
  <a href="https://monad-meadow.lorq.workers.dev"><strong>🎮 Play Now</strong></a> &nbsp;·&nbsp;
  <a href="https://testnet.monadscan.com/address/0xb1c49827eDB08AD2E34f002D962EB8B87B855296"><strong>📜 Verified Contract</strong></a> &nbsp;·&nbsp;
  <a href="#architecture"><strong>🏗️ Architecture</strong></a> &nbsp;·&nbsp;
  <a href="#getting-started"><strong>🚀 Getting Started</strong></a>
</p>

---

## 📋 Table of Contents

- [Overview](#overview)
- [Live Deployment](#-live-deployment)
- [Features](#-features)
- [Gameplay](#-gameplay)
- [Dragon Boss Fight](#-dragon-boss-fight)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Monad Integration](#-monad-integration)
- [Smart Contract API](#-smart-contract-api)
- [Credits](#-credits)
- [Production Notice](#%EF%B8%8F-production-notice)
- [License](#-license)

---

## Overview

**Monad Meadow** is a production-ready multiplayer blockchain game that combines real-time collaborative gameplay with a fully on-chain item economy. Players explore a shared pixel-art world, gather digital assets, and trade them peer-to-peer via an ERC-721 escrow marketplace — all on the Monad blockchain.

The project demonstrates a scalable architecture for blockchain gaming by pairing a real-time multiplayer engine (Cloudflare Workers + Durable Objects) with a verified smart contract economy.

---

## 🔗 Live Deployment

| Component | Details |
|:--|:--|
| **🎮 Application** | [monad-meadow.lorq.workers.dev](https://monad-meadow.lorq.workers.dev) |
| **📜 Smart Contract** | [`0xb1c49827...855296`](https://testnet.monadscan.com/address/0xb1c49827eDB08AD2E34f002D962EB8B87B855296) — Hardened build, verified on MonadScan + MonadVision |
| **🔗 Network** | Monad Testnet · Chain ID `10143` |
| **☁️ Infrastructure** | Cloudflare Workers + Durable Objects |
| **🧾 Example Tx** | 0xb1a2f3b7c233956eb0cc260a0cce22bc5201086d7eec51bd3f2b86ebbc6541b9 — Live mint proof |

---

## ✨ Features

### 🎮 Real-Time Multiplayer
- WebSocket-powered shared world with live player synchronization
- Private rooms with unique team codes and QR code sharing
- In-game chat with floating name and speech bubbles
- Confetti celebrations broadcast to all players on mint events

### 💎 On-Chain NFT Economy
- **5 crystal types** — Dewdrop, Sunbloom, Moonpetal, Emberseed, Tidecrystal
- **ERC-721 minting** at micro-transaction prices (0.01–0.05 MON per crystal)
- **Escrow marketplace** — list, buy, and cancel with trustless on-chain settlement
- **2.5% treasury fee** on marketplace trades — built-in revenue model

### 🐉 Dragon Boss Fight (Cosmetic PvE)
- PvE combat with a dungeon dragon boss — purely in-game, no funds at stake
- **Victory** → a rare **Tidecrystal** drops into your satchel, mintable like any crystal
- **Defeat** → you simply respawn at the meadow and can retry
- Real-time health bars, attack feedback, and respawn mechanics

### 🤖 Idle Auto-Miner (Autonomous Agent)
- After ~6 seconds of no input, an **RL-style autonomous agent** takes over your sprite
- A greedy policy navigates to the highest value-weighted nearby crystal and gathers it
- Optional **auto-mint** toggle mints gathered crystals automatically
- Any keyboard, joystick, or tap input instantly hands control back to you

### 🎨 Fully On-Chain Art & Metadata
- `tokenURI` returns base64-encoded JSON + SVG — no IPFS, no external hosting
- Every crystal renders natively in any wallet or marketplace
- Gas-optimized with Solidity custom errors (`BadKind`, `WrongPrice`, `NotListed`, ...)

### 🌐 Zero-Dependency Client
- Vanilla JavaScript `<canvas>` game — no React, no bundler, no node_modules
- Pixel-art world with Kenney CC0 sprite packs (Tiny Town / Farm / Dungeon)
- 143 solid colliders for realistic spatial navigation
- Mobile-friendly: touch joystick, tap-to-gather, swipe-to-open panels

---

## 🎮 Gameplay

1. **Open the [Live URL](https://monad-meadow.lorq.workers.dev)** — spawn into the shared global meadow. No sign-up required.
2. **Move** with **WASD** or arrow keys. Other players see you in real time.
3. **Gather** — walk up to a glowing crystal and press **Space** or **E** to collect it.
4. **Connect Wallet** — click **Connect Wallet** (MetaMask or any `window.ethereum` provider). The app auto-adds and switches to Monad Testnet.
5. **Mint** — click a gathered crystal in your satchel to mint it as an ERC-721 NFT. Confetti fires for everyone in the meadow!
6. **Trade** in the **Meadow Market**:
   - **List** a crystal at your chosen MON price (escrowed by the contract)
   - **Buy** a listed crystal (2.5% fee to treasury)
   - **Cancel** your listing anytime to reclaim your crystal
7. **Fight the Dragon** — enter the dungeon in the top-right for a PvE boss encounter. Win and a rare Tidecrystal drops into your satchel (mint it like any crystal); lose and you just respawn. No MON is ever at stake.
8. **Go idle** — stop touching the controls for ~6 seconds and the built-in auto-miner takes over, walking to the best nearby crystal and gathering it. Toggle auto-mint to mint automatically. Any input returns control instantly.
9. **Chat & vibe** — say hello, toggle ambient audio, and enjoy the meadow.

> **💡 Tip:** You need testnet MON to mint or trade. See [Getting Testnet MON](#getting-testnet-mon) below.

---

## 🐉 Dragon Boss Fight

The dungeon houses a fearsome dragon boss. It is a **cosmetic PvE encounter** — no MON is at stake, there is no on-chain bounty, and there is no death penalty:

| Stat | Value |
|:--|:--|
| Dragon HP | 50 |
| Dragon Attack | 5 HP/sec |
| Player HP | 100 |
| Player Attack | 3 damage/click |
| Victory | **Rare Tidecrystal drop** into your satchel (mint it normally) |
| Defeat | **Respawn** at the meadow — nothing lost |

**How it works:**
1. Enter the dungeon (top-right of the map)
2. Click/tap rapidly to attack the dragon (~17 hits to defeat)
3. Manage your health — the dragon deals continuous damage
4. On **victory**: a rare Tidecrystal is added to your satchel; mint it like any other crystal via `mintItem`
5. On **defeat**: you respawn at the meadow with full health and can retry immediately

---

## 🏗️ Architecture

```
                     Cloudflare Worker (worker/)
                     ┌───────────────────────────────────┐
    WASD / Space     │  fetch():                         │
  ┌──────────────┐   │   • Serves static client (ASSETS) │
  │   Browser    │   │   • /api/config → chain config    │
  │  (public/)   │   │   • /ws → Durable Object          │
  │              │   │                                   │
  │ Canvas game  │◄──┼──► Durable Object "WorldRoom" ────┤
  │ (game.js,    │   │   Realtime shared state over WS:  │
  │  vanilla JS) │   │   players, positions, crystals,   │
  │              │   │   pickups, chat, celebrate bursts │
  └──────┬───────┘   └───────────────────────────────────┘
         │
         │ Raw JSON-RPC (hardcoded 4-byte selectors)
         │ + window.ethereum (wallet: mint / list / buy)
         ▼
  ┌─────────────────────────────────────────────────────┐
  │  Monad Testnet (Chain ID 10143)                      │
  │  MonadMeadow.sol — ERC-721 + Escrow Marketplace      │
  │  0xb1c49827eDB08AD2E34f002D962EB8B87B855296          │
  │  Fully on-chain SVG metadata · no unbacked payouts   │
  └─────────────────────────────────────────────────────┘
```

| Layer | Description |
|:--|:--|
| **Client** (`public/`) | Vanilla-JS `<canvas>` game with zero dependencies. Draws the world from Kenney CC0 sprites, communicates with the Worker over WebSocket for multiplayer, and talks to Monad via raw JSON-RPC + `window.ethereum` for transactions. |
| **Server** (`worker/`) | Cloudflare Durable Object `WorldRoom` — one authoritative room holding shared world state: connected players, positions, gatherable crystals, server-side proximity checks, chat, and celebration broadcasts. Never sees a private key. |
| **Contract** (`contracts/`) | `MonadMeadow.sol` — the hardened on-chain economy. Minting is a MON micro-transaction; the marketplace escrows listed tokens and settles trades peer-to-peer under a reentrancy guard. There are **no reward or payout functions** — the only inbound MON is a mint price or a buyer's payment, so there is no pool for anyone to drain. Metadata and SVG art are generated entirely on-chain. |

---

## 🛠️ Tech Stack

| Category | Technology |
|:--|:--|
| **Blockchain** | Monad Testnet (EVM-compatible, Chain ID 10143) |
| **Smart Contracts** | Solidity 0.8.28, OpenZeppelin (ERC-721, Ownable, ReentrancyGuard) |
| **Build & Test** | Foundry (Forge), Soldeer (dependency management) |
| **Backend** | Cloudflare Workers + Durable Objects (TypeScript) |
| **Frontend** | Vanilla JavaScript, HTML5 Canvas, CSS |
| **Assets** | Kenney CC0 Sprite Packs (Tiny Town, Tiny Farm, Tiny Dungeon) |
| **Multiplayer** | WebSockets via Durable Objects |
| **Wallet** | MetaMask / any injected `window.ethereum` provider |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for contracts)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (for deployment)
- A wallet with testnet MON

### Contracts (Foundry)

Install dependencies and run the test suite:

```bash
cd contracts && forge soldeer install && forge test
```

> Tests in `contracts/test/MonadMeadow.t.sol` cover mint pricing, escrow list/buy, refunds/cancel, fee accounting, owner permissions, and on-chain metadata.

Deploy to Monad Testnet:

```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key 0xYOUR_PRIVATE_KEY \
  --broadcast
```

> The hardened contract at `0xb1c49827...855296` is already deployed and verified. Only redeploy if you fork and modify it.

### Worker + Client (Cloudflare)

```bash
cd worker && npx wrangler login
cd worker && npm install && npx wrangler deploy
```

### Local Development

Run locally with hot reload:

```bash
cd worker && npx wrangler dev
```

### Getting Testnet MON

```bash
curl -X POST https://agents.devnads.com/v1/faucet \
  -H "Content-Type: application/json" \
  -d '{"chainId":10143,"address":"0xYOUR_ADDRESS"}'
```

**Network Details:**

| Parameter | Value |
|:--|:--|
| RPC URL | `https://testnet-rpc.monad.xyz` |
| Explorer | `https://testnet.monadscan.com` |
| Chain ID | `10143` |

---

## 🟣 Monad Integration

This project leverages the Monad blockchain for its entire on-chain economy:

- **Monad Testnet** (Chain ID 10143) as the settlement layer for all item transactions
- **NFT micro-transactions** — minting costs 0.01–0.05 MON per crystal type
- **Escrow marketplace** — peer-to-peer trading with a 2.5% treasury fee, settled under a reentrancy guard
- **No unbacked payout paths** — the contract has no reward/bounty/penalty functions; the only inbound MON is a mint price or a buyer's escrowed payment, so there is nothing for an attacker to drain
- **Fully on-chain SVG metadata** — `tokenURI` returns base64-encoded JSON with embedded SVG; no IPFS or external hosting required
- **Gas-optimized custom errors** — `BadKind`, `WrongPrice`, `NotListed`, etc. instead of revert strings

---

## 📜 Smart Contract API

**Contract:** [`MonadMeadow.sol`](contracts/src/MonadMeadow.sol) · ERC-721 + Escrow Marketplace (hardened)

| Function | Description | Cost |
|:--|:--|:--|
| `mintItem(uint8 kind)` | Mint a crystal NFT by kind (0–4) | 0.01–0.05 MON |
| `list(uint256 tokenId, uint96 price)` | List an NFT on the marketplace (escrowed) | Gas only |
| `buy(uint256 tokenId)` | Buy a listed NFT | Listed price + gas |
| `cancelListing(uint256 tokenId)` | Cancel your listing and reclaim the NFT | Gas only |
| `withdrawTreasury(address)` | Withdraw accumulated fees (owner only) | Gas only |
| `setMintPrice(uint8, uint256)` | Update mint price for a kind (owner only) | Gas only |
| `setFeeBps(uint256)` | Update marketplace fee (owner only) | Gas only |
| `tokenURI(uint256)` / `kindName(uint8)` | Read on-chain metadata / crystal name | View |

Plus the standard **ERC-721** and **Ownable** surface. There are deliberately **no reward, bounty, or penalty functions** — earlier `claimReward` / `claimDragonBounty()` / `payDeathPenalty()` designs were removed because they were drainable-by-anyone holes.

**Crystal Types:** Dewdrop · Sunbloom · Moonpetal · Emberseed · Tidecrystal

---

## 🔒 Security & Hardening

The current contract is a redeployed, hardened build. The design goal is that **no MON can leave the contract except back to the party that put it in**:

- **No unbacked payout paths.** The contract has no reward, bounty, or penalty functions. Every inbound MON is either a mint price or a buyer's escrowed payment. Removed `claimReward`, `claimDragonBounty()`, and `payDeathPenalty()` — each was a "drainable-by-anyone" hole.
- **Escrowed marketplace with reentrancy guards.** Listed tokens are held by the contract; `buy` pays the seller and takes the 2.5% fee atomically, guarded against reentrancy (OpenZeppelin `ReentrancyGuard`).
- **Owner controls only.** `withdrawTreasury`, `setMintPrice`, and `setFeeBps` are `Ownable`-gated.
- **Rate-limited multiplayer server.** The Durable Object room applies per-connection rate limits, enforces a **per-room player cap**, and **sanitizes room codes** before use. The server never sees a private key.

---

## 🙏 Credits

- **Art** — [Kenney.nl](https://kenney.nl) CC0 sprite packs (Tiny Town, Tiny Farm, Tiny Dungeon). See [`public/assets/KENNEY-LICENSE.txt`](public/assets/KENNEY-LICENSE.txt).
- **Contracts** — [OpenZeppelin](https://openzeppelin.com/contracts) (ERC-721, Ownable, ReentrancyGuard, Strings, Base64).
- **Chain** — [Monad](https://monad.xyz) Testnet.
- **QR Code** — [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).

---

## ⚠️ Production Notice

This is a **hackathon demo on testnet**. Before any real-funds or production marketplace use, the contract and marketplace flows require:

- A professional **security audit**
- **Legal and regulatory review** (NFTs, custody/escrow, fees, and consumer protection vary by jurisdiction)

**Do not use with real value as-is.**

---

## 📄 License

[MIT](LICENSE) — see [`LICENSE`](LICENSE) for details. Art assets are CC0 (see [`public/assets/KENNEY-LICENSE.txt`](public/assets/KENNEY-LICENSE.txt)).

---

<p align="center">
  <strong>Built with 💜 for the Monad ecosystem</strong>
</p>
