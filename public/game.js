"use strict";
/* Monad Meadow — calm multiplayer client.
   No build step, no libraries: the on-chain layer talks raw JSON-RPC with
   pre-computed 4-byte selectors so the demo never depends on a CDN. */

// ------------------------------------------------------------------ kinds
const KIND = {
  names: ["Dewdrop", "Sunbloom", "Moonpetal", "Emberseed", "Tidecrystal"],
  colors: ["#8fd3c7", "#ffd98e", "#c9b6ff", "#ff9d8a", "#8ec5ff"],
};
const KIND_COUNT = 5;

// selectors (cast sig) — must match MonadMeadow.sol
const SEL = {
  mintItem: "0x3565a4ff", // mintItem(uint8)
  list: "0x67d36903", // list(uint256,uint96)
  cancelListing: "0x305a67a8", // cancelListing(uint256)
  buy: "0xd96a094a", // buy(uint256)
  mintPrice: "0x8147ef37", // mintPrice(uint8)
  listings: "0xde74e57b", // listings(uint256)
  ownerOf: "0x6352211e", // ownerOf(uint256)
  kindOf: "0x2345e28c", // kindOf(uint256)
  nextTokenId: "0x75794a3c", // nextTokenId()
  tokenURI: "0xc87b56dd", // tokenURI(uint256)
};
let CHAIN_HEX = "0x279f"; // 10143 by default; set from CFG.chainId at boot

let CFG = null; // {contractAddress, rpc, chainId, explorer}

// ------------------------------------------------------------------ room / invite
function genRoomCode() {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // unambiguous chars only
  let s = "";
  const a = new Uint32Array(5);
  try { crypto.getRandomValues(a); } catch {}
  for (let i = 0; i < 5; i++) s += alpha[(a[i] || Math.floor(Math.random() * 1e9)) % alpha.length];
  return s;
}
function currentRoom() {
  const u = new URL(location.href);
  let r = (u.searchParams.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (!r) {
    r = genRoomCode();
    u.searchParams.set("room", r);
    history.replaceState(null, "", u.toString());
  }
  return r;
}
const ROOM = currentRoom();
const INVITE_URL = location.origin + "/?room=" + ROOM;

// ------------------------------------------------------------------ helpers
const $ = (id) => document.getElementById(id);
const encUint = (v) => BigInt(v).toString(16).padStart(64, "0");
const encAddr = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const toHexWei = (v) => "0x" + BigInt(v).toString(16);

function parseEther(s) {
  s = String(s).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return 0n; // plain decimals only (no 1e5 / 0x / Infinity)
  let [i, f = ""] = s.split(".");
  f = (f + "0".repeat(18)).slice(0, 18);
  return BigInt(i || "0") * 10n ** 18n + BigInt(f || "0");
}
function formatEther(wei, dp = 4) {
  wei = BigInt(wei);
  const i = wei / 10n ** 18n;
  let f = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, dp).replace(/0+$/, "");
  return i.toString() + (f ? "." + f : "");
}
const shortAddr = (a) => a.slice(0, 6) + "…" + a.slice(-4);

function gemSVG(kind, size) {
  const c = KIND.colors[kind];
  return `<svg class="gem" viewBox="0 0 40 40" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="20,3 35,20 20,37 5,20" fill="${c}" stroke="#fff" stroke-width="2"/>
    <polygon points="20,3 20,37 5,20" fill="#000" opacity="0.09"/>
    <polygon points="20,3 35,20 20,20" fill="#fff" opacity="0.18"/>
  </svg>`;
}

// ------------------------------------------------------------------ on-chain reads (public RPC)
async function rpc(method, params) {
  const r = await fetch(CFG.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}
const ethCall = (data) => rpc("eth_call", [{ to: CFG.contractAddress, data }, "latest"]);

// wait for a tx to actually land on Monad, so wallet/market updates reflect real state
async function waitForReceipt(hash, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await rpc("eth_getTransactionReceipt", [hash]);
      if (r && r.blockNumber) {
        setTxProcessStage(4, "Transaction confirmed. The receipt landed and the wallet balance has been refreshed.");
        updateMarketProcessUI();
        return r;
      }
    } catch {}
    await new Promise((res) => setTimeout(res, 700));
  }
  setTxProcessStage(4, "Transaction submitted. Keep an eye on the wallet while the Monad network confirms it.");
  return null;
}

async function readNextTokenId() {
  return parseInt(await ethCall(SEL.nextTokenId), 16);
}
async function readMintPrice(kind) {
  return BigInt(await ethCall(SEL.mintPrice + encUint(kind)));
}
async function readListing(id) {
  const r = (await ethCall(SEL.listings + encUint(id))).replace(/^0x/, "");
  const seller = "0x" + r.slice(24, 64);
  const price = BigInt("0x" + r.slice(64, 128));
  return { seller, price };
}
async function readOwner(id) {
  const r = (await ethCall(SEL.ownerOf + encUint(id))).replace(/^0x/, "");
  return "0x" + r.slice(24, 64);
}
async function readKind(id) {
  return parseInt(await ethCall(SEL.kindOf + encUint(id)), 16);
}
// read the token's fully on-chain metadata (data: URI) and pull out its SVG image
async function readTokenImage(id) {
  const r = (await ethCall(SEL.tokenURI + encUint(id))).replace(/^0x/, "");
  const len = parseInt(r.slice(64, 128), 16);
  const hex = r.slice(128, 128 + len * 2);
  let s = "";
  for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  const json = JSON.parse(atob(s.split(",")[1])); // data:application/json;base64,...
  return json.image; // data:image/svg+xml;base64,...
}
// swap a placeholder gem for the crystal's real on-chain art once it loads
async function loadOnchainArt(id, gemEl) {
  if (!gemEl) return;
  try {
    const src = await readTokenImage(id);
    if (!src) return;
    const img = new Image();
    img.className = "gem onchain-art";
    img.title = "Fully on-chain SVG — rendered straight from the contract";
    img.onload = () => { if (gemEl.parentNode) gemEl.replaceWith(img); };
    img.src = src;
  } catch {}
}

// ------------------------------------------------------------------ wallet
let wallet = { addr: null, connected: false };

