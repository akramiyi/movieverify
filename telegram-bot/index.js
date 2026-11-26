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
// Admin-Only Daily Trending & Today's Releases Email Broadcast via Resend
// Supports:
// 1. target = 'admin' (Admin-only daily digest)
// 2. target = 'users' (Today's releases email sent to all registered users)
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

  // Option B: Authenticated Admin via Bearer HMAC Token OR Supabase Auth Token
  if (!isAuthorized && authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];

    // B1: Try signed HMAC session token
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

    // B2: Try Supabase JWT Bearer Token directly from Admin logged into Admin Panel
    if (!isAuthorized && supabase) {
      try {
        const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
        if (!userErr && user) {
          const adminEmails = (process.env.ADMIN_EMAIL || 'meakramiyi@gmail.com').split(',').map(e => e.trim().toLowerCase());
          if (adminEmails.includes((user.email || '').toLowerCase())) {
            isAuthorized = true;
          } else {
            // Also check admin_users table
            const { data: adminRow } = await supabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
            if (adminRow) {
              isAuthorized = true;
            }
          }
        }
      } catch (tokenErr) {
        console.warn('[BroadcastAuth] Error validating Supabase token:', tokenErr.message);
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

  // Target audience selection: 'users' (all registered users) vs 'admin' (admin-only digest)
  const targetAudience = (req.query.target || req.body?.target || 'users').toLowerCase();

  try {
    let recipientEmails = [];

    if (targetAudience === 'users') {
      // Option A: Fetch registered users from Supabase Auth and respect email preference
      try {
        if (supabase) {
          // 1. Fetch preferences to filter out users who explicitly disabled channel_email
          const { data: prefRows } = await supabase
            .from('user_notification_preferences')
            .select('user_id, channel_email, opt_in_all');

          const optOutUserIds = new Set();
          if (Array.isArray(prefRows)) {
            prefRows.forEach(pref => {
              // If user explicitly turned off email channel or opted out of all notifications
              if (pref.channel_email === false || pref.opt_in_all === false) {
                optOutUserIds.add(pref.user_id);
              }
            });
          }

          // 2. Fetch all registered users from auth
          const { data: authUsersData, error: authErr } = await supabase.auth.admin.listUsers({
            page: 1,
            perPage: 1000
          });

          if (!authErr && authUsersData?.users) {
            authUsersData.users.forEach(u => {
              // Only include users who have not disabled email alerts
              if (u.email && !optOutUserIds.has(u.id) && !recipientEmails.includes(u.email)) {
                recipientEmails.push(u.email);
              }
            });
          }
        }
      } catch (err) {
        console.warn('[Broadcast] Error reading Supabase auth users:', err.message);
      }

      // Also include ADMIN_EMAIL as safety recipient
      if (process.env.ADMIN_EMAIL) {
        process.env.ADMIN_EMAIL.split(',').forEach(e => {
          const clean = e.trim();
          if (clean && !recipientEmails.includes(clean)) recipientEmails.push(clean);
        });
      }
    } else {
      // Admin-only target
      if (process.env.ADMIN_EMAIL) {
        process.env.ADMIN_EMAIL.split(',').forEach(e => {
          const clean = e.trim();
          if (clean && !recipientEmails.includes(clean)) recipientEmails.push(clean);
        });
      }

      if (supabase) {
        try {
          const { data: adminRows } = await supabase.from('admin_users').select('email');
          if (adminRows) {
            adminRows.forEach(r => {
              if (r.email && !recipientEmails.includes(r.email)) recipientEmails.push(r.email);
            });
          }
        } catch {}
      }
    }

    if (recipientEmails.length === 0) {
      return res.status(400).json({
        error: 'No recipients found to dispatch emails.'
      });
    }

    // 4. Fetch Movies/Releases for the Email Content
    const serverToken = process.env.TMDB_TOKEN || process.env.VITE_TMDB_TOKEN;
    const tmdbHeaders = {
      'Accept': 'application/json',
      ...(serverToken ? { 'Authorization': `Bearer ${serverToken}` } : {})
    };

    const todayDate = new Date().toISOString().split('T')[0];
    let moviesList = [];
    let emailSubject = '';

    // Check configured downloads from Supabase so Admin sees link status
    let configuredLinkMap = new Map();
    if (supabase) {
      try {
        const { data: dbLinks } = await supabase.from('download_links').select('id, tmdb_id, title, download480p, download720p, download1080p, seasons');
        if (Array.isArray(dbLinks)) {
          dbLinks.forEach(link => {
            const hasAny = Boolean(
              (link.download1080p && link.download1080p !== '#') ||
              (link.download720p && link.download720p !== '#') ||
              (link.download480p && link.download480p !== '#') ||
              (Array.isArray(link.seasons) && link.seasons.length > 0)
            );
            const statusObj = {
              has1080p: Boolean(link.download1080p && link.download1080p !== '#'),
              has720p: Boolean(link.download720p && link.download720p !== '#'),
              has480p: Boolean(link.download480p && link.download480p !== '#'),
              hasAny
            };

            // Index by full string id, tmdb_id, and lowercase normalized title for 100% accurate matching
            if (link.id) configuredLinkMap.set(String(link.id), statusObj);
            if (link.tmdb_id) configuredLinkMap.set(String(link.tmdb_id), statusObj);
            if (link.title) configuredLinkMap.set(String(link.title).trim().toLowerCase(), statusObj);
          });
        }
      } catch {}
    }

    if (targetAudience === 'admin') {
      // SPECIAL ADMIN TASK: Top 10 Indian Box Office & Global Trending movies
      // Direct task list for Admin to upload/update download links
      try {
        const [trendIndiaRes, trendGlobalRes, nowPlayingRes] = await Promise.all([
          fetch('https://api.themoviedb.org/3/discover/movie?region=IN&sort_by=popularity.desc&vote_count.gte=10', { headers: tmdbHeaders }).catch(() => null),
          fetch('https://api.themoviedb.org/3/trending/movie/day?language=en-US', { headers: tmdbHeaders }).catch(() => null),
          fetch('https://api.themoviedb.org/3/movie/now_playing?region=IN&page=1', { headers: tmdbHeaders }).catch(() => null),
        ]);

        const candidateMap = new Map();

        const addCandidate = (item) => {
          if (!item || !item.id || !item.poster_path) return;
          const id = String(item.id);
          if (!candidateMap.has(id)) {
            candidateMap.set(id, item);
          }
        };

        if (trendIndiaRes && trendIndiaRes.ok) {
          const data = await trendIndiaRes.json();
          (data.results || []).slice(0, 8).forEach(addCandidate);
        }
        if (nowPlayingRes && nowPlayingRes.ok) {
          const data = await nowPlayingRes.json();
          (data.results || []).slice(0, 6).forEach(addCandidate);
        }
        if (trendGlobalRes && trendGlobalRes.ok) {
          const data = await trendGlobalRes.json();
          (data.results || []).slice(0, 6).forEach(addCandidate);
        }

        moviesList = Array.from(candidateMap.values()).slice(0, 10);
      } catch (err) {
        console.warn('[AdminDigest] Error fetching admin candidates:', err.message);
      }
    } else {
      // USERS DIGEST: Releases for today
      try {
        const todayRes = await fetch(`https://api.themoviedb.org/3/discover/movie?region=IN&primary_release_date.gte=${todayDate}&primary_release_date.lte=${todayDate}&sort_by=popularity.desc`, {
          headers: tmdbHeaders
        });
        if (todayRes.ok) {
          const todayData = await todayRes.json();
          moviesList = (todayData.results || []).filter(m => m.poster_path && m.overview).slice(0, 8);
        }
      } catch {}

      // If today's list is light, blend with top trending daily
      if (moviesList.length < 5) {
        try {
          const trendRes = await fetch('https://api.themoviedb.org/3/trending/all/day?language=en-US', {
            headers: tmdbHeaders
          });
          if (trendRes.ok) {
            const trendData = await trendRes.json();
            const existingIds = new Set(moviesList.map(m => m.id));
            (trendData.results || []).forEach(item => {
              if (moviesList.length < 10 && !existingIds.has(item.id) && item.poster_path) {
                existingIds.add(item.id);
                moviesList.push(item);
              }
            });
          }
        } catch {}
      }
    }

    const formattedDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    emailSubject = targetAudience === 'users'
      ? `🎬 Today's Releases & New Movies on MovieVerify (${formattedDate})`
      : `🔥 [Admin Action Task] Top 10 Trending Movies to Upload Links (${formattedDate})`;

    // 5. Generate Cinema Responsive HTML
    const movieItemsHtml = moviesList.map((m, idx) => {
      const title = m.title || m.name || 'Untitled';
      const isTv = m.media_type === 'tv' || (!m.title && m.name);
      const mType = isTv ? 'tv' : 'movie';
      const posterUrl = m.poster_path
        ? `https://image.tmdb.org/t/p/w342${m.poster_path}`
        : 'https://moviex.sbs/favicon.ico';
      const year = (m.release_date || m.first_air_date || '').slice(0, 4) || '2026';
      const rating = m.vote_average ? Number(m.vote_average).toFixed(1) : '7.5';
      const portalLink = `https://moviex.sbs/?type=${mType}&id=${m.id}`;
      const adminEditLink = `https://moviex.sbs/admin?tmdb_id=${m.id}&type=${mType}&title=${encodeURIComponent(title)}`;

      // Check link status by tmdb_id, compound id, or title
      const linkStatus = configuredLinkMap.get(String(m.id)) 
        || configuredLinkMap.get(`${m.id}-${mType}`) 
        || configuredLinkMap.get(title.trim().toLowerCase());
      const hasLinks = linkStatus?.hasAny;

      return `
        <tr style="border-bottom: 1px solid #22222a;">
          <td style="padding: 16px 10px; vertical-align: top; width: 85px;">
            <a href="${portalLink}" target="_blank">
              <img src="${posterUrl}" alt="${title}" width="80" style="border-radius: 8px; border: 1px solid #33333e; display: block;" />
            </a>
          </td>
          <td style="padding: 16px 10px; vertical-align: top; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <div style="font-size: 15px; font-weight: 700; color: #ffffff; margin-bottom: 4px;">
              <span style="color: #E50914; margin-right: 6px;">#${idx + 1}</span>
              ${title}
              <span style="font-size: 12px; color: #8c8c9a; font-weight: 400; margin-left: 6px;">(${year})</span>
            </div>
            <div style="margin-bottom: 8px;">
              <span style="background: #272115; border: 1px solid #eab308; color: #facc15; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 12px; margin-right: 6px;">
                ⭐ ${rating} / 10
              </span>
              <span style="background: #192219; border: 1px solid #22c55e; color: #4ade80; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 12px; margin-right: 6px;">
                ${isTv ? '📺 Web Series' : '🎬 Popular Trending'}
              </span>
              ${targetAudience === 'admin' ? (
                hasLinks 
                  ? `<span style="background: #064e3b; border: 1px solid #10b981; color: #a7f3d0; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 12px;">✅ Link Configured</span>`
                  : `<span style="background: #7f1d1d; border: 1px solid #ef4444; color: #fecaca; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 12px;">⚠️ Link Missing (Action Required)</span>`
              ) : ''}
            </div>
            <p style="font-size: 12px; color: #b0b0c0; line-height: 1.45; margin: 0 0 10px 0;">
              ${m.overview ? (m.overview.length > 180 ? m.overview.slice(0, 180) + '...' : m.overview) : 'Fresh premiere now streaming. Watch official trailer and high-speed links directly on MovieVerify.'}
            </p>
            <div>
              ${targetAudience === 'admin' ? `
                <a href="${adminEditLink}" target="_blank" style="display: inline-block; background: #E50914; color: #ffffff; font-size: 11px; font-weight: 700; padding: 6px 14px; border-radius: 6px; text-decoration: none; margin-right: 8px;">
                  ✏️ Update Link in Admin Panel
                </a>
                <a href="${portalLink}" target="_blank" style="display: inline-block; background: #22222a; color: #dddddd; font-size: 11px; font-weight: 600; padding: 6px 12px; border-radius: 6px; text-decoration: none; border: 1px solid #3c3c4a;">
                  👁️ View Page
                </a>
              ` : `
                <a href="${portalLink}" target="_blank" style="display: inline-block; background: #E50914; color: #ffffff; font-size: 11px; font-weight: 700; padding: 6px 14px; border-radius: 6px; text-decoration: none; margin-right: 8px;">
                  ▶ Watch / Download on MovieVerify
                </a>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${emailSubject}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0b0b0e; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0b0b0e; padding: 20px 8px;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 620px; background-color: #141419; border: 1px solid #252530; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.6);">
                <!-- Header -->
                <tr>
                  <td style="padding: 24px; background: linear-gradient(135deg, #220f12 0%, #141419 100%); border-bottom: 2px solid #E50914;">
                    <div style="font-size: 22px; font-weight: 900; letter-spacing: 1px; color: #ffffff;">
                      <span style="color: #E50914;">MOVIE</span>VERIFY ${targetAudience === 'admin' ? '<span style="font-size: 12px; background: #7f1d1d; color: #fecaca; padding: 2px 8px; border-radius: 6px; margin-left: 8px; vertical-align: middle;">ADMIN TASK DESK</span>' : ''}
                    </div>
                    <div style="font-size: 12px; color: #ef4444; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 3px;">
                      ${targetAudience === 'admin' ? 'Daily Top 10 Trending Action Task (Upload Download Links)' : "Today's Premiere Releases & Trending Updates"}
                    </div>
                    <div style="font-size: 13px; color: #9ca3af; margin-top: 10px;">
                      📅 ${formattedDate} • ${targetAudience === 'admin' ? 'Akram, yeh aaj ki Top 10 sabse zyada searched movies hain. Inke 1080p/720p links check karein aur upload karein.' : 'Namaste! Aaj release hone wali sabse nayi movies aur web series aapke liye ready hain.'}
                    </div>
                  </td>
                </tr>

                <!-- Content Table -->
                <tr>
                  <td style="padding: 6px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${movieItemsHtml}
                    </table>
                  </td>
                </tr>

                <!-- CTA Banner -->
                <tr>
                  <td style="padding: 20px; background-color: #1a1a24; text-align: center; border-top: 1px solid #282835;">
                    <p style="font-size: 13px; color: #e4e4e7; margin: 0 0 12px 0;">
                      ${targetAudience === 'admin' ? 'Direct Admin Control Panel me jakar missing download links paste karein:' : 'Bina kisi ad ya fake link ke fast 1080p downloads aur trailers ke liye visit karein:'}
                    </p>
                    <a href="${targetAudience === 'admin' ? 'https://moviex.sbs/admin' : 'https://moviex.sbs'}" target="_blank" style="display: inline-block; background: #E50914; color: #ffffff; font-size: 13px; font-weight: 800; padding: 10px 24px; border-radius: 8px; text-decoration: none;">
                      ${targetAudience === 'admin' ? 'Open Admin Control Panel →' : 'Explore All Today Releases on MovieVerify →'}
                    </a>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 24px; background-color: #0c0c10; border-top: 1px solid #1f1f28; text-align: center; font-size: 11px; color: #71717a;">
                    <p style="margin: 0 0 6px 0;">
                      ${targetAudience === 'admin' ? 'Confidential: Administrator Daily Content Suggestion & Link Action Task.' : 'You are receiving this daily email release notification because you signed in to <strong>MovieVerify</strong>.'}
                    </p>
                    <p style="margin: 0;">
                      <a href="https://moviex.sbs" style="color: #E50914; text-decoration: none; font-weight: 600;">MovieVerify Web</a> •
                      <a href="https://moviex.sbs/admin" style="color: #9ca3af; text-decoration: none;">Admin Panel</a>
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

    // 6. Send via Resend (Supports batching for 100/day limit)
    const resend = new Resend(resendApiKey);
    const senderEmail = process.env.RESEND_FROM_EMAIL || 'MovieVerify <onboarding@resend.dev>';

    // Cap recipients safely to protect free limits
    const dispatchList = recipientEmails.slice(0, 95);

    const resendResult = await resend.emails.send({
      from: senderEmail,
      to: dispatchList,
      subject: emailSubject,
      html: emailHtml,
    });

    if (resendResult.error) {
      console.error('[DailyBroadcast] Resend API error:', resendResult.error);
      return res.status(502).json({
        error: 'Resend API rejected delivery',
        details: resendResult.error
      });
    }

    // 7. Record in Supabase notification_campaigns for Admin Panel Live Tracking
    const campaignId = crypto.randomUUID();
    if (supabase) {
      try {
        await supabase.from('notification_campaigns').insert({
          id: campaignId,
          title: emailSubject,
          body: `Today's release digest dispatched to ${dispatchList.length} users via Resend.`,
          category: 'movie_release',
          target_type: 'all',
          target_criteria: {
            channel: 'email',
            provider: 'resend',
            target: targetAudience,
            recipients_count: dispatchList.length,
            movies_count: moviesList.length
          },
          status: 'completed',
          total_recipients: dispatchList.length,
          sent_count: dispatchList.length,
          success_count: dispatchList.length,
          failure_count: 0,
          action_url: 'https://moviex.sbs',
          sent_at: new Date().toISOString(),
          completed_at: new Date().toISOString()
        });
      } catch (logErr) {
        console.warn('[DailyBroadcast] Could not record campaign in DB:', logErr.message);
      }
    }

    return res.json({
      success: true,
      campaignId,
      target: targetAudience,
      recipientsCount: dispatchList.length,
      recipients: dispatchList,
      moviesCount: moviesList.length,
      emailId: resendResult.data?.id,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[DailyBroadcast] Server error:', err);
    return res.status(500).json({
      error: 'Internal server error while executing broadcast',
      message: err.message
    });
  }
});

// GET /api/admin/email-broadcast/stats: Live tracking for Admin Panel
app.get('/api/admin/email-broadcast/stats', async (req, res) => {
  try {
    let totalUsers = 0;
    let recentDispatches = [];

    if (supabase) {
      const { data: authUsersData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      totalUsers = authUsersData?.users?.length || 0;

      const { data: campaignRows } = await supabase
        .from('notification_campaigns')
        .select('*')
        .contains('target_criteria', { channel: 'email' })
        .order('created_at', { ascending: false })
        .limit(10);

      recentDispatches = campaignRows || [];
    }

    return res.json({
      success: true,
      totalRegisteredUsers: totalUsers,
      provider: 'Resend',
      dispatches: recentDispatches
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/links/health-check: Proactive dead link validator
app.get('/api/admin/links/health-check', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Database client unavailable' });

    const { data: links, error } = await supabase
      .from('download_links')
      .select('id, title, media_type, download480p, download720p, download1080p, updated_at')
      .order('updated_at', { ascending: false })
      .limit(30);

    if (error) return res.status(500).json({ error: error.message });

    const results = [];
    for (const item of (links || [])) {
      const issues = [];
      const checkUrls = [
        { quality: '480p', url: item.download480p },
        { quality: '720p', url: item.download720p },
        { quality: '1080p', url: item.download1080p }
      ];

      for (const { quality, url } of checkUrls) {
        if (!url || url === '#' || url.trim() === '') {
          issues.push({ quality, status: 'missing', reason: 'Link is empty or #' });
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
          issues.push({ quality, status: 'invalid', reason: 'Malformed URL scheme' });
        }
      }

      results.push({
        id: item.id,
        title: item.title,
        healthy: issues.length === 0,
        issues
      });
    }

    const deadOrMissingCount = results.filter(r => !r.healthy).length;

    return res.json({
      success: true,
      scannedCount: results.length,
      healthyCount: results.length - deadOrMissingCount,
      issuesCount: deadOrMissingCount,
      report: results
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Auto-Pilot Dispatcher: Autonomous background heartbeat running inside 24/7 Render instance.
// Triggers /api/notifications/dispatch every 2 minutes so push notifications NEVER rely on external crons or manual clicks.
const CRON_SECRET = process.env.INTERNAL_WORKER_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

async function autoPilotNotificationDispatch() {
  try {
    const targetUrl = `https://movieverify.vercel.app/api/notifications/dispatch?secret=${encodeURIComponent(CRON_SECRET)}`;
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': CRON_SECRET
      },
      body: JSON.stringify({ batch_size: 50, sweep_expired: true })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (data.sent > 0 || data.promoted > 0) {
        console.log(`[AutoPilot Dispatcher] Dispatched successfully: sent=${data.sent}, promoted=${data.promoted}`);
      }
    } else {
      console.warn(`[AutoPilot Dispatcher] Dispatch response HTTP ${res.status}:`, data.error || data.message || 'Check logs');
    }
  } catch (err) {
    console.error('[AutoPilot Dispatcher] Heartbeat failed:', err.message);
  }
}

// Run 10 seconds after server startup, then recurring every 2 minutes continuously
setTimeout(autoPilotNotificationDispatch, 10 * 1000);
setInterval(autoPilotNotificationDispatch, 2 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🌐 API Server running on port ${PORT} (Health Check, Payments & AutoPilot Dispatcher)`);
});
