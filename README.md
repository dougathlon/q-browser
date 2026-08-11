# Q behavioral prototype

This is a Phaser/TypeScript/Vite browser-game demo for testing one relationship: an autonomous creature, a continuously generated dangerous cave, and five indirect player interventions. It is a behavioral prototype, not a complete roguelike or a claim about quantum computation.

Play the current public build at <https://dougathlon.github.io/q-browser/>.

## Run locally

Requires Node 24+ and pnpm 11+.

```sh
git clone https://github.com/dougathlon/q-browser.git
cd q-browser
pnpm install
pnpm dev
```

Open <http://127.0.0.1:4177/>. To reproduce a run, add a numeric seed such as <http://127.0.0.1:4177/?seed=1337>.

For a production build:

```sh
pnpm build
pnpm preview
```

## Player controls

- `1` PLACE: select a temporary rock obstruction, then click a valid visible floor tile.
- `2` TREAT: select a treat, then click a valid visible floor tile.
- `3` CALL: select CALL, then click Q. Its response depends on compliance and current state.
- `4` CARE: select CARE, then click Q to pat and briefly stabilize it.
- `5` RESCUE: click Q to lift it, then click a valid tile inside the displayed four-tile radius.
- `Escape`: cancel a selected action or held rescue.

The mouse may also select actions from the bottom dock. Normal play intentionally exposes only distance and cooldowns.

## Debug controls

- `D` or `F3`: toggle the decision overlay.
- `P`: pause or resume.
- `R`: restart with the same run seed.
- `N`: start a new random run.
- `X`: cycle simulation speed through 1x, 2x, and 4x.
- `Shift+1` through `Shift+6`: force REVERSE, FRENZY, FASCINATION, CALM, HUNGER, or DEFIANCE.

The overlay shows hidden traits, hunger, intention and commitment, target and path, scored candidate actions with score components and weights, perceived hazards and stimuli, active modifiers, run and dungeon seeds, shared latent run configuration, Q appearance, and chunk boundaries.

## Architecture

- `src/simulation/RunGenerator.ts`: replaceable seeded run generator. A shared latent state derives both Q traits and dungeon biases; it is a classical stand-in, not a QPU integration.
- `src/simulation/Dungeon.ts`: deterministic forward chunk generation, a guaranteed geometric route, hazards, food, strange tiles, and chunk recycling.
- `src/simulation/Perception.ts`: radius-limited, wall-occluded local perception.
- `src/simulation/BehaviorSystem.ts`: utility-scored intentions with commitment and hysteresis rather than per-tile random walking.
- `src/simulation/QGameSimulation.ts`: fixed-step authoritative run state, interventions, tile effects, death, restart, and forward high-water scoring.
- `src/game/QScene.ts`: Phaser renderer, camera, input projection, placement previews, and debug drawing.
- `src/game/QView.ts`: procedural Q artwork and behavior-linked animation.
- `src/ui/GameUI.ts`: intentionally sparse player HUD and separate developer overlay.
- `src/config/tuning.ts`: central prototype tuning values.

## Checks

```sh
pnpm check
pnpm build
pnpm test:e2e
```

`pnpm check` runs strict TypeScript and the deterministic Vitest suite. The Pages workflow also builds for the `/q-browser/` subpath and runs the production build in Linux Chromium before deployment.

## Current boundary

The generator uses a continuous recycled strip of cave chunks with a guaranteed route, not authored rooms or procedural puzzles. Q uses short-lived local intentions and can still make poor decisions; it does not solve globally. No combat, enemies, inventory, progression, live service, graph backend, or QPU integration is present.

The game code and artwork are published for playtesting without an open-source licence. Third-party runtime notices are in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt).
