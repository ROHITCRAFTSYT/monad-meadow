# Monad Meadow

> A calm 2D multiplayer world on Monad testnet — wander a shared farmland-and-dungeon meadow, gather glowing crystals, and **mint** them as on-chain NFTs or **trade** them peer-to-peer for MON.

Monad Meadow is a hackathon project that pairs a real-time multiplayer game (Cloudflare Worker + Durable Object over WebSockets) with a fully on-chain item economy (an ERC-721 collection with a built-in escrow marketplace, verified on Monad Testnet). Every crystal you mint carries its own art and metadata generated entirely on-chain.

---

## Live

The four hackathon-required items:

| Item | Value |
| --- | --- |
| **Live URL** | `https://monad-meadow.<your-subdomain>.workers.dev` — _placeholder; filled in after `wrangler deploy` (see [Run it yourself](#run-it-yourself))_ |
| **Contract address** | [`0xd49c37f91bcdaa33aadc72cf46bfc5e25109d15f`](https://testnet.monadscan.com/address/0xd49c37f91bcdaa33aadc72cf46bfc5e25109d15f) on Monad Testnet (chainId **10143**) — source-verified on **MonadScan** and **MonadVision** |
| **GitHub repo** | `https://github.com/<your-org>/monad-meadow` — _placeholder; add your repo URL_ |
| **Deployment** | **Cloudflare Workers** (frontend + realtime multiplayer) + **Monad Testnet** (smart contract) |

**Example live mint transaction:** [`0x6a9ecb6b82bbe298b7bdbdd658da3eca0871d8169f67961c2cc0e747433f6bdc`](https://testnet.monadscan.com/tx/0x6a9ecb6b82bbe298b7bdbdd658da3eca0871d8169f67961c2cc0e747433f6bdc)

---

## Gameplay

How to play:

1. **Open the Live URL** — you spawn into the shared global meadow alongside everyone else who is online. No sign-up, no build step.
2. **Move** with **WASD** (or the arrow keys). Others see you wander in real time.
3. **Gather** — walk up to a glowing crystal and press **Space** (or **E**) to gather it into your satchel. There are five kinds: **Dewdrop, Sunbloom, Moonpetal, Emberseed, Tidecrystal**.
4. **Connect Wallet** — click **Connect Wallet** (needs MetaMask or any `window.ethereum` wallet). The app auto-switches you to Monad Testnet, adding the network if needed.
5. **Mint** — click a gathered crystal in your satchel to mint it as an ERC-721 NFT. Each kind has its own price (**0.01–0.05 MON**) plus gas. A confetti burst fires for everyone in the meadow when a mint lands.
6. **Trade in the Meadow Market** — open the market panel:
   - **List** a crystal you own for a MON price. It is escrowed by the contract until it sells or you cancel.
   - **Buy** a listed crystal — pay the seller in MON (a small 2.5% meadow fee routes to the treasury) and receive the NFT.
   - **Cancel** your own listing at any time to reclaim the escrowed crystal.
7. **Chat & vibe** — say hello in chat, toggle the ambient audio, and enjoy the calm.

> Tip: you need testnet MON to mint or trade. Grab some from the [faucet](#run-it-yourself) below.

---

## Architecture

```
                    Cloudflare Worker (worker/)
                    ┌───────────────────────────────────┐
   WASD / Space     │  fetch():                         │
 ┌──────────────┐   │   • serves static client (ASSETS) │
 │   Browser    │   │   • /api/config → chain config    │
 │ (public/)    │   │   • /ws → Durable Object          │
 │              │   │                                   │
 │ canvas game  │◄──┼──► Durable Object "WorldRoom" ────┤
 │ (game.js,    │   │   realtime shared state over WS:  │
 │  vanilla JS) │   │   players, positions, crystals,   │
 │              │   │   pickups, chat, celebrate bursts │
 └──────┬───────┘   └───────────────────────────────────┘
        │
        │ raw JSON-RPC (hardcoded 4-byte selectors)
        │ + window.ethereum (wallet: mint / list / buy)
        ▼
 ┌─────────────────────────────────────────────────────┐
 │  Monad Testnet (chainId 10143)                       │
 │  MonadMeadow.sol — ERC-721 + escrow marketplace      │
 │  0xd49c37f91bcdaa33aadc72cf46bfc5e25109d15f          │
 │  fully on-chain SVG metadata                         │
 └─────────────────────────────────────────────────────┘
```

- **Client** (`public/`): a vanilla-JS `<canvas>` game with zero dependencies. It draws the world from Kenney CC0 sprite sheets, talks to the Worker over a WebSocket for multiplayer, and talks to Monad directly via raw JSON-RPC (pre-computed selectors) and `window.ethereum` for transactions.
- **Durable Object `WorldRoom`** (`worker/src/index.ts`): one authoritative room holds the shared world — connected players, their positions, the gatherable crystals, server-side proximity checks on pickups, chat, and celebration broadcasts. It never sees a private key.
- **Contract `MonadMeadow`** (`contracts/src/MonadMeadow.sol`): the on-chain economy. Minting is a MON micro-transaction; the marketplace escrows listed tokens so they can't be double-spent. Metadata and SVG art are generated fully on-chain.

---

## Run it yourself

Everything below is copy-paste ready.

### (a) Contracts (Foundry)

Install dependencies (via [soldeer](https://soldeer.xyz)) and run the test suite:

```bash
cd contracts && forge soldeer install && forge test
```

> 16 tests in `contracts/test/MonadMeadow.t.sol` cover mint pricing, escrow list/buy, refunds/cancel, fee accounting, owner permissions, and metadata.

Deploy to Monad Testnet (replace `0xYOURKEY` with your funded deployer key):

```bash
forge script script/Deploy.s.sol:DeployScript --rpc-url https://testnet-rpc.monad.xyz --private-key 0xYOURKEY --broadcast
```

The contract at `0xd49c37f91bcdaa33aadc72cf46bfc5e25109d15f` is already deployed and verified — you only need to redeploy if you fork and change it. If you do, put your new address in `worker/wrangler` config (the `CONTRACT_ADDRESS` binding).

### (b) Worker + client (Cloudflare)

Authenticate once, then deploy the Worker (it serves the static client too):

```bash
cd worker && npx wrangler login
```

```bash
cd worker && npm install && npx wrangler deploy
```

`wrangler deploy` prints your live URL — `https://monad-meadow.<your-subdomain>.workers.dev`. Paste it into the [Live](#live) table above.

### (c) Local dev

Run the Worker and client locally with hot reload:

```bash
cd worker && npx wrangler dev
```

### Get testnet MON (faucet)

Fund your address before minting or trading (replace `0xYOURADDR`):

```bash
curl -X POST https://agents.devnads.com/v1/faucet -H "Content-Type: application/json" -d '{"chainId":10143,"address":"0xYOURADDR"}'
```

**Network details:**

- **RPC:** `https://testnet-rpc.monad.xyz`
- **Explorer:** `https://testnet.monadscan.com`
- **Chain ID:** `10143`

---

## Monad features used

- **Monad Testnet** (chainId 10143) as the settlement layer for the entire item economy.
- **On-chain NFT + marketplace micro-transactions** — minting (0.01–0.05 MON by kind) and peer-to-peer trading for MON, with an escrow marketplace and a 2.5% treasury fee.
- **Fully on-chain SVG metadata** — `tokenURI` returns base64-encoded JSON with a base64-encoded SVG, so every crystal renders in any wallet with no external hosting or IPFS.
- **Gas-tight custom errors** — the contract uses Solidity custom errors (`BadKind`, `WrongPrice`, `NotListed`, …) instead of revert strings to keep transactions cheap.

**Contract facts:** ERC-721 + marketplace, OpenZeppelin-based, Foundry, Solidity **0.8.28**, `evm_version = prague`, dependencies via soldeer.

Key functions: `mintItem(uint8 kind) payable`, `list(uint256,uint96)`, `cancelListing(uint256)`, `buy(uint256) payable` (2.5% treasury fee), `withdrawTreasury(address)` (owner), `setMintPrice` / `setFeeBps` (owner). Five kinds: Dewdrop, Sunbloom, Moonpetal, Emberseed, Tidecrystal.

---

## Credits

- **Art:** [Kenney.nl](https://kenney.nl) CC0 sprite packs — Tiny Town, Tiny Farm, Tiny Dungeon — bundled in `public/assets/`. See `public/assets/KENNEY-LICENSE.txt`.
- **Contracts:** [OpenZeppelin Contracts](https://openzeppelin.com/contracts) (ERC-721, Ownable, ReentrancyGuard, Strings, Base64).
- **Chain:** [Monad](https://monad.xyz) testnet.

---

## Production note

This is a hackathon demo on **testnet**. Before any real-funds or production marketplace use, the contract and marketplace flows would need a professional **security audit**, plus **legal and regulatory review** (NFTs, custody/escrow, fees, and consumer protection vary by jurisdiction). Do not use it with real value as-is.

---

## License

MIT — see [`LICENSE`](./LICENSE). Art assets are CC0 (see `public/assets/KENNEY-LICENSE.txt`).
