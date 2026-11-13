"use strict";
// Nuvio / Stremio add-on that serves 4KHDHub and KMMovies links (1080p+).
// Runs on Vercel. The two provider files sit in the repo's top folder.
// Add-on URL: https://<your-project>.vercel.app/addon/manifest.json
const hub = require("../4khdhub.js");
const km = require("../kmmovies.js");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const PROVIDER_TIMEOUT_MS = 45000;
const PROVIDERS = [
  { id: "4khdhub", getStreams: hub.getStreams },
  { id: "kmmovies", getStreams: km.getStreams }
];

const MANIFEST = {
  id: "community.nuvhq.hq",
  version: "1.0.0",
  name: "HQ Links (1080p+)",
  description: "4KHDHub and KMMovies direct links, 1080p and 4K only",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt", "tmdb:"],
  catalogs: [],
  behaviorHints: { configurable: false }
};

function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  Object.keys(headers || {}).forEach((k) => res.setHeader(k, headers[k]));
  if (typeof body === "string") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(body);
  } else {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  }
}

// "tt4154796" / "tt0944947:1:2" / "tmdb:299534" / "tmdb:1399:1:2" -> TMDB id + season/episode
async function resolveIds(type, id) {
  const parts = id.split(":");
  let tmdbId = null;
  let season = null;
  let episode = null;
  if (parts[0] === "tmdb") {
    tmdbId = parts[1];
    season = parts[2];
    episode = parts[3];
  } else if (/^tt\d+$/.test(parts[0])) {
    season = parts[1];
    episode = parts[2];
    const r = await fetch(`https://api.themoviedb.org/3/find/${parts[0]}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    const d = await r.json();
    const list = type === "series" ? d.tv_results : d.movie_results;
    if (list && list[0]) tmdbId = String(list[0].id);
  }
  return {
    tmdbId,
    season: season ? parseInt(season, 10) : null,
    episode: episode ? parseInt(episode, 10) : null
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve([]), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getAllStreams(type, id) {
  const { tmdbId, season, episode } = await resolveIds(type, id);
  if (!tmdbId) {
    console.log(`[addon] No TMDB match for ${type} ${id}`);
    return [];
  }
  const providerType = type === "series" ? "tv" : "movie";
  console.log(`[addon] ${type} ${id} -> tmdb ${tmdbId}${season ? ` S${season}E${episode}` : ""}`);
  const lists = await Promise.all(PROVIDERS.map((p) =>
    withTimeout(
      Promise.resolve()
        .then(() => p.getStreams(tmdbId, providerType, season, episode))
        .catch((e) => {
          console.log(`[addon] ${p.id} failed: ${e && e.message}`);
          return [];
        }),
      PROVIDER_TIMEOUT_MS
    ).then((list) => {
      console.log(`[addon] ${p.id}: ${(list || []).length} stream(s)`);
      return list || [];
    })
  ));
  return lists.flat().map((s) => ({
    name: s.name,
    title: s.title,
    description: s.title,
    url: s.url,
    behaviorHints: Object.assign({ notWebReady: true }, s.behaviorHints || {})
  }));
}

function landingPage(base) {
  const manifestUrl = `${base}/addon/manifest.json`;
  const stremioUrl = manifestUrl.replace(/^https?:/, "stremio:");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>HQ Links (1080p+)</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f8;--fg:#1b1b1f;--card:#fff;--muted:#5b5b66;--accent:#2f6fed}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ececf1;--card:#1d1d21;--muted:#a0a0ab;--accent:#7aa2ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 20px}
.card{background:var(--card);border-radius:12px;padding:20px;margin:16px 0}
code{display:block;word-break:break-all;padding:12px;border-radius:8px;background:var(--bg);font-size:14px}
a{color:var(--accent)} button{margin-top:10px;padding:8px 14px;border-radius:8px;border:0;background:var(--accent);color:#fff;font-size:15px}
p.small{color:var(--muted);font-size:14px}
</style></head><body><main>
<h1>HQ Links (1080p+)</h1>
<p>4KHDHub and KMMovies direct links, 1080p and 4K only.</p>
<div class="card"><strong>Add-on URL</strong> (paste this into Nuvio &rarr; Add-ons)
<code id="u">${manifestUrl}</code>
<button onclick="navigator.clipboard.writeText(document.getElementById('u').textContent);this.textContent='Copied'">Copy</button>
<p class="small">Stremio users can also <a href="${stremioUrl}">install directly</a>.</p></div>
<div class="card"><strong>Test links</strong>
<p><a href="${base}/addon/stream/movie/tt4154796.json">Movie: Avengers: Endgame</a><br>
<a href="${base}/addon/stream/series/tt7631058:1:1.json">Episode: The Rings of Power S01E01</a></p>
<p class="small">Each should show a list of streams. The first load can take up to a minute.</p></div>
</main></body></html>`;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");
  const u = new URL(req.url, "http://localhost");
  const fromQuery = u.searchParams.get("path");
  const path = fromQuery !== null
    ? "/" + fromQuery.replace(/^\/+/, "")
    : u.pathname.replace(/^\/api\/index/, "").replace(/^\/addon/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const base = `https://${host}`;

  if (path === "" || path === "/") return send(res, 200, landingPage(base));
  if (path === "/manifest.json") return send(res, 200, MANIFEST, { "Cache-Control": "public, max-age=3600" });

  const m = path.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
  if (m) {
    try {
      const streams = await getAllStreams(m[1], decodeURIComponent(m[2]));
      return send(res, 200, { streams }, {
        "Cache-Control": streams.length ? "public, s-maxage=1800, stale-while-revalidate=3600" : "no-store"
      });
    } catch (e) {
      console.log(`[addon] Error: ${e && e.stack}`);
      return send(res, 200, { streams: [] }, { "Cache-Control": "no-store" });
    }
  }
  return send(res, 404, { error: "Not found" });
};
