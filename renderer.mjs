import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const VERSION = "LUMI-WORLD-RENDERER-V1";

const PORT = numberEnv("PORT", 8080);

const EDGE_URL = normalizeBaseUrl(
  process.env.LUMI_EDGE_URL ||
    "https://lumi-world-core.lumi-world.workers.dev"
);

const STATUS_URL =
  process.env.LUMI_STATUS_URL ||
  `${EDGE_URL}/api/status`;

const WIDTH = numberEnv("LUMI_RENDER_WIDTH", 720);
const HEIGHT = numberEnv("LUMI_RENDER_HEIGHT", 1280);
const FPS = numberEnv("LUMI_RENDER_FPS", 30);

const VIDEO_BITRATE =
  process.env.LUMI_VIDEO_BITRATE || "3000k";

const VIDEO_MAXRATE =
  process.env.LUMI_VIDEO_MAXRATE || "3500k";

const VIDEO_BUFSIZE =
  process.env.LUMI_VIDEO_BUFSIZE || "6000k";

const VIDEO_PRESET =
  process.env.LUMI_VIDEO_PRESET || "veryfast";

const AUDIO_BITRATE =
  process.env.LUMI_AUDIO_BITRATE || "128k";

const POLL_MS = clamp(
  numberEnv("LUMI_RENDER_POLL_MS", 5000),
  1000,
  60000
);

const RETRY_MIN_MS = clamp(
  numberEnv("LUMI_RENDER_RETRY_MIN_MS", 2000),
  1000,
  60000
);

const RETRY_MAX_MS = clamp(
  numberEnv("LUMI_RENDER_RETRY_MAX_MS", 30000),
  RETRY_MIN_MS,
  300000
);

const DRY_RUN =
  String(
    process.env.LUMI_RENDER_DRY_RUN ?? "true"
  ).toLowerCase() !== "false";

const RTMP_URL =
  process.env.LUMI_RTMP_URL?.trim() || "";

const LOG_LEVEL =
  (
    process.env.LUMI_LOG_LEVEL ||
    "info"
  ).toLowerCase();

const startedAt = new Date();

let shuttingDown = false;
let rendererProcess = null;
let pollTimer = null;
let restartTimer = null;
let restartDelayMs = RETRY_MIN_MS;

let latestWorld = {
  version: 1,
  level: 1,
  xp: 0,
  communityLove: 0,
  phase: "day",
  weather: "clear",
  lumiAction: "exploring",
  updatedAt: null
};

const state = {
  version: VERSION,

  mode: DRY_RUN
    ? "dry_run"
    : "rtmp",

  edgeUrl: EDGE_URL,
  statusUrl: STATUS_URL,

  renderer: {
    status: "initializing",

    width: WIDTH,
    height: HEIGHT,
    fps: FPS,

    videoCodec: "libx264",
    videoPreset: VIDEO_PRESET,
    videoBitrate: VIDEO_BITRATE,

    audioCodec: "aac",
    audioBitrate: AUDIO_BITRATE,

    container: "flv",

    ffmpegAvailable: false,
    ffmpegVersion: null,

    pid: null,

    startedAt: null,
    stoppedAt: null,

    restartCount: 0,

    lastExitCode: null,
    lastExitSignal: null,

    lastError: null
  },

  worldSource: {
    connected: false,

    lastSuccessAt: null,
    lastAttemptAt: null,

    consecutiveFailures: 0,

    lastError: null
  },

  stream: {
    configured:
      !DRY_RUN &&
      Boolean(RTMP_URL),

    target:
      !DRY_RUN &&
      Boolean(RTMP_URL)
        ? "configured"
        : "not_configured",

    connected: false,

    lastStartAt: null
  },

  world: {
    ...latestWorld
  }
};

