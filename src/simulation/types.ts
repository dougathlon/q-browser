import type { TunableAction } from "../config/tuning";

export type Direction = "north" | "east" | "south" | "west";
export type TileKind = "wall" | "floor" | "pit" | "damage" | "food" | "strange";
export type StrangeEffect = "reverse" | "frenzy" | "fascination" | "calm" | "hunger" | "defiance";
export type IntentionType =
  | "continue"
  | "explore"
  | "seek-food"
  | "avoid-hazard"
  | "answer-call"
  | "investigate"
  | "reverse"
  | "hesitate";
export type PresentationState =
  | "walking"
  | "idle"
  | "excited"
  | "frightened"
  | "hungry"
  | "confused"
  | "patted"
  | "called"
  | "picked-up"
  | "dead";
export type DeathCause = "PIT" | "BURNING GROUND";

export interface Point {
  x: number;
  y: number;
}

export interface Tile extends Point {
  kind: TileKind;
  strangeEffect?: StrangeEffect;
  variant: number;
}

export interface DungeonChunk {
  index: number;
  tiles: Tile[][];
  safeRoute: Point[];
  topPortX: number;
  bottomPortX: number;
  difficulty: number;
}

export interface QTraits {
  curiosity: number;
  caution: number;
  hunger: number;
  compliance: number;
}

export interface WorldBiases {
  strangeDensity: number;
  hazardDensity: number;
  foodAbundance: number;
  junctionDensity: number;
  forwardPull: number;
}

export interface QAppearance {
  body: number;
  belly: number;
  accent: number;
  earStyle: "ears" | "antennae" | "nubs";
  eyeSpacing: number;
}

export interface RunConfiguration {
  generator: "classical-correlated-v1";
  runSeed: number;
  qSeed: number;
  dungeonSeed: number;
  latent: {
    novelty: number;
    threat: number;
    scarcity: number;
    attunement: number;
  };
  traits: QTraits;
  world: WorldBiases;
  appearance: QAppearance;
}

export interface RunGenerator {
  generate(seed: number): RunConfiguration;
}

export interface ActiveModifier {
  type: StrangeEffect | "care";
  remaining: number;
}

export interface CandidateTrace {
  key: string;
  direction: Direction | null;
  intention: IntentionType;
  target: Point | null;
  path: Point[];
  score: number;
  weight: number;
  selected: boolean;
  components: Record<string, number>;
}

export interface PerceptionSnapshot {
  visible: Point[];
  hazards: Array<Point & { kind: "pit" | "damage"; distance: number }>;
  food: Array<Point & { kind: "food" | "treat"; distance: number }>;
  strange: Array<Point & { effect: StrangeEffect; distance: number }>;
  stimuli: string[];
}

export interface QState {
  tile: Point;
  position: Point;
  direction: Direction;
  from: Point;
  to: Point | null;
  moveProgress: number;
  hunger: number;
  intention: IntentionType;
  target: Point | null;
  intendedPath: Point[];
  commitmentRemaining: number;
  pauseRemaining: number;
  presentation: PresentationState;
  presentationRemaining: number;
  modifiers: ActiveModifier[];
  decisionId: number;
  candidateTraces: CandidateTrace[];
  perception: PerceptionSnapshot;
  held: boolean;
  alive: boolean;
}

export interface TimedWorldObject extends Point {
  id: string;
  remaining: number;
}

export interface CooldownState {
  action: TunableAction;
  remaining: number;
  duration: number;
}

export interface CallStimulus extends Point {
  remaining: number;
  acknowledged: boolean;
  strength: number;
}

export interface GameEvent {
  type: "decision" | "eat" | "call" | "care" | "rescue-up" | "rescue-down" | "strange" | "death" | "place";
  at: Point;
  label?: string;
}

export interface DebugSnapshot {
  enabled: boolean;
  paused: boolean;
  speed: number;
  dungeonVersion: number;
  chunks: number[];
}

export interface GameSnapshot {
  run: RunConfiguration;
  q: QState;
  distance: number;
  selectedAction: TunableAction;
  cooldowns: CooldownState[];
  obstructions: TimedWorldObject[];
  treats: TimedWorldObject[];
  call: CallStimulus | null;
  death: { cause: DeathCause; distance: number } | null;
  debug: DebugSnapshot;
  elapsed: number;
}

export const DIRECTIONS: readonly Direction[] = ["north", "east", "south", "west"];

export const DIRECTION_VECTORS: Readonly<Record<Direction, Point>> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

export function samePoint(a: Point | null, b: Point | null): boolean {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
