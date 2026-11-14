import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  Film,
  Play,
  Search,
  Sparkles,
  Flame,
  Clock,
  Star,
  CheckCircle2,
  Bell,
  ChevronRight,
  Filter,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { fetchUpcomingReleases } from '../hooks/useTMDB';
import UpcomingReleaseModal from './UpcomingReleaseModal';
import { useSubscriptions } from '../hooks/useSubscriptions';

export const RELEASE_CATEGORIES = [
  { id: 'all', label: 'All Categories', sub: 'Movies & Series', icon: '🌟' },
  { id: 'south_movie', label: 'South Movies', sub: 'Telugu, Tamil, etc.', icon: '🎬', color: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  { id: 'bollywood_movie', label: 'Bollywood Movies', sub: 'Hindi Cinema', icon: '🎬', color: 'text-orange-400 bg-orange-500/15 border-orange-500/30' },
  { id: 'hollywood_movie', label: 'Hollywood Movies', sub: 'English Cinema', icon: '🎬', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30' },
  { id: 'hindi_series', label: 'Hindi Web Series', sub: 'Indian OTT Series', icon: '📺', color: 'text-purple-400 bg-purple-500/15 border-purple-500/30' },
  { id: 'hollywood_series', label: 'Hollywood Web Series', sub: 'Global OTT Series', icon: '📺', color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' },
];

export default function TodayReleasesView({ onRequireAuth }) {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState('today'); // 'today' | 'week' | 'all'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRelease, setSelectedRelease] = useState(null);

  const { isMovieNotifying, toggleMovieNotify, isAuthenticated } = useSubscriptions();

  // Load upcoming releases across all categories
  const loadReleases = async () => {
    setLoading(true);
    try {
      const data = await fetchUpcomingReleases();
      setReleases(data || []);
    } catch (err) {
      console.warn('Failed to load upcoming releases for user view:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReleases();
  }, []);

  // Today's date in local calendar YYYY-MM-DD
  const todayStr = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  // Countdown helper
  const getReleaseCountdown = (dateStr) => {
    if (!dateStr) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const relDate = new Date(dateStr + 'T00:00:00');
    const diffDays = Math.ceil((relDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return { text: '🔥 Releases Today!', isToday: true, isUrgent: true };
    if (diffDays === 1) return { text: '⚡ Releases Tomorrow!', isToday: false, isUrgent: true };
    return { text: `In ${diffDays} days`, isToday: false, isUrgent: false };
  };

  // Filter releases by category, time horizon, and search
  const filteredReleases = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    return releases.filter((item) => {
      // 1. Category Filter
      if (categoryFilter !== 'all' && item.release_category !== categoryFilter) {
        return false;
      }

      // 2. Time Filter
      const itemDate = new Date(item.release_date + 'T00:00:00');
      const diffDays = Math.ceil((itemDate - today) / (1000 * 60 * 60 * 24));

      if (timeFilter === 'today') {
        // Match today, or releases from the last 2 days (weekend/Friday releases)
        if (diffDays > 0 && item.release_date !== todayStr) return false;
      } else if (timeFilter === 'week') {
        if (diffDays < 0 || diffDays > 7) return false;
      }

      // 3. Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const titleMatch = item.title?.toLowerCase().includes(q);
        const overviewMatch = item.overview?.toLowerCase().includes(q);
        const industryMatch = item.industry_name?.toLowerCase().includes(q);
        if (!titleMatch && !overviewMatch && !industryMatch) return false;
      }

      return true;
    });
  }, [releases, categoryFilter, timeFilter, searchQuery, todayStr]);

  // Counts for tabs
  const todayCount = useMemo(() => {
    return releases.filter((m) => {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const itemDate = new Date(m.release_date + 'T00:00:00');
      const diffDays = Math.ceil((itemDate - today) / (1000 * 60 * 60 * 24));
      return diffDays <= 0 || m.release_date === todayStr;
    }).length;
  }, [releases, todayStr]);

  const thisWeekCount = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return releases.filter((m) => {
      const itemDate = new Date(m.release_date + 'T00:00:00');
      const diffDays = Math.ceil((itemDate - today) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 7;
    }).length;
  }, [releases]);

  return (
    <div className="min-h-screen pt-24 pb-20 px-4 md:px-12 text-white">
      {/* Top Header Hero */}
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-white/10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-600/20 text-rose-400 border border-rose-500/30 text-xs font-bold tracking-wide uppercase">
                <Flame className="w-3.5 h-3.5 fill-rose-500 text-rose-500 animate-pulse" />
                Live Releases Radar
              </span>
              <span className="text-xs text-gray-400 font-mono">
                📅 {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Today's Releases & Upcoming Premieres
            </h1>
            <p className="text-xs sm:text-sm text-gray-400 max-w-2xl leading-relaxed">
              Track the biggest theatrical and OTT movie and web series premieres releasing today and this week across South Cinema, Bollywood, Hollywood, and Web Series. Watch official trailers instantly!
            </p>
          </div>

          <button
            type="button"
            onClick={loadReleases}
            disabled={loading}
            className="self-start md:self-auto px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-semibold flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Radar</span>
          </button>
        </div>

        {/* Time Horizon Pills & Keyword Search */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Time Horizon Switcher */}
          <div className="flex items-center gap-1.5 bg-[#141414] border border-white/10 rounded-2xl p-1 w-fit overflow-x-auto">
            <button
              type="button"
              onClick={() => setTimeFilter('today')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                timeFilter === 'today'
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Flame className="w-3.5 h-3.5 fill-current" />
              <span>Today's Releases ({todayCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setTimeFilter('week')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                timeFilter === 'week'
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>This Week ({thisWeekCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setTimeFilter('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                timeFilter === 'all'
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <span>All Upcoming ({releases.length})</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search release title, industry..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full md:w-64 bg-[#141414] border border-white/10 rounded-2xl pl-10 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition shadow-inner"
            />
          </div>
        </div>

        {/* Category Horizontal Filter Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {RELEASE_CATEGORIES.map((cat) => {
            const isActive = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-4 py-2 rounded-2xl text-xs font-bold transition flex items-center gap-2 shrink-0 border cursor-pointer ${
                  isActive
                    ? 'bg-white text-black border-white shadow-lg'
                    : 'bg-[#18181c] text-gray-300 hover:text-white hover:bg-white/10 border-white/10'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Releases Grid */}
        {loading ? (
          <div className="py-24 text-center space-y-3">
            <RefreshCw className="w-10 h-10 text-rose-500 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-gray-400">Loading live cinema & OTT radar...</p>
          </div>
        ) : filteredReleases.length === 0 ? (
          <div className="bg-[#141418] border border-white/10 rounded-3xl p-12 text-center space-y-4 max-w-xl mx-auto shadow-2xl my-8">
            <Film className="w-12 h-12 text-gray-600 mx-auto" />
            <h3 className="text-lg font-bold text-white">
              {timeFilter === 'today'
                ? "No Big Premieres Dropping Today in this Category"
                : "No Releases Found Matching Your Filter"}
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              {timeFilter === 'today'
                ? "Check out upcoming titles dropping this week or browse the complete 90-day upcoming radar."
                : "Try clearing your search query or selecting a different release category."}
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              {timeFilter === 'today' && (
                <button
                  type="button"
                  onClick={() => setTimeFilter('week')}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg cursor-pointer"
                >
                  View This Week's Releases
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setTimeFilter('all');
                  setCategoryFilter('all');
                  setSearchQuery('');
                }}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold border border-white/10 transition cursor-pointer"
              >
                View All Upcoming Radar
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredReleases.map((item) => {
              const countdown = getReleaseCountdown(item.release_date);
              const isTv = item.media_type === 'tv' || item.release_category?.includes('series');
              const catConfig = RELEASE_CATEGORIES.find((c) => c.id === item.release_category);

              const imageUrl =
                (item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null) ||
                item.backdrop ||
                (item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null) ||
                item.poster;

              return (
                <div
                  key={`${item.media_type || 'movie'}_${item.id}`}
                  onClick={() => setSelectedRelease(item)}
                  className="group relative bg-[#16161b] rounded-2xl overflow-hidden border border-white/10 hover:border-white/30 transition-all duration-300 flex flex-col justify-between shadow-xl hover:-translate-y-1.5 cursor-pointer"
                >
                  <div>
                    {/* Media Image / Backdrop */}
                    <div className="relative aspect-video bg-black/60 overflow-hidden">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 bg-gradient-to-br from-white/10 to-white/0 p-4 text-center">
                          <Film className="w-8 h-8 mb-1 text-rose-500 opacity-50" />
                          <span className="text-xs font-bold text-gray-300 line-clamp-1">{item.title}</span>
                          <span className="text-[10px] text-gray-500 uppercase">{item.industry_name || 'Release'}</span>
                        </div>
                      )}

                      {/* Scrim */}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#16161b] via-[#16161b]/30 to-transparent pointer-events-none" />

                      {/* Top Badges */}
                      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1 flex-wrap pointer-events-none">
                        <div className="flex items-center gap-1">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-md border ${
                              catConfig?.color || 'text-gray-300 bg-white/10 border-white/20'
                            }`}
                          >
                            {catConfig ? catConfig.label : item.industry_name || 'Release'}
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-md bg-black/60 text-gray-300 border border-white/10">
                            {isTv ? '📺 Series' : '🎬 Movie'}
                          </span>
                        </div>

                        {countdown && (
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full backdrop-blur-md shadow-md ${
                              countdown.isToday
                                ? 'bg-rose-600 text-white animate-pulse'
                                : countdown.isUrgent
                                ? 'bg-amber-500 text-black font-extrabold'
                                : 'bg-black/70 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {countdown.text}
                          </span>
                        )}
                      </div>

                      {/* Play Trailer Floating Overlay on Hover */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
                        <span className="px-3.5 py-1.5 rounded-full bg-rose-600/90 text-white text-xs font-bold backdrop-blur-md flex items-center gap-1.5 shadow-2xl scale-95 group-hover:scale-100 transition-transform">
                          <Play className="w-3.5 h-3.5 fill-white text-white" />
                          <span>Watch Trailer</span>
                        </span>
                      </div>

                      {/* Release Date & Rating Strip */}
                      <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-white text-[11px] font-medium pointer-events-none">
                        <span className="flex items-center gap-1 font-mono text-amber-300 font-semibold">
                          <Calendar className="w-3 h-3 text-amber-400" />
                          {item.release_date}
                        </span>
                        {item.vote_average > 0 && (
                          <span className="text-amber-400 font-bold flex items-center gap-0.5">
                            ★ {Number(item.vote_average).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Content Details */}
                    <div className="p-4 space-y-2">
                      <h4 className="text-white font-bold text-sm leading-snug line-clamp-1 group-hover:text-rose-400 transition">
                        {item.title}
                      </h4>
                      <p className="text-gray-400 text-xs line-clamp-2 leading-relaxed">
                        {item.overview || `Upcoming ${catConfig ? catConfig.label : 'entertainment'} premiere.`}
                      </p>
                    </div>
                  </div>

                  {/* Card Bottom CTA */}
                  <div className="p-4 pt-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRelease(item);
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-white/[0.06] hover:bg-rose-600 text-gray-200 hover:text-white text-xs font-bold border border-white/10 hover:border-rose-500 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Watch Trailer & Details</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* In-Modal Trailer & Release Details Player */}
      <UpcomingReleaseModal
        item={selectedRelease}
        isOpen={Boolean(selectedRelease)}
        onClose={() => setSelectedRelease(null)}
      />
    </div>
  );
}
