import { TUNING } from "../config/tuning";
import { Dungeon } from "./Dungeon";
import type { PerceptionResult } from "./Perception";
import { clamp01, createRng, mixSeed, randomBetween } from "./rng";
import {
  DIRECTION_VECTORS,
  manhattan,
  pointKey,
  type CandidateTrace,
  type Direction,
  type IntentionType,
  type Point,
  type QState,
  type RunConfiguration,
  type TimedWorldObject,
} from "./types";

export interface DecisionInput {
  run: RunConfiguration;
  q: QState;
  dungeon: Dungeon;
  perception: PerceptionResult;
  visited: ReadonlyMap<string, number>;
  obstructions: readonly TimedWorldObject[];
  callStrength: number;
  trigger: string;
}

export interface DecisionResult {
  candidate: CandidateTrace;
  traces: CandidateTrace[];
  commitment: number;
  pause: number;
}

function opposite(direction: Direction): Direction {
  if (direction === "north") return "south";
  if (direction === "south") return "north";
  if (direction === "east") return "west";
  return "east";
}

function modifierStrength(q: QState, type: QState["modifiers"][number]["type"]): number {
  const modifier = q.modifiers.find((candidate) => candidate.type === type);
  if (!modifier) return 0;
  const duration = type === "care" ? TUNING.careDurationSeconds : TUNING.strangeDurationSeconds;
  return clamp01(modifier.remaining / duration);
}

function nearestDistance(point: Point, targets: readonly Point[]): number {
  return targets.reduce((best, target) => Math.min(best, manhattan(point, target)), Number.POSITIVE_INFINITY);
}

function pathForFirstStep(perception: PerceptionResult, target: Point, firstStep: Point): Point[] {
  const path = perception.pathByKey.get(pointKey(target)) ?? [];
  return path[0] && pointKey(path[0]) === pointKey(firstStep) ? path : [];
}

function firstMatchingTarget<T extends Point>(
  values: readonly T[],
  perception: PerceptionResult,
  firstStep: Point,
): { target: T; path: Point[] } | null {
  for (const target of values) {
    const path = pathForFirstStep(perception, target, firstStep);
    if (path.length > 0) return { target, path };
  }
  return null;
}

