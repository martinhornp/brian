const express = require("express");
const path = require("path");
const Parser = require("rss-parser");

const app = express();
const PORT = process.env.PORT || 3000;

const KEYWORDS = ["brian"];
const MAX_RESULTS = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;
const BING_OFFSETS = [
  0, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 111, 121, 131, 141, 151, 161, 171,
  181, 191, 201,
];
const BING_KEYWORDS = ["Brian"];
const DANISH_SOURCE_HINTS = [
  "dr",
  "tv 2",
  "tv2",
  "tvsyd",
  "tvmidtvest",
  "sn.dk",
  "politiken",
  "berlingske",
  "ekstra bladet",
  "jyllands-posten",
  "jyllands posten",
  "information",
  "kristeligt dagblad",
  "bt",
  "b.t.",
  "ritzau",
  "altinget",
  "nordjyske",
  "fyens",
  "avisen danmark",
  "tv2 kosmopol",
  "tv2 oestjylland",
];

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "BrianRadarBot/1.0 (+local-dev)",
  },
});

const CORE_FEED_SOURCES = [
  {
    name: "DR Seneste",
    url: "https://www.dr.dk/nyheder/service/feeds/senestenyt",
  },
  {
    name: "Politiken Seneste",
    url: "https://politiken.dk/rss/senestenyt.rss",
  },
  {
    name: "Ekstra Bladet Nyheder",
    url: "https://ekstrabladet.dk/rssfeed/nyheder",
  },
  {
    name: "Information Feed",
    url: "https://www.information.dk/feed",
  },
  {
    name: "Altinget",
    url: "https://www.altinget.dk/rss",
  },
  {
    name: "TV 2 Kosmopol",
    url: "https://www.tv2kosmopol.dk/rss",
  },
  {
    name: "TV 2 Ostjylland",
    url: "https://www.tv2ostjylland.dk/rss",
  },
  {
    name: "TV 2 Fyn",
    url: "https://www.tv2fyn.dk/rss",
  },
  {
    name: "TV 2 Nord",
    url: "https://www.tv2nord.dk/rss",
  },
  {
    name: "TV Midtvest",
    url: "https://www.tvmidtvest.dk/rss",
  },
  {
    name: "TV Syd",
    url: "https://www.tvsyd.dk/rss",
  },
  {
    name: "TV 2 East",
    url: "https://www.tv2east.dk/rss",
  },
];

const BING_FEED_SOURCES = BING_KEYWORDS.flatMap((keyword) =>
  BING_OFFSETS.map((offset) => {
    const query = encodeURIComponent(`"${keyword}" site:.dk`);
    const offsetPart = offset > 0 ? `&first=${offset}` : "";

    return {
      name: `Bing News - ${keyword} (${offset || "base"})`,
      url: `https://www.bing.com/news/search?q=${query}&format=rss&cc=dk&setlang=da-dk${offsetPart}`,
    };
  })
);

const FEED_SOURCES = [...CORE_FEED_SOURCES, ...BING_FEED_SOURCES];

const cache = {
  fetchedAt: 0,
  payload: null,
  pending: null,
};

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KEYWORD_PATTERNS = KEYWORDS.map(
  (keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i")
);

function stripHtml(value) {
  return normalizeWhitespace(
    String(value ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
  );
}

function parseDate(item) {
  const rawDate = item.isoDate || item.pubDate || item.published || "";
  const timestamp = Date.parse(rawDate);
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return timestamp;
}

function inferSourceName(item, fallbackSourceName) {
  if (item.source?.name) {
    return normalizeWhitespace(item.source.name);
  }

  const snippet = String(item.contentSnippet ?? "").replace(/\u00a0/g, " ");
  const snippetParts = snippet.split(/\s{2,}/).map(normalizeWhitespace).filter(Boolean);

  if (snippetParts.length > 1) {
    return snippetParts[snippetParts.length - 1];
  }

  return normalizeWhitespace(fallbackSourceName);
}

function normalizeLink(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "fbclid",
      "gclid",
      "ocid",
    ].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return String(value).trim();
  }
}

