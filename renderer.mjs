import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";

const VERSION = "LUMI-WORLD-RENDERER-V1.0.1";
const SERVICE = "lumi-world-renderer";

function numEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return String(raw).toLowerCase() === "true";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const PORT = numEnv("PORT", 8080);

const EDGE_URL = normalizeBaseUrl(
  process.env.LUMI_EDGE_URL ||
    "https://lumi-world-core.lumi-world.workers.dev"
);

const STATUS_URL =
  process.env.LUMI_STATUS_URL ||
  `${EDGE_URL}/api/status`;

const WIDTH = clamp(
  numEnv("LUMI_RENDER_WIDTH", 720),
  320,
  2160
);

const HEIGHT = clamp(
  numEnv("LUMI_RENDER_HEIGHT", 1280),
  320,
  3840
);

const FPS = clamp(
  numEnv("LUMI_RENDER_FPS", 30),
  1,
  60
);

const POLL_MS = clamp(
  numEnv("LUMI_RENDER_POLL_MS", 5000),
  1000,
  60000
);

const REQUEST_TIMEOUT_MS = clamp(
  numEnv("LUMI_RENDER_REQUEST_TIMEOUT_MS", 8000),
  1000,
  30000
);

const RESTART_MIN_MS = clamp(
  numEnv("LUMI_RENDER_RESTART_MIN_MS", 2000),
  1000,
  60000
);

const RESTART_MAX_MS = clamp(
  numEnv("LUMI_RENDER_RESTART_MAX_MS", 30000),
  RESTART_MIN_MS,
  300000
);

const VIDEO_PRESET =
  process.env.LUMI_VIDEO_PRESET || "veryfast";

const VIDEO_BITRATE =
  process.env.LUMI_VIDEO_BITRATE || "3000k";

const VIDEO_MAXRATE =
  process.env.LUMI_VIDEO_MAXRATE || "3500k";

const VIDEO_BUFSIZE =
  process.env.LUMI_VIDEO_BUFSIZE || "6000k";

const AUDIO_BITRATE =
  process.env.LUMI_AUDIO_BITRATE || "128k";

const DRY_RUN = boolEnv(
  "LUMI_RENDER_DRY_RUN",
  true
);

const RTMP_URL = String(
  process.env.LUMI_RTMP_URL || ""
).trim();

const STATE_FILE = path.join(
  os.tmpdir(),
  "lumi-world-state.txt"
);

let shuttingDown = false;
let ffmpeg = null;
let pollTimer = null;
let restartTimer = null;
let restartDelayMs = RESTART_MIN_MS;

let world = {
  version: 1,
  level: 1,
  xp: 0,
  communityLove: 0,
  phase: "day",
  weather: "clear",
  lumiAction: "exploring",
  updatedAt: null
};

const runtime = {
  version: VERSION,
  service: SERVICE,
  mode: DRY_RUN ? "dry_run" : "rtmp",
  startedAt: new Date().toISOString(),

  edge: {
    url: EDGE_URL,
    statusUrl: STATUS_URL,
    connected: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastError: null
  },

  renderer: {
    status: "initializing",
    ffmpegAvailable: false,
    ffmpegVersion: null,
    pid: null,
    restartCount: 0,
    startedAt: null,
    stoppedAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    lastError: null,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    videoCodec: "libx264",
    videoPreset: VIDEO_PRESET,
    videoBitrate: VIDEO_BITRATE,
    audioCodec: "aac",
    audioBitrate: AUDIO_BITRATE,
    container: "flv"
  },

  stream: {
    configured: !DRY_RUN && Boolean(RTMP_URL),
    connected: false,
    target: DRY_RUN
      ? "dry_run_sink"
      : RTMP_URL
        ? "configured"
        : "not_configured"
  },

  world
};

function log(level, event, extra = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    version: VERSION,
    event,
    ...extra
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value, fallback, max = 64) {
  const text = String(value ?? fallback)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .trim()
    .slice(0, max);

  return text || fallback;
}

