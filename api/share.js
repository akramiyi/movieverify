/**
 * MovieVerify Dynamic Open Graph & Social Share Preview Handler
 *
 * Provides server-rendered Open Graph & Twitter card metadata for WhatsApp,
 * Facebook, Twitter, Telegram, and other social crawlers.
 * Automatically and safely redirects human browser visitors to the canonical
 * application URL (/?type=movie&id={id} or /?type=tv&id={id}).
 */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const CRAWLER_USER_AGENTS = [
  'whatsapp',
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'telegrambot',
  'slackbot',
  'discordbot',
  'linkedinbot',
  'meta-externalagent',
  'pinterest',
  'googlebot',
  'bingbot'
];

export function isCrawler(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some(crawler => ua.includes(crawler));
}

// In-memory container cache across warm serverless invocations
const serverTitleCache = new Map();
const MAX_SERVER_CACHE = 200;

// Fetch TMDB data using server token or backend proxy fallback
async function fetchTitleDetails(mediaType, id) {
  const cacheKey = `${mediaType}:${id}`;
  if (serverTitleCache.has(cacheKey)) {
    return serverTitleCache.get(cacheKey);
  }

  const serverToken = process.env.TMDB_READ_TOKEN || process.env.TMDB_TOKEN || process.env.TMDB_API_KEY;

  if (serverToken) {
    try {
      const isBearer = serverToken.length > 50;
      const url = isBearer
        ? `https://api.themoviedb.org/3/${mediaType}/${id}?language=en-US`
        : `https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${encodeURIComponent(serverToken)}&language=en-US`;

      const reqHeaders = { 'Content-Type': 'application/json' };
      if (isBearer) {
        reqHeaders['Authorization'] = `Bearer ${serverToken}`;
      }

      const res = await fetch(url, { headers: reqHeaders });
      if (res.ok) {
        const json = await res.json();
        if (serverTitleCache.size >= MAX_SERVER_CACHE) {
          const firstKey = serverTitleCache.keys().next().value;
          serverTitleCache.delete(firstKey);
        }
        serverTitleCache.set(cacheKey, json);
        return json;
      }
      if (res.status === 404) {
        return null;
      }
    } catch {
      // Fall through to proxy
    }
  }

  // Fallback to MovieVerify backend proxy (which holds configured TMDB credentials)
  try {
    const proxyBase = process.env.VITE_API_URL || process.env.API_URL || 'https://movieverify-backend.onrender.com';
    const proxyUrl = `${proxyBase}/api/tmdb/${mediaType}/${id}`;
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const json = await res.json();
      if (serverTitleCache.size >= MAX_SERVER_CACHE) {
        const firstKey = serverTitleCache.keys().next().value;
        serverTitleCache.delete(firstKey);
      }
      serverTitleCache.set(cacheKey, json);
      return json;
    }
    if (res.status === 404) {
      return null;
    }
  } catch {
    // If backend proxy unreachable, return null
  }

  return null;
}

