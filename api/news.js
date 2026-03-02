const { getNews } = require("../lib/news-service");

module.exports = async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";
    const payload = await getNews(forceRefresh);
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: "Kunne ikke hente nyheder lige nu.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

