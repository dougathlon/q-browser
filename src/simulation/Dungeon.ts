import { TUNING } from "../config/tuning";
import { createRng, mixSeed, randomInt } from "./rng";
import {
  DIRECTIONS,
  DIRECTION_VECTORS,
  pointKey,
  type Direction,
  type DungeonChunk,
  type Point,
  type RunConfiguration,
  type StrangeEffect,
  type Tile,
} from "./types";

const STRANGE_EFFECTS: readonly StrangeEffect[] = [
  "reverse",
  "frenzy",
  "fascination",
  "calm",
  "hunger",
  "defiance",
];

function localTile(kind: Tile["kind"], x: number, y: number, variant: number): Tile {
  return { kind, x, y, variant };
}

function safeArrayItem<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing array item at ${index}.`);
  return value;
}

export class Dungeon {
  private readonly run: RunConfiguration;
  private readonly chunks = new Map<number, DungeonChunk>();
  private readonly consumedFeatures = new Set<string>();
  private version = 0;

  constructor(run: RunConfiguration) {
    this.run = run;
  }

  getVersion(): number {
    return this.version;
  }

  getChunks(): readonly DungeonChunk[] {
    return [...this.chunks.values()].sort((a, b) => a.index - b.index);
  }

  getChunkIndices(): number[] {
    return this.getChunks().map(({ index }) => index);
  }

  getChunkIndexForY(y: number): number {
    return Math.floor(y / TUNING.chunkHeight);
  }

  ensureAround(y: number): void {
    const current = this.getChunkIndexForY(y);
    const wanted = new Set<number>();
    let changed = false;
    for (let index = current - TUNING.chunksAhead; index <= current + TUNING.chunksBehind; index += 1) {
      wanted.add(index);
      if (!this.chunks.has(index)) {
        this.chunks.set(index, this.generateChunk(index));
        changed = true;
      }
    }
    for (const index of this.chunks.keys()) {
      if (!wanted.has(index)) {
        this.chunks.delete(index);
        changed = true;
      }
    }
    if (changed) this.version += 1;
  }

  getStart(): Point {
    if (!this.chunks.has(0)) this.chunks.set(0, this.generateChunk(0));
    const targetY = TUNING.chunkHeight - 4;
    const route = this.chunks.get(0)?.safeRoute.find(({ y }) => y === targetY);
    if (!route) throw new Error("The initial dungeon chunk has no start route.");
    return { ...route };
  }

  getTile(point: Point): Tile | null {
    if (point.x < 0 || point.x >= TUNING.chunkWidth) return null;
    const chunkIndex = this.getChunkIndexForY(point.y);
    if (!this.chunks.has(chunkIndex)) this.chunks.set(chunkIndex, this.generateChunk(chunkIndex));
    const chunk = this.chunks.get(chunkIndex);
    if (!chunk) return null;
    const localY = point.y - chunkIndex * TUNING.chunkHeight;
    return chunk.tiles[localY]?.[point.x] ?? null;
  }

  isWalkable(point: Point): boolean {
    const tile = this.getTile(point);
    return Boolean(tile && tile.kind !== "wall");
  }

  neighbors(point: Point): Array<Point & { direction: Direction }> {
    return DIRECTIONS.map((direction) => {
      const vector = DIRECTION_VECTORS[direction];
      return { x: point.x + vector.x, y: point.y + vector.y, direction };
    }).filter((candidate) => this.isWalkable(candidate));
  }

  consume(point: Point): void {
    const tile = this.getTile(point);
    if (!tile || (tile.kind !== "food" && tile.kind !== "strange")) return;
    tile.kind = "floor";
    delete tile.strangeEffect;
    this.consumedFeatures.add(pointKey(point));
    this.version += 1;
  }

  safeRouteExists(chunkIndex: number): boolean {
    const chunk = this.chunks.get(chunkIndex) ?? this.generateChunk(chunkIndex);
    const start = { x: chunk.bottomPortX, y: chunkIndex * TUNING.chunkHeight + TUNING.chunkHeight - 1 };
    const destinationKey = pointKey({ x: chunk.topPortX, y: chunkIndex * TUNING.chunkHeight });
    const queue = [start];
    const visited = new Set([pointKey(start)]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (pointKey(current) === destinationKey) return true;
      for (const direction of DIRECTIONS) {
        const vector = DIRECTION_VECTORS[direction];
        const next = { x: current.x + vector.x, y: current.y + vector.y };
        if (next.y < chunk.index * TUNING.chunkHeight || next.y >= (chunk.index + 1) * TUNING.chunkHeight) continue;
        const key = pointKey(next);
        if (visited.has(key)) continue;
        const tile = chunk.tiles[next.y - chunk.index * TUNING.chunkHeight]?.[next.x];
        if (!tile || tile.kind === "wall" || tile.kind === "pit" || tile.kind === "damage") continue;
        visited.add(key);
        queue.push(next);
      }
    }
    return false;
  }

  private boundaryPort(boundaryIndex: number): number {
    const rng = createRng(mixSeed(this.run.dungeonSeed, "boundary", boundaryIndex));
    return randomInt(rng, 4, TUNING.chunkWidth - 5);
  }

  private generateChunk(index: number): DungeonChunk {
    const rng = createRng(mixSeed(this.run.dungeonSeed, "chunk", index, "v1"));
    const topPortX = this.boundaryPort(index);
    const bottomPortX = this.boundaryPort(index + 1);
    const originY = index * TUNING.chunkHeight;
    const tiles: Tile[][] = Array.from({ length: TUNING.chunkHeight }, (_, localY) => {
      return Array.from({ length: TUNING.chunkWidth }, (_, x) => {
        return localTile("wall", x, originY + localY, randomInt(rng, 0, 7));
      });
    });
    const safeRoute: Point[] = [];
    const routeByRow = new Map<number, number>();

    const carve = (x: number, localY: number): void => {
      const tile = tiles[localY]?.[x];
      if (tile) tile.kind = "floor";
    };

    let x = bottomPortX;
    for (let localY = TUNING.chunkHeight - 1; localY >= 0; localY -= 1) {
      const previousX = x;
      const rowsLeft = Math.max(1, localY);
      const delta = topPortX - x;
      const mustMove = Math.abs(delta) >= rowsLeft;
      if (localY < TUNING.chunkHeight - 1 && delta !== 0 && (mustMove || rng() < 0.58)) {
        x += Math.sign(delta);
      } else if (!mustMove && rng() < 0.24) {
        const wander = rng() < 0.5 ? -1 : 1;
        x = Math.max(3, Math.min(TUNING.chunkWidth - 4, x + wander));
      }
      if (localY === 0) x = topPortX;
      for (let bridgeX = Math.min(previousX, x); bridgeX <= Math.max(previousX, x); bridgeX += 1) {
        carve(bridgeX, localY);
        safeRoute.push({ x: bridgeX, y: originY + localY });
      }
      if (rng() < 0.55) carve(x + (rng() < 0.5 ? -1 : 1), localY);
      routeByRow.set(localY, x);
    }

    const difficulty = Math.max(0, Math.min(1, Math.max(0, -index) / 14));
    const chamberCount = 2 + Math.floor(difficulty * 2);
    for (let chamber = 0; chamber < chamberCount; chamber += 1) {
      const localY = randomInt(rng, 3, TUNING.chunkHeight - 4);
      const centerX = routeByRow.get(localY) ?? topPortX;
      const halfWidth = randomInt(rng, 2, difficulty > 0.55 ? 4 : 3);
      const halfHeight = randomInt(rng, 1, 2);
      for (let dy = -halfHeight; dy <= halfHeight; dy += 1) {
        for (let dx = -halfWidth; dx <= halfWidth; dx += 1) {
          if ((dx * dx) / (halfWidth * halfWidth + 0.01) + (dy * dy) / (halfHeight * halfHeight + 0.01) <= 1.45) {
            carve(centerX + dx, localY + dy);
          }
        }
      }
    }

    const branchCount = Math.max(2, Math.round((2 + difficulty * 3) * this.run.world.junctionDensity));
    for (let branch = 0; branch < branchCount; branch += 1) {
      const localY = randomInt(rng, 2, TUNING.chunkHeight - 4);
      const routeX = routeByRow.get(localY) ?? topPortX;
      const side = rng() < 0.5 ? -1 : 1;
      const length = randomInt(rng, 3, 5 + Math.round(difficulty * 3));
      let branchX = routeX;
      for (let step = 0; step < length; step += 1) {
        branchX += side;
        if (branchX < 2 || branchX >= TUNING.chunkWidth - 2) break;
        carve(branchX, localY);
        if (step > 1 && rng() < 0.34) carve(branchX, localY - 1);
      }
      if (rng() < 0.58) {
        const reconnectY = Math.max(1, localY - randomInt(rng, 2, 4));
        for (let yStep = localY; yStep >= reconnectY; yStep -= 1) carve(branchX, yStep);
        const reconnectX = routeByRow.get(reconnectY) ?? routeX;
        while (branchX !== reconnectX) {
          branchX += Math.sign(reconnectX - branchX);
          carve(branchX, reconnectY);
        }
      }
    }

    for (let localY = 0; localY < TUNING.chunkHeight; localY += 1) {
      for (let tileX = 0; tileX < TUNING.chunkWidth; tileX += 1) {
        const tile = tiles[localY]?.[tileX];
        if (!tile || tile.kind !== "floor") continue;
        const key = pointKey(tile);
        const protectedRoute = safeRoute.some((point) => pointKey(point) === key);
        const protectedStart = index === 0 && Math.abs(localY - (TUNING.chunkHeight - 4)) <= 5;
        if (!protectedRoute && !protectedStart) {
          const hazardChance = (0.022 + difficulty * 0.04) * this.run.world.hazardDensity;
          if (rng() < hazardChance) {
            tile.kind = rng() < 0.52 ? "pit" : "damage";
            continue;
          }
        }
        const foodChance = (0.018 - difficulty * 0.008) * this.run.world.foodAbundance;
        if (rng() < foodChance) {
          tile.kind = "food";
          continue;
        }
        const strangeChance = (0.009 + difficulty * 0.016) * this.run.world.strangeDensity;
        if (rng() < strangeChance && !protectedStart) {
          tile.kind = "strange";
          tile.strangeEffect = safeArrayItem(STRANGE_EFFECTS, randomInt(rng, 0, STRANGE_EFFECTS.length - 1));
        }
      }
    }

    for (const row of tiles) {
      for (const tile of row) {
        if (this.consumedFeatures.has(pointKey(tile)) && (tile.kind === "food" || tile.kind === "strange")) {
          tile.kind = "floor";
          delete tile.strangeEffect;
        }
      }
    }

    const chunk: DungeonChunk = { index, tiles, safeRoute, topPortX, bottomPortX, difficulty };
    if (!this.safeRouteInChunk(chunk)) throw new Error(`Dungeon chunk ${index} lost its guaranteed route.`);
    return chunk;
  }

  private safeRouteInChunk(chunk: DungeonChunk): boolean {
    return chunk.safeRoute.every((point) => {
      const tile = chunk.tiles[point.y - chunk.index * TUNING.chunkHeight]?.[point.x];
      return Boolean(tile && tile.kind !== "wall" && tile.kind !== "pit" && tile.kind !== "damage");
    });
  }
}
