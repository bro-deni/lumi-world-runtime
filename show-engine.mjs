const DEFAULT_CONFIG = Object.freeze({
  tickMs: 1000,
  recentHistorySize: 18,
  recentCategorySize: 8,
  eventCooldownMs: 45_000,
  rareEventCooldownMs: 8 * 60_000,
  quietAfterMs: 45_000,
  crowdedEventsPerMinute: 1200,
  objectiveWindowMs: 15 * 60_000,
  objectiveTargetBase: 100,
  maxPendingSignals: 5000,
  maxEventWeight: 1000,
  maxWorldLevel: 100000,
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
]);

const ACTIONS = Object.freeze([
  "exploring",
  "playing",
  "gardening",
  "building",
  "observing",
  "resting",
  "celebrating",
  "discovering",
  "helping",
  "dreaming",
]);

const MICRO_EVENTS = Object.freeze([
  {
    id: "butterfly_chase",
    category: "discovery",
    title: "A tiny visitor appears",
    summary:
      "LUMI notices something fluttering nearby and follows it.",
    moods: ["curious", "playful"],
    actions: ["exploring", "discovering"],
    weight: 8,
    minEnergy: 15,
  },
  {
    id: "garden_sprout",
    category: "growth",
    title: "Something new is growing",
    summary:
      "A fresh sprout appears in the garden and LUMI checks on it.",
    moods: ["curious", "proud"],
    actions: ["gardening", "observing"],
    weight: 9,
    minEnergy: 10,
  },
  {
    id: "lost_object",
    category: "tension",
    title: "Where did it go?",
    summary:
      "LUMI realizes a favorite object is missing and starts searching.",
    moods: ["surprised", "curious"],
    actions: ["exploring", "discovering"],
    weight: 6,
    minEnergy: 20,
  },
  {
    id: "tiny_build",
    category: "building",
    title: "A small project begins",
    summary:
      "LUMI starts adding a new detail to the world.",
    moods: ["proud", "excited"],
    actions: ["building"],
    weight: 9,
    minEnergy: 25,
  },
  {
    id: "cloud_watch",
    category: "quiet",
    title: "A calm moment",
    summary:
      "LUMI pauses and watches the world change around them.",
    moods: ["calm", "sleepy"],
    actions: ["observing", "resting"],
    weight: 8,
    minEnergy: 0,
  },
  {
    id: "sudden_breeze",
    category: "environment",
    title: "The weather shifts",
    summary:
      "A sudden breeze changes the mood of the scene.",
    moods: ["surprised", "curious"],
    actions: ["observing"],
    weight: 7,
    minEnergy: 5,
  },
  {
    id: "treasure_glint",
    category: "discovery",
    title: "Something is shining",
    summary:
      "LUMI spots a glint in the distance and investigates.",
    moods: ["excited", "curious"],
    actions: ["discovering", "exploring"],
    weight: 5,
    minEnergy: 20,
  },
  {
    id: "nap_attempt",
    category: "quiet",
    title: "Nap time?",
    summary:
      "LUMI tries to rest, but the world may have other plans.",
    moods: ["sleepy", "calm"],
    actions: ["resting", "dreaming"],
    weight: 7,
    minEnergy: 0,
  },
  {
    id: "practice_jump",
    category: "play",
    title: "LUMI practices",
    summary:
      "A playful practice session turns into a tiny personal challenge.",
    moods: ["playful", "proud"],
    actions: ["playing"],
    weight: 8,
    minEnergy: 25,
  },
  {
    id: "night_light",
    category: "environment",
    title: "A light appears",
    summary:
      "A soft light changes the atmosphere and catches LUMI's attention.",
    moods: ["curious", "calm"],
    actions: ["observing", "discovering"],
    weight: 6,
    minEnergy: 5,
  },
]);