function hasWallet() {
  return typeof window.ethereum !== "undefined";
}
async function ensureChain() {
  const cur = await window.ethereum.request({ method: "eth_chainId" });
  if (cur === CHAIN_HEX) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_HEX,
          chainName: CFG.name || "Monad",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: [CFG.rpc],
          blockExplorerUrls: [CFG.explorer],
        }],
      });
    } else throw e;
  }
}
const isMobile = () => matchMedia("(max-width: 760px)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// no injected wallet: on mobile deep-link into MetaMask's browser, on desktop point to install
function showWalletHelp() {
  const mobile = isMobile();
  const dapp = "https://metamask.app.link/dapp/" + location.host + location.pathname + location.search;
  openModal(
    `<div class="big-gem">${gemSVG(4, 74)}</div>
     <h3>Connect a wallet</h3>
     <p>Monad Meadow uses an EVM wallet to mint &amp; trade crystals on Monad testnet.</p>
     ${mobile
       ? `<p>This browser has no wallet. Open Monad Meadow <b>inside your wallet's browser</b> to connect.</p>`
       : `<p>No browser wallet detected. Install <b>MetaMask</b> (or another EVM wallet extension), then reload this page.</p>`}`,
    () => {
      closeModal();
      if (mobile) location.href = dapp;
      else window.open("https://metamask.io/download/", "_blank", "noopener");
    },
    mobile ? "Open in MetaMask ↗" : "Get MetaMask ↗"
  );
}

async function connectWallet() {
  if (!hasWallet()) { showWalletHelp(); return; }
  try {
    const accts = await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureChain();
    wallet.addr = accts[0];
    wallet.connected = true;
    try { localStorage.setItem("mm_wallet", "1"); } catch {}
    updateWalletUI();
    refreshBalance();
    refreshMarket();
  } catch (e) {
    // 4001 = user rejected; anything else is a real error worth surfacing
    if (e && e.code === 4001) toast("Wallet connection cancelled.");
    else toast("Couldn't connect: " + ((e && e.message) || "unknown error").slice(0, 80), 5000);
  }
}

// silently restore a previously-authorized wallet on page load (no popup)
async function tryReconnectWallet() {
  if (!hasWallet()) return;
  try {
    if (localStorage.getItem("mm_wallet") !== "1") return;
  } catch { return; }
  try {
    const accts = await window.ethereum.request({ method: "eth_accounts" });
    if (accts && accts.length) {
      wallet.addr = accts[0];
      wallet.connected = true;
      updateWalletUI();
      refreshBalance();
      refreshMarket();
    }
  } catch {}
}
let _lastBal = null;
async function refreshBalance() {
  if (!wallet.addr) return;
  try {
    const b = BigInt(await rpc("eth_getBalance", [wallet.addr, "latest"]));
    const el = $("acctBal");
    el.textContent = formatEther(b, 3) + " MON";
    if (_lastBal !== null && b !== _lastBal) {
      el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
      const d = b - _lastBal;
      toast(`${d > 0n ? "+" : "−"}${formatEther(d < 0n ? -d : d, 4)} MON in your wallet`);
    }
    _lastBal = b;
  } catch {}
}
async function sendTx({ data, value }) {
  await ensureChain();
  const tx = { from: wallet.addr, to: CFG.contractAddress, data };
  if (value !== undefined) tx.value = toHexWei(value);
  // note: don't set a global stage here — each caller owns its own step
  return window.ethereum.request({ method: "eth_sendTransaction", params: [tx] });
}
function updateWalletUI() {
  if (wallet.connected) {
    $("connectBtn").classList.add("hidden");
    $("acct").classList.remove("hidden");
    $("acctAddr").textContent = shortAddr(wallet.addr);
  } else {
    $("connectBtn").classList.remove("hidden");
    $("acct").classList.add("hidden");
  }
  updateMarketProcessUI();
}
function explorerTx(h) {
  return `${CFG.explorer}/tx/${h}`;
}

function updateMarketProcessUI() {
  const steps = [...document.querySelectorAll(".process-step")];
  const live = $("txLive");
  if (!steps.length || !live) return;

  let stage = 0;
  let text = "No wallet connected yet. Connect MetaMask to begin the onchain flow.";

  if (wallet.connected) {
    stage = 1;
    text = "Wallet connected. Gather a crystal, then mint it on Monad to bring it onchain.";
    if (satchel.some((n) => n > 0)) {
      stage = 2;
      text = "Crystal ready in your satchel. Mint it onchain to create a collectible item.";
    }
    if (wallet.addr && document.querySelectorAll("#mineList .card").length > 0) {
      stage = 3;
      text = "Your crystal is owned onchain. List it in the Meadow Market to sell for MON.";
    }
    const hasListing = document.querySelectorAll("#marketList .card").length > 0;
    if (hasListing || (wallet.addr && document.querySelectorAll("#mineList .card").length > 0)) {
      stage = 4;
      text = "Market is live. Buy, sell, or confirm a pending transaction and watch the wallet update.";
    }
  }

  steps.forEach((el, index) => {
    el.classList.toggle("is-active", index === stage);
    el.classList.toggle("is-done", index < stage);
  });

  live.textContent = text;
}

function setTxProcessStage(stage, text) {
  const steps = [...document.querySelectorAll(".process-step")];
  const live = $("txLive");
  if (!steps.length || !live) return;
  steps.forEach((el, index) => {
    el.classList.toggle("is-active", index === stage);
    el.classList.toggle("is-done", index < stage);
  });
  live.textContent = text;
}

// ------------------------------------------------------------------ game state
const world = { w: 2400, h: 1600 };
let me = null; // {id,name,color,x,y,facing,health}
const players = new Map(); // id -> {name,color,x,y,facing, rx,ry}
const crystals = new Map(); // id -> {x,y,kind,phase}
const satchel = [0, 0, 0, 0, 0]; // gathered-but-unminted counts by kind
const bubbles = new Map(); // id -> {text, t}
const confetti = [];
let nearestCrystal = null;
let meMoving = false, meDir = 1;
const touchVec = { x: 0, y: 0 }; // from the on-screen joystick (mobile)

// --- idle auto-miner ("RL agent"): when the player is idle, an autonomous greedy
//     policy takes over — navigate to the highest-value nearby crystal, gather it,
//     and (optionally) mint it. Any real input hands control straight back. ---
let lastInput = performance.now();
let autoActive = false;      // agent currently driving the sprite
let autoMint = false;        // also auto-mint gathered crystals (opt-in; each mint signs a tx)
let autoTarget = null;       // current crystal the agent is walking to
let autoMintPending = false; // a mint tx is in flight
let lastAutoGather = 0, lastAutoMint = 0, _autoShown = false;
let autoStuckMs = 0, autoPrevX = 0, autoPrevY = 0, autoAvoid = -1, autoAvoidUntil = 0;
const IDLE_MS = 6000;        // go autonomous after this many ms with no input
function updateAutoBtn() {
  const b = $("autoBtn");
  if (b) { b.textContent = "🤖 auto-mint: " + (autoMint ? "on" : "off"); b.style.color = autoMint ? "var(--accent-deep)" : ""; }
}
function markInput() {
  lastInput = performance.now();
  if (autoActive) autoActive = false;
}
["keydown", "pointerdown", "touchstart", "wheel"].forEach((ev) =>
  addEventListener(ev, markInput, { passive: true, capture: true })
);

// Dragon boss fight — the dragon is SERVER-authoritative (position + hp come from
// the room), so everyone sees the same dragon. The client only renders it,
// tracks its own player HP, and sends "attack" requests.
let dragon = null; // {x,y,rx,ry,health,maxHealth,alive}
let dungeonBounds = null; // {x0, y0, x1, y1} dungeon area
let playerHealth = 100; // player health points (local)
const PLAYER_MAX_HEALTH = 100;
const DRAGON_HEALTH = 60; // display fallback; server owns the real value
let dragonDefeated = false; // true while the dragon is dead (server said down)
let lastAttackSent = 0, lastDragonDmg = 0, lastRoarHint = 0;

const canvas = $("game");
const ctx = canvas.getContext("2d");
// polyfill: some older engines lack ctx.roundRect (used by the trade overlay)
if (!ctx.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (typeof r === "number") r = { tl: r, tr: r, br: r, bl: r };
    else r = { tl: r[0] || 0, tr: r[0] || 0, br: r[0] || 0, bl: r[0] || 0 };
    this.moveTo(x + r.tl, y);
    this.arcTo(x + w, y, x + w, y + h, r.tr);
    this.arcTo(x + w, y + h, x, y + h, r.br);
    this.arcTo(x, y + h, x, y, r.bl);
    this.arcTo(x, y, x + w, y, r.tl);
    return this;
  };
}
let DPR = Math.min(window.devicePixelRatio || 1, 2);
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * DPR);
  canvas.height = Math.floor(innerHeight * DPR);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
}
addEventListener("resize", resize);
resize();

// ------------------------------------------------------------------ sprites (Kenney CC0: Tiny Town / Farm / Dungeon)
const SHEETS = { farm: null, town: null, dungeon: null };
const ATLAS_COLS = 12, SRC = 16;
function loadSheets() {
  return Promise.all(Object.keys(SHEETS).map((k) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { SHEETS[k] = img; res(); };
    img.onerror = () => res();
    img.src = `/assets/${k}.png`;
  })));
}
// draw one 16px tile from a sheet, in world space, flipped optionally
function tile(sheet, idx, wx, wy, size, flip) {
  const img = SHEETS[sheet];
  if (!img) return;
  const sx = (idx % ATLAS_COLS) * SRC, sy = ((idx / ATLAS_COLS) | 0) * SRC;
  if (flip) {
    ctx.save();
    ctx.translate(wx + size, wy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, SRC, SRC, 0, 0, size, size);
    ctx.restore();
  } else {
    ctx.drawImage(img, sx, sy, SRC, SRC, wx, wy, size, size);
  }
}

// tile indices
const T = {
  grass: 0, grassA: 1, grassB: 2,          // town
  treeGreen: 4, treeRound: 5, treeAutumn: 3,
  bush: 6, berry: 30, path: 39, pathA: 40, stone: 43, flower: 2,
  fenceH: 45, fenceMid: 46,
  soil: 0, soilA: 1,                        // farm
  crops: [8, 44, 32, 18, 20],               // farm: carrot, pumpkin, corn, eggplant, plant
  animals: [120, 121, 122],                 // farm: sheep, cow, chicken
  dFloor: 0, dFloorA: 12, dFloorB: 24, dWall: 2, dWallA: 3, // dungeon
  chest: 54, barrel: 124, gem: 53,
};
const HEROES = [85, 87, 88, 96, 97, 98, 100, 84, 99]; // dungeon character sprites

// deterministic PRNG so the world looks identical for everyone in a room
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const hashId = (id) => { let h = 0; for (const c of id || "x") h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

// world grid
const TILE = 48; // world/screen px per ground tile
let GCOLS = 0, GROWS = 0;
let ground = [];       // [{sheet,idx}] per cell
let dungeonMask = [];  // bool per cell
const decor = [];      // static objects {wx,wy,sheet,idx,size,ay}
const colliders = [];  // solid boxes {l,t,r,b} the player can't walk through
const water = [];      // {x,y,rx,ry,fountain} drawn water features
const motes = [];
const gemTint = [];    // 5 pre-tinted gem canvases

// MON value per kind (mirrors the contract mint prices) — used for value labels
const KIND_VALUE = [0.01, 0.02, 0.03, 0.04, 0.05];

// Reward amounts for gathering each crystal kind (in MON) — matches contract rewardAmount
const REWARD_VALUE = [0.005, 0.01, 0.015, 0.02, 0.025];

// ------------------------------------------------------------------ dynamic market pricing
// Market prices fluctuate randomly every few seconds. They are always higher
// than the mint cost so there's a real incentive to trade.
const marketPrice = [0, 0, 0, 0, 0];      // current suggested sell price per kind
const marketTrend = [0, 0, 0, 0, 0];       // -1 down, 0 flat, +1 up (for arrow display)
let _marketTickTimer = 0;
const MARKET_TICK_MIN = 8000;  // ms between price changes
const MARKET_TICK_MAX = 15000;
let _nextMarketTick = MARKET_TICK_MIN + Math.random() * (MARKET_TICK_MAX - MARKET_TICK_MIN);

function initMarketPrices() {
  for (let k = 0; k < KIND_COUNT; k++) {
    // start at 3x-6x mint price
    const mult = 3 + Math.random() * 3;
    marketPrice[k] = +(KIND_VALUE[k] * mult).toFixed(4);
  }
}

function tickMarketPrices(dt) {
  _marketTickTimer += dt * 1000;
  if (_marketTickTimer < _nextMarketTick) return false;
  _marketTickTimer = 0;
  _nextMarketTick = MARKET_TICK_MIN + Math.random() * (MARKET_TICK_MAX - MARKET_TICK_MIN);

  for (let k = 0; k < KIND_COUNT; k++) {
    const old = marketPrice[k];
    // random walk: -20% to +30% (slight upward bias)
    const delta = -0.20 + Math.random() * 0.50;
    let next = old * (1 + delta);
    // floor: always at least 2× mint price
    const floor = KIND_VALUE[k] * 2;
    // ceiling: 8× mint price
    const ceil = KIND_VALUE[k] * 8;
    next = Math.max(floor, Math.min(ceil, next));
    marketPrice[k] = +next.toFixed(4);
    marketTrend[k] = marketPrice[k] > old ? 1 : marketPrice[k] < old ? -1 : 0;
  }
  // re-render satchel to show updated values
  renderSatchel();
  return true;
}

initMarketPrices();

function makeGemTints() {
  const img = SHEETS.dungeon;
  for (let k = 0; k < KIND_COUNT; k++) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    if (img) g.drawImage(img, (T.gem % ATLAS_COLS) * SRC, ((T.gem / ATLAS_COLS) | 0) * SRC, SRC, SRC, 0, 0, 32, 32);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = KIND.colors[k];
    g.globalAlpha = 0.55;
    g.fillRect(0, 0, 32, 32);
    gemTint.push(c);
  }
}

// A hand-designed world: a village plaza with a fountain at the crossroads,
// an organized farm with crop rows + an animal pen, a forest grove, ponds,
// and a walled dungeon — all linked by dirt roads. Deterministic per world size.
function buildWorld() {
  const rnd = lcg(0x1a2b3c);
  GCOLS = Math.ceil(world.w / TILE);
  GROWS = Math.ceil(world.h / TILE);
  ground = new Array(GCOLS * GROWS);
  dungeonMask = new Array(GCOLS * GROWS).fill(false);
  colliders.length = 0;
  decor.length = 0;
  water.length = 0;
  motes.length = 0;

  const midC = GCOLS >> 1, midR = GROWS >> 1;
  const rectOf = (c0, r0, c1, r1) => ({ c0, r0, c1, r1 });
  const inR = (c, r, R) => c >= R.c0 && c <= R.c1 && r >= R.r0 && r <= R.r1;

  // --- zones ---------------------------------------------------------------
  const dungeon = rectOf(GCOLS - 13, 2, GCOLS - 3, 10);      // walled cave, top-right
  const plaza = rectOf(midC - 4, midR - 3, midC + 4, midR + 3); // village square, center
  const farm = rectOf(3, GROWS - 10, 15, GROWS - 3);          // farm district, bottom-left
  const pen = rectOf(farm.c0 + 9, farm.r0 + 1, farm.c1, farm.r0 + 4); // animal pen inside farm
  const forest = rectOf(2, 2, midC - 7, 9);                   // grove, top-left

  // roads: a main cross through the plaza, plus branches to farm & a wide dungeon approach
  const doorRow = (dungeon.r0 + dungeon.r1) >> 1; // the dungeon doorway sits mid-left wall
  const isRoad = (c, r) =>
    (r === midR && !inR(c, r, plaza)) ||                                            // horizontal avenue
    (c === midC && !inR(c, r, plaza)) ||                                            // vertical avenue
    (c === farm.c0 + 5 && r > farm.r0 - 3 && r <= midR) ||                          // plaza -> farm
    (r >= doorRow - 1 && r <= doorRow + 1 && c >= dungeon.c0 - 4 && c < dungeon.c0) || // wide apron in front of the door
    (c >= dungeon.c0 - 3 && c <= dungeon.c0 - 2 && r >= doorRow && r <= midR);       // connector down to the avenue

  // --- ground --------------------------------------------------------------
  for (let r = 0; r < GROWS; r++) {
    for (let c = 0; c < GCOLS; c++) {
      const i = r * GCOLS + c;
      if (inR(c, r, dungeon)) {
        dungeonMask[i] = true;
        const wall = c === dungeon.c0 || c === dungeon.c1 || r === dungeon.r0 || r === dungeon.r1;
        const door = c === dungeon.c0 && Math.abs(r - doorRow) <= 1; // 3-cell-wide opening
        if (wall && !door) {
          ground[i] = { sheet: "dungeon", idx: rnd() < 0.5 ? T.dWall : T.dWallA };
          colliders.push({ l: c * TILE + 2, t: r * TILE + 2, r: c * TILE + TILE - 2, b: r * TILE + TILE - 2 });
        } else {
          ground[i] = { sheet: "dungeon", idx: rnd() < 0.4 ? T.dFloorA : rnd() < 0.5 ? T.dFloorB : T.dFloor };
        }
      } else if (inR(c, r, farm)) {
        ground[i] = { sheet: "farm", idx: rnd() < 0.5 ? T.soil : T.soilA };
      } else if (inR(c, r, plaza)) {
        ground[i] = { sheet: "town", idx: T.stone };
      } else if (isRoad(c, r)) {
        ground[i] = { sheet: "town", idx: rnd() < 0.5 ? T.path : T.pathA };
      } else {
        const v = rnd();
        ground[i] = { sheet: "town", idx: v < 0.12 ? T.grassA : v < 0.2 ? T.grassB : T.grass };
      }
    }
  }

  const isGrass = (c, r) => {
    if (c < 0 || r < 0 || c >= GCOLS || r >= GROWS) return false;
    const g = ground[r * GCOLS + c];
    return g.sheet === "town" && g.idx <= T.grassB && !isRoad(c, r);
  };
  const place = (sheet, idx, c, r, size, solid) => {
    const o = { wx: c * TILE + (TILE - size) / 2, wy: r * TILE + (TILE - size) - 6, sheet, idx, size, ay: r * TILE + TILE };
    decor.push(o);
    if (solid) {
      const bw = size * (solid === "fence" ? 0.96 : solid === "tree" ? 0.32 : 0.5);
      const bh = size * (solid === "fence" ? 0.5 : 0.26);
      const cxp = o.wx + size / 2, byp = o.wy + size - 5;
      colliders.push({ l: cxp - bw / 2, t: byp - bh, r: cxp + bw / 2, b: byp });
    }
    return o;
  };
  const fenceRing = (R) => {
    for (let c = R.c0 - 1; c <= R.c1 + 1; c++) { place("town", T.fenceH, c, R.r0 - 1, 40, "fence"); if (c !== R.c0 + ((R.c1 - R.c0) >> 1)) place("town", T.fenceH, c, R.r1 + 1, 40, "fence"); }
    for (let r = R.r0; r <= R.r1; r++) { place("town", T.fenceH, R.c0 - 1, r, 40, "fence"); place("town", T.fenceH, R.c1 + 1, r, 40, "fence"); }
  };

  // --- forest grove: dense trees on a jittered grid ------------------------
  for (let r = forest.r0; r <= forest.r1; r++) {
    for (let c = forest.c0; c <= forest.c1; c++) {
      if (!isGrass(c, r)) continue;
      if ((c + r) % 2 === 0 && rnd() < 0.8) {
        const k = rnd();
        place("town", k < 0.55 ? T.treeGreen : k < 0.82 ? T.treeRound : T.treeAutumn, c, r, 64, "tree");
      } else if (rnd() < 0.3) place("town", T.bush, c, r, 38);
    }
  }
  // tree-lined avenue beside the main roads
  for (let c = 2; c < GCOLS - 2; c += 3) {
    for (const r of [midR - 2, midR + 2]) if (isGrass(c, r) && rnd() < 0.6) place("town", rnd() < 0.6 ? T.treeGreen : T.treeRound, c, r, 58, "tree");
  }

  // --- farm: crop rows, perimeter fence w/ gate, animal pen, barn ----------
  for (let r = farm.r0; r <= farm.r1; r++) {
    for (let c = farm.c0; c <= farm.c1; c++) {
      if (inR(c, r, pen)) continue;
      if (r % 2 === 0) place("farm", T.crops[(c + r) % T.crops.length], c, r, 34); // neat rows
    }
  }
  fenceRing(farm);
  fenceRing(pen);
  for (let n = 0; n < 4; n++) {
    const c = pen.c0 + ((rnd() * (pen.c1 - pen.c0 + 1)) | 0), r = pen.r0 + ((rnd() * (pen.r1 - pen.r0 + 1)) | 0);
    place("farm", T.animals[(rnd() * T.animals.length) | 0], c, r, 32);
    const o = decor[decor.length - 1]; o.animal = true; o.bx = o.wx; o.by = o.wy; o.ph = rnd() * 6.28;
  }
  place("farm", T.barrel, farm.c1, farm.r1, 34, "prop");

  // --- plaza: fountain at the crossroads, flower beds, benches -------------
  water.push({ x: (midC + 0.5) * TILE, y: (midR + 0.5) * TILE, rx: TILE * 1.15, ry: TILE * 0.9, fountain: true });
  colliders.push({ l: (midC + 0.5) * TILE - TILE * 0.9, t: (midR + 0.5) * TILE - TILE * 0.5, r: (midC + 0.5) * TILE + TILE * 0.9, b: (midR + 0.5) * TILE + TILE * 0.7 });
  for (let c = plaza.c0; c <= plaza.c1; c++) {
    if (rnd() < 0.7) place("town", T.flower, c, plaza.r0, 30);
    if (rnd() < 0.7) place("town", T.flower, c, plaza.r1, 30);
  }
  place("town", T.berry, plaza.c0, plaza.r0, 40);
  place("town", T.berry, plaza.c1, plaza.r1, 40);

  // --- ponds in the open meadow (with reeds) ------------------------------
  const pondSpots = [[midC + 9, midR + 6], [8, 6], [GCOLS - 6, GROWS - 5]];
  for (const [pc, pr] of pondSpots) {
    if (pc < 2 || pc > GCOLS - 3 || pr < 2 || pr > GROWS - 3) continue;
    // fixed sizes (deterministic) so the server's crystal keep-out matches exactly
    const x = (pc + 0.5) * TILE, y = (pr + 0.5) * TILE, rx = TILE * 1.9, ry = TILE * 1.3;
    water.push({ x, y, rx, ry });
    colliders.push({ l: x - rx * 0.7, t: y - ry * 0.6, r: x + rx * 0.7, b: y + ry * 0.7 });
    for (let a = 0; a < 6; a++) { const c = pc + ((Math.cos(a) * 2) | 0), r = pr + ((Math.sin(a) * 1.6) | 0); if (isGrass(c, r) && rnd() < 0.5) place("town", T.bush, c, r, 34); }
  }

  // --- gentle scatter of flowers in the open meadow (life, not clutter) ----
  for (let n = 0; n < 30; n++) {
    const c = (rnd() * GCOLS) | 0, r = (rnd() * GROWS) | 0;
    if (isGrass(c, r) && !inR(c, r, forest)) place("town", rnd() < 0.5 ? T.flower : T.bush, c, r, 30);
  }

  // --- clear landmarks so the world feels alive ---------------------------
  // central plaza buildings / market stalls
  for (let i = -2; i <= 2; i++) {
    place("town", T.stone, midC + i, midR - 5, 74, "prop");
    place("town", T.stone, midC + i, midR + 5, 74, "prop");
  }
  for (let i = 0; i < 5; i++) {
    place("town", T.flower, midC - 4 + i, midR - 1, 28);
    place("town", T.flower, midC - 4 + i, midR + 1, 28);
  }

  // farm structures and sheds
  for (let i = 0; i < 3; i++) {
    place("farm", T.barrel, farm.c0 + 2 + i * 4, farm.r0 - 1, 30, "prop");
    place("farm", T.barrel, farm.c0 + 2 + i * 4, farm.r1 + 1, 30, "prop");
  }

  // dramatic dungeon gate and interior props so it reads as a real dungeon
  for (let i = 0; i < 5; i++) {
    place("dungeon", T.dWall, dungeon.c0 + i, dungeon.r0 - 1, 52, "prop");
    place("dungeon", T.dWall, dungeon.c0 + i, dungeon.r1 + 1, 52, "prop");
  }
  // Stone pillars and a flaming gate frame to make the entrance unmistakable
  for (let i = 0; i < 3; i++) {
    place("dungeon", T.dWallA, dungeon.c0 + 2 + i * 2, dungeon.r0 + 1, 64, "prop");
    place("dungeon", T.dWallA, dungeon.c0 + 2 + i * 2, dungeon.r1 - 1, 64, "prop");
  }
  place("dungeon", T.chest, dungeon.c0 + 2, dungeon.r0 + 2, 34, "prop");
  place("dungeon", T.barrel, dungeon.c0 + 5, dungeon.r0 + 5, 34, "prop");
  place("dungeon", T.barrel, dungeon.c0 + 3, dungeon.r1 - 1, 34, "prop");

  // create a visible fiery arena in the dungeon center
  for (let i = 0; i < 10; i++) {
    const px = dungeon.c0 + 2 + ((i * 1.2) | 0);
    const py = dungeon.r0 + 3 + (i % 3);
    place("dungeon", T.dFloorA, px, py, 28, "prop");
  }

  // --- dungeon loot: a few props tucked into the corners, clear of the door,
  //     the dragon, and the walking space -----------------------------------
  const lootSpots = [
    [dungeon.c1 - 1, dungeon.r0 + 1], // top-right corner
    [dungeon.c1 - 1, dungeon.r1 - 1], // bottom-right corner
    [dungeon.c0 + 2, dungeon.r1 - 1], // bottom-left, away from the door row
  ];
  for (const [c, r] of lootSpots) place("dungeon", (c + r) % 2 ? T.chest : T.barrel, c, r, 32, "prop");

  // --- dungeon bounds (the dragon itself is created from server state) -----
  dungeonBounds = {
    x0: dungeon.c0 * TILE,
    y0: dungeon.r0 * TILE,
    x1: dungeon.c1 * TILE + TILE,
    y1: dungeon.r1 * TILE + TILE
  };
  playerHealth = PLAYER_MAX_HEALTH;

  decor.sort((a, b) => a.ay - b.ay);
  for (let i = 0; i < 40; i++) motes.push({ x: rnd() * world.w, y: rnd() * world.h, sp: 4 + rnd() * 10, ph: rnd() * 6.28, a: 0.08 + rnd() * 0.14 });
}

// ------------------------------------------------------------------ input
const keys = {};
let typing = false;
addEventListener("keydown", (e) => {
  if (typing) return;
  keys[e.key.toLowerCase()] = true;
  if (e.key === " " || e.key.toLowerCase() === "e") {
    e.preventDefault();
    tryGather();
  }
});
addEventListener("keyup", (e) => (keys[e.key.toLowerCase()] = false));
$("chatInput").addEventListener("focus", () => (typing = true));
$("chatInput").addEventListener("blur", () => (typing = false));

// Click/tap for dragon attacks — only counts near the living dragon, not on HUD
addEventListener("click", (e) => {
  if (e.target && e.target.closest && e.target.closest(".hud, .modal")) return;
  if (!me || !dragon || !dragon.alive || playerHealth <= 0) return;
  if (Math.hypot(me.x - dragon.rx, me.y - dragon.ry) < 150) keys["click"] = true;
});

function tryGather() {
  if (!nearestCrystal || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "pickup", crystalId: nearestCrystal.id }));
}

// ------------------------------------------------------------------ networking
let ws = null;
let reconnectT = null;
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(ROOM)}`);
  ws.onopen = () => setPresence();
  ws.onclose = () => {
    setPresence(true);
    clearTimeout(reconnectT);
    reconnectT = setTimeout(connectWS, 1500);
  };
  ws.onmessage = (evt) => handleMsg(JSON.parse(evt.data));
}
function setPresence(down) {
  const n = players.size + (me ? 1 : 0);
  $("presence").textContent = down ? "reconnecting…" : `${n} wanderer${n === 1 ? "" : "s"} in the meadow`;
}

