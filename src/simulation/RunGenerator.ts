import { clamp01, createRng, mixSeed, normalizeSeed, randomBetween, randomInt } from "./rng";
import type { QAppearance, RunConfiguration, RunGenerator } from "./types";

const APPEARANCES: readonly Omit<QAppearance, "eyeSpacing">[] = [
  { body: 0xf6b38a, belly: 0xffe1b7, accent: 0xff6f7d, earStyle: "ears" },
  { body: 0x9edfc4, belly: 0xe6f7c8, accent: 0x6d9fca, earStyle: "antennae" },
  { body: 0xd7b6f2, belly: 0xf4ddff, accent: 0x68c9b5, earStyle: "nubs" },
  { body: 0xf0d46f, belly: 0xfff1bd, accent: 0xcd7aa2, earStyle: "antennae" },
];

function trait(latent: number, rng: () => number): number {
  return clamp01(0.14 + latent * 0.7 + randomBetween(rng, -0.08, 0.08));
}

export class ClassicalCorrelatedRunGenerator implements RunGenerator {
  generate(seed: number): RunConfiguration {
    const runSeed = normalizeSeed(seed);
    const latentRng = createRng(mixSeed(runSeed, "latent"));
    const traitRng = createRng(mixSeed(runSeed, "traits"));
    const novelty = latentRng();
    const threat = latentRng();
    const scarcity = latentRng();
    const attunement = latentRng();
    const curiosity = trait(novelty, traitRng);
    const caution = trait(threat, traitRng);
    const hunger = trait(scarcity, traitRng);
    const compliance = trait(attunement, traitRng);
    const appearanceRng = createRng(mixSeed(runSeed, "appearance"));
    const baseAppearance = APPEARANCES[randomInt(appearanceRng, 0, APPEARANCES.length - 1)] ?? APPEARANCES[0];

    return {
      generator: "classical-correlated-v1",
      runSeed,
      qSeed: mixSeed(runSeed, "q"),
      dungeonSeed: mixSeed(runSeed, "dungeon"),
      latent: { novelty, threat, scarcity, attunement },
      traits: { curiosity, caution, hunger, compliance },
      world: {
        strangeDensity: 0.62 + novelty * 0.82,
        hazardDensity: 0.62 + threat * 0.76,
        foodAbundance: 1.2 - scarcity * 0.58,
        junctionDensity: 0.7 + novelty * 0.38 + (1 - attunement) * 0.24,
        forwardPull: 0.72 + attunement * 0.28 - novelty * 0.08,
      },
      appearance: {
        ...(baseAppearance ?? APPEARANCES[0]!),
        eyeSpacing: randomBetween(appearanceRng, 7.5, 11.5),
      },
    };
  }
}
