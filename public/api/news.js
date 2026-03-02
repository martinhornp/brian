const KEYWORD = "brian";
const MAX_RESULTS = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 3500;

const BING_OFFSETS = [
  0, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 111, 121, 131, 141, 151, 161, 171,
  181, 191, 201,
];

const SOURCES = [
  "https://www.dr.dk/nyheder/service/feeds/senestenyt",
  "https://politiken.dk/rss/senestenyt.rss",
  "https://ekstrabladet.dk/rssfeed/nyheder",
  "https://www.information.dk/feed",
  "https://www.altinget.dk/rss",
  "https://www.tv2kosmopol.dk/rss",
  "https://www.tv2ostjylland.dk/rss",
  "https://www.tv2fyn.dk/rss",
  "https://www.tv2nord.dk/rss",
  "https://www.tvmidtvest.dk/rss",
  "https://www.tvsyd.dk/rss",
  "https://www.tv2east.dk/rss",
  ...BING_OFFSETS.map((offset) => {
    const q = encodeURIComponent(`"Brian" site:.dk`);
    const p = offset > 0 ? `&first=${offset}` : "";
    return `https://www.bing.com/news/search?q=${q}&format=rss&cc=dk&setlang=da-dk${p}`;
  }),
];

const cache = {
  fetchedAt: 0,
  payload: null,
  pending: null,
};

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(value) {
  return normalizeWhitespace(decodeEntities(String(value ?? "").replace(/<[^>]+>/g, " ")));
}

function getTagValue(itemXml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = itemXml.match(regex);
  return match ? match[1] : "";
}

function parseRssItems(xml) {
  const itemMatches = String(xml).match(/<item[\s\S]*?<\/item>/gi) || [];

  return itemMatches.map((itemXml) => {
    const title = stripHtml(getTagValue(itemXml, "title"));
    const description = stripHtml(getTagValue(itemXml, "description"));
    const pubDate =
      getTagValue(itemXml, "pubDate") ||
      getTagValue(itemXml, "published") ||
      getTagValue(itemXml, "dc:date");
    const rawLink = decodeEntities(getTagValue(itemXml, "link"));

    return {
      title,
      description,
      rawLink,
      pubDate: normalizeWhitespace(pubDate),
    };
  });
}

function normalizeLink(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host.includes("bing.com") && url.pathname.toLowerCase().includes("/news/apiclick.aspx")) {
      const embedded = url.searchParams.get("url");
      if (embedded) {
        return normalizeLink(decodeURIComponent(embedded));
      }
    }

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
    return normalizeWhitespace(value);
  }
}

function parseTimestamp(value) {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
}

function looksDanish(link) {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return host.includes(".dk") || host.endsWith(".dk");
  } catch {
    return false;
  }
}

function keywordMatch(text) {
  return /\bbrian\b/i.test(text);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "BrianRadarBot/1.0 (+vercel-fallback)",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function buildPayload() {
  const jobs = SOURCES.map(async (url) => {
    try {
      const xml = await fetchText(url);
      const items = parseRssItems(xml);
      return { ok: true, url, items };
    } catch (error) {
      return {
        ok: false,
        url,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const results = await Promise.all(jobs);
  const ok = results.filter((r) => r.ok);
  const failed = results
    .filter((r) => !r.ok)
    .map((r) => ({ source: r.url, error: r.error }));

  const flattened = ok.flatMap((r) =>
    r.items.map((item) => {
      const link = normalizeLink(item.rawLink);
      const summary = item.description;
      const title = item.title;
      const publishedTimestamp = parseTimestamp(item.pubDate);
      const source = (() => {
        try {
          return new URL(link).hostname.replace(/^www\./i, "");
        } catch {
          return "ukendt";
        }
      })();

      return {
        id: `${title}|${link}`.slice(0, 300),
        title,
        summary,
        link,
        source,
        publishedTimestamp,
        publishedAt: publishedTimestamp > 0 ? new Date(publishedTimestamp).toISOString() : null,
      };
    })
  );

  const filtered = flattened.filter((item) => {
    if (!item.link || !item.title) {
      return false;
    }
    if (!looksDanish(item.link)) {
      return false;
    }

    return keywordMatch(`${item.title} ${item.summary} ${item.link}`);
  });

  const dedupeMap = new Map();
  for (const item of filtered) {
    const key = `${normalizeWhitespace(item.title).toLowerCase()}|${item.link}`;
    if (!dedupeMap.has(key)) {
      dedupeMap.set(key, item);
    }
  }

  const items = Array.from(dedupeMap.values())
    .sort((a, b) => b.publishedTimestamp - a.publishedTimestamp)
    .slice(0, MAX_RESULTS)
    .map(({ publishedTimestamp, ...safe }) => safe);

  return {
    updatedAt: new Date().toISOString(),
    keywords: [KEYWORD],
    totalResults: items.length,
    fetchedFromSources: SOURCES.length,
    successfulSources: ok.length,
    failedSources: failed,
    coverageNote: "",
    items,
  };
}

async function getNews(forceRefresh = false) {
  const now = Date.now();
  const cacheValid = cache.payload && now - cache.fetchedAt < CACHE_TTL_MS;

  if (!forceRefresh && cacheValid) {
    return cache.payload;
  }

  if (cache.pending) {
    return cache.pending;
  }

  cache.pending = buildPayload()
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