const WORLD_EVENTS = Object.freeze([
  {
    id: "rain_arrives",
    category: "weather",
    title: "Rain reaches LUMI WORLD",
    summary:
      "The world changes under the rain and new opportunities appear.",
    weight: 4,
    minLevel: 1,
    cooldownMs: 4 * 60_000,
  },
  {
    id: "community_build",
    category: "building",
    title: "A community build begins",
    summary:
      "Progress becomes visible in the world and can continue across sessions.",
    weight: 7,
    minLevel: 1,
    cooldownMs: 3 * 60_000,
  },
  {
    id: "rare_discovery",
    category: "rare",
    title: "A rare discovery!",
    summary:
      "LUMI finds something unusual that becomes part of the world's memory.",
    weight: 2,
    minLevel: 1,
    cooldownMs: 8 * 60_000,
    rare: true,
  },
  {
    id: "world_transition",
    category: "progression",
    title: "The world is changing",
    summary:
      "A visible transition marks continued world progression.",
    weight: 4,
    minLevel: 2,
    cooldownMs: 6 * 60_000,
  },
]);

function nowMs(clock) {
  return Number(clock?.()) || Date.now();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function weightedPick(items, random) {
  const total = items.reduce(
    (sum, item) =>
      sum + Math.max(0, item.weight || 0),
    0
  );

  if (total <= 0) {
    return items[0] || null;
  }

  let cursor = random() * total;

  for (const item of items) {
    cursor -= Math.max(
      0,
      item.weight || 0
    );

    if (cursor <= 0) {
      return item;
    }
  }

  return items[items.length - 1] || null;
}

function stableRandom(seed) {
  let x = (Number(seed) || 1) >>> 0;

  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;

    return (
      (x >>> 0) /
      4294967296
    );
  };
}

function interactionScore(signal) {
  switch (signal.type) {
    case "like":
      return Math.min(
        5,
        Math.log10(
          1 +
            finiteNumber(
              signal.count,
              1
            )
        ) + 1
      );

    case "comment":
      return 4;

    case "follow":
      return 10;

    case "share":
      return 12;

    case "gift":
      return clamp(
        8 +
          Math.log10(
            1 +
              finiteNumber(
                signal.value,
                0
              )
          ) *
            5,
        8,
        40
      );

    case "vote":
      return 5;

    default:
      return 1;
  }
}

function defaultWorldState() {
  return {
    level: 1,
    xp: 0,
    communityLove: 0,
    phase: "day",
    weather: "clear",
    lumiAction: "exploring",
    lumiMood: "curious",
    energy: 70,
    buildProgress: 0,
    objectiveProgress: 0,
    objectiveTarget: 100,
    nextMilestone:
      "First community build",
    updatedAt: null,
  };
}

export class ShowEngine {
  constructor(options = {}) {
    this.clock =
      options.clock ||
      (() => Date.now());

    this.random =
      options.random ||
      Math.random;

    this.config = {
      ...DEFAULT_CONFIG,
      ...(options.config || {}),
    };

    this.world = {
      ...defaultWorldState(),
      ...(options.initialWorld || {}),
    };

    this.recentEventIds = [];
    this.recentCategories = [];
    this.lastEventAt = 0;
    this.lastRareEventAt = 0;
    this.lastAudienceSignalAt = 0;
    this.signalWindow = [];
    this.pendingSignals = [];
    this.cooldowns = new Map();
    this.communityObjective =
      this.#newObjective();
    this.sequence = 0;
  }

  snapshot() {
    return {
      version: 1,

      world: {
        ...this.world,
      },

      audienceMode:
        this.#audienceMode(),

      objective: {
        ...this.communityObjective,
      },

      recentEvents: [
        ...this.recentEventIds,
      ],

      pendingSignals:
        this.pendingSignals.length,

      sequence:
        this.sequence,
    };
  }

