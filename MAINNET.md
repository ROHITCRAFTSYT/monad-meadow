# Going to Monad Mainnet (+25 bonus)

The app is **chain-agnostic**: the frontend reads chain, RPC, explorer, and contract from `/api/config`,
which is driven by Worker env vars (testnet defaults). Switching to mainnet = deploy the contract on 143,
then point the Worker at it. No code changes needed.

> ⚠️ Mainnet needs **real MON** for gas — the testnet faucet does not fund mainnet.
> Fund your deployer address first (from an exchange/bridge or your own funded wallet).

## 1. Deploy the contract to mainnet (chainId 143)

```bash
cd contracts
forge test        # sanity: 16 passing
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://rpc.monad.xyz \
  --private-key 0xYOUR_FUNDED_KEY \
  --broadcast
```

Copy the printed `MonadMeadow deployed at: 0x...` address → call it `$MAIN`.

## 2. Verify the source (all explorers, one call)

```bash
cd contracts
forge verify-contract $MAIN src/MonadMeadow.sol:MonadMeadow --chain 143 --show-standard-json-input > /tmp/si.json
node -e "const fs=require('fs');const p={chainId:143,contractAddress:process.env.MAIN,contractName:'src/MonadMeadow.sol:MonadMeadow',compilerVersion:'v0.8.28+commit.7893614a',standardJsonInput:JSON.parse(fs.readFileSync('/tmp/si.json')),foundryMetadata:JSON.parse(fs.readFileSync('out/MonadMeadow.sol/MonadMeadow.json')).metadata};fs.writeFileSync('/tmp/v.json',JSON.stringify(p))"
MAIN=$MAIN node -e "" # ensure MAIN is exported
curl -X POST https://agents.devnads.com/v1/verify -H "Content-Type: application/json" -d @/tmp/v.json
```

## 3. Point the app at mainnet

Edit `worker/wrangler.jsonc` `vars` to:

```jsonc
"vars": {
  "CONTRACT_ADDRESS": "0xYOUR_MAINNET_ADDRESS",
  "CHAIN_ID": "143",
  "RPC_URL": "https://rpc.monad.xyz",
  "EXPLORER": "https://monadscan.com",
  "NETWORK_NAME": "Monad Mainnet"
}
```

Then redeploy the game:

```bash
cd worker && npx wrangler deploy
```

That's it — the frontend will now add/switch wallets to Monad Mainnet (0x8f), read balances and the
market from mainnet, and every mint/trade is a real mainnet transaction.

## Keep testnet too?
Leave `worker/wrangler.jsonc` on testnet and deploy the mainnet build under a second Worker name
(`"name": "monad-meadow-main"`) so you can demo both. The contract + client code are identical.
