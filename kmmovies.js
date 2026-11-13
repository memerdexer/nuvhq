"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------
// If the site moves to a new domain, change this (an old domain that redirects
// to the new one is followed automatically).
var BASE_URL = "https://kmmovies.beer";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var TAG = "[KMMovies]";
// Matching posts to scan (e.g. separate posts for different seasons/editions).
var MAX_PAGES = 3;
// Download links processed at the same time.
var CONCURRENCY = 6;
// How many "link pages" deep to follow (post -> link page -> host page ...).
var MAX_DEPTH = 3;
// Max buttons followed on a single unknown link page.
var MAX_LINKS_PER_PAGE = 12;
var REQUEST_TIMEOUT = 12e3;
var HEAD_TIMEOUT = 1e4;
// After this long (from the start of a request), no new downloads are started.
var TIME_BUDGET_MS = 22e3;
// After this long, return whatever links are finished, even if some are still loading.
var HARD_LIMIT_MS = 36e3;
function raceDeadline(promise, deadline) {
  const ms = deadline - Date.now();
  if (ms <= 0)
    return Promise.resolve([]);
  let timer;
  const stop = new Promise((resolve) => {
    timer = setTimeout(() => resolve([]), ms);
  });
  return Promise.race([promise, stop]).then((v) => {
    clearTimeout(timer);
    return v;
  });
}
// Only show files at this resolution or higher (1080 = 1080p, 1440p, 2160p/4K).
var MIN_HEIGHT = 1080;
// Files whose resolution can't be detected are hidden unless this is true.
var INCLUDE_UNKNOWN_QUALITY = false;
function passesQuality(height) {
  return height ? height >= MIN_HEIGHT : INCLUDE_UNKNOWN_QUALITY;
}
function isLowQualityLabel(text) {
  const h = detectHeight(text);
  return h > 0 && h < MIN_HEIGHT;
}

var SKIP_URL = /(?:t\.me\/|telegram\.|facebook\.com|twitter\.com|\/\/x\.com|whatsapp\.com|instagram\.com|imdb\.com|youtube\.com|youtu\.be|discord|play\.google|apps\.apple|^mailto:|^javascript:)/i;
var KNOWN_PAGE_HOSTS = /kmcloud|magiclinks|hubcloud|hubdrive|gdflix|gdlink|kmmovies|skydrop|vikingfile/i;
// Hosts whose files need a login, cookies or decryption, so a player can't use them.
var UNPLAYABLE_HOSTS = /gofile\.io|transfer\.it|mega\.nz|mega\.io|mediafire\.com/i;
var RESERVED_SLUGS = /^(category|genre|tag|page|actor|director|writer|year|trending|browse|request|faq|contact-us|about-us|site-disclaimer|privacy-policy|dmca|wp-content|wp-json|wp-admin|author|feed|search|comments|login|register)$/i;

// -----------------------------------------------------------------------------
// Network helpers
// -----------------------------------------------------------------------------
function withTimeout(init, timeoutMs) {
  if (!timeoutMs || typeof AbortController === "undefined") {
    return { init, clear: () => {
    } };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch (e) {
    }
  }, timeoutMs);
  return {
    init: __spreadProps(__spreadValues({}, init), { signal: controller.signal }),
    clear: () => clearTimeout(timer)
  };
}
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const retries = options.retries !== void 0 ? options.retries : 1;
    const delay = options.delay !== void 0 ? options.delay : 1e3;
    const timeout = options.timeout !== void 0 ? options.timeout : REQUEST_TIMEOUT;
    for (let i = 0; i <= retries; i++) {
      const t = withTimeout({
        headers: __spreadValues({ "User-Agent": USER_AGENT }, options.headers)
      }, timeout);
      try {
        const response = yield fetch(url, t.init);
        const text = yield response.text();
        t.clear();
        return text;
      } catch (err) {
        t.clear();
        console.log(`${TAG} Request failed for ${url}: ${err && err.message}${i < retries ? `, retrying (${i + 1}/${retries})...` : ""}`);
      }
      if (i < retries) {
        yield new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
      }
    }
    return null;
  });
}
// HEAD request: follows redirects without downloading a body (safe for video URLs).
function headRequest(url, headers) {
  return __async(this, null, function* () {
    const t = withTimeout({
      method: "HEAD",
      headers: __spreadValues({ "User-Agent": USER_AGENT }, headers || {})
    }, HEAD_TIMEOUT);
    try {
      const res = yield fetch(url, t.init);
      t.clear();
      return res;
    } catch (e) {
      t.clear();
      console.log(`${TAG} HEAD failed for ${url}: ${e && e.message}`);
      return null;
    }
  });
}
// Find out what a URL is before downloading it, so a video file is never
// pulled into memory by mistake.
function probeUrl(url, referer) {
  return __async(this, null, function* () {
    const res = yield headRequest(url, referer ? { Referer: referer } : null);
    if (!res)
      return { finalUrl: url, failed: true, type: "" };
    const get = (k) => res.headers && res.headers.get ? res.headers.get(k) || "" : "";
    const type = get("content-type").toLowerCase();
    const disp = get("content-disposition").toLowerCase();
    const len = parseInt(get("content-length")) || 0;
    const status = res.status || 200;
    const isMedia = status < 400 && (/^video\/|application\/octet-stream|matroska|mpegurl/.test(type) || disp.indexOf("attachment") !== -1 || len > 50 * 1024 * 1024 && type.indexOf("html") === -1);
    return {
      finalUrl: res.url || url,
      type,
      isHtml: type.indexOf("html") !== -1,
      isMedia,
      bytes: isMedia ? len : 0,
      failed: status >= 400
    };
  });
}
function mapLimit(items, limit, fn) {
  return __async(this, null, function* () {
    const results = new Array(items.length);
    let next = 0;
    const worker = () => __async(this, null, function* () {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = yield fn(items[i], i);
        } catch (e) {
          results[i] = null;
        }
      }
    });
    const workers = [];
    for (let i = 0; i < Math.min(limit, items.length); i++)
      workers.push(worker());
    yield Promise.all(workers);
    return results;
  });
}
var domainCache = { url: BASE_URL, ts: 0 };
function getDomain() {
  return __async(this, null, function* () {
    if (Date.now() - domainCache.ts < 36e5)
      return domainCache.url;
    const res = yield headRequest(BASE_URL + "/");
    if (res && res.url) {
      const origin = getOrigin(res.url);
      if (origin)
        domainCache.url = origin;
    }
    domainCache.ts = Date.now();
    return domainCache.url;
  });
}

