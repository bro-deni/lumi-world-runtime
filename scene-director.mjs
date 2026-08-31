const DEFAULTS = Object.freeze({
  width: 720,
  height: 1280,
  safeTop: 70,
  safeBottom: 100,
  safeSide: 36,
});

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(
      max,
      Number(value) || 0
    )
  );
}

function safe(
  value,
  fallback = "",
  max = 120
) {
  const text = String(
    value ?? fallback
  )
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, max);

  return text || fallback;
}

const CAMERA = Object.freeze({
  follow_medium: {
    shot: "medium",
    move: "follow",
    zoom: 1.0,
  },

  push_in: {
    shot: "medium_close",
    move: "push_in",
    zoom: 1.08,
  },

  dynamic_medium: {
    shot: "medium",
    move: "orbit_micro",
    zoom: 1.02,
  },

  close_medium: {
    shot: "medium_close",
    move: "locked_soft",
    zoom: 1.05,
  },

  side_medium: {
    shot: "medium",
    move: "side_track",
    zoom: 1.0,
  },

  wide_hold: {
    shot: "wide",
    move: "slow_drift",
    zoom: 0.9,
  },

  gentle_close: {
    shot: "close",
    move: "slow_drift",
    zoom: 1.1,
  },

  hero_push: {
    shot: "hero",
    move: "push_in",
    zoom: 1.15,
  },

  two_thirds_medium: {
    shot: "medium",
    move: "parallax",
    zoom: 1.0,
  },

  slow_drift: {
    shot: "wide",
    move: "slow_drift",
    zoom: 0.92,
  },
});

function cameraFor(
  character = {}
) {
  return (
    CAMERA[character.camera] ||
    CAMERA.follow_medium
  );
}

function paletteFor(
  world = {}
) {
  const phase = safe(
    world.phase,
    "day",
    16
  );

  const weather = safe(
    world.weather,
    "clear",
    24
  );

  if (phase === "night") {
    return {
      tone: "moonlit",
      contrast: "soft",

      atmosphere:
        weather === "rain"
          ? "wet_glow"
          : "starlit",
    };
  }

  if (weather === "rain") {
    return {
      tone: "cool_day",
      contrast: "soft",
      atmosphere: "rain",
    };
  }

  return {
    tone: "warm_day",
    contrast: "natural",
    atmosphere: "clear",
  };
}

function hudFor(
  show = {},
  world = {}
) {
  const objective =
    show.objective || {};

  const target = Math.max(
    1,
    Number(
      objective.target ||
        world.objectiveTarget ||
        100
    )
  );

  const progress = clamp(
    world.objectiveProgress || 0,
    0,
    target
  );

  return {
    visible: true,

    style:
      "minimal_world_ui",

    level: Math.max(
      1,
      Math.floor(
        Number(world.level) || 1
      )
    ),

    xp: Math.max(
      0,
      Math.floor(
        Number(world.xp) || 0
      )
    ),

    communityLove:
      Math.max(
        0,
        Math.floor(
          Number(
            world.communityLove
          ) || 0
        )
      ),

    objective: {
      title: safe(
        objective.title,
        "Help LUMI improve the world",
        72
      ),

      progress,

      target,

      ratio: clamp(
        progress / target,
        0,
        1
      ),
    },

    buildProgress: clamp(
      world.buildProgress || 0,
      0,
      100
    ),
  };
}

function eventPresentation(
  show = {}
) {
  if (
    show.type !== "show_event" ||
    !show.event
  ) {
    return null;
  }

  const event = show.event;

  return {
    title: safe(
      event.title,
      "Something is happening",
      64
    ),

    subtitle: safe(
      event.summary,
      "",
      110
    ),

    category: safe(
      event.category,
      "general",
      24
    ),

    effect: safe(
      show.consequence
        ?.visibleEffect,
      "character_reaction",
      40
    ),

    returnHook: safe(
      show.consequence
        ?.returnHook,
      "",
      100
    ),

    emphasis:
      event.rare
        ? "rare"
        : [
            "tension",
            "progression",
            "building",
          ].includes(
            event.category
          )
          ? "strong"
          : "normal",

    durationMs:
      event.rare
        ? 6500
        : 4200,
  };
}

function crowdLayer(mode) {
  if (mode === "crowded") {
    return {
      density: "high",
      reactionAggregation: true,
      particleBudget: "medium",
      chatPresence: "pulse",
    };
  }

  if (mode === "active") {
    return {
      density: "medium",
      reactionAggregation: true,
      particleBudget: "low",
      chatPresence: "subtle",
    };
  }

  return {
    density: "quiet",
    reactionAggregation: true,
    particleBudget: "minimal",
    chatPresence: "hidden",
  };
}

