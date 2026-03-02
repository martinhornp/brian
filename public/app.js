const API_URL = "/api/news";

const refreshBtn = document.getElementById("refreshBtn");
const statusText = document.getElementById("statusText");
const updatedAtElement = document.getElementById("updatedAt");
const resultCountElement = document.getElementById("resultCount");
const sourceCountElement = document.getElementById("sourceCount");
const coverageNoteElement = document.getElementById("coverageNote");
const errorBox = document.getElementById("errorBox");
const newsList = document.getElementById("newsList");
const emptyState = document.getElementById("emptyState");
const template = document.getElementById("newsItemTemplate");

function formatDate(isoDate) {
  if (!isoDate) {
    return "Ukendt tidspunkt";
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "Ukendt tidspunkt";
  }

  return date.toLocaleString("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function setLoading(isLoading) {
  refreshBtn.disabled = isLoading;
}

function setStatus(message) {
  statusText.textContent = message;
}

function setError(message) {
  if (!message) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }

  errorBox.hidden = false;
  errorBox.textContent = message;
}

function renderNews(items) {
  newsList.textContent = "";

  if (!Array.isArray(items) || items.length === 0) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  const fragment = document.createDocumentFragment();

  items.forEach((item, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.style.animationDelay = `${Math.min(index * 25, 350)}ms`;

    const titleLink = node.querySelector(".news-title");
    titleLink.textContent = item.title || "Uden titel";
    titleLink.href = item.link || "#";

    const summaryElement = node.querySelector(".news-summary");
    const summary = item.summary || "Ingen resume i feedet.";
    summaryElement.textContent = summary;

    const dateElement = node.querySelector(".news-date");
    dateElement.textContent = formatDate(item.publishedAt);

    fragment.appendChild(node);
  });

  newsList.appendChild(fragment);
}

function renderMeta(data) {
  updatedAtElement.textContent = formatDate(data.updatedAt);
  resultCountElement.textContent = `${data.totalResults || 0} / 50`;
  sourceCountElement.textContent = `${data.successfulSources || 0} af ${
    data.fetchedFromSources || 0
  }`;
  coverageNoteElement.textContent = data.coverageNote || "";
}

async function loadNews(forceRefresh = false) {
  setLoading(true);
  setStatus(forceRefresh ? "Opdaterer kilder..." : "Henter nyheder...");
  setError("");

  try {
    const endpoint = forceRefresh ? `${API_URL}?refresh=1` : API_URL;
    const response = await fetch(endpoint, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Serverfejl (${response.status})`);
    }

    const data = await response.json();
    renderMeta(data);
    renderNews(data.items || []);

    const failures = Array.isArray(data.failedSources) ? data.failedSources.length : 0;
    if (failures > 0) {
      setStatus(`Klar: ${data.totalResults || 0} resultater (${failures} kilder fejlede).`);
    } else {
      setStatus(`Klar: ${data.totalResults || 0} resultater.`);
    }
  } catch (error) {
    renderNews([]);
    setError("Kunne ikke hente nyheder lige nu. Prøv igen.");
    setStatus(error instanceof Error ? error.message : "Fejl ved hentning.");
  } finally {
    setLoading(false);
  }
}

refreshBtn.addEventListener("click", () => {
  loadNews(true);
});

loadNews(false);

setInterval(() => {
  loadNews(false);
}, 8 * 60 * 1000);
