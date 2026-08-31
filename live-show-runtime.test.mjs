import assert from "node:assert/strict";

import {
  createLiveShowRuntime,
} from "./live-show-runtime.mjs";

function createClock(
  start = Date.UTC(
    2026,
    7,
    31,
    8,
    0,
    0
  )
) {
  let now = start;

  return {
    now: () => now,

    advance(ms) {
      now += ms;
    },
  };
}

function createRandom(
  seed = 123456789
) {
  let value =
    seed >>> 0;

  return () => {
    value =
      (
        1664525 *
          value +
        1013904223
      ) >>> 0;

    return (
      value /
      4294967296
    );
  };
}

function edgePayload(
  overrides = {}
) {
  return {
    ok: true,

    project:
      "LUMI WORLD",

    edge:
      "online",

    worldCore:
      "connected",

    world: {
      level: 4,
      xp: 920,
      communityLove: 640,
      phase: "day",
      weather: "clear",
      lumiAction:
        "exploring",
      updatedAt:
        "2026-08-31 08:00:00",

      ...overrides,
    },

    version:
      "LUMI-WORLD-EDGE-V3-SECURE-CHECKPOINT",
  };
}

function jsonResponse(
  payload,
  status = 200
) {
  return {
    ok:
      status >= 200 &&
      status < 300,

    status,

    async json() {
      return payload;
    },
  };
}

async function testHealthyEdge() {
  const clock =
    createClock();

  let requests = 0;

  const runtime =
    createLiveShowRuntime({
      clock:
        clock.now,

      random:
        createRandom(1),

      fetchImpl:
        async (url) => {
          requests += 1;

          assert.equal(
            url,
            "https://example.test/api/status"
          );

          return jsonResponse(
            edgePayload()
          );
        },

      config: {
        edgeUrl:
          "https://example.test",

        pollMs:
          5000,
      },
    });

  const sync =
    await runtime.syncWorld({
      force: true,
    });

  assert.equal(
    sync.ok,
    true
  );

  assert.equal(
    requests,
    1
  );

  assert.equal(
    sync.world.level,
    4
  );

  assert.equal(
    sync.world.xp,
    920
  );

  assert.equal(
    sync.world.communityLove,
    640
  );

  const frame =
    await runtime.frame({
      syncWorld: false,
    });

  assert.ok(
    frame.show
  );

  assert.ok(
    frame.character
  );

  assert.ok(
    frame.interactions
  );

  assert.ok(
    frame.scene
  );

  assert.equal(
    frame.source.edgeConnected,
    true
  );

  assert.equal(
    frame.source.degraded,
    false
  );

  assert.equal(
    frame.show.world.level,
    4
  );

  assert.ok(
    frame.scene.canvas
  );

  assert.equal(
    frame.scene.canvas.width,
    720
  );

  assert.equal(
    frame.scene.canvas.height,
    1280
  );

  return runtime;
}

async function testPollThrottle() {
  const clock =
    createClock();

  let requests = 0;

  const runtime =
    createLiveShowRuntime({
      clock:
        clock.now,

      random:
        createRandom(2),

      fetchImpl:
        async () => {
          requests += 1;

          return jsonResponse(
            edgePayload()
          );
        },

      config: {
        edgeUrl:
          "https://example.test",

        pollMs:
          5000,
      },
    });

  await runtime.syncWorld({
    force: true,
  });

  const second =
    await runtime.syncWorld();

  assert.equal(
    second.skipped,
    true
  );

  assert.equal(
    requests,
    1
  );

  clock.advance(5001);

  const third =
    await runtime.syncWorld();

  assert.equal(
    third.ok,
    true
  );

  assert.equal(
    third.skipped,
    false
  );

  assert.equal(
    requests,
    2
  );
}

async function testInteractionPipeline() {
  const clock =
    createClock();

  const runtime =
    createLiveShowRuntime({
      clock:
        clock.now,

      random:
        createRandom(3),

      fetchImpl:
        async () =>
          jsonResponse(
            edgePayload()
          ),

      config: {
        edgeUrl:
          "https://example.test",
      },
    });

  await runtime.syncWorld({
    force: true,
  });

  assert.equal(
    runtime.ingestInteraction({
      type: "like",
      count: 25,
    }),
    true
  );

  assert.equal(
    runtime.ingestInteraction({
      type: "comment",
      text: "ayo lumi",
    }),
    true
  );

  assert.equal(
    runtime.ingestInteraction({
      type: "follow",
    }),
    true
  );

  assert.equal(
    runtime.ingestInteraction({
      type: "invalid_type",
    }),
    false
  );

  clock.advance(1000);

  const frame =
    await runtime.frame({
      syncWorld: false,
    });

  assert.ok(
    frame.show.world
      .communityLove > 0
  );

  assert.ok(
    frame.interactions
      .aggregate.likes >= 25
  );

  assert.ok(
    frame.interactions
      .aggregate.comments >= 1
  );

  assert.ok(
    frame.interactions
      .aggregate.follows >= 1
  );

  assert.ok(
    frame.interactions
      .visible.length <= 4
  );
}