function handleMsg(m) {
  switch (m.type) {
    case "init":
      me = m.you;
      world.w = m.world.w;
      world.h = m.world.h;
      players.clear();
      for (const p of m.players) players.set(p.id, { ...p, rx: p.x, ry: p.y });
      crystals.clear();
      for (const c of m.crystals) crystals.set(c.id, { ...c, phase: Math.random() * 6.28 });
      if (m.dragon) {
        dragon = { x: m.dragon.x, y: m.dragon.y, rx: m.dragon.x, ry: m.dragon.y, health: m.dragon.hp, maxHealth: m.dragon.maxHp, alive: m.dragon.alive };
        dragonDefeated = !m.dragon.alive;
      }
      setPresence();
      addChat(null, `You wandered into room ${ROOM}. Share the code or QR to invite friends 🌿`, true);
      sendSavedName();
      break;
    case "join":
      players.set(m.player.id, { ...m.player, rx: m.player.x, ry: m.player.y });
      addChat(null, `${m.player.name} arrived`, true);
      setPresence();
      break;
    case "leave":
      players.delete(m.id);
      bubbles.delete(m.id);
      setPresence();
      break;
    case "moved": {
      const p = players.get(m.id);
      if (p) { p.x = m.x; p.y = m.y; p.facing = m.facing; }
      break;
    }
    case "spawn":
      crystals.set(m.crystal.id, { ...m.crystal, phase: Math.random() * 6.28, born: performance.now() });
      break;
    case "removed":
      crystals.delete(m.crystalId);
      break;
    case "gathered":
      crystals.delete(m.crystalId);
      satchel[m.kind]++;
      renderSatchel();
      toast(`You gathered a ${KIND.names[m.kind]} ✦ · worth ${KIND_VALUE[m.kind]} MON to mint`);
      chime(520 + m.kind * 60);
      break;
    case "chat":
      addChat(m.name, m.text);
      bubbles.set(m.id, { text: m.text, t: performance.now() });
      break;
    case "renamed": {
      const p = players.get(m.id);
      if (p) p.name = m.name;
      break;
    }
    case "celebrate":
      burstConfetti(m.id, m.kind);
      break;
    case "dragon": {
      // server position/health update (interpolated toward on render)
      if (!dragon) dragon = { x: m.x, y: m.y, rx: m.x, ry: m.y, health: m.hp, maxHealth: DRAGON_HEALTH, alive: m.alive };
      dragon.x = m.x; dragon.y = m.y; dragon.health = m.hp; dragon.alive = m.alive;
      break;
    }
    case "dragonHit": {
      if (dragon) { dragon.health = m.hp; dragon.hitFlash = performance.now(); }
      for (let i = 0; i < 8; i++) confetti.push({ x: m.x, y: m.y - 10, vx: (Math.random() - 0.5) * 200, vy: (Math.random() - 0.7) * 160, life: 0.5 + Math.random() * 0.4, color: "#ff6b5a" });
      break;
    }
    case "dragonDown": {
      if (dragon) dragon.alive = false;
      dragonDefeated = true;
      if (me && m.by === me.id) handleDragonDefeat();
      else { toast(`🐉 ${m.name || "A hero"} defeated the dragon!`, 4000); burstConfetti(m.by, 4); }
      break;
    }
    case "dragonRespawn":
      if (dragon) { dragon.alive = true; dragon.health = dragon.maxHealth; dragon.hitFlash = 0; }
      dragonDefeated = false;
      toast("🐉 The dragon has risen again…", 2500);
      break;
  }
}

