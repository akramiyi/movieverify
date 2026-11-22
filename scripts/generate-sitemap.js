import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://moviex.sbs';

// Standard genres
const GENRE_SLUGS = [
  'action', 'comedy', 'drama', 'horror', 'romance', 'scifi',
  'thriller', 'animation', 'crime', 'fantasy', 'adventure',
  'family', 'mystery', 'war', 'history', 'music', 'documentary', 'western'
];

async function generateSitemap() {
  console.log('Generating sitemap.xml...');

  const today = new Date().toISOString().split('T')[0];
  const urlEntries = [];

  const addUrl = (loc, changefreq = 'daily', priority = '0.8', lastmod = today) => {
    urlEntries.push({ loc, lastmod, changefreq, priority });
  };

  // 1. Static & Navigation Pages
  addUrl(`${BASE_URL}/`, 'daily', '1.0');
  addUrl(`${BASE_URL}/actors`, 'weekly', '0.7');
  addUrl(`${BASE_URL}/actresses`, 'weekly', '0.7');

  // 2. Genre Pages
  for (const slug of GENRE_SLUGS) {
    addUrl(`${BASE_URL}/genre/${slug}`, 'weekly', '0.7');
  }

  // 3. Local Catalog & Download Movies
  try {
    const { movies } = await import('../src/data/movies.js');
    if (Array.isArray(movies)) {
      for (const m of movies) {
        if (m.id) {
          const mType = m.mediaType || 'movie';
          addUrl(`${BASE_URL}/share/${mType}/${m.id}`, 'weekly', '0.9');
        }
      }
    }
  } catch (err) {
    console.warn('Could not load local movies.js:', err.message);
  }

  // 4. Download Links Catalog
  try {
    const downloadLinksModule = await import('../src/data/downloadLinks.js');
    const links = downloadLinksModule.default || {};
    for (const key of Object.keys(links)) {
      const parsedId = key.split('-')[0];
      const mType = key.includes('-tv') ? 'tv' : 'movie';
      if (parsedId) {
        addUrl(`${BASE_URL}/share/${mType}/${parsedId}`, 'weekly', '0.9');
      }
    }
  } catch (err) {
    console.warn('Could not load downloadLinks.js:', err.message);
  }

  // 5. Fetch Trending & Popular from TMDB Home Feed or Proxy
  try {
    const feedRes = await fetch('https://movieverify-backend.onrender.com/api/home-feed', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000)
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
      console.log(`Fetched ${allPool.length} trending items from home-feed.`);
    }
  } catch (err) {
    console.warn('Home-feed fetch during sitemap build failed, falling back:', err.message);
  }

  // Deduplicate URLs by location
  const seenUrls = new Set();
  const uniqueUrls = [];
  for (const entry of urlEntries) {
    if (!seenUrls.has(entry.loc)) {
      seenUrls.add(entry.loc);
      uniqueUrls.push(entry);
    }
  }

  // Build standard XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${uniqueUrls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  const outputPath = path.resolve(__dirname, '../public/sitemap.xml');
  fs.writeFileSync(outputPath, xml.trim(), 'utf-8');
  console.log(`✅ sitemap.xml generated with ${uniqueUrls.length} URLs at ${outputPath}`);
}

generateSitemap();
