import http from "node:http";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const PORT = Number(process.env.PORT || 8080);

const VERSION = "LUMI-RENDER-BENCHMARK-V2";

const PROFILE = {
  width: 720,
  height: 1280,
  fps: 30,
  durationSeconds: 30,

  videoCodec: "libx264",
  preset: "veryfast",

  videoBitrate: "3000k",
  maxRate: "3500k",
  bufferSize: "6000k",

  audioCodec: "aac",
  audioBitrate: "128k",

  container: "flv"
};

const result = {
  ok: false,
  version: VERSION,

  startedAt: null,
  completedAt: null,

  ffmpegAvailable: false,
  ffmpegVersion: null,

  profile: PROFILE,

  elapsedSeconds: null,

  encodedFrames: null,
  averageFps: null,
  realtimeFactor: null,
  outputBytes: null,

  rendererSimulation: {
    movingBackground: true,
    animatedWorldLayer: true,
    animatedHud: true,
    animatedEventOverlay: true,
    dynamicText: true,
    dayNightTint: true,
    audio: true,
    h264: true,
    aac: true,
    flvCompatible: true
  },

  verdict: "not_run",
  error: null
};

function run(command, args) {
  return spawnSync(
    command,
    args,
    {
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 20 * 1024 * 1024
    }
  );
}

function lastNumber(text, regex) {
  const matches = [...text.matchAll(regex)];

  if (!matches.length) {
    return null;
  }

  return Number(
    matches[matches.length - 1][1]
  );
}

function parseFrame(text) {
  return lastNumber(
    text,
    /frame=\s*([0-9]+)/g
  );
}

function parseFps(text) {
  return lastNumber(
    text,
    /fps=\s*([0-9.]+)/g
  );
}

function parseSpeed(text) {
  return lastNumber(
    text,
    /speed=\s*([0-9.]+)x/g
  );
}

