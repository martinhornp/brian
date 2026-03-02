const express = require("express");
const path = require("path");
const { getNews } = require("./lib/news-service");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/news", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";
    const payload = await getNews(forceRefresh);
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: "Kunne ikke hente nyheder lige nu.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Brian-radar korer pa http://localhost:${PORT}`);
  });
}

module.exports = app;

