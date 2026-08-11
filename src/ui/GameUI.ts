import { TUNING, type TunableAction } from "../config/tuning";
import type { QGameSimulation } from "../simulation/QGameSimulation";
import type {
  CandidateTrace,
  GameSnapshot,
  Point,
  StrangeEffect,
} from "../simulation/types";

const ACTIONS: readonly TunableAction[] = ["place", "treat", "call", "care", "rescue"];

const ACTION_COPY: Readonly<Record<TunableAction, { glyph: string; tooltip: string }>> = {
  place: {
    glyph: "▰",
    tooltip: "Place a temporary rock pile on an empty floor tile.",
  },
  treat: {
    glyph: "◆",
    tooltip: "Leave food. Q may care more about it than your plan.",
  },
  call: {
    glyph: ")))",
    tooltip: "Call to Q and ask it to reconsider. Listening is not guaranteed.",
  },
  care: {
    glyph: "♡",
    tooltip: "Pat Q to steady it for a little while.",
  },
  rescue: {
    glyph: "↑",
    tooltip: "Lift Q, then place it on nearby safe floor. The cooldown is long.",
  },
};

const STRANGE_EFFECTS: readonly StrangeEffect[] = [
  "reverse",
  "frenzy",
  "fascination",
  "calm",
  "hunger",
  "defiance",
];

const FORCE_SHORTCUTS: Readonly<Record<string, StrangeEffect>> = {
  Digit1: "reverse",
  Digit2: "frenzy",
  Digit3: "fascination",
  Digit4: "calm",
  Digit5: "hunger",
  Digit6: "defiance",
};

