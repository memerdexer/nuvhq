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
// Tried in order if domains.json is unreachable or its domain is down.
var KNOWN_DOMAINS = ["https://4khdhub.one", "https://4khdhub.click"];
var BASE_URL = KNOWN_DOMAINS[0];
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
// How many matching site pages (e.g. separate 4K / IMAX / season posts) to scan.
var MAX_PAGES = 4;
// How many download items are processed at the same time.
var CONCURRENCY = 8;
// Per-request timeout (ms). Ignored if the runtime has no AbortController.
var REQUEST_TIMEOUT = 2e4;
var HEAD_TIMEOUT = 1e4;
// Stop starting new downloads after this long and return what was found.
var TIME_BUDGET_MS = 3e4;
// Only show files at this resolution or higher (1080 = 1080p, 1440p, 2160p/4K).
var MIN_HEIGHT = 1080;
// Files whose resolution can't be detected are hidden unless this is true.
var INCLUDE_UNKNOWN_QUALITY = false;
function passesQuality(height) {
  return height ? height >= MIN_HEIGHT : INCLUDE_UNKNOWN_QUALITY;
}

var domainCache = { url: BASE_URL, ts: 0 };
// Checks that a domain is up and is really 4KHDHub.
function probeDomain(domain) {
  return __async(this, null, function* () {
    const html = yield fetchText(domain + "/", { retries: 0, timeout: 1e4 });
    return !!html && /4khdhub|movie-card|hdhub/i.test(html);
  });
}
function fetchLatestDomain() {
  return __async(this, null, function* () {
    const now = Date.now();
    if (now - domainCache.ts < 36e5)
      return domainCache.url;
    let remote = null;
    try {
      const response = yield fetch(DOMAINS_URL);
      const data = yield response.json();
      if (data && data["4khdhub"])
        remote = String(data["4khdhub"]).trim().replace(/\/+$/, "");
    } catch (e) {
      console.log(`[4KHDHub] domains.json fetch failed: ${e && e.message}`);
    }
    const candidates = unique([remote].concat(KNOWN_DOMAINS));
    for (const d of candidates) {
      if (yield probeDomain(d)) {
        domainCache.url = d;
        domainCache.ts = now;
        return d;
      }
      console.log(`[4KHDHub] Domain ${d} unreachable, trying next`);
    }
    console.log("[4KHDHub] All domains unreachable, using primary");
    return candidates[0] || BASE_URL;
  });
}

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
    const retries = options.retries !== void 0 ? options.retries : 2;
    const delay = options.delay !== void 0 ? options.delay : 1e3;
    const timeout = options.timeout !== void 0 ? options.timeout : REQUEST_TIMEOUT;
    for (let i = 0; i <= retries; i++) {
      const t = withTimeout({
        headers: __spreadValues({
          "User-Agent": USER_AGENT
        }, options.headers)
      }, timeout);
      try {
        const response = yield fetch(url, t.init);
        const text = yield response.text();
        t.clear();
        return text;
      } catch (err) {
        t.clear();
        console.log(`[4KHDHub] Request failed for ${url}: ${err && err.message}${i < retries ? `, retrying (${i + 1}/${retries})...` : ""}`);
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
      console.log(`[4KHDHub] HEAD failed for ${url}: ${e && e.message}`);
      return null;
    }
  });
}
// Run fn over items with at most `limit` running at once.
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

// -----------------------------------------------------------------------------
// TMDB
// -----------------------------------------------------------------------------
function getTmdbDetails(tmdbId, type) {
  return __async(this, null, function* () {
    const isSeries = type === "series" || type === "tv";
    const endpoint = isSeries ? "tv" : "movie";
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    console.log(`[4KHDHub] Fetching TMDB details from: ${url}`);
    try {
      const response = yield fetch(url);
      const data = yield response.json();
      if (isSeries) {
        const seasonYears = {};
        (data.seasons || []).forEach((s) => {
          if (s && s.air_date)
            seasonYears[s.season_number] = parseInt(s.air_date.split("-")[0]);
        });
        return {
          title: data.name,
          year: data.first_air_date ? parseInt(data.first_air_date.split("-")[0]) : 0,
          seasonYears
        };
      } else {
        return {
          title: data.title,
          year: data.release_date ? parseInt(data.release_date.split("-")[0]) : 0
        };
      }
    } catch (error) {
      console.log(`[4KHDHub] TMDB request failed: ${error.message}`);
      return null;
    }
  });
}

