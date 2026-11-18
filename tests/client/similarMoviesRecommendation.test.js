import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Genuine Similar Movies & TV Recommendations Engine Suite', () => {
  const modalCode = fs.readFileSync(path.resolve('src/components/MovieDetailsModal.jsx'), 'utf-8');
  const tmdbCode = fs.readFileSync(path.resolve('src/hooks/useTMDB.js'), 'utf-8');

  test('1. MovieDetailsModal does NOT import or use static mock movies from src/data/movies', () => {
    // Regression check: ensure fake Casino/Animal static mock movies are completely eliminated
    assert.doesNotMatch(
      modalCode,
      /import\s*\{\s*movies\s*\}\s*from\s*['"]\.\.\/data\/movies['"]/,
      'MovieDetailsModal must not import static movies from ../data/movies'
    );
    assert.doesNotMatch(
      modalCode,
      /const\s+similarMovies\s*=\s*movies\.filter/,
      'MovieDetailsModal must not filter static movies array'
    );
  });

  test('2. fetchTMDBDetails requests recommendations and similar via append_to_response', () => {
    assert.match(
      tmdbCode,
      /append_to_response=credits,videos,images,recommendations,similar/,
      'fetchTMDBDetails must query recommendations and similar in a single API call'
    );
  });

  test('3. useTMDB implements regional language and genre prioritization', () => {
    assert.match(
      tmdbCode,
      /isRegional\s*=\s*targetLang\s*&&\s*targetLang\s*!==\s*'en'/,
      'Must identify regional content (Hindi, Telugu, Tamil, Malayalam, etc.)'
    );
    assert.match(
      tmdbCode,
      /\/discover\/\$\{resolvedType\}\?with_original_language=\$\{targetLang\}/,
      'Must discover same-language and genre titles when recommendations are sparse'
    );
    assert.match(
      tmdbCode,
      /without_genres=10766/,
      'Must exclude daily soaps when discovering TV recommendations'
    );
  });

  test('4. Candidates are deduplicated and formatted with formatMovie', () => {
    assert.match(
      tmdbCode,
      /const\s+seenIds\s*=\s*new\s+Set\(\[parsedId\]\)/,
      'Must initialize seenIds with current movie ID to exclude self'
    );
    assert.match(
      tmdbCode,
      /const\s+seenTitles\s*=\s*new\s+Set\(\)/,
      'Must deduplicate duplicate titles'
    );
    assert.match(
      tmdbCode,
      /formatMovie\(\{[\s\S]*?media_type:\s*m\.media_type\s*\|\|\s*resolvedType[\s\S]*?\}\)/,
      'Must format each similar movie candidate with formatMovie'
    );
    assert.match(
      tmdbCode,
      /similarMovies:\s*formattedSimilar/,
      'fetchTMDBDetails must return formatted similarMovies array'
    );
  });

  test('5. MovieDetailsModal stores similarMovies in details state and resets scroll on movie change', () => {
    assert.match(
      modalCode,
      /similarMovies:\s*\[\]/,
      'details state must include similarMovies'
    );
    assert.match(
      modalCode,
      /similarMovies:\s*Array\.isArray\(res\.similarMovies\)\s*\?\s*res\.similarMovies\s*:\s*\[\]/,
      'MovieDetailsModal must store res.similarMovies from fetchTMDBDetails'
    );
    assert.match(
      modalCode,
      /const\s+similarMovies\s*=\s*\(Array\.isArray\(details\.similarMovies\)\s*&&\s*details\.similarMovies\.length\s*>\s*0\)/,
      'similarMovies must be derived from details.similarMovies'
    );
    assert.match(
      modalCode,
      /scrollContainerRef\.current\.scrollTop\s*=\s*0/,
      'Must auto-scroll modal content back to top when switching movies via More Like This'
    );
  });

  test('6. MovieDetailsModal renders genuine similar cards and triggers onSelectMovie', () => {
    assert.match(
      modalCode,
      /similarMovies\.map\(\(simMovie\)\s*=>/,
      'Must map over similarMovies'
    );
    assert.match(
      modalCode,
      /onClick=\{\(\)\s*=>\s*onSelectMovie\s*&&\s*onSelectMovie\(simMovie\)\}/,
      'Clicking a similar movie card must invoke onSelectMovie with simMovie object'
    );
    assert.match(
      modalCode,
      /simMovie\.backdrop/,
      'Similar movie card must render backdrop with poster fallback'
    );
    assert.match(
      modalCode,
      /getMatchPercent\(simMovie\.rating\)/,
      'Similar movie card must render genuine match percentage based on rating'
    );
  });
});
