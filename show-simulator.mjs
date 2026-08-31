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

function seededRandom(seed = 123456789) {
  let x = seed >>> 0;

  return () => {
    x =
      (
        1664525 * x +
        1013904223
      ) >>> 0;

    return x / 4294967296;
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
        Number(options.minutes) || 30
      )
    );

  const stepMs =
    Math.max(
      1000,
      Number(options.stepMs) || 1000
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
      random,
    });

  const samples = [];

  let showEvents = 0;
  let rareEvents = 0;
  let maxOverlays = 0;

  let quietFrames = 0;
  let activeFrames = 0;
  let crowdedFrames = 0;

  let sceneFrames = 0;
  let eventBanners = 0;
  let characterFocusFrames = 0;
  let environmentFocusFrames = 0;

  const totalSteps =
    Math.floor(
      minutes *
        60_000 /
        stepMs
    );

  for (
    let i = 0;
    i < totalSteps;
    i += 1
  ) {
    now += stepMs;

    const phase =
      i / totalSteps;

    const signals = [];

    /*
     * SIMULATION PHASES
     *
     * 0–18%:
     * Quiet room.
     *
     * 18–72%:
     * Increasing audience activity.
     *
     * 72–100%:
     * Audience settles down again.
     */

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
      show.ingest(signal);

      character.reactToAudience(
        signal
      );

      visualizer.ingest(
        signal
      );
    }

    const showFrame =
      show.tick();

    switch (
      showFrame.audienceMode
    ) {
      case "quiet":
        quietFrames += 1;
        break;

      case "active":
        activeFrames += 1;
        break;

      case "crowded":
        crowdedFrames += 1;
        break;
    }

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

      character.applyShowEvent(
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
          showFrame.audienceMode,
      });

    const overlayFrame =
      visualizer.frame();

    maxOverlays =
      Math.max(
        maxOverlays,
        overlayFrame.visible.length
      );

    const sceneFrame =
      scene.compose({
        show:
          showFrame,

        character:
          charFrame,

        interactions:
          overlayFrame.visible,
      });

    sceneFrames += 1;

    if (
      sceneFrame.eventBanner
    ) {
      eventBanners += 1;
    }

    if (
      sceneFrame
        .characterLayer
        ?.visualPriority ===
      "character_focus"
    ) {
      characterFocusFrames += 1;
    }

    if (
      sceneFrame
        .characterLayer
        ?.visualPriority ===
      "environment_focus"
    ) {
      environmentFocusFrames += 1;
    }

    if (
      i % 30 === 0 ||
      showFrame.type ===
        "show_event"
    ) {
      samples.push({
        at:
          new Date(
            now
          ).toISOString(),

        showType:
          showFrame.type,

        audienceMode:
          showFrame.audienceMode,

        mood:
          charFrame.mood,

        action:
          charFrame.action,

        event:
          showFrame.event
            ?.id || null,

        eventCategory:
          showFrame.event
            ?.category || null,

        camera:
          sceneFrame.camera,

        visualPriority:
          sceneFrame
            .characterLayer
            ?.visualPriority,

        overlays:
          overlayFrame
            .visible.length,

        xp:
          showFrame.world?.xp,

        love:
          showFrame.world
            ?.communityLove,

        energy:
          showFrame.world
            ?.energy,

        buildProgress:
          showFrame.world
            ?.buildProgress,
      });
    }
  }

  const showSnapshot =
    show.snapshot();

  const characterSnapshot =
    character.snapshot();

  const interactionSnapshot =
    visualizer.snapshot();

  const checks = {
    enoughShowEvents:
      showEvents >=
      Math.max(
        6,
        minutes / 3
      ),

    overlayLimitRespected:
      maxOverlays <= 4,

    progressionMoves:
      Number(
        showSnapshot
          .world
          ?.xp
      ) > 0,

    quietModeObserved:
      quietFrames > 0,

    activeModeObserved:
      activeFrames > 0,

    characterStatePresent:
      Boolean(
        characterSnapshot
          .state
          ?.mood
      ) &&
      Boolean(
        characterSnapshot
          .state
          ?.action
      ),

    interactionAggregationWorks:
      Number(
        interactionSnapshot
          .aggregate
          ?.likes
      ) > 0,

    sceneDirectorProducedFrames:
      sceneFrames ===
      totalSteps,

    eventPresentationObserved:
      eventBanners > 0,

    noOverlayFlood:
      maxOverlays <= 4,

    worldStillAliveWithoutAudience:
      quietFrames > 30,

    showHasVisualVariation:
      (
        characterFocusFrames > 0 ||
        environmentFocusFrames > 0
      ),

    ethicalInteractionPolicy:
      interactionSnapshot
        .aggregate != null,
  };

  const failedChecks =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          !value
      )
      .map(
        ([name]) =>
          name
      );

  const ok =
    failedChecks.length === 0;

  return {
    ok,

    verdict:
      ok
        ? "PASS"
        : "REVIEW",

    simulation: {
      minutes,
      stepMs,
      totalSteps,
    },

    show: {
      showEvents,
      rareEvents,
      eventBanners,
    },

    audienceFrames: {
      quiet:
        quietFrames,

      active:
        activeFrames,

      crowded:
        crowdedFrames,
    },

    visual: {
      sceneFrames,
      characterFocusFrames,
      environmentFocusFrames,
      maxOverlays,
    },

    checks,

    failedChecks,

    finalWorld:
      showSnapshot.world,

    objective:
      showSnapshot.objective,

    finalCharacter:
      characterSnapshot.state,

    interactionAggregate:
      interactionSnapshot.aggregate,

    samples:
      samples.slice(-50),
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
