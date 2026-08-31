const DEFAULTS = Object.freeze({
  width: 720,
  height: 1280,
  fps: 30,
});

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(
      max,
      Number(value) || 0
    )
  );
}

function text(value, fallback = "", max = 120) {
  const output = String(value ?? fallback)
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, max);

  return output || fallback;
}

function escapeDrawtext(value) {
  return text(value, "", 160)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

function palette(scene = {}) {
  const tone =
    scene.palette?.tone ||
    "warm_day";

  if (tone === "moonlit") {
    return {
      sky: "0x10182f",
      ground: "0x17243a",
      accent: "0x91b7ff",
      panel: "0x111827",
      text: "white",
    };
  }

  if (tone === "cool_day") {
    return {
      sky: "0x7298aa",
      ground: "0x536f63",
      accent: "0xbde4ef",
      panel: "0x17232a",
      text: "white",
    };
  }

  return {
    sky: "0x86cbea",
    ground: "0x6fa75d",
    accent: "0xffe38a",
    panel: "0x203326",
    text: "white",
  };
}

function moodFace(mood) {
  switch (mood) {
    case "excited":
    case "playful":
    case "proud":
      return "happy";

    case "sleepy":
    case "tired":
      return "sleepy";

    case "surprised":
      return "surprised";

    default:
      return "neutral";
  }
}

function characterGeometry(scene = {}) {
  const layer =
    scene.characterLayer || {};

  const scale =
    clamp(
      layer.scale ?? 1,
      0.75,
      1.25
    );

  return {
    cx:
      Math.round(
        360 +
        (
          Number(layer.x ?? 0.5) -
          0.5
        ) *
          160
      ),

    cy:
      Math.round(
        clamp(
          Number(layer.y ?? 0.54),
          0.35,
          0.75
        ) *
          1280
      ),

    scale,
  };
}

function eventText(frame = {}) {
  const event =
    frame.scene?.eventBanner;

  if (!event) {
    return null;
  }

  return {
    title:
      text(
        event.title,
        "",
        54
      ),

    subtitle:
      text(
        event.subtitle,
        "",
        86
      ),

    emphasis:
      text(
        event.emphasis,
        "normal",
        16
      ),
  };
}

export class VisualRenderer {
  constructor(options = {}) {
    this.config = {
      ...DEFAULTS,
      ...(options.config || {}),
    };
  }

  build(frame = {}) {
    const scene =
      frame.scene || {};

    const world =
      frame.show?.world || {};

    const character =
      frame.character || {};

    const colors =
      palette(scene);

    const geometry =
      characterGeometry(scene);

    const event =
      eventText(frame);

    const filters = [];

    /*
     * BASE WORLD
     */
    filters.push(
      `[0:v]drawbox=x=0:y=0:w=${this.config.width}:h=760:color=${colors.sky}:t=fill`
    );

    filters.push(
      `drawbox=x=0:y=760:w=${this.config.width}:h=520:color=${colors.ground}:t=fill`
    );

    /*
     * DISTANT WORLD SHAPES
     * These are intentionally simple placeholders.
     * They prove actual scene-state-to-frame rendering
     * before permanent art assets are introduced.
     */
    filters.push(
      "drawbox=x=35:y=620:w=150:h=210:color=0x315c45@0.55:t=fill"
    );

    filters.push(
      "drawbox=x=535:y=590:w=145:h=240:color=0x315c45@0.48:t=fill"
    );

    /*
     * CHARACTER SILHOUETTE / BODY
     */
    const bodyW =
      Math.round(
        150 *
        geometry.scale
      );

    const bodyH =
      Math.round(
        210 *
        geometry.scale
      );

    const head =
      Math.round(
        115 *
        geometry.scale
      );

    const bodyX =
      Math.round(
        geometry.cx -
        bodyW / 2
      );

    const bodyY =
      Math.round(
        geometry.cy -
        bodyH / 2 +
        55
      );

    const headX =
      Math.round(
        geometry.cx -
        head / 2
      );

    const headY =
      Math.round(
        bodyY -
        head * 0.68
      );

    filters.push(
      `drawbox=x=${bodyX}:y=${bodyY}:w=${bodyW}:h=${bodyH}:color=0xf4d8b4:t=fill`
    );

    filters.push(
      `drawbox=x=${headX}:y=${headY}:w=${head}:h=${head}:color=0xffdfbd:t=fill`
    );

    /*
     * Character mood indicator.
     * This is temporary visual instrumentation,
     * not the final LUMI character artwork.
     */
    const face =
      moodFace(
        character.mood
      );

    filters.push(
      `drawtext=text='LUMI':x=${geometry.cx}-text_w/2:y=${headY + 34}:fontsize=28:fontcolor=0x253238`
    );

    filters.push(
      `drawtext=text='${escapeDrawtext(face)}':x=${geometry.cx}-text_w/2:y=${headY + 72}:fontsize=18:fontcolor=0x253238`
    );

    /*
     * WORLD TITLE
     */
    filters.push(
      "drawtext=text='LUMI WORLD':x=(w-text_w)/2:y=72:fontsize=38:fontcolor=white:borderw=2:bordercolor=black@0.25"
    );

    /*
     * LEVEL / WORLD PROGRESS
     */
    const level =
      Math.max(
        1,
        Math.floor(
          Number(world.level) ||
          1
        )
      );

    const love =
      Math.max(
        0,
        Math.floor(
          Number(
            world.communityLove
          ) || 0
        )
      );

    filters.push(
      `drawbox=x=34:y=132:w=652:h=78:color=${colors.panel}@0.72:t=fill`
    );

    filters.push(
      `drawtext=text='LEVEL ${level}':x=58:y=151:fontsize=24:fontcolor=${colors.text}`
    );

    filters.push(
      `drawtext=text='COMMUNITY ${love}':x=w-text_w-58:y=151:fontsize=24:fontcolor=${colors.text}`
    );

    /*
     * OBJECTIVE BAR
     */
    const objective =
      frame.show?.objective || {};

    const target =
      Math.max(
        1,
        Number(
          objective.target ||
          world.objectiveTarget ||
          100
        )
      );

    const progress =
      clamp(
        world.objectiveProgress ||
        0,
        0,
        target
      );

    const ratio =
      clamp(
        progress / target,
        0,
        1
      );

    const barWidth =
      Math.round(
        610 *
        ratio
      );

    filters.push(
      "drawbox=x=55:y=230:w=610:h=24:color=black@0.30:t=fill"
    );

    if (barWidth > 0) {
      filters.push(
        `drawbox=x=55:y=230:w=${barWidth}:h=24:color=${colors.accent}:t=fill`
      );
    }

    filters.push(
      `drawtext=text='WORLD GOAL ${Math.floor(progress)}/${Math.floor(target)}':x=55:y=266:fontsize=20:fontcolor=white:borderw=2:bordercolor=black@0.20`
    );

    /*
     * CURRENT ACTION
     */
    const action =
      text(
        character.action ||
        world.lumiAction,
        "exploring",
        32
      ).toUpperCase();

    filters.push(
      `drawtext=text='${escapeDrawtext(action)}':x=(w-text_w)/2:y=970:fontsize=32:fontcolor=white:borderw=3:bordercolor=black@0.30`
    );

    /*
     * WEATHER / PHASE
     */
    const phase =
      text(
        world.phase,
        "day",
        16
      ).toUpperCase();

    const weather =
      text(
        world.weather,
        "clear",
        20
      ).toUpperCase();

    filters.push(
      `drawtext=text='${escapeDrawtext(phase)}  •  ${escapeDrawtext(weather)}':x=(w-text_w)/2:y=1020:fontsize=20:fontcolor=white:borderw=2:bordercolor=black@0.25`
    );

    /*
     * EVENT BANNER
     */
    if (event) {
      const bannerColor =
        event.emphasis === "rare"
          ? "0x7357ff"
          : event.emphasis === "strong"
            ? "0xd66a35"
            : "0x1e293b";

      filters.push(
        `drawbox=x=35:y=1070:w=650:h=145:color=${bannerColor}@0.88:t=fill`
      );

      filters.push(
        `drawtext=text='${escapeDrawtext(event.title)}':x=(w-text_w)/2:y=1092:fontsize=26:fontcolor=white`
      );

      if (
        event.subtitle
      ) {
        filters.push(
          `drawtext=text='${escapeDrawtext(event.subtitle)}':x=(w-text_w)/2:y=1135:fontsize=17:fontcolor=white`
        );
      }
    } else {
      const milestone =
        text(
          world.nextMilestone,
          "The world keeps growing",
          72
        );

      filters.push(
        `drawtext=text='${escapeDrawtext(milestone)}':x=(w-text_w)/2:y=1130:fontsize=19:fontcolor=white:borderw=2:bordercolor=black@0.25`
      );
    }

    /*
     * DEGRADED EDGE INDICATOR.
     * Only appears when World Core is temporarily unreachable.
     */
    if (
      frame.source?.degraded
    ) {
      filters.push(
        "drawbox=x=235:y=1218:w=250:h=36:color=0x8b2c2c@0.80:t=fill"
      );

      filters.push(
        "drawtext=text='WORLD SYNC RETRYING':x=(w-text_w)/2:y=1225:fontsize=16:fontcolor=white"
      );
    }

    return {
      width:
        this.config.width,

      height:
        this.config.height,

      fps:
        this.config.fps,

      filterComplex:
        filters.join(","),

      diagnostics: {
        mood:
          character.mood ||
          "curious",

        action:
          character.action ||
          world.lumiAction ||
          "exploring",

        phase:
          world.phase ||
          "day",

        weather:
          world.weather ||
          "clear",

        event:
          event?.title ||
          null,

        edgeDegraded:
          Boolean(
            frame.source
              ?.degraded
          ),
      },
    };
  }

  ffmpegArgs(
    frame = {},
    options = {}
  ) {
    const visual =
      this.build(frame);

    const duration =
      Math.max(
        1,
        Number(
          options.durationSeconds
        ) || 10
      );

    const output =
      text(
        options.output,
        "lumi-preview.mp4",
        240
      );

    return [
      "-hide_banner",
      "-loglevel",
      "warning",

      "-f",
      "lavfi",

      "-i",
      `color=c=0x111827:s=${visual.width}x${visual.height}:r=${visual.fps}`,

      "-t",
      String(duration),

      "-vf",
      visual.filterComplex,

      "-c:v",
      "libx264",

      "-preset",
      "veryfast",

      "-pix_fmt",
      "yuv420p",

      "-r",
      String(
        visual.fps
      ),

      "-an",

      "-y",

      output,
    ];
  }
}

export function createVisualRenderer(
  options = {}
) {
  return new VisualRenderer(
    options
  );
}
