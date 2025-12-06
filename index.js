const express = require("express");
const Database = require("better-sqlite3");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// 防止搜尋引擎收錄（你選 A：私密）
app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

// 資料庫（檔案會在 backend/ 產生 voucher.db）
const dbPath = path.resolve(__dirname, "voucher.db");
const db = new Database(dbPath);

// 初始化表格（如果不存在）
db.prepare(`
  CREATE TABLE IF NOT EXISTS vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    detail TEXT,
    used INTEGER DEFAULT 0,
    used_time TEXT
  )
`).run();

// Helper prepared statements
const insertStmt = db.prepare("INSERT INTO vouchers (code, detail) VALUES (?, ?)");
const getByCodeStmt = db.prepare("SELECT * FROM vouchers WHERE code = ?");
const countTotalStmt = db.prepare("SELECT COUNT(*) as total FROM vouchers");
const countUsedStmt = db.prepare("SELECT COUNT(*) as used FROM vouchers WHERE used = 1");
const markUsedStmt = db.prepare("UPDATE vouchers SET used = 1, used_time = ? WHERE code = ?");

// ---- API ---- //

// Generate vouchers
// POST /api/generate
// body: { count: 500, detail: "RM10 off" }
app.post("/api/generate", async (req, res) => {
  try {
    const { count = 0, detail = "" } = req.body;
    const results = [];

    // generate and insert in transaction for speed & atomicity
    const insertMany = db.transaction((n, d) => {
      for (let i = 0; i < n; i++) {
        const code = uuidv4().split("-")[0].toUpperCase();
        insertStmt.run(code, d);
        results.push({ code });
      }
    });

    insertMany(count, detail);

    // produce QR images (async) pointing to frontend redeem path
    // NOTE: change baseUrl to your frontend domain when deploying
    const baseUrl = process.env.FRONTEND_BASE_URL || "http://localhost:5173";
    for (let r of results) {
      const qrData = await QRCode.toDataURL(`${baseUrl}/redeem/${r.code}`);
      r.qr = qrData;
      r.detail = detail;
    }

    res.json(results);
  } catch (err) {
    console.error("Generate error:", err);
    res.status(500).json({ error: "Failed to generate vouchers", detail: err.message });
  }
});

// Redeem voucher
// GET /api/redeem/:code
app.get("/api/redeem/:code", (req, res) => {
  try {
    const { code } = req.params;
    const row = getByCodeStmt.get(code);

    if (!row) {
      return res.json({ status: "invalid" });
    }

    if (row.used === 1) {
      return res.json({
        status: "used",
        code: row.code,
        detail: row.detail,
        used_time: row.used_time
      });
    }

    const now = new Date().toISOString();
    markUsedStmt.run(now, code);

    return res.json({
      status: "valid",
      code: row.code,
      detail: row.detail
    });
  } catch (err) {
    console.error("Redeem error:", err);
    res.status(500).json({ error: "Failed to redeem", detail: err.message });
  }
});

// Dashboard stats
// GET /api/stats
app.get("/api/stats", (req, res) => {
  try {
    const totalRow = countTotalStmt.get();
    const usedRow = countUsedStmt.get();
    const total = totalRow ? totalRow.total : 0;
    const used = usedRow ? usedRow.used : 0;
    res.json({ total, used, unused: total - used });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to get stats", detail: err.message });
  }
});

// Optional: health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