// ------------------------------------------------------------------ update + render
let lastMove = 0;
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  try {
    update(dt, now);
    render(now);
  } catch (e) {
    // never let one bad frame kill the loop
    console.error("frame error", e);
  } finally {
    requestAnimationFrame(loop);
  }
}

// player's feet vs solid boxes (with a small radius so the body doesn't clip in)
const FEET_Y = 15, FEET_R = 9;
function blocked(x, y) {
  const fx = x, fy = y + FEET_Y;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (fx > c.l - FEET_R && fx < c.r + FEET_R && fy > c.t - FEET_R && fy < c.b + FEET_R) return true;
  }
  return false;
}

// greedy value-weighted policy: prefer crystals that are both valuable and close
function pickAutoTarget() {
  if (!me) return null;
  const avoiding = performance.now() < autoAvoidUntil ? autoAvoid : -1;
  let best = null, bestScore = -Infinity;
  for (const c of crystals.values()) {
    if (c.id === avoiding) continue; // recently unreachable — skip for a bit
    const d = Math.hypot(c.x - me.x, c.y - me.y);
    const score = (KIND_VALUE[c.kind] || 0.01) / (1 + d / 220);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}
async function maybeAutoMint(now) {
  if (!autoMint || autoMintPending || !wallet.connected) return;
  if (now - lastAutoMint < 1800) return;
  const kind = satchel.findIndex((n) => n > 0);
  if (kind < 0) return;
  autoMintPending = true; lastAutoMint = now;
  try {
    const price = await readMintPrice(kind);
    const h = await sendTx({ data: SEL.mintItem + encUint(kind), value: price });
    satchel[kind] = Math.max(0, satchel[kind] - 1);
    renderSatchel();
    toastTx(`🤖 Auto-minted a ${KIND.names[kind]}`, h);
    celebrate(kind);
    waitForReceipt(h).then(() => { refreshBalance(); refreshMarket(); });
  } catch (e) {
    autoMint = false; // stop on rejection/error so we don't spam the wallet
    updateAutoBtn();
    toast("Auto-mint stopped: " + ((e && e.message) || "cancelled").slice(0, 60));
  } finally {
    autoMintPending = false;
  }
}

function update(dt, now) {
  // tick the dynamic market prices
  tickMarketPrices(dt);
  if (me) {
    let dx = 0, dy = 0;
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    dx += touchVec.x; dy += touchVec.y; // joystick
    // idle -> hand the sprite to the autonomous agent
    const modalOpen = !$("modal").classList.contains("hidden");
    autoActive = !typing && !modalOpen && crystals.size > 0 && (now - lastInput > IDLE_MS);
    if (autoActive) {
      if (!autoTarget || !crystals.has(autoTarget.id)) { autoTarget = pickAutoTarget(); autoStuckMs = 0; }
      if (autoTarget) {
        const tdx = autoTarget.x - me.x, tdy = autoTarget.y - me.y, td = Math.hypot(tdx, tdy) || 1;
        if (td < 78) {
          if (now - lastAutoGather > 350) { lastAutoGather = now; tryGather(); autoTarget = null; autoStuckMs = 0; }
        } else {
          dx = tdx / td; dy = tdy / td;
          // if we can't make progress (crystal trapped behind a wall/water), avoid it and retarget
          const moved = Math.hypot(me.x - autoPrevX, me.y - autoPrevY);
          autoStuckMs = moved < 0.6 ? autoStuckMs + dt * 1000 : 0;
          if (autoStuckMs > 1100) { autoAvoid = autoTarget.id; autoAvoidUntil = now + 5000; autoTarget = null; autoStuckMs = 0; }
        }
      }
      autoPrevX = me.x; autoPrevY = me.y;
      if (autoMint) maybeAutoMint(now);
    }
    const mag = Math.hypot(dx, dy);
    meMoving = mag > 0.15;
    if (dx < -0.05) meDir = -1; else if (dx > 0.05) meDir = 1;
    if (meMoving) {
      const l = mag;
      const sp = 235 * dt;
      const nx = Math.max(0, Math.min(world.w, me.x + (dx / l) * sp));
      const ny = Math.max(0, Math.min(world.h, me.y + (dy / l) * sp));
      // resolve each axis separately so we slide along obstacles instead of sticking
      if (!blocked(nx, me.y)) me.x = nx;
      if (!blocked(me.x, ny)) me.y = ny;
      me.facing = Math.atan2(dy, dx);
      if (now - lastMove > 65 && ws && ws.readyState === 1) {
        lastMove = now;
        ws.send(JSON.stringify({ type: "move", x: me.x, y: me.y, facing: me.facing }));
      }
    }
  }
  // interpolate others + facing direction
  for (const p of players.values()) {
    if (p.x < p.rx - 0.5) p.dir = -1; else if (p.x > p.rx + 0.5) p.dir = 1;
    p.rx += (p.x - p.rx) * Math.min(1, dt * 10);
    p.ry += (p.y - p.ry) * Math.min(1, dt * 10);
  }
  // nearest crystal
  nearestCrystal = null;
  if (me) {
    let best = 90;
    for (const c of crystals.values()) {
      const d = Math.hypot(c.x - me.x, c.y - me.y);
      if (d < best) { best = d; nearestCrystal = c; }
    }
  }

  // --- dragon combat (dragon state is server-authoritative) ----------------
  if (dragon) {
    // smoothly interpolate the dragon toward its latest server position
    dragon.rx += (dragon.x - dragon.rx) * Math.min(1, dt * 8);
    dragon.ry += (dragon.y - dragon.ry) * Math.min(1, dt * 8);
    if (me && dragon.alive) {
      const nearDragon = Math.hypot(me.x - dragon.rx, me.y - dragon.ry) < 150;
      if (nearDragon) {
        // the dragon claws you while you're in melee range (local HP)
        if (now - lastDragonDmg > 1000) {
          lastDragonDmg = now;
          playerHealth -= 6;
          if (playerHealth <= 0) handlePlayerDeath();
        }
        // your click/tap is an attack — ask the server to apply the hit
        if (keys["click"]) {
          keys["click"] = false;
          if (now - lastAttackSent > 200 && ws && ws.readyState === 1) {
            lastAttackSent = now;
            ws.send(JSON.stringify({ type: "attack" }));
          }
        }
      } else if (Math.hypot(me.x - dragon.rx, me.y - dragon.ry) < 340 && now - lastRoarHint > 4000) {
        lastRoarHint = now;
        toast("🐉 The dragon prowls nearby — get close and click to strike.", 1800);
      }
    }
  }

  // confetti
  for (let i = confetti.length - 1; i >= 0; i--) {
    const p = confetti[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.life -= dt;
    if (p.life <= 0) confetti.splice(i, 1);
  }
  // show/hide the autonomous-agent badge only on state change
  if (autoActive !== _autoShown) {
    const b = $("autoBadge");
    if (b) b.classList.toggle("hidden", !autoActive);
    _autoShown = autoActive;
  }
}

function render(now) {
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const vw = W / DPR, vh = H / DPR;

  // camera
  const cx = me ? me.x : world.w / 2;
  const cy = me ? me.y : world.h / 2;
  const camX = Math.max(0, Math.min(Math.max(0, world.w - vw), cx - vw / 2));
  const camY = Math.max(0, Math.min(Math.max(0, world.h - vh), cy - vh / 2));

  // base fill (below grass, seen at edges)
  ctx.fillStyle = "#cfe6d5";
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(-Math.round(camX), -Math.round(camY));

  // ground tilemap (only visible cells)
  if (GCOLS) {
    const c0 = Math.max(0, (camX / TILE) | 0), c1 = Math.min(GCOLS - 1, ((camX + vw) / TILE) | 0);
    const r0 = Math.max(0, (camY / TILE) | 0), r1 = Math.min(GROWS - 1, ((camY + vh) / TILE) | 0);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const g = ground[r * GCOLS + c];
        if (g) tile(g.sheet, g.idx, c * TILE, r * TILE, TILE + 1);
      }
    }
  }

  // water features (ponds + plaza fountain)
  for (const w of water) drawWater(w, now);

  // motes
  for (const m of motes) {
    const y = m.y + Math.sin(now / 1000 * (m.sp / 8) + m.ph) * 18;
    ctx.fillStyle = `rgba(255,255,255,${m.a})`;
    ctx.beginPath();
    ctx.arc(m.x, y, 3, 0, 6.28);
    ctx.fill();
  }

  // build y-sorted draw list of decor + crystals + players + dragon
  const pad = 80;
  const items = [];
  for (const d of decor) {
    if (d.wx < camX - pad || d.wx > camX + vw + pad || d.wy < camY - pad || d.wy > camY + vh + pad) continue;
    items.push({ ay: d.ay, t: 0, d });
  }
  for (const c of crystals.values()) items.push({ ay: c.y, t: 1, c });
  for (const p of players.values()) items.push({ ay: p.ry, t: 2, p, self: false });
  if (me) items.push({ ay: me.y, t: 2, p: me, self: true });
  if (dragon && dragon.alive) items.push({ ay: dragon.ry, t: 3, d: dragon });
  items.sort((a, b) => a.ay - b.ay);

  for (const it of items) {
    if (it.t === 0) drawDecor(it.d, now);
    else if (it.t === 1) drawCrystal(it.c, now);
    else if (it.t === 2) drawPlayer(it.p, now, it.self);
    else if (it.t === 3) drawDragon(it.d, now);
  }

  // confetti on top
  for (const c of confetti) {
    ctx.globalAlpha = Math.max(0, Math.min(1, c.life));
    ctx.fillStyle = c.color;
    ctx.fillRect(c.x, c.y, 6, 6);
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // ---- Canvas overlay banner: "Trade peer-to-peer for MON" ----
  drawTradeOverlay(now, vw, vh);

  // Draw player health HUD (screen-space, not world-space)
  if (me && dragon) {
    const inDungeon = me.x >= dungeonBounds.x0 && me.x <= dungeonBounds.x1 &&
                     me.y >= dungeonBounds.y0 && me.y <= dungeonBounds.y1;
    if ((inDungeon && dragon.alive) || playerHealth < PLAYER_MAX_HEALTH) {
      const hx = 20, hy = 80;
      const hw = 200, hh = 20;
      
      // Background
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(hx - 5, hy - 5, hw + 10, hh + 10);
      
      // Health bar border
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(hx, hy, hw, hh);
      
      // Health bar fill
      const healthPercent = playerHealth / PLAYER_MAX_HEALTH;
      const barColor = healthPercent > 0.5 ? "#00cc44" : healthPercent > 0.25 ? "#ffaa00" : "#ff3300";
      ctx.fillStyle = barColor;
      ctx.fillRect(hx, hy, hw * healthPercent, hh);
      
      // Health text
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px Segoe UI";
      ctx.textAlign = "center";
      ctx.fillText(`HP: ${Math.max(0, Math.round(playerHealth))}/${PLAYER_MAX_HEALTH}`, hx + hw / 2, hy + 15);
    }
  }
}

// ------------------------------------------------------------------ trade overlay banner
function drawTradeOverlay(now, vw, vh) {
  const pulse = 0.5 + 0.5 * Math.sin(now / 1200);
  const bannerW = 380;
  const bannerH = 48;
  const bx = vw / 2 - bannerW / 2;
  const by = vh - 64;

  // glowing background pill
  ctx.save();
  ctx.globalAlpha = 0.7 + pulse * 0.2;
  const grad = ctx.createLinearGradient(bx, by, bx + bannerW, by);
  grad.addColorStop(0, "rgba(75, 157, 134, 0.92)");
  grad.addColorStop(0.5, "rgba(107, 191, 168, 0.95)");
  grad.addColorStop(1, "rgba(75, 157, 134, 0.92)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(bx, by, bannerW, bannerH, 24);
  ctx.fill();

  // subtle glow halo
  ctx.shadowColor = "rgba(107, 191, 168, 0.6)";
  ctx.shadowBlur = 20 + pulse * 10;
  ctx.beginPath();
  ctx.roundRect(bx, by, bannerW, bannerH, 24);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  // text
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("◈ Trade peer-to-peer for MON ◈", vw / 2, by + bannerH / 2);

  // live price ticker strip below the banner
  const tickerY = by + bannerH + 8;
  const tickerH = 22;
  ctx.globalAlpha = 0.65 + pulse * 0.15;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.roundRect(bx + 20, tickerY, bannerW - 40, tickerH, 11);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.font = "600 11px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  const gap = (bannerW - 40) / KIND_COUNT;
  for (let k = 0; k < KIND_COUNT; k++) {
    const tx = bx + 20 + gap * k + gap / 2;
    const arrow = marketTrend[k] > 0 ? "▲" : marketTrend[k] < 0 ? "▼" : "●";
    const color = marketTrend[k] > 0 ? "#6eff8e" : marketTrend[k] < 0 ? "#ff7a7a" : "#ffd98e";
    ctx.fillStyle = color;
    ctx.fillText(`${arrow}${marketPrice[k]}`, tx, tickerY + tickerH / 2 + 1);
  }
  ctx.restore();
}

function drawWater(w, now) {
  const { x, y, rx, ry } = w;
  if (w.fountain) {
    // stone basin rim
    ctx.fillStyle = "#cdd3da";
    ctx.beginPath(); ctx.ellipse(x, y, rx + 7, ry + 6, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = "#eef1f5";
    ctx.beginPath(); ctx.ellipse(x, y, rx + 3, ry + 2, 0, 0, 6.28); ctx.fill();
  } else {
    // muddy/grassy bank
    ctx.fillStyle = "rgba(120,150,120,0.35)";
    ctx.beginPath(); ctx.ellipse(x, y, rx + 5, ry + 4, 0, 0, 6.28); ctx.fill();
  }
  // water body
  const g = ctx.createRadialGradient(x, y - ry * 0.3, 2, x, y, rx);
  g.addColorStop(0, "#bfe3ff");
  g.addColorStop(1, "#7fb4e6");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.28); ctx.fill();
  // shimmer lines
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const yy = y - ry * 0.4 + i * ry * 0.4 + Math.sin(now / 700 + i) * 2;
    ctx.beginPath(); ctx.ellipse(x, yy, rx * (0.55 - i * 0.12), ry * 0.12, 0, 0, 6.28); ctx.stroke();
  }
  if (w.fountain) {
    // gentle spout sparkle
    const s = 0.5 + 0.5 * Math.sin(now / 300);
    ctx.fillStyle = `rgba(255,255,255,${0.5 + s * 0.4})`;
    ctx.beginPath(); ctx.arc(x, y - ry * 0.2 - s * 6, 3.5, 0, 6.28); ctx.fill();
  }
}

function softShadow(x, y, rx) {
  ctx.fillStyle = "rgba(60,80,70,0.16)";
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.4, 0, 0, 6.28);
  ctx.fill();
}

