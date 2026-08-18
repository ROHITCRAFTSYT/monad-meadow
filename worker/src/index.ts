/**
 * Monad Meadow — realtime multiplayer world.
 *
 * A single Cloudflare Worker that:
 *   - serves the static game client (via the ASSETS binding), and
 *   - upgrades /ws connections into a Durable Object "WorldRoom" that holds the
 *     shared world: who is connected, where they are, and which crystals are
 *     currently gatherable.
 *
 * The on-chain economy (mint / trade for MON) lives entirely in the browser
 * against the Monad testnet contract, so the realtime layer stays lightweight
 * and never sees a private key.
 */

export interface Env {
  WORLD_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  CONTRACT_ADDRESS: string;
  // optional overrides — set these to switch the app to Monad mainnet
  CHAIN_ID?: string;
  RPC_URL?: string;
  EXPLORER?: string;
  NETWORK_NAME?: string;
}

const WORLD_W = 2400;
const WORLD_H = 1600;
const MAX_CRYSTALS = 18;
const SPAWN_MS = 4000;
const KINDS = 5;

// Crystal keep-out zones — must mirror the client world layout (public/game.js
// buildWorld) so a gatherable crystal never lands in water or the walled dungeon.
const TILE = 48;
const GCOLS = Math.ceil(WORLD_W / TILE); // 50
const GROWS = Math.ceil(WORLD_H / TILE); // 34
const _midC = GCOLS >> 1, _midR = GROWS >> 1;
const WATER = [
  { cx: (_midC + 0.5) * TILE, cy: (_midR + 0.5) * TILE, rx: TILE * 1.15, ry: TILE * 0.9 }, // plaza fountain
  { cx: (_midC + 9 + 0.5) * TILE, cy: (_midR + 6 + 0.5) * TILE, rx: TILE * 1.9, ry: TILE * 1.3 }, // ponds
  { cx: (8 + 0.5) * TILE, cy: (6 + 0.5) * TILE, rx: TILE * 1.9, ry: TILE * 1.3 },
  { cx: (GCOLS - 6 + 0.5) * TILE, cy: (GROWS - 5 + 0.5) * TILE, rx: TILE * 1.9, ry: TILE * 1.3 },
];
const DUNGEON = { x0: (GCOLS - 13) * TILE, y0: 2 * TILE, x1: (GCOLS - 3 + 1) * TILE, y1: (10 + 1) * TILE };

// Server-authoritative dragon boss: it wanders the dungeon and chases nearby
// players, so every client sees the same dragon in the same place.
const DRAGON_MAX_HP = 60;
const DRAGON_SPEED = 62;      // px/s
const DRAGON_AGGRO = 440;     // chase players within this range
const DRAGON_HIT = 4;         // hp removed per player attack
const DRAGON_TICK_MS = 180;
const DRAGON_RESPAWN_MS = 9000;
const ATTACK_COOLDOWN_MS = 220;
const DIN = { x0: DUNGEON.x0 + TILE, y0: DUNGEON.y0 + TILE, x1: DUNGEON.x1 - TILE, y1: DUNGEON.y1 - TILE }; // interior

function spawnable(x: number, y: number): boolean {
  // keep crystals out of the walled dungeon arena (with a small margin)
  if (x >= DUNGEON.x0 - 30 && x <= DUNGEON.x1 + 30 && y >= DUNGEON.y0 - 30 && y <= DUNGEON.y1 + 30) return false;
  // and out of every pond / the fountain (1.3x margin so they don't touch the shore)
  for (const w of WATER) {
    const dx = (x - w.cx) / (w.rx * 1.3), dy = (y - w.cy) / (w.ry * 1.3);
    if (dx * dx + dy * dy <= 1) return false;
  }
  return true;
}

// Abuse guards.
const MAX_PLAYERS = 80; // per room / Durable Object
const MAX_MSG_BYTES = 4096; // reject oversized inbound frames before parsing
// Simple per-connection token bucket: sustained ~30 msgs/sec with a burst of 60.
const RATE_BURST = 60;
const RATE_REFILL_PER_SEC = 30;

interface Player {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  facing: number; // radians
}

interface Crystal {
  id: number;
  x: number;
  y: number;
  kind: number;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return Response.json({
        contractAddress: env.CONTRACT_ADDRESS,
        chainId: env.CHAIN_ID ? Number(env.CHAIN_ID) : 10143,
        rpc: env.RPC_URL || "https://testnet-rpc.monad.xyz",
        explorer: env.EXPLORER || "https://testnet.monadscan.com",
        name: env.NETWORK_NAME || "Monad Testnet",
      });
    }

    if (url.pathname === "/ws") {
      // Everyone shares one global meadow room. Swap the name for per-room worlds.
      // Sanitize the room code before it becomes a Durable Object name: cap the
      // length and restrict to a safe charset so a client can't send a giant or
      // exotic string as the DO name.
      const rawRoom = url.searchParams.get("room") || "";
      const roomName = rawRoom.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "global-meadow";
      const id = env.WORLD_ROOM.idFromName(roomName);
      const stub = env.WORLD_ROOM.get(id);
      return stub.fetch(request);
    }

    // Everything else is the static client.
    return env.ASSETS.fetch(request);
  },
};