  restore(snapshot) {
    if (
      !snapshot ||
      typeof snapshot !== "object"
    ) {
      return false;
    }

    if (
      snapshot.world &&
      typeof snapshot.world === "object"
    ) {
      this.world = {
        ...defaultWorldState(),
        ...snapshot.world,
      };
    }

    if (
      snapshot.objective &&
      typeof snapshot.objective === "object"
    ) {
      this.communityObjective = {
        ...this.#newObjective(),
        ...snapshot.objective,
      };
    }

    this.recentEventIds =
      Array.isArray(
        snapshot.recentEvents
      )
        ? snapshot.recentEvents.slice(
            -this.config
              .recentHistorySize
          )
        : [];

    this.sequence =
      finiteNumber(
        snapshot.sequence,
        0
      );

    return true;
  }

  ingest(signal) {
    if (
      !signal ||
      typeof signal !== "object"
    ) {
      return false;
    }

    const type =
      safeText(
        signal.type,
        "unknown",
        32
      ).toLowerCase();

    if (
      ![
        "like",
        "comment",
        "follow",
        "share",
        "gift",
        "vote",
      ].includes(type)
    ) {
      return false;
    }

    const normalized = {
      type,

      count: clamp(
        Math.floor(
          finiteNumber(
            signal.count,
            1
          )
        ),
        0,
        1_000_000
      ),

      value: clamp(
        Math.floor(
          finiteNumber(
            signal.value,
            0
          )
        ),
        0,
        1_000_000_000
      ),

      text: safeText(
        signal.text,
        "",
        160
      ),

      option: safeText(
        signal.option,
        "",
        64
      ),

      at:
        nowMs(this.clock),
    };

    this.lastAudienceSignalAt =
      normalized.at;

    this.signalWindow.push(
      normalized
    );

    this.pendingSignals.push(
      normalized
    );

    if (
      this.pendingSignals.length >
      this.config.maxPendingSignals
    ) {
      this.pendingSignals.splice(
        0,
        this.pendingSignals.length -
          this.config
            .maxPendingSignals
      );
    }

    this.#trimSignalWindow(
      normalized.at
    );

