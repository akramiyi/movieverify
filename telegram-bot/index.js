const TelegramBot = require('node-telegram-bot-api');
const { TELEGRAM_BOT_TOKEN, ADMIN_IDS } = require('./config');
const { registerUserHandlers } = require('./handlers/userHandlers');
const { registerAdminHandlers } = require('./handlers/adminHandlers');

// Create bot instance with long-polling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log('🤖 MovieVerify Telegram Bot starting...');
console.log(`📋 Admin IDs: ${ADMIN_IDS.join(', ')}`);

// Register all handlers
registerUserHandlers(bot);
registerAdminHandlers(bot);

// Handle polling errors gracefully
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code, error.message);
});

// Handle uncaught errors
bot.on('error', (error) => {
  console.error('Bot error:', error.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bot...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down bot...');
  bot.stopPolling();
  process.exit(0);
});

console.log('✅ MovieVerify Telegram Bot is running!');
console.log('📡 Listening for messages...');

// Express Server for Render Health Check, Payments, and TMDB Proxy
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const NodeCache = require('node-cache');
const { Resend } = require('resend');
const { supabase } = require('./supabase');

// In-Memory Cache for TMDB data (Reduces TMDB rate limits and speeds up responses to ~15ms)
const tmdbCache = new NodeCache({ stdTTL: 21600, checkperiod: 1800, maxKeys: 3000 });

const app = express();
const PORT = process.env.PORT || 3000;

// Allowed origins for CORS (Strict production domain lockdown)
const allowedOrigins = [
  'https://moviex.sbs',
  'https://www.moviex.sbs',
  'https://moviex-dl9.pages.dev',
  'https://movieverify.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map((u) => u.trim()) : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.moviex-dl9.pages.dev')
      ) {
        return callback(null, true);
      }
      return callback(new Error('CORS blocked by MovieVerify security policy'), false);
    },
    credentials: true,
  })
);
app.use(express.json());

app.get('/', (req, res) => {
  res.send('MovieVerify Bot & API is running!');
});

// Razorpay Setup
// We only initialize razorpay if keys are present so it doesn't crash the bot if not configured yet.
let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID.trim(),
    key_secret: process.env.RAZORPAY_KEY_SECRET.trim(),
  });
}