function drawDecor(d, now) {
  let wx = d.wx, wy = d.wy;
  if (d.animal) {
    wx = d.bx + Math.sin(now / 1400 + d.ph) * 10;
    wy = d.by + Math.cos(now / 1700 + d.ph) * 6;
  }
  softShadow(wx + d.size / 2, wy + d.size - 4, d.size * 0.34);
  tile(d.sheet, d.idx, wx, wy, d.size, d.animal && Math.sin(now / 1400 + d.ph) < 0);
}

function drawCrystal(c, now) {
  const bob = Math.sin(now / 600 + c.phase) * 6;
  const y = c.y + bob;
  const pulse = 0.5 + 0.5 * Math.sin(now / 500 + c.phase);
  const col = KIND.colors[c.kind];
  const isNear = nearestCrystal && nearestCrystal.id === c.id;
  // glow halo
  const rg = ctx.createRadialGradient(c.x, y, 2, c.x, y, 30 + pulse * 8);
  rg.addColorStop(0, col + "bb");
  rg.addColorStop(1, col + "00");
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(c.x, y, 30 + pulse * 8, 0, 6.28); ctx.fill();
  // procedural faceted gem (crisp, colored per kind)
  ctx.save();
  ctx.translate(c.x, y);
  ctx.beginPath();
  ctx.moveTo(0, -13); ctx.lineTo(10, -2); ctx.lineTo(0, 14); ctx.lineTo(-10, -2); ctx.closePath();
  ctx.fillStyle = col; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5;
  ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(0, 14); ctx.lineTo(-10, -2); ctx.closePath();
  ctx.fillStyle = "rgba(0,0,0,0.14)"; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(10, -2); ctx.lineTo(0, -2); ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.fill();
  ctx.restore();
  if (isNear) {
    ctx.strokeStyle = "rgba(75,157,134,0.9)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(c.x, y, 24, 0, 6.28); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.fillStyle = KIND.colors[c.kind];
    ctx.font = "700 13px Segoe UI";
    ctx.fillText(`${KIND.names[c.kind]} · Mint ${KIND_VALUE[c.kind]} MON`, c.x, y - 42);
    // show dynamic market value
    const mktVal = marketPrice[c.kind];
    const tArrow = marketTrend[c.kind] > 0 ? "▲" : marketTrend[c.kind] < 0 ? "▼" : "";
    ctx.fillStyle = marketTrend[c.kind] > 0 ? "#3ddb6a" : marketTrend[c.kind] < 0 ? "#ff6b6b" : "#ffd98e";
    ctx.font = "700 12px Segoe UI";
    ctx.fillText(`Market: ${tArrow}${mktVal} MON`, c.x, y - 27);
    ctx.fillStyle = "rgba(70,80,99,0.8)";
    ctx.font = "600 11px Segoe UI";
    ctx.fillText("Space to gather", c.x, y - 14);
  }
}