    return true;
  }

  tick() {
    const now =
      nowMs(this.clock);

    this.#trimSignalWindow(now);
    this.#applyAudienceConsequences();
    this.#updateObjective(now);
    this.#updateEnergy();

    const event =
      this.#selectShowEvent(now);

    if (!event) {
      return {
        type: "heartbeat",
        at: now,

        audienceMode:
          this.#audienceMode(),

        world: {
          ...this.world,
        },

        objective: {
          ...this.communityObjective,
        },
      };
    }

    this.#rememberEvent(
      event,
      now
    );

    const consequence =
      this.#applyEvent(
        event,
        now
      );

    return {
      type: "show_event",
      at: now,

      audienceMode:
        this.#audienceMode(),

      event,

      consequence,

      world: {
        ...this.world,
      },

      objective: {
        ...this.communityObjective,
      },
    };
  }

  #trimSignalWindow(now) {
    const cutoff =
      now - 60_000;

    while (
      this.signalWindow.length &&
      this.signalWindow[0].at <
        cutoff
    ) {
      this.signalWindow.shift();
    }
  }

  #audienceMode() {
    const now =
      nowMs(this.clock);

    const recentCount =
      this.signalWindow.length;

    const quiet =
      !this.lastAudienceSignalAt ||
      now -
        this.lastAudienceSignalAt >=
        this.config.quietAfterMs;

    if (quiet) {
      return "quiet";
    }

    if (
      recentCount >=
      this.config
        .crowdedEventsPerMinute
    ) {
      return "crowded";
    }

    return "active";
  }

  #applyAudienceConsequences() {
    if (
      !this.pendingSignals.length
    ) {
      return;
    }

    const batch =
      this.pendingSignals.splice(
        0,
        this.pendingSignals.length
      );

    let love = 0;
    let xp = 0;
    let energy = 0;
    let build = 0;
    let objective = 0;

    for (
      const signal of batch
    ) {
      const score =
        interactionScore(signal);

      switch (signal.type) {
        case "like":
          love += Math.max(
            1,
            Math.floor(score)
          );

          energy += Math.max(
            1,
            Math.floor(
              score / 2
            )
          );

          objective += Math.max(
            1,
            Math.floor(score)
          );
          break;

        case "comment":
          xp += 2;
          objective += 2;
          break;

        case "follow":
          xp += 8;
          build += 3;
          objective += 5;
          break;

        case "share":
          xp += 10;
          build += 4;
          objective += 6;
          break;

        case "gift":
          xp += Math.floor(
            score
          );

          build += Math.floor(
            score / 2
          );

          objective += Math.floor(
            score / 2
          );
          break;

        case "vote":
          xp += 2;
          objective += 2;
          break;
      }
    }

    this.world.communityLove +=
      love;

    this.world.xp += xp;

    this.world.energy =
      clamp(
        this.world.energy +
          energy,
        0,
        100
      );

    this.world.buildProgress =
      clamp(
        this.world.buildProgress +
          build,
        0,
        100
      );

    this.world.objectiveProgress +=
      objective;

    const levelThreshold =
      this.world.level * 250;

    if (
      this.world.xp >=
        levelThreshold &&
      this.world.level <
        this.config.maxWorldLevel
    ) {
      this.world.level += 1;

      this.world.lumiMood =
        "proud";

      this.world.lumiAction =
        "celebrating";
    }
  }

  #updateObjective(now) {
    if (
      this.world
        .objectiveProgress >=
        this.communityObjective
          .target ||
      now >=
        this.communityObjective
          .endsAt
    ) {
      const completed =
        this.world
          .objectiveProgress >=
        this.communityObjective
          .target;

      if (completed) {
        this.world.buildProgress =
          clamp(
            this.world
              .buildProgress +
              10,
            0,
            100
          );

        this.world.xp += 25;

        this.world.lumiMood =
          "proud";

        this.world.lumiAction =
          "celebrating";
      }

      this.communityObjective =
        this.#newObjective(now);

      this.world
        .objectiveProgress = 0;

      this.world
        .objectiveTarget =
        this.communityObjective
          .target;
    }
  }

  #newObjective(
    now = nowMs(this.clock)
  ) {
    const target =
      Math.max(
        20,
        Math.floor(
          this.config
            .objectiveTargetBase *
            (
              1 +
              Math.max(
                0,
                finiteNumber(
                  this.world
                    ?.level,
                  1
                ) - 1
              ) *
                0.08
            )
        )
      );

    return {
      id:
        `objective-${now}-` +
        Math.floor(
          this.random() *
            1_000_000
        ),

      title:
        "Help LUMI finish the next world improvement",

      type:
        "community_progress",

      target,

      startsAt: now,

      endsAt:
        now +
        this.config
          .objectiveWindowMs,
    };
  }

  #updateEnergy() {
    const mode =
      this.#audienceMode();

    if (mode === "quiet") {
      this.world.energy =
        clamp(
          this.world.energy -
            0.5,
          0,
          100
        );
    } else if (
      mode === "crowded"
    ) {
      this.world.energy =
        clamp(
          this.world.energy + 1,
          0,
          100
        );
    } else {
      this.world.energy =
        clamp(
          this.world.energy +
            0.2,
          0,
          100
        );
    }
  }

  #selectShowEvent(now) {
    const sinceLast =
      now - this.lastEventAt;

    const mode =
      this.#audienceMode();

    const minGap =
      mode === "quiet"
        ? 12_000
        : mode === "crowded"
          ? 8_000
          : 10_000;

    if (
      sinceLast < minGap
    ) {
      return null;
    }

    const candidates = [];

    for (
      const event of
      MICRO_EVENTS
    ) {
      if (
        this.recentEventIds
          .includes(event.id)
      ) {
        continue;
      }

      if (
        this.world.energy <
        finiteNumber(
          event.minEnergy,
          0
        )
      ) {
        continue;
      }

      if (
        now <
        finiteNumber(
          this.cooldowns.get(
            event.id
          ),
          0
        )
      ) {
        continue;
      }

      let weight =
        event.weight;

      if (
        mode === "quiet" &&
        [
          "quiet",
          "discovery",
          "environment",
        ].includes(
          event.category
        )
      ) {
        weight *= 1.5;
      }

      if (
        mode ===
          "crowded" &&
        [
          "building",
          "play",
          "tension",
        ].includes(
          event.category
        )
      ) {
        weight *= 1.4;
      }

      if (
        this.recentCategories
          .includes(
            event.category
          )
      ) {
        weight *= 0.45;
      }

      candidates.push({
        ...event,
        weight,
      });
    }

    const worldEventEligible =
      now - this.lastEventAt >=
      this.config
        .eventCooldownMs;

    if (
      worldEventEligible
    ) {
      for (
        const event of
        WORLD_EVENTS
      ) {
        if (
          this.recentEventIds
            .includes(event.id)
        ) {
          continue;
        }

        if (
          this.world.level <
          event.minLevel
        ) {
          continue;
        }

        if (
          now <
          finiteNumber(
            this.cooldowns.get(
              event.id
            ),
            0
          )
        ) {
          continue;
        }

        if (
          event.rare &&
          now -
            this.lastRareEventAt <
            this.config
              .rareEventCooldownMs
        ) {
          continue;
        }

        let weight =
          event.weight;

        if (
          mode === "active" ||
          mode === "crowded"
        ) {
          weight *= 1.25;
        }

        candidates.push({
          ...event,
          weight,
        });
      }
    }

    if (
      !candidates.length
    ) {
      return null;
    }

    return weightedPick(
      candidates.map(
        (event) => ({
          ...event,

          weight: clamp(
            event.weight,
            0.1,
            this.config
              .maxEventWeight
          ),
        })
      ),
      this.random
    );
  }

  #rememberEvent(
    event,
    now
  ) {
    this.lastEventAt = now;

    this.recentEventIds.push(
      event.id
    );

    this.recentCategories.push(
      event.category
    );

    if (
      this.recentEventIds
        .length >
      this.config
        .recentHistorySize
    ) {
      this.recentEventIds.shift();
    }

    if (
      this.recentCategories
        .length >
      this.config
        .recentCategorySize
    ) {
      this.recentCategories.shift();
    }

    const cooldown =
      finiteNumber(
        event.cooldownMs,

        event.rare
          ? this.config
              .rareEventCooldownMs
          : this.config
              .eventCooldownMs
      );

    this.cooldowns.set(
      event.id,
      now + cooldown
    );

    if (event.rare) {
      this.lastRareEventAt =
        now;
    }
  }

  #applyEvent(
    event,
    now
  ) {
    this.sequence += 1;

    const seed =
      now +
      this.sequence * 9973;

    const random =
      stableRandom(seed);

    const moodOptions =
      event.moods?.length
        ? event.moods
        : MOODS;

    const actionOptions =
      event.actions?.length
        ? event.actions
        : ACTIONS;

    this.world.lumiMood =
      moodOptions[
        Math.floor(
          random() *
            moodOptions.length
        )
      ] || "curious";

    this.world.lumiAction =
      actionOptions[
        Math.floor(
          random() *
            actionOptions.length
        )
      ] || "exploring";

    let xpDelta = 1;
    let buildDelta = 0;
    let energyDelta = 0;
    let weather =
      this.world.weather;

    switch (
      event.category
    ) {
      case "building":
        buildDelta = 3;
        xpDelta = 4;
        energyDelta = -4;
        break;

      case "discovery":
      case "rare":
        xpDelta =
          event.rare
            ? 15
            : 5;

        energyDelta = -3;
        break;

      case "play":
        xpDelta = 3;
        energyDelta = -5;
        break;

      case "quiet":
        xpDelta = 1;
        energyDelta = 8;
        break;

      case "weather":
        weather =
          this.world.weather ===
          "rain"
            ? "clear"
            : "rain";

        xpDelta = 2;
        break;

      case "environment":
        xpDelta = 2;
        break;

      case "tension":
        xpDelta = 4;
        energyDelta = -2;
        break;

      case "progression":
        xpDelta = 10;
        buildDelta = 5;
        break;
    }

    this.world.xp +=
      xpDelta;

    this.world.buildProgress =
      clamp(
        this.world
          .buildProgress +
          buildDelta,
        0,
        100
      );

    this.world.energy =
      clamp(
        this.world.energy +
          energyDelta,
        0,
        100
      );

    const weatherChanged =
      weather !==
      this.world.weather;

    this.world.weather =
      weather;

    this.world.updatedAt =
      new Date(
        now
      ).toISOString();

    if (
      this.world
        .buildProgress >=
      100
    ) {
      this.world
        .buildProgress = 0;

      this.world
        .nextMilestone =
        "A new part of LUMI WORLD has been unlocked";

      this.world.lumiMood =
        "proud";

      this.world.lumiAction =
        "celebrating";

      this.world.xp += 20;
    }

    return {
      xpDelta,
      buildDelta,
      energyDelta,
      weatherChanged,

      visibleEffect:
        this.#visibleEffectFor(
          event
        ),

      returnHook:
        this.#returnHookFor(
          event
        ),
    };
  }

  #visibleEffectFor(event) {
    const map = {
      building:
        "construction_progress",

      discovery:
        "discovery_reveal",

      rare:
        "rare_world_reveal",

      weather:
        "weather_transition",

      environment:
        "environment_animation",

      play:
        "character_play_animation",

      quiet:
        "calm_character_routine",

      tension:
        "problem_then_resolution",

      progression:
        "world_upgrade_transition",

      growth:
        "growth_animation",
    };

    return (
      map[event.category] ||
      "character_reaction"
    );
  }

  #returnHookFor(event) {
    if (event.rare) {
      return (
        "Rare discovery becomes part " +
        "of persistent world memory"
      );
    }

    if (
      event.category ===
      "building"
    ) {
      return (
        "Visible unfinished construction " +
        "remains for next session"
      );
    }

    if (
      event.category ===
      "progression"
    ) {
      return (
        "Next world milestone " +
        "becomes visible"
      );
    }

    return (
      "Community objective and world " +
      "progress remain visible"
    );
  }
}