function weatherFx(
  world = {}
) {
  const weather = safe(
    world.weather,
    "clear",
    24
  );

  const phase = safe(
    world.phase,
    "day",
    16
  );

  if (weather === "rain") {
    return {
      enabled: true,
      type: "rain",
      intensity: "medium",
      foreground: true,
      background: true,
    };
  }

  if (weather === "storm") {
    return {
      enabled: true,
      type: "storm",
      intensity: "strong",
      foreground: true,
      background: true,
    };
  }

  if (phase === "night") {
    return {
      enabled: true,
      type: "night_ambient",
      intensity: "subtle",
      foreground: false,
      background: true,
    };
  }

  return {
    enabled: true,
    type: "day_ambient",
    intensity: "subtle",
    foreground: false,
    background: true,
  };
}

function lightingFor(
  world = {},
  character = {}
) {
  const phase = safe(
    world.phase,
    "day",
    16
  );

  const mood = safe(
    character.mood,
    "curious",
    24
  );

  if (phase === "night") {
    return {
      key: "soft_moon",
      fill: "warm_world_glow",
      rim: "cool_rim",
      characterReadable: true,
    };
  }

  if (
    mood === "excited" ||
    mood === "proud"
  ) {
    return {
      key: "warm_soft",
      fill: "natural",
      rim: "gentle_warm",
      characterReadable: true,
    };
  }

  return {
    key: "natural_day",
    fill: "soft",
    rim: "subtle",
    characterReadable: true,
  };
}

function characterPlacement(
  character = {},
  config = DEFAULTS
) {
  const priority = safe(
    character.visualPriority,
    "balanced",
    32
  );

  let scale = 1.0;
  let y = 690;

  if (
    priority ===
    "character_focus"
  ) {
    scale = 1.08;
    y = 675;
  }

  if (
    priority ===
    "environment_focus"
  ) {
    scale = 0.88;
    y = 735;
  }

  if (
    priority ===
    "character_plus_world"
  ) {
    scale = 0.96;
    y = 705;
  }

  return {
    x: 0.5,

    y:
      y /
      config.height,

    scale,
  };
}

function objectivePlacement(
  config = DEFAULTS
) {
  return {
    anchor: "top",

    x:
      config.width / 2,

    y:
      config.safeTop + 28,

    maxWidth:
      config.width -
      config.safeSide * 2,

    avoidCharacterFace: true,
  };
}

function eventPlacement(
  config = DEFAULTS
) {
  return {
    anchor: "lower_third",

    x:
      config.width / 2,

    y:
      config.height -
      config.safeBottom -
      170,

    maxWidth:
      config.width -
      config.safeSide * 2,

    avoidCharacterFace: true,
  };
}

function interactionPlacement(
  config = DEFAULTS
) {
  return {
    anchor: "left_mid",

    x:
      config.safeSide,

    y: 380,

    maxWidth: 270,

    maxVisible: 4,

    stackDirection:
      "down",
  };
}

function pacingFor(
  audienceMode
) {
  if (
    audienceMode ===
    "crowded"
  ) {
    return {
      mode: "crowded",
      cutMinMs: 2600,
      cutMaxMs: 5200,
      avoidStaticSeconds: 8,
      eventSpacing: "fast",
    };
  }

  if (
    audienceMode ===
    "active"
  ) {
    return {
      mode: "active",
      cutMinMs: 3400,
      cutMaxMs: 7000,
      avoidStaticSeconds: 9,
      eventSpacing: "medium",
    };
  }

  return {
    mode: "quiet",
    cutMinMs: 4800,
    cutMaxMs: 9000,
    avoidStaticSeconds: 10,
    eventSpacing: "gentle",
  };
}

function worldMotionFor(
  world = {},
  audienceMode = "quiet"
) {
  const phase = safe(
    world.phase,
    "day",
    16
  );

  const weather = safe(
    world.weather,
    "clear",
    24
  );

  let ambient =
    "leaf_breeze";

  if (weather === "rain") {
    ambient =
      "rain_particles";
  } else if (
    phase === "night"
  ) {
    ambient =
      "firefly_drift";
  }

  return {
    ambient,

    parallax:
      audienceMode ===
      "crowded"
        ? "medium"
        : "slow",

    backgroundLife: true,

    neverFullyStatic: true,
  };
}

export class SceneDirector {
  constructor(options = {}) {
    this.config = {
      ...DEFAULTS,
      ...(options.config || {}),
    };

    this.sequence = 0;

    this.lastCamera = null;

    this.lastEventId = null;
  }

