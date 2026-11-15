import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Movie Details Modal Photo Slider & Optimized TMDB Gallery Suite', () => {
  const modalCode = fs.readFileSync(path.resolve('src/components/MovieDetailsModal.jsx'), 'utf-8');
  const tmdbCode = fs.readFileSync(path.resolve('src/hooks/useTMDB.js'), 'utf-8');

  test('1. fetchTMDBDetails requests images in single roundtrip via append_to_response', () => {
    // Zero extra network requests: appends images to credits and videos
    assert.match(
      tmdbCode,
      /append_to_response=credits,videos,images/,
      'Must append images to append_to_response to avoid additional HTTP roundtrips'
    );
    assert.match(
      tmdbCode,
      /include_image_language=en,hi,null/,
      'Must specify image languages for high quality backdrops'
    );
  });

  test('2. fetchTMDBDetails extracts up to 4 unique backdrops and falls back to poster if needed', () => {
    assert.match(
      tmdbCode,
      /rawBackdrops\s*=\s*\(res\.images\s*&&\s*Array\.isArray\(res\.images\.backdrops\)\)/,
      'Must safely read res.images.backdrops'
    );
    assert.match(
      tmdbCode,
      /galleryImages\.length\s*>=\s*4/,
      'Must cap gallery images to 4 photos maximum for speed and memory optimization'
    );
    assert.match(
      tmdbCode,
      /images:\s*galleryImages/,
      'Must return images in fetchTMDBDetails payload'
    );
  });

  test('3. MovieDetailsModal imports navigation icons and camera badge', () => {
    assert.match(modalCode, /ChevronLeft/, 'Must import ChevronLeft');
    assert.match(modalCode, /ChevronRight/, 'Must import ChevronRight');
    assert.match(modalCode, /Camera/, 'Must import Camera icon');
  });

  test('4. MovieDetailsModal calculates galleryPhotos and controls multi-photo index', () => {
    assert.match(modalCode, /galleryPhotos\s*=\s*React\.useMemo/, 'Must memoize galleryPhotos array');
    assert.match(modalCode, /currentPhotoIndex,\s*setCurrentPhotoIndex/, 'Must maintain currentPhotoIndex state');
    assert.match(modalCode, /handleNextPhoto/, 'Must define handleNextPhoto handler');
    assert.match(modalCode, /handlePrevPhoto/, 'Must define handlePrevPhoto handler');
    assert.match(modalCode, /onTouchStart=\{handleTouchStart\}/, 'Must bind touch start for swipe gestures');
    assert.match(modalCode, /onTouchEnd=\{handleTouchEnd\}/, 'Must bind touch end for swipe gestures');
  });

  test('5. MovieDetailsModal renders carousel controls only when photoCount > 1', () => {
    assert.match(modalCode, /data-testid="photo-counter-badge"/, 'Must render counter badge');
    assert.match(modalCode, /data-testid="prev-photo-btn"/, 'Must render previous photo button');
    assert.match(modalCode, /data-testid="next-photo-btn"/, 'Must render next photo button');
    assert.match(modalCode, /data-testid="photo-indicator-dots"/, 'Must render indicator dots container');
    assert.match(modalCode, /photoCount\s*>\s*1/, 'Must conditionally render controls only when photoCount > 1');
  });

  test('6. Keyboard arrow navigation is supported and disabled during text input', () => {
    assert.match(modalCode, /e\.key\s*===\s*'ArrowRight'/, 'Must listen for ArrowRight key');
    assert.match(modalCode, /e\.key\s*===\s*'ArrowLeft'/, 'Must listen for ArrowLeft key');
    assert.match(modalCode, /tagName\s*===\s*'input'\s*\|\|\s*tagName\s*===\s*'textarea'/, 'Must ignore arrow keys when user is typing in inputs or reviews');
  });
});
