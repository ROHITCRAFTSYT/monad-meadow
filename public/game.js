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
};
const CHAIN_HEX = "0x279f"; // 10143

let CFG = null; // {contractAddress, rpc, chainId, explorer}

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
          chainName: "Monad Testnet",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: [CFG.rpc],
          blockExplorerUrls: [CFG.explorer],
        }],
      });
    } else throw e;
  }
}
async function connectWallet() {
  if (!hasWallet()) {
    toast("No wallet found. Install MetaMask to mint & trade.", 5000);
    return;
  }
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
    toast("Wallet connection cancelled.");
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
async function refreshBalance() {
  if (!wallet.addr) return;
  try {
    const b = await rpc("eth_getBalance", [wallet.addr, "latest"]);
    $("acctBal").textContent = formatEther(BigInt(b), 3) + " MON";
  } catch {}
}
async function sendTx({ data, value }) {
  await ensureChain();
  const tx = { from: wallet.addr, to: CFG.contractAddress, data };
  if (value !== undefined) tx.value = toHexWei(value);
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
}
function explorerTx(h) {
  return `${CFG.explorer}/tx/${h}`;
}

// ------------------------------------------------------------------ game state
const world = { w: 2400, h: 1600 };
let me = null; // {id,name,color,x,y,facing}
const players = new Map(); // id -> {name,color,x,y,facing, rx,ry}
const crystals = new Map(); // id -> {x,y,kind,phase}
const satchel = [0, 0, 0, 0, 0]; // gathered-but-unminted counts by kind
const bubbles = new Map(); // id -> {text, t}
const confetti = [];
let nearestCrystal = null;
let meMoving = false, meDir = 1;

const canvas = $("game");
const ctx = canvas.getContext("2d");
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
  bush: 6, berry: 30, path: 39, pathA: 40,
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
const motes = [];
const gemTint = [];    // 5 pre-tinted gem canvases

// MON value per kind (mirrors the contract mint prices) — used for value labels
const KIND_VALUE = [0.01, 0.02, 0.03, 0.04, 0.05];

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

function buildWorld() {
  const rnd = lcg(0x1a2b3c);
  GCOLS = Math.ceil(world.w / TILE);
  GROWS = Math.ceil(world.h / TILE);
  ground = new Array(GCOLS * GROWS);
  dungeonMask = new Array(GCOLS * GROWS).fill(false);
  colliders.length = 0;

  // dungeon region (top-right cave)
  const dx0 = GCOLS - 15, dx1 = GCOLS - 3, dy0 = 2, dy1 = 11;
  // farm plots (rectangles of soil)
  const plots = [];
  for (let i = 0; i < 4; i++) {
    const pw = 4 + ((rnd() * 3) | 0), ph = 3 + ((rnd() * 2) | 0);
    const px = 2 + ((rnd() * (GCOLS - pw - 18)) | 0);
    const py = 3 + ((rnd() * (GROWS - ph - 4)) | 0);
    plots.push({ px, py, pw, ph });
  }
  const inRect = (c, r, R) => c >= R.px && c < R.px + R.pw && r >= R.py && r < R.py + R.ph;

  for (let r = 0; r < GROWS; r++) {
    for (let c = 0; c < GCOLS; c++) {
      const i = r * GCOLS + c;
      const inDungeon = c >= dx0 && c <= dx1 && r >= dy0 && r <= dy1;
      if (inDungeon) {
        dungeonMask[i] = true;
        const wall = c === dx0 || c === dx1 || r === dy0 || r === dy1;
        if (wall) {
          // leave a doorway on the left wall so players can enter the dungeon
          const doorway = c === dx0 && r === ((dy0 + dy1) >> 1);
          ground[i] = { sheet: "dungeon", idx: rnd() < 0.5 ? T.dWall : T.dWallA };
          if (!doorway) colliders.push({ l: c * TILE + 2, t: r * TILE + 2, r: c * TILE + TILE - 2, b: r * TILE + TILE - 2 });
          if (doorway) ground[i] = { sheet: "dungeon", idx: T.dFloor };
        } else {
          ground[i] = { sheet: "dungeon", idx: rnd() < 0.4 ? T.dFloorA : rnd() < 0.5 ? T.dFloorB : T.dFloor };
        }
        continue;
      }
      let plot = null;
      for (const P of plots) if (inRect(c, r, P)) { plot = P; break; }
      if (plot) {
        ground[i] = { sheet: "farm", idx: rnd() < 0.5 ? T.soil : T.soilA };
        continue;
      }
      // dirt cross-paths through the meadow
      const onPath = Math.abs(r - (GROWS >> 1)) < 1 || Math.abs(c - (GCOLS >> 1)) < 1;
      if (onPath) { ground[i] = { sheet: "town", idx: rnd() < 0.5 ? T.path : T.pathA }; continue; }
      // grass with subtle variety
      const v = rnd();
      ground[i] = { sheet: "town", idx: v < 0.12 ? T.grassA : v < 0.2 ? T.grassB : T.grass };
    }
  }

  // decorations
  decor.length = 0;
  const cellFree = (c, r) => {
    if (c < 0 || r < 0 || c >= GCOLS || r >= GROWS) return false;
    const i = r * GCOLS + c;
    if (dungeonMask[i]) return false;
    return ground[i].sheet === "town" && ground[i].idx <= T.grassB;
  };
  const place = (sheet, idx, c, r, size, solid) => {
    const o = { wx: c * TILE + (TILE - size) / 2, wy: r * TILE + (TILE - size) - 6, sheet, idx, size, ay: r * TILE + TILE };
    decor.push(o);
    if (solid) {
      // a footprint box at the base of the sprite, so the player collides with
      // the trunk/fence/prop rather than the whole (often mostly-empty) tile
      const bw = size * (solid === "fence" ? 0.94 : solid === "tree" ? 0.34 : 0.52);
      const bh = size * (solid === "fence" ? 0.44 : 0.26);
      const cxp = o.wx + size / 2, byp = o.wy + size - 5;
      colliders.push({ l: cxp - bw / 2, t: byp - bh, r: cxp + bw / 2, b: byp });
    }
    return o;
  };

  // trees (solid)
  for (let n = 0; n < 40; n++) {
    const c = (rnd() * GCOLS) | 0, r = (rnd() * GROWS) | 0;
    if (!cellFree(c, r)) continue;
    const k = rnd();
    place("town", k < 0.5 ? T.treeGreen : k < 0.8 ? T.treeRound : T.treeAutumn, c, r, 64, "tree");
  }
  // bushes / berries (passable — soft scenery)
  for (let n = 0; n < 46; n++) {
    const c = (rnd() * GCOLS) | 0, r = (rnd() * GROWS) | 0;
    if (!cellFree(c, r)) continue;
    place("town", rnd() < 0.35 ? T.berry : T.bush, c, r, 40);
  }
  // crops on the soil plots (passable) + fences around them (solid)
  for (const P of plots) {
    for (let r = P.py; r < P.py + P.ph; r++) for (let c = P.px; c < P.px + P.pw; c++) {
      if (rnd() < 0.55) place("farm", T.crops[(rnd() * T.crops.length) | 0], c, r, 34);
    }
    for (let c = P.px - 1; c <= P.px + P.pw; c++) {
      place("town", T.fenceH, c, P.py - 1, 40, "fence");
      place("town", T.fenceH, c, P.py + P.ph, 40, "fence");
    }
  }
  // farm animals wandering the meadow (passable)
  for (let n = 0; n < 7; n++) {
    const c = (rnd() * GCOLS) | 0, r = (rnd() * GROWS) | 0;
    if (!cellFree(c, r)) continue;
    place("farm", T.animals[(rnd() * T.animals.length) | 0], c, r, 32);
    const o = decor[decor.length - 1];
    o.animal = true; o.bx = o.wx; o.by = o.wy; o.ph = rnd() * 6.28;
  }
  // dungeon loot: chests + barrels (solid props)
  for (let n = 0; n < 5; n++) {
    const c = dx0 + 1 + ((rnd() * (dx1 - dx0 - 1)) | 0), r = dy0 + 1 + ((rnd() * (dy1 - dy0 - 1)) | 0);
    place("dungeon", rnd() < 0.5 ? T.chest : T.barrel, c, r, 34, "prop");
  }
  decor.sort((a, b) => a.ay - b.ay);

  // ambient motes
  motes.length = 0;
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

function tryGather() {
  if (!nearestCrystal || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "pickup", crystalId: nearestCrystal.id }));
}

