import { TUNING, type TunableAction } from "../config/tuning";
import { decideBehavior } from "./BehaviorSystem";
import { Dungeon } from "./Dungeon";
import { perceive } from "./Perception";
import { ClassicalCorrelatedRunGenerator } from "./RunGenerator";
import { clamp01 } from "./rng";
import {
  DIRECTION_VECTORS,
  manhattan,
  pointKey,
  samePoint,
  type ActiveModifier,
  type CallStimulus,
  type CooldownState,
  type DeathCause,
  type Direction,
  type GameEvent,
  type GameSnapshot,
  type PerceptionSnapshot,
  type Point,
  type QState,
  type RunConfiguration,
  type RunGenerator,
  type StrangeEffect,
  type TimedWorldObject,
} from "./types";

const EMPTY_PERCEPTION: PerceptionSnapshot = {
  visible: [],
  hazards: [],
  food: [],
  strange: [],
  stimuli: [],
};

export interface ActionResult {
  success: boolean;
  reason?: string;
}

function pointAfter(point: Point, direction: Direction): Point {
  const vector = DIRECTION_VECTORS[direction];
  return { x: point.x + vector.x, y: point.y + vector.y };
}

function directionBetween(a: Point, b: Point): Direction | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === -1) return "north";
  if (dx === 1 && dy === 0) return "east";
  if (dx === 0 && dy === 1) return "south";
  if (dx === -1 && dy === 0) return "west";
  return null;
}

function upsertModifier(modifiers: ActiveModifier[], type: ActiveModifier["type"], remaining: number): void {
  const existing = modifiers.find((modifier) => modifier.type === type);
  if (existing) existing.remaining = Math.max(existing.remaining, remaining);
  else modifiers.push({ type, remaining });
}

export class QGameSimulation {
  private readonly runGenerator: RunGenerator;
  private run!: RunConfiguration;
  private dungeon!: Dungeon;
  private q!: QState;
  private selectedAction: TunableAction = "place";
  private readonly cooldownRemaining: Record<TunableAction, number> = {
    place: 0,
    treat: 0,
    call: 0,
    care: 0,
    rescue: 0,
  };
  private obstructions: TimedWorldObject[] = [];
  private treats: TimedWorldObject[] = [];
  private call: CallStimulus | null = null;
  private visited = new Map<string, number>();
  private events: GameEvent[] = [];
  private elapsed = 0;
  private distance = 0;
  private forwardHighWaterY = 0;
  private death: { cause: DeathCause; distance: number } | null = null;
  private paused = false;
  private debugEnabled = false;
  private speed = 1;
  private accumulator = 0;
  private objectId = 0;
  private pendingDecision: string | null = "spawn";
  private stimulusSignature = "";
  private rescueOrigin: Point | null = null;

  constructor(seed: number, runGenerator: RunGenerator = new ClassicalCorrelatedRunGenerator()) {
    this.runGenerator = runGenerator;
    this.startRun(seed);
  }

  getDungeon(): Dungeon {
    return this.dungeon;
  }

  getSnapshot(): Readonly<GameSnapshot> {
    return {
      run: this.run,
      q: this.q,
      distance: this.distance,
      selectedAction: this.selectedAction,
      cooldowns: (Object.keys(this.cooldownRemaining) as TunableAction[]).map((action): CooldownState => ({
        action,
        remaining: this.cooldownRemaining[action],
        duration: TUNING.cooldowns[action],
      })),
      obstructions: this.obstructions,
      treats: this.treats,
      call: this.call,
      death: this.death,
      debug: {
        enabled: this.debugEnabled,
        paused: this.paused,
        speed: this.speed,
        dungeonVersion: this.dungeon.getVersion(),
        chunks: this.dungeon.getChunkIndices(),
      },
      elapsed: this.elapsed,
    };
  }