async function testDegradedMode() {
  const clock =
    createClock();

  let shouldFail =
    false;

  const runtime =
    createLiveShowRuntime({
      clock:
        clock.now,

      random:
        createRandom(4),

      fetchImpl:
        async () => {
          if (
            shouldFail
          ) {
            throw new Error(
              "simulated_edge_failure"
            );
          }

          return jsonResponse(
            edgePayload({
              level: 7,
              xp: 1700,
            })
          );
        },

      config: {
        edgeUrl:
          "https://example.test",

        pollMs:
          1000,

        maxConsecutiveFailures:
          6,
      },
    });

  const first =
    await runtime.syncWorld({
      force: true,
    });

  assert.equal(
    first.ok,
    true
  );

  assert.equal(
    first.world.level,
    7
  );

  shouldFail =
    true;

  clock.advance(1500);

  const failed =
    await runtime.syncWorld({
      force: true,
    });

  assert.equal(
    failed.ok,
    false
  );

  assert.equal(
    failed.world.level,
    7
  );

  const frame =
    await runtime.frame({
      syncWorld: false,
    });

  assert.equal(
    frame.source.edgeConnected,
    false
  );

  assert.equal(
    frame.source.degraded,
    true
  );

  assert.equal(
    frame.show.world.level,
    7
  );

  assert.ok(
    frame.scene
  );

  assert.equal(
    runtime.healthy(),
    true
  );
}

async function testInvalidPayloadFallback() {
  const clock =
    createClock();

  const runtime =
    createLiveShowRuntime({
      clock:
        clock.now,

      random:
        createRandom(5),

      initialWorld: {
        level: 3,
        xp: 300,
        communityLove: 200,
      },

      fetchImpl:
        async () =>
          jsonResponse({
            ok: true,
          }),

      config: {
        edgeUrl:
          "https://example.test",
      },
    });

  const result =
    await runtime.syncWorld({
      force: true,
    });

  assert.equal(
    result.ok,
    false
  );

  assert.equal(
    result.world.level,
    3
  );

  const frame =
    await runtime.frame({
      syncWorld: false,
    });

  assert.equal(
    frame.show.world.level,
    3
  );

  assert.ok(
    frame.scene
  );
}

async function testLongDegradedSurvival() {
  const clock =
    createClock();

  const runtime =
    createLiveShowRuntime({
      clock:
        clock.now,

      random:
        createRandom(6),

      initialWorld: {
        level: 2,
        xp: 100,
        communityLove: 50,
      },

      fetchImpl:
        async () => {
          throw new Error(
            "offline"
          );
        },

      config: {
        edgeUrl:
          "https://example.test",

        pollMs:
          1000,

        maxConsecutiveFailures:
          6,
      },
    });

  for (
    let i = 0;
    i < 10;
    i += 1
  ) {
    clock.advance(
      1100
    );

    await runtime.syncWorld({
      force: true,
    });

    const frame =
      await runtime.frame({
        syncWorld: false,
      });

    assert.ok(
      frame.scene
    );

    assert.ok(
      frame.character
    );

    assert.ok(
      frame.show
    );
  }

  assert.equal(
    runtime.healthy(),
    false
  );

  const snapshot =
    runtime.snapshot();

  assert.equal(
    snapshot.edge.degraded,
    true
  );

  assert.ok(
    snapshot.edge
      .consecutiveFailures >=
      6
  );
}

async function main() {
  const tests = [
    [
      "healthy_edge",
      testHealthyEdge,
    ],

    [
      "poll_throttle",
      testPollThrottle,
    ],

    [
      "interaction_pipeline",
      testInteractionPipeline,
    ],

    [
      "degraded_mode",
      testDegradedMode,
    ],

    [
      "invalid_payload_fallback",
      testInvalidPayloadFallback,
    ],

    [
      "long_degraded_survival",
      testLongDegradedSurvival,
    ],
  ];

  const results = [];

  for (
    const [
      name,
      test,
    ] of tests
  ) {
    const started =
      Date.now();

    try {
      await test();

      results.push({
        name,
        ok: true,
        ms:
          Date.now() -
          started,
      });

      console.log(
        `PASS ${name}`
      );
    } catch (error) {
      results.push({
        name,
        ok: false,
        error:
          error?.stack ||
          String(error),
      });

      console.error(
        `FAIL ${name}`
      );

      console.error(
        error
      );
    }
  }

  const failed =
    results.filter(
      (item) =>
        !item.ok
    );

  console.log(
    "\n===== LUMI LIVE SHOW RUNTIME INTEGRATION ====="
  );

  console.log(
    JSON.stringify(
      {
        ok:
          failed.length ===
          0,

        total:
          results.length,

        passed:
          results.length -
          failed.length,

        failed:
          failed.length,

        results,
      },
      null,
      2
    )
  );

  if (
    failed.length > 0
  ) {
    process.exitCode = 1;
  }
}

await main();