// -----------------------------------------------------------------------------
// Small utilities
// -----------------------------------------------------------------------------
function atob(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = String(input).replace(/=+$/, "");
  if (str.length % 4 === 1) {
    throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
  }
  let output = "";
  for (let bc = 0, bs, buffer, i = 0; buffer = str.charAt(i++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = chars.indexOf(buffer);
  }
  return output;
}
function rot13Cipher(str) {
  return str.replace(/[a-zA-Z]/g, function(c) {
    return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
  });
}
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
  for (let j = 0; j <= m; j++) {
    d[0][j] = j;
  }
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
    return "0 B";
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

// -----------------------------------------------------------------------------
// Search (finds ALL matching posts, not just the first one)
// -----------------------------------------------------------------------------
var cheerio = require("cheerio-without-node-native");
var EDITION_WORDS = [
  "imax",
  "extended",
  "edition",
  "directors",
  "director",
  "cut",
  "uncut",
  "unrated",
  "theatrical",
  "remastered",
  "4k",
  "uhd",
  "hdr",
  "hdr10",
  "dv",
  "dolby",
  "vision",
  "hindi",
  "english",
  "dual",
  "multi",
  "audio",
  "remux",
  "version",
  "complete"
];
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
function cleanCardTitle(cardTitle, queryNorm, isSeries) {
  let t = normalizeTitle(cardTitle);
  const queryWords = new Set(queryNorm.split(" "));
  if (isSeries) {
    t = t.replace(/\b(?:seasons?\s*\d+|s\d+)(?:\s+(?:to\s+|and\s+)?s?\d+)*\b/g, " ");
  }
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
function fetchPageUrls(name, year, isSeries, extraYears) {
  return __async(this, null, function* () {
    const domain = yield fetchLatestDomain();
    const queries = unique([year ? `${name} ${year}` : null, name]);
    const htmls = yield Promise.all(queries.map((q) => {
      const searchUrl = `${domain}/?s=${encodeURIComponent(q)}`;
      console.log(`[4KHDHub] Search Request URL: ${searchUrl}`);
      return fetchText(searchUrl);
    }));
    const targetType = isSeries ? "Series" : "Movies";
    const queryNorm = normalizeTitle(name);
    const threshold = titleThreshold(queryNorm.length);
    const acceptedYears = [year].concat(extraYears || []).filter(Boolean);
    const found = /* @__PURE__ */ new Map();
    htmls.forEach((html) => {
      if (!html)
        return;
      const $ = cheerio.load(html);
      $(".movie-card").each((_, el) => {
        const card = $(el);
        if (card.find(`.movie-card-format:contains("${targetType}")`).length === 0)
          return;
        const rawTitle = card.find(".movie-card-title").text().trim();
        const cardNorm = cleanCardTitle(rawTitle, queryNorm, isSeries);
        if (!cardNorm)
          return;
        const distance = levenshteinDistance(cardNorm, queryNorm);
        if (distance > threshold) {
          return;
        }
        const yearMatch = card.find(".movie-card-meta").text().match(/\b(19|20)\d{2}\b/);
        const cardYear = yearMatch ? parseInt(yearMatch[0]) : NaN;
        if (acceptedYears.length) {
          if (isNaN(cardYear)) {
            if (distance !== 0)
              return;
          } else if (!acceptedYears.some((y) => Math.abs(cardYear - y) <= 1)) {
            console.log(`[4KHDHub] Skip: Year mismatch (${cardYear} vs ${acceptedYears.join("/")}) - ${rawTitle}`);
            return;
          }
        }
        const href = absoluteUrl(card.attr("href") || card.find("a").first().attr("href"), domain);
        if (!href)
          return;
        console.log(`[4KHDHub] Match: "${rawTitle}" (Dist: ${distance}) -> ${href}`);
        if (!found.has(href) || found.get(href) > distance)
          found.set(href, distance);
      });
    });
    const urls = Array.from(found.entries()).sort((a, b) => a[1] - b[1]).slice(0, MAX_PAGES).map((e) => e[0]);
    console.log(`[4KHDHub] Found ${urls.length} matching page(s)`);
    return urls;
  });
}

// -----------------------------------------------------------------------------
// Link resolving
// -----------------------------------------------------------------------------
var cheerio2 = require("cheerio-without-node-native");
function resolveRedirectUrl(redirectUrl) {
  return __async(this, null, function* () {
    if (!redirectUrl)
      return null;
    if (/hubcloud\.|hubdrive\./i.test(redirectUrl)) {
      return redirectUrl;
    }
    const redirectHtml = yield fetchText(redirectUrl, { retries: 1 });
    if (!redirectHtml)
      return null;
    try {
      const redirectDataMatch = redirectHtml.match(/'o','(.*?)'/);
      if (redirectDataMatch) {
        const step1 = atob(redirectDataMatch[1]);
        const step2 = atob(step1);
        const step3 = rot13Cipher(step2);
        const step4 = atob(step3);
        const redirectData = JSON.parse(step4);
        if (redirectData && redirectData.o) {
          return atob(redirectData.o);
        }
      }
    } catch (e) {
      console.log(`[4KHDHub] Error resolving redirect: ${e.message}`);
    }
    const direct = redirectHtml.match(/https?:\/\/[^\s"'<>\\]*hub(?:cloud|drive)\.[^\s"'<>\\]+/i);
    return direct ? direct[0] : null;
  });
}
function resolveHubDrive(hubDriveLink) {
  return __async(this, null, function* () {
    const resolved = yield resolveRedirectUrl(hubDriveLink);
    if (!resolved)
      return [];
    const html = yield fetchText(resolved, { retries: 1 });
    if (!html)
      return [];
    const $ = cheerio2.load(html);
    const links = [];
    $("a").each((_, a) => {
      const text = $(a).text();
      const href = absoluteUrl($(a).attr("href"), resolved);
      if (!href)
        return;
      if (!/hubcloud/i.test(text) && !/hubcloud[./]/i.test(href))
        return;
      if (/^https?:\/\/[^/]+\/?$/i.test(href))
        return;
      links.push(href);
    });
    return unique(links);
  });
}
// Same HubCloud file can show up under different HubCloud domains.
function hubCloudKey(url) {
  return String(url).replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "") || url;
}
function collectHosterLinks($, el) {
  return __async(this, null, function* () {
    const itemText = $(el).text().replace(/\s+/g, " ");
    const title = $(el).find(".file-title, .episode-file-title").first().text().trim();
    const sizeMatch = itemText.match(/([\d.]+)\s?([GM]B)\b/i);
    const meta = {
      bytes: sizeMatch ? parseBytes(sizeMatch[1] + " " + sizeMatch[2]) : 0,
      height: detectHeight(title) || detectHeight(itemText),
      title
    };
    const cloud = [];
    const drive = [];
    const directLinks = [];
    $(el).find("a").each((_, a) => {
      const text = $(a).text().toLowerCase();
      const href = ($(a).attr("href") || "").trim();
      if (!href || href.startsWith("#") || /^javascript:/i.test(href))
        return;
      const h = href.toLowerCase();
      const direct = classifyDirect(href);
      if (direct) {
        directLinks.push({ source: direct.label, url: toPixeldrainDirect(direct.url), meta });
        return;
      }
      if (text.includes("hubcloud") || /hubcloud[./]/.test(h))
        cloud.push(href);
      else if (text.includes("hubdrive") || /hubdrive[./]/.test(h))
        drive.push(href);
    });
    const resolvedCloud = yield Promise.all(unique(cloud).map((h) => resolveRedirectUrl(h).catch(() => null)));
    const resolvedDrive = yield Promise.all(unique(drive).map((h) => resolveHubDrive(h).catch(() => [])));
    const all = resolvedCloud.concat(resolvedDrive.reduce((acc, v) => acc.concat(v || []), []));
    const seen = /* @__PURE__ */ new Set();
    const hubCloudUrls = [];
    all.forEach((u) => {
      if (!u)
        return;
      const key = hubCloudKey(u);
      if (seen.has(key))
        return;
      seen.add(key);
      hubCloudUrls.push(u);
    });
    return { meta, hubCloudUrls, directLinks };
  });
}

// Decide what kind of server a button on the HubCloud page is.
function classifyServer(text, href, isButton) {
  const t = text.toLowerCase();
  const h = href.toLowerCase();
  if (/t\.me\/|telegram|whatsapp|facebook\.com|twitter\.com|instagram\.com|discord/.test(h))
    return null;
  if (/hubcloud\.php|hubcloud[^/]*\/drive\//.test(h))
    return null;
  if (/hbplay\.pages\.dev/.test(h))
    return { label: "HBPlay", kind: "hbplay" };
  if (/video-downloads\.googleusercontent\.com|drive\.google\.com/.test(h))
    return { label: "GDrive", kind: "direct" };
  if (/r2\.cloudflarestorage\.com/.test(h))
    return { label: "R2 (S3)", kind: "direct" };
  if (t.includes("10gbps"))
    return { label: "10Gbps", kind: "redirect" };
  if (t.includes("buzz") || h.includes("buzzheavier"))
    return { label: "BuzzServer", kind: "buzz" };
  if (t.includes("pixel") || h.includes("pixeldra"))
    return { label: "PixelServer", kind: "pixel" };
  if (t.includes("fslv2"))
    return { label: "FSLv2", kind: "direct" };
  if (t.includes("fsl"))
    return { label: "FSL", kind: "direct" };
  if (/\bs3\b/.test(t))
    return { label: "S3", kind: "direct" };
  if (t.includes("mega"))
    return { label: "Mega", kind: "direct" };
  if (t.includes("zipdisk") || h.includes("workers.dev"))
    return { label: "ZipDisk", kind: "direct" };
  if (t.includes("download file") || h.includes("r2.dev"))
    return { label: "Direct", kind: "direct" };
  if (h.includes("hubcloud.cx"))
    return { label: "HubCloud", kind: "direct" };
  // Any other download/server button: keep it so new servers show up automatically.
  if (isButton && /download|server/.test(t)) {
    const bracket = text.match(/\[([^\]]+)\]/);
    let label = (bracket ? bracket[1] : text.replace(/download/gi, "")).replace(/\s+/g, " ").trim();
    if (!label || label.length > 30)
      label = "Mirror";
    return { label, kind: "direct" };
  }
  return null;
}
// hbplay.pages.dev/?u=<base64 url> -> the real video URL
function decodeWrappedUrl(url) {
  const m = String(url || "").match(/[?&]u=([^&#]+)/);
  if (!m)
    return null;
  let v = m[1];
  try {
    v = decodeURIComponent(v);
  } catch (e) {
  }
  try {
    const decoded = atob(v.replace(/-/g, "+").replace(/_/g, "/"));
    if (/^https?:\/\//i.test(decoded))
      return decoded;
  } catch (e) {
  }
  return null;
}
// Links that are already playable files (no page to scrape).
function classifyDirect(href) {
  const h = String(href || "").toLowerCase();
  const host = (h.match(/^https?:\/\/([^/?#:]+)/) || [])[1] || "";
  if (/hbplay\.pages\.dev$/.test(host)) {
    const decoded = decodeWrappedUrl(href);
    if (!decoded)
      return null;
    const inner = classifyDirect(decoded);
    return { label: inner ? inner.label : "HBPlay", url: decoded };
  }
  if (/video-downloads\.googleusercontent\.com$|drive\.google\.com$/.test(host))
    return { label: "GDrive", url: href };
  if (/r2\.cloudflarestorage\.com$/.test(host))
    return { label: "R2 (S3)", url: href };
  if (/\.r2\.dev$/.test(host))
    return { label: "R2", url: href };
  if (/\.(mkv|mp4|m4v|webm|mov)(?:[?#]|$)/i.test(h))
    return { label: "Direct", url: href };
  return null;
}
function toPixeldrainDirect(href) {
  const m = href.match(/^(https?:\/\/[^/]*pixeldra[^/]*)\/u\/([A-Za-z0-9_-]+)/i);
  if (m)
    return `${m[1]}/api/file/${m[2]}?download`;
  return href;
}
function valueAfterLinkParam(url) {
  const i = String(url).indexOf("link=");
  if (i === -1)
    return null;
  let v = url.slice(i + 5);
  if (/^https?%3A/i.test(v)) {
    try {
      v = decodeURIComponent(v);
    } catch (e) {
    }
  }
  return /^https?:\/\//i.test(v) ? v : null;
}
function resolve10Gbps(link) {
  return __async(this, null, function* () {
    const fromHref = valueAfterLinkParam(link);
    if (fromHref)
      return fromHref;
    const res = yield headRequest(link);
    const finalUrl = res && res.url ? res.url : null;
    if (finalUrl) {
      const fromFinal = valueAfterLinkParam(finalUrl);
      if (fromFinal)
        return fromFinal;
      if (finalUrl !== link)
        return finalUrl;
    }
    return link;
  });
}
function resolveBuzz(link) {
  return __async(this, null, function* () {
    const base = link.replace(/\/+$/, "").replace(/\/download$/, "");
    const target = base + "/download";
    const res = yield headRequest(target, { Referer: base, "HX-Request": "true" });
    if (!res)
      return null;
    const hx = res.headers && res.headers.get ? res.headers.get("hx-redirect") : null;
    if (hx)
      return absoluteUrl(hx, base);
    if (res.url && res.url !== target && !/buzzheavier/i.test(res.url))
      return res.url;
    return null;
  });
}
function resolveServerLink(candidate) {
  return __async(this, null, function* () {
    if (candidate.kind === "pixel")
      return toPixeldrainDirect(candidate.href);
    if (candidate.kind === "hbplay") {
      const decoded = decodeWrappedUrl(candidate.href);
      return decoded ? toPixeldrainDirect(decoded) : null;
    }
    if (candidate.kind === "redirect")
      return yield resolve10Gbps(candidate.href);
    if (candidate.kind === "buzz")
      return yield resolveBuzz(candidate.href);
    return candidate.href;
  });
}
function extractHubCloud(hubCloudUrl, baseMeta) {
  return __async(this, null, function* () {
    if (!hubCloudUrl)
      return [];
    let linksUrl = hubCloudUrl;
    let linksHtml = null;
    if (!/hubcloud\.php|gamerxyt/i.test(hubCloudUrl)) {
      const redirectHtml = yield fetchText(hubCloudUrl, { headers: { Referer: hubCloudUrl }, retries: 1 });
      if (!redirectHtml)
        return [];
      const redirectUrlMatch = redirectHtml.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/);
      if (redirectUrlMatch) {
        linksUrl = absoluteUrl(redirectUrlMatch[1], hubCloudUrl);
      } else {
        const $p = cheerio2.load(redirectHtml);
        const dl = $p("#download").attr("href");
        if (dl)
          linksUrl = absoluteUrl(dl, hubCloudUrl);
        else
          linksHtml = redirectHtml;
      }
    }
    if (!linksHtml) {
      if (!linksUrl)
        return [];
      linksHtml = yield fetchText(linksUrl, { headers: { Referer: hubCloudUrl }, retries: 1 });
      if (!linksHtml)
        return [];
    }
    const $ = cheerio2.load(linksHtml);
    const sizeText = ($("#size").first().text() || "").trim();
    const titleText = ($("title").first().text() || "").trim() || ($(".card-header").first().text() || "").trim();
    const meta = __spreadProps(__spreadValues({}, baseMeta), {
      bytes: parseBytes(sizeText) || baseMeta.bytes,
      title: titleText || baseMeta.title
    });
    if (!meta.height)
      meta.height = detectHeight(meta.title);
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    $("a").each((_, a) => {
      const text = $(a).text().replace(/\s+/g, " ").trim();
      const href = absoluteUrl($(a).attr("href"), linksUrl);
      if (!href || seen.has(href))
        return;
      const server = classifyServer(text, href, $(a).hasClass("btn"));
      if (!server)
        return;
      seen.add(href);
      candidates.push(__spreadProps(__spreadValues({}, server), { href }));
    });
    const resolved = yield Promise.all(candidates.map((c) => resolveServerLink(c).then((url) => url ? { source: c.label, url, meta } : null).catch(() => null)));
    const results = resolved.filter(Boolean);
    console.log(`[4KHDHub] ${results.length} server link(s) from ${hubCloudUrl}`);
    return results;
  });
}

// -----------------------------------------------------------------------------
// Page parsing
// -----------------------------------------------------------------------------
var cheerio3 = require("cheerio-without-node-native");
function matchesSeason(text, season) {
  if (!text)
    return false;
  if (new RegExp(`\\b(?:S|Season\\s*)0*${season}(?!\\d)`, "i").test(text))
    return true;
  const range = /\b(?:S|Seasons?\s*)0*(\d+)\s*(?:-|\u2013|to|&)\s*(?:S|Season\s*)?0*(\d+)/gi;
  let m;
  while (m = range.exec(text)) {
    const a = parseInt(m[1]);
    const b = parseInt(m[2]);
    if (season >= Math.min(a, b) && season <= Math.max(a, b))
      return true;
  }
  return false;
}
function matchesEpisode(text, season, episode) {
  if (!text)
    return false;
  const patterns = [
    new RegExp(`\\bEpisode[\\s._-]*0*${episode}(?!\\d)`, "i"),
    new RegExp(`\\bEp[\\s._-]*0*${episode}(?!\\d)`, "i"),
    new RegExp(`S0*${season}[\\s._-]*E0*${episode}(?!\\d)`, "i"),
    new RegExp(`(?:^|[^A-Za-z0-9])E0*${episode}(?!\\d)`, "i")
  ];
  return patterns.some((re) => re.test(text));
}
function findEpisodeItems($, season, episode) {
  const s = parseInt(season);
  const e = parseInt(episode);
  const items = [];
  $(".episode-item").each((_, el) => {
    const header = $(".episode-title", el).first().text();
    if (!matchesSeason(header, s))
      return;
    $(".episode-download-item", el).each((_2, item) => {
      if (matchesEpisode($(item).text(), s, e))
        items.push(item);
    });
  });
  if (items.length === 0) {
    const se = new RegExp(`S0*${s}[\\s._-]*E0*${e}(?!\\d)`, "i");
    $(".download-item, .episode-download-item").each((_, item) => {
      if (se.test($(item).text()))
        items.push(item);
    });
  }
  return items;
}
function findMovieItems($) {
  const items = [];
  $(".download-item").each((_, el) => {
    items.push(el);
  });
  return items;
}
function processItem($, el) {
  return __async(this, null, function* () {
    try {
      const { meta, hubCloudUrls, directLinks } = yield collectHosterLinks($, el);
      if (hubCloudUrls.length === 0 && directLinks.length === 0) {
        console.log(`[4KHDHub] No hoster links resolved for: ${meta.title || "(untitled item)"}`);
        return [];
      }
      const nested = yield Promise.all(hubCloudUrls.map((u) => {
        console.log(`[4KHDHub] Extracting from HubCloud: ${u}`);
        return extractHubCloud(u, meta).catch((err) => {
          console.log(`[4KHDHub] HubCloud error: ${err && err.message}`);
          return [];
        });
      }));
      const links = directLinks.concat(nested.reduce((acc, v) => acc.concat(v), []));
      return links.map((link) => {
        const height = meta.height || link.meta.height;
        return {
          name: `4KHDHub - ${link.source}${height ? ` ${height}p` : ""}`,
          title: `${link.meta.title}
${formatBytes(link.meta.bytes || 0)}`,
          url: link.url,
          quality: height ? `${height}p` : void 0,
          behaviorHints: {
            bingeGroup: `4khdhub-${link.source}`
          },
          _sortHeight: height || 0,
          _sortBytes: link.meta.bytes || 0
        };
      });
    } catch (err) {
      console.log(`[4KHDHub] Item processing error: ${err && err.message}`);
      return [];
    }
  });
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------
function getStreams(tmdbId, type, season, episode) {
  return __async(this, null, function* () {
    const tmdbDetails = yield getTmdbDetails(tmdbId, type);
    if (!tmdbDetails || !tmdbDetails.title)
      return [];
    const { title, year } = tmdbDetails;
    console.log(`[4KHDHub] Search: ${title} (${year})`);
    const isSeries = type === "series" || type === "tv";
    const wantsEpisode = isSeries && season && episode;
    const extraYears = [];
    if (wantsEpisode && tmdbDetails.seasonYears && tmdbDetails.seasonYears[season]) {
      extraYears.push(tmdbDetails.seasonYears[season]);
    }
    const pageUrls = yield fetchPageUrls(title, year, isSeries, extraYears);
    if (pageUrls.length === 0) {
      console.log("[4KHDHub] Page not found");
      return [];
    }
    const pages = yield Promise.all(pageUrls.map((u) => fetchText(u)));
    const items = [];
    pages.forEach((html, idx) => {
      if (!html)
        return;
      const $ = cheerio3.load(html);
      const found = wantsEpisode ? findEpisodeItems($, season, episode) : findMovieItems($);
      let skipped = 0;
      found.forEach((el) => {
        // Skip low-resolution files early so no requests are wasted on them.
        const label = $(el).find(".file-title, .episode-file-title").first().text();
        const height = detectHeight(label) || detectHeight($(el).text());
        if (height && height < MIN_HEIGHT) {
          skipped++;
          return;
        }
        items.push({ $, el });
      });
      console.log(`[4KHDHub] ${found.length} item(s) on ${pageUrls[idx]} (${skipped} below ${MIN_HEIGHT}p skipped)`);
    });
    console.log(`[4KHDHub] Processing ${items.length} items`);
    const deadline = Date.now() + TIME_BUDGET_MS;
    const perItem = yield mapLimit(items, CONCURRENCY, (it) => Date.now() > deadline ? [] : processItem(it.$, it.el));
    const seenUrls = /* @__PURE__ */ new Set();
    const streams = [];
    perItem.forEach((list) => {
      (list || []).forEach((s) => {
        if (!s || !s.url || seenUrls.has(s.url))
          return;
        if (!passesQuality(s._sortHeight))
          return;
        seenUrls.add(s.url);
        streams.push(s);
      });
    });
    streams.sort((a, b) => b._sortHeight - a._sortHeight || b._sortBytes - a._sortBytes);
    streams.forEach((s) => {
      delete s._sortHeight;
      delete s._sortBytes;
    });
    console.log(`[4KHDHub] Returning ${streams.length} stream(s)`);
    return streams;
  });
}
module.exports = { getStreams };
