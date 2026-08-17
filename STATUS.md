# Monad Meadow — Build Status & Handoff

_Last updated during the build session. This is the single source of truth for what's done and what's left._

## 🔗 The four required links (say these in your pitch)

| Rubric item | Value |
| --- | --- |
| **Live URL** | https://monad-meadow.lorq.workers.dev |
| **GitHub repo** | https://github.com/ROHITCRAFTSYT/monad-meadow |
| **Contract (Monad Testnet, 10143)** | `0xb1c49827eDB08AD2E34f002D962EB8B87B855296` |
| **Explorer (verified source)** | https://testnet.monadscan.com/address/0xb1c49827eDB08AD2E34f002D962EB8B87B855296 |
| **Deployment** | Cloudflare Workers + Durable Objects (game) · Monad Testnet (contract) |
| **Example live mint tx** | 0xb1a2f3b7c233956eb0cc260a0cce22bc5201086d7eec51bd3f2b86ebbc6541b9 |

## ✅ Done

**Contract (`contracts/`)**
- `MonadMeadow.sol` — ERC-721 + on-chain marketplace, OpenZeppelin (Ownable, ReentrancyGuard), fully on-chain SVG metadata.
- `mintItem(uint8)` payable (micro-tx, 0.01–0.05 MON), `list/cancelListing/buy` (escrow marketplace, 2.5% treasury fee), owner controls (`setMintPrice`, `setFeeBps`, `withdrawTreasury`), plus `tokenURI`/`kindName` and the ERC-721/Ownable surface. **No reward/bounty/penalty functions** — `claimReward`, `claimDragonBounty()`, and `payDeathPenalty()` were removed as drainable-by-anyone holes.
- **Redeployed as a hardened, security-audited build.** No unbacked payout paths: the only inbound MON is a mint price or an escrowed buyer payment, all under a reentrancy guard.
- **Deployed + verified** on Monad testnet (MonadScan + MonadVision, "perfect match").
- **Foundry tests pass** — mint pricing, escrow list/buy, cancel/refund, fee accounting, owner-only permissions, metadata.

**Game (`worker/` + `public/`)**
- Cloudflare Worker + Durable Object `WorldRoom` — realtime multiplayer over WebSockets. **Verified live** with a 2-client test (join/move/world-sync all work).
- **Private rooms** — every session generates a unique team code (in the URL); friends join by entering the code or scanning the **QR** shown in the corner. Rooms are fully isolated (verified: cross-room clients are invisible to each other). Players set their own name (persisted, propagates to others). QR via vendored **MIT `qrcode-generator`**.
- Canvas client, **Kenney CC0 sprites** (Tiny Town / Farm / Dungeon) — farmland + dungeon world, animated hero sprites, crystals, farm animals, ambient motes.
- **Collision / spatial awareness** — 143 solid colliders (trees, fences, dungeon walls, props) with per-axis sliding. Sprite no longer walks through things.
- **Wallet** — connect via injected wallet (MetaMask etc.), auto add/switch Monad testnet, balance display. **Persists across reloads** (silent `eth_accounts` restore).
- **On-chain flows in-game** — gather crystals → mint (micro-tx) → list/buy/cancel in Meadow Market (macro-tx, any price). Every crystal shows its MON value.
- **Dragon boss fight** — cosmetic PvE dungeon encounter, no funds at stake: win → a rare **Tidecrystal** drops into your satchel (mint it normally), lose → respawn, nothing lost. Real-time health bars, attack feedback, respawn.
- **Idle auto-miner** — after ~6s of no input an RL-style autonomous agent takes over the sprite, walks to the highest value-weighted nearby crystal and gathers it; optional auto-mint toggle mints as it goes. Any input hands control back.
- Chat, floating name/chat bubbles, confetti on mint/buy, optional ambient audio.
- Zero client dependencies (raw JSON-RPC + hardcoded selectors) → demo-robust.
- **Server hardening** — the `WorldRoom` Durable Object is rate-limited, enforces a per-room player cap, and sanitizes room codes.

