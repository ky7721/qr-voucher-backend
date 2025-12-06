const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 防止搜尋引擎收錄
app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

// DB
const db = new sqlite3.Database("./voucher.db");
db.run(`
CREATE TABLE IF NOT EXISTS vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    detail TEXT,
    used INTEGER DEFAULT 0,
    used_time TEXT
)
`);

// Generate vouchers
app.post("/api/generate", async (req, res) => {
  const { count, detail } = req.body;
  let results = [];

  for (let i = 0; i < count; i++) {
    const code = uuidv4().split("-")[0].toUpperCase();

    await new Promise((resolve) => {
      db.run("INSERT INTO vouchers (code, detail) VALUES (?, ?)", [code, detail], () =>
        resolve()
      );
    });

    const qr = await QRCode.toDataURL(`http://localhost:5173/redeem/${code}`);

    results.push({ code, qr });
  }

  res.json(results);
});

// Redeem voucher
app.get("/api/redeem/:code", (req, res) => {
  const code = req.params.code;

  db.get("SELECT * FROM vouchers WHERE code = ?", [code], (err, row) => {
    if (!row) return res.json({ status: "invalid" });

    if (row.used === 1)
      return res.json({ status: "used", message: "Voucher already used.", used_time: row.used_time });

    const now = new Date().toISOString();
    db.run("UPDATE vouchers SET used = 1, used_time = ? WHERE code = ?", [now, code]);

    res.json({ status: "valid", code: row.code, detail: row.detail });
  });
});

// Dashboard stats
app.get("/api/stats", (req, res) => {
  db.get("SELECT COUNT(*) AS total FROM vouchers", (_, total) => {
    db.get("SELECT COUNT(*) AS used FROM vouchers WHERE used = 1", (_, used) => {
      res.json({ total: total.total, used: used.used, unused: total.total - used.used });
    });
  });
});

app.listen(5000, () => console.log("Backend running on http://localhost:5000"));
