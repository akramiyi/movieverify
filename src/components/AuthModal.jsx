import React, { useState, useEffect, useRef } from 'react';
import { X, ShieldCheck, AlertCircle, Loader2, Lock, User, Mail, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../data/supabaseClient';

const GoogleIcon = () => (
  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

import { movies as localMovies } from '../data/movies';

// High-resolution fallback posters matching reference collage composition (All verified 200 OK)
const FALLBACK_COLUMN_1 = [
  { title: 'Jawan', img: 'https://image.tmdb.org/t/p/w500/4Y1WNkd88JXmGfhtWR7dmDAo1T2.jpg' },
  { title: 'Casino', img: 'https://image.tmdb.org/t/p/w500/gziIkUSnYuj9ChCi8qOu2ZunpSC.jpg' },
  { title: 'Inception', img: 'https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg' },
  { title: 'Oppenheimer', img: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg' },
  { title: 'The Dark Knight', img: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg' },
  { title: 'Avengers', img: 'https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9sl16pB3iy.jpg' },
];

const FALLBACK_COLUMN_2 = [
  { title: 'Dune Part Two', img: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg' },
  { title: 'Animal', img: 'https://image.tmdb.org/t/p/w500/zqFuriKJ6pYDvf72kXNLONnuE8k.jpg' },
  { title: 'Spider-Man', img: 'https://image.tmdb.org/t/p/w500/1g0dhYtq4irTY1GPXvft6k4YLjm.jpg' },
  { title: 'Salaar', img: 'https://image.tmdb.org/t/p/w500/siduVKgOnABO4WH4lOwPQwaGwJp.jpg' },
  { title: 'Toxic', img: 'https://image.tmdb.org/t/p/w500/s5KZqIvyjwKpTRESCVrVGkT1JX3.jpg' },
  { title: 'Pushpa', img: 'https://image.tmdb.org/t/p/w500/h6Pd89ngvl9quPVsx3KoJlQsvk9.jpg' },
];

const FALLBACK_COLUMN_3 = [
  { title: 'The Boys', img: 'https://image.tmdb.org/t/p/w500/in1R2dDc421JxsoRWaIIAqVI2KE.jpg' },
  { title: 'Stranger Things', img: 'https://image.tmdb.org/t/p/w500/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg' },
  { title: 'John Wick 4', img: 'https://image.tmdb.org/t/p/w500/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg' },
  { title: 'Fight Club', img: 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg' },
  { title: 'The Godfather', img: 'https://image.tmdb.org/t/p/w500/3bhkrj58Vtu7enYsRolD1fZdja1.jpg' },
  { title: 'Ratsasan', img: 'https://image.tmdb.org/t/p/w500/velWPhVMQeQKcxggNEU8YmIo52R.jpg' },
];

// Module-level cache for TMDB movie posters so we never re-parse or re-fetch during animation
let cachedTMDBPosterPool = null;

const getAvailableTMDBPosters = () => {
  if (cachedTMDBPosterPool && cachedTMDBPosterPool.length > 50) {
    return cachedTMDBPosterPool;
  }

  const pool = [];
  const seen = new Set();

  const add = (title, img) => {
    if (!img || typeof img !== 'string') return;
    const fullUrl = img.startsWith('http')
      ? img
      : `https://image.tmdb.org/t/p/w500${img}`;
    if (!seen.has(fullUrl)) {
      seen.add(fullUrl);
      pool.push({ title: title || 'Movie', img: fullUrl });
    }
  };

  // 1. Read existing TMDB data cached in sessionStorage by useTMDB
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('tmdb_cache_')) {
        const raw = sessionStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : (parsed?.results || []);
          list.forEach((m) => {
            if (m && (m.poster_path || m.poster)) {
              add(m.title || m.name, m.poster_path || m.poster);
            }
          });
        }
      }
    }
  } catch {
    // sessionStorage read failed or disabled
  }

  // 2. Add local movie database posters
  if (Array.isArray(localMovies)) {
    localMovies.forEach((m) => {
      if (m && (m.poster || m.poster_path)) {
        add(m.title, m.poster || m.poster_path);
      }
    });
  }

  // 3. Add existing verified fallback posters
  FALLBACK_COLUMN_1.forEach((m) => add(m.title, m.img));
  FALLBACK_COLUMN_2.forEach((m) => add(m.title, m.img));
  FALLBACK_COLUMN_3.forEach((m) => add(m.title, m.img));

  if (pool.length >= 18) {
    cachedTMDBPosterPool = pool;
  }

  return pool;
};

// Shuffles pool and returns 3 distinct columns of 6 posters each (18 unique posters)
const getRandomPosterColumns = () => {
  const pool = getAvailableTMDBPosters();
  if (pool.length < 18) {
    return {
      col1: FALLBACK_COLUMN_1,
      col2: FALLBACK_COLUMN_2,
      col3: FALLBACK_COLUMN_3,
    };
  }

  // Fisher-Yates shuffle
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return {
    col1: shuffled.slice(0, 6),
    col2: shuffled.slice(6, 12),
    col3: shuffled.slice(12, 18),
  };
};

const PosterCard = ({ title, img }) => {
  const [hasError, setHasError] = useState(false);

  return (
    <div className="w-24 xs:w-28 sm:w-32 md:w-36 lg:w-44 xl:w-52 2xl:w-60 aspect-[2/3] rounded-xl lg:rounded-2xl xl:rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex-shrink-0 bg-neutral-900 group">
      {hasError ? (
        <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-950 flex flex-col items-center justify-center p-2 text-center">
          <div className="w-6 h-6 rounded-full bg-red-600/30 flex items-center justify-center text-red-500 mb-1">MV</div>
          <span className="text-[10px] font-bold text-gray-300 line-clamp-2">{title}</span>
        </div>
      ) : (
        <img
          src={img}
          alt={title}
          loading="lazy"
          onError={() => setHasError(true)}
          className="w-full h-full object-cover select-none pointer-events-none"
        />
      )}
    </div>
  );
};

// Vintage 35mm film reel and ribbon graphic for desktop cinematic atmosphere matching reference image
const CinematicFilmDecor = () => (
  <div className="hidden lg:block absolute inset-0 pointer-events-none select-none z-10 overflow-hidden">
    {/* Cinematic Red Nebula / Fog at bottom matching reference atmosphere */}
    <div className="absolute -bottom-20 left-1/4 w-[700px] h-[400px] bg-red-600/20 rounded-full blur-[140px] pointer-events-none" />
    <div className="absolute -bottom-10 right-1/4 w-[600px] h-[350px] bg-red-700/25 rounded-full blur-[160px] pointer-events-none" />
    <div className="absolute bottom-10 left-1/3 w-[500px] h-[260px] bg-red-500/15 rounded-full blur-[120px] pointer-events-none" />

    {/* Top Arched 35mm Film Strip Ribbon */}
    <div className="absolute -top-6 left-[28%] xl:left-[32%] w-[580px] xl:w-[680px] h-48 opacity-75">
      <svg viewBox="0 0 680 190" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="filmTopGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1a1a1a" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#2c2c2c" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#121212" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="filmGlowRed" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#E50914" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#ff4d4d" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#E50914" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Film strip body arching from top-left downwards towards top-right */}
        <path
          d="M -20 18 C 180 8, 380 75, 690 185 L 678 225 C 370 115, 170 48, -20 58 Z"
          fill="url(#filmTopGrad)"
          stroke="#404040"
          strokeWidth="1.5"
        />
        {/* Ambient red highlight along top edge */}
        <path
          d="M -20 18 C 180 8, 380 75, 690 185"
          stroke="url(#filmGlowRed)"
          strokeWidth="2.5"
        />

        {/* Top sprocket perforations along the arch */}
        {[
          { x: 20, y: 22, r: -5 },
          { x: 65, y: 20, r: -2 },
          { x: 110, y: 21, r: 2 },
          { x: 155, y: 26, r: 6 },
          { x: 200, y: 34, r: 10 },
          { x: 245, y: 44, r: 14 },
          { x: 290, y: 56, r: 17 },
          { x: 335, y: 70, r: 20 },
          { x: 380, y: 86, r: 22 },
          { x: 425, y: 104, r: 24 },
          { x: 470, y: 124, r: 25 },
          { x: 515, y: 145, r: 26 },
          { x: 560, y: 168, r: 26 },
        ].map((pt, idx) => (
          <rect
            key={`top-spk-${idx}`}
            x={pt.x}
            y={pt.y}
            width="7"
            height="11"
            rx="1.5"
            transform={`rotate(${pt.r} ${pt.x} ${pt.y})`}
            fill="#050505"
            stroke="#555"
            strokeWidth="0.8"
          />
        ))}

        {/* Film frame lines */}
        {[
          { d: "M 45 22 L 42 54" },
          { d: "M 135 24 L 130 60" },
          { d: "M 225 40 L 217 80" },
          { d: "M 315 64 L 303 108" },
          { d: "M 405 96 L 390 144" },
          { d: "M 495 135 L 477 185" },
        ].map((line, idx) => (
          <path
            key={`top-frm-${idx}`}
            d={line.d}
            stroke="#3a3a3a"
            strokeWidth="2"
          />
        ))}

        {/* Film frame inner dark boxes */}
        {[
          { d: "M 52 26 C 90 26, 120 30, 125 32 L 122 55 C 90 53, 58 48, 50 48 Z" },
          { d: "M 142 33 C 180 39, 210 49, 215 52 L 210 74 C 180 70, 148 60, 140 57 Z" },
          { d: "M 232 50 C 270 60, 300 74, 305 78 L 297 101 C 265 96, 235 83, 227 79 Z" },
          { d: "M 322 76 C 360 90, 390 108, 395 113 L 385 136 C 352 130, 322 114, 314 109 Z" },
        ].map((box, idx) => (
          <path
            key={`top-box-${idx}`}
            d={box.d}
            fill="#080808"
            fillOpacity="0.75"
            stroke="#262626"
            strokeWidth="1"
          />
        ))}
      </svg>
    </div>

    {/* Bottom Curving 35mm Film Strip Ribbon */}
    <div className="absolute -bottom-10 left-[18%] xl:left-[22%] w-[480px] xl:w-[560px] h-36 opacity-70">
      <svg viewBox="0 0 560 140" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M 10 90 C 140 45, 290 85, 540 25 L 536 60 C 290 120, 140 80, 10 125 Z"
          fill="#1c1c1c"
          stroke="#383838"
          strokeWidth="1.2"
        />
        <path
          d="M 10 90 C 140 45, 290 85, 540 25"
          stroke="#E50914"
          strokeWidth="1.8"
          strokeOpacity="0.5"
        />
        {/* Sprockets along bottom ribbon */}
        {[
          { x: 40, y: 88, r: -15 },
          { x: 90, y: 77, r: -12 },
          { x: 140, y: 72, r: -4 },
          { x: 190, y: 74, r: 3 },
          { x: 240, y: 80, r: 8 },
          { x: 290, y: 85, r: 6 },
          { x: 340, y: 80, r: -2 },
          { x: 390, y: 68, r: -10 },
          { x: 440, y: 52, r: -14 },
          { x: 490, y: 35, r: -16 },
        ].map((pt, idx) => (
          <rect
            key={`bot-spk-${idx}`}
            x={pt.x}
            y={pt.y}
            width="6"
            height="9"
            rx="1.2"
            transform={`rotate(${pt.r} ${pt.x} ${pt.y})`}
            fill="#050505"
            stroke="#484848"
            strokeWidth="0.7"
          />
        ))}
      </svg>
    </div>

    {/* Vintage Metallic 35mm Film Reel Wheel (Bottom Left Corner) */}
    <div className="absolute -bottom-16 -left-16 sm:-bottom-12 sm:-left-12 xl:-bottom-10 xl:-left-10 w-[300px] h-[300px] xl:w-[350px] xl:h-[350px] 2xl:w-[390px] 2xl:h-[390px] pointer-events-none select-none">
      <svg viewBox="0 0 350 350" className="w-full h-full drop-shadow-[0_0_35px_rgba(229,9,20,0.3)]" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* Metallic brushed steel gradients */}
          <linearGradient id="metalRimOuter" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7a7a7a" />
            <stop offset="25%" stopColor="#b8b8b8" />
            <stop offset="45%" stopColor="#ffffff" />
            <stop offset="65%" stopColor="#555555" />
            <stop offset="85%" stopColor="#8a8a8a" />
            <stop offset="100%" stopColor="#2e2e2e" />
          </linearGradient>

          <linearGradient id="metalRimInner" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3d3d3d" />
            <stop offset="35%" stopColor="#666666" />
            <stop offset="50%" stopColor="#8c8c8c" />
            <stop offset="70%" stopColor="#444444" />
            <stop offset="100%" stopColor="#1a1a1a" />
          </linearGradient>

          <radialGradient id="spindleHub" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#111" />
            <stop offset="40%" stopColor="#333" />
            <stop offset="85%" stopColor="#777" />
            <stop offset="100%" stopColor="#222" />
          </radialGradient>

          <radialGradient id="reelRedAtmosphere" cx="65%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#E50914" stopOpacity="0.45" />
            <stop offset="45%" stopColor="#8B0000" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient red backlight behind the reel */}
        <circle cx="175" cy="175" r="160" fill="url(#reelRedAtmosphere)" />

        {/* Film reel outer flange base */}
        <circle cx="175" cy="175" r="150" fill="#181818" stroke="url(#metalRimOuter)" strokeWidth="6" />

        {/* Outer concentric metallic groove */}
        <circle cx="175" cy="175" r="142" stroke="url(#metalRimInner)" strokeWidth="2.5" fill="none" />

        {/* Sprocket holes on outer perimeter of reel */}
        {Array.from({ length: 32 }).map((_, i) => {
          const angle = (i * 360) / 32;
          const rad = (angle * Math.PI) / 180;
          const x = 175 + 132 * Math.cos(rad);
          const y = 175 + 132 * Math.sin(rad);
          return (
            <circle
              key={`reel-spk-${i}`}
              cx={x}
              cy={y}
              r="3.5"
              fill="#060606"
              stroke="#666"
              strokeWidth="1"
            />
          );
        })}

        {/* Film roll winding ring behind spokes */}
        <circle cx="175" cy="175" r="115" fill="#120e0e" stroke="#2a1f1f" strokeWidth="1" />

        {/* 6 Large circular weight-reduction cutouts of classical 35mm film reel */}
        {[0, 60, 120, 180, 240, 300].map((angle, idx) => {
          const rad = (angle * Math.PI) / 180;
          const cx = 175 + 72 * Math.cos(rad);
          const cy = 175 + 72 * Math.sin(rad);
          return (
            <g key={`spoke-hole-${idx}`}>
              {/* Hole shadow */}
              <circle cx={cx} cy={cy} r="28" fill="#050505" />
              {/* Metallic beveled rim on hole */}
              <circle
                cx={cx}
                cy={cy}
                r="28"
                stroke="url(#metalRimOuter)"
                strokeWidth="2.5"
                fill="none"
              />
              <circle
                cx={cx}
                cy={cy}
                r="25.5"
                stroke="#1f1f1f"
                strokeWidth="1.5"
                fill="none"
              />
            </g>
          );
        })}

        {/* Spokes connecting inner hub to outer rim */}
        {[30, 90, 150, 210, 270, 330].map((angle, idx) => {
          const rad = (angle * Math.PI) / 180;
          const x1 = 175 + 44 * Math.cos(rad);
          const y1 = 175 + 44 * Math.sin(rad);
          const x2 = 175 + 120 * Math.cos(rad);
          const y2 = 175 + 120 * Math.sin(rad);
          return (
            <line
              key={`spoke-rib-${idx}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="url(#metalRimInner)"
              strokeWidth="4"
              strokeLinecap="round"
            />
          );
        })}

        {/* Central Spindle Hub */}
        <circle cx="175" cy="175" r="44" fill="url(#spindleHub)" stroke="url(#metalRimOuter)" strokeWidth="3" />
        <circle cx="175" cy="175" r="28" fill="#141414" stroke="#4a4a4a" strokeWidth="2" />
        <circle cx="175" cy="175" r="14" fill="#000000" stroke="#777" strokeWidth="2" />

        {/* Red edge specular lighting reflection on the metallic reel */}
        <path
          d="M 175 25 A 150 150 0 0 1 325 175"
          stroke="#E50914"
          strokeWidth="3"
          strokeOpacity="0.65"
          fill="none"
        />
      </svg>
    </div>
  </div>
);

// Continuous vertical scrolling poster collage (from top to bottom)
const MoviePosterCollage = ({ columns }) => {
  const { col1, col2, col3 } = columns || {
    col1: FALLBACK_COLUMN_1,
    col2: FALLBACK_COLUMN_2,
    col3: FALLBACK_COLUMN_3,
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-black select-none pointer-events-none flex items-start justify-center">
      {/* Edge gradient overlays for seamless blending into form & edges */}
      <div className="hidden md:block absolute inset-y-0 left-0 w-24 lg:w-48 xl:w-60 bg-gradient-to-r from-black via-black/85 to-transparent z-10" />
      <div className="absolute inset-x-0 top-0 h-24 lg:h-36 xl:h-44 bg-gradient-to-b from-black to-transparent z-10" />
      <div className="absolute inset-x-0 bottom-0 h-24 lg:h-36 xl:h-44 bg-gradient-to-t from-black to-transparent z-10" />
      <div className="hidden lg:block absolute inset-y-0 right-0 w-20 xl:w-32 bg-gradient-to-l from-black/70 to-transparent z-10" />

      {/* Angled and scaled collage container anchored at top */}
      <div className="transform -rotate-12 origin-top scale-105 xs:scale-110 sm:scale-125 lg:scale-100 xl:scale-105 2xl:scale-115 flex gap-3.5 sm:gap-4 lg:gap-5 xl:gap-6 -mt-6 lg:-mt-10">
        {/* Column 1: Smooth continuous vertical scroll */}
        <div className="flex flex-col gap-4 lg:gap-5 xl:gap-6 poster-scroll-col-1">
          {[...col1, ...col1, ...col1, ...col1].map((poster, idx) => (
            <PosterCard key={`c1-${idx}`} title={poster.title} img={poster.img} />
          ))}
        </div>

        {/* Column 2: Smooth continuous vertical scroll */}
        <div className="flex flex-col gap-4 lg:gap-5 xl:gap-6 poster-scroll-col-2">
          {[...col2, ...col2, ...col2, ...col2].map((poster, idx) => (
            <PosterCard key={`c2-${idx}`} title={poster.title} img={poster.img} />
          ))}
        </div>

        {/* Column 3: Smooth continuous vertical scroll */}
        <div className="flex flex-col gap-4 lg:gap-5 xl:gap-6 poster-scroll-col-3">
          {[...col3, ...col3, ...col3, ...col3].map((poster, idx) => (
            <PosterCard key={`c3-${idx}`} title={poster.title} img={poster.img} />
          ))}
        </div>
      </div>
    </div>
  );
};

// Time-based dynamic greeting for Akram (Morning, Afternoon, Evening, Night)
export const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 12) return 'Good Morning, Akram 🌅';
  if (hour >= 12 && hour < 17) return 'Good Afternoon, Akram ☀️';
  if (hour >= 17 && hour < 21) return 'Good Evening, Akram 🌇';
  return 'Good Night, Akram 🌙';
};

const AuthModal = ({ isOpen, onClose, onOpenAdmin }) => {
  const [activeTab, setActiveTab] = useState('user'); // 'user' | 'admin'
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [animKey, setAnimKey] = useState(0);
  const [posterColumns, setPosterColumns] = useState(() => getRandomPosterColumns());
  const [greeting, setGreeting] = useState(() => getGreeting());

  // Update greeting every minute and whenever modal opens
  useEffect(() => {
    setGreeting(getGreeting());
    const interval = setInterval(() => {
      setGreeting(getGreeting());
    }, 60000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Restart poster animation from t=0 and randomize poster collection whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setAnimKey((prev) => prev + 1);
      setPosterColumns(getRandomPosterColumns());
    }
  }, [isOpen]);

  // Admin login credentials
  const [emailVal, setEmailVal] = useState('');
  const [passVal, setPassVal] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Refs for touch-scroll containment
  const overlayRef = useRef(null);
  const cardRef = useRef(null);

  // Lock document / body scrolling while modal is open, and restore original scroll position on close
  useEffect(() => {
    if (!isOpen) return;

    // Capture current scroll position across all browsers
    const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    // Save previous inline styles
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyOverflowY = document.body.style.overflowY;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyLeft = document.body.style.left;
    const prevBodyRight = document.body.style.right;
    const prevBodyWidth = document.body.style.width;
    const prevBodyPaddingRight = document.body.style.paddingRight;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevHtmlOverflowY = document.documentElement.style.overflowY;

    // Apply mobile-bulletproof scroll lock to both documentElement and body
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overflowY = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.overflowY = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      // Revert styles when modal closes or unmounts
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.overflowY = prevHtmlOverflowY;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.overflowY = prevBodyOverflowY;
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.left = prevBodyLeft;
      document.body.style.right = prevBodyRight;
      document.body.style.width = prevBodyWidth;
      document.body.style.paddingRight = prevBodyPaddingRight;

      // Restore exact scroll position
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  // Handle touch events on mobile: prevent accidental background scrolling when dragging outside the card
  useEffect(() => {
    if (!isOpen) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    const handleTouchMove = (e) => {
      // If the touch is outside the scrollable login card, prevent background scroll/overscroll
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      overlay.removeEventListener('touchmove', handleTouchMove);
    };
  }, [isOpen]);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Google OAuth flow for regular users
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      const redirectUri = 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
          ? window.location.origin
          : 'https://movieverify.vercel.app/';

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        if (
          error.message?.toLowerCase().includes('provider is not enabled') ||
          error.message?.toLowerCase().includes('unsupported provider')
        ) {
          setErrorMessage(
            'Google Sign-In is awaiting provider configuration in Supabase Dashboard. Use Admin Login if you are a staff member.'
          );
        } else {
          setErrorMessage(error.message || 'Google authentication failed. Please try again.');
        }
        setLoading(false);
      }
    } catch (err) {
      setErrorMessage(err?.message || 'An unexpected error occurred during Google sign in.');
      setLoading(false);
    }
  };

  // Direct Admin login within the modal
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    if (!emailVal.trim() || !passVal.trim()) {
      setErrorMessage('Please enter both admin email and password.');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      // 1. Sign in with admin credentials
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: emailVal.trim(),
        password: passVal.trim(),
      });

      if (authErr) {
        setErrorMessage(authErr.message || 'Invalid administrator credentials.');
        setLoading(false);
        return;
      }

      // 2. Strictly verify admin authorization against admin_users table
      if (authData?.user) {
        const { data: adminData, error: adminErr } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', authData.user.id)
          .maybeSingle();

        if (adminErr || !adminData) {
          setErrorMessage('You are not authorized to access the Admin Panel.');
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        // Successfully authenticated as an authorized administrator
        setLoading(false);
        onClose();
        if (onOpenAdmin) {
          onOpenAdmin();
        }
      }
    } catch (err) {
      setErrorMessage(err?.message || 'Server authentication error. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div 
      ref={overlayRef}
      className="fixed inset-0 w-full h-full h-[100dvh] min-h-[100dvh] z-[1000] flex items-center justify-start md:justify-center lg:items-stretch lg:justify-stretch p-0 md:p-4 lg:p-0 bg-black/90 md:bg-black/85 lg:bg-black backdrop-blur-md lg:backdrop-blur-none transition-opacity animate-in fade-in duration-200 overflow-hidden overscroll-none touch-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div 
        className="w-full h-full md:max-w-4xl md:h-[580px] md:max-h-[92vh] md:bg-[#0e0e0e] md:border md:border-white/10 md:rounded-3xl md:shadow-2xl lg:max-w-none lg:w-screen lg:h-screen lg:h-[100dvh] lg:max-h-none lg:bg-black lg:border-0 lg:rounded-none lg:shadow-none relative overflow-hidden flex flex-row items-center md:items-stretch lg:items-stretch justify-start md:justify-between text-white animate-in zoom-in-95 lg:zoom-in-100 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Desktop Atmospheric Cinematic Lighting Glows (1024px+ only) */}
        <div className="hidden lg:block absolute -top-32 -left-32 w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[140px] pointer-events-none z-10" />
        <div className="hidden lg:block absolute -bottom-24 left-10 w-[650px] h-[650px] bg-red-700/15 rounded-full blur-[160px] pointer-events-none z-10" />
        <div className="hidden lg:block absolute bottom-0 left-1/3 w-[700px] h-[350px] bg-red-900/12 rounded-full blur-[140px] pointer-events-none z-10" />

        {/* Vintage 35mm Film Decor (Bottom-Left Reel & Ribbon on desktop) */}
        <CinematicFilmDecor />

        {/* Desktop Top Header Bar (1024px+): Logo Left, Back to Browsing Right */}
        <header className="hidden lg:flex absolute top-0 left-0 right-0 z-30 px-10 xl:px-16 2xl:px-24 pt-7 pb-4 items-center justify-between pointer-events-auto">
          {/* Logo & Tagline */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-xl bg-[#E50914] flex items-center justify-center shadow-lg shadow-red-900/50 flex-shrink-0">
              <svg className="w-5 h-5 fill-white ml-0.5" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-xl xl:text-2xl font-black tracking-tight text-white leading-none">
                Movie<span className="text-white">Verify</span>
              </span>
              <span className="text-[9px] xl:text-[10px] font-bold tracking-[0.25em] text-gray-400 uppercase mt-1">
                SEARCH • VERIFY • DISCOVER
              </span>
            </div>
          </div>

          {/* Back to Browsing Button */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 px-4 py-2 xl:px-5 xl:py-2.5 rounded-full border border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/40 text-gray-200 hover:text-white transition duration-200 text-xs xl:text-sm font-semibold tracking-wide cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/30 backdrop-blur-sm shadow-lg group"
          >
            <span className="transition-transform group-hover:-translate-x-0.5 text-base leading-none">&larr;</span>
            <span>Back to browsing</span>
          </button>
        </header>

        {/* Tablet Close Button (768px - 1023px only) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="hidden md:flex lg:hidden absolute top-4 right-4 z-30 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 items-center justify-center text-gray-300 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white/30 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* AUTHENTICATION FORM CARD:
            On mobile (< 768px): floating translucent card on left with exposed right strip
            On tablet (768px - 1023px): left column in centered card (48% width)
            On desktop (1024px+): full-height borderless left area with cinematic typography
        */}
        <div 
          ref={cardRef}
          className="relative z-20 w-[calc(100%-3.75rem)] xs:w-[calc(100%-4.5rem)] sm:w-[calc(100%-5.5rem)] max-w-[340px] sm:max-w-[370px] ml-2 xs:ml-3 sm:ml-4 my-auto bg-[#0e0e0e]/95 backdrop-blur-xl border border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl p-4 xs:p-5 sm:p-6 md:p-8 md:w-[48%] md:max-w-none md:ml-0 md:my-0 md:h-full md:self-stretch md:border-0 md:rounded-none md:shadow-none md:bg-[#0e0e0e] lg:w-[48%] xl:w-[44%] 2xl:w-[42%] lg:max-w-[480px] xl:max-w-[520px] 2xl:max-w-[560px] lg:h-full lg:bg-transparent lg:border-0 lg:rounded-none lg:shadow-none lg:p-0 lg:pl-10 xl:pl-16 2xl:pl-24 lg:pr-6 lg:flex lg:flex-col lg:justify-center lg:items-start lg:my-0 lg:ml-0 lg:self-stretch lg:overflow-visible flex flex-col justify-between overflow-y-auto overscroll-contain touch-pan-y max-h-[92vh] max-h-[92dvh] md:max-h-none"
        >
          <div className="w-full">
            {/* Header: Logo and Mobile Close Button (Mobile / Tablet only) */}
            <div className="flex items-center justify-between mb-4 sm:mb-6 lg:hidden">
              <div className="flex items-center gap-2 sm:gap-2.5">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#E50914] flex items-center justify-center shadow-lg shadow-red-900/40 flex-shrink-0">
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white ml-0.5" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="text-base sm:text-lg font-black tracking-tight text-white leading-none">
                    Movie<span className="text-white">Verify</span>
                  </span>
                  <span className="text-[8px] sm:text-[9px] font-bold tracking-[0.2em] text-gray-400 uppercase mt-0.5">
                    SEARCH • VERIFY • DOWNLOAD
                  </span>
                </div>
              </div>

              {/* Mobile-only Close Button */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="md:hidden w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center text-gray-300 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white/30 cursor-pointer flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Heading */}
            {activeTab === 'admin' ? (
              <div className="mb-6 lg:mb-8 animate-in fade-in duration-200">
                <h2 id="auth-modal-title" className="text-2xl sm:text-3xl lg:text-4xl xl:text-[44px] 2xl:text-5xl font-black tracking-tight text-white mb-1.5 lg:mb-2.5 leading-[1.15]">
                  {greeting}
                </h2>
                <p className="text-xs sm:text-sm lg:text-base text-gray-400">
                  Sign in to MovieVerify Admin Control Panel
                </p>
              </div>
            ) : (
              <div className="mb-6 lg:mb-8 animate-in fade-in duration-200">
                <h2 id="auth-modal-title" className="text-2xl sm:text-3xl lg:text-4xl xl:text-[44px] 2xl:text-5xl font-black tracking-tight text-white mb-1.5 lg:mb-2.5 leading-[1.15]">
                  Sign in to <span className="text-[#E50914] relative inline-block">continue
                    {/* Subtle curved crimson glow arc matching reference image */}
                    <span className="hidden lg:block absolute -bottom-1 left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-[#E50914] to-transparent rounded-full shadow-[0_0_10px_#E50914]" />
                  </span>
                </h2>
                <p className="text-xs sm:text-sm lg:text-base text-gray-400">
                  Get access to <span className="lg:hidden">exclusive content</span><span className="hidden lg:inline">saved titles</span>, verified links and more.
                </p>
              </div>
            )}

            {/* Segmented Toggle: User Login / Admin Login */}
            <div className="bg-[#141414] border border-white/10 rounded-xl p-1 flex items-center gap-1.5 mb-5 lg:mb-6 max-w-sm lg:max-w-none w-full shadow-inner">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('user');
                  setErrorMessage('');
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 lg:py-3 px-3 rounded-lg text-xs lg:text-sm font-semibold transition-all duration-200 cursor-pointer focus:outline-none ${
                  activeTab === 'user'
                    ? 'bg-[#E50914] text-white shadow-lg shadow-red-900/40 font-bold'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <User className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                <span>User Login</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('admin');
                  setErrorMessage('');
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 lg:py-3 px-3 rounded-lg text-xs lg:text-sm font-semibold transition-all duration-200 cursor-pointer focus:outline-none ${
                  activeTab === 'admin'
                    ? 'bg-[#E50914] text-white shadow-lg shadow-red-900/40 font-bold'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                <span>Admin Login</span>
              </button>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="mb-4 p-3 bg-red-950/40 border border-red-800/60 rounded-xl flex items-start gap-2.5 text-red-200 text-xs leading-relaxed animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">{errorMessage}</div>
              </div>
            )}

            {/* VIEW A: USER LOGIN */}
            {activeTab === 'user' ? (
              <div className="space-y-4 lg:space-y-5 animate-in fade-in duration-150">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 active:bg-gray-200 text-[#3c4043] font-semibold text-sm lg:text-base py-3 lg:py-3.5 px-4 rounded-xl transition duration-150 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-60 cursor-pointer group"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 lg:w-5 lg:h-5 animate-spin text-gray-600" />
                      <span className="text-gray-700 text-xs lg:text-sm">Connecting to Google...</span>
                    </>
                  ) : (
                    <>
                      <GoogleIcon />
                      <span className="text-gray-800 font-semibold tracking-tight">Continue with Google</span>
                    </>
                  )}
                </button>

                {/* Divider */}
                <div className="relative flex items-center justify-center my-4 lg:my-6">
                  <div className="w-full border-t border-white/10" />
                  <span className="absolute bg-[#0e0e0e] lg:bg-black px-2.5 text-[10px] lg:text-xs font-semibold text-gray-500 uppercase tracking-widest">
                    OR
                  </span>
                </div>

                {/* Terms of Service notice */}
                <p className="text-[11px] lg:text-xs text-gray-400 text-center leading-relaxed">
                  By continuing, you agree to our{' '}
                  <a href="#" className="underline text-gray-300 hover:text-white transition">
                    Privacy Policy
                  </a>{' '}
                  and{' '}
                  <a href="#" className="underline text-gray-300 hover:text-white transition">
                    Terms of Service
                  </a>
                </p>
              </div>
            ) : (
              /* VIEW B: ADMIN LOGIN */
              <form onSubmit={handleAdminLogin} className="space-y-3.5 lg:space-y-4 animate-in fade-in duration-150">
                {/* Email / Mobile */}
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={emailVal}
                    onChange={(e) => setEmailVal(e.target.value)}
                    placeholder="Email address or mobile number"
                    className="w-full bg-[#161616] border border-white/10 rounded-xl py-3 lg:py-3.5 pl-10 pr-3 text-xs sm:text-sm lg:text-base text-white placeholder-gray-500 focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] outline-none transition"
                  />
                </div>

                {/* Password with eye toggle */}
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passVal}
                    onChange={(e) => setPassVal(e.target.value)}
                    placeholder="Password"
                    className="w-full bg-[#161616] border border-white/10 rounded-xl py-3 lg:py-3.5 pl-10 pr-10 text-xs sm:text-sm lg:text-base text-white placeholder-gray-500 focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition focus:outline-none"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Remember me & Forgot password */}
                <div className="flex items-center justify-between text-xs lg:text-sm pt-0.5">
                  <label className="flex items-center gap-2 text-gray-400 hover:text-gray-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded bg-black/60 border border-white/20 accent-[#E50914] w-3.5 h-3.5 cursor-pointer"
                    />
                    <span>Remember me</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setErrorMessage('Please contact system administrator to reset credentials.')}
                    className="text-gray-400 hover:text-white transition focus:outline-none cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>

                {/* Submit Sign In button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 lg:py-3.5 bg-[#E50914] hover:bg-[#b80710] active:bg-[#90050c] disabled:opacity-50 text-white font-bold rounded-xl text-sm lg:text-base transition shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-600/50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Verifying credentials...</span>
                    </>
                  ) : (
                    <span>Sign In</span>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Bottom dismiss option: Continue browsing without signing in */}
          <div className="mt-4 sm:mt-6 lg:mt-8 pt-3 sm:pt-4 border-t border-white/5 lg:border-t-0 text-center w-full">
            <div className="relative inline-block">
              <button
                type="button"
                onClick={onClose}
                className="text-[11px] sm:text-xs lg:text-sm text-gray-400 hover:text-white transition duration-150 py-1 sm:py-1.5 lg:py-2 px-2.5 sm:px-3 lg:px-4 rounded-lg hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-white/20 cursor-pointer font-medium inline-flex items-center gap-1.5"
              >
                <span>Continue browsing without signing in</span>
                <span className="text-[#E50914] font-bold">&rarr;</span>
              </button>
              {/* Subtle red accent line under the link on desktop matching reference */}
              <div className="hidden lg:block w-36 h-[1.5px] bg-gradient-to-r from-transparent via-[#E50914]/70 to-transparent mx-auto mt-0.5" />
            </div>
          </div>
        </div>

        {/* POSTER COLLAGE:
            On mobile: absolute inset-0 z-0 (spans full background of the modal, clearly visible on the right strip & surrounding the card)
            On tablet: relative w-[52%] h-[580px] z-0 (standard right column)
            On desktop (1024px+): full height right column (52% - 60% width)
        */}
        <div className="absolute inset-0 md:relative md:inset-auto md:w-[52%] md:h-[580px] lg:w-[52%] xl:w-[56%] 2xl:w-[58%] lg:h-full lg:self-stretch z-0 overflow-hidden bg-black flex items-start justify-center select-none pointer-events-none">
          <MoviePosterCollage key={`collage-${animKey}`} columns={posterColumns} />
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
