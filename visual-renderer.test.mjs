import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import {
  createVisualRenderer,
} from "./visual-renderer.mjs";

const renderer =
  createVisualRenderer();

const frame = {
  source: {
    edgeConnected: true,
    degraded: false,
  },

  show: {
    objective: {
      title:
        "Help LUMI build the next part of the world",
      target: 100,
    },

    world: {
      level: 4,
      xp: 920,
      communityLove: 640,
      objectiveProgress: 63,
      objectiveTarget: 100,
      buildProgress: 42,
      phase: "day",
      weather: "clear",
      lumiAction: "discovering",
      nextMilestone:
        "A mysterious garden is taking shape",
    },
  },

  character: {
    mood: "excited",
    action: "discovering",
  },

  scene: {
    palette: {
      tone: "warm_day",
    },

    canvas: {
      width: 720,
      height: 1280,
    },

    characterLayer: {
      x: 0.5,
      y: 0.54,
      scale: 1.08,
      visualPriority:
        "character_focus",
    },

    eventBanner: {
      title:
        "Something is shining!",
      subtitle:
        "LUMI found something unusual in the garden.",
      emphasis:
        "strong",
    },
  },
};

const visual =
  renderer.build(frame);

assert.equal(
  visual.width,
  720
);

assert.equal(
  visual.height,
  1280
);

assert.equal(
  visual.fps,
  30
);

assert.equal(
  visual.diagnostics.mood,
  "excited"
);

assert.equal(
  visual.diagnostics.action,
  "discovering"
);

assert.equal(
  visual.diagnostics.event,
  "Something is shining!"
);

assert.ok(
  visual.filterComplex.includes(
    "LUMI WORLD"
  )
);

assert.ok(
  visual.filterComplex.includes(
    "WORLD GOAL"
  )
);

const output =
  "lumi-visual-preview.mp4";

const args =
  renderer.ffmpegArgs(
    frame,
    {
      durationSeconds: 8,
      output,
    }
  );

console.log(
  "FFmpeg arguments prepared."
);

const result =
  spawnSync(
    "ffmpeg",
    args,
    {
      encoding: "utf8",
    }
  );

if (result.stdout) {
  console.log(
    result.stdout
  );
}

if (result.stderr) {
  console.log(
    result.stderr
  );
}

assert.equal(
  result.status,
  0,
  "FFmpeg preview generation failed"
);

assert.equal(
  fs.existsSync(output),
  true
);

const stats =
  fs.statSync(output);

assert.ok(
  stats.size > 10_000,
  `Preview unexpectedly small: ${stats.size} bytes`
);

const probe =
  spawnSync(
    "ffprobe",
    [
      "-v",
      "error",

      "-select_streams",
      "v:0",

      "-show_entries",
      "stream=width,height,r_frame_rate,codec_name,pix_fmt",

      "-of",
      "json",

      output,
    ],
    {
      encoding: "utf8",
    }
  );

assert.equal(
  probe.status,
  0,
  "ffprobe failed"
);

const metadata =
  JSON.parse(
    probe.stdout
  );

const stream =
  metadata.streams?.[0];

assert.ok(
  stream
);

assert.equal(
  stream.width,
  720
);

assert.equal(
  stream.height,
  1280
);

assert.equal(
  stream.codec_name,
  "h264"
);

assert.equal(
  stream.pix_fmt,
  "yuv420p"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      preview: output,
      bytes: stats.size,
      stream,
      diagnostics:
        visual.diagnostics,
    },
    null,
    2
  )
);

console.log(
  "LUMI VISUAL RENDERER PREVIEW PASS"
);
