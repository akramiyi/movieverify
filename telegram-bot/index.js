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

// In-Memory Cache for TMDB data (Reduces TMDB rate limits and speeds up responses to ~15ms)
const tmdbCache = new NodeCache({ stdTTL: 21600, checkperiod: 1800, maxKeys: 3000 });

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_URL = process.env.FRONTEND_URL || '*'; // Configure securely in production

app.use(cors({ origin: FRONTEND_URL }));
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

app.listen(PORT, () => {
  console.log(`🌐 API Server running on port ${PORT} (Health Check & Payments)`);
});