function sanitizeWorld(input) {
  const source =
    input && typeof input === "object"
      ? input
      : {};

  return {
    version: finiteNumber(source.version, world.version),
    level: finiteNumber(source.level, world.level),
    xp: finiteNumber(source.xp, world.xp),
    communityLove: finiteNumber(
      source.communityLove,
      world.communityLove
    ),
    phase: safeText(source.phase, world.phase, 24),
    weather: safeText(source.weather, world.weather, 32),
    lumiAction: safeText(
      source.lumiAction,
      world.lumiAction,
      48
    ),
    updatedAt: source.updatedAt
      ? String(source.updatedAt).slice(0, 64)
      : world.updatedAt
  };
}

function drawtextSafe(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

function worldText() {
  return [
    "LUMI WORLD",
    `LEVEL ${Math.max(1, Math.floor(world.level))}`,
    `XP ${Math.max(0, Math.floor(world.xp))}`,
    `LOVE ${Math.max(0, Math.floor(world.communityLove))}`,
    `${world.phase.toUpperCase()} / ${world.weather.toUpperCase()}`,
    `ACTION ${world.lumiAction.toUpperCase()}`
  ].join(" | ");
}

function writeStateFile() {
  const temp = `${STATE_FILE}.${process.pid}.tmp`;

  fs.writeFileSync(
    temp,
    worldText(),
    "utf8"
  );

  fs.renameSync(
    temp,
    STATE_FILE
  );
}

async function fetchWorld() {
  runtime.edge.lastAttemptAt =
    new Date().toISOString();

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      STATUS_URL,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": VERSION
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        `world_status_http_${response.status}`
      );
    }

    const payload = await response.json();

    if (
      !payload ||
      payload.ok !== true ||
      !payload.world
    ) {
      throw new Error(
        "invalid_world_status_payload"
      );
    }

    world = sanitizeWorld(payload.world);
    runtime.world = world;

    runtime.edge.connected = true;
    runtime.edge.lastSuccessAt =
      new Date().toISOString();
    runtime.edge.consecutiveFailures = 0;
    runtime.edge.lastError = null;

    writeStateFile();

    log(
      "info",
      "world_state_updated",
      {
        levelValue: world.level,
        xp: world.xp,
        communityLove: world.communityLove,
        phase: world.phase,
        weather: world.weather,
        lumiAction: world.lumiAction
      }
    );
  } catch (error) {
    runtime.edge.connected = false;
    runtime.edge.consecutiveFailures += 1;
    runtime.edge.lastError =
      error?.message || String(error);

    log(
      "warn",
      "world_state_fetch_failed",
      {
        error: runtime.edge.lastError,
        consecutiveFailures:
          runtime.edge.consecutiveFailures
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

function schedulePolling() {
  if (shuttingDown) return;

  clearTimeout(pollTimer);

  pollTimer = setTimeout(
    async () => {
      await fetchWorld();
      schedulePolling();
    },
    POLL_MS
  );
}

function checkFfmpeg() {
  const check = spawnSync(
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
    runtime.renderer.ffmpegAvailable = false;
    runtime.renderer.lastError =
      "ffmpeg_not_available";

    log(
      "error",
      "ffmpeg_not_available",
      {
        error: check.error?.message || null,
        exitCode: check.status
      }
    );

    return false;
  }

  runtime.renderer.ffmpegAvailable = true;
  runtime.renderer.ffmpegVersion = String(
    check.stdout || check.stderr || ""
  )
    .split("\n")[0]
    .trim();

  log(
    "info",
    "ffmpeg_detected",
    {
      ffmpegVersion:
        runtime.renderer.ffmpegVersion
    }
  );

  return true;
}

function validateConfig() {
  if (DRY_RUN) {
    runtime.stream.configured = false;
    runtime.stream.target = "dry_run_sink";
    return true;
  }

  if (!RTMP_URL) {
    runtime.renderer.status = "blocked";
    runtime.renderer.lastError =
      "rtmp_url_not_configured";

    log(
      "error",
      "renderer_blocked",
      {
        reason: "rtmp_url_not_configured"
      }
    );

    return false;
  }

  if (!/^rtmps?:\/\//i.test(RTMP_URL)) {
    runtime.renderer.status = "blocked";
    runtime.renderer.lastError =
      "invalid_rtmp_url";

    log(
      "error",
      "renderer_blocked",
      {
        reason: "invalid_rtmp_url"
      }
    );

    return false;
  }

  runtime.stream.configured = true;
  runtime.stream.target = "configured";
  return true;
}

function filterGraph() {
  const statePath = drawtextSafe(STATE_FILE);

  return [
    `[0:v]format=yuv420p,`,
    `drawbox=x=0:y=0:w=${WIDTH}:h=${HEIGHT}:color=0x17324D@0.18:t=fill,`,
    `drawbox=x=25:y=25:w=${WIDTH - 50}:h=165:color=black@0.48:t=fill,`,
    `drawbox=x=25:y=${HEIGHT - 220}:w=${WIDTH - 50}:h=195:color=black@0.52:t=fill,`,
    `drawbox=x='80+70*sin(t*0.7)':y='420+80*cos(t*0.55)':w=150:h=150:color=0x4FC3F7@0.78:t=fill,`,
    `drawbox=x='470+65*cos(t*0.6)':y='690+90*sin(t*0.45)':w=105:h=105:color=0xFF7043@0.72:t=fill,`,
    `drawbox=x='${WIDTH}-275-abs(sin(t*1.2))*360':y=255:w=260:h=92:color=0xAB47BC@0.80:t=fill,`,
    `drawtext=text='LUMI WORLD':fontsize=42:fontcolor=white:x=50:y=48,`,
    `drawtext=text='LIVE WORLD':fontsize=21:fontcolor=white:x='${WIDTH}-275-abs(sin(t*1.2))*360+20':y=286,`,
    `drawtext=textfile='${statePath}':reload=1:fontsize=22:fontcolor=white:x=50:y=${HEIGHT - 175}:box=0,`,
    `drawtext=text='LUMI WORLD CLOUD RENDERER':fontsize=17:fontcolor=white@0.65:x=50:y=${HEIGHT - 52}`,
    `[final]`
  ].join("");
}

function ffmpegArgs() {
  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-re",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}`,
    "-re",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:sample_rate=44100",
    "-filter_complex",
    filterGraph(),
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
    args.push("-");
  } else {
    args.push(RTMP_URL);
  }

  return args;
}

function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function scheduleRestart(reason) {
  if (shuttingDown) return;

  clearRestartTimer();

  const delay = restartDelayMs;

  restartDelayMs = Math.min(
    restartDelayMs * 2,
    RESTART_MAX_MS
  );

  runtime.renderer.restartCount += 1;
  runtime.renderer.status = "restarting";

  log(
    "warn",
    "renderer_restart_scheduled",
    {
      reason,
      delayMs: delay,
      restartCount:
        runtime.renderer.restartCount
    }
  );

  restartTimer = setTimeout(
    () => {
      restartTimer = null;
      startRenderer();
    },
    delay
  );
}

function startRenderer() {
  if (shuttingDown || ffmpeg) return;
  if (!runtime.renderer.ffmpegAvailable) return;
  if (!validateConfig()) return;

  writeStateFile();

  runtime.renderer.status = "starting";
  runtime.renderer.lastError = null;
  runtime.renderer.lastExitCode = null;
  runtime.renderer.lastExitSignal = null;

  const child = spawn(
    "ffmpeg",
    ffmpegArgs(),
    {
      stdio: [
        "ignore",
        "ignore",
        "pipe"
      ],
      env: process.env
    }
  );

  ffmpeg = child;

  runtime.renderer.pid =
    child.pid || null;
  runtime.renderer.startedAt =
    new Date().toISOString();
  runtime.renderer.stoppedAt = null;
  runtime.stream.connected = true;
  runtime.renderer.status = DRY_RUN
    ? "dry_run_running"
    : "streaming";

  restartDelayMs = RESTART_MIN_MS;

  log(
    "info",
    "renderer_started",
    {
      pid: runtime.renderer.pid,
      mode: runtime.mode,
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      target: runtime.stream.target
    }
  );

  child.stderr.setEncoding("utf8");

  child.stderr.on(
    "data",
    (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;

      log(
        "warn",
        "ffmpeg_stderr",
        {
          message: text.slice(-4000)
        }
      );
    }
  );

  child.on(
    "error",
    (error) => {
      runtime.renderer.lastError =
        error?.message || String(error);

      log(
        "error",
        "renderer_process_error",
        {
          error: runtime.renderer.lastError
        }
      );
    }
  );

  child.on(
    "exit",
    (code, signal) => {
      if (ffmpeg === child) {
        ffmpeg = null;
      }

      runtime.renderer.pid = null;
      runtime.renderer.stoppedAt =
        new Date().toISOString();
      runtime.renderer.lastExitCode = code;
      runtime.renderer.lastExitSignal = signal;
      runtime.stream.connected = false;

      if (shuttingDown) {
        runtime.renderer.status = "stopped";

        log(
          "info",
          "renderer_stopped",
          {
            code,
            signal
          }
        );

        return;
      }

      runtime.renderer.status = "crashed";
      runtime.renderer.lastError =
        `ffmpeg_exit_${code ?? "null"}`;

      log(
        "error",
        "renderer_exited",
        {
          code,
          signal
        }
      );

      scheduleRestart("ffmpeg_exit");
    }
  );
}

async function bootstrap() {
  log(
    "info",
    "renderer_boot",
    {
      mode: runtime.mode,
      edgeUrl: EDGE_URL,
      statusUrl: STATUS_URL
    }
  );

  writeStateFile();

  const ffmpegOk = checkFfmpeg();

  if (!ffmpegOk) {
    runtime.renderer.status = "blocked";
    return;
  }

  await fetchWorld();
  schedulePolling();
  startRenderer();
}

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;

  res.setHeader(
    "content-type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "cache-control",
    "no-store"
  );

  res.end(
    JSON.stringify(
      payload,
      null,
      2
    )
  );
}

function requestPath(req) {
  try {
    const parsed = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`
    );

    return parsed.pathname;
  } catch {
    return "/";
  }
}

const server = http.createServer(
  (req, res) => {
    const pathname = requestPath(req);

    if (req.method !== "GET") {
      jsonResponse(
        res,
        405,
        {
          ok: false,
          error: "method_not_allowed"
        }
      );
      return;
    }

    if (pathname === "/health") {
      const healthy =
        runtime.renderer.ffmpegAvailable &&
        [
          "dry_run_running",
          "streaming",
          "starting"
        ].includes(runtime.renderer.status);

      jsonResponse(
        res,
        healthy ? 200 : 503,
        {
          ok: healthy,
          service: SERVICE,
          version: VERSION,
          mode: runtime.mode,
          renderer: runtime.renderer.status,
          worldCore: runtime.edge.connected
            ? "connected"
            : "degraded"
        }
      );
      return;
    }

    if (
      pathname === "/status" ||
      pathname === "/"
    ) {
      jsonResponse(
        res,
        200,
        {
          ok: true,
          ...runtime,
          world
        }
      );
      return;
    }

    jsonResponse(
      res,
      404,
      {
        ok: false,
        error: "not_found"
      }
    );
  }
);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    log(
      "info",
      "http_server_listening",
      {
        port: PORT
      }
    );
  }
);

function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;
  runtime.renderer.status = "stopping";

  clearTimeout(pollTimer);
  clearRestartTimer();

  log(
    "info",
    "shutdown_requested",
    {
      signal
    }
  );

  server.close(() => {
    log(
      "info",
      "http_server_closed"
    );
  });

  if (ffmpeg && !ffmpeg.killed) {
    try {
      ffmpeg.kill("SIGTERM");
    } catch (error) {
      log(
        "warn",
        "ffmpeg_terminate_failed",
        {
          error:
            error?.message || String(error)
        }
      );
    }
  }

  setTimeout(
    () => {
      if (ffmpeg && !ffmpeg.killed) {
        try {
          ffmpeg.kill("SIGKILL");
        } catch {}
      }

      process.exit(0);
    },
    5000
  ).unref();
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "uncaughtException",
  (error) => {
    log(
      "error",
      "uncaught_exception",
      {
        error:
          error?.stack ||
          error?.message ||
          String(error)
      }
    );

    shutdown("uncaughtException");
  }
);

process.on(
  "unhandledRejection",
  (reason) => {
    log(
      "error",
      "unhandled_rejection",
      {
        error:
          reason?.stack ||
          reason?.message ||
          String(reason)
      }
    );

    shutdown("unhandledRejection");
  }
);

bootstrap().catch(
  (error) => {
    runtime.renderer.status = "blocked";
    runtime.renderer.lastError =
      error?.message || String(error);

    log(
      "error",
      "bootstrap_failed",
      {
        error:
          error?.stack ||
          error?.message ||
          String(error)
      }
    );
  }
);
