const DEFAULTS = Object.freeze({
  maxRecentActions: 16,
  moodMemoryMs: 90_000,
  fatigueRecoveryPerMinute: 18,
  fatigueGainPerAction: 7,
  excitementDecayPerMinute: 10,
  curiosityGainPerDiscovery: 16,
  confidenceGainPerSuccess: 8,
  confidenceLossPerFailure: 7,
  socialWarmthGain: 6,
  socialWarmthDecayPerMinute: 4,
  idleThresholdMs: 25_000,
});

const MOODS = Object.freeze([
  "curious",
  "playful",
  "excited",
  "calm",
  "tired",
  "proud",
  "sleepy",
  "brave",
  "surprised",
  "focused",
  "grateful",
]);

const ACTION_LIBRARY = Object.freeze({
  exploring: {
    pose: "walk",
    expression: "curious",
    motion: "light_bounce",
    camera: "follow_medium",
    energyCost: 5,
  },
  discovering: {
    pose: "lean_forward",
    expression: "wide_eyes",
    motion: "small_hop",
    camera: "push_in",
    energyCost: 4,
  },
  playing: {
    pose: "playful",
    expression: "happy",
    motion: "quick_bounce",
    camera: "dynamic_medium",
    energyCost: 8,
  },
  gardening: {
    pose: "kneel",
    expression: "focused",
    motion: "gentle_handwork",
    camera: "close_medium",
    energyCost: 4,
  },
  building: {
    pose: "work",
    expression: "focused",
    motion: "purposeful",
    camera: "side_medium",
    energyCost: 8,
  },
  observing: {
    pose: "look_around",
    expression: "calm",
    motion: "slow_head_turn",
    camera: "wide_hold",
    energyCost: 1,
  },
  resting: {
    pose: "sit",
    expression: "soft",
    motion: "slow_breathing",
    camera: "gentle_close",
    energyCost: -8,
  },
  celebrating: {
    pose: "celebrate",
    expression: "joy",
    motion: "jump_and_wave",
    camera: "hero_push",
    energyCost: 6,
  },
  helping: {
    pose: "reach_out",
    expression: "warm",
    motion: "gentle",
    camera: "two_thirds_medium",
    energyCost: 4,
  },
  dreaming: {
    pose: "sleep",
    expression: "sleepy",
    motion: "slow_breathing",
    camera: "slow_drift",
    energyCost: -12,
  },
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value, fallback = "", max = 120) {
  const text = String(value ?? fallback)
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, max);

  return text || fallback;
}

function pick(list, random = Math.random) {
  if (!Array.isArray(list) || list.length === 0) return null;

  return (
    list[Math.floor(random() * list.length)] ??
    list[0]
  );
}

function nowMs(clock) {
  return Number(clock?.()) || Date.now();
}

function defaultState() {
  return {
    mood: "curious",
    action: "exploring",
    energy: 72,
    fatigue: 18,
    excitement: 35,
    curiosity: 60,
    confidence: 50,
    socialWarmth: 50,
    focus: 45,
    lastActionAt: null,
    lastMoodAt: null,
    recentActions: [],
    recentReactions: [],
  };
}

export class CharacterEngine {
  constructor(options = {}) {
    this.clock =
      options.clock ||
      (() => Date.now());

    this.random =
      options.random ||
      Math.random;

    this.config = {
      ...DEFAULTS,
      ...(options.config || {}),
    };

    this.state = {
      ...defaultState(),
      ...(options.initialState || {}),
    };

    this.lastTickAt =
      nowMs(this.clock);
  }

  snapshot() {
    return {
      version: 1,

      state: {
        ...this.state,

        recentActions: [
          ...this.state.recentActions,
        ],

        recentReactions: [
          ...this.state.recentReactions,
        ],
      },
    };
  }

  restore(snapshot) {
    if (
      !snapshot ||
      typeof snapshot !== "object"
    ) {
      return false;
    }

    const incoming =
      snapshot.state ||
      snapshot;

    if (
      !incoming ||
      typeof incoming !== "object"
    ) {
      return false;
    }

    this.state = {
      ...defaultState(),
      ...incoming,

      recentActions:
        Array.isArray(
          incoming.recentActions
        )
          ? incoming.recentActions.slice(
              -this.config
                .maxRecentActions
            )
          : [],

      recentReactions:
        Array.isArray(
          incoming.recentReactions
        )
          ? incoming.recentReactions.slice(
              -this.config
                .maxRecentActions
            )
          : [],
    };

    this.lastTickAt =
      nowMs(this.clock);

    return true;
  }

  tick(context = {}) {
    const now =
      nowMs(this.clock);

    const dtMs =
      Math.max(
        0,
        now - this.lastTickAt
      );

    const minutes =
      dtMs / 60_000;

    this.lastTickAt =
      now;

    this.#decay(minutes);

    this.#syncFromWorld(
      context.world || {}
    );

