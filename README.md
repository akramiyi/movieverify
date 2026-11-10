<div align="center">

# 🎬 MovieVerify

**A Netflix-inspired movie & TV discovery platform with a secure admin panel, Telegram bot control and PWA support.**

[![Live Demo](https://img.shields.io/badge/Live-movieverify.vercel.app-E50914?style=for-the-badge)](https://movieverify.vercel.app)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![TMDB](https://img.shields.io/badge/Data-TMDB%20API-01B4E4?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-Installable-5A0FC8?style=flat-square)

</div>

---

## Table of Contents

- [About](#about)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Screenshots](#screenshots)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Project Structure](#project-structure)
- [Deployment](#deployment)
- [Security Notes](#security-notes)
- [Roadmap](#roadmap)
- [Disclaimer](#disclaimer)
- [Acknowledgements](#acknowledgements)
- [Author](#author)

---

## About

MovieVerify is a full-stack movie and TV discovery app. Metadata (posters, ratings, cast, trailers) comes live from **TMDB**, while **Supabase** powers the admin-managed content layer, user reviews, reports and site settings. A separate **Node.js service** runs a Telegram bot and a payment API.

It started as a UI exercise and grew into a complete product with authentication, row-level security, real-time admin tooling, an installable PWA and bot-based administration.

---

## Features

### For visitors

- **Netflix-style interface** with a rotating hero carousel and auto-scrolling content rows (touch/drag scrolling supported on mobile)
- **Smart search** with instant suggestions and filters (genre, language, rating, sort order)
- **Genre pages** with "Load more" pagination
- **Actors & actresses browsing**: profile cards resolved via TMDB person search, with full filmography per person
- **Movie details modal**: cast, runtime, trailer, similar titles, TV seasons and episodes
- **My List** and **Continue Browsing** (stored locally in the browser)
- **Reviews & ratings** with basic content moderation
- **Report a problem** on any title, plus **share** via WhatsApp / copy link / native share sheet
- **Download history** and **"Notify me"** for titles without links yet
- **Latest releases row** that rotates a weekly pick across Bollywood, South Indian and Hollywood titles
- **Cinematic intro animation**, shown once per session
- **Installable PWA** with a custom install prompt
- **Support section** (₹5 / ₹10 / ₹50 / custom) using Razorpay in **test mode**

### For the admin

- **Secure admin panel**: Supabase Auth plus an `admin_users` allow-list check
- **Content manager**: search TMDB, attach links per quality, edit or delete entries, with multi-season / multi-episode support for TV
- **Dashboard & analytics**: totals, missing-quality counters, most reviewed titles, recent activity
- **Reports inbox** with a notification badge, mark-as-resolved and delete
- **Site lock**: toggle a password gate over the entire site from the panel, no redeploy needed
- **Telegram bot control**: manage entries and search from chat (admin-ID protected)

### Engineering highlights

- Server-verified payment flow (HMAC signature check); the secret never reaches the browser
- Row Level Security on every Supabase table, with separate public and admin policies
- Defensive data handling throughout (missing genres, non-numeric ratings, failed lookups)
- Service worker limited to same-origin requests, so API calls are never intercepted
- Batched TMDB metadata requests to stay under rate limits
- Session and in-memory caching of TMDB responses
- Image fallback chain: poster → backdrop → placeholder
- Dynamic Open Graph previews for shared movie and TV links (via `vercel.json`)

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 8, React Router 7 |
| Styling & motion | Tailwind CSS 3, Framer Motion, Lucide icons |
| Data | TMDB API (metadata), Supabase / PostgreSQL (app data) |
| Auth | Supabase Auth |
| Backend service | Node.js, Express, `node-telegram-bot-api`, Razorpay SDK |
| Hosting | Vercel (frontend), Render (backend service) |
| Tooling | oxlint, PostCSS, Autoprefixer |

---

## Architecture

```
                    ┌──────────────────────────┐
                    │         Browser          │
                    │   React + Vite (PWA)     │
                    └───────┬─────────┬────────┘
                            │         │
            metadata        │         │  app data / auth
                            ▼         ▼
                  ┌──────────────┐  ┌─────────────────────┐
                  │   TMDB API   │  │  Supabase (Postgres)│
                  └──────────────┘  │  Auth · RLS · Tables│
                                    └──────────▲──────────┘
                                               │ service role
                            payments           │
         ┌─────────────────────────────────────┴────────┐
         │   Render Web Service  (telegram-bot/)        │
         │   Express API  +  Telegram Bot  +  Razorpay  │
         └──────────────────────────────────────────────┘
```

---

## Screenshots

> Add your screenshots to `docs/screenshots/` and update the paths below.

| Home | Movie Details |
| --- | --- |
| ![Home](docs/screenshots/home.png) | ![Details](docs/screenshots/details.png) |

| Actors | Admin Panel |
| --- | --- |
| ![Actors](docs/screenshots/actors.png) | ![Admin](docs/screenshots/admin.png) |

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [TMDB](https://www.themoviedb.org/settings/api) account (v4 read access token)
- A [Supabase](https://supabase.com) project

### Installation

```bash
# 1. Clone
git clone https://github.com/akramiyi/movieverify.git
cd movieverify

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env     # then fill in the values below

# 4. Start the dev server
npm run dev
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run oxlint |

### Backend service (optional)

The Telegram bot and payment API live in `telegram-bot/`:

```bash
cd telegram-bot
npm install
node index.js
```

> Run **only one** instance of the bot at a time, otherwise Telegram returns `409 Conflict`.

---

## Environment Variables

### Frontend (`.env`)

| Variable | Description |
| --- | --- |
| `VITE_TMDB_TOKEN` | TMDB v4 read access token |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `VITE_API_URL` | Base URL of the backend service |

### Backend (`telegram-bot/.env`)

| Variable | Description |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |
| `TELEGRAM_ADMIN_IDS` | Comma-separated Telegram user IDs allowed to administer |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (**server only**) |
| `TMDB_TOKEN` | TMDB read access token |
| `RAZORPAY_KEY_ID` | Razorpay key ID (test or live) |
| `RAZORPAY_KEY_SECRET` | Razorpay secret (**server only**) |
| `FRONTEND_URL` | Allowed CORS origin, e.g. `https://movieverify.vercel.app` |

> ⚠️ Never commit `.env` files. Anything prefixed with `VITE_` is bundled into the browser, so never put secrets there.

---

## Database Setup

Create the following tables in Supabase and enable Row Level Security on each:

| Table | Purpose | Public access |
| --- | --- | --- |
| `download_links` | Admin-managed entries (per-quality URLs, TV `seasons` as JSONB) | Read |
| `movie_reviews` | User reviews and ratings | Read, insert |
| `movie_reports` | "Report a problem" submissions | Insert only |
| `site_settings` | Single-row site lock configuration | Read |
| `admin_users` | Allow-list of admin user IDs | None |

Write access (update / delete) is restricted to authenticated admins through RLS policies.

> Tables created through the SQL editor also need explicit grants, otherwise requests fail with `403`:
>
> ```sql
> GRANT SELECT, INSERT ON movie_reviews TO anon, authenticated;
> GRANT DELETE ON movie_reviews TO authenticated;
> ```

---

## Project Structure

```
movieverify/
├── public/                 # manifest.json, sw.js, icons
├── src/
│   ├── components/         # UI: rows, cards, modals, admin panel, ...
│   ├── hooks/              # useTMDB, useActorSearch, useRecentlyViewed, ...
│   ├── pages/              # Genre and actor listing pages
│   ├── data/               # Supabase client, static data
│   ├── App.jsx
│   └── main.jsx
├── telegram-bot/           # Express API + Telegram bot + Razorpay
├── vercel.json             # Routing and Open Graph previews
├── tailwind.config.js
└── vite.config.js
```

---

## Deployment

| Part | Platform | Notes |
| --- | --- | --- |
| Frontend | **Vercel** | Add the `VITE_*` variables, then redeploy (they are inlined at build time) |
| Backend | **Render** (Web Service) | Root directory `telegram-bot`, build `npm install`, start `node index.js` |

Health check: `GET /health` → `{ "status": "ok" }`

---

## Security Notes

- Admin access requires both a valid Supabase session **and** a row in `admin_users`.
- Payment success is trusted only after **server-side signature verification**.
- The site lock is a **soft gate**: its key is stored in a publicly readable row. Treat it as a "keep casual visitors out" feature, not as real access control.
- Keep the Supabase **service role key** and Razorpay **secret** on the server only.

---

## Roadmap

- [ ] Server-side TMDB proxy with CDN caching (hide the token, share cache across users)
- [ ] Hash-based, server-verified site lock
- [ ] Email / push notifications for the "Notify me" list
- [ ] Multi-admin management UI
- [ ] Automated tests and CI

---

## Disclaimer

MovieVerify does **not** host, store or stream any media files. Titles, images and metadata are provided by TMDB. Any external links are entered manually by the site administrator, and the administrator is solely responsible for ensuring they have the right to distribute that content. This repository is intended for educational and portfolio purposes.

---

## Acknowledgements

- [TMDB](https://www.themoviedb.org/): *This product uses the TMDB API but is not endorsed or certified by TMDB.*
- [Supabase](https://supabase.com), [Vercel](https://vercel.com), [Render](https://render.com), [Razorpay](https://razorpay.com)
- [Framer Motion](https://www.framer.com/motion/), [Lucide](https://lucide.dev), [Tailwind CSS](https://tailwindcss.com)

---

## Author

**Akram**
B.Tech Computer Science, Brainware University

[![GitHub](https://img.shields.io/badge/GitHub-akramiyi-181717?style=flat-square&logo=github)](https://github.com/akramiyi)

If you like this project, consider giving it a ⭐
