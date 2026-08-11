import { describe, expect, it } from "vitest";

import { TUNING } from "../../src/config/tuning";
import { decideBehavior } from "../../src/simulation/BehaviorSystem";
import { perceive } from "../../src/simulation/Perception";
import { pointKey, type ActiveModifier, type Direction, type Point, type QState } from "../../src/simulation/types";
import {
  ARENA_ORIGIN,
  makeArena,
  makeQState,
  makeRun,
  perceiveArena,
  setTile,
  traceForDirection,
} from "./fixtures";

const CROSS: readonly Point[] = [
  ARENA_ORIGIN,
  { x: 12, y: 8 },
  { x: 12, y: 7 },
  { x: 12, y: 6 },
  { x: 13, y: 9 },
  { x: 14, y: 9 },
  { x: 11, y: 9 },
  { x: 10, y: 9 },
  { x: 12, y: 10 },
  { x: 12, y: 11 },
];

function decide(
  q: QState,
  traits: Parameters<typeof makeRun>[1] = {},
  modifiers: readonly ActiveModifier[] = [],
  callStrength = 0,
) {
  const run = makeRun(42_424, traits, { forwardPull: 0 });
  const dungeon = makeArena(run, CROSS);
  setTile(dungeon, { x: 14, y: 9 }, "pit");
  setTile(dungeon, { x: 12, y: 6 }, "food");
  const state = { ...q, modifiers: [...modifiers] };
  const perception = perceiveArena(dungeon, state);
  const visited = new Map<string, number>([[pointKey(state.tile), 1]]);
  return decideBehavior({
    run,
    q: state,
    dungeon,
    perception,
    visited,
    obstructions: [],
    callStrength,
    trigger: "unit-test",
  });
}

function component(result: ReturnType<typeof decide>, direction: Direction, key: string): number {
  return traceForDirection(result.traces, direction).components[key] ?? 0;
}

describe("perception", () => {
  it("sees only locally reachable stimuli within the configured radius", () => {
    const run = makeRun();
    const corridor = Array.from({ length: TUNING.perceptionRadius + 2 }, (_, offset) => ({
      x: ARENA_ORIGIN.x + offset,
      y: ARENA_ORIGIN.y,
    }));
    const dungeon = makeArena(run, corridor);
    const atLimit = { x: ARENA_ORIGIN.x + TUNING.perceptionRadius, y: ARENA_ORIGIN.y };
    const beyondLimit = { x: atLimit.x + 1, y: atLimit.y };
    setTile(dungeon, atLimit, "food");
    setTile(dungeon, beyondLimit, "strange", "fascination");

    const visible = perceive(dungeon, ARENA_ORIGIN, [], []);

    expect(visible.food).toContainEqual({ ...atLimit, kind: "food", distance: TUNING.perceptionRadius });
    expect(visible.strange).toEqual([]);
    expect(visible.visible).not.toContainEqual(beyondLimit);
    expect(Math.max(...visible.distanceByKey.values())).toBe(TUNING.perceptionRadius);

    const obstruction = { x: ARENA_ORIGIN.x + 3, y: ARENA_ORIGIN.y, id: "rock", remaining: 1 };
    const occluded = perceive(dungeon, ARENA_ORIGIN, [obstruction], [{ ...atLimit, id: "treat", remaining: 1 }]);
    expect(occluded.food).toEqual([]);
    expect(occluded.distanceByKey.has(pointKey(atLimit))).toBe(false);
  });
});

