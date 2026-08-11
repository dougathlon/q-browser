import { describe, expect, it } from "vitest";

import { TUNING, type TunableAction } from "../../src/config/tuning";
import { QGameSimulation } from "../../src/simulation/QGameSimulation";
import type { GameSnapshot, Point, StrangeEffect } from "../../src/simulation/types";
import { setTile } from "./fixtures";

function advance(simulation: QGameSimulation, seconds: number, frameSeconds = 0.1): void {
  const wholeFrames = Math.floor(seconds / frameSeconds);
  for (let frame = 0; frame < wholeFrames; frame += 1) simulation.update(frameSeconds);
  const remainder = seconds - wholeFrames * frameSeconds;
  if (remainder > 1e-9) simulation.update(remainder);
}

function cooldown(snapshot: Readonly<GameSnapshot>, action: TunableAction): number {
  const state = snapshot.cooldowns.find((candidate) => candidate.action === action);
  if (!state) throw new Error(`Missing ${action} cooldown.`);
  return state.remaining;
}

function ordinaryFloor(simulation: QGameSimulation, offset: Point): Point {
  const origin = simulation.getSnapshot().q.tile;
  const point = { x: origin.x + offset.x, y: origin.y + offset.y };
  setTile(simulation.getDungeon(), point, "floor");
  return point;
}

function deterministicSnapshot(simulation: QGameSimulation): unknown {
  const snapshot = simulation.getSnapshot();
  return {
    run: snapshot.run,
    q: {
      tile: snapshot.q.tile,
      position: snapshot.q.position,
      direction: snapshot.q.direction,
      from: snapshot.q.from,
      to: snapshot.q.to,
      moveProgress: snapshot.q.moveProgress,
      hunger: snapshot.q.hunger,
      intention: snapshot.q.intention,
      target: snapshot.q.target,
      intendedPath: snapshot.q.intendedPath,
      commitmentRemaining: snapshot.q.commitmentRemaining,
      pauseRemaining: snapshot.q.pauseRemaining,
      modifiers: snapshot.q.modifiers,
      decisionId: snapshot.q.decisionId,
      alive: snapshot.q.alive,
    },
    distance: snapshot.distance,
    cooldowns: snapshot.cooldowns,
    obstructions: snapshot.obstructions,
    treats: snapshot.treats,
    call: snapshot.call,
    death: snapshot.death,
    elapsed: snapshot.elapsed,
    chunks: snapshot.debug.chunks,
  };
}

describe("QGameSimulation clock and scoring", () => {
  it("is deterministic across different render-frame partitions", () => {
    const oneStepFrames = new QGameSimulation(51_515);
    const twoStepFrames = new QGameSimulation(51_515);
    for (let frame = 0; frame < 360; frame += 1) oneStepFrames.update(TUNING.fixedStepSeconds);
    for (let frame = 0; frame < 180; frame += 1) twoStepFrames.update(TUNING.fixedStepSeconds * 2);

    expect(deterministicSnapshot(twoStepFrames)).toEqual(deterministicSnapshot(oneStepFrames));
  });

  it("does not award distance for paused time or confinement", () => {
    const paused = new QGameSimulation(808);
    const beforePause = paused.getSnapshot();
    paused.togglePause();
    advance(paused, 5);
    expect(paused.getSnapshot().distance).toBe(beforePause.distance);
    expect(paused.getSnapshot().elapsed).toBe(beforePause.elapsed);
    expect(paused.getSnapshot().q.hunger).toBe(beforePause.q.hunger);

    const trapped = new QGameSimulation(809);
    const origin = trapped.getSnapshot().q.tile;
    for (const offset of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
      setTile(trapped.getDungeon(), { x: origin.x + offset.x, y: origin.y + offset.y }, "wall");
    }
    advance(trapped, 8);
    expect(trapped.getSnapshot().elapsed).toBeGreaterThan(7.9);
    expect(trapped.getSnapshot().distance).toBe(0);
    expect(trapped.getSnapshot().q.tile).toEqual(origin);
    expect(trapped.getSnapshot().death).toBeNull();
  });

  it("freezes on lethal entry and restarts reproducibly with reset run state", () => {
    const simulation = new QGameSimulation(6_006);
    const originalRun = simulation.getSnapshot().run;
    let destination = simulation.getSnapshot().q.to;
    for (let step = 0; step < 120 && !destination; step += 1) {
      simulation.update(TUNING.fixedStepSeconds);
      destination = simulation.getSnapshot().q.to;
    }
    if (!destination) throw new Error("Q did not begin a testable movement within two simulation seconds.");
    setTile(simulation.getDungeon(), destination, "pit");

    advance(simulation, 1);

    expect(simulation.getSnapshot().death?.cause).toBe("PIT");
    expect(simulation.getSnapshot().q.alive).toBe(false);
    const deathElapsed = simulation.getSnapshot().elapsed;
    advance(simulation, 2);
    expect(simulation.getSnapshot().elapsed).toBe(deathElapsed);

    simulation.restartSameSeed();
    expect(simulation.getSnapshot().run).toEqual(originalRun);
    expect(simulation.getSnapshot()).toMatchObject({ distance: 0, elapsed: 0, death: null });
    expect(simulation.getSnapshot().q.alive).toBe(true);
    expect(simulation.getSnapshot().cooldowns.every(({ remaining }) => remaining === 0)).toBe(true);

    simulation.startNewRun(6_007);
    expect(simulation.getSnapshot().run.runSeed).toBe(6_007);
    expect(simulation.getSnapshot().run).not.toEqual(originalRun);
  });
});