  update(frameSeconds: number): void {
    if (this.paused || this.death) return;
    this.accumulator += Math.min(TUNING.maxFrameSeconds, frameSeconds) * this.speed;
    while (this.accumulator >= TUNING.fixedStepSeconds) {
      this.fixedUpdate(TUNING.fixedStepSeconds);
      this.accumulator -= TUNING.fixedStepSeconds;
    }
  }

  selectAction(action: TunableAction): void {
    if (this.q.held && action !== "rescue") this.cancelRescue();
    this.selectedAction = action;
  }

  useSelected(point: Point, hitQ: boolean): ActionResult {
    if (this.death) return { success: false, reason: "Q is gone." };
    if (this.paused) return { success: false, reason: "The run is paused." };
    if (this.selectedAction !== "rescue" && this.cooldownRemaining[this.selectedAction] > 0) {
      return { success: false, reason: "That intervention is still returning." };
    }
    if (this.selectedAction === "place") return this.placeObstruction(point);
    if (this.selectedAction === "treat") return this.placeTreat(point);
    if (this.selectedAction === "call") return this.callQ(hitQ);
    if (this.selectedAction === "care") return this.careForQ(hitQ);
    return this.rescue(point, hitQ);
  }

  getActionValidity(point: Point, hitQ: boolean): { valid: boolean; reason: string } {
    if (this.death || this.paused) return { valid: false, reason: this.death ? "Run ended" : "Paused" };
    if (this.selectedAction === "call" || this.selectedAction === "care") {
      return { valid: hitQ && this.cooldownRemaining[this.selectedAction] <= 0, reason: hitQ ? "Q" : "Click Q" };
    }
    if (this.selectedAction === "rescue") {
      if (this.cooldownRemaining.rescue > 0) return { valid: false, reason: "Rescue cooling down" };
      if (!this.q.held) return { valid: hitQ, reason: hitQ ? "Lift Q" : "Click Q to lift" };
      return { valid: this.validRescueDrop(point), reason: this.validRescueDrop(point) ? "Place Q" : "Too far or unsafe" };
    }
    const validFloor = this.isOpenOrdinaryFloor(point);
    return { valid: validFloor && this.cooldownRemaining[this.selectedAction] <= 0, reason: validFloor ? "Place" : "Ordinary floor only" };
  }

  restartSameSeed(): void {
    this.startRun(this.run.runSeed);
  }

  startNewRun(seed: number): void {
    this.startRun(seed);
  }

  togglePause(): void {
    if (!this.death) this.paused = !this.paused;
  }

