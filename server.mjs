import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 10000);

const EDGE_URL = (
  process.env.LUMI_EDGE_URL ||
  "https://lumi-world-core.lumi-world.workers.dev"
).replace(/\/+$/, "");

const EVENT_SECRET = process.env.EVENT_SECRET || "";

const AUTONOMY_SECONDS = Math.max(
  60,
  Number(process.env.LUMI_AUTONOMY_SECONDS || 300)
);

const VERSION = "LUMI-RENDER-RUNTIME-FREE-V1";

const runtime = {
  startedAt: Date.now(),
  lastSyncAt: null,
  lastCheckpointAt: null,
  lastCheckpointOk: false,
  world: null,
  errors: 0,
  cycles: 0,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${EDGE_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `${path} HTTP ${response.status}: ${
        data?.error || "request_failed"
      }`
    );
  }

  return data;
}

async function syncWorld() {
  const data = await fetchJson("/api/status");

  runtime.world = data.world;
  runtime.lastSyncAt = Date.now();

  return data.world;
}

function sign(body) {
  return crypto
    .createHmac("sha256", EVENT_SECRET)
    .update(body)
    .digest("hex");
}

async function sendAutonomousCheckpoint() {
  if (
    !EVENT_SECRET ||
    EVENT_SECRET.length < 32
  ) {
    throw new Error(
      "EVENT_SECRET missing or weak"
    );
  }

  const currentWorld = await syncWorld();

  const now = Date.now();

  const actions = [
    "exploring",
    "resting",
    "watching_stars",
    "playing",
    "gardening",
  ];

  const action =
    actions[
      runtime.cycles % actions.length
    ];

  /*
    IMPORTANT:

    Autonomous world activity is NOT fake TikTok engagement.

    No comments, follows, shares, likes or gifts
    are manufactured here.

    This checkpoint only proves that LUMI's
    persistent world can continue evolving
    while the Founder's laptop is offline.
  */

  const payload = {
    batchId:
      `autonomy-${now}-` +
      crypto
        .randomBytes(4)
        .toString("hex"),

    timestamp: now,

    bucket:
      new Date(now).toISOString(),

    metrics: {
      comments: 0,
      follows: 0,
      shares: 0,
      likes: 0,
      gifts: 0,
      giftValue: 0,
    },

    world: {
      xpDelta: 1,
      loveDelta: 0,

      level: Number(
        currentWorld?.level || 1
      ),

      phase: String(
        currentWorld?.phase || "day"
      ),

      weather: String(
        currentWorld?.weather || "clear"
      ),

      lumiAction: action,
    },
  };

  const body =
    JSON.stringify(payload);

  const signature =
    sign(body);

  const result =
    await fetchJson(
      "/api/checkpoint",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "x-lumi-signature":
            signature,
        },

        body,
      }
    );

  runtime.lastCheckpointAt =
    Date.now();

  runtime.lastCheckpointOk =
    true;

  runtime.world =
    result.world;

  runtime.cycles += 1;

  console.log(
    JSON.stringify({
      event:
        "autonomous_checkpoint",

      cycle:
        runtime.cycles,

      world:
        runtime.world,
    })
  );
}

async function autonomyLoop() {
  /*
    Give the web service time to become healthy
    before the first Cloudflare checkpoint.
  */

  await sleep(5000);

  while (true) {
    try {
      await sendAutonomousCheckpoint();
    } catch (error) {
      runtime.errors += 1;

      runtime.lastCheckpointOk =
        false;

      console.error(
        JSON.stringify({
          event:
            "checkpoint_error",

          message:
            error.message,
        })
      );
    }

    await sleep(
      AUTONOMY_SECONDS * 1000
    );
  }
}

const server =
  http.createServer(
    async (request, response) => {
      response.setHeader(
        "content-type",
        "application/json; charset=utf-8"
      );

      response.setHeader(
        "cache-control",
        "no-store"
      );

      if (
        request.url === "/health"
      ) {
        response.statusCode = 200;

        response.end(
          JSON.stringify({
            ok: true,

            service:
              "lumi-runtime",

            version:
              VERSION,

            uptimeSeconds:
              Math.floor(
                (
                  Date.now() -
                  runtime.startedAt
                ) / 1000
              ),
          })
        );

        return;
      }

      if (
        request.url === "/ready"
      ) {
        const ready =
          Boolean(
            EVENT_SECRET &&
            EVENT_SECRET.length >= 32 &&
            runtime.lastSyncAt
          );

        response.statusCode =
          ready ? 200 : 503;

        response.end(
          JSON.stringify({
            ok: ready,
            ready,

            edge:
              EDGE_URL,

            lastSyncAt:
              runtime.lastSyncAt,

            lastCheckpointOk:
              runtime.lastCheckpointOk,

            version:
              VERSION,
          })
        );

        return;
      }

      if (
        request.url === "/status"
      ) {
        response.statusCode = 200;

        response.end(
          JSON.stringify({
            ok: true,

            startedAt:
              runtime.startedAt,

            lastSyncAt:
              runtime.lastSyncAt,

            lastCheckpointAt:
              runtime.lastCheckpointAt,

            lastCheckpointOk:
              runtime.lastCheckpointOk,

            world:
              runtime.world,

            errors:
              runtime.errors,

            cycles:
              runtime.cycles,

            version:
              VERSION,
          })
        );

        return;
      }

      response.statusCode = 200;

      response.end(
        JSON.stringify({
          ok: true,

          project:
            "LUMI WORLD",

          role:
            "cloud-runtime-proof",

          version:
            VERSION,

          renderer:
            "benchmark_pending",

          message:
            "LUMI cloud runtime is alive.",
        })
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `LUMI runtime listening on port ${PORT}`
    );
  }
);

autonomyLoop();
