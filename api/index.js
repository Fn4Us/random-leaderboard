const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");
const https = require("https");

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── row colours ───────────────────────────────────────────────────────────────
// bottom 20th percentile → shades of red; rest → alternating light-grey / white

function rowBg(percentile, rowIndex) {
  if (percentile <= 20) {
    // alternate two reds so adjacent rows are distinguishable
    return rowIndex % 2 === 0 ? "#ffd6d6" : "#ffbdbd";
  }
  return rowIndex % 2 === 0 ? "#f5f5f5" : "#ffffff";
}

function rowAccent(percentile) {
  // thin left-border accent colour
  if (percentile <= 20) return "#e53e3e";
  return "#cccccc";
}

// ── main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  try {
    // 1. Register Overpass font (must be in repo at /public/Overpass-VariableFont_wght.ttf)
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
    const responses = dataLines.map((line) => {
      const parts = line.split("\t");
      return {
        response: parts[0] ?? "",
        percentile: parseFloat(parts[1] ?? "0"),
        stdev: parts[2] ?? "",
      };
    });

    // 4. Pick random count 10–20, sample responses + usernames
    const count = randInt(10, Math.min(20, responses.length, usernames.length));
    const sampledResponses = shuffle(responses).slice(0, count);
    const sampledUsernames = shuffle(usernames).slice(0, count);

    // 5. Assign random CDN image numbers (1–26593)
    const imageNums = Array.from({ length: count }, () => randInt(1, 26593));

    // 6. Build rows: zip & sort by percentile descending (rank 1 = highest)
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

    // 7. Layout constants
    const W = 900;
    const ROW_H = 72;
    const PADDING = 20;
    const IMG_SIZE = 52;
    const HEADER_H = 56;
    const H = HEADER_H + ROW_H * count + PADDING;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // ── background ────────────────────────────────────────────────────────────
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, W, H);

    // ── header ────────────────────────────────────────────────────────────────
    ctx.fillStyle = "#12122a";
    ctx.fillRect(0, 0, W, HEADER_H);

    const colX = {
      rank: 18,
      image: 70,
      username: 140,
      response: 370,
      percentile: 590,
      stdev: 760,
    };

    ctx.fillStyle = "#888aaa";
    ctx.font = `600 13px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText("#", colX.rank, HEADER_H / 2);
    ctx.fillText("USERNAME", colX.username, HEADER_H / 2);
    ctx.fillText("RESPONSE", colX.response, HEADER_H / 2);
    ctx.fillText("PERCENTILE", colX.percentile, HEADER_H / 2);
    ctx.fillText("STDEV", colX.stdev, HEADER_H / 2);

    // ── rows ──────────────────────────────────────────────────────────────────
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const y = HEADER_H + i * ROW_H;
      const isRed = row.percentile <= 20;

      // row background
      ctx.fillStyle = rowBg(row.percentile, i);
      ctx.fillRect(0, y, W, ROW_H);

      // left accent bar
      ctx.fillStyle = rowAccent(row.percentile);
      ctx.fillRect(0, y, 4, ROW_H);

      // subtle separator
      ctx.fillStyle = "rgba(0,0,0,0.07)";
      ctx.fillRect(0, y + ROW_H - 1, W, 1);

      const cy = y + ROW_H / 2;
      const textColor = isRed ? "#7a1515" : "#222233";
      const mutedColor = isRed ? "#b84040" : "#666688";

      // rank
      ctx.font = `700 15px ${FONT}`;
      ctx.fillStyle = mutedColor;
      ctx.textAlign = "right";
      ctx.fillText(`${row.rank}`, colX.image - 6, cy);

      // avatar image
      const imgX = colX.image;
      const imgY = cy - IMG_SIZE / 2;
      const imgUrl = `https://cdn.booksona.lol/${row.imageNum}.png`;

      try {
        const buf = await fetchImageBuffer(imgUrl);
        const img = await loadImage(buf);

        // circular clip
        ctx.save();
        ctx.beginPath();
        ctx.arc(imgX + IMG_SIZE / 2, imgY + IMG_SIZE / 2, IMG_SIZE / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, imgX, imgY, IMG_SIZE, IMG_SIZE);
        ctx.restore();

        // circle border
        ctx.beginPath();
        ctx.arc(imgX + IMG_SIZE / 2, imgY + IMG_SIZE / 2, IMG_SIZE / 2, 0, Math.PI * 2);
        ctx.strokeStyle = isRed ? "#e5737380" : "#cccccc80";
        ctx.lineWidth = 2;
        ctx.stroke();
      } catch {
        // fallback placeholder circle if image fails
        ctx.save();
        ctx.beginPath();
        ctx.arc(imgX + IMG_SIZE / 2, imgY + IMG_SIZE / 2, IMG_SIZE / 2, 0, Math.PI * 2);
        ctx.fillStyle = isRed ? "#ffb3b3" : "#e0e0f0";
        ctx.fill();
        ctx.restore();
        ctx.font = `700 11px ${FONT}`;
        ctx.fillStyle = mutedColor;
        ctx.textAlign = "center";
        ctx.fillText("?", imgX + IMG_SIZE / 2, imgY + IMG_SIZE / 2 + 1);
      }

      ctx.textAlign = "left";

      // username
      ctx.font = `700 15px ${FONT}`;
      ctx.fillStyle = textColor;
      ctx.fillText(row.username, colX.username, cy - 1);

      // response
      ctx.font = `500 14px ${FONT}`;
      ctx.fillStyle = textColor;
      // truncate long responses
      let respText = String(row.response);
      ctx.font = `500 14px ${FONT}`;
      while (respText.length > 1 && ctx.measureText(respText).width > colX.percentile - colX.response - 16) {
        respText = respText.slice(0, -1);
      }
      if (respText !== String(row.response)) respText += "…";
      ctx.fillText(respText, colX.response, cy);

      // percentile — badge style
      const pct = row.percentile.toFixed(1);
      const badgeW = 64;
      const badgeH = 26;
      const badgeX = colX.percentile;
      const badgeY = cy - badgeH / 2;
      const badgeFill = isRed ? "#e53e3e" : "#4a90d9";
      ctx.fillStyle = badgeFill;
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
      ctx.fill();
      ctx.font = `700 13px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(`${pct}%`, badgeX + badgeW / 2, cy + 1);
      ctx.textAlign = "left";

      // stdev
      ctx.font = `400 13px ${FONT}`;
      ctx.fillStyle = mutedColor;
      ctx.fillText(`±${row.stdev}`, colX.stdev, cy);
    }

    // ── encode & send ─────────────────────────────────────────────────────────
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