// -----------------------------------------------------------------------------
// TMDB
// -----------------------------------------------------------------------------
function getTmdbDetails(tmdbId, type) {
  return __async(this, null, function* () {
    const isSeries = type === "series" || type === "tv";
    const url = `https://api.themoviedb.org/3/${isSeries ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    console.log(`${TAG} Fetching TMDB details from: ${url}`);
    try {
      const response = yield fetch(url);
      const data = yield response.json();
      if (isSeries) {
        return {
          title: data.name,
          year: data.first_air_date ? parseInt(data.first_air_date.split("-")[0]) : 0
        };
      }
      return {
        title: data.title,
        year: data.release_date ? parseInt(data.release_date.split("-")[0]) : 0
      };
    } catch (error) {
      console.log(`${TAG} TMDB request failed: ${error.message}`);
      return null;
    }
  });
}

// -----------------------------------------------------------------------------
// Small utilities
// -----------------------------------------------------------------------------
function levenshteinDistance(s, t) {
  if (s === t)
    return 0;
  const n = s.length;
  const m = t.length;
  if (n === 0)
    return m;
  if (m === 0)
    return n;
  const d = [];
  for (let i = 0; i <= n; i++) {
    d[i] = [];
    d[i][0] = i;
  }
  for (let j = 0; j <= m; j++)
    d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[n][m];
}
function parseBytes(val) {
  if (typeof val === "number")
    return val;
  if (!val)
    return 0;
  const match = String(val).match(/([0-9]+(?:\.[0-9]+)?)\s*([KMGT]i?B|B)\b/i);
  if (!match)
    return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let multiplier = 1;
  if (unit.indexOf("k") === 0)
    multiplier = 1024;
  else if (unit.indexOf("m") === 0)
    multiplier = 1024 * 1024;
  else if (unit.indexOf("g") === 0)
    multiplier = 1024 * 1024 * 1024;
  else if (unit.indexOf("t") === 0)
    multiplier = 1024 * 1024 * 1024 * 1024;
  return num * multiplier;
}
function formatBytes(val) {
  if (!val)
    return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  let i = Math.floor(Math.log(val) / Math.log(k));
  if (i < 0)
    i = 0;
  return parseFloat((val / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
function getOrigin(url) {
  const m = String(url || "").match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1] : "";
}
function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : "";
}
function absoluteUrl(href, base) {
  if (!href)
    return null;
  href = String(href).trim();
  if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href))
    return null;
  if (/^https?:\/\//i.test(href))
    return href;
  if (href.startsWith("//"))
    return "https:" + href;
  const origin = getOrigin(base);
  if (!origin)
    return null;
  return origin + (href.startsWith("/") ? "" : "/") + href;
}
function unique(arr) {
  const seen = /* @__PURE__ */ new Set();
  return arr.filter((x) => {
    if (!x || seen.has(x))
      return false;
    seen.add(x);
    return true;
  });
}
function detectHeight(text) {
  if (!text)
    return 0;
  const m = String(text).match(/\b(4320|2160|1440|1080|720|576|480|360)p\b/i);
  if (m)
    return parseInt(m[1]);
  if (/\b(4k|uhd)\b/i.test(text))
    return 2160;
  return 0;
}
function ownText($, el) {
  let s = "";
  (el.children || []).forEach((c) => {
    if (c.type === "text")
      s += c.data;
  });
  return s.replace(/\s+/g, " ").trim();
}
function isFileLikeUrl(url) {
  return /\.(mkv|mp4|avi|webm|m3u8|mov)(?:[?#]|$)/i.test(String(url || ""));
}
function hostLabel(url) {
  const h = hostOf(url).replace(/^www\./, "");
  if (/r2\.dev$/.test(h))
    return "Direct R2";
  if (/pixeldra/.test(h))
    return "PixelDrain";
  const parts = h.split(".");
  const name = parts.length >= 2 ? parts[parts.length - 2] : h;
  if (/kmcloud/i.test(name))
    return "KMCloud";
  if (/buzzheavier|bzzhr/i.test(h))
    return "BuzzHeavier";
  if (/skydrop/i.test(h))
    return "SkyDrop";
  if (/vikingfile/i.test(h))
    return "VikingFile";
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Direct";
}
function decodeEntities(s) {
  try {
    return cheerio.load(`<p>${s}</p>`)("p").text();
  } catch (e) {
    return s;
  }
}
// "1080p 1080p 10BIT 3.1GB" -> "1080p 10BIT 3.1GB"
function cleanLabel(text) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
  return words.filter((w, i) => i === 0 || w.toLowerCase() !== words[i - 1].toLowerCase()).join(" ");
}
function episodeFromText(t) {
  if (!t)
    return null;
  const m = t.match(/S\d{1,2}[\s._-]*E(\d{1,3})(?!\d)/i) || t.match(/\bEpisode[\s._-]*(\d{1,3})(?!\d)/i) || t.match(/\bEp[\s._-]*(\d{1,3})(?!\d)/i) || t.match(/(?:^|[^A-Za-z0-9])E(\d{1,3})(?!\d)/);
  return m ? parseInt(m[1]) : null;
}
function seasonFromText(t) {
  if (!t)
    return null;
  const m = t.match(/\bS(\d{1,2})(?=[\s._-]*E\d)/i) || t.match(/\bSeason[\s._-]*(\d{1,2})(?!\d)/i);
  return m ? parseInt(m[1]) : null;
}
function seasonFromUrl(url) {
  const path = String(url || "").replace(/^https?:\/\/[^/]+/i, "");
  const m = path.match(/(?:^|[-_/.])s0*(\d{1,2})(?=[-_/.]|$)/i) || path.match(/season[-_]?0*(\d{1,2})(?!\d)/i);
  return m ? parseInt(m[1]) : null;
}
// Seasons named in a title like "Show S01-S03" -> {from:1,to:3}
function seasonRangeFromTitle(t) {
  const m = String(t || "").match(/\bS(\d{1,2})(?:\s*[-\u2013]\s*S?(\d{1,2}))?\b/i) || String(t || "").match(/\bSeasons?\s*(\d{1,2})(?:\s*[-\u2013]\s*(\d{1,2}))?/i);
  if (!m)
    return null;
  const a = parseInt(m[1]);
  const b = m[2] ? parseInt(m[2]) : a;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

// -----------------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------------
var cheerio = require("cheerio-without-node-native");
var EDITION_WORDS = ["imax", "extended", "edition", "directors", "director", "cut", "uncut", "unrated", "theatrical", "remastered", "4k", "uhd", "hdr", "dv", "hindi", "english", "dual", "multi", "audio", "dubbed", "remux", "version", "complete", "download"];
function stripDiacritics(s) {
  try {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {
    return s;
  }
}
function normalizeTitle(s) {
  return stripDiacritics(String(s || "")).toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/['\u2019`]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function cleanCardTitle(cardTitle, queryNorm) {
  let t = normalizeTitle(cardTitle).replace(/\b(?:seasons?\s*\d+|s\d+)(?:\s+(?:to\s+|and\s+)?s?\d+)*\b/g, " ");
  const queryWords = new Set(queryNorm.split(" "));
  return t.split(" ").filter((w) => {
    if (!w)
      return false;
    if (queryWords.has(w))
      return true;
    if (EDITION_WORDS.indexOf(w) !== -1)
      return false;
    if (/^(19|20)\d{2}$/.test(w))
      return false;
    return true;
  }).join(" ").trim();
}
function titleThreshold(len) {
  if (len <= 3)
    return 0;
  if (len <= 6)
    return 1;
  if (len <= 9)
    return 2;
  return 4;
}
// Turns any "Title (2024)" text into {title, year}
function splitTitleYear(text) {
  const m = String(text || "").replace(/\s+/g, " ").match(/^(.*?)\s*\((\d{4})\)/);
  if (!m || !m[1].trim())
    return null;
  return { title: m[1].trim(), year: parseInt(m[2]) };
}
// Post cards on this site are links like:
// "<img alt='Title (2026) poster'> 4K WEB-DL ... Title (2026) Movie Genre"
function parseCards(html, domain) {
  const $ = cheerio.load(html);
  const host = hostOf(domain);
  const cards = [];
  $("a[href]").each((_, a) => {
    const href = absoluteUrl($(a).attr("href"), domain);
    if (!href || hostOf(href) !== host)
      return;
    const path = href.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
    const pm = path.match(/^\/([^/]+)\/?$/);
    if (!pm || RESERVED_SLUGS.test(pm[1]))
      return;
    const alt = ($(a).find("img").attr("alt") || "").replace(/\s*poster\s*$/i, "").trim();
    const text = $(a).text().replace(/\s+/g, " ").trim();
    const parsed = splitTitleYear(alt) || splitTitleYear($(a).attr("title")) || splitTitleYear(text);
    if (!parsed)
      return;
    let kind = null;
    if (/\bSeries\b/.test(text))
      kind = "series";
    else if (/\bMovie\b/.test(text))
      kind = "movie";
    cards.push({ href, title: parsed.title, year: parsed.year, kind });
  });
  return cards;
}
function parseApiResults(json) {
  const cards = [];
  try {
    const arr = JSON.parse(json);
    (Array.isArray(arr) ? arr : []).forEach((r) => {
      const title = decodeEntities(r && r.title && r.title.rendered ? r.title.rendered : r && r.title || "");
      const parsed = splitTitleYear(title);
      if (parsed && (r.url || r.link))
        cards.push({ href: r.url || r.link, title: parsed.title, year: parsed.year, kind: null });
    });
  } catch (e) {
  }
  return cards;
}
function matchCards(cards, name, year, isSeries, season) {
  const queryNorm = normalizeTitle(name);
  const threshold = titleThreshold(queryNorm.length);
  const found = /* @__PURE__ */ new Map();
  cards.forEach((c) => {
    if (c.kind && c.kind !== (isSeries ? "series" : "movie"))
      return;
    const cardNorm = cleanCardTitle(c.title, queryNorm);
    if (!cardNorm)
      return;
    const distance = levenshteinDistance(cardNorm, queryNorm);
    if (distance > threshold)
      return;
    if (year && c.year) {
      // Series posts show the year of the latest season, so only reject older years.
      const ok = isSeries ? c.year >= year - 1 : Math.abs(c.year - year) <= 1;
      if (!ok) {
        console.log(`${TAG} Skip: Year mismatch (${c.year} vs ${year}) - ${c.title}`);
        return;
      }
    }
    if (isSeries && season) {
      const range = seasonRangeFromTitle(c.title);
      if (range && (season < range.from || season > range.to))
        return;
    }
    console.log(`${TAG} Match: "${c.title} (${c.year})" (Dist: ${distance}) -> ${c.href}`);
    if (!found.has(c.href) || found.get(c.href) > distance)
      found.set(c.href, distance);
  });
  return Array.from(found.entries()).sort((a, b) => a[1] - b[1]).slice(0, MAX_PAGES).map((e) => e[0]);
}
function findPosts(name, year, isSeries, season) {
  return __async(this, null, function* () {
    const domain = yield getDomain();
    const plain = name.replace(/[:\-\u2013\u2014!?.,'"\u2019]/g, " ").replace(/\s+/g, " ").trim();
    const queries = unique([plain, year ? `${plain} ${year}` : null]);
    const pages = yield Promise.all(queries.map((q) => {
      const url = `${domain}/?s=${encodeURIComponent(q)}`;
      console.log(`${TAG} Search Request URL: ${url}`);
      return fetchText(url);
    }));
    let cards = [];
    pages.forEach((html) => {
      if (html)
        cards = cards.concat(parseCards(html, domain));
    });
    let urls = matchCards(cards, name, year, isSeries, season);
    if (urls.length === 0) {
      // Fallback: WordPress search API.
      const api = yield fetchText(`${domain}/wp-json/wp/v2/search?search=${encodeURIComponent(plain)}&per_page=20`, { retries: 0 });
      if (api)
        urls = matchCards(parseApiResults(api), name, year, isSeries, season);
    }
    console.log(`${TAG} Found ${urls.length} matching post(s)`);
    return urls;
  });
}

// -----------------------------------------------------------------------------
// Post page: collect the download buttons
// -----------------------------------------------------------------------------
function extractPostLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const host = hostOf(pageUrl);
  const pageTitle = $("h1").first().text().trim() || $("title").first().text().trim();
  const links = [];
  const seen = /* @__PURE__ */ new Set();
  let currentSeason = null;
  $("*").each((_, el) => {
    if (el.type !== "tag")
      return;
    if (el.name === "a") {
      const href = absoluteUrl($(el).attr("href"), pageUrl);
      if (!href || seen.has(href) || hostOf(href) === host || SKIP_URL.test(href))
        return;
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!/\b\d{3,4}p\b|\b4k\b|\d+(?:\.\d+)?\s*[GM]B\b/i.test(text))
        return;
      seen.add(href);
      links.push({ url: href, text: cleanLabel(text), season: currentSeason });
      return;
    }
    const own = ownText($, el);
    if (own.length && own.length < 40) {
      const m = own.match(/^Season\s*0*(\d{1,2})\b/i);
      if (m)
        currentSeason = parseInt(m[1]);
    }
  });
  return { pageTitle, links };
}
function pickEpisodeLinks(post, season) {
  const range = seasonRangeFromTitle(post.pageTitle);
  const pageCovers = !range || season >= range.from && season <= range.to;
  const seasonLinks = post.links.filter((l) => {
    const fromUrl = seasonFromUrl(l.url);
    if (fromUrl !== null)
      return fromUrl === season;
    if (l.season !== null)
      return l.season === season;
    return pageCovers;
  });
  // Prefer the "Episode Wise" buttons; combined/zip packs can't play one episode.
  const episodeWise = seasonLinks.filter((l) => /\/series\/|\/\/episodes\./i.test(l.url) || /episode/i.test(l.text));
  if (episodeWise.length)
    return episodeWise;
  return seasonLinks.filter((l) => !/\bzip\b|combined|pack/i.test(l.text));
}

// -----------------------------------------------------------------------------
// HubCloud / GDFlix extractors
// -----------------------------------------------------------------------------
function valueAfterParam(url, names) {
  const s = String(url || "");
  for (const n of names) {
    const i = s.indexOf(n + "=");
    if (i === -1)
      continue;
    let v = s.slice(i + n.length + 1);
    if (/^https?%3A/i.test(v)) {
      try {
        v = decodeURIComponent(v);
      } catch (e) {
      }
    }
    if (/^https?:\/\//i.test(v))
      return v;
  }
  return null;
}
function toPixeldrainDirect(href) {
  const m = href.match(/^(https?:\/\/[^/]*pixeldra[^/]*)\/u\/([A-Za-z0-9_-]+)/i);
  return m ? `${m[1]}/api/file/${m[2]}?download` : href;
}
function resolveRedirect(link) {
  return __async(this, null, function* () {
    const fromHref = valueAfterParam(link, ["link", "url"]);
    if (fromHref)
      return fromHref;
    const res = yield headRequest(link);
    const finalUrl = res && res.url ? res.url : null;
    if (finalUrl) {
      const fromFinal = valueAfterParam(finalUrl, ["link", "url"]);
      if (fromFinal)
        return fromFinal;
      if (finalUrl !== link)
        return finalUrl;
    }
    return link;
  });
}
var IS_SERVER = typeof process !== "undefined" && !!(process.versions && process.versions.node);
// BuzzHeavier: /<id>/download answers with the real file address in a header.
function resolveBuzz(link) {
  return __async(this, null, function* () {
    const base = link.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\/download$/, "");
    const target = base + "/download";
    const pick = (res) => {
      if (!res || !res.headers || !res.headers.get)
        return null;
      const v = res.headers.get("hx-redirect") || res.headers.get("location");
      return v ? absoluteUrl(v, base) : null;
    };
    const head = yield headRequest(target, { Referer: base, "HX-Request": "true" });
    let found = pick(head);
    if (!found && head && head.url && head.url !== target && !/buzzheavier|bzzhr/i.test(head.url))
      found = head.url;
    if (!found && IS_SERVER) {
      // On a server the redirect header can be read without following it,
      // so the video itself is never downloaded.
      const t = withTimeout({ method: "GET", redirect: "manual", headers: { "User-Agent": USER_AGENT, Referer: base, "HX-Request": "true" } }, HEAD_TIMEOUT);
      try {
        const res = yield fetch(target, t.init);
        t.clear();
        found = pick(res);
        try {
          if (res.body && res.body.cancel)
            res.body.cancel();
        } catch (e) {
        }
      } catch (e) {
        t.clear();
        console.log(`BuzzHeavier lookup failed for ${link}: ${e && e.message}`);
      }
    }
    return found;
  });
}
function resolveServerLink(c) {
  return __async(this, null, function* () {
    if (c.kind === "pixel")
      return toPixeldrainDirect(c.href);
    if (c.kind === "redirect")
      return yield resolveRedirect(c.href);
    if (c.kind === "buzz")
      return yield resolveBuzz(c.href);
    if (c.kind === "probe") {
      const p = yield probeUrl(c.href);
      return p.isMedia ? p.finalUrl : null;
    }
    return c.href;
  });
}
function classifyHubCloudButton(text, href, isButton) {
  const t = text.toLowerCase();
  const h = href.toLowerCase();
  if (SKIP_URL.test(h) || /hubcloud\.php|hubcloud[^/]*\/drive\//.test(h))
    return null;
  if (t.indexOf("10gbps") !== -1)
    return { label: "10Gbps", kind: "redirect" };
  if (t.indexOf("buzz") !== -1 || h.indexOf("buzzheavier") !== -1)
    return { label: "BuzzServer", kind: "buzz" };
  if (t.indexOf("pixel") !== -1 || h.indexOf("pixeldra") !== -1)
    return { label: "PixelServer", kind: "pixel" };
  if (t.indexOf("fslv2") !== -1)
    return { label: "FSLv2", kind: "direct" };
  if (t.indexOf("fsl") !== -1)
    return { label: "FSL", kind: "direct" };
  if (/\bs3\b/.test(t))
    return { label: "S3", kind: "direct" };
  if (t.indexOf("mega") !== -1)
    return { label: "Mega", kind: "direct" };
  if (t.indexOf("zipdisk") !== -1 || h.indexOf("workers.dev") !== -1)
    return { label: "ZipDisk", kind: "direct" };
  if (t.indexOf("download file") !== -1 || h.indexOf("r2.dev") !== -1)
    return { label: "Direct", kind: "direct" };
  if (isButton && /download|server/.test(t)) {
    const b = text.match(/\[([^\]]+)\]/);
    let label = (b ? b[1] : text.replace(/download/gi, "")).replace(/\s+/g, " ").trim();
    if (!label || label.length > 30)
      label = "Mirror";
    return { label, kind: "probe" };
  }
  return null;
}
function classifyGdFlixButton(text, href, isButton) {
  const t = text.toLowerCase();
  const h = href.toLowerCase();
  if (SKIP_URL.test(h) || /gofile|drivebot|login|signup|t\.me/.test(h + " " + t))
    return null;
  if (t.indexOf("instant") !== -1)
    return { label: "GDFlix Instant", kind: "redirect" };
  if (t.indexOf("pixel") !== -1 || h.indexOf("pixeldra") !== -1)
    return { label: "PixelDrain", kind: "pixel" };
  if (t.indexOf("fsl") !== -1)
    return { label: "GDFlix FSL", kind: "direct" };
  if (t.indexOf("cloud") !== -1 || h.indexOf("r2.dev") !== -1)
    return { label: "GDFlix Cloud", kind: "direct" };
  if (isFileLikeUrl(href))
    return { label: "GDFlix Direct", kind: "direct" };
  if (isButton && /download|direct|server/.test(t))
    return { label: "GDFlix " + (text.replace(/download|\[|\]/gi, "").trim().slice(0, 20) || "Mirror"), kind: "probe" };
  return null;
}
function extractButtons($, pageUrl, meta, classify) {
  return __async(this, null, function* () {
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    $("a").each((_, a) => {
      const text = $(a).text().replace(/\s+/g, " ").trim();
      const href = absoluteUrl($(a).attr("href"), pageUrl);
      if (!href || seen.has(href))
        return;
      const server = classify(text, href, $(a).hasClass("btn") || /btn|button/i.test($(a).attr("class") || ""));
      if (!server)
        return;
      seen.add(href);
      candidates.push(__spreadProps(__spreadValues({}, server), { href }));
    });
    const resolved = yield Promise.all(candidates.map((c) => resolveServerLink(c).then((url) => url ? { source: c.label, url, meta } : null).catch(() => null)));
    return resolved.filter(Boolean);
  });
}
function extractHubCloud(hubCloudUrl, baseMeta) {
  return __async(this, null, function* () {
    let linksUrl = hubCloudUrl;
    let linksHtml = null;
    if (!/hubcloud\.php|gamerxyt/i.test(hubCloudUrl)) {
      const html = yield fetchText(hubCloudUrl, { headers: { Referer: hubCloudUrl }, retries: 1 });
      if (!html)
        return [];
      const m = html.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/);
      if (m) {
        linksUrl = absoluteUrl(m[1], hubCloudUrl);
      } else {
        const $p = cheerio.load(html);
        const dl = $p("#download").attr("href");
        if (dl)
          linksUrl = absoluteUrl(dl, hubCloudUrl);
        else
          linksHtml = html;
      }
    }
    if (!linksHtml) {
      if (!linksUrl)
        return [];
      linksHtml = yield fetchText(linksUrl, { headers: { Referer: hubCloudUrl }, retries: 1 });
      if (!linksHtml)
        return [];
    }
    const $ = cheerio.load(linksHtml);
    const title = ($("title").first().text() || "").trim() || ($(".card-header").first().text() || "").trim();
    const meta = __spreadProps(__spreadValues({}, baseMeta), {
      bytes: parseBytes(($("#size").first().text() || "").trim()) || baseMeta.bytes,
      title: title || baseMeta.title
    });
    if (!meta.height)
      meta.height = detectHeight(meta.title);
    const results = yield extractButtons($, linksUrl, meta, classifyHubCloudButton);
    console.log(`${TAG} HubCloud: ${results.length} link(s) from ${hubCloudUrl}`);
    return results;
  });
}
function extractGdFlix(url, baseMeta) {
  return __async(this, null, function* () {
    let pageUrl = url;
    let html = yield fetchText(url, { retries: 1 });
    if (!html)
      return [];
    let $ = cheerio.load(html);
    const refresh = metaRefreshUrl($, url);
    if (refresh && refresh !== url && $("a.btn").length === 0) {
      pageUrl = refresh;
      html = yield fetchText(refresh, { retries: 1 });
      if (!html)
        return [];
      $ = cheerio.load(html);
    }
    let name = "";
    let size = "";
    $("li, td, p").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (!name && /^name\s*:/i.test(t))
        name = t.replace(/^name\s*:\s*/i, "");
      if (!size && /^size\s*:/i.test(t))
        size = t.replace(/^size\s*:\s*/i, "");
    });
    const meta = __spreadProps(__spreadValues({}, baseMeta), {
      title: name || baseMeta.title,
      bytes: parseBytes(size) || baseMeta.bytes
    });
    if (!meta.height)
      meta.height = detectHeight(meta.title);
    const results = yield extractButtons($, pageUrl, meta, classifyGdFlixButton);
    console.log(`${TAG} GDFlix: ${results.length} link(s) from ${url}`);
    return results;
  });
}
function metaRefreshUrl($, base) {
  let target = null;
  $("meta").each((_, m) => {
    if (target)
      return;
    if (String($(m).attr("http-equiv") || "").toLowerCase() !== "refresh")
      return;
    const mm = String($(m).attr("content") || "").match(/url\s*=\s*['"]?([^'";]+)/i);
    if (mm)
      target = absoluteUrl(mm[1], base);
  });
  return target;
}

// -----------------------------------------------------------------------------
// Generic link-page resolver (kmcloud / magiclinks / unknown hosts)
// -----------------------------------------------------------------------------
function makeLink(source, url, meta) {
  return { source, url, meta };
}
function findFilename($) {
  let name = "";
  $("h1, h2, h3, h4, h5, title, .file-name, .filename, td, li, span, p, div").each((_, el) => {
    if (name)
      return;
    const t = ownText($, el);
    const m = t.match(/[^\s/\\"'<>]{3,}\.(?:mkv|mp4|avi|webm)\b/i);
    if (m)
      name = m[0];
  });
  return name;
}
// Assigns each link on a page to the "Episode N" label written before it.
function labelAnchorsWithEpisodes($) {
  const map = /* @__PURE__ */ new Map();
  let current = null;
  let found = false;
  $("*").each((_, el) => {
    if (el.type !== "tag")
      return;
    if (el.name === "a") {
      const e = episodeFromText($(el).text());
      if (e !== null)
        found = true;
      map.set(el, e !== null ? e : current);
      return;
    }
    const own = ownText($, el);
    if (own && own.length < 120) {
      const e = episodeFromText(own);
      if (e !== null) {
        current = e;
        found = true;
      }
    }
  });
  return found ? map : null;
}
function resolveAny(url, ctx, depth, seen) {
  return __async(this, null, function* () {
    if (!url || seen.has(url) || SKIP_URL.test(url))
      return [];
    seen.add(url);
    const lower = url.toLowerCase();
    if (/pixeldra[^/]*\/(u|api\/file)\//.test(lower))
      return [makeLink("PixelDrain", toPixeldrainDirect(url), ctx.meta)];
    if (isFileLikeUrl(url))
      return [makeLink(hostLabel(url), url, ctx.meta)];
    if (UNPLAYABLE_HOSTS.test(lower)) {
      console.log(`${TAG} Skipping ${hostOf(url)} (needs login or decryption, can't be played directly)`);
      return [];
    }
    if (/buzzheavier|bzzhr/.test(lower)) {
      const direct = yield resolveBuzz(url);
      return direct ? [makeLink("BuzzHeavier", direct, ctx.meta)] : [];
    }
    if (/hubcloud\.|hubcloud\.php|gamerxyt/.test(lower))
      return yield extractHubCloud(url, ctx.meta);
    if (/gdflix|gdlink/.test(lower))
      return yield extractGdFlix(url, ctx.meta);
    if (depth > MAX_DEPTH)
      return [];
    const probe = yield probeUrl(url, ctx.referer);
    if (probe.isMedia) {
      const meta = probe.bytes && !ctx.meta.bytes ? __spreadProps(__spreadValues({}, ctx.meta), { bytes: probe.bytes }) : ctx.meta;
      return [makeLink(hostLabel(probe.finalUrl), probe.finalUrl, meta)];
    }
    const target = probe.finalUrl || url;
    if (target !== url && /hubcloud|gdflix|gdlink|pixeldra/i.test(target))
      return yield resolveAny(target, ctx, depth, seen);
    const unknownType = probe.failed || !probe.type;
    const shouldGet = probe.isHtml || unknownType && KNOWN_PAGE_HOSTS.test(hostOf(target)) && !isFileLikeUrl(target);
    if (!shouldGet) {
      console.log(`${TAG} Skipping non-page link (${probe.type || "unknown type"}): ${target}`);
      return [];
    }
    const html = yield fetchText(target, { retries: 1, headers: { Referer: ctx.referer || target } });
    if (!html)
      return [];
    return yield parseLinkPage(html, target, ctx, depth, seen);
  });
}
function parseLinkPage(html, pageUrl, ctx, depth, seen) {
  return __async(this, null, function* () {
    const $ = cheerio.load(html);
    const fname = findFilename($);
    const meta = fname ? __spreadProps(__spreadValues({}, ctx.meta), { title: fname, height: ctx.meta.height || detectHeight(fname) }) : ctx.meta;
    const results = [];
    // 1) Video files embedded directly in the page.
    const unescaped = html.replace(/\\\//g, "/");
    const media = [];
    $("video[src], source[src]").each((_, el) => {
      media.push(absoluteUrl($(el).attr("src"), pageUrl));
    });
    (unescaped.match(/https?:\/\/[^\s"'<>\\]+?\.(?:mkv|mp4|m3u8)(?:\?[^\s"'<>\\]*)?/gi) || []).forEach((u) => media.push(u));
    unique(media).forEach((u) => {
      if (!seen.has(u)) {
        seen.add(u);
        results.push(makeLink(hostLabel(u), u, meta));
      }
    });
    // 2) Redirect pages.
    const redirect = metaRefreshUrl($, pageUrl) || (() => {
      const m = html.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/) || html.match(/location\.replace\(\s*["']([^"']+)["']\s*\)/);
      return m ? absoluteUrl(m[1], pageUrl) : null;
    })();
    // 3) Buttons/links that lead to the file.
    const pageHost = hostOf(pageUrl);
    const epMap = ctx.episode ? labelAnchorsWithEpisodes($) : null;
    let candidates = [];
    const picked = /* @__PURE__ */ new Set();
    const addCandidate = (el, rawHref) => {
      const href = absoluteUrl(rawHref, pageUrl);
      if (!href || href === pageUrl || seen.has(href) || picked.has(href) || SKIP_URL.test(href))
        return;
      if (epMap && el.name === "a" && epMap.get(el) !== ctx.episode)
        return;
      const text = ($(el).text() || $(el).attr("title") || "").replace(/\s+/g, " ").trim();
      if (isLowQualityLabel(text))
        return;
      const lh = href.toLowerCase();
      if (UNPLAYABLE_HOSTS.test(lh) || /^\s*(gofile|transfer\s*it|mega)\s*$/i.test(text))
        return;
      const known = /hubcloud|hubdrive|gdflix|gdlink|pixeldra|kmcloud|buzzheavier|bzzhr|skydrop|vikingfile/.test(lh) || /skydrop|buzz|viking|10\s*gbps/i.test(text) || isFileLikeUrl(href);
      const isButton = el.name === "button" || /btn|button/i.test($(el).attr("class") || "");
      const looksLikeDownload = /download|server|mirror|watch|stream|play|instant|direct|cloud|drive|\b\d{3,4}p\b/i.test(text);
      if (!known && !isButton && !looksLikeDownload)
        return;
      if (!known && hostOf(href) === pageHost && !/download|direct|\bdl\b|file/i.test(text + " " + lh))
        return;
      picked.add(href);
      candidates.push({ href, text, known });
    };
    $("a[href]").each((_, a) => addCandidate(a, $(a).attr("href")));
    // Buttons that open their link with JavaScript instead of a normal link.
    $("[onclick], [data-href], [data-url], [data-link]").each((_, el) => {
      const raw = $(el).attr("data-href") || $(el).attr("data-url") || $(el).attr("data-link") || (String($(el).attr("onclick") || "").match(/https?:\/\/[^'"\s)]+/) || [])[0];
      if (raw)
        addCandidate(el, raw);
    });
    if (redirect && !seen.has(redirect))
      candidates.unshift({ href: redirect, text: "", known: true });
    candidates = candidates.filter((c) => c.known).concat(candidates.filter((c) => !c.known)).slice(0, MAX_LINKS_PER_PAGE);
    const nested = yield Promise.all(candidates.map((c) => {
      const extra = {};
      if (!meta.height && detectHeight(c.text))
        extra.height = detectHeight(c.text);
      if (!meta.bytes && parseBytes(c.text))
        extra.bytes = parseBytes(c.text);
      const childCtx = __spreadProps(__spreadValues({}, ctx), { meta: __spreadValues(__spreadValues({}, meta), extra), referer: pageUrl });
      return resolveAny(c.href, childCtx, depth + 1, seen).catch(() => []);
    }));
    return results.concat(nested.reduce((acc, v) => acc.concat(v || []), []));
  });
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------
function keepResult(link, season, episode) {
  const name = link.meta && link.meta.title || "";
  if (/\.(zip|rar|7z)\b/i.test(name) || /\.(zip|rar|7z)(?:[?#]|$)/i.test(link.url))
    return false;
  if (!episode)
    return true;
  if (/\b(complete|combined|pack)\b/i.test(name))
    return false;
  const e = episodeFromText(name);
  if (e === null)
    return true;
  const s = seasonFromText(name);
  return e === episode && (s === null || s === season);
}
function getStreams(tmdbId, type, season, episode) {
  return __async(this, null, function* () {
    const startedAt = Date.now();
    const tmdb = yield getTmdbDetails(tmdbId, type);
    if (!tmdb || !tmdb.title)
      return [];
    const isSeries = type === "series" || type === "tv";
    const s = season ? parseInt(season) : null;
    const e = episode ? parseInt(episode) : null;
    const wantsEpisode = isSeries && s && e;
    console.log(`${TAG} Search: ${tmdb.title} (${tmdb.year})${wantsEpisode ? ` S${s}E${e}` : ""}`);
    const postUrls = yield findPosts(tmdb.title, tmdb.year, isSeries, wantsEpisode ? s : null);
    if (postUrls.length === 0) {
      console.log(`${TAG} No matching post found`);
      return [];
    }
    const pages = yield Promise.all(postUrls.map((u) => fetchText(u)));
    const jobs = [];
    pages.forEach((html, i) => {
      if (!html)
        return;
      const post = extractPostLinks(html, postUrls[i]);
      const all = wantsEpisode ? pickEpisodeLinks(post, s) : post.links;
      const links = all.filter((l) => !isLowQualityLabel(l.text));
      console.log(`${TAG} ${links.length} download button(s) on ${postUrls[i]} (${all.length - links.length} below ${MIN_HEIGHT}p skipped)`);
      links.forEach((l) => jobs.push({ link: l, referer: postUrls[i] }));
    });
    // 2160p first (then bigger files), so the best files are done before any time limit.
    jobs.sort((a, b) => detectHeight(b.link.text) - detectHeight(a.link.text) || parseBytes(b.link.text) - parseBytes(a.link.text));
    const softDeadline = startedAt + TIME_BUDGET_MS;
    const hardDeadline = startedAt + HARD_LIMIT_MS;
    const perLink = yield mapLimit(jobs, CONCURRENCY, (job) => {
      if (Date.now() > softDeadline)
        return [];
      const meta = {
        title: "",
        label: job.link.text,
        height: detectHeight(job.link.text),
        bytes: wantsEpisode ? 0 : parseBytes(job.link.text)
      };
      const ctx = { meta, season: wantsEpisode ? s : null, episode: wantsEpisode ? e : null, referer: job.referer };
      return raceDeadline(resolveAny(job.link.url, ctx, 0, /* @__PURE__ */ new Set()).catch((err) => {
        console.log(`${TAG} Link error: ${err && err.message}`);
        return [];
      }), hardDeadline);
    });
    const seenUrls = /* @__PURE__ */ new Set();
    const entries = [];
    perLink.forEach((list) => {
      (list || []).forEach((link) => {
        if (!link || !link.url || seenUrls.has(link.url))
          return;
        if (!keepResult(link, s, wantsEpisode ? e : null))
          return;
        seenUrls.add(link.url);
        const m = link.meta || {};
        const height = m.height || detectHeight(m.title);
        if (!passesQuality(height))
          return;
        const sizeText = formatBytes(m.bytes);
        entries.push({
          height,
          bytes: m.bytes || 0,
          stream: {
            name: `KMMovies - ${link.source}${height ? ` ${height}p` : ""}`,
            title: [m.title || m.label || "KMMovies", sizeText].filter(Boolean).join("\n"),
            url: link.url,
            quality: height ? `${height}p` : void 0,
            behaviorHints: { bingeGroup: `kmmovies-${link.source}` }
          }
        });
      });
    });
    entries.sort((a, b) => b.height - a.height || b.bytes - a.bytes);
    console.log(`${TAG} Returning ${entries.length} stream(s)`);
    return entries.map((x) => x.stream);
  });
}
module.exports = { getStreams };