export function decideBehavior(input: DecisionInput): DecisionResult {
  const { run, q, dungeon, perception, visited, callStrength } = input;
  const blocked = new Set(input.obstructions.map(pointKey));
  const care = modifierStrength(q, "care");
  const frenzy = modifierStrength(q, "frenzy");
  const calm = modifierStrength(q, "calm");
  const fascination = modifierStrength(q, "fascination");
  const reverse = modifierStrength(q, "reverse");
  const defiance = modifierStrength(q, "defiance");
  const effectiveCuriosity = clamp01(run.traits.curiosity + fascination * 0.48);
  const effectiveCaution = clamp01(run.traits.caution + calm * 0.42);
  const effectiveCompliance = clamp01(run.traits.compliance + care * 0.2 - defiance * 0.7);
  const effectiveCall = callStrength * effectiveCompliance;
  const appetite = clamp01((q.hunger - 0.25) * 1.35 + run.traits.hunger * 0.45);
  const jitterScale = Math.max(0.6, 2.4 + frenzy * 5 - care * 1.6 - calm * 1.1);
  const obstructionKeys = blocked;
  const neighbors = dungeon.neighbors(q.tile).filter((candidate) => !obstructionKeys.has(pointKey(candidate)));
  const candidates: CandidateTrace[] = [];
  const currentHazardDistance = nearestDistance(q.tile, perception.hazards);

  for (const neighbor of [...neighbors].sort((a, b) => a.direction.localeCompare(b.direction))) {
    const components: Record<string, number> = {};
    const visitCount = visited.get(pointKey(neighbor)) ?? 0;
    const headingMomentum = neighbor.direction === q.direction ? 10 : neighbor.direction === opposite(q.direction) ? -3 : 0;
    components.momentum = headingMomentum;
    const inertiaScale = Math.max(0, 1 - effectiveCall * 0.88 - frenzy * 0.72);
    components.inertia = neighbor.direction === q.direction
      ? (8 + Math.min(10, q.commitmentRemaining * 4)) * inertiaScale
      : effectiveCall > 0 ? effectiveCall * 5 : 0;
    components.forward = neighbor.direction === "north"
      ? 7 * run.world.forwardPull
      : neighbor.direction === "south" ? -3.5 * run.world.forwardPull : 0;

    let frontier = 0;
    for (const vector of Object.values(DIRECTION_VECTORS)) {
      const adjacent = { x: neighbor.x + vector.x, y: neighbor.y + vector.y };
      if (dungeon.isWalkable(adjacent) && !visited.has(pointKey(adjacent))) frontier += 1;
    }
    components.novelty = effectiveCuriosity * (visitCount === 0 ? 9 + frontier * 2.2 : 0);
    components.revisit = -Math.min(8, visitCount * 2.7);

    const hazardDistance = nearestDistance(neighbor, perception.hazards);
    const exposure = hazardDistance === 0 ? 1 : Math.max(0, (3.5 - hazardDistance) / 3.5);
    components.hazard = -(5 + 38 * effectiveCaution) * exposure;
    if (Number.isFinite(currentHazardDistance) && hazardDistance > currentHazardDistance) {
      components.escape = effectiveCaution * Math.min(8, (hazardDistance - currentHazardDistance) * 3.2);
    }

    const foodMatch = firstMatchingTarget(perception.food, perception, neighbor);
    if (foodMatch) {
      const salience = (TUNING.perceptionRadius + 1 - foodMatch.target.distance) / TUNING.perceptionRadius;
      components.food = appetite * salience * (foodMatch.target.kind === "treat" ? 46 : 40);
    }
    const strangeMatch = firstMatchingTarget(perception.strange, perception, neighbor);
    if (strangeMatch) {
      const salience = (TUNING.perceptionRadius + 1 - strangeMatch.target.distance) / TUNING.perceptionRadius;
      components.strange = effectiveCuriosity * salience * (18 + fascination * 10);
    }
    if (neighbor.direction === opposite(q.direction)) components.reverse = reverse * 28;
    if (effectiveCall > 0 && neighbor.direction !== q.direction) components.callReconsider = effectiveCall * 7;

    const jitterRng = createRng(mixSeed(run.qSeed, q.decisionId, neighbor.direction, input.trigger));
    components.temperament = randomBetween(jitterRng, -jitterScale, jitterScale);
    const score = Object.values(components).reduce((total, component) => total + component, 0);
    const foodTarget = foodMatch?.target ?? null;
    const strangeTarget = strangeMatch?.target ?? null;
    let intention: IntentionType = neighbor.direction === q.direction ? "continue" : "explore";
    let target: Point | null = null;
    let path: Point[] = [neighbor];
    if ((components.food ?? 0) >= 8 && foodTarget) {
      intention = "seek-food";
      target = foodTarget;
      path = foodMatch?.path ?? path;
    } else if ((components.escape ?? 0) >= 2.5) {
      intention = "avoid-hazard";
    } else if ((components.strange ?? 0) >= 7 && strangeTarget) {
      intention = "investigate";
      target = strangeTarget;
      path = strangeMatch?.path ?? path;
    } else if (reverse > 0.1 && neighbor.direction === opposite(q.direction)) {
      intention = "reverse";
    } else if (effectiveCall > 0.15 && neighbor.direction !== q.direction) {
      intention = "answer-call";
    }
    candidates.push({
      key: `move-${neighbor.direction}`,
      direction: neighbor.direction,
      intention,
      target,
      path,
      score,
      weight: 0,
      selected: false,
      components,
    });
  }

  const nearestHazard = perception.hazards[0]?.distance ?? Number.POSITIVE_INFINITY;
  const hesitateComponents = {
    base: neighbors.length === 0 ? -5 : -15,
    caution: nearestHazard <= 2 ? effectiveCaution * 11 : 0,
    confusion: neighbors.length > 2 ? 2.5 : neighbors.length === 0 ? 20 : 0,
    recentPause: q.intention === "hesitate" && neighbors.length > 0 ? -24 : 0,
    temperament: randomBetween(createRng(mixSeed(run.qSeed, q.decisionId, "hesitate", input.trigger)), -jitterScale, jitterScale),
  };
  candidates.push({
    key: "hesitate",
    direction: null,
    intention: "hesitate",
    target: null,
    path: [],
    score: Object.values(hesitateComponents).reduce((total, value) => total + value, 0),
    weight: 0,
    selected: false,
    components: hesitateComponents,
  });

  const maximum = Math.max(...candidates.map(({ score }) => score));
  const temperature = 4.8 + frenzy * 4.5 - care * 1.4 - calm * 0.8;
  let weightTotal = 0;
  for (const candidate of candidates) {
    candidate.weight = Math.exp((candidate.score - maximum) / Math.max(2.6, temperature));
    weightTotal += candidate.weight;
  }
  for (const candidate of candidates) candidate.weight /= weightTotal;

  const incumbent = candidates.find(({ direction }) => direction === q.direction);
  const challenger = [...candidates].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))[0];
  const hazardEmergency = perception.hazards.some((hazard) => hazard.distance <= 1);
  const switchMargin = TUNING.intentionSwitchMargin * (1 - effectiveCall * 0.85 - frenzy * 0.65);
  let selected: CandidateTrace | undefined;
  if (
    incumbent
    && challenger
    && q.commitmentRemaining > 0
    && !hazardEmergency
    && challenger.score < incumbent.score + Math.max(0, switchMargin)
  ) {
    selected = incumbent;
  } else {
    let roll = createRng(mixSeed(run.qSeed, q.decisionId, "choice", input.trigger))();
    for (const candidate of [...candidates].sort((a, b) => a.key.localeCompare(b.key))) {
      roll -= candidate.weight;
      if (roll <= 0) {
        selected = candidate;
        break;
      }
    }
  }
  selected ??= challenger ?? candidates[0];
  if (!selected) throw new Error("Q could not form an intention.");
  if (selected.direction === null && q.intention === "hesitate" && neighbors.length > 0) {
    selected = [...candidates]
      .filter((candidate) => candidate.direction !== null)
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))[0] ?? selected;
  }
  selected.selected = true;
  const traces = [...candidates].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const commitmentRng = createRng(mixSeed(run.qSeed, q.decisionId, "commitment"));
  const commitment = randomBetween(commitmentRng, 0.85, TUNING.baseCommitmentSeconds)
    * (1 + care * 0.42 + calm * 0.3 - frenzy * 0.58);
  const pause = selected.direction === null
    ? randomBetween(createRng(mixSeed(run.qSeed, q.decisionId, "pause")), 0.28, 0.72)
    : 0;
  return { candidate: selected, traces, commitment, pause };
}