export function createShowEngine(
  options = {}
) {
  return new ShowEngine(
    options
  );
}

export function describeInteractionConsequence(
  type
) {
  switch (
    String(
      type || ""
    ).toLowerCase()
  ) {
    case "like":
      return {
        channel:
          "community_energy",

        visible:
          "Community meter fills in aggregate",

        note:
          "No one-tap-one-write persistence requirement",
      };

    case "comment":
      return {
        channel:
          "conversation_or_vote",

        visible:
          "LUMI reacts or the comment contributes to a choice",

        note:
          "Comments are validated and aggregated before world consequences",
      };

    case "follow":
      return {
        channel:
          "attachment",

        visible:
          "Welcome reaction plus small world-progress contribution",

        note:
          "Follow does not grant disproportionate economic advantage",
      };

    case "share":
      return {
        channel:
          "community_growth",

        visible:
          "World-progress burst or community celebration",

        note:
          "No fake sharing or pressure prompt",
      };

    case "gift":
      return {
        channel:
          "special_event",

        visible:
          "Special but bounded visual/world event",

        note:
          "Gifts are optional; no coercive gifting pressure or pay-to-win gate",
      };

    case "vote":
      return {
        channel:
          "collective_choice",

        visible:
          "Audience choice changes the next world action",

        note:
          "Voting remains bounded by cooldown and anti-spam aggregation",
      };

    default:
      return {
        channel:
          "none",

        visible:
          "No effect",

        note:
          "Unknown interaction is ignored",
      };
  }
}
