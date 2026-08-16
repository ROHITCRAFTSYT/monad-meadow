#!/usr/bin/env pwsh
# Monad Meadow - Contract Deployment & Funding Script
# This script deploys the updated contract and helps fund it with MON rewards

param(
    [Parameter(Mandatory=$false)]
    [string]$PrivateKey,
    
    [Parameter(Mandatory=$false)]
    [string]$FundAmount = "0.5"
)

$ErrorActionPreference = "Stop"

Write-Host "🌿 Monad Meadow - Contract Deployment Tool" -ForegroundColor Green
Write-Host ""

# 1. Get Private Key if not provided
if (-not $PrivateKey) {
    Write-Host "Enter your private key (format: 0x... with 64 hex characters):"
    $PrivateKey = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
}

if (-not $PrivateKey.StartsWith("0x") -or $PrivateKey.Length -ne 66) {
    Write-Host "❌ Invalid private key format. Must be 0x followed by 64 hex characters." -ForegroundColor Red
    exit 1
}

# 2. Deploy Contract
Write-Host "📝 Deploying MonadMeadow contract..." -ForegroundColor Cyan
Push-Location contracts

try {
    $output = forge script script/Deploy.s.sol `
        --rpc-url https://testnet-rpc.monad.xyz `
        --broadcast `
        --private-key $PrivateKey 2>&1

    Write-Host $output

    # Extract contract address from output
    $addressMatch = $output | Select-String "MonadMeadow deployed at: (0x[a-fA-F0-9]{40})"
    if ($addressMatch) {
        $contractAddress = $addressMatch.Matches[0].Groups[1].Value
        Write-Host "✅ Contract deployed at: $contractAddress" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Could not extract contract address from output" -ForegroundColor Yellow
        Write-Host "Please check the output above and manually extract the address"
        exit 1
    }
} catch {
    Write-Host "❌ Deployment failed: $_" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}

# 3. Update worker config
Write-Host ""
Write-Host "📋 Updating worker configuration..." -ForegroundColor Cyan

$wranglerPath = "worker/wrangler.jsonc"
$wranglerContent = Get-Content $wranglerPath -Raw

# Update the CONTRACT_ADDRESS in wrangler.jsonc
$newContent = $wranglerContent -replace '"CONTRACT_ADDRESS":\s*"0x[a-fA-F0-9]{40}"', "`"CONTRACT_ADDRESS`": `"$contractAddress`""
Set-Content $wranglerPath $newContent

Write-Host "✅ Updated CONTRACT_ADDRESS to: $contractAddress" -ForegroundColor Green

# 4. Display funding instructions
Write-Host ""
Write-Host "💰 Next: Fund the contract with MON for rewards" -ForegroundColor Cyan
Write-Host ""
Write-Host "Send $FundAmount MON to: $contractAddress" -ForegroundColor Yellow
Write-Host ""
Write-Host "Using MetaMask or Web3.js:" -ForegroundColor Gray
Write-Host "  const tx = await signer.sendTransaction({" -ForegroundColor Gray
Write-Host "    to: '$contractAddress'," -ForegroundColor Gray
Write-Host "    value: ethers.utils.parseEther('$FundAmount')" -ForegroundColor Gray
Write-Host "  });" -ForegroundColor Gray
Write-Host ""

# 5. Display deployment summary
Write-Host "📊 Deployment Summary" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "Contract Address: $contractAddress"
Write-Host "Network: Monad Testnet (10143)"
Write-Host "Worker Config: Updated ✓"
Write-Host "Reward Amounts:"
Write-Host "  • Dewdrop: 0.005 MON"
Write-Host "  • Sunbloom: 0.01 MON"
Write-Host "  • Moonpetal: 0.015 MON"
Write-Host "  • Emberseed: 0.02 MON"
Write-Host "  • Tidecrystal: 0.025 MON"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host ""

Write-Host "🚀 Next Steps:" -ForegroundColor Green
Write-Host "1. Fund the contract with $FundAmount MON"
Write-Host "2. Run: cd worker && wrangler deploy"
Write-Host "3. Test at: http://localhost:8787 (or deployed URL)"
Write-Host ""
Write-Host "✨ Players will now receive real MON when gathering orbs!" -ForegroundColor Green