    this.#resolveIdle(
      now,
      context
    );

    return this.describe(
      context
    );
  }

  applyShowEvent(
    event = {},
    consequence = {},
    world = {}
  ) {
    const now =
      nowMs(this.clock);

    const category =
      safeText(
        event.category,
        "general",
        32
      );

    const action =
      safeText(
        world.lumiAction ||
          event.action,
        this.state.action,
        32
      );

    this.state.action =
      ACTION_LIBRARY[action]
        ? action
        : this.state.action;

    this.state.lastActionAt =
      now;

    this.#rememberAction(
      this.state.action
    );

    switch (category) {
      case "discovery":
      case "rare":
        this.state.curiosity =
          clamp(
            this.state.curiosity +
              16,
            0,
            100
          );

        this.state.excitement =
          clamp(
            this.state.excitement +
              (
                category === "rare"
                  ? 28
                  : 14
              ),
            0,
            100
          );

        this.#setMood(
          category === "rare"
            ? "excited"
            : "curious",
          now
        );
        break;

      case "building":
      case "progression":
        this.state.focus =
          clamp(
            this.state.focus +
              14,
            0,
            100
          );

        this.state.confidence =
          clamp(
            this.state.confidence +
              8,
            0,
            100
          );

        this.#setMood(
          consequence.buildDelta > 0
            ? "proud"
            : "focused",
          now
        );
        break;

      case "play":
        this.state.excitement =
          clamp(
            this.state.excitement +
              18,
            0,
            100
          );

        this.#setMood(
          "playful",
          now
        );
        break;

      case "quiet":
        this.state.fatigue =
          clamp(
            this.state.fatigue -
              20,
            0,
            100
          );

        this.state.energy =
          clamp(
            this.state.energy +
              16,
            0,
            100
          );

        this.#setMood(
          this.state.energy < 35
            ? "sleepy"
            : "calm",
          now
        );
        break;

      case "tension":
        this.state.excitement =
          clamp(
            this.state.excitement +
              10,
            0,
            100
          );

        this.state.confidence =
          clamp(
            this.state.confidence -
              4,
            0,
            100
          );

        this.#setMood(
          this.state.confidence > 45
            ? "brave"
            : "surprised",
          now
        );
        break;

      case "weather":
      case "environment":
        this.state.curiosity =
          clamp(
            this.state.curiosity +
              8,
            0,
            100
          );

        this.#setMood(
          "surprised",
          now
        );
        break;

      default:
        this.#setMood(
          pick(
            [
              "curious",
              "calm",
              "playful",
            ],
            this.random
          ) || "curious",
          now
        );
    }

    const actionDef =
      ACTION_LIBRARY[
        this.state.action
      ] ||
      ACTION_LIBRARY.exploring;

    this.state.energy =
      clamp(
        this.state.energy -
          Math.max(
            0,
            actionDef.energyCost
          ),
        0,
        100
      );

    this.state.fatigue =
      clamp(
        this.state.fatigue +
          Math.max(
            0,
            actionDef.energyCost
          ) *
            0.9,
        0,
        100
      );

    return this.describe({
      world,
      event,
      consequence,
    });
  }

  reactToAudience(
    signal = {}
  ) {
    const now =
      nowMs(this.clock);

    const type =
      safeText(
        signal.type,
        "unknown",
        24
      ).toLowerCase();

    let reaction =
      "notice";

    switch (type) {
      case "like":
        this.state.socialWarmth =
          clamp(
            this.state
              .socialWarmth + 2,
            0,
            100
          );

        reaction =
          this.state
            .socialWarmth > 70
            ? "smile_to_crowd"
            : "small_smile";
        break;

      case "comment":
        this.state.curiosity =
          clamp(
            this.state.curiosity +
              5,
            0,
            100
          );

        reaction =
          "look_toward_chat";
        break;

      case "follow":
        this.state.socialWarmth =
          clamp(
            this.state
              .socialWarmth + 8,
            0,
            100
          );

        this.state.excitement =
          clamp(
            this.state.excitement +
              5,
            0,
            100
          );

        reaction =
          "welcome_wave";
        break;

      case "share":
        this.state.confidence =
          clamp(
            this.state.confidence +
              6,
            0,
            100
          );

        reaction =
          "proud_wave";
        break;

      case "gift":
        this.state.excitement =
          clamp(
            this.state.excitement +
              12,
            0,
            100
          );

        reaction =
          "special_thank_you";
        break;

      case "vote":
        this.state.focus =
          clamp(
            this.state.focus +
              8,
            0,
            100
          );

        reaction =
          "thinking_pose";
        break;

      default:
        return null;
    }

    this.state.recentReactions.push(
      {
        type,
        reaction,
        at: now,
      }
    );

    if (
      this.state
        .recentReactions.length >
      this.config
        .maxRecentActions
    ) {
      this.state
        .recentReactions.shift();
    }

    return {
      type,
      reaction,
      mood: this.state.mood,
      action: this.state.action,
      at: now,
    };
  }

  describe(context = {}) {
    const action =
      ACTION_LIBRARY[
        this.state.action
      ] ||
      ACTION_LIBRARY.exploring;

    const world =
      context.world || {};

    return {
      mood:
        this.state.mood,

      action:
        this.state.action,

      energy:
        Math.round(
          this.state.energy
        ),

      fatigue:
        Math.round(
          this.state.fatigue
        ),

      excitement:
        Math.round(
          this.state.excitement
        ),

      curiosity:
        Math.round(
          this.state.curiosity
        ),

      confidence:
        Math.round(
          this.state.confidence
        ),

      socialWarmth:
        Math.round(
          this.state.socialWarmth
        ),

      focus:
        Math.round(
          this.state.focus
        ),

      pose:
        action.pose,

      expression:
        action.expression,

      motion:
        action.motion,

      camera:
        action.camera,

      phase:
        safeText(
          world.phase,
          "day",
          16
        ),

      weather:
        safeText(
          world.weather,
          "clear",
          24
        ),

      readableState:
        this.#readableState(),

      visualPriority:
        this.#visualPriority(),

      recentReaction:
        this.state
          .recentReactions.at(-1) ||
        null,
    };
  }

  #syncFromWorld(world) {
    const action =
      safeText(
        world.lumiAction,
        this.state.action,
        32
      );

    if (
      ACTION_LIBRARY[action] &&
      action !==
        this.state.action
    ) {
      this.state.action =
        action;

      this.state.lastActionAt =
        nowMs(this.clock);

      this.#rememberAction(
        action
      );
    }

    const worldEnergy =
      finiteNumber(
        world.energy,
        NaN
      );

    if (
      Number.isFinite(
        worldEnergy
      )
    ) {
      this.state.energy =
        clamp(
          worldEnergy,
          0,
          100
        );
    }
  }

  #resolveIdle(
    now,
    context
  ) {
    const last =
      finiteNumber(
        this.state.lastActionAt,
        0
      );

    if (
      !last ||
      now - last <
        this.config
          .idleThresholdMs
    ) {
      return;
    }

    if (
      this.state.energy < 25 ||
      this.state.fatigue > 75
    ) {
      this.state.action =
        this.state.energy < 15
          ? "dreaming"
          : "resting";

      this.#setMood(
        this.state.energy < 15
          ? "sleepy"
          : "tired",
        now
      );
    } else if (
      context.audienceMode ===
      "quiet"
    ) {
      this.state.action =
        pick(
          [
            "observing",
            "gardening",
            "exploring",
          ],
          this.random
        ) ||
        "observing";

      this.#setMood(
        pick(
          [
            "calm",
            "curious",
          ],
          this.random
        ) ||
          "calm",
        now
      );
    }

    this.state.lastActionAt =
      now;

    this.#rememberAction(
      this.state.action
    );
  }

  #decay(minutes) {
    if (minutes <= 0) {
      return;
    }

    this.state.fatigue =
      clamp(
        this.state.fatigue -
          this.config
            .fatigueRecoveryPerMinute *
            minutes,
        0,
        100
      );

    this.state.excitement =
      clamp(
        this.state.excitement -
          this.config
            .excitementDecayPerMinute *
            minutes,
        0,
        100
      );

    this.state.socialWarmth =
      clamp(
        this.state
          .socialWarmth -
          this.config
            .socialWarmthDecayPerMinute *
            minutes,
        0,
        100
      );
  }

  #setMood(
    mood,
    now
  ) {
    if (
      !MOODS.includes(mood)
    ) {
      return;
    }

    this.state.mood =
      mood;

    this.state.lastMoodAt =
      now;
  }

  #rememberAction(action) {
    this.state.recentActions.push(
      action
    );

    if (
      this.state
        .recentActions.length >
      this.config
        .maxRecentActions
    ) {
      this.state
        .recentActions.shift();
    }
  }

  #readableState() {
    if (
      this.state.energy < 15
    ) {
      return "very_low_energy";
    }

    if (
      this.state.fatigue > 80
    ) {
      return "needs_rest";
    }

    if (
      this.state.excitement > 80
    ) {
      return "highly_excited";
    }

    if (
      this.state.curiosity > 80
    ) {
      return "highly_curious";
    }

    if (
      this.state.confidence > 80
    ) {
      return "very_confident";
    }

    return "balanced";
  }

  #visualPriority() {
    if (
      this.state.mood ===
        "excited" ||
      this.state.action ===
        "celebrating"
    ) {
      return "character_focus";
    }

    if (
      this.state.action ===
        "building" ||
      this.state.action ===
        "discovering"
    ) {
      return "character_plus_world";
    }

    if (
      this.state.action ===
        "resting" ||
      this.state.action ===
        "dreaming"
    ) {
      return "environment_focus";
    }

    return "balanced";
  }
}

export function createCharacterEngine(
  options = {}
) {
  return new CharacterEngine(
    options
  );
}

export function characterVisualContract() {
  return {
    requiredRendererFields: [
      "mood",
      "action",
      "pose",
      "expression",
      "motion",
      "camera",
      "energy",
      "readableState",
      "visualPriority",
    ],

    principle:
      "The audience should understand LUMI's state visually before reading any text.",
  };
}