**Docs / repo**
- `README.md` (run-it-yourself instructions, architecture, the four links), `.monskills` metadata, `SOCIAL.md` (post copy + 30s demo shot-list), `LICENSE` (MIT + Kenney CC0 note).
- Public GitHub repo pushed. `contracts/cache/` (holds deployer key) is gitignored — **no secrets in the repo** (verified).

## 📊 Rubric coverage

- **Basic (100):** ✅ all four — public repo, README with live page + contract, deployed on testnet, publicly hosted.
- **Advance · Working (100):** ✅ functions work, ✅ contract verified, ✅ README lets others run it. **Live on-chain tx** — do a mint live during the demo (works today).
- **Advance · Virality (100):** ⏳ **YOUR ACTION** — post to X/LinkedIn tagging @monad @monad_dev @geeky_kartikey (copy ready in `SOCIAL.md`), record a 30s+ demo video (shot-list in `SOCIAL.md`), chase 5K/10K views (or 25 waitlist / 10 live users as the fallback).
- **Bonus (100):** Innovation (onchain multiplayer + NFT marketplace) and revenue (2.5% fee) are built-in. ⏳ optional: mainnet deploy (25), custom domain (15).

## 🆕 Latest in this session
- **Redesigned world** — no more random scatter. Zoned map: village plaza + fountain at the crossroads, organized farm (crop rows + animal pen), forest grove, 3 ponds, dungeon, all linked by dirt roads. Crystals are now crisp faceted diamonds (fixed a square-artifact from an opaque sprite tile).
- **Real wallet impact** — the mint/buy txs were always real MON transfers; now the UI proves it: live balance **flashes + shows the MON delta** on a confirmed tx, refreshes are gated on the actual tx receipt (`waitForReceipt`), and the market shows live onchain **minted / listed** counts.
- **Private rooms + QR** and **mobile UI** (tap-to-open sheets + joystick + gather button) — both live and verified.

## ⏳ Left to do (mostly your calls)
0. **MAINNET DEPLOY (not done yet — needs funding).** The faucet is testnet-only, so mainnet needs a wallet with **real MON**. Steps: fund your address, then from `contracts/`: `forge script script/Deploy.s.sol:DeployScript --rpc-url https://rpc.monad.xyz --private-key 0xYOURKEY --broadcast` (chainId 143), verify via the agent API with `chainId:143`, then set `worker/wrangler.jsonc` `CONTRACT_ADDRESS` (and the `/api/config` chainId 143 + rpc `https://rpc.monad.xyz` + explorer) and `npx wrangler deploy`. +25 bonus.

1. **Post on socials + record demo** — `SOCIAL.md` has ready copy and a shot-list. This is the biggest remaining points block (up to 100).
2. **(Optional) Custom domain** — add one in the Cloudflare dashboard → Workers route → your domain. +15 bonus.
3. **(Optional) Mainnet deploy** — redeploy the contract to Monad mainnet (chainId 143, needs real MON) and update `worker/wrangler.jsonc` `CONTRACT_ADDRESS` + redeploy. +25 bonus. Recommend staying on testnet for the demo.
4. **(Nice-to-have) Durable Object hibernation + alarms** — current DO keeps state in memory; fine during a live session, but world state resets if the room empties for a while. Not required for the demo.

## 🔑 Contract owner / deployer wallet

- The contract owner is a **throwaway testnet deployer** generated during the build: address `0x9B962302c087F82ef631EE0d55C361F3180C45b2`.
- Its private key is stored **locally only** (session scratchpad, not in the repo). It controls `withdrawTreasury` / `setMintPrice`. For any real use, redeploy with your own keystore (see README) — do not reuse this throwaway key.
- Fund any address from the agent faucet: `curl -X POST https://agents.devnads.com/v1/faucet -H "Content-Type: application/json" -d '{"chainId":10143,"address":"0xYOURADDR"}'`

## 🚀 Redeploy cheatsheet

```bash
# game (frontend + multiplayer)
cd worker && npx wrangler deploy

# contract (from contracts/)
cd contracts && forge test
forge script script/Deploy.s.sol:DeployScript --rpc-url https://testnet-rpc.monad.xyz --private-key 0xYOURKEY --broadcast
```