export class WorldRoom {
  private state: DurableObjectState;
  private players = new Map<WebSocket, Player>();
  // Per-connection rate-limit state, kept out of Player so it never leaks to clients.
  private meta = new Map<WebSocket, { tokens: number; last: number }>();
  private crystals = new Map<number, Crystal>();
  private nextCrystalId = 1;
  private spawning = false;
  // shared dragon state
  private dragon = { x: (DIN.x0 + DIN.x1) / 2, y: (DIN.y0 + DIN.y1) / 2, hp: DRAGON_MAX_HP, alive: true, hx: 1, hy: 0 };
  private dragonLoop = false;
  private lastAttack = new Map<string, number>(); // playerId -> ts

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    // Cap the number of simultaneous connections a single room will hold so one
    // abuser can't exhaust memory by opening unlimited sockets.
    if (this.players.size >= MAX_PLAYERS) {
      return new Response("room full", { status: 503 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    this.onConnect(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private onConnect(ws: WebSocket) {
    // Seed the world with crystals on the first connection.
    if (this.crystals.size === 0) {
      for (let i = 0; i < MAX_CRYSTALS; i++) this.addCrystal();
    }
    this.ensureSpawning();
    this.ensureDragon();

    const player: Player = {
      id: crypto.randomUUID().slice(0, 8),
      name: pickName(),
      color: pickColor(),
      x: 200 + Math.random() * (WORLD_W - 400),
      y: 200 + Math.random() * (WORLD_H - 400),
      facing: 0,
    };
    this.players.set(ws, player);
    this.meta.set(ws, { tokens: RATE_BURST, last: Date.now() });

    // Tell the newcomer everything about the world.
    this.send(ws, {
      type: "init",
      you: player,
      world: { w: WORLD_W, h: WORLD_H },
      players: [...this.players.values()].filter((p) => p.id !== player.id),
      crystals: [...this.crystals.values()],
      dragon: { x: Math.round(this.dragon.x), y: Math.round(this.dragon.y), hp: this.dragon.hp, maxHp: DRAGON_MAX_HP, alive: this.dragon.alive },
    });

    // Tell everyone else about the newcomer.
    this.broadcast({ type: "join", player }, ws);

    ws.addEventListener("message", (evt) => this.onMessage(ws, evt));
    const drop = () => this.onClose(ws);
    ws.addEventListener("close", drop);
    ws.addEventListener("error", drop);
  }

  private onMessage(ws: WebSocket, evt: MessageEvent) {
    const me = this.players.get(ws);
    if (!me) return;
    if (!this.allow(ws)) return; // per-connection rate limit
    // Only accept reasonably-sized text frames; drop anything oversized/binary.
    const data = evt.data;
    if (typeof data !== "string" || data.length > MAX_MSG_BYTES) return;
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "move": {
        // Clamp to the world so nobody wanders off the meadow.
        me.x = clamp(Number(msg.x) || 0, 0, WORLD_W);
        me.y = clamp(Number(msg.y) || 0, 0, WORLD_H);
        const facing = Number(msg.facing);
        me.facing = Number.isFinite(facing) ? facing : 0;
        this.broadcast({ type: "moved", id: me.id, x: me.x, y: me.y, facing: me.facing }, ws);
        break;
      }
      case "pickup": {
        const c = this.crystals.get(Number(msg.crystalId));
        if (!c) return;
        // Server-side proximity check so a client can't grab from across the map.
        if (dist(me.x, me.y, c.x, c.y) > 90) return;
        this.crystals.delete(c.id);
        // The picker learns which kind they gathered (so they can mint it).
        this.send(ws, { type: "gathered", crystalId: c.id, kind: c.kind });
        this.broadcast({ type: "removed", crystalId: c.id, by: me.id }, null);
        break;
      }
      case "chat": {
        const text = String(msg.text || "").slice(0, 140);
        if (text.trim()) this.broadcast({ type: "chat", id: me.id, name: me.name, text }, ws);
        break;
      }
      case "name": {
        const name = String(msg.name || "").slice(0, 16).trim();
        if (name) {
          me.name = name;
          this.broadcast({ type: "renamed", id: me.id, name }, null);
        }
        break;
      }
      case "celebrate": {
        // Broadcast a gentle confetti burst when someone mints/trades on-chain.
        const kind = clamp(Math.floor(Number(msg.kind) || 0), 0, KINDS - 1);
        this.broadcast({ type: "celebrate", id: me.id, kind }, ws);
        break;
      }
      case "attack": {
        const d = this.dragon;
        if (!d.alive) return;
        if (dist(me.x, me.y, d.x, d.y) > 150) return; // must be in melee range (server-checked)
        const now = Date.now();
        if (now - (this.lastAttack.get(me.id) || 0) < ATTACK_COOLDOWN_MS) return;
        this.lastAttack.set(me.id, now);
        d.hp = Math.max(0, d.hp - DRAGON_HIT);
        this.broadcast({ type: "dragonHit", x: Math.round(d.x), y: Math.round(d.y), by: me.id, hp: d.hp }, null);
        if (d.hp === 0) {
          d.alive = false;
          this.broadcast({ type: "dragonDown", by: me.id, name: me.name }, null);
          setTimeout(() => {
            d.hp = DRAGON_MAX_HP; d.alive = true;
            d.x = (DIN.x0 + DIN.x1) / 2; d.y = (DIN.y0 + DIN.y1) / 2;
            this.broadcast({ type: "dragonRespawn" }, null);
          }, DRAGON_RESPAWN_MS);
        }
        break;
      }
    }
  }

  // The dragon roams the dungeon; it chases the nearest player in range, else
  // drifts. Runs while at least one player is connected.
  private ensureDragon() {
    if (this.dragonLoop) return;
    this.dragonLoop = true;
    let prev = Date.now();
    const tick = () => {
      if (this.players.size === 0) { this.dragonLoop = false; return; }
      const now = Date.now();
      const dt = Math.min(0.4, (now - prev) / 1000); prev = now;
      const d = this.dragon;
      if (d.alive) {
        let target: Player | null = null, best = DRAGON_AGGRO;
        for (const p of this.players.values()) {
          const dd = dist(p.x, p.y, d.x, d.y);
          if (dd < best) { best = dd; target = p; }
        }
        if (target) {
          const a = Math.atan2(target.y - d.y, target.x - d.x);
          d.hx = Math.cos(a); d.hy = Math.sin(a);
        } else if (Math.random() < 0.04) {
          const a = Math.random() * 6.283; d.hx = Math.cos(a); d.hy = Math.sin(a);
        }
        d.x += d.hx * DRAGON_SPEED * dt;
        d.y += d.hy * DRAGON_SPEED * dt;
        if (d.x < DIN.x0) { d.x = DIN.x0; d.hx = Math.abs(d.hx); }
        if (d.x > DIN.x1) { d.x = DIN.x1; d.hx = -Math.abs(d.hx); }
        if (d.y < DIN.y0) { d.y = DIN.y0; d.hy = Math.abs(d.hy); }
        if (d.y > DIN.y1) { d.y = DIN.y1; d.hy = -Math.abs(d.hy); }
      }
      this.broadcast({ type: "dragon", x: Math.round(d.x), y: Math.round(d.y), hp: d.hp, alive: d.alive }, null);
      setTimeout(tick, DRAGON_TICK_MS);
    };
    setTimeout(tick, DRAGON_TICK_MS);
  }

  private onClose(ws: WebSocket) {
    const me = this.players.get(ws);
    if (!me) return;
    this.players.delete(ws);
    this.meta.delete(ws);
    this.lastAttack.delete(me.id);
    this.broadcast({ type: "leave", id: me.id }, null);
    try {
      ws.close();
    } catch {}
  }

  // --- crystal spawning ----------------------------------------------------

  private addCrystal() {
    // retry until the spot is in the open (not water, not the dungeon arena)
    let x = 120 + Math.random() * (WORLD_W - 240);
    let y = 120 + Math.random() * (WORLD_H - 240);
    for (let t = 0; t < 40 && !spawnable(x, y); t++) {
      x = 120 + Math.random() * (WORLD_W - 240);
      y = 120 + Math.random() * (WORLD_H - 240);
    }
    const c: Crystal = { id: this.nextCrystalId++, x, y, kind: Math.floor(Math.random() * KINDS) };
    this.crystals.set(c.id, c);
    return c;
  }

  private ensureSpawning() {
    if (this.spawning) return;
    this.spawning = true;
    const tick = () => {
      if (this.players.size === 0) {
        this.spawning = false;
        return;
      }
      if (this.crystals.size < MAX_CRYSTALS) {
        const c = this.addCrystal();
        this.broadcast({ type: "spawn", crystal: c }, null);
      }
      setTimeout(tick, SPAWN_MS);
    };
    setTimeout(tick, SPAWN_MS);
  }

  // --- helpers -------------------------------------------------------------

  // Token-bucket rate limiter: returns false when a connection is over budget so
  // the caller drops the message. Refills continuously up to RATE_BURST.
  private allow(ws: WebSocket): boolean {
    const m = this.meta.get(ws);
    if (!m) return false;
    const now = Date.now();
    const elapsed = (now - m.last) / 1000;
    m.last = now;
    m.tokens = Math.min(RATE_BURST, m.tokens + elapsed * RATE_REFILL_PER_SEC);
    if (m.tokens < 1) return false;
    m.tokens -= 1;
    return true;
  }

  private send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }

  private broadcast(data: unknown, except: WebSocket | null) {
    const payload = JSON.stringify(data);
    for (const ws of this.players.keys()) {
      if (ws === except) continue;
      try {
        ws.send(payload);
      } catch {}
    }
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

const NAMES = ["Fern", "Willow", "Pebble", "Mist", "Sage", "Brook", "Clover", "Dawn", "Reed", "Lumen", "Iris", "Moss"];
function pickName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 90 + 10);
}
const COLORS = ["#8fd3c7", "#ffd98e", "#c9b6ff", "#ff9d8a", "#8ec5ff", "#b7e4a0", "#f7a8c4"];
function pickColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}