function benchmark() {
  result.startedAt =
    new Date().toISOString();

  console.log(
    "===== LUMI RENDER BENCHMARK V2 START ====="
  );

  console.log(
    JSON.stringify(
      {
        version: VERSION,
        profile: PROFILE
      },
      null,
      2
    )
  );

  const versionCheck =
    run(
      "ffmpeg",
      ["-version"]
    );

  if (
    versionCheck.error ||
    versionCheck.status !== 0
  ) {
    result.error =
      "FFmpeg is not available.";

    result.verdict =
      "FFMPEG_NOT_AVAILABLE";

    result.completedAt =
      new Date().toISOString();

    console.error(
      JSON.stringify(
        result,
        null,
        2
      )
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

  /*
    BENCHMARK DESIGN

    Layer 1:
    Moving procedural background.

    Layer 2:
    Semi-transparent animated "world" object.

    Layer 3:
    HUD / status panel.

    Layer 4:
    Animated event notification.

    Layer 5:
    Dynamic text showing simulated world state.

    Color/tint changes over time simulate day/night changes.

    Audio is encoded simultaneously.

    Output is FLV-compatible H.264/AAC so the encode path
    resembles RTMP streaming without sending anything to TikTok.
  */

  const filter = [
    /*
      Base vertical scene
    */
    "[0:v]",
    "format=yuv420p,",
    "eq=brightness='0.03*sin(t*0.35)':",
    "saturation='1.0+0.08*sin(t*0.2)'",
    "[base];",

    /*
      Animated world object
    */
    "color=c=0x4FC3F7@0.85:",
    "s=210x210:",
    "r=30:d=30",
    "[worldcolor];",

    "[worldcolor]",
    "format=rgba,",
    "geq=",
    "r='r(X,Y)':",
    "g='g(X,Y)':",
    "b='b(X,Y)':",
    "a='255*if(lte((X-105)^2+(Y-105)^2,10000),1,0)'",
    "[world];",

    "[base][world]",
    "overlay=",
    "x='255+150*sin(t*0.7)':",
    "y='480+100*cos(t*0.55)':",
    "format=auto",
    "[scene1];",

    /*
      Top HUD
    */
    "[scene1]",
    "drawbox=",
    "x=30:y=35:w=660:h=150:",
    "color=black@0.45:t=fill,",

    "drawbox=",
    "x=55:y=75:",
    "w='100+250*(0.5+0.5*sin(t*0.25))':",
    "h=20:",
    "color=0xFFCA28@0.95:t=fill,",

    /*
      Bottom control/info panel
    */
    "drawbox=",
    "x=30:y=1030:w=660:h=190:",
    "color=black@0.50:t=fill,",

    /*
      Animated event alert
    */
    "drawbox=",
    "x='720-260-abs(sin(t*1.4))*400':",
    "y=250:",
    "w=250:h=95:",
    "color=0xAB47BC@0.82:t=fill,",

    /*
      Additional moving world elements
    */
    "drawbox=",
    "x='80+40*sin(t*0.9)':",
    "y='650+60*cos(t*0.7)':",
    "w=120:h=120:",
    "color=0x66BB6A@0.70:t=fill,",

    "drawbox=",
    "x='500+50*cos(t*0.6)':",
    "y='760+90*sin(t*0.45)':",
    "w=95:h=95:",
    "color=0xFF7043@0.75:t=fill,",

    /*
      Text overlays.

      We intentionally use FFmpeg's default font resolution
      path rather than custom project assets for this benchmark.
    */
    "drawtext=",
    "text='LUMI WORLD':",
    "fontsize=40:",
    "fontcolor=white:",
    "x=55:y=45,",

    "drawtext=",
    "text='LEVEL 1':",
    "fontsize=26:",
    "fontcolor=white:",
    "x=55:y=110,",

    "drawtext=",
    "text='WORLD STATE':",
    "fontsize=28:",
    "fontcolor=white:",
    "x=55:y=1055,",

    "drawtext=",
    "text='XP %{eif\\:10+t*2\\:d}':",
    "fontsize=26:",
    "fontcolor=0xFFCA28:",
    "x=55:y=1100,",

    "drawtext=",
    "text='LOVE %{eif\\:100+t\\:d}':",
    "fontsize=26:",
    "fontcolor=0xEC407A:",
    "x=55:y=1140,",

    "drawtext=",
    "text='ACTION EXPLORING':",
    "fontsize=23:",
    "fontcolor=white:",
    "x=55:y=1180",

    "[final]"
  ].join("");

  const expectedFrames =
    PROFILE.fps *
    PROFILE.durationSeconds;

  const start =
    performance.now();

  const ffmpeg =
    run(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",

        /*
          Moving procedural source.
        */
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${PROFILE.width}x${PROFILE.height}:rate=${PROFILE.fps}:duration=${PROFILE.durationSeconds}`,

        /*
          Audio source.
        */
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:sample_rate=44100:duration=${PROFILE.durationSeconds}`,

        "-filter_complex",
        filter,

        "-map",
        "[final]",

        "-map",
        "1:a:0",

        "-t",
        String(
          PROFILE.durationSeconds
        ),

        "-c:v",
        PROFILE.videoCodec,

        "-preset",
        PROFILE.preset,

        "-tune",
        "zerolatency",

        "-pix_fmt",
        "yuv420p",

        "-profile:v",
        "main",

        "-level",
        "3.1",

        "-r",
        String(
          PROFILE.fps
        ),

        "-g",
        "60",

        "-keyint_min",
        "60",

        "-sc_threshold",
        "0",

        "-b:v",
        PROFILE.videoBitrate,

        "-maxrate",
        PROFILE.maxRate,

        "-bufsize",
        PROFILE.bufferSize,

        "-c:a",
        PROFILE.audioCodec,

        "-b:a",
        PROFILE.audioBitrate,

        "-ar",
        "44100",

        "-ac",
        "2",

        /*
          FLV muxer = RTMP-compatible output format.

          We discard the bytes after muxing so nothing is
          transmitted externally.
        */
        "-f",
        PROFILE.container,

        "-flvflags",
        "no_duration_filesize",

        "pipe:1"
      ]
    );

  const end =
    performance.now();

  result.elapsedSeconds =
    (end - start) / 1000;

  const stderr =
    ffmpeg.stderr || "";

  result.encodedFrames =
    parseFrame(stderr) ??
    expectedFrames;

  result.averageFps =
    parseFps(stderr);

  result.realtimeFactor =
    parseSpeed(stderr);

  if (
    ffmpeg.stdout
  ) {
    result.outputBytes =
      Buffer.byteLength(
        ffmpeg.stdout
      );
  }

  if (
    ffmpeg.error ||
    ffmpeg.status !== 0
  ) {
    result.error =
      ffmpeg.error?.message ||
      `FFmpeg exited with code ${ffmpeg.status}`;

    result.verdict =
      "ENCODE_FAILED";

    result.completedAt =
      new Date().toISOString();

    console.error(
      "===== FFmpeg ERROR ====="
    );

    console.error(
      stderr.slice(-8000)
    );

    console.error(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    return;
  }

  /*
    Fallback realtime factor if FFmpeg did not emit speed.

    duration / wall-clock encode time
  */

  if (
    !result.realtimeFactor &&
    result.elapsedSeconds > 0
  ) {
    result.realtimeFactor =
      PROFILE.durationSeconds /
      result.elapsedSeconds;
  }

  if (
    !result.averageFps &&
    result.elapsedSeconds > 0
  ) {
    result.averageFps =
      expectedFrames /
      result.elapsedSeconds;
  }

  /*
    Evaluation thresholds.

    >= 1.50x
    Strong realtime headroom.

    >= 1.20x
    Production-capable headroom.

    >= 1.00x
    Realtime but too tight for production variation.

    < 1.00x
    Cannot sustain realtime.
  */

  if (
    result.realtimeFactor >= 1.5
  ) {
    result.ok = true;

    result.verdict =
      "PASS_STRONG_HEADROOM";
  } else if (
    result.realtimeFactor >= 1.2
  ) {
    result.ok = true;

    result.verdict =
      "PASS_PRODUCTION_HEADROOM";
  } else if (
    result.realtimeFactor >= 1
  ) {
    result.ok = true;

    result.verdict =
      "PASS_REALTIME_BUT_TIGHT";
  } else {
    result.ok = false;

    result.verdict =
      "FAIL_REALTIME";
  }

  result.completedAt =
    new Date().toISOString();

  console.log(
    "===== LUMI RENDER BENCHMARK V2 RESULT ====="
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}

benchmark();

/*
  Keep process alive temporarily so Railway Metrics and
  HTTP inspection remain available.

  This benchmark does NOT:
  - contain EVENT_SECRET
  - call Cloudflare
  - write D1
  - modify XP
  - connect TikTok
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
        response.statusCode =
          200;

        response.end(
          JSON.stringify({
            ok: true,

            service:
              "lumi-render-benchmark-v2",

            completed:
              result.verdict !==
              "not_run",

            version:
              VERSION
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
      `LUMI renderer benchmark V2 server listening on ${PORT}`
    );
  }
);