// ------------------------------------------------------------------ networking
let ws = null;
let reconnectT = null;
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
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
      setPresence();
      addChat(null, "You wandered into the meadow. Say hello 🌿", true);
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

function update(dt, now) {
  if (me) {
    let dx = 0, dy = 0;
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    meMoving = !!(dx || dy);
    if (dx < 0) meDir = -1; else if (dx > 0) meDir = 1;
    if (meMoving) {
      const l = Math.hypot(dx, dy);
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
  // confetti
  for (let i = confetti.length - 1; i >= 0; i--) {
    const p = confetti[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.life -= dt;
    if (p.life <= 0) confetti.splice(i, 1);
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

  // motes
  for (const m of motes) {
    const y = m.y + Math.sin(now / 1000 * (m.sp / 8) + m.ph) * 18;
    ctx.fillStyle = `rgba(255,255,255,${m.a})`;
    ctx.beginPath();
    ctx.arc(m.x, y, 3, 0, 6.28);
    ctx.fill();
  }

  // build y-sorted draw list of decor + crystals + players
  const pad = 80;
  const items = [];
  for (const d of decor) {
    if (d.wx < camX - pad || d.wx > camX + vw + pad || d.wy < camY - pad || d.wy > camY + vh + pad) continue;
    items.push({ ay: d.ay, t: 0, d });
  }
  for (const c of crystals.values()) items.push({ ay: c.y, t: 1, c });
  for (const p of players.values()) items.push({ ay: p.ry, t: 2, p, self: false });
  if (me) items.push({ ay: me.y, t: 2, p: me, self: true });
  items.sort((a, b) => a.ay - b.ay);

  for (const it of items) {
    if (it.t === 0) drawDecor(it.d, now);
    else if (it.t === 1) drawCrystal(it.c, now);
    else drawPlayer(it.p, now, it.self);
  }

  // confetti on top
  for (const c of confetti) {
    ctx.globalAlpha = Math.max(0, Math.min(1, c.life));
    ctx.fillStyle = c.color;
    ctx.fillRect(c.x, c.y, 6, 6);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
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
  // tinted gem sprite
  const g = gemTint[c.kind];
  if (g) ctx.drawImage(g, c.x - 16, y - 16, 32, 32);
  if (isNear) {
    ctx.strokeStyle = "rgba(75,157,134,0.9)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(c.x, y, 24, 0, 6.28); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.fillStyle = KIND.colors[c.kind];
    ctx.font = "700 13px Segoe UI";
    ctx.fillText(`${KIND.names[c.kind]} · ${KIND_VALUE[c.kind]} MON`, c.x, y - 34);
    ctx.fillStyle = "rgba(70,80,99,0.8)";
    ctx.font = "600 11px Segoe UI";
    ctx.fillText("Space to gather", c.x, y - 20);
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
  let any = false, total = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    const n = satchel[k];
    if (n > 0) { any = true; total += n * KIND_VALUE[k]; }
    const slot = document.createElement("div");
    slot.className = "satchel-slot" + (n > 0 ? "" : " empty");
    slot.innerHTML = gemSVG(k, 28) + (n > 0 ? `<span class="count">${n}</span>` : "") +
      `<span class="val">${KIND_VALUE[k]}</span>`;
    slot.title = n > 0 ? `Mint ${KIND.names[k]} · ${KIND_VALUE[k]} MON` : `${KIND.names[k]} · ${KIND_VALUE[k]} MON`;
    if (n > 0) slot.onclick = () => openMintModal(k);
    grid.appendChild(slot);
  }
  const empty = $("satchelEmpty");
  if (any) {
    empty.style.display = "block";
    empty.innerHTML = `Satchel value ≈ <b>${total.toFixed(2)} MON</b>. Tap a crystal to mint it onchain (micro-tx), then list it in the market to sell (macro-tx).`;
  } else {
    empty.style.display = "block";
    empty.innerHTML = `Walk up to a crystal and press <kbd>Space</kbd> to gather. Each kind is worth 0.01–0.05 MON.`;
  }
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
        const h = await sendTx({ data: SEL.mintItem + encUint(kind), value: price });
        satchel[kind] = Math.max(0, satchel[kind] - 1);
        renderSatchel();
        closeModal();
        toastTx("Minted a " + KIND.names[kind] + " ✦", h);
        chime(660);
        celebrate(kind);
        setTimeout(() => { refreshBalance(); refreshMarket(); }, 2500);
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
  openModal(
    `<div class="big-gem">${gemSVG(kind, 88)}</div>
     <h3>List ${KIND.names[kind]} #${tokenId}</h3>
     <p>Set a price in MON. It'll be escrowed until someone buys or you cancel.</p>
     <input id="priceInput" inputmode="decimal" placeholder="0.10" />`,
    async () => {
      const price = parseEther($("priceInput").value);
      if (price <= 0n) { toast("Enter a price above 0."); return; }
      $("modalConfirm").disabled = true;
      try {
        const h = await sendTx({ data: SEL.list + encUint(tokenId) + encUint(price) });
        closeModal();
        toastTx(`Listed ${KIND.names[kind]} #${tokenId}`, h);
        setTimeout(refreshMarket, 2500);
      } catch (e) { toast(txErr(e)); } finally { $("modalConfirm").disabled = false; }
    },
    "List for sale"
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
        const h = await sendTx({ data: SEL.buy + encUint(tokenId), value: price });
        closeModal();
        toastTx(`Bought ${KIND.names[kind]} #${tokenId} ✦`, h);
        chime(720);
        celebrate(kind);
        setTimeout(() => { refreshBalance(); refreshMarket(); }, 2500);
      } catch (e) { toast(txErr(e)); } finally { $("modalConfirm").disabled = false; }
    },
    "Buy for " + formatEther(price) + " MON"
  );
}

async function cancelToken(tokenId, kind) {
  try {
    const h = await sendTx({ data: SEL.cancelListing + encUint(tokenId) });
    toastTx(`Unlisted ${KIND.names[kind]} #${tokenId}`, h);
    setTimeout(refreshMarket, 2500);
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

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    CFG = await (await fetch("/api/config")).json();
  } catch {
    CFG = { contractAddress: "0xd49c37f91bcdaa33aadc72cf46bfc5e25109d15f", rpc: "https://testnet-rpc.monad.xyz", chainId: 10143, explorer: "https://testnet.monadscan.com" };
  }
  await loadSheets();
  makeGemTints();
  buildWorld();
  renderSatchel();
  connectWS();
  refreshMarket();
  tryReconnectWallet();
  requestAnimationFrame(loop);
}
boot();