function required<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Q UI is missing ${selector}.`);
  return element;
}

function formatPoint(point: Point | null): string {
  return point ? `${point.x}, ${point.y}` : "—";
}

function fixed(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function signed(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function randomSeed(previous?: number): number {
  const values = new Uint32Array(1);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(values);
  } else {
    values[0] = (Date.now() ^ Math.floor(performance.now() * 1_000)) >>> 0;
  }
  const candidate = values[0] ?? 0;
  return candidate === previous ? (candidate + 1) >>> 0 : candidate;
}

function hungerLabel(value: number): string {
  if (value >= TUNING.starvingThreshold) return "urgent";
  if (value >= TUNING.hungryThreshold) return "hungry";
  if (value >= TUNING.hungryThreshold * 0.62) return "peckish";
  return "settled";
}

function pathLabel(path: readonly Point[]): string {
  if (path.length === 0) return "—";
  const shown = path.slice(0, 9).map((point) => `${point.x},${point.y}`).join(" → ");
  return path.length > 9 ? `${shown} → +${path.length - 9}` : shown;
}

function componentLabel(candidate: CandidateTrace): string {
  return Object.entries(candidate.components)
    .filter(([, value]) => Math.abs(value) >= 0.01)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .map(([name, value]) => `${name} ${signed(value)}`)
    .join(" · ") || "no active components";
}

function candidateMarkup(candidate: CandidateTrace): string {
  return `
    <li class="q-candidate${candidate.selected ? " is-selected" : ""}">
      <span class="q-candidate__choice"><i aria-hidden="true"></i><b>${candidate.intention}</b><small>${candidate.direction ?? "pause"}</small></span>
      <span class="q-candidate__numbers"><b>${signed(candidate.score)}</b><small>${fixed(candidate.weight * 100, 1)}%</small></span>
      <span class="q-candidate__components">${componentLabel(candidate)}</span>
    </li>`;
}

function shellMarkup(): string {
  const actions = ACTIONS.map((action) => {
    const copy = ACTION_COPY[action];
    return `
      <button class="q-action" type="button" data-player-action="${action}" data-testid="action-${action}"
        title="${copy.tooltip}" aria-label="${action}. ${copy.tooltip}">
        <span class="q-action__cooldown" aria-hidden="true"></span>
        <kbd>${TUNING.actionKeys[action]}</kbd>
        <span class="q-action__glyph" aria-hidden="true">${copy.glyph}</span>
        <strong>${action}</strong>
        <output data-cooldown="${action}">READY</output>
      </button>`;
  }).join("");

  const forceButtons = STRANGE_EFFECTS.map((effect, index) => `
    <button type="button" data-command="force-strange" data-effect="${effect}" title="Force ${effect} on Q">
      <kbd>⇧${index + 1}</kbd>${effect}
    </button>`).join("");

  return `
    <main class="q-shell" data-debug="false" data-paused="false" data-dead="false">
      <div id="q-canvas" class="q-canvas" data-testid="q-canvas" aria-label="Q's cave"></div>

      <header class="q-distance" aria-label="Run score">
        <span>DISTANCE</span>
        <output data-ui="distance">0</output>
      </header>

      <nav class="q-actions" aria-label="Interventions">${actions}</nav>

      <section class="q-pause" data-ui="pause" aria-live="polite" hidden>
        <span>TIME HELD</span>
        <button type="button" data-command="pause">RESUME <kbd>P</kbd></button>
      </section>

      <section class="q-death" data-ui="death" role="dialog" aria-modal="true" aria-labelledby="q-death-title" hidden>
        <div class="q-death__card">
          <span class="q-death__sigil" aria-hidden="true">×</span>
          <p>Q IS GONE</p>
          <h1 id="q-death-title" data-ui="death-cause">THE CAVE TOOK Q</h1>
          <dl><div><dt>DISTANCE</dt><dd data-ui="death-distance">0</dd></div></dl>
          <button type="button" data-command="new-run" data-testid="restart">MEET A NEW Q <span>→</span></button>
          <small><kbd>N</kbd> NEW RUN · <kbd>R</kbd> REPLAY THIS SEED</small>
        </div>
      </section>

      <aside class="q-debug" data-ui="debug" aria-label="Q decision debugger" hidden>
        <header class="q-debug__header">
          <div><small>LOCAL SIMULATION</small><strong>Q DECISION SCOPE</strong></div>
          <button type="button" data-command="debug-toggle" aria-label="Close debug panel" title="Close debug panel">×</button>
        </header>

        <div class="q-debug__toolbar">
          <button type="button" data-command="pause"><span data-ui="debug-pause-label">PAUSE</span> <kbd>P</kbd></button>
          <button type="button" data-command="same-seed">RESTART <kbd>R</kbd></button>
          <button type="button" data-command="new-run">NEW Q <kbd>N</kbd></button>
          <button type="button" data-command="speed">SPEED <b data-ui="speed">1×</b></button>
        </div>

        <div class="q-debug__scroll">
          <section class="q-debug__section">
            <h2>HIDDEN TEMPERAMENT</h2>
            <dl class="q-debug__traits">
              <div><dt>curiosity</dt><dd data-debug-value="curiosity">—</dd></div>
              <div><dt>caution</dt><dd data-debug-value="caution">—</dd></div>
              <div><dt>hunger</dt><dd data-debug-value="hunger-trait">—</dd></div>
              <div><dt>compliance</dt><dd data-debug-value="compliance">—</dd></div>
            </dl>
          </section>

          <section class="q-debug__section">
            <h2>LIVE STATE <span data-debug-value="decision-id">D—</span></h2>
            <dl class="q-debug__state">
              <div><dt>intention</dt><dd data-debug-value="intention">—</dd></div>
              <div><dt>presentation</dt><dd data-debug-value="presentation">—</dd></div>
              <div><dt>hunger state</dt><dd data-debug-value="hunger-state">—</dd></div>
              <div><dt>commitment</dt><dd data-debug-value="commitment">—</dd></div>
              <div><dt>tile / heading</dt><dd data-debug-value="tile-heading">—</dd></div>
              <div><dt>target</dt><dd data-debug-value="target">—</dd></div>
              <div><dt>modifiers</dt><dd data-debug-value="modifiers">—</dd></div>
            </dl>
            <div class="q-debug__trace"><small>INTENDED PATH</small><code data-debug-value="path">—</code></div>
          </section>

          <section class="q-debug__section">
            <h2>CANDIDATE ACTIONS <span>SCORE / WEIGHT</span></h2>
            <ol class="q-candidates" data-debug-value="candidates"><li class="q-debug__empty">No decision yet.</li></ol>
          </section>

          <section class="q-debug__section">
            <h2>LOCAL PERCEPTION</h2>
            <div class="q-debug__trace"><small>HAZARDS</small><code data-debug-value="hazards">none perceived</code></div>
            <div class="q-debug__trace"><small>STIMULI</small><code data-debug-value="stimuli">none</code></div>
            <div class="q-debug__trace"><small>VISIBLE FOOD / STRANGE</small><code data-debug-value="perceived-objects">none</code></div>
          </section>

          <section class="q-debug__section">
            <h2>RUN CONFIGURATION</h2>
            <dl class="q-debug__state q-debug__state--seeds">
              <div><dt>generator</dt><dd data-debug-value="generator">—</dd></div>
              <div><dt>run seed</dt><dd><code data-debug-value="run-seed">—</code></dd></div>
              <div><dt>Q seed</dt><dd><code data-debug-value="q-seed">—</code></dd></div>
              <div><dt>dungeon seed</dt><dd><code data-debug-value="dungeon-seed">—</code></dd></div>
              <div><dt>appearance</dt><dd data-debug-value="appearance">—</dd></div>
            </dl>
            <button class="q-debug__copy" type="button" data-command="copy-seed">COPY RUN SEED</button>
            <div class="q-debug__trace"><small>LATENT</small><code data-debug-value="latent">—</code></div>
            <div class="q-debug__trace"><small>WORLD BIASES</small><code data-debug-value="world">—</code></div>
          </section>

          <section class="q-debug__section">
            <h2>GENERATED CHUNKS <span data-debug-value="dungeon-version">V—</span></h2>
            <div class="q-debug__trace"><small>INDEX [WORLD-Y BOUNDARY]</small><code data-debug-value="chunks">—</code></div>
          </section>

          <section class="q-debug__section">
            <h2>FORCE STRANGE EFFECT</h2>
            <div class="q-debug__force">${forceButtons}</div>
          </section>

          <section class="q-debug__section q-debug__legend">
            <h2>KEYBOARD</h2>
            <p><kbd>1–5</kbd> select intervention</p>
            <p><kbd>D / F3</kbd> debug overlay</p>
            <p><kbd>P</kbd> pause / unpause</p>
            <p><kbd>R</kbd> restart same seed</p>
            <p><kbd>N</kbd> new random run</p>
            <p><kbd>X</kbd> cycle 1× / 2× / 4×</p>
            <p><kbd>⇧1–6</kbd> force strange effect</p>
          </section>
        </div>
      </aside>

      <div class="q-copy-status" data-ui="copy-status" role="status" aria-live="polite" hidden></div>
    </main>`;
}

export class GameUI {
  private readonly shell: HTMLElement;
  private readonly distance: HTMLOutputElement;
  private readonly pause: HTMLElement;
  private readonly death: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly actionButtons = new Map<TunableAction, HTMLButtonElement>();
  private snapshot: Readonly<GameSnapshot> | null = null;
  private copyStatusTimer = 0;

  constructor(private readonly root: HTMLElement, private readonly simulation: QGameSimulation) {
    this.root.innerHTML = shellMarkup();
    this.shell = required(this.root, ".q-shell");
    this.distance = required(this.root, "[data-ui='distance']");
    this.pause = required(this.root, "[data-ui='pause']");
    this.death = required(this.root, "[data-ui='death']");
    this.debug = required(this.root, "[data-ui='debug']");
    for (const action of ACTIONS) {
      this.actionButtons.set(action, required(this.root, `[data-player-action='${action}']`));
    }
    this.root.addEventListener("click", this.onClick);
    window.addEventListener("keydown", this.onKeyDown);
    this.render(this.simulation.getSnapshot());
  }

  render(snapshot: Readonly<GameSnapshot>): void {
    this.snapshot = snapshot;
    const dead = snapshot.death !== null;
    this.shell.dataset.debug = String(snapshot.debug.enabled);
    this.shell.dataset.paused = String(snapshot.debug.paused);
    this.shell.dataset.dead = String(dead);
    this.shell.dataset.selectedAction = snapshot.selectedAction;
    this.shell.dataset.qHeld = String(snapshot.q.held);
    this.distance.textContent = String(Math.max(0, Math.floor(snapshot.distance)));
    this.pause.hidden = !snapshot.debug.paused || dead;
    this.death.hidden = !dead;
    this.debug.hidden = !snapshot.debug.enabled;
    this.debug.setAttribute("aria-hidden", String(!snapshot.debug.enabled));

    if (snapshot.death) {
      this.text("death-cause", snapshot.death.cause === "PIT" ? "Q FELL INTO THE DARK" : "THE GROUND BURNED Q");
      this.text("death-distance", String(Math.floor(snapshot.death.distance)));
    }

    for (const cooldown of snapshot.cooldowns) {
      const button = this.actionButtons.get(cooldown.action);
      if (!button) continue;
      const remaining = Math.max(0, cooldown.remaining);
      const ratio = cooldown.duration > 0 ? Math.min(1, remaining / cooldown.duration) : 0;
      button.classList.toggle("is-selected", snapshot.selectedAction === cooldown.action);
      button.classList.toggle("is-cooling", remaining > 0);
      button.disabled = dead || snapshot.debug.paused || remaining > 0;
      button.style.setProperty("--cooldown", ratio.toFixed(4));
      button.setAttribute("aria-pressed", String(snapshot.selectedAction === cooldown.action));
      const output = required<HTMLOutputElement>(button, "output");
      output.textContent = remaining > 0 ? `${remaining.toFixed(1)}s` : "READY";
    }

    if (snapshot.debug.enabled) this.renderDebug(snapshot);
  }

  destroy(): void {
    window.clearTimeout(this.copyStatusTimer);
    this.root.removeEventListener("click", this.onClick);
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.replaceChildren();
  }

  private renderDebug(snapshot: Readonly<GameSnapshot>): void {
    const { q, run } = snapshot;
    this.text("speed", `${snapshot.debug.speed}×`);
    this.text("debug-pause-label", snapshot.debug.paused ? "RESUME" : "PAUSE");
    this.debugValue("curiosity", fixed(run.traits.curiosity));
    this.debugValue("caution", fixed(run.traits.caution));
    this.debugValue("hunger-trait", fixed(run.traits.hunger));
    this.debugValue("compliance", fixed(run.traits.compliance));
    this.debugValue("decision-id", `D${q.decisionId}`);
    this.debugValue("intention", q.intention);
    this.debugValue("presentation", q.presentation);
    this.debugValue("hunger-state", `${fixed(q.hunger)} · ${hungerLabel(q.hunger)}`);
    this.debugValue("commitment", `${fixed(q.commitmentRemaining, 2)}s`);
    this.debugValue("tile-heading", `${formatPoint(q.tile)} / ${q.direction}${q.to ? ` → ${formatPoint(q.to)}` : ""}`);
    this.debugValue("target", formatPoint(q.target));
    this.debugValue("modifiers", q.modifiers.length > 0
      ? q.modifiers.map((modifier) => `${modifier.type} ${fixed(modifier.remaining, 1)}s`).join(" · ")
      : "none");
    this.debugValue("path", pathLabel(q.intendedPath));

    const candidateList = required<HTMLOListElement>(this.debug, "[data-debug-value='candidates']");
    candidateList.innerHTML = q.candidateTraces.length > 0
      ? q.candidateTraces.map(candidateMarkup).join("")
      : '<li class="q-debug__empty">No decision yet.</li>';

    this.debugValue("hazards", q.perception.hazards.length > 0
      ? q.perception.hazards.map((hazard) => `${hazard.kind}@${hazard.x},${hazard.y} d${hazard.distance}`).join(" · ")
      : "none perceived");
    this.debugValue("stimuli", q.perception.stimuli.join(" · ") || "none");
    const perceived = [
      ...q.perception.food.map((food) => `${food.kind}@${food.x},${food.y} d${food.distance}`),
      ...q.perception.strange.map((strange) => `${strange.effect}@${strange.x},${strange.y} d${strange.distance}`),
    ];
    this.debugValue("perceived-objects", perceived.join(" · ") || "none");

    this.debugValue("generator", run.generator);
    this.debugValue("run-seed", String(run.runSeed));
    this.debugValue("q-seed", String(run.qSeed));
    this.debugValue("dungeon-seed", String(run.dungeonSeed));
    this.debugValue(
      "appearance",
      `${run.appearance.earStyle} · body #${run.appearance.body.toString(16).padStart(6, "0")} · eyes ${fixed(run.appearance.eyeSpacing, 1)}`,
    );
    this.debugValue("latent", Object.entries(run.latent).map(([key, value]) => `${key} ${fixed(value)}`).join(" · "));
    this.debugValue("world", Object.entries(run.world).map(([key, value]) => `${key} ${fixed(value)}`).join(" · "));
    this.debugValue("dungeon-version", `V${snapshot.debug.dungeonVersion}`);
    this.debugValue("chunks", snapshot.debug.chunks.map((index) => {
      const firstY = index * TUNING.chunkHeight;
      return `${index} [${firstY}…${firstY + TUNING.chunkHeight - 1}]`;
    }).join(" · ") || "none");
  }

  private text(name: string, value: string): void {
    const element = required(this.root, `[data-ui='${name}']`);
    if (element.textContent !== value) element.textContent = value;
  }

  private debugValue(name: string, value: string): void {
    const element = required(this.debug, `[data-debug-value='${name}']`);
    if (element.textContent !== value) element.textContent = value;
  }

  private startNewRun(): void {
    this.simulation.startNewRun(randomSeed(this.snapshot?.run.runSeed));
  }

  private copySeed(): void {
    const seed = this.snapshot?.run.runSeed;
    if (seed === undefined || !navigator.clipboard) {
      this.showCopyStatus("CLIPBOARD UNAVAILABLE");
      return;
    }
    void navigator.clipboard.writeText(String(seed)).then(
      () => this.showCopyStatus(`SEED ${seed} COPIED`),
      () => this.showCopyStatus("COPY FAILED"),
    );
  }

  private showCopyStatus(message: string): void {
    const status = required<HTMLElement>(this.root, "[data-ui='copy-status']");
    window.clearTimeout(this.copyStatusTimer);
    status.textContent = message;
    status.hidden = false;
    this.copyStatusTimer = window.setTimeout(() => {
      status.hidden = true;
      status.textContent = "";
    }, 1_800);
  }

  private readonly onClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
    if (!button || button.disabled || !this.root.contains(button)) return;
    const playerAction = button.dataset.playerAction as TunableAction | undefined;
    if (playerAction && ACTIONS.includes(playerAction)) {
      this.simulation.selectAction(playerAction);
      return;
    }
    switch (button.dataset.command) {
      case "pause":
        this.simulation.togglePause();
        break;
      case "same-seed":
        this.simulation.restartSameSeed();
        break;
      case "new-run":
        this.startNewRun();
        break;
      case "debug-toggle":
        this.simulation.toggleDebug();
        break;
      case "speed":
        this.simulation.cycleSpeed();
        break;
      case "copy-seed":
        this.copySeed();
        break;
      case "force-strange": {
        const effect = button.dataset.effect as StrangeEffect | undefined;
        if (effect && STRANGE_EFFECTS.includes(effect)) this.simulation.forceStrangeEffect(effect);
        break;
      }
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

    if (event.shiftKey && this.snapshot?.debug.enabled) {
      const effect = FORCE_SHORTCUTS[event.code];
      if (effect) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.simulation.forceStrangeEffect(effect);
        return;
      }
    }

    const actionIndex = Number(event.key) - 1;
    const action = Number.isInteger(actionIndex) ? ACTIONS[actionIndex] : undefined;
    if (action) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.simulation.selectAction(action);
      return;
    }

    switch (event.key.toLowerCase()) {
      case "d":
      case "f3":
        event.preventDefault();
        event.stopImmediatePropagation();
        this.simulation.toggleDebug();
        break;
      case "p":
        event.preventDefault();
        event.stopImmediatePropagation();
        this.simulation.togglePause();
        break;
      case "r":
        event.preventDefault();
        event.stopImmediatePropagation();
        this.simulation.restartSameSeed();
        break;
      case "n":
        event.preventDefault();
        event.stopImmediatePropagation();
        this.startNewRun();
        break;
      case "x":
        event.preventDefault();
        event.stopImmediatePropagation();
        this.simulation.cycleSpeed();
        break;
      case "escape":
        event.preventDefault();
        event.stopImmediatePropagation();
        this.simulation.cancelRescue();
        break;
    }
  };
}