function renderHtml({
  title,
  description,
  imageUrl,
  imageWidth,
  imageHeight,
  imageType,
  imageAlt,
  canonicalShareUrl,
  targetAppUrl,
  mediaType
}) {
  const ogType = mediaType === 'tv' ? 'video.tv_show' : 'video.movie';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — MovieVerify</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="theme-color" content="#E50914" />

  <!-- Open Graph / WhatsApp / Facebook -->
  <meta property="og:site_name" content="MovieVerify" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:type" content="${escapeHtml(imageType)}" />
  <meta property="og:image:width" content="${imageWidth}" />
  <meta property="og:image:height" content="${imageHeight}" />
  <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />
  <meta property="og:url" content="${escapeHtml(canonicalShareUrl)}" />
  <meta property="og:type" content="${ogType}" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@MovieVerify" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  <meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />

  <!-- Client-side instant navigation for human visitors (crawlers ignore JS) -->
  <script>
    try {
      window.location.replace(${JSON.stringify(targetAppUrl)});
    } catch (e) {
      window.location.href = ${JSON.stringify(targetAppUrl)};
    }
  </script>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #141414;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
      box-sizing: border-box;
    }
    .container {
      max-width: 480px;
      padding: 32px 24px;
      background: #1f1f1f;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    }
    .brand {
      color: #E50914;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin: 0 0 16px;
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 12px;
      color: #fff;
    }
    .desc {
      font-size: 14px;
      color: #a3a3a3;
      line-height: 1.5;
      margin: 0 0 24px;
    }
    .btn {
      display: inline-block;
      background-color: #E50914;
      color: #ffffff;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      transition: background 0.2s ease;
    }
    .btn:hover {
      background-color: #b80710;
    }
    .spinner {
      display: inline-block;
      width: 28px;
      height: 28px;
      border: 3px solid rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      border-top-color: #E50914;
      animation: spin 0.8s ease-in-out infinite;
      margin-bottom: 16px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <div class="brand">MovieVerify</div>
    <div class="title">${escapeHtml(title)}</div>
    <p class="desc">${escapeHtml(description)}</p>
    <a class="btn" href="${escapeHtml(targetAppUrl)}">Open in MovieVerify</a>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  // Parse parameters from query or URL
  let type = '';
  let id = '';

  if (req.query && (req.query.type || req.query.id)) {
    type = req.query.type;
    id = req.query.id;
  }

  // Fallback: parse from req.url
  if (!type || !id) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      type = type || urlObj.searchParams.get('type') || '';
      id = id || urlObj.searchParams.get('id') || '';

      if (!type || !id) {
        const match = urlObj.pathname.match(/\/share\/(movie|tv)\/(\d+)/i);
        if (match) {
          type = match[1];
          id = match[2];
        }
      }
    } catch {
      // url parse failed
    }
  }

  const rawType = String(type || '').trim().toLowerCase();
  const rawId = String(id || '').trim();

  // Determine host and protocol
  const host = req.headers?.host || 'movieverify.vercel.app';
  const proto = (req.headers?.['x-forwarded-proto'] || 'https').replace(/:$/, '');
  const baseUrl = `${proto}://${host}`;
  const defaultFallbackImage = `${baseUrl}/og-fallback.jpg`;

  // Validate media type
  if (rawType !== 'movie' && rawType !== 'tv') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const html = renderHtml({
      title: 'Invalid Media Type',
      description: 'The requested title category is invalid. Please visit MovieVerify for movies and TV shows.',
      imageUrl: defaultFallbackImage,
      imageWidth: 1200,
      imageHeight: 630,
      imageType: 'image/jpeg',
      imageAlt: 'MovieVerify Logo',
      canonicalShareUrl: `${baseUrl}/`,
      targetAppUrl: '/',
      mediaType: 'movie'
    });
    return res.end(html);
  }

  // Validate numeric TMDB ID
  const cleanId = rawId.split('-')[0].trim();
  if (!/^\d+$/.test(cleanId) || parseInt(cleanId, 10) <= 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const html = renderHtml({
      title: 'Invalid Title ID',
      description: 'The requested MovieVerify title ID is invalid or missing.',
      imageUrl: defaultFallbackImage,
      imageWidth: 1200,
      imageHeight: 630,
      imageType: 'image/jpeg',
      imageAlt: 'MovieVerify Logo',
      canonicalShareUrl: `${baseUrl}/`,
      targetAppUrl: '/',
      mediaType: rawType
    });
    return res.end(html);
  }

  const parsedId = parseInt(cleanId, 10);
  const data = await fetchTitleDetails(rawType, parsedId);

  if (!data) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const html = renderHtml({
      title: 'Title Not Found',
      description: 'This title is unavailable or no longer exists on MovieVerify.',
      imageUrl: defaultFallbackImage,
      imageWidth: 1200,
      imageHeight: 630,
      imageType: 'image/jpeg',
      imageAlt: 'MovieVerify Logo',
      canonicalShareUrl: `${baseUrl}/share/${rawType}/${parsedId}`,
      targetAppUrl: '/',
      mediaType: rawType
    });
    return res.end(html);
  }

  // Derive Display Title
  let displayTitle = '';
  if (rawType === 'tv') {
    const mainName = data.name || data.original_name || 'Untitled TV Show';
    const altName = data.original_name;
    if (altName && altName.toLowerCase() !== mainName.toLowerCase()) {
      displayTitle = `${mainName} (${altName})`;
    } else {
      displayTitle = mainName;
    }
  } else {
    const mainTitle = data.title || data.original_title || 'Untitled Movie';
    const altTitle = data.original_title;
    if (altTitle && altTitle.toLowerCase() !== mainTitle.toLowerCase()) {
      displayTitle = `${mainTitle} (${altTitle})`;
    } else {
      displayTitle = mainTitle;
    }
  }

  // Derive Description
  let description = '';
  if (data.overview && typeof data.overview === 'string' && data.overview.trim().length > 0) {
    const cleanOverview = data.overview.trim();
    description = cleanOverview.length > 250
      ? `${cleanOverview.slice(0, 247).trim()}...`
      : cleanOverview;
  } else {
    description = `Watch ${displayTitle} on MovieVerify. Check out full details, rating, and stream links.`;
  }

  // Poster & Image
  let imageUrl = defaultFallbackImage;
  let imageWidth = 1200;
  let imageHeight = 630;
  let imageType = 'image/jpeg';
  let imageAlt = `${displayTitle} — MovieVerify`;

  if (data.poster_path) {
    imageUrl = `https://image.tmdb.org/t/p/w780${data.poster_path}`;
    imageWidth = 780;
    imageHeight = 1170;
    imageType = 'image/jpeg';
    imageAlt = `${displayTitle} Poster`;
  }

  const canonicalShareUrl = `${baseUrl}/share/${rawType}/${parsedId}`;
  const targetAppUrl = `/?type=${encodeURIComponent(rawType)}&id=${encodeURIComponent(String(parsedId))}`;

  // Cache successful responses on Vercel Edge for 1 hour, stale-while-revalidate 1 day
  // Both browsers and crawlers share the identical cached response (no User-Agent variation)
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  const html = renderHtml({
    title: displayTitle,
    description,
    imageUrl,
    imageWidth,
    imageHeight,
    imageType,
    imageAlt,
    canonicalShareUrl,
    targetAppUrl,
    mediaType: rawType
  });

  return res.end(html);
}
