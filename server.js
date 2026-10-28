const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");

const config = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

if(!config.user || !config.database) {
  console.error("Missing DB_USER or DB_NAME. Did you create .env from .env.example?");
  process.exit(1);
}

const PORT = Number(process.env.PORT);
const ROW_LIMIT = 1000;

const pool = mysql.createPool({ ...config, connectionLimit: 5, dateStrings: true });
const app = express();

app.use(express.static(path.join(__dirname, "public")));

async function listTables() {
  const [rows] = await pool.query("SHOW TABLES");
  return rows.map((r) => Object.values(r)[0]);
}

app.get("/api/tables", async (req, res) => {
  try {
    const tables = await listTables();
    const result = [];
    for (const t of tables) {
      const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM ??", [t]);
      result.push({ name: t, rows: n });
    }
    res.json({ database: config.database, tables: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/table/:name", async (req, res) => {
  try {
    const tables = await listTables();
    const name = req.params.name;
    if (!tables.includes(name)) return res.status(404).json({ error: "Unknown table" });

    const [cols] = await pool.query("SHOW COLUMNS FROM ??", [name]);
    const pk = cols.find((c) => c.Key === "PRI");
    const order = pk ? mysql.format(" ORDER BY ?? ", [pk.Field]) : " ";
    const [rows] = await pool.query(
      "SELECT * FROM ??" + order + "LIMIT " + ROW_LIMIT,
      [name]
    );
    res.json({
      table: name,
      primaryKey: pk ? pk.Field : null,
      columns: cols.map((c) => ({ name: c.Field, type: c.Type, key: c.Key })),
      rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`MySQL Live Viewer running at http://localhost:${PORT}`);
  console.log(`Database: ${config.database} @ ${config.host}:${config.port}`);
});
