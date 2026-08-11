import { describe, expect, it } from "vitest";

import { TUNING } from "../../src/config/tuning";
import { Dungeon } from "../../src/simulation/Dungeon";
import { ClassicalCorrelatedRunGenerator } from "../../src/simulation/RunGenerator";

function chunkFingerprint(dungeon: Dungeon): unknown {
  return dungeon.getChunks().map((chunk) => ({
    index: chunk.index,
    topPortX: chunk.topPortX,
    bottomPortX: chunk.bottomPortX,
    difficulty: chunk.difficulty,
    route: chunk.safeRoute,
    tiles: chunk.tiles.map((row) => row.map(({ kind, strangeEffect, variant }) => [kind, strangeEffect, variant])),
  }));
}

describe("Dungeon", () => {
  it("reproduces seeded chunks with a non-lethal route and continuous boundary ports", () => {
    const run = new ClassicalCorrelatedRunGenerator().generate(90_210);
    const first = new Dungeon(run);
    const replay = new Dungeon(run);
    first.ensureAround(0);
    replay.ensureAround(0);

    expect(chunkFingerprint(replay)).toEqual(chunkFingerprint(first));
    const chunks = first.getChunks();
    expect(chunks).toHaveLength(TUNING.chunksAhead + TUNING.chunksBehind + 1);
    for (const [index, chunk] of chunks.entries()) {
      expect(chunk.safeRoute.length).toBeGreaterThanOrEqual(TUNING.chunkHeight);
      expect(first.safeRouteExists(chunk.index)).toBe(true);
      expect(chunk.safeRoute).toContainEqual({
        x: chunk.bottomPortX,
        y: (chunk.index + 1) * TUNING.chunkHeight - 1,
      });
      expect(chunk.safeRoute).toContainEqual({ x: chunk.topPortX, y: chunk.index * TUNING.chunkHeight });
      for (const point of chunk.safeRoute) {
        expect(["wall", "pit", "damage"]).not.toContain(first.getTile(point)?.kind);
      }
      const next = chunks[index + 1];
      if (next) expect(chunk.bottomPortX).toBe(next.topPortX);
    }
  });

  it("keeps a bounded moving chunk window and recycles chunks behind Q", () => {
    const run = new ClassicalCorrelatedRunGenerator().generate(77);
    const dungeon = new Dungeon(run);
    dungeon.ensureAround(0);
    const initial = dungeon.getChunkIndices();
    const currentIndex = -23;

    dungeon.ensureAround(currentIndex * TUNING.chunkHeight + 3);

    const expected = Array.from(
      { length: TUNING.chunksAhead + TUNING.chunksBehind + 1 },
      (_, offset) => currentIndex - TUNING.chunksAhead + offset,
    );
    expect(dungeon.getChunkIndices()).toEqual(expected);
    expect(dungeon.getChunkIndices()).toHaveLength(TUNING.chunksAhead + TUNING.chunksBehind + 1);
    expect(dungeon.getChunkIndices().some((index) => initial.includes(index))).toBe(false);
    for (const index of expected) expect(dungeon.safeRouteExists(index)).toBe(true);
  });

  it("keeps the first five forward rows free of lethal terrain", () => {
    const run = new ClassicalCorrelatedRunGenerator().generate(77);
    const dungeon = new Dungeon(run);
    const start = dungeon.getStart();
    dungeon.ensureAround(start.y);

    for (let y = start.y - 5; y <= start.y; y += 1) {
      for (let x = 0; x < TUNING.chunkWidth; x += 1) {
        expect(["pit", "damage"]).not.toContain(dungeon.getTile({ x, y })?.kind);
      }
    }
  });
});
