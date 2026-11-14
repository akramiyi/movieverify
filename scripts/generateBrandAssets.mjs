import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([lenBuf, typeAndData, crcBuf]);
}

// Generate PNG with RGBA buffer
function encodePNG(width, height, rgbaBuffer) {
  const header = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // Color type: RGBA
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // Each scanline prefixed by filter byte 0
  const scanlineLength = 1 + width * 4;
  const rawData = Buffer.alloc(height * scanlineLength);

  for (let y = 0; y < height; y++) {
    const rawOffset = y * scanlineLength;
    rawData[rawOffset] = 0; // filter: none
    const srcOffset = y * width * 4;
    rgbaBuffer.copy(rawData, rawOffset + 1, srcOffset, srcOffset + width * 4);
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

// Render MovieVerify Brand Logo
function renderLogo(size) {
  const buf = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const badgeSize = size * 0.70; // 70% of canvas - safe zone for maskable icons
  const badgeHalf = badgeSize / 2;
  const cornerRadius = badgeSize * 0.20; // 20% border radius
  
  const bMinX = center - badgeHalf;
  const bMaxX = center + badgeHalf;
  const bMinY = center - badgeHalf;
  const bMaxY = center + badgeHalf;

  // Checker function for point in rounded rectangle
  function inBadge(x, y) {
    if (x < bMinX || x > bMaxX || y < bMinY || y > bMaxY) return false;
    const dx = Math.max(0, Math.max(bMinX + cornerRadius - x, x - (bMaxX - cornerRadius)));
    const dy = Math.max(0, Math.max(bMinY + cornerRadius - y, y - (bMaxY - cornerRadius)));
    return (dx * dx + dy * dy) <= (cornerRadius * cornerRadius);
  }

  // Distance to badge boundary for soft shadow
  function distToBadge(x, y) {
    const dx = Math.max(bMinX - x, 0, x - bMaxX);
    const dy = Math.max(bMinY - y, 0, y - bMaxY);
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Point in MovieVerify 'M' polygon
  function inM(x, y) {
    const nx = (x - bMinX) / badgeSize;
    const ny = (y - bMinY) / badgeSize;
    if (ny < 0.25 || ny > 0.75) return false;

    // Outer pillars
    if ((nx >= 0.22 && nx <= 0.35) || (nx >= 0.65 && nx <= 0.78)) return true;

    // Center V
    if (nx > 0.35 && nx < 0.65) {
      const dx = Math.abs(nx - 0.50);
      const topV = 0.25 + (0.15 - dx) * 1.55;
      const botV = topV + 0.17;
      if (ny >= topV && ny <= botV) return true;
    }
    return false;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Supersampling 2x2 for clean anti-aliasing
      let badgeHits = 0;
      let mHits = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = x + (sx + 0.5) / 2;
          const py = y + (sy + 0.5) / 2;
          if (inBadge(px, py)) {
            badgeHits++;
            if (inM(px, py)) mHits++;
          }
        }
      }

      if (mHits === 4) {
        // Pure White 'M'
        buf[idx] = 255;
        buf[idx + 1] = 255;
        buf[idx + 2] = 255;
        buf[idx + 3] = 255;
      } else if (mHits > 0) {
        // Anti-aliased 'M' edge
        const t = mHits / 4;
        const gradT = ((x - bMinX) + (y - bMinY)) / (badgeSize * 2);
        const rRed = Math.round(255 - gradT * 26); // 255 to 229
        const gRed = Math.round(52 - gradT * 43);  // 52 to 9
        const bRed = Math.round(69 - gradT * 49);  // 69 to 20
        buf[idx] = Math.round(255 * t + rRed * (1 - t));
        buf[idx + 1] = Math.round(255 * t + gRed * (1 - t));
        buf[idx + 2] = Math.round(255 * t + bRed * (1 - t));
        buf[idx + 3] = 255;
      } else if (badgeHits === 4) {
        // MovieVerify Red Gradient: #FF3445 to #E50914
        const gradT = Math.max(0, Math.min(1, ((x - bMinX) + (y - bMinY)) / (badgeSize * 2)));
        buf[idx] = Math.round(255 - gradT * 26);
        buf[idx + 1] = Math.round(52 - gradT * 43);
        buf[idx + 2] = Math.round(69 - gradT * 49);
        buf[idx + 3] = 255;
      } else if (badgeHits > 0) {
        // Anti-aliased Badge edge onto dark background
        const t = badgeHits / 4;
        const gradT = Math.max(0, Math.min(1, ((x - bMinX) + (y - bMinY)) / (badgeSize * 2)));
        const rRed = Math.round(255 - gradT * 26);
        const gRed = Math.round(52 - gradT * 43);
        const bRed = Math.round(69 - gradT * 49);
        buf[idx] = Math.round(rRed * t + 20 * (1 - t));
        buf[idx + 1] = Math.round(gRed * t + 20 * (1 - t));
        buf[idx + 2] = Math.round(bRed * t + 20 * (1 - t));
        buf[idx + 3] = 255;
      } else {
        // Background #141414 with subtle red ambient glow around badge
        const dist = distToBadge(x, y);
        const glowMax = size * 0.15;
        if (dist < glowMax) {
          const glowT = Math.pow(1 - dist / glowMax, 2) * 0.25;
          buf[idx] = Math.round(20 + 229 * glowT);
          buf[idx + 1] = Math.round(20 + 9 * glowT);
          buf[idx + 2] = Math.round(20 + 20 * glowT);
          buf[idx + 3] = 255;
        } else {
          buf[idx] = 20;     // #14
          buf[idx + 1] = 20; // #14
          buf[idx + 2] = 20; // #14
          buf[idx + 3] = 255;
        }
      }
    }
  }

  return encodePNG(size, size, buf);
}

// 1. Generate 512x512 PNG
const png512 = renderLogo(512);
fs.writeFileSync(path.resolve('public/logo512.png'), png512);
console.log('Generated public/logo512.png (' + png512.length + ' bytes)');

// 2. Generate 192x192 PNG
const png192 = renderLogo(192);
fs.writeFileSync(path.resolve('public/logo192.png'), png192);
console.log('Generated public/logo192.png (' + png192.length + ' bytes)');

// 3. Generate public/favicon.svg
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#181818"/>
      <stop offset="100%" stop-color="#0e0e0e"/>
    </linearGradient>
    <linearGradient id="mvRedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF3445"/>
      <stop offset="100%" stop-color="#E50914"/>
    </linearGradient>
    <filter id="mvGlow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="12" stdDeviation="24" flood-color="#E50914" flood-opacity="0.45"/>
    </filter>
  </defs>
  <!-- Dark PWA Canvas Background (Matches #141414) -->
  <rect width="512" height="512" fill="url(#bgGrad)" rx="112"/>
  
  <!-- MovieVerify Glowing Red Badge (Centered in Maskable Safe Zone) -->
  <rect x="76" y="76" width="360" height="360" rx="72" fill="url(#mvRedGrad)" filter="url(#mvGlow)"/>
  
  <!-- MovieVerify Bold White 'M' Logo -->
  <path d="M 156 346 L 156 166 L 204 166 L 256 260 L 308 166 L 356 166 L 356 346 L 312 346 L 312 226 L 272 308 L 240 308 L 200 226 L 200 346 Z" fill="#FFFFFF"/>
</svg>
`;

fs.writeFileSync(path.resolve('public/favicon.svg'), svg.trim());
console.log('Updated public/favicon.svg with MovieVerify Brand Logo!');
