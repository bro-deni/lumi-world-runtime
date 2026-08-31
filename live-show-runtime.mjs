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

const DEFAULTS = Object.freeze({
  edgeUrl:
    process.env.LUMI_EDGE_URL ||
    "https://lumi-world-core.lumi-world.workers.dev",

  statusPath:
    "/api/status",

  pollMs:
    5000,

  requestTimeoutMs:
    8000,

  maxConsecutiveFailures:
    6,
});

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      Number(value) || 0
    )
  );
}

function safeText(
  value,
  fallback = "",
  max = 160
) {
  const text = String(
    value ?? fallback
  )
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, max);

  return text || fallback;
}

function normalizeBaseUrl(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .replace(/\/+$/, "");
}

function nowMs(clock) {
  return (
    Number(clock?.()) ||
    Date.now()
  );
}

function normalizeWorld(
  raw = {}
) {
  return {
    level:
      Math.max(
        1,
        Math.floor(
          Number(raw.level) ||
            1
        )
      ),

    xp:
      Math.max(
        0,
        Math.floor(
          Number(raw.xp) ||
            0
        )
      ),

    communityLove:
      Math.max(
        0,
        Math.floor(
          Number(
            raw.communityLove
          ) || 0
        )
      ),

    phase:
      safeText(
        raw.phase,
        "day",
        16
      ),

    weather:
      safeText(
        raw.weather,
        "clear",
        24
      ),

    lumiAction:
      safeText(
        raw.lumiAction,
        "exploring",
        32
      ),

    lumiMood:
      safeText(
        raw.lumiMood,
        "curious",
        24
      ),

    energy:
      clamp(
        raw.energy ?? 70,
        0,
        100
      ),

    buildProgress:
      clamp(
        raw.buildProgress ?? 0,
        0,
        100
      ),

    objectiveProgress:
      Math.max(
        0,
        Number(
          raw.objectiveProgress
        ) || 0
      ),

    objectiveTarget:
      Math.max(
        1,
        Number(
          raw.objectiveTarget
        ) || 100
      ),

    nextMilestone:
      safeText(
        raw.nextMilestone,
        "Keep exploring LUMI WORLD",
        100
      ),

    updatedAt:
      raw.updatedAt || null,
  };
}

export class LiveShowRuntime {
  constructor(
    options = {}
  ) {
    this.clock =
      options.clock ||
      (() => Date.now());

    this.fetchImpl =
      options.fetchImpl ||
      globalThis.fetch;

    this.config = {
      ...DEFAULTS,
      ...(options.config || {}),
    };

    this.config.edgeUrl =
      normalizeBaseUrl(
        this.config.edgeUrl
      );

    this.show =
      options.showEngine ||
      createShowEngine({
        clock:
          this.clock,

        random:
          options.random,
      });

    this.character =
      options.characterEngine ||
      createCharacterEngine({
        clock:
          this.clock,

        random:
          options.random,
      });

    this.scene =
      options.sceneDirector ||
      createSceneDirector();

    this.visualizer =
      options
        .interactionVisualizer ||
      createInteractionVisualizer({
        clock:
          this.clock,

        random:
          options.random,
      });

    this.externalWorld =
      normalizeWorld(
        options.initialWorld ||
          {}
      );

    this.lastPollAt = 0;

    this.lastSuccessAt = 0;

    this.lastError = null;

    this.consecutiveFailures =
      0;

    this.lastEdgePayload =
      null;

    this.lastFrame =
      null;
  }

  statusUrl() {
    return (
      `${this.config.edgeUrl}` +
      `${this.config.statusPath}`
    );
  }

  async syncWorld({
    force = false,
  } = {}) {
    const now =
      nowMs(this.clock);

    if (
      !force &&
      now -
        this.lastPollAt <
        this.config.pollMs
    ) {
      return {
        ok:
          this
            .consecutiveFailures ===
          0,

        skipped:
          true,

        world: {
          ...this.externalWorld,
        },
      };
    }

    this.lastPollAt =
      now;

    if (
      typeof this.fetchImpl !==
      "function"
    ) {
      this.lastError =
        "fetch_unavailable";

      this.consecutiveFailures +=
        1;

      return {
        ok: false,

        error:
          this.lastError,

        world: {
          ...this.externalWorld,
        },
      };
    }

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),

