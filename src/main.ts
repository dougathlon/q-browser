import Phaser from "phaser";
import "./styles.css";
import { AudioCues } from "./audio/AudioCues";
import { QScene } from "./game/QScene";
import { QGameSimulation } from "./simulation/QGameSimulation";
import type { Point, StrangeEffect } from "./simulation/types";
import type { TunableAction } from "./config/tuning";
import { GameUI } from "./ui/GameUI";

function randomSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] ?? Date.now();
}

function seedFromLocation(): number {
  const candidate = Number.parseInt(new URLSearchParams(globalThis.location.search).get("seed") ?? "", 10);
  return Number.isFinite(candidate) ? candidate : randomSeed();
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Q requires an #app element.");

const simulation = new QGameSimulation(seedFromLocation());
const ui = new GameUI(root, simulation);
const audio = new AudioCues();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "q-canvas",
  backgroundColor: "#07100f",
  transparent: false,
  antialias: true,
  render: {
    pixelArt: false,
    roundPixels: true,
    powerPreference: "high-performance",
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  },
  scene: [new QScene(simulation, (snapshot) => ui.render(snapshot), audio)],
});

ui.render(simulation.getSnapshot());

declare global {
  interface Window {
    qDemo: {
      getState: () => ReturnType<QGameSimulation["getSnapshot"]>;
      restartSameSeed: () => void;
      newRun: (seed?: number) => void;
      selectAction: (action: TunableAction) => void;
      useAt: (point: Point, hitQ?: boolean) => ReturnType<QGameSimulation["useSelected"]>;
      forceEffect: (effect: StrangeEffect) => void;
      setDebug: (enabled: boolean) => void;
      togglePause: () => void;
      setSpeed: (speed: 1 | 2 | 4) => void;
    };
  }
}

window.qDemo = {
  getState: () => simulation.getSnapshot(),
  restartSameSeed: () => simulation.restartSameSeed(),
  newRun: (seed: number = randomSeed()) => simulation.startNewRun(seed),
  selectAction: (action: TunableAction) => simulation.selectAction(action),
  useAt: (point: Point, hitQ = false) => simulation.useSelected(point, hitQ),
  forceEffect: (effect: StrangeEffect) => simulation.forceStrangeEffect(effect),
  setDebug: (enabled: boolean) => simulation.setDebug(enabled),
  togglePause: () => simulation.togglePause(),
  setSpeed: (speed: 1 | 2 | 4) => simulation.setSpeed(speed),
};

globalThis.addEventListener("beforeunload", () => {
  ui.destroy();
  audio.destroy();
  game.destroy(true);
}, { once: true });
