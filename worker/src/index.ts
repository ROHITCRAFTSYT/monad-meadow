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
      const roomName = url.searchParams.get("room") || "global-meadow";
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
  private crystals = new Map<number, Crystal>();
  private nextCrystalId = 1;
  private spawning = false;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("expected websocket", { status: 426 });
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

    const player: Player = {
      id: crypto.randomUUID().slice(0, 8),
      name: pickName(),
      color: pickColor(),
      x: 200 + Math.random() * (WORLD_W - 400),
      y: 200 + Math.random() * (WORLD_H - 400),
      facing: 0,
    };
    this.players.set(ws, player);

    // Tell the newcomer everything about the world.
    this.send(ws, {
      type: "init",
      you: player,
      world: { w: WORLD_W, h: WORLD_H },
      players: [...this.players.values()].filter((p) => p.id !== player.id),
      crystals: [...this.crystals.values()],
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
    let msg: any;
    try {
      msg = JSON.parse(typeof evt.data === "string" ? evt.data : "");
    } catch {
      return;
    }

    switch (msg.type) {
      case "move": {
        // Clamp to the world so nobody wanders off the meadow.
        me.x = clamp(Number(msg.x) || 0, 0, WORLD_W);
        me.y = clamp(Number(msg.y) || 0, 0, WORLD_H);
        me.facing = Number(msg.facing) || 0;
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
        this.broadcast({ type: "celebrate", id: me.id, kind: Number(msg.kind) || 0 }, ws);
        break;
      }
    }
  }

  private onClose(ws: WebSocket) {
    const me = this.players.get(ws);
    if (!me) return;
    this.players.delete(ws);
    this.broadcast({ type: "leave", id: me.id }, null);
    try {
      ws.close();
    } catch {}
  }

  // --- crystal spawning ----------------------------------------------------

  private addCrystal() {
    const c: Crystal = {
      id: this.nextCrystalId++,
      x: 120 + Math.random() * (WORLD_W - 240),
      y: 120 + Math.random() * (WORLD_H - 240),
      kind: Math.floor(Math.random() * KINDS),
    };
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
