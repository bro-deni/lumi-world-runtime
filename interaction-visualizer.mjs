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
  max = 80
) {
  const text = String(
    value ?? fallback
  )
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, max);

  return text || fallback;
}

const RULES = Object.freeze({
  like: {
    kind: "meter_pulse",
    label: "Community energy",
    priority: 1,
    ttlMs: 1400,
  },

  comment: {
    kind: "chat_spark",
    label: "LUMI noticed the chat",
    priority: 2,
    ttlMs: 2200,
  },

  follow: {
    kind: "welcome",
    label: "A new friend joined",
    priority: 3,
    ttlMs: 3000,
  },

  share: {
    kind: "community_burst",
    label: "The world is spreading",
    priority: 3,
    ttlMs: 3200,
  },

  gift: {
    kind: "special_thanks",
    label: "A special moment",
    priority: 4,
    ttlMs: 3800,
  },

  vote: {
    kind: "vote_tick",
    label: "The community is choosing",
    priority: 2,
    ttlMs: 1800,
  },
});

export class InteractionVisualizer {
  constructor(options = {}) {
    this.clock =
      options.clock ||
      (() => Date.now());

    this.random =
      options.random ||
      Math.random;

    this.queue = [];

    this.aggregate = {
      likes: 0,
      comments: 0,
      follows: 0,
      shares: 0,
      gifts: 0,
      votes: 0,
    };
  }

  ingest(signal = {}) {
    const type = safe(
      signal.type,
      "unknown",
      20
    ).toLowerCase();

    const rule =
      RULES[type];

    if (!rule) {
      return false;
    }

    const now =
      Number(this.clock()) ||
      Date.now();

    const count =
      clamp(
        signal.count ?? 1,
        0,
        1_000_000
      );

    const value =
      clamp(
        signal.value ?? 0,
        0,
        1_000_000_000
      );

    switch (type) {
      case "like":
        this.aggregate.likes += count;
        break;

      case "comment":
        this.aggregate.comments += 1;
        break;

      case "follow":
        this.aggregate.follows += 1;
        break;

      case "share":
        this.aggregate.shares += 1;
        break;

      case "gift":
        this.aggregate.gifts += 1;
        break;

      case "vote":
        this.aggregate.votes += 1;
        break;
    }

    /*
     * Likes can arrive extremely quickly.
     * Do not create one visual overlay for every like.
     */
    const shouldQueue =
      type !== "like" ||
      this.aggregate.likes % 25 === 0;

    if (shouldQueue) {
      this.queue.push({
        id:
          `${type}-${now}-` +
          Math.floor(
            this.random() *
              1_000_000
          ),

        type,

        kind:
          rule.kind,

        label:
          rule.label,

        priority:
          rule.priority,

        ttlMs:
          rule.ttlMs,

        createdAt:
          now,

        expiresAt:
          now +
          rule.ttlMs,

        count,

        value,

        text: safe(
          signal.text,
          "",
          80
        ),

        option: safe(
          signal.option,
          "",
          32
        ),
      });
    }

    /*
     * Hard queue cap prevents interaction bursts
     * from creating unbounded memory growth.
     */
    if (
      this.queue.length >
      100
    ) {
      this.queue.splice(
        0,
        this.queue.length -
          100
      );
    }

    return true;
  }

  frame() {
    const now =
      Number(this.clock()) ||
      Date.now();

    /*
     * Remove expired visual reactions.
     */
    this.queue =
      this.queue.filter(
        (item) =>
          item.expiresAt >
          now
      );

    /*
     * Highest-priority reactions appear first.
     * Never display more than four simultaneously.
     */
    const visible =
      [...this.queue]
        .sort(
          (a, b) =>
            b.priority -
              a.priority ||
            b.createdAt -
              a.createdAt
        )
        .slice(0, 4)
        .map(
          (item) => ({
            ...item,

            progress:
              clamp(
                (
                  item.expiresAt -
                  now
                ) /
                  item.ttlMs,
                0,
                1
              ),
          })
        );

    return {
      visible,

      aggregate: {
        ...this.aggregate,
      },

      policy: {
        aggregateLikes: true,

        maxVisible: 4,

        noGiftPressure: true,

        noPayToWin: true,

        noRawSpamFlood: true,
      },
    };
  }

  snapshot() {
    return {
      version: 1,

      aggregate: {
        ...this.aggregate,
      },

      queue:
        this.queue.map(
          (item) => ({
            ...item,
          })
        ),
    };
  }

  resetVisualQueue() {
    this.queue = [];
  }

  resetAggregate() {
    this.aggregate = {
      likes: 0,
      comments: 0,
      follows: 0,
      shares: 0,
      gifts: 0,
      votes: 0,
    };
  }
}

export function createInteractionVisualizer(
  options = {}
) {
  return new InteractionVisualizer(
    options
  );
}
