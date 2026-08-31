import {
  createShowEngine,
} from "./show-engine.mjs";

import {
  createCharacterEngine,
} from "./character-engine.mjs";

import {
  createSceneDirector,
} from "./scene-director.mjs";

import {
  createInteractionVisualizer,
} from "./interaction-visualizer.mjs";

function seededRandom(
  seed = 123456789
) {
  let x =
    seed >>> 0;

  return () => {
    x =
      (
        1664525 *
          x +
        1013904223
      ) >>> 0;

    return (
      x /
      4294967296
    );
  };
}

export function runSimulation(
  options = {}
) {
  const minutes =
    Math.max(
      1,
      Math.min(
        180,
        Number(
          options.minutes
        ) || 30
      )
    );

  const stepMs =
    Math.max(
      1000,
      Number(
        options.stepMs
      ) || 1000
    );

  let now =
    Date.UTC(
      2026,
      7,
      31,
      0,
      0,
      0
    );

  const clock =
    () => now;

  const random =
    seededRandom(
      options.seed || 42
    );

  const show =
    createShowEngine({
      clock,
      random,
    });

  const character =
    createCharacterEngine({
      clock,
      random,
    });

  const scene =
    createSceneDirector();

  const visualizer =
    createInteractionVisualizer({
      clock,
    });

  const events = [];

  let showEvents = 0;
  let rareEvents = 0;
  let maxOverlays = 0;

  const totalSteps =
    Math.floor(
      minutes *
        60_000 /
        stepMs
    );

  for (
    let i = 0;
    i < totalSteps;
    i++
  ) {
    now += stepMs;

    const phase =
      i / totalSteps;

    const signals = [];

    if (
      phase > 0.18 &&
      phase < 0.72 &&
      i % 5 === 0
    ) {
      signals.push({
        type: "like",
        count: 8,
      });
    }

    if (
      phase > 0.25 &&
      phase < 0.65 &&
      i % 37 === 0
    ) {
      signals.push({
        type: "comment",
        text: "ayo lumi",
      });
    }

    if (
      phase > 0.30 &&
      phase < 0.62 &&
      i % 79 === 0
    ) {
      signals.push({
        type: "follow",
      });
    }

    if (
      phase > 0.40 &&
      phase < 0.60 &&
      i % 131 === 0
    ) {
      signals.push({
        type: "share",
      });
    }

    if (
      phase > 0.46 &&
      phase < 0.55 &&
      i % 211 === 0
    ) {
      signals.push({
        type: "gift",
        value: 10,
      });
    }

    if (
      phase > 0.34 &&
      phase < 0.58 &&
      i % 53 === 0
    ) {
      signals.push({
        type: "vote",
        option: "A",
      });
    }

    for (
      const signal of signals
    ) {
      show.ingest(
        signal
      );

      character
        .reactToAudience(
          signal
        );

      visualizer
        .ingest(
          signal
        );
    }

    const showFrame =
      show.tick();

    if (
      showFrame.type ===
      "show_event"
    ) {
      showEvents += 1;

      if (
        showFrame.event?.rare
      ) {
        rareEvents += 1;
      }

      character
        .applyShowEvent(
          showFrame.event,
          showFrame.consequence,
          showFrame.world
        );
    }

    const charFrame =
      character.tick({
        world:
          showFrame.world,

        audienceMode:
          showFrame
            .audienceMode,
      });

    const overlays =
      visualizer.frame();

    maxOverlays =
      Math.max(
        maxOverlays,
        overlays.visible.length
      );

    const sceneFrame =
      scene.compose({
        show:
          showFrame,

        character:
          charFrame,

        interactions:
          overlays.visible,
      });

    if (
      i % 30 === 0 ||
      showFrame.type ===
        "show_event"
    ) {
      events.push({
        at:
          new Date(
            now
          ).toISOString(),

        showType:
          showFrame.type,

        audienceMode:
          showFrame
            .audienceMode,

        mood:
          charFrame.mood,

        action:
          charFrame.action,

        event:
          showFrame.event
            ?.id || null,

        camera:
          sceneFrame.camera,

        overlays:
          overlays.visible
            .length,

        xp:
          showFrame.world?.xp,

        love:
          showFrame.world
            ?.communityLove,
      });
    }
  }

  const snap =
    show.snapshot();

  const verdict =
    showEvents >=
      Math.max(
        6,
        minutes / 3
      ) &&
    maxOverlays <= 4 &&
    snap.world.xp > 0
      ? "PASS"
      : "REVIEW";

  return {
    ok:
      verdict ===
      "PASS",

    verdict,

    minutes,
    showEvents,
    rareEvents,
    maxOverlays,

    finalWorld:
      snap.world,

    objective:
      snap.objective,

    samples:
      events.slice(-40),
  };
}

if (
  import.meta.url ===
  `file://${process.argv[1]}`
) {
  const result =
    runSimulation({
      minutes:
        Number(
          process.argv[2]
        ) || 30,
    });

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  process.exitCode =
    result.ok
      ? 0
      : 1;
}