app.post('/api/razorpay/create-order', async (req, res) => {
  console.log(`[Diagnostic] POST /api/razorpay/create-order called`);
  try {
    const hasKeyId = !!process.env.RAZORPAY_KEY_ID;
    const hasKeySecret = !!process.env.RAZORPAY_KEY_SECRET;
    console.log(`[Diagnostic] RAZORPAY_KEY_ID exists: ${hasKeyId}`);
    console.log(`[Diagnostic] RAZORPAY_KEY_SECRET exists: ${hasKeySecret}`);

    if (!razorpay) {
      console.log(`[Diagnostic] Razorpay instance is null or undefined.`);
      return res.status(503).json({ error: 'Razorpay is not configured on the server.' });
    }

    const { amount } = req.body;
    console.log(`[Diagnostic] Requested amount: ${amount}`);

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const amountInPaise = Math.round(amount * 100);
    console.log(`[Diagnostic] Amount in paise: ${amountInPaise}`);

    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: `receipt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    };

    console.log(`[Diagnostic] Calling razorpay.orders.create with currency: INR, amount: ${amountInPaise}`);
    const order = await razorpay.orders.create(options);
    console.log(`[Diagnostic] Order created successfully: ${order.id}`);

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID.trim(),
    });
  } catch (error) {
    console.error('[Diagnostic] Razorpay API Error Details:');
    if (error.statusCode) console.error(`- HTTP Status: ${error.statusCode}`);
    if (error.error) {
      console.error(`- Code: ${error.error.code}`);
      console.error(`- Description: ${error.error.description}`);
    } else {
      console.error(`- Message: ${error.message}`);
    }
    res.status(500).json({ error: 'Razorpay order creation failed' });
  }
});

app.post('/api/razorpay/verify-payment', (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ error: 'Razorpay is not configured on the server.' });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET.trim())
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      res.json({ success: true, message: 'Payment verified successfully' });
    } else {
      res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (error) {
    console.error('Razorpay Verify Error:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    cache_keys: tmdbCache.keys().length
  });
});

// Helper to determine cache TTL in seconds based on TMDB endpoint
function getCacheTTL(endpoint) {
  const ep = endpoint.toLowerCase();
  // Static content: cast, credits, details, videos (24 hours)
  if (ep.includes('/credits') || ep.includes('/person') || ep.includes('/videos') || (ep.includes('/movie/') && !ep.includes('popular')) || (ep.includes('/tv/') && !ep.includes('popular'))) {
    return 86400; // 24h
  }
  // Search queries (1 hour)
  if (ep.includes('/search/')) {
    return 3600; // 1h
  }
  // Discover, trending, genres, popular (6 hours)
  return 21600; // 6h
}

// Consolidated Home Feed Endpoint (Reelipse-style single bundled request)
app.get('/api/home-feed', async (req, res) => {
  const cacheKey = 'bundle:home-feed';
  const cachedFeed = tmdbCache.get(cacheKey);

  if (cachedFeed) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=1800');
    return res.json(cachedFeed);
  }

  const serverToken = process.env.TMDB_TOKEN || process.env.VITE_TMDB_TOKEN;
  const headers = {
    'Accept': 'application/json',
    ...(serverToken ? { 'Authorization': `Bearer ${serverToken}` } : {})
  };

  const fetchJson = async (endpoint) => {
    try {
      const url = `https://api.themoviedb.org/3${endpoint}`;
      const r = await fetch(url, { headers });
      if (!r.ok) return { results: [] };
      return await r.json();
    } catch {
      return { results: [] };
    }
  };

  try {
    const today = new Date();
    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(today.getDate() - 60);
    const fromDate = sixtyDaysAgo.toISOString().split('T')[0];
    const toDate = today.toISOString().split('T')[0];

    const [
      trending,
      popular,
      bollywood,
      telugu,
      tamil,
      kannada,
      malayalam,
      webSeries,
      indiaHi,
      indiaTe,
      indiaTa,
      indiaKn,
      indiaMl
    ] = await Promise.all([
      fetchJson('/trending/all/week'),
      fetchJson('/movie/popular?language=en-US&page=1'),
      fetchJson('/discover/movie?with_original_language=hi&sort_by=popularity.desc&page=1'),
      fetchJson('/discover/movie?with_original_language=te&sort_by=popularity.desc&page=1'),
      fetchJson('/discover/movie?with_original_language=ta&sort_by=popularity.desc&page=1'),
      fetchJson('/discover/movie?with_original_language=kn&sort_by=popularity.desc&page=1'),
      fetchJson('/discover/movie?with_original_language=ml&sort_by=popularity.desc&page=1'),
      fetchJson('/tv/popular?language=en-US&page=1'),
      fetchJson(`/discover/movie?with_original_language=hi&region=IN&primary_release_date.gte=${fromDate}&primary_release_date.lte=${toDate}&sort_by=primary_release_date.desc&page=1`),
      fetchJson(`/discover/movie?with_original_language=te&region=IN&primary_release_date.gte=${fromDate}&primary_release_date.lte=${toDate}&sort_by=primary_release_date.desc&page=1`),
      fetchJson(`/discover/movie?with_original_language=ta&region=IN&primary_release_date.gte=${fromDate}&primary_release_date.lte=${toDate}&sort_by=primary_release_date.desc&page=1`),
      fetchJson(`/discover/movie?with_original_language=kn&region=IN&primary_release_date.gte=${fromDate}&primary_release_date.lte=${toDate}&sort_by=primary_release_date.desc&page=1`),
      fetchJson(`/discover/movie?with_original_language=ml&region=IN&primary_release_date.gte=${fromDate}&primary_release_date.lte=${toDate}&sort_by=primary_release_date.desc&page=1`)
    ]);

    const processIndiaList = (r) => (r.results || [])
      .filter((m) => m.backdrop_path && m.overview)
      .sort((a, b) => new Date(b.release_date) - new Date(a.release_date))
      .slice(0, 4);

    const indiaLatestPool = [
      ...processIndiaList(indiaHi),
      ...processIndiaList(indiaTe),
      ...processIndiaList(indiaTa),
      ...processIndiaList(indiaKn),
      ...processIndiaList(indiaMl)
    ];

    const feedData = {
      trending: trending.results || [],
      popular: popular.results || [],
      bollywood: bollywood.results || [],
      telugu: telugu.results || [],
      tamil: tamil.results || [],
      kannada: kannada.results || [],
      malayalam: malayalam.results || [],
      webSeries: webSeries.results || [],
      indiaLatest: indiaLatestPool
    };

    tmdbCache.set(cacheKey, feedData, 21600); // 6 hours cache

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=1800');
    return res.json(feedData);
  } catch (error) {
    console.error('Home Feed Error:', error);
    res.status(500).json({ error: 'Failed to generate home feed' });
  }
});

