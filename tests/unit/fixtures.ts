import { Dungeon } from "../../src/simulation/Dungeon";
import { perceive } from "../../src/simulation/Perception";
import { ClassicalCorrelatedRunGenerator } from "../../src/simulation/RunGenerator";
import type {
  CandidateTrace,
  Direction,
  Point,
  QState,
  QTraits,
  RunConfiguration,
  StrangeEffect,
  TileKind,
  WorldBiases,
} from "../../src/simulation/types";

const EMPTY_PERCEPTION = {
  visible: [],
  hazards: [],
  food: [],
  strange: [],
  stimuli: [],
};

export const ARENA_ORIGIN: Point = { x: 12, y: 9 };

export function makeRun(
  seed = 1_337,
  traits: Partial<QTraits> = {},
  world: Partial<WorldBiases> = {},
): RunConfiguration {
  const base = new ClassicalCorrelatedRunGenerator().generate(seed);
  return {
    ...base,
    traits: { ...base.traits, ...traits },
    world: { ...base.world, ...world },
  };
}

export function setTile(
  dungeon: Dungeon,
  point: Point,
  kind: TileKind,
  strangeEffect?: StrangeEffect,
): void {
  const tile = dungeon.getTile(point);
  if (!tile) throw new Error(`Test fixture could not access tile ${point.x},${point.y}.`);
  tile.kind = kind;
  if (kind === "strange" && strangeEffect) tile.strangeEffect = strangeEffect;
  else delete tile.strangeEffect;
}

export function makeArena(run: RunConfiguration, floors: readonly Point[]): Dungeon {
  const dungeon = new Dungeon(run);
  dungeon.ensureAround(ARENA_ORIGIN.y);
  for (let y = 1; y <= 17; y += 1) {
    for (let x = 2; x <= 22; x += 1) setTile(dungeon, { x, y }, "wall");
  }
  for (const floor of floors) setTile(dungeon, floor, "floor");
  return dungeon;
}

export function makeQState(
  overrides: Partial<QState> = {},
  origin: Point = ARENA_ORIGIN,
): QState {
  return {
    tile: { ...origin },
    position: { x: origin.x + 0.5, y: origin.y + 0.5 },
    direction: "north",
    from: { ...origin },
    to: null,
    moveProgress: 0,
    hunger: 0.2,
    intention: "continue",
    target: null,
    intendedPath: [],
    commitmentRemaining: 2,
    pauseRemaining: 0,
    presentation: "walking",
    presentationRemaining: 0,
    modifiers: [],
    decisionId: 4,
    candidateTraces: [],
    perception: { ...EMPTY_PERCEPTION },
    held: false,
    alive: true,
    ...overrides,
  };
}

export function perceiveArena(dungeon: Dungeon, q: QState) {
  return perceive(dungeon, q.tile, [], []);
}

export function traceForDirection(
  traces: readonly CandidateTrace[],
  direction: Direction,
): CandidateTrace {
  const trace = traces.find((candidate) => candidate.direction === direction);
  if (!trace) throw new Error(`Expected a ${direction} decision candidate.`);
  return trace;
}