function drawDragon(d, now) {
  // render at the interpolated (rx,ry) position; keep hp/alive from the object
  d = Object.assign({}, d, { x: d.rx != null ? d.rx : d.x, y: d.ry != null ? d.ry : d.y });
  const pulse = 0.5 + 0.5 * Math.sin(now / 400) * d.health / d.maxHealth;
  const isAlive = d.health > 0;

  // stronger red beacon so the dragon is always visible from afar
  const rg = ctx.createRadialGradient(d.x, d.y, 5, d.x, d.y, 120);
  rg.addColorStop(0, isAlive ? "rgba(255,60,20,0.7)" : "rgba(120,255,120,0.25)");
  rg.addColorStop(0.35, "rgba(200,30,0,0.45)");
  rg.addColorStop(1, "rgba(60,0,0,0)");
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(d.x, d.y, 120, 0, 6.28); ctx.fill();

  // fiery arena glow under the dragon
  ctx.fillStyle = isAlive ? "rgba(255,120,30,0.35)" : "rgba(120,255,120,0.20)";
  ctx.beginPath(); ctx.ellipse(d.x, d.y + 20, 86, 34, 0, 0, 6.28); ctx.fill();

  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(isAlive ? 1.15 : 0.55, isAlive ? 1.15 : 0.55);

  // wings
  ctx.fillStyle = "rgba(130, 0, 0, 0.78)";
  ctx.beginPath();
  ctx.moveTo(-8, -4); ctx.quadraticCurveTo(-50, -42, -74, -12); ctx.quadraticCurveTo(-26, 16, -8, 2);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-8, -4); ctx.quadraticCurveTo(50, -42, 78, -12); ctx.quadraticCurveTo(26, 16, -8, 2);
  ctx.closePath(); ctx.fill();

  // tail
  ctx.strokeStyle = "#8a0000";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(-34, 2); ctx.quadraticCurveTo(-60, -6, -88, -22);
  ctx.stroke();

  // body
  ctx.fillStyle = "#c51d00";
  ctx.beginPath();
  ctx.ellipse(0, 0, 42, 28, 0, 0, 6.28);
  ctx.fill();

  // chest and belly
  ctx.fillStyle = "#ec5332";
  ctx.beginPath();
  ctx.ellipse(8, 6, 18, 14, 0, 0, 6.28); ctx.fill();

  // head
  ctx.fillStyle = "#d62400";
  ctx.beginPath();
  ctx.arc(50, -12, 20, 0, 6.28); ctx.fill();

  // horns
  ctx.fillStyle = "#f5d763";
  ctx.beginPath(); ctx.moveTo(42, -30); ctx.lineTo(48, -48); ctx.lineTo(56, -30); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(58, -28); ctx.lineTo(66, -46); ctx.lineTo(72, -28); ctx.closePath(); ctx.fill();

  // eyes
  ctx.fillStyle = "#ffd800";
  ctx.beginPath(); ctx.arc(56, -16, 5, 0, 6.28); ctx.fill();
  ctx.fillStyle = "#111";
  ctx.beginPath(); ctx.arc(58, -15, 2.5, 0, 6.28); ctx.fill();

  // mouth & claws
  ctx.strokeStyle = "#7a0000";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(68, -4, 9, 2.4, 5.8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(14, 16); ctx.lineTo(18, 26); ctx.moveTo(6, 16); ctx.lineTo(10, 26);
  ctx.stroke();

  // spikes
  ctx.fillStyle = "#8d0000";
  for (let i = -3; i <= 3; i++) {
    const x = i * 10;
    ctx.beginPath();
    ctx.moveTo(x, -24); ctx.lineTo(x - 5, -40); ctx.lineTo(x + 5, -40); ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  // Health bar and boss label
  const hpX = d.x - 56;
  const hpY = d.y - 84;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(hpX, hpY, 112, 12);
  const healthValue = Math.max(0, d.health / d.maxHealth);
  ctx.fillStyle = healthValue > 0.5 ? "#ff5a23" : healthValue > 0.25 ? "#ff8a1d" : "#d32f2f";
  ctx.fillRect(hpX, hpY, 112 * healthValue, 12);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(hpX, hpY, 112, 12);

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = "700 12px Segoe UI";
  ctx.fillText(`DRAGON ${Math.max(0, Math.round(d.health))}/${d.maxHealth}`, d.x, hpY - 9);

  if (me && dungeonBounds) {
    const inDungeon = me.x >= dungeonBounds.x0 && me.x <= dungeonBounds.x1 &&
                     me.y >= dungeonBounds.y0 && me.y <= dungeonBounds.y1;
    const nearDragon = Math.hypot(me.x - d.x, me.y - d.y) < 180;
    if (inDungeon) {
      ctx.fillStyle = isAlive ? "rgba(255,100,0,0.96)" : "rgba(100,255,100,0.96)";
      ctx.font = "700 14px Segoe UI";
      ctx.fillText(isAlive ? (nearDragon ? "⚔️ ATTACK!" : "🐉 DRAGON NEARBY") : "🎉 DRAGON DEFEATED!", d.x, d.y + 72);
    }
  }
}

function drawPlayer(p, now, self) {
  const px = self ? p.x : (p.rx != null ? p.rx : p.x);
  const py = self ? p.y : (p.ry != null ? p.ry : p.y);
  const size = 44;
  const moving = self ? meMoving : (Math.abs(p.x - p.rx) + Math.abs(p.y - p.ry) > 0.6);
  const bob = moving ? Math.abs(Math.sin(now / 110)) * 4 : 0;
  const flip = (self ? meDir : (p.dir || 1)) === -1;
  const hero = HEROES[hashId(p.id) % HEROES.length];
  softShadow(px, py + size / 2 - 4, size * 0.3);
  if (self) {
    ctx.strokeStyle = "rgba(75,157,134,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(px, py + size / 2 - 4, size * 0.34, size * 0.15, 0, 0, 6.28); ctx.stroke();
  }
  tile("dungeon", hero, px - size / 2, py - size / 2 - bob, size, flip);
  // name
  ctx.fillStyle = self ? "rgba(60,140,116,0.95)" : "rgba(70,80,99,0.9)";
  ctx.font = "600 12px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(p.name, px, py - size / 2 - 6);
  // chat bubble
  const b = bubbles.get(p.id);
  if (b && now - b.t < 5000) {
    const txt = b.text.length > 40 ? b.text.slice(0, 40) + "…" : b.text;
    ctx.font = "13px Segoe UI";
    const w = ctx.measureText(txt).width + 18;
    const bx = px - w / 2, by = py - size / 2 - 40;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    roundRect(bx, by, w, 26, 9);
    ctx.fill();
    ctx.fillStyle = "#465063";
    ctx.textAlign = "center";
    ctx.fillText(txt, px, by + 17);
  }
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function burstConfetti(id, kind) {
  const src = id === (me && me.id) ? me : players.get(id);
  const x = src ? src.x : world.w / 2;
  const y = src ? src.y : world.h / 2;
  const cols = [KIND.colors[kind || 0], "#fff", "#ffd98e", "#8fd3c7"];
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * 6.28, sp = 60 + Math.random() * 160;
    confetti.push({ x, y: y - 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 1 + Math.random(), color: cols[(Math.random() * cols.length) | 0] });
  }
}

// ------------------------------------------------------------------ satchel UI
function renderSatchel() {
  const grid = $("satchelGrid");
  grid.innerHTML = "";
  let any = false, total = 0, marketTotal = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    const n = satchel[k];
    if (n > 0) { any = true; total += n * KIND_VALUE[k]; marketTotal += n * marketPrice[k]; }
    const slot = document.createElement("div");
    slot.className = "satchel-slot" + (n > 0 ? "" : " empty");
    const arrow = marketTrend[k] > 0 ? "▲" : marketTrend[k] < 0 ? "▼" : "";
    const trendClass = marketTrend[k] > 0 ? "trend-up" : marketTrend[k] < 0 ? "trend-down" : "";
    slot.innerHTML = gemSVG(k, 28) + (n > 0 ? `<span class="count">${n}</span>` : "") +
      `<span class="val">${KIND_VALUE[k]}</span>` +
      `<span class="mkt-val ${trendClass}">${arrow}${marketPrice[k]}</span>`;
    slot.title = n > 0
      ? `Mint ${KIND.names[k]} · ${KIND_VALUE[k]} MON | Market value: ${marketPrice[k]} MON`
      : `${KIND.names[k]} · Mint ${KIND_VALUE[k]} MON | Market: ${marketPrice[k]} MON`;
    if (n > 0) slot.onclick = () => openMintModal(k);
    grid.appendChild(slot);
  }
  const empty = $("satchelEmpty");
  if (any) {
    empty.style.display = "block";
    const profit = (marketTotal - total).toFixed(2);
    empty.innerHTML = `Mint cost ≈ <b>${total.toFixed(2)} MON</b> · Market value ≈ <b>${marketTotal.toFixed(2)} MON</b> · Potential profit: <b style="color:var(--accent-deep)">+${profit} MON</b>.<br/>Tap a crystal to mint, then list it at the dynamic market price!`;
  } else {
    empty.style.display = "block";
    empty.innerHTML = `Walk up to a crystal and press <kbd>Space</kbd> to gather. Mint for 0.01–0.05 MON, sell for <b>2×–8×</b> more on the market!`;
  }
  updateMarketProcessUI();
}