function numberEnv(name, fallback) {
  const raw = process.env[name];

  if (
    raw === undefined ||
    raw === null ||
    raw === ""
  ) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function normalizeBaseUrl(value) {
  return String(value)
    .trim()
    .replace(/\/+$/, "");
}

function log(level, event, data = {}) {
  const priorities = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
  };

  const configured =
    priorities[LOG_LEVEL] ??
    priorities.info;

  const requested =
    priorities[level] ??
    priorities.info;

  if (requested < configured) {
    return;
  }

  const entry = {
    timestamp:
      new Date().toISOString(),

    level,
    service:
      "lumi-world-renderer",

    version: VERSION,
    event,

    ...data
  };

  const line =
    JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function safeWorld(input) {
  const source =
    input &&
    typeof input === "object"
      ? input
      : {};

  return {
    version:
      finiteNumber(
        source.version,
        latestWorld.version
      ),

    level:
      finiteNumber(
        source.level,
        latestWorld.level
      ),

    xp:
      finiteNumber(
        source.xp,
        latestWorld.xp
      ),

    communityLove:
      finiteNumber(
        source.communityLove,
        latestWorld.communityLove
      ),

    phase:
      safeText(
        source.phase,
        latestWorld.phase,
        24
      ),

    weather:
      safeText(
        source.weather,
        latestWorld.weather,
        32
      ),

    lumiAction:
      safeText(
        source.lumiAction,
        latestWorld.lumiAction,
        48
      ),

    updatedAt:
      source.updatedAt
        ? String(
            source.updatedAt
          ).slice(0, 64)
        : latestWorld.updatedAt
  };
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function safeText(
  value,
  fallback,
  maxLength
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value)
    .replace(
      /[\r\n\t]/g,
      " "
    )
    .replace(
      /[^a-zA-Z0-9 _.-]/g,
      ""
    )
    .trim()
    .slice(
      0,
      maxLength
    ) || fallback;
}

async function fetchWorld() {
  state.worldSource.lastAttemptAt =
    new Date().toISOString();

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      8000
    );

  try {
    const response =
      await fetch(
        STATUS_URL,
        {
          method: "GET",

          headers: {
            accept:
              "application/json",

            "user-agent":
              `${VERSION}/1.0`
          },

          signal:
            controller.signal
        }
      );

    if (!response.ok) {
      throw new Error(
        `world_status_http_${response.status}`
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
        "invalid_world_status_payload"
      );
    }

    latestWorld =
      safeWorld(
        payload.world
      );

    state.world = {
      ...latestWorld
    };

    state.worldSource.connected =
      true;

    state.worldSource.lastSuccessAt =
      new Date().toISOString();

    state.worldSource.consecutiveFailures =
      0;

    state.worldSource.lastError =
      null;

    log(
      "debug",
      "world_state_updated",
      {
        level:
          latestWorld.level,

        xp:
          latestWorld.xp,

        communityLove:
          latestWorld.communityLove,

        phase:
          latestWorld.phase,

        weather:
          latestWorld.weather,

        lumiAction:
          latestWorld.lumiAction
      }
    );
  } catch (error) {
    state.worldSource.connected =
      false;

    state.worldSource.consecutiveFailures +=
      1;

    state.worldSource.lastError =
      error?.message ||
      String(error);

    log(
      "warn",
      "world_state_fetch_failed",
      {
        error:
          state.worldSource.lastError,

        consecutiveFailures:
          state.worldSource
            .consecutiveFailures
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function scheduleWorldPolling() {
  if (shuttingDown) {
    return;
  }

  clearTimeout(pollTimer);

  pollTimer =
    setTimeout(
      async () => {
        await fetchWorld();

        scheduleWorldPolling();
      },
      POLL_MS
    );
}

function checkFfmpeg() {
  const check =
    spawnSync(
      "ffmpeg",
      ["-version"],
      {
        encoding: "utf8",
        timeout: 10000
      }
    );

  if (
    check.error ||
    check.status !== 0
  ) {
    state.renderer.ffmpegAvailable =
      false;

    state.renderer.lastError =
      "ffmpeg_not_available";

    log(
      "error",
      "ffmpeg_not_available",
      {
        error:
          check.error?.message ||
          null,

        exitCode:
          check.status
      }
    );

    return false;
  }

  state.renderer.ffmpegAvailable =
    true;

  state.renderer.ffmpegVersion =
    (
      check.stdout ||
      check.stderr ||
      ""
    )
      .split("\n")[0]
      .trim();

  log(
    "info",
    "ffmpeg_detected",
    {
      ffmpegVersion:
        state.renderer
          .ffmpegVersion
    }
  );

  return true;
}

function escapeDrawtext(value) {
  return String(value)
    .replace(
      /\\/g,
      "\\\\"
    )
    .replace(
      /:/g,
      "\\:"
    )
    .replace(
      /'/g,
      "\\'"
    )
    .replace(
      /%/g,
      "\\%"
    );
}

function phaseColor() {
  switch (
    latestWorld.phase
      .toLowerCase()
  ) {
    case "night":
      return "0x10152F";

    case "sunset":
    case "evening":
      return "0x4A2348";

    case "dawn":
    case "morning":
      return "0x304D67";

    default:
      return "0x17324D";
  }
}

function weatherAccent() {
  switch (
    latestWorld.weather
      .toLowerCase()
  ) {
    case "rain":
    case "rainy":
      return "0x4FC3F7";

    case "storm":
    case "stormy":
      return "0x9575CD";

    case "cloud":
    case "cloudy":
      return "0xB0BEC5";

    case "sunny":
      return "0xFFD54F";

    default:
      return "0x66BB6A";
  }
}

function buildFilterGraph() {
  const level =
    Math.max(
      1,
      Math.floor(
        latestWorld.level
      )
    );

  const xp =
    Math.max(
      0,
      Math.floor(
        latestWorld.xp
      )
    );

  const love =
    Math.max(
      0,
      Math.floor(
        latestWorld.communityLove
      )
    );

  const action =
    escapeDrawtext(
      latestWorld.lumiAction
        .toUpperCase()
    );

  const weather =
    escapeDrawtext(
      latestWorld.weather
        .toUpperCase()
    );

  const phase =
    escapeDrawtext(
      latestWorld.phase
        .toUpperCase()
    );

  const background =
    phaseColor();

  const accent =
    weatherAccent();

  return [
    `[0:v]format=yuv420p,`,
    `colorchannelmixer=rr=0.70:gg=0.82:bb=1.00,`,
    `drawbox=x=0:y=0:w=${WIDTH}:h=${HEIGHT}:color=${background}@0.22:t=fill,`,

    `drawbox=x=25:y=25:w=${WIDTH - 50}:h=165:color=black@0.48:t=fill,`,
    `drawbox=x=25:y=${HEIGHT - 220}:w=${WIDTH - 50}:h=195:color=black@0.52:t=fill,`,

    `drawbox=x=55:y=125:w=350:h=22:color=0x263238@0.90:t=fill,`,
    `drawbox=x=55:y=125:w='60+280*(0.5+0.5*sin(t*0.15))':h=22:color=0xFFCA28@0.95:t=fill,`,

    `drawbox=x='80+70*sin(t*0.7)':y='420+80*cos(t*0.55)':w=150:h=150:color=${accent}@0.78:t=fill,`,
    `drawbox=x='470+65*cos(t*0.6)':y='690+90*sin(t*0.45)':w=105:h=105:color=0xFF7043@0.72:t=fill,`,

    `drawbox=x='${WIDTH}-275-abs(sin(t*1.2))*360':y=255:w=260:h=92:color=0xAB47BC@0.80:t=fill,`,

    `drawtext=text='LUMI WORLD':fontsize=42:fontcolor=white:x=50:y=48,`,

    `drawtext=text='LEVEL ${level}':fontsize=27:fontcolor=white:x=50:y=100,`,

    `drawtext=text='${phase} / ${weather}':fontsize=21:fontcolor=white@0.90:x=430:y=58,`,

    `drawtext=text='LIVE WORLD':fontsize=21:fontcolor=white:x='${WIDTH}-275-abs(sin(t*1.2))*360+20':y=286,`,

    `drawtext=text='WORLD STATE':fontsize=29:fontcolor=white:x=50:y=${HEIGHT - 190},`,

    `drawtext=text='XP ${xp}':fontsize=27:fontcolor=0xFFCA28:x=50:y=${HEIGHT - 145},`,

    `drawtext=text='LOVE ${love}':fontsize=27:fontcolor=0xEC407A:x=235:y=${HEIGHT - 145},`,

    `drawtext=text='ACTION ${action}':fontsize=23:fontcolor=white:x=50:y=${HEIGHT - 95},`,

    `drawtext=text='LUMI WORLD CLOUD RENDERER':fontsize=17:fontcolor=white@0.65:x=50:y=${HEIGHT - 52}`,

    `[final]`
  ].join("");
}

function buildFfmpegArgs() {
  const filter =
    buildFilterGraph();

  const common = [
    "-hide_banner",
    "-nostdin",

    "-loglevel",
    "warning",

    "-f",
    "lavfi",

    "-re",

    "-i",
    `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}`,

    "-f",
    "lavfi",

    "-re",

    "-i",
    "sine=frequency=220:sample_rate=44100",

    "-filter_complex",
    filter,

    "-map",
    "[final]",

    "-map",
    "1:a:0",

    "-c:v",
    "libx264",

    "-preset",
    VIDEO_PRESET,

    "-tune",
    "zerolatency",

    "-pix_fmt",
    "yuv420p",

    "-profile:v",
    "main",

    "-level",
    "3.1",

    "-r",
    String(FPS),

    "-g",
    String(FPS * 2),

    "-keyint_min",
    String(FPS * 2),

    "-sc_threshold",
    "0",

    "-b:v",
    VIDEO_BITRATE,

    "-maxrate",
    VIDEO_MAXRATE,

    "-bufsize",
    VIDEO_BUFSIZE,

    "-c:a",
    "aac",

    "-b:a",
    AUDIO_BITRATE,

    "-ar",
    "44100",

    "-ac",
    "2",

    "-f",
    "flv",

    "-flvflags",
    "no_duration_filesize"
  ];

  if (DRY_RUN) {
    return [
      ...common,
      "-"
    ];
  }

  return [
    ...common,
    RTMP_URL
  ];
}

function validateStreamingConfiguration() {
  if (DRY_RUN) {
    state.stream.configured =
      false;

    state.stream.target =
      "dry_run_sink";

    return true;
  }

  if (!RTMP_URL) {
    state.renderer.status =
      "blocked";

    state.renderer.lastError =
      "rtmp_url_not_configured";

    state.stream.configured =
      false;

    state.stream.target =
      "not_configured";

    log(
      "error",
      "renderer_blocked",
      {
        reason:
          "rtmp_url_not_configured"
      }
    );

    return false;
  }

  if (
    !/^rtmps?:\/\//i.test(
      RTMP_URL
    )
  ) {
    state.renderer.status =
      "blocked";

    state.renderer.lastError =
      "invalid_rtmp_url";

    log(
      "error",
      "renderer_blocked",
      {
        reason:
          "invalid_rtmp_url"
      }
    );

    return false;
  }

  state.stream.configured =
    true;

  state.stream.target =
    "configured";

  return true;
}

function startRenderer() {
  if (
    shuttingDown ||
    rendererProcess