// TMDB Proxy to bypass ISP blocking in India with in-memory & edge caching
app.get('/api/tmdb/*path', async (req, res) => {
  try {
    const pathParam = req.params.path || req.params[0];
    const tmdbPath = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
    const query = req.url.split('?')[1] ? `?${req.url.split('?')[1]}` : '';
    const tmdbUrl = `https://api.themoviedb.org/3/${tmdbPath}${query}`;
    const cacheKey = `tmdb:${tmdbPath}${query}`;

    const ttl = getCacheTTL(tmdbPath);

    // 1. Check in-memory cache
    const cachedData = tmdbCache.get(cacheKey);
    if (cachedData) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', `public, max-age=${Math.min(ttl, 3600)}, s-maxage=${ttl}, stale-while-revalidate=1800`);
      return res.json(cachedData);
    }

    // 2. Cache miss: Fetch from TMDB
    const headers = {
      'Accept': 'application/json'
    };
    
    // Inject server bearer token (from TMDB_TOKEN or fallback to client auth header if present)
    const serverToken = process.env.TMDB_TOKEN || process.env.VITE_TMDB_TOKEN;
    if (serverToken) {
      headers['Authorization'] = `Bearer ${serverToken}`;
    } else if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }

    const response = await fetch(tmdbUrl, { headers });
    const data = await response.json();

    // Cache successful responses
    if (response.ok && data) {
      tmdbCache.set(cacheKey, data, ttl);
    }

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', `public, max-age=${Math.min(ttl, 3600)}, s-maxage=${ttl}, stale-while-revalidate=1800`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('TMDB Proxy Error:', error);
    res.status(500).json({ error: 'Failed to fetch from TMDB' });
  }
});

// Image Streaming Proxy to bypass Indian ISP throttling on image.tmdb.org
app.get('/api/image/:size/*path', async (req, res) => {
  try {
    const { size } = req.params;
    const pathParam = req.params.path || req.params[0];
    const imagePath = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;

    if (!imagePath) {
      return res.status(400).json({ error: 'Image path is required' });
    }

    const cleanPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
    const tmdbImageUrl = `https://image.tmdb.org/t/p/${size}${cleanPath}`;

    const response = await fetch(tmdbImageUrl);
    if (!response.ok) {
      return res.status(response.status).send('Image fetch failed');
    }

    // Edge & Browser Caching: 7 days browser, 30 days CDN
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, immutable');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Image Proxy Error:', error);
    res.status(500).send('Image proxy error');
  }
});

// ==============================================================================
// Admin HMAC Authentication & Session Endpoint
// ==============================================================================
const adminLoginAttempts = new Map();