// ------------------------------------------------------------------ mint / market modals
function openModal(html, onConfirm, confirmLabel = "Confirm") {
  $("modalBody").innerHTML = html;
  $("modalConfirm").textContent = confirmLabel;
  $("modal").classList.remove("hidden");
  $("modalConfirm").onclick = onConfirm;
}
function closeModal() {
  $("modal").classList.add("hidden");
}
$("modalCancel").onclick = closeModal;
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });

// ------------------------------------------------------------------ claim reward
// ------------------------------------------------------------------ dragon combat
// Reward is a RARE crystal drop (no drainable on-chain payout). The player can
// then choose to mint it — a normal, safe on-chain transaction they control.
function handleDragonDefeat() {
  if (dragonDefeated) return;
  dragonDefeated = true;
  const RARE = 4; // Tidecrystal, the most valuable kind
  satchel[RARE] += 1;
  renderSatchel();
  toast("🐉 Dragon defeated! A rare Tidecrystal dropped — mint it in your satchel to keep it onchain.", 6000);
  celebrate(RARE);
  burstConfetti(me ? me.id : "dragon", RARE);
}

function handlePlayerDeath() {
  toast("💀 The dragon scorched you! Respawning…", 3000);
  if (me) burstConfetti(me.id, 3);
  playerHealth = PLAYER_MAX_HEALTH;
  if (dragon) dragon.health = DRAGON_HEALTH;
  dragonDefeated = false;
  if (me) { me.x = 100; me.y = 100; }
}

async function openMintModal(kind) {
  if (!wallet.connected) { await connectWallet(); if (!wallet.connected) return; }
  let price = 0n;
  try { price = await readMintPrice(kind); } catch {}
  openModal(
    `<div class="big-gem">${gemSVG(kind, 88)}</div>
     <h3>Mint a ${KIND.names[kind]}</h3>
     <p>Turn your gathered crystal into an onchain collectible on Monad testnet.</p>
     <p><b>${formatEther(price)} MON</b> + gas</p>`,
    async () => {
      $("modalConfirm").disabled = true;
      try {
        setTxProcessStage(2, "Minting your crystal onchain. This creates the collectible and records it to your wallet.");
        const h = await sendTx({ data: SEL.mintItem + encUint(kind), value: price });
        satchel[kind] = Math.max(0, satchel[kind] - 1);
        renderSatchel();
        closeModal();
        toastTx("Minted a " + KIND.names[kind] + " ✦", h);
        chime(660);
        celebrate(kind);
        waitForReceipt(h).then(() => { refreshBalance(); refreshMarket(); });
      } catch (e) {
        toast(txErr(e));
      } finally {
        $("modalConfirm").disabled = false;
      }
    },
    "Mint for " + formatEther(price) + " MON"
  );
}

function openListModal(tokenId, kind) {
  const suggestedPrice = marketPrice[kind] || (KIND_VALUE[kind] * 3);
  const trendLabel = marketTrend[kind] > 0 ? "📈 Rising" : marketTrend[kind] < 0 ? "📉 Falling" : "➡️ Stable";
  openModal(
    `<div class="big-gem">${gemSVG(kind, 88)}</div>
     <h3>List ${KIND.names[kind]} #${tokenId}</h3>
     <p>Set a price in MON. It'll be escrowed until someone buys or you cancel.</p>
     <div class="market-suggest">
       <div class="suggest-label">Dynamic market price</div>
       <div class="suggest-price">${suggestedPrice} MON <span class="suggest-trend">${trendLabel}</span></div>
       <div class="suggest-hint">Mint cost: ${KIND_VALUE[kind]} MON · Profit: +${(suggestedPrice - KIND_VALUE[kind]).toFixed(4)} MON</div>
     </div>
     <input id="priceInput" inputmode="decimal" placeholder="${suggestedPrice}" value="${suggestedPrice}" />`,
    async () => {
      const price = parseEther($("priceInput").value);
      if (price <= 0n) { toast("Enter a price above 0."); return; }
      $("modalConfirm").disabled = true;
      try {
        setTxProcessStage(3, "Listing this crystal in the Meadow Market. The sale will be escrowed and visible to buyers.");
        const h = await sendTx({ data: SEL.list + encUint(tokenId) + encUint(price) });
        closeModal();
        toastTx(`Listed ${KIND.names[kind]} #${tokenId}`, h);
        waitForReceipt(h).then(refreshMarket);
      } catch (e) { toast(txErr(e)); } finally { $("modalConfirm").disabled = false; }
    },
    `List for ${suggestedPrice} MON`
  );
}

async function buyToken(tokenId, kind, price) {
  if (!wallet.connected) { await connectWallet(); if (!wallet.connected) return; }
  openModal(
    `<div class="big-gem">${gemSVG(kind, 88)}</div>
     <h3>Buy ${KIND.names[kind]} #${tokenId}</h3>
     <p>You'll pay <b>${formatEther(price)} MON</b> to the seller (minus a small meadow fee) and receive the crystal.</p>`,
    async () => {
      $("modalConfirm").disabled = true;
      try {
        setTxProcessStage(4, "Buying this crystal. The payment is being sent onchain and the listing will clear after final confirmation.");
        const h = await sendTx({ data: SEL.buy + encUint(tokenId), value: price });
        closeModal();
        toastTx(`Bought ${KIND.names[kind]} #${tokenId} ✦`, h);
        chime(720);
        celebrate(kind);
        waitForReceipt(h).then(() => { refreshBalance(); refreshMarket(); });
      } catch (e) { toast(txErr(e)); } finally { $("modalConfirm").disabled = false; }
    },
    "Buy for " + formatEther(price) + " MON"
  );
}

async function cancelToken(tokenId, kind) {
  try {
    const h = await sendTx({ data: SEL.cancelListing + encUint(tokenId) });
    toastTx(`Unlisted ${KIND.names[kind]} #${tokenId}`, h);
    waitForReceipt(h).then(refreshMarket);
  } catch (e) { toast(txErr(e)); }
}

function celebrate(kind) {
  burstConfetti(me && me.id, kind);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "celebrate", kind }));
}