  compose({
    show = {},
    character = {},
    interactions = [],
  } = {}) {
    this.sequence += 1;

    const world =
      show.world || {};

    const audienceMode =
      safe(
        show.audienceMode,
        "quiet",
        20
      );

    const camera =
      cameraFor(character);

    const placement =
      characterPlacement(
        character,
        this.config
      );

    const event =
      eventPresentation(show);

    const interactionList =
      Array.isArray(
        interactions
      )
        ? interactions.slice(-6)
        : [];

    const cameraChanged =
      !this.lastCamera ||
      this.lastCamera.shot !==
        camera.shot ||
      this.lastCamera.move !==
        camera.move;

    this.lastCamera = {
      ...camera,
    };

    const eventChanged =
      Boolean(
        event &&
          show.event?.id !==
            this.lastEventId
      );

    if (show.event?.id) {
      this.lastEventId =
        show.event.id;
    }

    return {
      version: 1,

      sequence:
        this.sequence,

      canvas: {
        width:
          this.config.width,

        height:
          this.config.height,

        aspect: "9:16",

        orientation:
          "portrait",
      },

      safeArea: {
        top:
          this.config.safeTop,

        bottom:
          this.config.safeBottom,

        left:
          this.config.safeSide,

        right:
          this.config.safeSide,
      },

      palette:
        paletteFor(world),

      lighting:
        lightingFor(
          world,
          character
        ),

      camera: {
        ...camera,

        subject: "lumi",

        framingPriority:
          safe(
            character
              .visualPriority,
            "balanced",
            32
          ),

        changed:
          cameraChanged,
      },

      worldLayer: {
        phase:
          safe(
            world.phase,
            "day",
            16
          ),

        weather:
          safe(
            world.weather,
            "clear",
            24
          ),

        weatherFx:
          weatherFx(world),

        motion:
          worldMotionFor(
            world,
            audienceMode
          ),

        constructionVisible:
          clamp(
            world
              .buildProgress ||
              0,
            0,
            100
          ) > 0,

        constructionProgress:
          clamp(
            world
              .buildProgress ||
              0,
            0,
            100
          ),

        milestone:
          safe(
            world
              .nextMilestone,
            "",
            90
          ),
      },

      characterLayer: {
        mood:
          safe(
            character.mood,
            "curious",
            24
          ),

        action:
          safe(
            character.action,
            "exploring",
            32
          ),

        pose:
          safe(
            character.pose,
            "walk",
            32
          ),

        expression:
          safe(
            character
              .expression,
            "curious",
            32
          ),

        motion:
          safe(
            character.motion,
            "light_bounce",
            32
          ),

        x:
          placement.x,

        y:
          placement.y,

        scale:
          placement.scale,

        readableState:
          safe(
            character
              .readableState,
            "balanced",
            32
          ),

        visualPriority:
          safe(
            character
              .visualPriority,
            "balanced",
            32
          ),
      },

      hud: {
        ...hudFor(
          show,
          world
        ),

        placement:
          objectivePlacement(
            this.config
          ),
      },

      eventBanner:
        event
          ? {
              ...event,

              changed:
                eventChanged,

              placement:
                eventPlacement(
                  this.config
                ),
            }
          : null,

      audienceLayer:
        crowdLayer(
          audienceMode
        ),

      interactionOverlays:
        interactionList,

      interactionPlacement:
        interactionPlacement(
          this.config
        ),

      pacing:
        pacingFor(
          audienceMode
        ),

      readability: {
        primaryFocus:
          character
            .visualPriority ||
          "balanced",

        showRawTechnicalData:
          false,

        textDensity:
          event
            ? "medium"
            : "low",

        characterFaceClear:
          true,

        importantStateReadable:
          true,
      },

      antiDashboardRules: {
        maxPrimaryTextBlocks:
          2,

        maxSimultaneousMeters:
          3,

        neverCoverCharacterFace:
          true,

        preferWorldMotionOverText:
          true,

        hideRawTechnicalMetrics:
          true,

        noPermanentChatWall:
          true,

        noDebugTelemetry:
          true,

        noFullScreenCounters:
          true,
      },

      retention: {
        objectiveVisible:
          true,

        worldProgressVisible:
          true,

        unfinishedConstructionVisible:
          clamp(
            world
              .buildProgress ||
              0,
            0,
            100
          ) > 0,

        nextMilestone:
          safe(
            world
              .nextMilestone,
            "Keep exploring LUMI WORLD",
            90
          ),

        principle:
          "Use curiosity, continuity, world progression, and community achievement without coercive engagement pressure.",
      },
    };
  }
}

export function createSceneDirector(
  options = {}
) {
  return new SceneDirector(
    options
  );
}
