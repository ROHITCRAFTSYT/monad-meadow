# Monad Meadow — Build Status & Handoff

_Last updated during the build session. This is the single source of truth for what's done and what's left._

## 🔗 The four required links (say these in your pitch)

| Rubric item | Value |
| --- | --- |
| **Live URL** | https://monad-meadow.lorq.workers.dev |
| **GitHub repo** | https://github.com/ROHITCRAFTSYT/monad-meadow |
| **Contract (Monad Testnet, 10143)** | `0xd49c37f91bcdaa33aadc72cf46bfc5e25109d15f` |
| **Explorer (verified source)** | https://testnet.monadscan.com/address/0xd49c37f91bcdaa33aadc72cf46bfc5e25109d15f |
| **Deployment** | Cloudflare Workers + Durable Objects (game) · Monad Testnet (contract) |
| **Example live mint tx** | `0x6a9ecb6b82bbe298b7bdbdd658da3eca0871d8169f67961c2cc0e747433f6bdc` |

## ✅ Done

**Contract (`contracts/`)**
- `MonadMeadow.sol` — ERC-721 + on-chain marketplace, OpenZeppelin (Ownable, ReentrancyGuard), fully on-chain SVG metadata.
- `mintItem(uint8)` payable (micro-tx, 0.01–0.05 MON), `list/cancelListing/buy` (escrow marketplace, 2.5% treasury fee), owner controls (`setMintPrice`, `setFeeBps`, `withdrawTreasury`).
- **Deployed + verified** on Monad testnet (MonadScan + MonadVision, "perfect match").
- **16 Foundry tests pass** — mint pricing, escrow list/buy, cancel/refund, fee accounting, owner-only permissions, metadata.

**Game (`worker/` + `public/`)**
- Cloudflare Worker + Durable Object `WorldRoom` — realtime multiplayer over WebSockets. **Verified live** with a 2-client test (join/move/world-sync all work).
- **Private rooms** — every session generates a unique team code (in the URL); friends join by entering the code or scanning the **QR** shown in the corner. Rooms are fully isolated (verified: cross-room clients are invisible to each other). Players set their own name (persisted, propagates to others). QR via vendored **MIT `qrcode-generator`**.
- Canvas client, **Kenney CC0 sprites** (Tiny Town / Farm / Dungeon) — farmland + dungeon world, animated hero sprites, crystals, farm animals, ambient motes.
- **Collision / spatial awareness** — 143 solid colliders (trees, fences, dungeon walls, props) with per-axis sliding. Sprite no longer walks through things.
- **Wallet** — connect via injected wallet (MetaMask etc.), auto add/switch Monad testnet, balance display. **Persists across reloads** (silent `eth_accounts` restore).
- **On-chain flows in-game** — gather crystals → mint (micro-tx) → list/buy/cancel in Meadow Market (macro-tx, any price). Every crystal shows its MON value.
- Chat, floating name/chat bubbles, confetti on mint/buy, optional ambient audio.
- Zero client dependencies (raw JSON-RPC + hardcoded selectors) → demo-robust.

**Docs / repo**
- `README.md` (run-it-yourself instructions, architecture, the four links), `.monskills` metadata, `SOCIAL.md` (post copy + 30s demo shot-list), `LICENSE` (MIT + Kenney CC0 note).
- Public GitHub repo pushed. `contracts/cache/` (holds deployer key) is gitignored — **no secrets in the repo** (verified).

## 📊 Rubric coverage

- **Basic (100):** ✅ all four — public repo, README with live page + contract, deployed on testnet, publicly hosted.
- **Advance · Working (100):** ✅ functions work, ✅ contract verified, ✅ README lets others run it. **Live on-chain tx** — do a mint live during the demo (works today).
- **Advance · Virality (100):** ⏳ **YOUR ACTION** — post to X/LinkedIn tagging @monad @monad_dev @geeky_kartikey (copy ready in `SOCIAL.md`), record a 30s+ demo video (shot-list in `SOCIAL.md`), chase 5K/10K views (or 25 waitlist / 10 live users as the fallback).
- **Bonus (100):** Innovation (onchain multiplayer + NFT marketplace) and revenue (2.5% fee) are built-in. ⏳ optional: mainnet deploy (25), custom domain (15).

## ⏳ Left to do (mostly your calls)

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
