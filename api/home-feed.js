/**
 * MovieVerify Bundled Home Feed API (Vercel Serverless & Edge Cache)
 * 
 * Bundles Trending, Popular, Bollywood, South Languages, Web Series,
 * and India Latest Releases into a single consolidated JSON payload.
 * 
 * Sets aggressive Edge Cache headers (s-maxage=21600 / 6h) to replicate
 * Reelipse's single-request edge performance.
 */

const memoryCache = new Map();
const CACHE_KEY = 'bundle:home-feed';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Edge & Browser Caching Headers
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=1800');

  // Check in-memory container cache
  const cached = memoryCache.get(CACHE_KEY);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  const serverToken = process.env.TMDB_READ_TOKEN || process.env.TMDB_TOKEN || process.env.TMDB_API_KEY;
  const backendUrl = process.env.VITE_API_URL || 'https://movieverify-backend.onrender.com';

  // Strategy 1: Fetch from TMDB if server token exists
  if (serverToken) {
    try {
      const isBearer = serverToken.length > 50;
      const headers = {
        'Accept': 'application/json',
        ...(isBearer ? { 'Authorization': `Bearer ${serverToken}` } : {})
      };

      const fetchJson = async (endpoint) => {
        try {
          const sep = endpoint.includes('?') ? '&' : '?';
          const url = isBearer
            ? `https://api.themoviedb.org/3${endpoint}`
            : `https://api.themoviedb.org/3${endpoint}${sep}api_key=${encodeURIComponent(serverToken)}`;
          const r = await fetch(url, { headers });
          if (!r.ok) return { results: [] };
          return await r.json();
        } catch {
          return { results: [] };
        }
      };

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

      memoryCache.set(CACHE_KEY, { timestamp: Date.now(), data: feedData });
      res.setHeader('X-Cache', 'MISS');
      return res.status(200).json(feedData);
    } catch (err) {
      console.warn('[HomeFeed] TMDB direct fetch error, falling back to backend proxy:', err.message);
    }
  }

  // Strategy 2: Fallback to MovieVerify Render backend proxy
  try {
    const backendRes = await fetch(`${backendUrl}/api/home-feed`);
    if (backendRes.ok) {
      const data = await backendRes.json();
      memoryCache.set(CACHE_KEY, { timestamp: Date.now(), data });
      res.setHeader('X-Cache', 'PROXY');
      return res.status(200).json(data);
    }
  } catch (backendErr) {
    console.error('[HomeFeed] Backend proxy fetch failed:', backendErr.message);
  }

  return res.status(500).json({ error: 'Failed to generate home feed' });
}