function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// POST /api/admin-login: Server-side salted SHA-256 HMAC authentication
app.post('/api/admin-login', express.json(), (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();

  // Brute-force protection: Max 5 attempts per 15 minutes
  const attemptRecord = adminLoginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  if (attemptRecord.blockedUntil > now) {
    const retryAfter = Math.ceil((attemptRecord.blockedUntil - now) / 1000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${retryAfter}s.` });
  }

  const { password } = req.body;
  const adminSecret = process.env.ADMIN_MASTER_PASSWORD || process.env.SITE_LOCK_KEY;

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (!adminSecret) {
    return res.status(503).json({ error: 'Server authentication misconfigured: missing ADMIN_MASTER_PASSWORD' });
  }

  // Salted HMAC SHA-256 hash comparison
  const salt = process.env.ADMIN_HMAC_SALT || 'movieverify-hmac-salt-2026';
  const computedHash = crypto.createHmac('sha256', salt).update(password.trim()).digest('hex');
  const expectedHash = crypto.createHmac('sha256', salt).update(adminSecret.trim()).digest('hex');

  const isValid = timingSafeCompare(computedHash, expectedHash);

  if (!isValid) {
    attemptRecord.count += 1;
    if (attemptRecord.count >= 5) {
      attemptRecord.blockedUntil = now + (15 * 60 * 1000); // 15 min lock
    }
    adminLoginAttempts.set(ip, attemptRecord);
    return res.status(401).json({
      error: 'Invalid administrator credentials',
      attemptsRemaining: Math.max(0, 5 - attemptRecord.count)
    });
  }

  // Clear rate-limiting on success
  adminLoginAttempts.delete(ip);

  // Generate tamper-proof signed session token (24-hour expiration)
  const payload = {
    role: 'admin',
    exp: Math.floor(now / 1000) + (24 * 60 * 60),
    iat: Math.floor(now / 1000),
  };
  const tokenData = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', salt).update(tokenData).digest('base64url');
  const sessionToken = `${tokenData}.${signature}`;

  return res.json({
    success: true,
    token: sessionToken,
    expiresIn: '24h'
  });
});

// GET /api/admin-verify: Validate HMAC session token
app.get('/api/admin-verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ authenticated: false, error: 'Bearer token required' });
  }

  const token = authHeader.split(' ')[1];
  const parts = token.split('.');
  if (parts.length !== 2) {
    return res.status(401).json({ authenticated: false, error: 'Malformed token structure' });
  }

  const [tokenData, signature] = parts;
  const salt = process.env.ADMIN_HMAC_SALT || 'movieverify-hmac-salt-2026';
  const expectedSignature = crypto.createHmac('sha256', salt).update(tokenData).digest('base64url');

  if (!timingSafeCompare(signature, expectedSignature)) {
    return res.status(401).json({ authenticated: false, error: 'Invalid token signature' });
  }

  try {
    const payload = JSON.parse(Buffer.from(tokenData, 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      return res.status(401).json({ authenticated: false, error: 'Token has expired' });
    }
    return res.json({ authenticated: true, role: payload.role });
  } catch {
    return res.status(401).json({ authenticated: false, error: 'Invalid token payload' });
  }
});

// ==============================================================================
// Admin-Only Daily Trending Movies Digest via Resend Email
// ==============================================================================
app.all(['/api/admin/daily-digest', '/api/admin/daily-digest/send'], async (req, res) => {
  // 1. Authorize: Check Cron Secret or Admin HMAC Token
  const cronSecret = process.env.CRON_SECRET || process.env.SITE_LOCK_KEY;
  const authHeader = req.headers.authorization;
  const providedCronHeader = req.headers['x-cron-secret'];

  let isAuthorized = false;

  // Option A: Machine-to-machine cron trigger via header or query
  if (cronSecret) {
    if (providedCronHeader && timingSafeCompare(providedCronHeader, cronSecret)) {
      isAuthorized = true;
    } else if (req.query.secret && timingSafeCompare(req.query.secret, cronSecret)) {
      isAuthorized = true;
    }
  }

  // Option B: Authenticated Admin via Bearer HMAC Token
  if (!isAuthorized && authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const parts = token.split('.');
    if (parts.length === 2) {
      const [tokenData, signature] = parts;
      const salt = process.env.ADMIN_HMAC_SALT || 'movieverify-hmac-salt-2026';
      const expectedSignature = crypto.createHmac('sha256', salt).update(tokenData).digest('base64url');
      if (timingSafeCompare(signature, expectedSignature)) {
        try {
          const payload = JSON.parse(Buffer.from(tokenData, 'base64url').toString('utf8'));
          const nowSec = Math.floor(Date.now() / 1000);
          if (payload.exp && payload.exp >= nowSec && payload.role === 'admin') {
            isAuthorized = true;
          }
        } catch {}
      }
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({
      error: 'Unauthorized: Admin HMAC session or valid x-cron-secret required.'
    });
  }

  // 2. Verify Resend API Key is configured
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return res.status(503).json({
      error: 'Resend API key missing. Please configure RESEND_API_KEY in Render environment.'
    });
  }

  try {
    // 3. Securely resolve Admin recipient email(s) from Supabase Service Role
    let adminEmails = [];

    // Check env ADMIN_EMAIL first as priority/fallback
    if (process.env.ADMIN_EMAIL) {
      const parsedEmails = process.env.ADMIN_EMAIL.split(',').map(e => e.trim()).filter(Boolean);
      adminEmails.push(...parsedEmails);
    }

    // Query Supabase database for registered admin emails
    if (supabase) {
      try {
        // Query admin_users join users or profiles
        const { data: adminRows } = await supabase
          .from('admin_users')
          .select('email, user_id');

        if (adminRows && adminRows.length > 0) {
          adminRows.forEach(row => {
            if (row.email && !adminEmails.includes(row.email)) {
              adminEmails.push(row.email);
            }
          });
        }

        // Also check users table where role = 'admin' if available
        const { data: userRows } = await supabase
          .from('users')
          .select('email')
          .eq('role', 'admin');

        if (userRows && userRows.length > 0) {
          userRows.forEach(u => {
            if (u.email && !adminEmails.includes(u.email)) {
              adminEmails.push(u.email);
            }
          });
        }
      } catch (dbErr) {
        console.warn('[DailyDigest] Supabase admin lookup warning:', dbErr.message);
      }
    }

    if (adminEmails.length === 0) {
      return res.status(400).json({
        error: 'No admin recipient found. Please set ADMIN_EMAIL in Render or insert admin into admin_users table.'
      });
    }

    // 4. Fetch Top 10 Trending Movies from TMDB
    const serverToken = process.env.TMDB_TOKEN || process.env.VITE_TMDB_TOKEN;
    const tmdbHeaders = {
      'Accept': 'application/json',
      ...(serverToken ? { 'Authorization': `Bearer ${serverToken}` } : {})
    };

    const tmdbRes = await fetch('https://api.themoviedb.org/3/trending/movie/day?language=en-US', {
      headers: tmdbHeaders
    });

    if (!tmdbRes.ok) {
      return res.status(502).json({ error: 'Failed to fetch trending movies from TMDB' });
    }

    const tmdbData = await tmdbRes.json();
    const topMovies = (tmdbData.results || []).slice(0, 10);

    // 5. Build clean, responsive HTML email template
    const movieItemsHtml = topMovies.map((m, idx) => {
      const posterUrl = m.poster_path
        ? `https://image.tmdb.org/t/p/w342${m.poster_path}`
        : 'https://moviex.sbs/favicon.ico';
      const year = m.release_date ? m.release_date.slice(0, 4) : 'N/A';
      const rating = m.vote_average ? Number(m.vote_average).toFixed(1) : 'N/A';
      const tmdbLink = `https://www.themoviedb.org/movie/${m.id}`;
      const portalLink = `https://moviex.sbs/?type=movie&id=${m.id}`;

      return `
        <tr style="border-bottom: 1px solid #2a2a32;">
          <td style="padding: 16px 12px; vertical-align: top; width: 90px;">
            <a href="${portalLink}" target="_blank">
              <img src="${posterUrl}" alt="${m.title}" width="85" style="border-radius: 8px; border: 1px solid #3a3a44; display: block;" />
            </a>
          </td>
          <td style="padding: 16px 12px; vertical-align: top; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <div style="font-size: 16px; font-weight: 700; color: #ffffff; margin-bottom: 4px;">
              <span style="color: #E50914; margin-right: 6px;">#${idx + 1}</span>
              ${m.title}
              <span style="font-size: 12px; color: #8c8c9a; font-weight: 400; margin-left: 6px;">(${year})</span>
            </div>
            <div style="margin-bottom: 8px;">
              <span style="background: #272115; border: 1px solid #eab308; color: #facc15; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 12px; margin-right: 8px;">
                ⭐ ${rating} / 10
              </span>
              <span style="font-size: 11px; color: #9ca3af; text-transform: uppercase;">
                TMDB #${m.id}
              </span>
            </div>
            <p style="font-size: 12px; color: #bbbbcc; line-height: 1.5; margin: 0 0 10px 0;">
              ${m.overview ? (m.overview.length > 220 ? m.overview.slice(0, 220) + '...' : m.overview) : 'No overview available.'}
            </p>
            <div>
              <a href="${portalLink}" target="_blank" style="display: inline-block; background: #E50914; color: #ffffff; font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 6px; text-decoration: none; margin-right: 8px;">
                Manage on MovieVerify
              </a>
              <a href="${tmdbLink}" target="_blank" style="display: inline-block; background: #262630; color: #d1d5db; font-size: 11px; font-weight: 600; padding: 6px 12px; border-radius: 6px; text-decoration: none; border: 1px solid #3a3a48;">
                View on TMDB ↗
              </a>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const formattedDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Daily Trending Movies Digest</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0b0b0e; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0b0b0e; padding: 24px 12px;">
          <tr>
            <td align="center">
              <table width="100%" max-width="640" cellpadding="0" cellspacing="0" style="max-width: 640px; background-color: #141419; border: 1px solid #282832; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                <!-- Header -->
                <tr>
                  <td style="padding: 24px; background: linear-gradient(135deg, #1f1113 0%, #141419 100%); border-bottom: 2px solid #E50914;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                      <div>
                        <div style="font-size: 20px; font-weight: 900; letter-spacing: 1px; color: #ffffff;">
                          <span style="color: #E50914;">MOVIE</span>VERIFY
                        </div>
                        <div style="font-size: 12px; color: #ef4444; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 2px;">
                          Admin Daily Trending Digest
                        </div>
                      </div>
                    </div>
                    <div style="font-size: 13px; color: #9ca3af; margin-top: 12px;">
                      📅 ${formattedDate} • 🎬 Top 10 TMDB Trending Ingestion Candidates
                    </div>
                  </td>
                </tr>

                <!-- Content Table -->
                <tr>
                  <td style="padding: 8px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${movieItemsHtml}
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 24px; background-color: #0e0e13; border-top: 1px solid #22222a; text-align: center; font-size: 11px; color: #71717a;">
                    <p style="margin: 0 0 6px 0;">
                      Automated administrative alert dispatched from <strong>movieverify-backend</strong> on Render.
                    </p>
                    <p style="margin: 0;">
                      <a href="https://moviex.sbs" style="color: #E50914; text-decoration: none; font-weight: 600;">Open Admin Panel</a> •
                      <a href="https://moviex.sbs" style="color: #9ca3af; text-decoration: none;">moviex.sbs</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // 6. Send Email via Resend SDK
    const resend = new Resend(resendApiKey);
    const senderEmail = process.env.RESEND_FROM_EMAIL || 'MovieVerify Admin <onboarding@resend.dev>';

    const resendResult = await resend.emails.send({
      from: senderEmail,
      to: adminEmails,
      subject: `🎬 [MovieVerify Digest] Top 10 Trending Movies (${formattedDate})`,
      html: emailHtml,
    });

    if (resendResult.error) {
      console.error('[DailyDigest] Resend API error:', resendResult.error);
      return res.status(502).json({
        error: 'Resend API rejected delivery',
        details: resendResult.error
      });
    }

    return res.json({
      success: true,
      recipients: adminEmails,
      moviesCount: topMovies.length,
      emailId: resendResult.data?.id,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[DailyDigest] Server error:', err);
    return res.status(500).json({
      error: 'Internal server error while executing daily digest',
      message: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 API Server running on port ${PORT} (Health Check & Payments)`);
});