describe("player interventions", () => {
  it("keeps PLACE, TREAT, CALL, and CARE mechanically distinct with independent cooldowns", () => {
    const simulation = new QGameSimulation(2_026);
    const rock = ordinaryFloor(simulation, { x: 1, y: 0 });
    const secondRock = ordinaryFloor(simulation, { x: 0, y: -1 });
    const treat = ordinaryFloor(simulation, { x: -1, y: 0 });
    const secondTreat = ordinaryFloor(simulation, { x: 0, y: 1 });

    simulation.selectAction("place");
    expect(simulation.useSelected(rock, false)).toEqual({ success: true });
    expect(simulation.getSnapshot().obstructions).toHaveLength(1);
    expect(simulation.getSnapshot().treats).toHaveLength(0);
    expect(cooldown(simulation.getSnapshot(), "place")).toBe(TUNING.cooldowns.place);
    expect(simulation.useSelected(secondRock, false).success).toBe(false);
    expect(simulation.getSnapshot().obstructions).toHaveLength(1);

    simulation.selectAction("treat");
    expect(simulation.useSelected(treat, false)).toEqual({ success: true });
    expect(simulation.getSnapshot().treats).toHaveLength(1);
    expect(cooldown(simulation.getSnapshot(), "treat")).toBe(TUNING.cooldowns.treat);
    expect(simulation.useSelected(secondTreat, false).success).toBe(false);
    expect(simulation.getSnapshot().treats).toHaveLength(1);

    simulation.selectAction("call");
    expect(simulation.useSelected(simulation.getSnapshot().q.tile, false).success).toBe(false);
    expect(cooldown(simulation.getSnapshot(), "call")).toBe(0);
    expect(simulation.useSelected(simulation.getSnapshot().q.tile, true)).toEqual({ success: true });
    expect(simulation.getSnapshot().call?.acknowledged).toBe(true);
    expect(cooldown(simulation.getSnapshot(), "call")).toBe(TUNING.cooldowns.call);

    simulation.selectAction("care");
    expect(simulation.useSelected(simulation.getSnapshot().q.tile, true)).toEqual({ success: true });
    expect(simulation.getSnapshot().q.modifiers).toContainEqual({
      type: "care",
      remaining: TUNING.careDurationSeconds,
    });
    expect(simulation.getSnapshot().q.presentation).toBe("patted");
    expect(simulation.getSnapshot().q.pauseRemaining).toBeGreaterThanOrEqual(TUNING.carePauseSeconds);
    expect(cooldown(simulation.getSnapshot(), "care")).toBe(TUNING.cooldowns.care);

    advance(simulation, 0.5);
    expect(cooldown(simulation.getSnapshot(), "place")).toBeLessThan(TUNING.cooldowns.place);
    expect(cooldown(simulation.getSnapshot(), "treat")).toBeLessThan(TUNING.cooldowns.treat);
    expect(cooldown(simulation.getSnapshot(), "call")).toBeLessThan(TUNING.cooldowns.call);
    expect(cooldown(simulation.getSnapshot(), "care")).toBeLessThan(TUNING.cooldowns.care);
  });

  it("makes RESCUE a two-stage bounded override whose displacement earns no distance", () => {
    const simulation = new QGameSimulation(4_004);
    const origin = { ...simulation.getSnapshot().q.tile };
    const validDrop = ordinaryFloor(simulation, { x: 0, y: -3 });
    const invalidDrop = ordinaryFloor(simulation, { x: 0, y: -5 });
    const distanceBefore = simulation.getSnapshot().distance;
    simulation.selectAction("rescue");

    expect(simulation.useSelected(origin, true)).toEqual({ success: true });
    expect(simulation.getSnapshot().q.held).toBe(true);
    expect(cooldown(simulation.getSnapshot(), "rescue")).toBe(0);
    expect(simulation.useSelected(invalidDrop, false).success).toBe(false);
    expect(simulation.getSnapshot().q.held).toBe(true);

    expect(simulation.useSelected(validDrop, false)).toEqual({ success: true });
    expect(simulation.getSnapshot().q.held).toBe(false);
    expect(simulation.getSnapshot().q.tile).toEqual(validDrop);
    expect(simulation.getSnapshot().distance).toBe(distanceBefore);
    expect(cooldown(simulation.getSnapshot(), "rescue")).toBe(TUNING.cooldowns.rescue);
    expect(simulation.drainEvents().map(({ type }) => type)).toEqual(["rescue-up", "rescue-down"]);
  });
});

describe("forced strange effects", () => {
  it.each<StrangeEffect>(["reverse", "frenzy", "fascination", "calm", "defiance"])(
    "applies and reports the timed %s modifier",
    (effect) => {
      const simulation = new QGameSimulation(7_070);
      simulation.forceStrangeEffect(effect);

      expect(simulation.getSnapshot().q.modifiers).toContainEqual({
        type: effect,
        remaining: TUNING.strangeDurationSeconds,
      });
      expect(simulation.getSnapshot().q.commitmentRemaining).toBe(0);
      expect(simulation.drainEvents()).toContainEqual({
        type: "strange",
        at: simulation.getSnapshot().q.tile,
        label: effect,
      });
    },
  );

  it("makes the hunger tile an immediate appetite change rather than a timed modifier", () => {
    const simulation = new QGameSimulation(7_071);
    const hungerBefore = simulation.getSnapshot().q.hunger;

    simulation.forceStrangeEffect("hunger");

    expect(simulation.getSnapshot().q.hunger).toBeCloseTo(Math.min(1, hungerBefore + 0.48));
    expect(simulation.getSnapshot().q.modifiers.some(({ type }) => type === "hunger")).toBe(false);
    expect(simulation.getSnapshot().q.presentation).toBe("hungry");
  });
});