// ------------------------------------------------------------------ market (light onchain read)
let marketBusy = false;
async function refreshMarket() {
  if (!CFG || marketBusy) return;
  marketBusy = true;
  $("refreshMarket").textContent = "…";
  try {
    const n = await readNextTokenId();
    const ids = [];
    for (let i = 1; i < n; i++) ids.push(i);
    const rows = await Promise.all(ids.map(async (id) => {
      const [listing, kind] = await Promise.all([readListing(id), readKind(id)]);
      let owner = null;
      if (listing.seller === "0x0000000000000000000000000000000000000000") {
        try { owner = (await readOwner(id)).toLowerCase(); } catch {}
      }
      return { id, kind, listing, owner };
    }));

    // For sale
    const forSale = rows.filter((r) => r.listing.seller !== "0x0000000000000000000000000000000000000000");
    const stats = $("marketStats");
    if (stats) {
      const avgMkt = (marketPrice.reduce((a, b) => a + b, 0) / KIND_COUNT).toFixed(3);
      stats.innerHTML = `<b>${Math.max(0, n - 1)}</b> minted · <b>${forSale.length}</b> listed · Avg market: <b>${avgMkt} MON</b>`;
    }
    const ml = $("marketList");
    ml.innerHTML = "";
    if (forSale.length === 0) {
      ml.innerHTML = `<div class="empty-note">No crystals for sale yet.<br/>Mint one and list it 🌱</div>`;
    }
    for (const r of forSale) {
      const mine = wallet.addr && r.listing.seller.toLowerCase() === wallet.addr.toLowerCase();
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `${gemSVG(r.kind, 34)}
        <div class="meta"><div class="nm">${KIND.names[r.kind]} #${r.id}</div>
        <div class="by">${mine ? "your listing" : "by " + shortAddr(r.listing.seller)}</div></div>
        <div class="act"><span class="price">${formatEther(r.listing.price)} MON</span></div>`;
      const act = card.querySelector(".act");
      const btn = document.createElement("button");
      btn.className = "mini";
      if (mine) { btn.textContent = "Cancel"; btn.onclick = () => cancelToken(r.id, r.kind); }
      else { btn.textContent = "Buy"; btn.onclick = () => buyToken(r.id, r.kind, r.listing.price); }
      act.appendChild(btn);
      ml.appendChild(card);
    }

    // My crystals (owned, not listed)
    const list2 = $("mineList");
    list2.innerHTML = "";
    if (!wallet.addr) {
      list2.innerHTML = `<div class="empty-note">Connect your wallet to see the crystals you own.</div>`;
    } else {
      const mineOwned = rows.filter((r) => r.owner === wallet.addr.toLowerCase());
      const mineListed = forSale.filter((r) => r.listing.seller.toLowerCase() === wallet.addr.toLowerCase());
      if (mineOwned.length === 0 && mineListed.length === 0) {
        list2.innerHTML = `<div class="empty-note">You don't own any crystals yet.<br/>Gather one and mint it ✦</div>`;
      }
      for (const r of mineOwned) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `${gemSVG(r.kind, 34)}
          <div class="meta"><div class="nm">${KIND.names[r.kind]} #${r.id}</div><div class="by">owned</div></div>
          <div class="act"></div>`;
        const btn = document.createElement("button");
        btn.className = "mini";
        btn.textContent = "List";
        btn.onclick = () => openListModal(r.id, r.kind);
        card.querySelector(".act").appendChild(btn);
        list2.appendChild(card);
        loadOnchainArt(r.id, card.querySelector(".gem")); // show the real on-chain SVG
      }
      for (const r of mineListed) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `${gemSVG(r.kind, 34)}
          <div class="meta"><div class="nm">${KIND.names[r.kind]} #${r.id}</div><div class="by">listed · ${formatEther(r.listing.price)} MON</div></div>
          <div class="act"></div>`;
        const btn = document.createElement("button");
        btn.className = "mini";
        btn.textContent = "Cancel";
        btn.onclick = () => cancelToken(r.id, r.kind);
        card.querySelector(".act").appendChild(btn);
        list2.appendChild(card);
        loadOnchainArt(r.id, card.querySelector(".gem"));
      }
      if (mineOwned.length || mineListed.length) {
        const note = document.createElement("div");
        note.className = "onchain-note";
        note.innerHTML = "⛓ Art above is the token's <b>fully on-chain SVG</b> — read live from the contract, no IPFS.";
        list2.appendChild(note);
      }
    }
  } catch (e) {
    // leave prior content
  } finally {
    marketBusy = false;
    $("refreshMarket").textContent = "⟳";
  }
}

// tabs
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    const tab = t.dataset.tab;
    $("marketList").classList.toggle("hidden", tab !== "listings");
    $("mineList").classList.toggle("hidden", tab !== "mine");
  };
});
$("refreshMarket").onclick = refreshMarket;

// ------------------------------------------------------------------ chat
$("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("chatInput").value.trim();
  if (v && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "chat", text: v }));
    if (me) bubbles.set(me.id, { text: v, t: performance.now() });
    addChat(me ? me.name : "you", v);
  }
  $("chatInput").value = "";
});
function addChat(who, text, sys) {
  const log = $("chatLog");
  const line = document.createElement("div");
  line.className = "line" + (sys ? " sys" : "");
  line.innerHTML = sys ? esc(text) : `<span class="who">${esc(who)}:</span> ${esc(text)}`;
  log.appendChild(line);
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ------------------------------------------------------------------ toast + audio
let toastT = null;
function toast(msg, ms = 3200) {
  const t = $("toast");
  t.innerHTML = esc(msg);
  t.classList.remove("hidden");
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), ms);
}
function toastTx(msg, hash) {
  const t = $("toast");
  t.innerHTML = `${esc(msg)} · <a href="${explorerTx(hash)}" target="_blank" rel="noopener">view tx ↗</a>`;
  t.classList.remove("hidden");
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), 6000);
}
function txErr(e) {
  const m = (e && (e.message || e.data && e.data.message)) || "Transaction failed";
  if (/user rejected|denied/i.test(m)) return "Transaction cancelled.";
  if (/insufficient funds/i.test(m)) return "Not enough MON — grab some from the faucet.";
  return m.length > 90 ? m.slice(0, 90) + "…" : m;
}

// gentle audio
let actx = null, pad = null, audioOn = false;
function initAudio() {
  actx = new (window.AudioContext || window.webkitAudioContext)();
}
function chime(freq) {
  if (!audioOn || !actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = "sine"; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.5);
  o.connect(g); g.connect(actx.destination);
  o.start(); o.stop(actx.currentTime + 0.5);
}
$("autoBtn").onclick = async () => {
  if (!autoMint && !wallet.connected) { await connectWallet(); if (!wallet.connected) return; }
  autoMint = !autoMint;
  updateAutoBtn();
  toast(autoMint
    ? "Auto-mint on — stand idle and the agent will mine & mint for you (each mint signs a tx)."
    : "Auto-mint off. Idle still auto-gathers.", 4500);
};
$("audioBtn").onclick = () => {
  if (!actx) initAudio();
  audioOn = !audioOn;
  $("audioBtn").textContent = audioOn ? "♪ on" : "♪ off";
  if (audioOn) {
    if (actx.state === "suspended") actx.resume();
    // soft ambient pad
    pad = actx.createGain(); pad.gain.value = 0.03; pad.connect(actx.destination);
    [220, 277, 330].forEach((f, i) => {
      const o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const lfo = actx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.02;
      const lg = actx.createGain(); lg.gain.value = 2;
      lfo.connect(lg); lg.connect(o.frequency);
      o.connect(pad); o.start(); lfo.start();
    });
  } else if (pad) {
    pad.gain.setTargetAtTime(0, actx.currentTime, 0.3);
  }
};

// ------------------------------------------------------------------ wallet events
if (hasWallet()) {
  window.ethereum.on && window.ethereum.on("accountsChanged", (a) => {
    if (a.length === 0) { wallet.connected = false; wallet.addr = null; try { localStorage.removeItem("mm_wallet"); } catch {} updateWalletUI(); }
    else { wallet.addr = a[0]; updateWalletUI(); refreshBalance(); refreshMarket(); }
  });
  window.ethereum.on && window.ethereum.on("chainChanged", () => location.reload());
}
$("connectBtn").onclick = connectWallet;

// ------------------------------------------------------------------ room UI
function applyName() {
  const v = ($("nameInput").value || "").slice(0, 16).trim();
  if (!v) return;
  try { localStorage.setItem("mm_name", v); } catch {}
  if (me) me.name = v;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "name", name: v }));
}
function sendSavedName() {
  let v = "";
  try { v = (localStorage.getItem("mm_name") || "").slice(0, 16).trim(); } catch {}
  if (v && me) {
    me.name = v;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "name", name: v }));
  }
}
function setupRoomUI() {
  $("roomCode").textContent = ROOM;
  try {
    const qr = qrcode(0, "M");
    qr.addData(INVITE_URL);
    qr.make();
    $("qrBox").innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  } catch (e) {
    $("qrBox").textContent = "QR";
  }
  $("copyInvite").onclick = async () => {
    try { await navigator.clipboard.writeText(INVITE_URL); toast("Invite link copied ✦"); }
    catch { toast(INVITE_URL, 6000); }
  };
  const join = () => {
    const code = ($("joinCode").value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (code && code !== ROOM) location.href = location.origin + "/?room=" + code;
  };
  $("joinBtn").onclick = join;
  const jc = $("joinCode"), nm = $("nameInput");
  jc.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  jc.addEventListener("focus", () => (typing = true));
  jc.addEventListener("blur", () => (typing = false));
  try { nm.value = localStorage.getItem("mm_name") || ""; } catch {}
  nm.addEventListener("focus", () => (typing = true));
  nm.addEventListener("blur", () => { typing = false; applyName(); });
  nm.addEventListener("keydown", (e) => { if (e.key === "Enter") { applyName(); nm.blur(); } });
}

// ------------------------------------------------------------------ mobile: sheets + joystick
function setupMobileControls() {
  const bar = $("mobileBar");
  const ids = ["roomCard", "satchel", "market", "chat"];
  let openId = null;
  function closeAll() {
    ids.forEach((id) => $(id).classList.remove("sheet-open"));
    bar.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    document.body.classList.remove("sheet-active");
    openId = null;
  }
  function open(id, btn) {
    closeAll();
    $(id).classList.add("sheet-open");
    if (btn) btn.classList.add("active");
    document.body.classList.add("sheet-active");
    openId = id;
  }
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.panel;
    if (openId === id) closeAll(); else open(id, btn);
  });
  // tapping the world dismisses any open sheet
  canvas.addEventListener("pointerdown", () => { if (openId) closeAll(); });

  // virtual joystick (pointer events cover both touch and mouse)
  const pad = $("touchPad"), stick = $("stick"), MAX = 44;
  let active = false, cx = 0, cy = 0;
  function jMove(e) {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > MAX) { dx = dx / d * MAX; dy = dy / d * MAX; }
    stick.style.transform = `translate(${dx}px,${dy}px)`;
    touchVec.x = dx / MAX; touchVec.y = dy / MAX;
  }
  function jEnd() { active = false; touchVec.x = 0; touchVec.y = 0; stick.style.transform = ""; }
  pad.addEventListener("pointerdown", (e) => {
    active = true;
    try { pad.setPointerCapture(e.pointerId); } catch {}
    const r = pad.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    jMove(e); e.preventDefault();
  });
  pad.addEventListener("pointermove", (e) => { if (active) { jMove(e); e.preventDefault(); } });
  pad.addEventListener("pointerup", jEnd);
  pad.addEventListener("pointercancel", jEnd);

  $("touchGather").addEventListener("click", (e) => { e.preventDefault(); tryGather(); });

  // on a phone, open the room sheet first so inviting is obvious
  if (matchMedia("(max-width: 760px)").matches) {
    open("roomCard", bar.querySelector('[data-panel="roomCard"]'));
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    CFG = await (await fetch("/api/config")).json();
  } catch {
    CFG = { contractAddress: "0xb1c49827eDB08AD2E34f002D962EB8B87B855296", rpc: "https://testnet-rpc.monad.xyz", chainId: 10143, explorer: "https://testnet.monadscan.com", name: "Monad Testnet" };
  }
  CHAIN_HEX = "0x" + Number(CFG.chainId).toString(16);
  if (CFG.name) $("netpill").textContent = CFG.name;
  await loadSheets();
  makeGemTints();
  buildWorld();
  setupRoomUI();
  setupMobileControls();
  renderSatchel();
  connectWS();
  refreshMarket();
  tryReconnectWallet();
  requestAnimationFrame(loop);
}
boot();