        this.config
          .requestTimeoutMs
      );

    try {
      const response =
        await this.fetchImpl(
          this.statusUrl(),
          {
            method: "GET",

            headers: {
              accept:
                "application/json",
            },

            signal:
              controller.signal,
          }
        );

      if (!response.ok) {
        throw new Error(
          `edge_http_${response.status}`
        );
      }

      const payload =
        await response.json();

      if (
        !payload ||
        payload.ok !== true ||
        !payload.world
      ) {
        throw new Error(
          "edge_invalid_payload"
        );
      }

      this.lastEdgePayload =
        payload;

      this.externalWorld =
        normalizeWorld(
          payload.world
        );

      this.lastSuccessAt =
        nowMs(this.clock);

      this.lastError =
        null;

      this.consecutiveFailures =
        0;

      return {
        ok: true,

        skipped: false,

        world: {
          ...this.externalWorld,
        },
      };
    } catch (error) {
      this.lastError =
        error?.name ===
        "AbortError"
          ? "edge_timeout"
          : safeText(
              error?.message,
              "edge_request_failed",
              120
            );

      this.consecutiveFailures +=
        1;

      return {
        ok: false,

        error:
          this.lastError,

        world: {
          ...this.externalWorld,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  ingestInteraction(
    signal = {}
  ) {
    const accepted =
      this.show.ingest(
        signal
      );

    if (!accepted) {
      return false;
    }

    this.character
      .reactToAudience(
        signal
      );

    this.visualizer
      .ingest(
        signal
      );

    return true;
  }

  async frame(
    options = {}
  ) {
    if (
      options.syncWorld !==
      false
    ) {
      await this.syncWorld({
        force:
          options.forceSync ===
          true,
      });
    }

    this.#mergeExternalWorld();

    const showFrame =
      this.show.tick();

    if (
      showFrame.type ===
      "show_event"
    ) {
      this.character
        .applyShowEvent(
          showFrame.event,

          showFrame
            .consequence,

          showFrame.world
        );
    }

    const characterFrame =
      this.character.tick({
        world:
          showFrame.world,

        audienceMode:
          showFrame
            .audienceMode,
      });

    const interactionFrame =
      this.visualizer.frame();

    const sceneFrame =
      this.scene.compose({
        show:
          showFrame,

        character:
          characterFrame,

        interactions:
          interactionFrame
            .visible,
      });

    this.lastFrame = {
      at:
        new Date(
          nowMs(this.clock)
        ).toISOString(),

      source: {
        edgeConnected:
          this
            .consecutiveFailures ===
            0 &&
          this.lastSuccessAt >
            0,

        degraded:
          this
            .consecutiveFailures >
          0,

        consecutiveFailures:
          this
            .consecutiveFailures,

        lastSuccessAt:
          this
            .lastSuccessAt ||
          null,

        lastError:
          this.lastError,
      },

      show:
        showFrame,

      character:
        characterFrame,

      interactions:
        interactionFrame,

      scene:
        sceneFrame,
    };

    return this.lastFrame;
  }

  snapshot() {
    return {
      version: 1,

      edge: {
        url:
          this.config
            .edgeUrl,

        statusUrl:
          this.statusUrl(),

        connected:
          this
            .consecutiveFailures ===
            0 &&
          this.lastSuccessAt >
            0,

        degraded:
          this
            .consecutiveFailures >
          0,

        lastPollAt:
          this.lastPollAt ||
          null,

        lastSuccessAt:
          this
            .lastSuccessAt ||
          null,

        consecutiveFailures:
          this
            .consecutiveFailures,

        lastError:
          this.lastError,
      },

      externalWorld: {
        ...this.externalWorld,
      },

      show:
        this.show.snapshot(),

      character:
        this.character.snapshot(),

      interactions:
        this.visualizer
          .snapshot(),

      lastFrame:
        this.lastFrame,
    };
  }

  healthy() {
    return (
      this
        .consecutiveFailures <
      this.config
        .maxConsecutiveFailures
    );
  }

  #mergeExternalWorld() {
    const target =
      this.show.world;

    if (
      !target ||
      typeof target !==
        "object"
    ) {
      return;
    }

    const world =
      this.externalWorld;

    target.level =
      world.level;

    target.xp =
      Math.max(
        target.xp || 0,
        world.xp
      );

    target.communityLove =
      Math.max(
        target.communityLove ||
          0,

        world.communityLove
      );

    target.phase =
      world.phase;

    target.weather =
      world.weather;

    if (
      world.lumiAction
    ) {
      target.lumiAction =
        world.lumiAction;
    }

    if (
      world.lumiMood
    ) {
      target.lumiMood =
        world.lumiMood;
    }

    if (
      world.updatedAt
    ) {
      target.updatedAt =
        world.updatedAt;
    }
  }
}

export function createLiveShowRuntime(
  options = {}
) {
  return new LiveShowRuntime(
    options
  );
}
