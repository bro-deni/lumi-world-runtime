import http from "node:http";
import { spawnSync } from "node:child_process";

const PORT = Number(process.env.PORT || 8080);
const VERSION = "LUMI-RENDER-BENCHMARK-V1";

const result = {
  ok: false,
  version: VERSION,
  startedAt: new Date().toISOString(),

  ffmpegAvailable: false,
  ffmpegVersion: null,

  profile: {
    width: 720,
    height: 1280,
    fps: 30,
    durationSeconds: 20,
    videoCodec: "libx264",
    preset: "ultrafast",
    audioCodec: "aac",
  },

  elapsedSeconds: null,
  realtimeFactor: null,
  averageFps: null,
  verdict: "not_run",
  error: null,
};

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120000,
  });
}

function parseSpeed(text) {
  const matches = [...text.matchAll(/speed=\s*([0-9.]+)x/g)];

  if (!matches.length) {
    return null;
  }

  return Number(
    matches[matches.length - 1][1]
  );
}

function parseFps(text) {
  const matches = [...text.matchAll(/fps=\s*([0-9.]+)/g)];

  if (!matches.length) {
    return null;
  }

  return Number(
    matches[matches.length - 1][1]
  );
}

function benchmark() {
  console.log(
    "===== LUMI RENDER BENCHMARK START ====="
  );

  const versionCheck = run(
    "ffmpeg",
    ["-version"]
  );

  if (
    versionCheck.error ||
    versionCheck.status !== 0
  ) {
    result.error =
      "FFmpeg is not installed in this service.";

    result.verdict =
      "FFMPEG_NOT_AVAILABLE";

    console.error(result.error);
    console.log(
      JSON.stringify(result, null, 2)
    );

    return;
  }

  result.ffmpegAvailable = true;

  result.ffmpegVersion =
    (
      versionCheck.stdout ||
      versionCheck.stderr ||
      ""
    )
      .split("\n")[0]
      .trim();

  const duration =
    result.profile.durationSeconds;

  const started =
    process.hrtime.bigint();

  /*
    This creates a real synthetic vertical video workload:

    - 720 x 1280
    - 30 fps
    - moving video pattern
    - AAC audio
    - H.264 encoding
    - no file written to disk

    It therefore measures encoding capability rather than
    simply sleeping or animating a static image.
  */

  const ffmpeg = run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",

      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=720x1280:rate=30`,

      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",

      "-t",
      String(duration),

      "-map",
      "0:v:0",

      "-map",
      "1:a:0",

      "-c:v",
      "libx264",

      "-preset",
      "ultrafast",

      "-tune",
      "zerolatency",

      "-pix_fmt",
      "yuv420p",

      "-profile:v",
      "main",

      "-level",
      "3.1",

      "-r",
      "30",

      "-g",
      "60",

      "-b:v",
      "2500k",

      "-maxrate",
      "2500k",

      "-bufsize",
      "5000k",

      "-c:a",
      "aac",

      "-b:a",
      "128k",

      "-ar",
      "44100",

      "-f",
      "null",

      "-"
    ]
  );

  const ended =
    process.hrtime.bigint();

  result.elapsedSeconds =
    Number(
      ended - started
    ) / 1_000_000_000;

  const output =
    `${ffmpeg.stdout || ""}\n` +
    `${ffmpeg.stderr || ""}`;

  result.realtimeFactor =
    parseSpeed(output);

  result.averageFps =
    parseFps(output);

  if (
    ffmpeg.error ||
    ffmpeg.status !== 0
  ) {
    result.error =
      ffmpeg.error?.message ||
      `FFmpeg exited with code ${ffmpeg.status}`;

    result.verdict =
      "ENCODE_FAILED";

    console.error(
      "FFMPEG BENCHMARK FAILED"
    );

    console.error(
      output.slice(-5000)
    );

    console.log(
      JSON.stringify(result, null, 2)
    );

    return;
  }

  /*
    Interpretation:

    speed >= 1.20x
      Good headroom for realtime 30fps.

    speed >= 1.00x
      Barely capable of realtime.

    speed < 1.00x
      Cannot sustain realtime encoding.
  */

  if (
    result.realtimeFactor >= 1.2
  ) {
    result.verdict =
      "PASS_WITH_HEADROOM";

    result.ok = true;
  } else if (
    result.realtimeFactor >= 1
  ) {
    result.verdict =
      "PASS_BUT_TIGHT";

    result.ok = true;
  } else {
    result.verdict =
      "FAIL_REALTIME";
  }

  console.log(
    "===== LUMI RENDER BENCHMARK RESULT ====="
  );

  console.log(
    JSON.stringify(result, null, 2)
  );
}

benchmark();

/*
  Keep the benchmark service alive so Railway Metrics
  remain visible after the test and the result can be
  inspected through HTTP.

  This service DOES NOT contain EVENT_SECRET and DOES NOT
  call Cloudflare or modify LUMI WORLD state.
*/

const server =
  http.createServer(
    (request, response) => {
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
              "lumi-render-benchmark",
            benchmarkCompleted:
              result.verdict !== "not_run",
            version:
              VERSION,
          })
        );

        return;
      }

      response.statusCode =
        result.ok ? 200 : 503;

      response.end(
        JSON.stringify(
          result,
          null,
          2
        )
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `LUMI benchmark result server listening on ${PORT}`
    );
  }
);