  toggleDebug(): void {
    this.debugEnabled = !this.debugEnabled;
  }

  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  cycleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
  }

  setSpeed(speed: 1 | 2 | 4): void {
    this.speed = speed;
  }

  forceStrangeEffect(effect: StrangeEffect): void {
    if (this.death) return;
    this.applyStrangeEffect(effect);
  }

  cancelRescue(): void {
    if (!this.q.held) return;
    this.q.held = false;
    this.q.presentation = "confused";
    this.q.presentationRemaining = 0.5;
    this.q.pauseRemaining = 0.25;
    this.rescueOrigin = null;
    this.pendingDecision = "rescue-cancelled";
  }

  drainEvents(): GameEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  private startRun(seed: number): void {
    this.run = this.runGenerator.generate(seed);
    this.dungeon = new Dungeon(this.run);
    const start = this.dungeon.getStart();
    this.dungeon.ensureAround(start.y);
    this.q = {
      tile: { ...start },
      position: { x: start.x + 0.5, y: start.y + 0.5 },
      direction: "north",
      from: { ...start },
      to: null,
      moveProgress: 0,
      hunger: clamp01(0.16 + this.run.traits.hunger * 0.24),
      intention: "hesitate",
      target: null,
      intendedPath: [],
      commitmentRemaining: 0,
      pauseRemaining: 0.34,
      presentation: "idle",
      presentationRemaining: 0,
      modifiers: [],
      decisionId: 0,
      candidateTraces: [],
      perception: { ...EMPTY_PERCEPTION },
      held: false,
      alive: true,
    };
    this.selectedAction = "place";
    for (const action of Object.keys(this.cooldownRemaining) as TunableAction[]) this.cooldownRemaining[action] = 0;
    this.obstructions = [];
    this.treats = [];
    this.call = null;
    this.visited = new Map([[pointKey(start), 1]]);
    this.events = [];
    this.elapsed = 0;
    this.distance = 0;
    this.forwardHighWaterY = start.y;
    this.death = null;
    this.paused = false;
    this.speed = 1;
    this.accumulator = 0;
    this.objectId = 0;
    this.pendingDecision = "spawn";
    this.stimulusSignature = "";
    this.rescueOrigin = null;
  }

  private fixedUpdate(dt: number): void {
    this.elapsed += dt;
    for (const action of Object.keys(this.cooldownRemaining) as TunableAction[]) {
      this.cooldownRemaining[action] = Math.max(0, this.cooldownRemaining[action] - dt);
    }
    this.obstructions = this.obstructions
      .map((obstruction) => ({ ...obstruction, remaining: obstruction.remaining - dt }))
      .filter(({ remaining }) => remaining > 0);
    this.treats = this.treats
      .map((treat) => ({ ...treat, remaining: treat.remaining - dt }))
      .filter(({ remaining }) => remaining > 0);
    if (this.call) {
      this.call.remaining -= dt;
      if (this.call.remaining <= 0) this.call = null;
    }
    this.q.modifiers = this.q.modifiers
      .map((modifier) => ({ ...modifier, remaining: modifier.remaining - dt }))
      .filter(({ remaining }) => remaining > 0);
    this.q.presentationRemaining = Math.max(0, this.q.presentationRemaining - dt);
    this.q.commitmentRemaining = Math.max(0, this.q.commitmentRemaining - dt);
    const previousHunger = this.q.hunger;
    this.q.hunger = clamp01(this.q.hunger + dt * (TUNING.hungerPerSecond + this.run.traits.hunger * TUNING.hungerTraitRate));
    if (previousHunger < TUNING.hungryThreshold && this.q.hunger >= TUNING.hungryThreshold) {
      this.pendingDecision = "became-hungry";
    }

    if (this.q.held) return;
    if (this.q.pauseRemaining > 0) {
      this.q.pauseRemaining = Math.max(0, this.q.pauseRemaining - dt);
      if (this.q.pauseRemaining === 0 && !this.q.to) this.pendingDecision ??= "pause-complete";
      this.updatePresentation();
      return;
    }
    if (this.pendingDecision && !this.q.to) {
      const trigger = this.pendingDecision;
      this.pendingDecision = null;
      this.decide(trigger);
      this.updatePresentation();
      return;
    }
    if (!this.q.to) {
      this.continueOrDecide("step-ready");
      this.updatePresentation();
      return;
    }

    if (this.isBlocked(this.q.to)) {
      this.q.to = null;
      this.q.position = { x: this.q.tile.x + 0.5, y: this.q.tile.y + 0.5 };
      this.pendingDecision = "path-blocked";
      this.updatePresentation();
      return;
    }

    this.q.moveProgress = Math.min(1, this.q.moveProgress + dt * TUNING.qSpeedTilesPerSecond);
    const eased = this.q.moveProgress;
    this.q.position = {
      x: this.q.from.x + 0.5 + (this.q.to.x - this.q.from.x) * eased,
      y: this.q.from.y + 0.5 + (this.q.to.y - this.q.from.y) * eased,
    };
    if (this.q.moveProgress >= 1) this.arriveAtTile();
    this.updatePresentation();
  }

  private arriveAtTile(): void {
    const destination = this.q.to;
    if (!destination) return;
    this.q.tile = { ...destination };
    this.q.from = { ...destination };
    this.q.to = null;
    this.q.moveProgress = 0;
    this.q.position = { x: destination.x + 0.5, y: destination.y + 0.5 };
    if (samePoint(this.q.intendedPath[0] ?? null, destination)) this.q.intendedPath.shift();
    this.visited.set(pointKey(destination), (this.visited.get(pointKey(destination)) ?? 0) + 1);
    this.dungeon.ensureAround(destination.y);

    const tile = this.dungeon.getTile(destination);
    if (tile?.kind === "pit") {
      this.kill("PIT");
      return;
    }
    if (tile?.kind === "damage") {
      this.kill("BURNING GROUND");
      return;
    }

    const treatIndex = this.treats.findIndex((treat) => samePoint(treat, destination));
    if (treatIndex >= 0) {
      this.treats.splice(treatIndex, 1);
      this.q.hunger = clamp01(this.q.hunger - TUNING.treatRelief);
      this.q.presentation = "excited";
      this.q.presentationRemaining = 0.7;
      this.events.push({ type: "eat", at: { ...destination }, label: "treat" });
      this.pendingDecision = "ate-treat";
    } else if (tile?.kind === "food") {
      this.q.hunger = clamp01(this.q.hunger - TUNING.naturalFoodRelief);
      this.dungeon.consume(destination);
      this.q.presentation = "excited";
      this.q.presentationRemaining = 0.65;
      this.events.push({ type: "eat", at: { ...destination }, label: "food" });
      this.pendingDecision = "ate-food";
    } else if (tile?.kind === "strange" && tile.strangeEffect) {
      const effect = tile.strangeEffect;
      this.dungeon.consume(destination);
      this.applyStrangeEffect(effect);
    }

    if (destination.y < this.forwardHighWaterY) {
      this.distance += this.forwardHighWaterY - destination.y;
      this.forwardHighWaterY = destination.y;
    }
    if (samePoint(this.q.target, destination)) this.pendingDecision ??= "target-reached";
    this.continueOrDecide("tile-arrival");
  }

  private continueOrDecide(trigger: string): void {
    if (this.death || this.q.held || this.q.to || this.q.pauseRemaining > 0) return;
    const perception = perceive(this.dungeon, this.q.tile, this.obstructions, this.treats);
    this.q.perception = perception;
    const signature = [
      ...perception.hazards.filter(({ distance }) => distance <= 3).map((hazard) => `h:${pointKey(hazard)}`),
      ...perception.food.filter(({ distance }) => distance <= 5).map((food) => `f:${pointKey(food)}`),
      ...perception.strange.filter(({ distance }) => distance <= 4).map((strange) => `s:${pointKey(strange)}`),
    ].sort().join("|");
    const changedStimuli = signature !== this.stimulusSignature;
    this.stimulusSignature = signature;
    const exits = this.availableNeighbors(this.q.tile);
    const activePathNext = this.q.intendedPath[0];
    const pathDirection = activePathNext ? directionBetween(this.q.tile, activePathNext) : null;
    const forward = pointAfter(this.q.tile, this.q.direction);
    const canContinue = !this.isBlocked(forward);
    const meaningful = this.pendingDecision
      || changedStimuli
      || exits.length !== 2
      || this.q.commitmentRemaining <= 0
      || !canContinue
      || (activePathNext && !pathDirection);
    if (meaningful) {
      this.pendingDecision = null;
      this.decide(changedStimuli ? "new-stimulus" : trigger);
      return;
    }
    if (pathDirection && activePathNext && !this.isBlocked(activePathNext)) this.startMovement(pathDirection);
    else this.startMovement(this.q.direction);
  }

  private decide(trigger: string): void {
    const perception = perceive(this.dungeon, this.q.tile, this.obstructions, this.treats);
    this.q.perception = perception;
    this.q.decisionId += 1;
    const result = decideBehavior({
      run: this.run,
      q: this.q,
      dungeon: this.dungeon,
      perception,
      visited: this.visited,
      obstructions: this.obstructions,
      callStrength: this.call?.strength ?? 0,
      trigger,
    });
    this.q.candidateTraces = result.traces;
    this.q.intention = result.candidate.intention;
    this.q.target = result.candidate.target ? { ...result.candidate.target } : null;
    this.q.intendedPath = result.candidate.path.map((point) => ({ ...point }));
    this.q.commitmentRemaining = Math.max(0, result.commitment);
    this.events.push({ type: "decision", at: { ...this.q.tile }, label: this.q.intention });
    if (result.candidate.direction) {
      this.q.direction = result.candidate.direction;
      this.startMovement(result.candidate.direction);
    } else {
      this.q.pauseRemaining = result.pause;
      this.q.presentation = "confused";
      this.q.presentationRemaining = result.pause;
    }
  }

  private startMovement(direction: Direction): void {
    const destination = pointAfter(this.q.tile, direction);
    if (this.isBlocked(destination)) {
      this.pendingDecision = "movement-blocked";
      return;
    }
    this.q.direction = direction;
    this.q.from = { ...this.q.tile };
    this.q.to = destination;
    this.q.moveProgress = 0;
  }

  private updatePresentation(): void {
    if (!this.q.alive) {
      this.q.presentation = "dead";
      return;
    }
    if (this.q.held) {
      this.q.presentation = "picked-up";
      return;
    }
    if (this.q.presentationRemaining > 0) return;
    if (this.q.pauseRemaining > 0 || this.q.intention === "hesitate") {
      this.q.presentation = "confused";
      return;
    }
    if (this.q.intention === "seek-food" || this.q.intention === "investigate") {
      this.q.presentation = "excited";
      return;
    }
    if (this.q.intention === "avoid-hazard") {
      this.q.presentation = "frightened";
      return;
    }
    if (this.q.hunger >= TUNING.hungryThreshold) {
      this.q.presentation = "hungry";
      return;
    }
    this.q.presentation = this.q.to ? "walking" : "idle";
  }

  private availableNeighbors(point: Point): Point[] {
    return this.dungeon.neighbors(point).filter((candidate) => !this.isBlocked(candidate));
  }

  private isBlocked(point: Point): boolean {
    return !this.dungeon.isWalkable(point) || this.obstructions.some((obstruction) => samePoint(obstruction, point));
  }

  private isOpenOrdinaryFloor(point: Point): boolean {
    const tile = this.dungeon.getTile(point);
    return Boolean(
      tile?.kind === "floor"
      && !samePoint(this.q.tile, point)
      && !this.obstructions.some((obstruction) => samePoint(obstruction, point))
      && !this.treats.some((treat) => samePoint(treat, point)),
    );
  }

  private placeObstruction(point: Point): ActionResult {
    if (!this.isOpenOrdinaryFloor(point)) return { success: false, reason: "Choose an empty ordinary floor tile." };
    this.obstructions.push({ ...point, id: `rock-${++this.objectId}`, remaining: TUNING.obstructionDurationSeconds });
    this.cooldownRemaining.place = TUNING.cooldowns.place;
    this.events.push({ type: "place", at: { ...point }, label: "rock" });
    if (this.q.to && samePoint(this.q.to, point)) {
      this.q.to = null;
      this.q.position = { x: this.q.tile.x + 0.5, y: this.q.tile.y + 0.5 };
      this.pendingDecision = "place-blocked-path";
    }
    return { success: true };
  }

  private placeTreat(point: Point): ActionResult {
    if (!this.isOpenOrdinaryFloor(point)) return { success: false, reason: "Choose an empty ordinary floor tile." };
    this.treats.push({ ...point, id: `treat-${++this.objectId}`, remaining: TUNING.treatDurationSeconds });
    this.cooldownRemaining.treat = TUNING.cooldowns.treat;
    this.events.push({ type: "place", at: { ...point }, label: "treat" });
    this.pendingDecision = "treat-placed";
    return { success: true };
  }

  private callQ(hitQ: boolean): ActionResult {
    if (!hitQ) return { success: false, reason: "CALL must be used on Q." };
    const careBonus = this.q.modifiers.some(({ type }) => type === "care") ? 0.16 : 0;
    const defiancePenalty = this.q.modifiers.some(({ type }) => type === "defiance") ? 0.45 : 0;
    const strength = clamp01(0.1 + this.run.traits.compliance * 0.75 + careBonus - defiancePenalty);
    this.call = {
      x: this.q.tile.x,
      y: this.q.tile.y,
      remaining: TUNING.callDurationSeconds,
      acknowledged: true,
      strength,
    };
    this.cooldownRemaining.call = TUNING.cooldowns.call;
    this.q.presentation = "called";
    this.q.presentationRemaining = 0.55;
    this.pendingDecision = "call";
    this.events.push({ type: "call", at: { ...this.q.tile }, label: strength > 0.62 ? "listened" : "acknowledged" });
    return { success: true };
  }

  private careForQ(hitQ: boolean): ActionResult {
    if (!hitQ) return { success: false, reason: "CARE must be used on Q." };
    upsertModifier(this.q.modifiers, "care", TUNING.careDurationSeconds);
    this.q.pauseRemaining = Math.max(this.q.pauseRemaining, TUNING.carePauseSeconds);
    this.q.presentation = "patted";
    this.q.presentationRemaining = TUNING.carePauseSeconds;
    this.cooldownRemaining.care = TUNING.cooldowns.care;
    this.events.push({ type: "care", at: { ...this.q.tile }, label: "purr" });
    return { success: true };
  }

  private rescue(point: Point, hitQ: boolean): ActionResult {
    if (this.cooldownRemaining.rescue > 0) return { success: false, reason: "RESCUE is still returning." };
    if (!this.q.held) {
      if (!hitQ) return { success: false, reason: "Click Q to lift it." };
      this.q.held = true;
      this.q.to = null;
      this.q.position = { x: this.q.tile.x + 0.5, y: this.q.tile.y + 0.5 };
      this.q.intendedPath = [];
      this.rescueOrigin = { ...this.q.tile };
      this.q.presentation = "picked-up";
      this.events.push({ type: "rescue-up", at: { ...this.q.tile } });
      return { success: true };
    }
    if (!this.validRescueDrop(point)) return { success: false, reason: "Place Q on safe floor within the rescue ring." };
    this.q.tile = { ...point };
    this.q.from = { ...point };
    this.q.position = { x: point.x + 0.5, y: point.y + 0.5 };
    this.q.held = false;
    this.q.target = null;
    this.q.intendedPath = [];
    this.q.commitmentRemaining = 0;
    this.q.pauseRemaining = 0.32;
    this.q.presentation = "confused";
    this.q.presentationRemaining = 0.45;
    this.forwardHighWaterY = Math.min(this.forwardHighWaterY, point.y);
    this.dungeon.ensureAround(point.y);
    this.cooldownRemaining.rescue = TUNING.cooldowns.rescue;
    this.rescueOrigin = null;
    this.pendingDecision = "rescue-landing";
    this.events.push({ type: "rescue-down", at: { ...point } });
    return { success: true };
  }

  private validRescueDrop(point: Point): boolean {
    const origin = this.rescueOrigin;
    if (!origin || manhattan(origin, point) > TUNING.rescueRadiusTiles) return false;
    return this.isOpenOrdinaryFloor(point);
  }

  private applyStrangeEffect(effect: StrangeEffect): void {
    if (effect === "hunger") this.q.hunger = clamp01(this.q.hunger + 0.48);
    else upsertModifier(this.q.modifiers, effect, TUNING.strangeDurationSeconds);
    this.q.commitmentRemaining = 0;
    this.q.presentation = effect === "calm" ? "idle" : effect === "hunger" ? "hungry" : "confused";
    this.q.presentationRemaining = 0.7;
    this.pendingDecision = `strange-${effect}`;
    this.events.push({ type: "strange", at: { ...this.q.tile }, label: effect });
  }

  private kill(cause: DeathCause): void {
    this.q.alive = false;
    this.q.to = null;
    this.q.presentation = "dead";
    this.death = { cause, distance: this.distance };
    this.events.push({ type: "death", at: { ...this.q.tile }, label: cause });
  }
}