describe("utility behavior", () => {
  it("uses curiosity, caution, hunger, and compliance in decision scores", () => {
    const q = makeQState({ hunger: 0.82, commitmentRemaining: 2 });
    const lowCuriosity = decide(q, { curiosity: 0, caution: 0, hunger: 0, compliance: 0 });
    const highCuriosity = decide(q, { curiosity: 1, caution: 0, hunger: 0, compliance: 0 });
    expect(component(highCuriosity, "west", "novelty")).toBeGreaterThan(component(lowCuriosity, "west", "novelty"));

    const lowCaution = decide(q, { curiosity: 0, caution: 0, hunger: 0, compliance: 0 });
    const highCaution = decide(q, { curiosity: 0, caution: 1, hunger: 0, compliance: 0 });
    expect(component(highCaution, "east", "hazard")).toBeLessThan(component(lowCaution, "east", "hazard"));

    const lowHunger = decide({ ...q, hunger: 0.1 }, { curiosity: 0, caution: 0, hunger: 0, compliance: 0 });
    const highHunger = decide({ ...q, hunger: 1 }, { curiosity: 0, caution: 0, hunger: 1, compliance: 0 });
    expect(component(highHunger, "north", "food")).toBeGreaterThan(component(lowHunger, "north", "food"));

    const lowCompliance = decide(q, { curiosity: 0, caution: 0, hunger: 0, compliance: 0 }, [], 1);
    const highCompliance = decide(q, { curiosity: 0, caution: 0, hunger: 0, compliance: 1 }, [], 1);
    expect(component(highCompliance, "east", "callReconsider")).toBeGreaterThan(
      component(lowCompliance, "east", "callReconsider"),
    );
    expect(component(highCompliance, "north", "inertia")).toBeLessThan(component(lowCompliance, "north", "inertia"));
  });

  it("preserves a committed heading when no sufficiently strong stimulus wins", () => {
    const run = makeRun(99, { curiosity: 0, caution: 0, hunger: 0, compliance: 0 }, { forwardPull: 0 });
    const dungeon = makeArena(run, CROSS.map((point) => ({ ...point })));
    const q = makeQState({ direction: "north", commitmentRemaining: 2.2, hunger: 0 });
    const perception = perceiveArena(dungeon, q);
    const visited = new Map(perception.visible.map((point) => [pointKey(point), 1]));

    const result = decideBehavior({
      run,
      q,
      dungeon,
      perception,
      visited,
      obstructions: [],
      callStrength: 0,
      trigger: "inertia-test",
    });

    expect(result.candidate.direction).toBe("north");
    expect(result.candidate.intention).toBe("continue");
    expect(component(result, "north", "inertia")).toBeGreaterThan(0);
    expect(result.commitment).toBeGreaterThan(0.8);
  });

  it("prefers an available revisited exit over repeatedly hesitating", () => {
    const run = makeRun(717, { curiosity: 0, caution: 0, hunger: 0, compliance: 0 }, { forwardPull: 0 });
    const corridor = [ARENA_ORIGIN, { x: 11, y: 9 }, { x: 10, y: 9 }];
    const dungeon = makeArena(run, corridor);
    const q = makeQState({ direction: "east", intention: "hesitate", commitmentRemaining: 0, hunger: 0 });
    const perception = perceiveArena(dungeon, q);
    const visited = new Map(perception.visible.map((point) => [pointKey(point), 5]));

    const result = decideBehavior({
      run,
      q,
      dungeon,
      perception,
      visited,
      obstructions: [],
      callStrength: 0,
      trigger: "revisited-dead-end",
    });
    const hesitate = result.traces.find(({ direction }) => direction === null);
    const bestMove = Math.max(...result.traces.filter(({ direction }) => direction !== null).map(({ score }) => score));

    expect(hesitate?.score).toBeLessThan(bestMove);
    expect(result.candidate.direction).not.toBeNull();
  });

  it("gives strange effects distinct, inspectable consequences", () => {
    const q = makeQState({ hunger: 0.3, commitmentRemaining: 2 });
    const duration = TUNING.strangeDurationSeconds;
    const base = decide(q, { curiosity: 0.1, caution: 0.1, hunger: 0.1, compliance: 1 }, [], 1);
    const reverse = decide(q, { curiosity: 0.1, caution: 0.1, hunger: 0.1, compliance: 1 }, [
      { type: "reverse", remaining: duration },
    ], 1);
    const frenzy = decide(q, { curiosity: 0.1, caution: 0.1, hunger: 0.1, compliance: 1 }, [
      { type: "frenzy", remaining: duration },
    ], 1);
    const fascination = decide(q, { curiosity: 0.1, caution: 0.1, hunger: 0.1, compliance: 1 }, [
      { type: "fascination", remaining: duration },
    ], 1);
    const calm = decide(q, { curiosity: 0.1, caution: 0.1, hunger: 0.1, compliance: 1 }, [
      { type: "calm", remaining: duration },
    ], 1);
    const defiance = decide(q, { curiosity: 0.1, caution: 0.1, hunger: 0.1, compliance: 1 }, [
      { type: "defiance", remaining: duration },
    ], 1);

    expect(component(reverse, "south", "reverse")).toBeGreaterThan(component(base, "south", "reverse"));
    expect(frenzy.commitment).toBeLessThan(base.commitment);
    expect(component(fascination, "west", "novelty")).toBeGreaterThan(component(base, "west", "novelty"));
    expect(component(calm, "east", "hazard")).toBeLessThan(component(base, "east", "hazard"));
    expect(component(defiance, "west", "callReconsider")).toBeLessThan(component(base, "west", "callReconsider"));
  });
});
