# Monad Meadow — Deployment & Hardening Guide

## Status: Hardened contract deployed ✓

The game runs on a **redeployed, security-hardened** `MonadMeadow.sol`. An earlier design shipped reward/dragon-payout functions (`claimReward`, `claimDragonBounty()`, `payDeathPenalty()`) that were **drainable by anyone** — any caller could pull MON out of the contract. Those were **removed** and the contract was redeployed and re-verified.

> **There is no reward/gather-payout flow.** Gathering a crystal is cosmetic and adds it to your satchel. MON only moves when you **mint** a crystal (you pay a price) or **trade** on the escrowed marketplace (buyer pays seller, 2.5% fee to treasury).

### The current contract surface

```solidity
mintItem(uint8 kind) payable        // mint a crystal NFT (0.01–0.05 MON)
list(uint256 tokenId, uint96 price) // list an owned NFT (escrowed)
cancelListing(uint256 tokenId)      // reclaim a listed NFT
buy(uint256 tokenId) payable        // buy a listed NFT (reentrancy-guarded)
setMintPrice(uint8, uint256)        // owner only
setFeeBps(uint256)                  // owner only
withdrawTreasury(address)           // owner only
tokenURI(uint256) / kindName(uint8) // on-chain metadata
// + standard ERC-721 and Ownable
```

**No `receive()` reward pool, no bounty, no penalty.** The only way MON enters the contract is a mint price or a buyer's escrowed payment, so there is nothing for an attacker to drain.

## Deployment Steps

### Step 1: Deploy the contract

```bash
cd contracts
forge test        # sanity: all tests passing
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://testnet-rpc.monad.xyz \
  --broadcast \
  --private-key 0xYOUR_PRIVATE_KEY_HERE
```

Replace `0xYOUR_PRIVATE_KEY_HERE` with your deployer key (64 hex chars, `0x`-prefixed). Never commit this key.

### Step 2: Update Worker config

After deployment, set the contract address in `worker/wrangler.jsonc`:

```jsonc
"vars": {
    "CONTRACT_ADDRESS": "0xYOUR_NEW_CONTRACT_ADDRESS"
}
```

> No reward-pool funding step is needed — the contract holds no payout pool. It only ever holds escrowed listings and accrued treasury fees, which the owner withdraws via `withdrawTreasury`.

### Step 3: Deploy the Worker

```bash
cd worker
npx wrangler deploy
```

## Testing Locally

1. **Start the worker locally:**
   ```bash
   cd worker
   npx wrangler dev
   ```

2. **Connect your wallet** (MetaMask with Monad Testnet configured)

3. **Walk up to a crystal and press Space** — it drops into your satchel (cosmetic, no transaction)

4. **Click the satchel crystal to mint** and observe:
   - ✓ MetaMask prompts for the mint price (0.01–0.05 MON)
   - ✓ Confetti fires on the confirmed mint
   - ✓ The minted token renders from on-chain SVG metadata
   - ✓ Transaction visible on https://testnet.monadscan.com

5. **Open the Meadow Market** to list/buy and confirm MON moves peer-to-peer.

## Contract selectors in the client

`public/game.js` uses hardcoded 4-byte selectors for `mintItem`, `list`, `cancelListing`, and `buy`. There are **no** `claimReward` / `claimDragonBounty` / `payDeathPenalty` selectors — those functions do not exist on the contract. The dragon's Tidecrystal reward is minted through the ordinary `mintItem` path.

## Security notes

- **No unbacked payout paths** — mint + escrowed marketplace only.
- **Reentrancy guards** on marketplace settlement (OpenZeppelin `ReentrancyGuard`).
- **Owner-gated admin** — `setMintPrice`, `setFeeBps`, `withdrawTreasury` are `Ownable`.
- **Rate-limited multiplayer server** — the `WorldRoom` Durable Object applies per-connection rate limits, a per-room player cap, and sanitizes room codes. It never sees a private key.
- **No secrets in the repo** — deployer keys live in gitignored `contracts/cache/` / local env only; `.env.example` is the safe template.

## Troubleshooting

**Mint reverts with `WrongPrice`:** send exactly the configured mint price for that kind (`setMintPrice` controls it).

**Mint reverts with `BadKind`:** `kind` must be 0–4 (Dewdrop, Sunbloom, Moonpetal, Emberseed, Tidecrystal).

**Buy reverts with `NotListed`:** the token is not currently listed, or was already bought/cancelled.

**Contract address in game is wrong:** update `CONTRACT_ADDRESS` in `worker/wrangler.jsonc` and redeploy the Worker.

## Mainnet

Mainnet is **not** deployed. The app runs on Monad **testnet** (chainId 10143). To move to mainnet later, see `MAINNET.md` — it needs a wallet funded with real MON.
