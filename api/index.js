const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");
const https = require("https");

// ── helpers ───────────────────────────────────────────────────────────────────

function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Possible highlight colours for top-10% rows (anything but red)
const TOP_COLORS = [
  { bg0: "#d6eaff", bg1: "#bfd9ff", accent: "#2b7de9", text: "#0a2a5e", muted: "#2b5fa0" }, // blue
  { bg0: "#d6f5e3", bg1: "#bfedce", accent: "#27a65a", text: "#0a3d20", muted: "#27864a" }, // green
  { bg0: "#fff3cc", bg1: "#ffe9a0", accent: "#c49a00", text: "#3d2f00", muted: "#9a7700" }, // gold
  { bg0: "#e8d6ff", bg1: "#d9bfff", accent: "#7c3aed", text: "#2e0a5e", muted: "#6d2fd4" }, // purple
  { bg0: "#d6f5f5", bg1: "#bfeded", accent: "#0e9090", text: "#023030", muted: "#0c7a7a" }, // teal
];

// ── main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  try {
    // 1. Register Overpass font
    const fontPath = path.join(process.cwd(), "public", "Overpass-VariableFont_wght.ttf");
    if (fs.existsSync(fontPath)) {
      GlobalFonts.registerFromPath(fontPath, "Overpass");
    }
    const FONT = "Overpass, sans-serif";

    // 2. Read data files
    const dataPath = path.join(process.cwd(), "data", "allresponsesneeded.txt");
    const userPath = path.join(process.cwd(), "data", "usernames.txt");

    const dataLines = fs
      .readFileSync(dataPath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const usernames = fs
      .readFileSync(userPath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // 3. Parse response rows
    const allResponses = dataLines.map((line) => {
      const parts = line.split("\t");
      return {
        response: parts[0] ?? "",
        percentile: parseFloat(parts[1] ?? "0"),
        stdev: parts[2] ?? "",
      };
    });

    // 4. Pick random count 10–20, sample & sort by percentile desc
    const count = randInt(10, Math.min(20, allResponses.length, usernames.length));
    const sampledResponses = shuffle(allResponses).slice(0, count);
    const sampledUsernames = shuffle(usernames).slice(0, count);

    // 5. Assign random CDN image numbers (1–26593)
    const imageNums = Array.from({ length: count }, () => randInt(1, 26593));

    // 6. Build & sort rows
    let rows = sampledResponses.map((r, i) => ({
      rank: 0,
      username: sampledUsernames[i],
      imageNum: imageNums[i],
      response: r.response,
      percentile: r.percentile,
      stdev: r.stdev,
    }));
    rows.sort((a, b) => b.percentile - a.percentile);
    rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));

    // 7. Determine which rows are "bottom 20%" and "top 10%" of THIS selection
    //    Bottom 20% = bottom floor(count * 0.2) rows (i.e. worst ranked)
    //    Top 10%    = top floor(count * 0.1) rows (i.e. best ranked), 50/50 chance of highlight
    const bottomCutoff = Math.max(1, Math.floor(count * 0.2));  // number of red rows
    const topCutoff    = Math.max(1, Math.floor(count * 0.1));  // number of potential highlight rows
    const doTopHighlight = Math.random() < 0.5; // 50/50

    // Pick one consistent colour palette for the top highlight this render
    const topPalette = TOP_COLORS[randInt(0, TOP_COLORS.length - 1)];

    function rowStyle(rank, rowIndex) {
      // rank 1 = best, rank `count` = worst
      const isBottom = rank > count - bottomCutoff;
      const isTop    = doTopHighlight && rank <= topCutoff;

      if (isBottom) {
        return {
          bg:     rowIndex % 2 === 0 ? "#ffd6d6" : "#ffbdbd",
          accent: "#e53e3e",
          text:   "#7a1515",
          muted:  "#b84040",
        };
      }
      if (isTop) {
        return {
          bg:     rowIndex % 2 === 0 ? topPalette.bg0 : topPalette.bg1,
          accent: topPalette.accent,
          text:   topPalette.text,
          muted:  topPalette.muted,
        };
      }
      return {
        bg:     rowIndex % 2 === 0 ? "#f5f5f5" : "#ffffff",
        accent: "#dddddd",
        text:   "#222233",
        muted:  "#666688",
      };
    }

    // 8. Layout constants
    const W       = 1050;
    const ROW_H   = 80;
    const IMG_SIZE = 62;
    const H       = ROW_H * count;

    // Column positions
    const COL_RANK   = 18;
    const COL_IMG    = 58;
    const COL_USER   = COL_IMG + IMG_SIZE + 14;       // ~134
    const COL_RESP   = COL_USER + 180;                // ~314  — lots of room
    const COL_PCT    = W - 210;                       // ~840
    const COL_STDEV  = W - 80;                        // ~970

    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext("2d");
    ctx.textBaseline = "middle";

    // 9. Draw rows
    for (let i = 0; i < rows.length; i++) {
      const row   = rows[i];
      const y     = i * ROW_H;
      const cy    = y + ROW_H / 2;
      const style = rowStyle(row.rank, i);

      // background
      ctx.fillStyle = style.bg;
      ctx.fillRect(0, y, W, ROW_H);

      // left accent bar
      ctx.fillStyle = style.accent;
      ctx.fillRect(0, y, 5, ROW_H);

      // separator
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      ctx.fillRect(0, y + ROW_H - 1, W, 1);

      // rank number
      ctx.font = `700 17px ${FONT}`;
      ctx.fillStyle = style.muted;
      ctx.textAlign = "right";
      ctx.fillText(`${row.rank}`, COL_IMG - 6, cy);

      // avatar — square
      const imgX = COL_IMG;
      const imgY = cy - IMG_SIZE / 2;
      const imgUrl = `https://cdn.booksona.lol/${row.imageNum}.png`;

      try {
        const buf = await fetchImageBuffer(imgUrl);
        const img = await loadImage(buf);
        ctx.drawImage(img, imgX, imgY, IMG_SIZE, IMG_SIZE);
      } catch {
        ctx.fillStyle = style.muted;
        ctx.fillRect(imgX, imgY, IMG_SIZE, IMG_SIZE);
        ctx.font = `700 13px ${FONT}`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText("?", imgX + IMG_SIZE / 2, imgY + IMG_SIZE / 2);
      }

      ctx.textAlign = "left";

      // username
      ctx.font = `700 17px ${FONT}`;
      ctx.fillStyle = style.text;
      ctx.fillText(row.username, COL_USER, cy);

      // response — generous space, truncate only if truly needed
      const maxRespW = COL_PCT - COL_RESP - 20;
      ctx.font = `400 17px ${FONT}`;
      ctx.fillStyle = style.text;
      let respText = String(row.response);
      while (respText.length > 1 && ctx.measureText(respText).width > maxRespW) {
        respText = respText.slice(0, -1);
      }
      if (respText !== String(row.response)) respText += "…";
      ctx.fillText(respText, COL_RESP, cy);

      // percentile — plain text, right-aligned in its column
      ctx.font = `600 17px ${FONT}`;
      ctx.fillStyle = style.text;
      ctx.textAlign = "right";
      ctx.fillText(`${row.percentile.toFixed(1)}%`, COL_STDEV - 16, cy);

      // stdev — no ± prefix, just the number
      ctx.font = `400 16px ${FONT}`;
      ctx.fillStyle = style.muted;
      ctx.textAlign = "left";
      ctx.fillText(String(row.stdev), COL_STDEV, cy);
    }

    // 10. Encode & send
    const png = await canvas.encode("png");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(png);

  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("Image generation failed: " + err.message);
  }
};
