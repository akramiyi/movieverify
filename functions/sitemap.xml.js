/**
 * Cloudflare Pages Function: /sitemap.xml
 * Dynamically serves the SEO sitemap with edge caching
 */

const BASE_URL = 'https://moviex.sbs';

const GENRE_SLUGS = [
  'action', 'comedy', 'drama', 'horror', 'romance', 'scifi',
  'thriller', 'animation', 'crime', 'fantasy', 'adventure',
  'family', 'mystery', 'war', 'history', 'music', 'documentary', 'western'
];

export async function onRequest(context) {
  const today = new Date().toISOString().split('T')[0];
  const urlEntries = [];

  const addUrl = (loc, changefreq = 'daily', priority = '0.8', lastmod = today) => {
    urlEntries.push({ loc, lastmod, changefreq, priority });
  };

  // 1. Static Routes
  addUrl(`${BASE_URL}/`, 'daily', '1.0');
  addUrl(`${BASE_URL}/actors`, 'weekly', '0.7');
  addUrl(`${BASE_URL}/actresses`, 'weekly', '0.7');

  // 2. Genre Routes
  for (const slug of GENRE_SLUGS) {
    addUrl(`${BASE_URL}/genre/${slug}`, 'weekly', '0.7');
  }

  // 3. Dynamic Trending and Popular titles via Render Backend Home-Feed
  try {
    const feedRes = await fetch('https://movieverify-backend.onrender.com/api/home-feed', {
      headers: { 'Accept': 'application/json' },
      cf: { cacheEverything: true, cacheTtl: 21600 }
    }).catch(() => null);

    if (feedRes && feedRes.ok) {
      const feed = await feedRes.json();
      const allPool = [
        ...(feed.trending || []),
        ...(feed.popular || []),
        ...(feed.bollywood || []),
        ...(feed.webSeries || []),
        ...(feed.indiaLatest || [])
      ];

      for (const item of allPool) {
        if (item.id) {
          const mType = item.media_type || (item.first_air_date ? 'tv' : 'movie');
          addUrl(`${BASE_URL}/share/${mType}/${item.id}`, 'daily', '0.8');
        }
      }
    }
  } catch (err) {
    console.warn('[Sitemap] Failed to fetch dynamic home feed:', err);
  }

  // Deduplicate
  const seenUrls = new Set();
  const uniqueUrls = [];
  for (const entry of urlEntries) {
    if (!seenUrls.has(entry.loc)) {
      seenUrls.add(entry.loc);
      uniqueUrls.push(entry);
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${uniqueUrls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml.trim(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=1800'
    }
  });
}