function decodeFeedLink(value) {
  const link = normalizeLink(value);
  if (!link) {
    return "";
  }

  try {
    const url = new URL(link);
    if (
      url.hostname.toLowerCase().includes("bing.com") &&
      url.pathname.toLowerCase().includes("/news/apiclick.aspx")
    ) {
      const embeddedUrl = url.searchParams.get("url");
      if (embeddedUrl) {
        return normalizeLink(decodeURIComponent(embeddedUrl));
      }
    }
  } catch {
    // Ignore parsing issues and return the original link.
  }

  return link;
}

function itemMatchesKeywords(item) {
  const text = normalizeWhitespace(
    `${item.title} ${item.summary} ${item.rawContent} ${item.link}`
  );
  return KEYWORD_PATTERNS.some((pattern) => pattern.test(text));
}

function isLikelyDanishNews(item) {
  const source = normalizeWhitespace(item.source).toLowerCase();

  try {
    const host = new URL(item.link).hostname.toLowerCase();
    if (host.endsWith(".dk")) {
      return true;
    }
    if (host.includes(".dk")) {
      return true;
    }
  } catch {
    // Ignore invalid URL and continue with source-name hints.
  }

  if (source.includes(".dk")) {
    return true;
  }

  return DANISH_SOURCE_HINTS.some((hint) => source.includes(hint));
}

function mapFeedItem(item, sourceName) {
  const publishedTimestamp = parseDate(item);
  const title = stripHtml(item.title || item["media:title"] || "");
  const summary = stripHtml(item.contentSnippet || item.content || item.summary || "");
  const link = decodeFeedLink(item.link || item.guid || "");
  const rawContent = stripHtml(item.content || item.contentSnippet || "");
  const source = inferSourceName(item, sourceName);

  return {
    id: `${sourceName}-${link}-${publishedTimestamp}-${title}`.slice(0, 300),
    title,
    summary,
    link,
    source,
    publishedAt: publishedTimestamp > 0 ? new Date(publishedTimestamp).toISOString() : null,
    publishedTimestamp,
    rawContent,
  };
}

function deduplicate(items) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const key = `${normalizeWhitespace(item.title).toLowerCase()}|${normalizeLink(item.link)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

async function crawlSource(source) {
  const feed = await parser.parseURL(source.url);
  const items = Array.isArray(feed.items) ? feed.items : [];
  return items.map((item) => mapFeedItem(item, source.name));
}

async function crawlAllFeeds() {
  const tasks = FEED_SOURCES.map((source) =>
    crawlSource(source)
      .then((items) => ({ ok: true, source: source.name, items }))
      .catch((error) => ({
        ok: false,
        source: source.name,
        error: error instanceof Error ? error.message : String(error),
      }))
  );

  const results = await Promise.all(tasks);

  const successfulSources = results.filter((result) => result.ok);
  const failedSources = results
    .filter((result) => !result.ok)
    .map((result) => ({ source: result.source, error: result.error }));

  const allItems = successfulSources.flatMap((result) => result.items || []);
  const matches = allItems.filter(itemMatchesKeywords);
  const danishMatches = matches.filter(isLikelyDanishNews);
  const dedupedMatches = deduplicate(danishMatches);
  const latestMatches = dedupedMatches
    .sort((a, b) => b.publishedTimestamp - a.publishedTimestamp)
    .slice(0, MAX_RESULTS)
    .map(({ publishedTimestamp, rawContent, ...safe }) => safe);

  return {
    updatedAt: new Date().toISOString(),
    keywords: KEYWORDS,
    totalResults: latestMatches.length,
    fetchedFromSources: FEED_SOURCES.length,
    successfulSources: successfulSources.length,
    failedSources,
    coverageNote: "",
    items: latestMatches,
  };
}

async function getNews(forceRefresh = false) {
  const now = Date.now();
  const isCacheValid = cache.payload && now - cache.fetchedAt < CACHE_TTL_MS;

  if (!forceRefresh && isCacheValid) {
    return cache.payload;
  }

  if (cache.pending) {
    return cache.pending;
  }

  cache.pending = crawlAllFeeds()
    .then((payload) => {
      cache.payload = payload;
      cache.fetchedAt = Date.now();
      return payload;
    })
    .finally(() => {
      cache.pending = null;
    });

  return cache.pending;
}

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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Brian-radar korer pa http://localhost:${PORT}`);
});
