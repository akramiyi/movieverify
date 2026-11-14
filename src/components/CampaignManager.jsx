import React, { useState, useEffect, useMemo } from 'react';
import {
  Send,
  Calendar,
  Users,
  Film,
  User,
  Layers,
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  Clock,
  Trash2,
  RefreshCw,
  Eye,
  Zap,
  Loader2,
  Sparkles,
  Bell,
  Search,
  X,
  ChevronRight,
  Tag,
  ArrowUpRight,
  ListFilter,
  Play,
} from 'lucide-react';
import { supabase } from '../data/supabaseClient';
import { fetchUpcomingReleases, fetchUpcomingIndianMovies } from '../hooks/useTMDB';
import UpcomingReleaseModal from './UpcomingReleaseModal';

export const isCampaignCompleted = (c) => {
  if (!c) return false;
  if (c.status === 'completed') return true;
  const sent = c.sent_count ?? c.sent_deliveries ?? 0;
  const total = c.total_recipients ?? c.total_deliveries ?? 0;
  return sent > 0 && total > 0 && sent >= total;
};

export const isCampaignQueued = (c) => {
  if (!c) return false;
  if (isCampaignCompleted(c)) return false;
  return c.status === 'scheduled' || c.status === 'queued' || c.status === 'processing';
};

export const RELEASE_CATEGORIES = [
  { id: 'all', label: 'All Releases', sub: 'Movies & Series', icon: '🌟' },
  { id: 'south_movie', label: 'South Movies', sub: 'Telugu, Tamil, etc.', icon: '🎬', color: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  { id: 'bollywood_movie', label: 'Bollywood Movies', sub: 'Hindi Cinema', icon: '🎬', color: 'text-orange-400 bg-orange-500/15 border-orange-500/30' },
  { id: 'hollywood_movie', label: 'Hollywood Movies', sub: 'English Cinema', icon: '🎬', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30' },
  { id: 'hindi_series', label: 'Hindi Web Series', sub: 'Indian OTT Series', icon: '📺', color: 'text-purple-400 bg-purple-500/15 border-purple-500/30' },
  { id: 'hollywood_series', label: 'Hollywood Web Series', sub: 'Global OTT Series', icon: '📺', color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' },
];

export const INDIAN_LANGUAGES = [
  { code: 'all', label: 'All South & Bollywood', sub: 'Te, Ta, Ml, Kn, Hi' },
  { code: 'te', label: 'Telugu', sub: 'Tollywood', color: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  { code: 'ta', label: 'Tamil', sub: 'Kollywood', color: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30' },
  { code: 'ml', label: 'Malayalam', sub: 'Mollywood', color: 'text-purple-400 bg-purple-500/15 border-purple-500/30' },
  { code: 'kn', label: 'Kannada', sub: 'Sandalwood', color: 'text-rose-400 bg-rose-500/15 border-rose-500/30' },
  { code: 'hi', label: 'Hindi', sub: 'Bollywood', color: 'text-orange-400 bg-orange-500/15 border-orange-500/30' },
];

const TARGET_TYPES = [
  { value: 'all', label: 'All Subscribers', icon: Users, desc: 'Send to all opted-in subscribers and active devices' },
  { value: 'movie', label: 'Movie Subscribers', icon: Film, desc: 'Target users subscribed to a specific TMDB movie' },
  { value: 'series', label: 'Series Subscribers', icon: Film, desc: 'Target users subscribed to a TV series' },
  { value: 'season', label: 'Season Subscribers', icon: Layers, desc: 'Target TV season & series followers' },
  { value: 'actor', label: 'Actor Fans', icon: User, desc: 'Target users subscribed to a specific actor' },
  { value: 'genre', label: 'Genre Enthusiasts', icon: Layers, desc: 'Target users interested in a specific genre' },
];

const CATEGORIES = [
  { value: 'movie_release', label: 'Movie Release', icon: Film, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { value: 'content_update', label: 'Content Update', icon: RefreshCw, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  { value: 'user_alert', label: 'User Alert', icon: AlertCircle, color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' },
  { value: 'admin_announcement', label: 'Announcement', icon: Bell, color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  { value: 'promotional', label: 'Promotional', icon: Sparkles, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
];

export default function CampaignManager({ initialView = 'form' }) {
  const [activeView, setActiveView] = useState(initialView || 'form');
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState({ type: '', message: '' });
  const [isDispatching, setIsDispatching] = useState(false);

  // Form State
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('movie_release');
  const [targetType, setTargetType] = useState('all');
  const [targetId, setTargetId] = useState('');
  const [seasonNumber, setSeasonNumber] = useState('');
  const [url, setUrl] = useState('/');
  const [imageUrl, setImageUrl] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLaunchSuccess, setIsLaunchSuccess] = useState(false);
  const [successInfo, setSuccessInfo] = useState(null);

  // Queue & Category Tracker State
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState('all'); // 'all' | 'today' | 'tomorrow' | 'upcoming' | 'custom'
  const [customDate, setCustomDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'queue' | 'sent'
  const [trackerSearch, setTrackerSearch] = useState('');

  // Upcoming Movies & Series Scanner State
  const [upcomingMovies, setUpcomingMovies] = useState([]);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerCategoryFilter, setScannerCategoryFilter] = useState('all');
  const [scannerHorizonFilter, setScannerHorizonFilter] = useState('all');
  const [scannerSearch, setScannerSearch] = useState('');
  const [schedulingMovieId, setSchedulingMovieId] = useState(null);
  const [batchScheduling, setBatchScheduling] = useState(false);
  const [previewMovie, setPreviewMovie] = useState(null);

  // Sync view when initialView prop changes
  useEffect(() => {
    if (initialView) {
      setActiveView(initialView);
    }
  }, [initialView]);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setCampaigns(data || []);
    } catch (err) {
      console.warn('Failed to load campaigns:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setActionStatus({ type: 'error', message: 'Title and body are required.' });
      return;
    }

    setIsSubmitting(true);
    setActionStatus({ type: '', message: '' });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Admin session required.');
      }

      const target_criteria = { type: targetType };
      if (targetType === 'movie') target_criteria.movie_id = targetId;
      if (targetType === 'series') {
        target_criteria.series_id = targetId;
        target_criteria.movie_id = targetId;
        target_criteria.media_type = 'tv';
      }
      if (targetType === 'season') {
        target_criteria.series_id = targetId;
        target_criteria.movie_id = targetId;
        target_criteria.media_type = 'tv';
        target_criteria.season_number = parseInt(seasonNumber, 10) || 1;
      }
      if (targetType === 'actor') target_criteria.actor_id = targetId;
      if (targetType === 'genre') target_criteria.genre_id = targetId;

      const payload = {
        title: title.trim(),
        body: body.trim(),
        category,
        url: url.trim() || '/',
        image_url: imageUrl.trim() || (category === 'movie_release' ? 'https://movieverify.vercel.app/og-fallback.jpg' : null),
        target_criteria,
        is_draft: isDraft,
        scheduled_for: isScheduled && scheduledFor ? new Date(scheduledFor).toISOString() : null,
        idempotency_key: `camp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      };

      const res = await fetch('/api/notifications/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();

      if (!res.ok) {
        throw new Error(resData.message || resData.error || 'Failed to create campaign');
      }

      const pushCount = resData.push_deliveries ?? resData.total_deliveries ?? 0;
      const inAppCount = resData.in_app_deliveries ?? 0;
      const suppressedCount = resData.suppressed_daily_cap ?? 0;
      const immediateSent = resData.immediate_dispatch?.sent;

      let msg = `Campaign created! (ID: ${resData.campaign_id?.substring(0, 8)}...)`;
      if (resData.status === 'scheduled') {
        const schedTime = resData.scheduled_for || scheduledFor;
        msg = `📅 Campaign scheduled for ${new Date(schedTime).toLocaleString()}! It will dispatch automatically when due, or you can click "Dispatch Now" in Schedule Queue.`;
      } else if (resData.status === 'draft') {
        msg = `📝 Campaign saved as draft.`;
      } else {
        if (pushCount > 0) {
          msg += ` • ${pushCount} push alert(s) queued${immediateSent !== undefined ? ` (${immediateSent} sent instantly)` : ''}.`;
        } else {
          msg += ` • 0 push alerts queued.`;
        }
        if (inAppCount > 0) {
          msg += ` • ${inAppCount} inbox alert(s).`;
        }
        if (suppressedCount > 0) {
          msg += ` ⚠️ ${suppressedCount} device(s) reached daily limit (50/day). Increase limit in Preferences to receive more.`;
        }
        if (pushCount === 0 && suppressedCount === 0) {
          msg += ` ⚠️ No active push devices found for this target. Verify push is enabled in browser.`;
        }
      }

      setActionStatus({
        type: 'success',
        message: msg,
      });

      setIsLaunchSuccess(true);
      setSuccessInfo({
        status: resData.status,
        pushCount,
        immediateSent,
        inAppCount,
        suppressedCount,
        message: msg,
      });

      // Keep success tick for 4.5 seconds
      setTimeout(() => {
        setIsLaunchSuccess(false);
      }, 4500);

      // Auto-hide success info card after 10 seconds
      setTimeout(() => {
        setSuccessInfo(null);
      }, 10000);

      // Reset Form
      setTitle('');
      setBody('');
      setTargetId('');
      setSeasonNumber('');
      setIsScheduled(false);
      setScheduledFor('');
      fetchCampaigns();
    } catch (err) {
      setIsLaunchSuccess(false);
      setSuccessInfo(null);
      setActionStatus({ type: 'error', message: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTriggerDispatch = async () => {
    setIsDispatching(true);
    setActionStatus({ type: '', message: '' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Admin session required.');
      }

      const res = await fetch('/api/notifications/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'dispatch_due' }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to dispatch due campaigns');
      }

      const sentCount = data.sent ?? data.dispatch_summary?.sent ?? 0;
      const promotedCount = data.promoted_campaigns ?? data.promotion_summary?.promoted_count ?? 0;
      setActionStatus({
        type: 'success',
        message: `Dispatch Cycle complete! ${promotedCount} scheduled campaign(s) promoted, ${sentCount} push delivery attempt(s) executed.`,
      });
      fetchCampaigns();
    } catch (err) {
      setActionStatus({ type: 'error', message: err.message });
    } finally {
      setIsDispatching(false);
    }
  };

  const handleDispatchSpecificCampaign = async (campaignId) => {
    if (!confirm('Are you sure you want to dispatch this campaign right now to active user devices?')) {
      return;
    }

    setIsDispatching(true);
    setActionStatus({ type: '', message: '' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Admin session required.');

      // Advance scheduled_for to right now so it qualifies as due immediately
      try {
        await supabase
          .from('notification_campaigns')
          .update({ scheduled_for: new Date().toISOString() })
          .eq('id', campaignId);
      } catch (updErr) {
        console.warn('Direct scheduled_for update warning:', updErr.message);
      }

      const res = await fetch('/api/notifications/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'dispatch_due', campaign_id: campaignId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Failed to dispatch');

      const sentCount = data.sent ?? data.dispatch_summary?.sent ?? 0;
      setActionStatus({
        type: 'success',
        message: `Campaign dispatched! ${sentCount} push alert(s) dispatched to active devices.`,
      });
      fetchCampaigns();
    } catch (err) {
      setActionStatus({ type: 'error', message: err.message });
    } finally {
      setIsDispatching(false);
    }
  };

  const handleCancelCampaign = async (campaignId) => {
    if (!confirm('Are you sure you want to cancel this campaign? Pending deliveries will be halted.')) {
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`/api/notifications/campaigns?id=${campaignId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);

      setActionStatus({
        type: 'success',
        message: `Campaign cancelled. ${data.cancelled_deliveries || 0} pending deliveries stopped.`,
      });
      fetchCampaigns();
    } catch (err) {
      setActionStatus({ type: 'error', message: err.message });
    }
  };

  // Auto-Scanner: Load upcoming South, Bollywood, Hollywood movies & Web Series
  const loadUpcomingMovies = async () => {
    setScannerLoading(true);
    try {
      const movies = await fetchUpcomingReleases();
      setUpcomingMovies(movies || []);
    } catch (err) {
      console.warn('Failed to load upcoming movies:', err.message);
    } finally {
      setScannerLoading(false);
    }
  };

  useEffect(() => {
    if (activeView === 'scanner' && upcomingMovies.length === 0) {
      loadUpcomingMovies();
    }
  }, [activeView]);

  const handleAutoScheduleMovie = async (item) => {
    if (!item) return;
    setSchedulingMovieId(item.id);
    setActionStatus({ type: '', message: '' });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Admin session required.');

      const releaseDate = item.release_date || new Date().toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];
      const isTodayOrPast = releaseDate <= todayStr;

      let scheduledForIso = null;
      if (!isTodayOrPast) {
        const scheduleDate = new Date(`${releaseDate}T09:00:00`);
        scheduledForIso = Number.isNaN(scheduleDate.getTime()) ? null : scheduleDate.toISOString();
      }

      const isTv = item.media_type === 'tv' || item.release_category?.includes('series');
      const catInfo = RELEASE_CATEGORIES.find((c) => c.id === item.release_category);
      const catLabel = catInfo ? catInfo.label : (isTv ? 'Web Series' : 'Movie');
      const titleEmoji = isTv ? '📺' : '🎬';
      const actionText = isTv ? 'Streaming' : 'Releasing';
      const alertHeader = isTv ? 'New Web Series Alert' : 'Big Screen Alert';

      const campaignPayload = {
        title: `${titleEmoji} ${item.title} - ${actionText} ${isTodayOrPast ? 'Today!' : 'Soon'}`,
        body: `${alertHeader}: ${item.title} (${catLabel}) is scheduled for ${isTv ? 'streaming' : 'theatrical release'} on ${releaseDate}. Add it to your watchlist now to verify and watch instantly!`,
        category: isTv ? 'content_update' : 'movie_release',
        target_criteria: {
          type: 'all',
          movie_id: String(item.id),
          series_id: String(item.id),
          tmdb_id: String(item.id),
        },
        url: `/?type=${isTv ? 'tv' : 'movie'}&id=${item.id}`,
        image_url:
          item.backdrop ||
          (item.backdrop_path ? `https://image.tmdb.org/t/p/w780${String(item.backdrop_path).startsWith('/') ? '' : '/'}${item.backdrop_path}` : null) ||
          item.poster ||
          (item.poster_path ? `https://image.tmdb.org/t/p/w500${String(item.poster_path).startsWith('/') ? '' : '/'}${item.poster_path}` : null) ||
          'https://movieverify.vercel.app/og-fallback.jpg',
        scheduled_for: scheduledForIso,
        is_draft: false,
      };

      const res = await fetch('/api/notifications/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(campaignPayload),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.message || resData.error || 'Failed to auto-schedule campaign');
      }

      setActionStatus({
        type: 'success',
        message: `Auto-scheduled "${item.title}" ${isTv ? 'web series' : 'movie'} alert for ${releaseDate}!`,
      });
      fetchCampaigns();
    } catch (err) {
      setActionStatus({ type: 'error', message: err.message });
    } finally {
      setSchedulingMovieId(null);
    }
  };

  const handleCustomizeCampaignFromRelease = (item) => {
    if (!item) return;
    const isTv = item.media_type === 'tv' || item.release_category?.includes('series');
    const catInfo = RELEASE_CATEGORIES.find((c) => c.id === item.release_category);
    const catLabel = catInfo ? catInfo.label : (isTv ? 'Web Series' : 'Movie');

    const moviePhoto =
      item.backdrop ||
      (item.backdrop_path ? `https://image.tmdb.org/t/p/w780${String(item.backdrop_path).startsWith('/') ? '' : '/'}${item.backdrop_path}` : '') ||
      item.poster ||
      (item.poster_path ? `https://image.tmdb.org/t/p/w500${String(item.poster_path).startsWith('/') ? '' : '/'}${item.poster_path}` : '') ||
      'https://movieverify.vercel.app/og-fallback.jpg';

    setTitle(`🎬 ${item.title} Release Alert!`);
    setBody(
      `Don't miss the upcoming ${catLabel} premiere of ${item.title} on ${item.release_date}. Get ready to watch and verify links now!`
    );
    setCategory(isTv ? 'content_update' : 'movie_release');
    setUrl(`/?type=${isTv ? 'tv' : 'movie'}&id=${item.id}`);
    setImageUrl(moviePhoto);
    setTargetType(isTv ? 'series' : 'movie');
    setTargetId(String(item.id));
    setIsDraft(false);
    setIsScheduled(true);

    const scheduleDate = new Date(`${item.release_date}T09:00:00`);
    if (!Number.isNaN(scheduleDate.getTime()) && scheduleDate > new Date()) {
      const localIso = new Date(scheduleDate.getTime() - scheduleDate.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setScheduledFor(localIso);
    } else {
      setScheduledFor('');
    }

    setPreviewMovie(null);
    setActiveView('form');
  };

  const handleBatchScheduleTop = async (count = 5) => {
    if (batchScheduling) return;
    setBatchScheduling(true);
    setActionStatus({ type: '', message: '' });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Admin session required.');

      const unscheduled = upcomingMovies.filter(
        (m) =>
          !campaigns.some(
            (c) =>
              c.target_criteria?.movie_id === String(m.id) ||
              c.target_criteria?.series_id === String(m.id) ||
              c.title?.toLowerCase().includes(m.title.toLowerCase())
          )
      );

      const targetList = unscheduled.slice(0, count);
      if (targetList.length === 0) {
        setActionStatus({ type: 'success', message: 'All upcoming releases in this view are already scheduled!' });
        setBatchScheduling(false);
        return;
      }

      let scheduledCount = 0;
      for (const item of targetList) {
        const releaseDate = item.release_date || new Date().toISOString().split('T')[0];
        const todayStr = new Date().toISOString().split('T')[0];
        const isTodayOrPast = releaseDate <= todayStr;
        let scheduledForIso = null;
        if (!isTodayOrPast) {
          const scheduleDate = new Date(`${releaseDate}T09:00:00`);
          scheduledForIso = Number.isNaN(scheduleDate.getTime()) ? null : scheduleDate.toISOString();
        }

        const isTv = item.media_type === 'tv' || item.release_category?.includes('series');
        const catInfo = RELEASE_CATEGORIES.find((c) => c.id === item.release_category);
        const catLabel = catInfo ? catInfo.label : (isTv ? 'Web Series' : 'Movie');
        const titleEmoji = isTv ? '📺' : '🎬';
        const actionText = isTv ? 'Streaming' : 'Releasing';
        const alertHeader = isTv ? 'New Web Series Alert' : 'Big Screen Alert';

        const campaignPayload = {
          title: `${titleEmoji} ${item.title} - ${actionText} ${isTodayOrPast ? 'Today!' : 'Soon'}`,
          body: `${alertHeader}: ${item.title} (${catLabel}) is scheduled for ${isTv ? 'streaming' : 'theatrical release'} on ${releaseDate}. Add it to your watchlist now to verify and watch instantly!`,
          category: isTv ? 'content_update' : 'movie_release',
          target_criteria: {
            type: 'all',
            movie_id: String(item.id),
            series_id: String(item.id),
            tmdb_id: String(item.id),
          },
          url: `/?type=${isTv ? 'tv' : 'movie'}&id=${item.id}`,
          image_url:
            item.backdrop ||
            (item.backdrop_path ? `https://image.tmdb.org/t/p/w780${String(item.backdrop_path).startsWith('/') ? '' : '/'}${item.backdrop_path}` : null) ||
            item.poster ||
            (item.poster_path ? `https://image.tmdb.org/t/p/w500${String(item.poster_path).startsWith('/') ? '' : '/'}${item.poster_path}` : null) ||
            'https://movieverify.vercel.app/og-fallback.jpg',
          scheduled_for: scheduledForIso,
          is_draft: false,
        };

        const res = await fetch('/api/notifications/campaigns', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(campaignPayload),
        });

        if (res.ok) {
          scheduledCount++;
        }
      }

      setActionStatus({
        type: 'success',
        message: `Batch schedule completed! ${scheduledCount} upcoming release notification(s) scheduled.`,
      });
      fetchCampaigns();
    } catch (err) {
      setActionStatus({ type: 'error', message: err.message });
    } finally {
      setBatchScheduling(false);
    }
  };

  // Helper date functions
  const isSameCalendarDay = (date1, date2) => {
    if (!date1 || !date2) return false;
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const formatScheduleTime = (isoString) => {
    if (!isoString) return 'Immediate';
    const date = new Date(isoString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isSameCalendarDay(date, today)) {
      return `Today at ${timeStr}`;
    }
    if (isSameCalendarDay(date, tomorrow)) {
      return `Tomorrow at ${timeStr}`;
    }
    return (
      date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
      ` at ${timeStr}`
    );
  };

  const getTimeRemainingText = (isoString) => {
    if (!isoString) return '';
    const target = new Date(isoString).getTime();
    const now = Date.now();
    const diffMs = target - now;

    if (diffMs <= 0) return '⚡ Due Now';
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours >= 24) {
      const days = Math.floor(diffHours / 24);
      return `Due in ${days}d ${diffHours % 24}h`;
    }
    if (diffHours > 0) {
      return `Due in ${diffHours}h ${diffMins}m`;
    }
    return `Due in ${diffMins}m`;
  };

  const getTargetLabel = (c) => {
    const criteria = c.target_criteria || {};
    const type = criteria.type || c.target_type || 'all';
    if (type === 'all') return 'All Subscribers';
    if (type === 'movie') return `Movie #${criteria.movie_id || criteria.tmdb_id || ''}`;
    if (type === 'series') return `Series #${criteria.series_id || criteria.tmdb_id || ''}`;
    if (type === 'season') return `Season #${criteria.season_number || ''}`;
    if (type === 'actor') return `Actor #${criteria.actor_id || ''}`;
    if (type === 'genre') return `Genre #${criteria.genre_id || ''}`;
    return type;
  };

  const getMovieReleaseCountdown = (releaseDateStr) => {
    if (!releaseDateStr) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const relDate = new Date(releaseDateStr + 'T00:00:00');
    const diffDays = Math.ceil((relDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return { text: 'Releases Today!', isUrgent: true };
    if (diffDays === 1) return { text: 'Releases Tomorrow!', isUrgent: true };
    return { text: `In ${diffDays} days`, isUrgent: false };
  };

  // Compute stats across categories and dates
  const stats = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const categoryMap = {
      all: { queue: 0, sent: 0, total: 0 },
      movie_release: { queue: 0, sent: 0, total: 0 },
      content_update: { queue: 0, sent: 0, total: 0 },
      user_alert: { queue: 0, sent: 0, total: 0 },
      admin_announcement: { queue: 0, sent: 0, total: 0 },
      promotional: { queue: 0, sent: 0, total: 0 },
    };

    let totalQueued = 0;
    let dueToday = 0;
    let dueTomorrow = 0;
    let totalSent = 0;

    campaigns.forEach((c) => {
      const isQueued = isCampaignQueued(c);
      const isSent = isCampaignCompleted(c);

      if (isQueued) {
        totalQueued += 1;
        const schedTime = c.scheduled_for ? new Date(c.scheduled_for) : null;
        if (schedTime) {
          if (isSameCalendarDay(schedTime, today)) dueToday += 1;
          if (isSameCalendarDay(schedTime, tomorrow)) dueTomorrow += 1;
        }
      }
      if (isSent) totalSent += 1;

      categoryMap.all.total += 1;
      if (isQueued) categoryMap.all.queue += 1;
      if (isSent) categoryMap.all.sent += 1;

      if (categoryMap[c.category]) {
        categoryMap[c.category].total += 1;
        if (isQueued) categoryMap[c.category].queue += 1;
        if (isSent) categoryMap[c.category].sent += 1;
      }
    });

    return {
      categoryMap,
      totalQueued,
      dueToday,
      dueTomorrow,
      totalSent,
    };
  }, [campaigns]);

  // Filtered campaigns for the Schedule Queue & Timeline view
  const filteredCampaigns = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return campaigns.filter((c) => {
      // 1. Category Filter
      if (categoryFilter !== 'all' && c.category !== categoryFilter) {
        return false;
      }

      // 2. Status Filter
      const isQueued = isCampaignQueued(c);
      const isSent = isCampaignCompleted(c);
      if (statusFilter === 'queue' && !isQueued) return false;
      if (statusFilter === 'sent' && !isSent) return false;

      // 3. Day / Date Filter
      const campaignDate = c.scheduled_for ? new Date(c.scheduled_for) : new Date(c.created_at);

      if (dayFilter === 'today') {
        if (!isSameCalendarDay(campaignDate, today)) return false;
      } else if (dayFilter === 'tomorrow') {
        if (!isSameCalendarDay(campaignDate, tomorrow)) return false;
      } else if (dayFilter === 'upcoming') {
        if (!isCampaignQueued(c)) return false;
        if (campaignDate < today) return false;
      } else if (dayFilter === 'custom' && customDate) {
        const customObj = new Date(customDate + 'T00:00:00');
        if (!isSameCalendarDay(campaignDate, customObj)) return false;
      }

      // 4. Keyword Search Filter
      if (trackerSearch.trim()) {
        const q = trackerSearch.toLowerCase();
        const matchesTitle = c.title?.toLowerCase().includes(q);
        const matchesBody = c.body?.toLowerCase().includes(q);
        const matchesCat = c.category?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesBody && !matchesCat) return false;
      }

      return true;
    });
  }, [campaigns, categoryFilter, dayFilter, customDate, statusFilter, trackerSearch]);

  // Filtered upcoming Movies and Web Series
  const filteredUpcomingMovies = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return upcomingMovies.filter((m) => {
      if (scannerCategoryFilter !== 'all' && m.release_category !== scannerCategoryFilter) {
        return false;
      }

      if (m.release_date) {
        const relDate = new Date(m.release_date + 'T00:00:00');
        const diffDays = Math.ceil((relDate - today) / (1000 * 60 * 60 * 24));
        if (scannerHorizonFilter === '7' && (diffDays < 0 || diffDays > 7)) return false;
        if (scannerHorizonFilter === '30' && (diffDays < 0 || diffDays > 30)) return false;
      }

      if (scannerSearch.trim()) {
        const q = scannerSearch.toLowerCase();
        if (!m.title?.toLowerCase().includes(q)) return false;
      }

      return true;
    });
  }, [upcomingMovies, scannerCategoryFilter, scannerHorizonFilter, scannerSearch]);

  return (
    <div className="space-y-6">
      {/* Top View Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-black/40 backdrop-blur-xl p-2 rounded-2xl border border-white/[0.12] shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_8px_20px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveView('form')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeView === 'form'
                ? 'bg-[#E50914] text-white shadow-[0_0_15px_rgba(229,9,20,0.45),inset_0_1px_0_rgba(255,255,255,0.25)] scale-[1.02]'
                : 'text-gray-400 hover:text-white hover:bg-white/[0.06] border border-transparent hover:border-white/10'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Launch Campaign</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('queue')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeView === 'queue'
                ? 'bg-amber-600 text-white shadow-[0_0_15px_rgba(217,119,6,0.45),inset_0_1px_0_rgba(255,255,255,0.25)] scale-[1.02]'
                : 'text-gray-400 hover:text-white hover:bg-white/[0.06] border border-transparent hover:border-white/10'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Scheduled Queue & Category Tracker</span>
            {stats.totalQueued > 0 && (
              <span className="bg-amber-400 text-black px-2 py-0.2 rounded-full text-[10px] font-black animate-pulse shadow-sm">
                {stats.totalQueued}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveView('scanner')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeView === 'scanner'
                ? 'bg-rose-600 text-white shadow-[0_0_15px_rgba(225,29,72,0.45),inset_0_1px_0_rgba(255,255,255,0.25)] scale-[1.02]'
                : 'text-gray-400 hover:text-white hover:bg-white/[0.06] border border-transparent hover:border-white/10'
            }`}
          >
            <Film className="w-3.5 h-3.5 text-rose-400" />
            <span>🎬 Upcoming Releases Radar</span>
            <span className="bg-rose-500/30 text-rose-300 px-2 py-0.2 rounded-full text-[10px] font-black border border-rose-500/40">
              Live TMDB
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={fetchCampaigns}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded-xl hover:bg-white/10 border border-white/5 transition"
          title="Refresh campaigns data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Global Status Banner */}
      {actionStatus.message && (
        <div
          className={`p-4 rounded-2xl flex items-center gap-3 border shadow-lg backdrop-blur-xl ${
            actionStatus.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
              : 'bg-rose-950/60 border-rose-500/40 text-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.15)]'
          }`}
        >
          {actionStatus.type === 'success' ? (
            <CheckCircle className="w-5 h-5 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          )}
          <span className="text-xs font-medium leading-relaxed">{actionStatus.message}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW A: SCHEDULE QUEUE & CATEGORY TRACKER                                  */}
      {/* ========================================================================= */}
      {activeView === 'queue' ? (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Header Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="glass-card rounded-2xl p-4 shadow-lg border border-amber-500/25 hover:border-amber-500/40 transition-all hover:-translate-y-0.5">
              <div className="flex items-center justify-between text-amber-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider">In Queue</span>
                <Clock className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black text-white">{stats.totalQueued}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Ready or scheduled to be sent</div>
            </div>

            <div className="glass-card rounded-2xl p-4 shadow-lg border border-blue-500/25 hover:border-blue-500/40 transition-all hover:-translate-y-0.5">
              <div className="flex items-center justify-between text-blue-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider">Due Today</span>
                <Calendar className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black text-white">{stats.dueToday}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Scheduled for today</div>
            </div>

            <div className="glass-card rounded-2xl p-4 shadow-lg border border-purple-500/25 hover:border-purple-500/40 transition-all hover:-translate-y-0.5">
              <div className="flex items-center justify-between text-purple-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider">Due Tomorrow</span>
                <Clock className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black text-white">{stats.dueTomorrow}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Scheduled for tomorrow</div>
            </div>

            <div className="glass-card rounded-2xl p-4 shadow-lg border border-emerald-500/25 hover:border-emerald-500/40 transition-all hover:-translate-y-0.5">
              <div className="flex items-center justify-between text-emerald-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider">Dispatched</span>
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black text-white">{stats.totalSent}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Delivered to devices</div>
            </div>
          </div>

          {/* Quick Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.03] border border-white/10 rounded-2xl p-3 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-semibold">Queue Actions:</span>
              <button
                type="button"
                onClick={handleTriggerDispatch}
                disabled={isDispatching}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-amber-600 to-red-600 hover:from-amber-500 hover:to-red-500 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer disabled:opacity-50"
                title="Dispatch all pending and due notifications right now to user devices"
              >
                <Zap className={`w-3.5 h-3.5 ${isDispatching ? 'animate-spin' : ''}`} />
                <span>{isDispatching ? 'Dispatching...' : '⚡ Dispatch All Queued / Due Now'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setActiveView('scanner')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              <Film className="w-3.5 h-3.5 text-rose-400" />
              <span>🎬 Auto-Scan Upcoming South & Indian Releases</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Category Selector Pills */}
          <div className="glass-card rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[#E50914]" />
                Select Notification Category:
              </span>
              <span className="text-xs text-gray-400">
                Tap category to view its upcoming queue & sent alerts
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {/* All Categories Pill */}
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  categoryFilter === 'all'
                    ? 'bg-white/15 border-white/30 text-white shadow-lg ring-1 ring-white/20'
                    : 'bg-[#141414] border-white/5 text-gray-300 hover:bg-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold">All Categories</span>
                  <Layers className="w-3.5 h-3.5 text-gray-400" />
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-semibold">
                    {stats.categoryMap.all.queue} queued
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                    {stats.categoryMap.all.sent} sent
                  </span>
                </div>
              </button>

              {/* Individual Category Pills */}
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const catStat = stats.categoryMap[cat.value] || { queue: 0, sent: 0 };
                const isSelected = categoryFilter === cat.value;

                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setCategoryFilter(cat.value)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-white/15 border-white/30 text-white shadow-lg ring-1 ring-white/20'
                        : 'bg-[#141414] border-white/5 text-gray-300 hover:bg-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold truncate">{cat.label}</span>
                      <Icon className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span
                        className={`px-1.5 py-0.2 rounded font-semibold ${
                          catStat.queue > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-gray-500'
                        }`}
                      >
                        {catStat.queue} in queue
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                        {catStat.sent} sent
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date & Day Filter Bar */}
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-3">
            {/* Quick Day Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-400 mr-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-amber-400" /> Day:
              </span>

              {[
                { id: 'all', label: 'All Days' },
                { id: 'today', label: '📅 Today' },
                { id: 'tomorrow', label: '⏰ Tomorrow' },
                { id: 'upcoming', label: '⏳ Upcoming Queue' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setDayFilter(tab.id);
                    setCustomDate('');
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    dayFilter === tab.id && !customDate
                      ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                      : 'bg-[#141414] text-gray-400 hover:text-white hover:bg-white/5 border border-white/5'
                  }`}
                >
                  {tab.label}
                </button>
              ))}

              {/* Custom Date Input */}
              <div className="flex items-center gap-1 ml-1 bg-[#141414] border border-white/10 rounded-xl px-2.5 py-1">
                <span className="text-[11px] text-gray-400">Pick Date:</span>
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => {
                    setCustomDate(e.target.value);
                    setDayFilter('custom');
                  }}
                  className="bg-transparent text-white text-xs focus:outline-none [color-scheme:dark]"
                />
                {customDate && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDate('');
                      setDayFilter('all');
                    }}
                    className="text-gray-400 hover:text-white ml-1"
                    title="Clear custom date"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Status & Search Filter */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Status Switcher */}
              <div className="flex items-center bg-[#141414] border border-white/10 rounded-xl p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    statusFilter === 'all' ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  All ({filteredCampaigns.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('queue')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                    statusFilter === 'queue' ? 'bg-amber-600/30 text-amber-300 font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  ⏳ Queue ({campaigns.filter(isCampaignQueued).length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('sent')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                    statusFilter === 'sent' ? 'bg-emerald-600/30 text-emerald-300 font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  ✅ Sent ({campaigns.filter(isCampaignCompleted).length})
                </button>
              </div>

              {/* Keyword Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search alerts..."
                  value={trackerSearch}
                  onChange={(e) => setTrackerSearch(e.target.value)}
                  className="bg-[#141414] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 w-36 sm:w-44"
                />
              </div>
            </div>
          </div>

          {/* Timeline Cards Grid */}
          <div className="space-y-3">
            {filteredCampaigns.length === 0 ? (
              <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-12 text-center space-y-3">
                <Clock className="w-10 h-10 text-gray-600 mx-auto" />
                <h4 className="text-white font-bold text-sm">No Notification Campaigns Found</h4>
                <p className="text-xs text-gray-400 max-w-md mx-auto">
                  No alerts match category <span className="text-amber-400 font-semibold">{categoryFilter}</span> on{' '}
                  <span className="text-amber-400 font-semibold">
                    {customDate ? customDate : dayFilter}
                  </span>
                  .
                </p>
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFilter('all');
                      setDayFilter('all');
                      setCustomDate('');
                      setStatusFilter('all');
                      setTrackerSearch('');
                    }}
                    className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold transition"
                  >
                    Reset All Filters
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveView('form')}
                    className="px-3 py-1.5 bg-[#E50914] hover:bg-[#b80710] text-white rounded-xl text-xs font-semibold transition"
                  >
                    + Schedule New Alert
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredCampaigns.map((c) => {
                  const isQueued = isCampaignQueued(c);
                  const isCompleted = isCampaignCompleted(c);
                  const isDueNow =
                    c.status === 'scheduled' && c.scheduled_for && new Date(c.scheduled_for) <= new Date();

                  const catConfig =
                    CATEGORIES.find((cat) => cat.value === c.category) || {
                      label: c.category?.replace('_', ' '),
                      color: 'text-gray-400 bg-white/5 border-white/10',
                    };

                  return (
                    <div
                      key={c.id}
                      className={`p-5 rounded-2xl border transition-all shadow-xl flex flex-col justify-between ${
                        isQueued
                          ? isDueNow
                            ? 'bg-[#1f1912] border-amber-500/50 ring-1 ring-amber-500/30'
                            : 'bg-[#1a1714] border-amber-500/25'
                          : isCompleted
                          ? 'bg-[#141b16] border-emerald-500/25'
                          : 'bg-[#1a1a1a] border-white/10'
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Header Badges */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${catConfig.color}`}
                            >
                              {catConfig.label}
                            </span>

                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                isDueNow
                                  ? 'bg-amber-400 text-black font-black animate-pulse'
                                  : isQueued
                                  ? c.status === 'scheduled'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/30'
                                  : isCompleted
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : c.status === 'cancelled'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-gray-500/20 text-gray-300'
                              }`}
                            >
                              {isDueNow
                                ? '⚡ Due Now'
                                : isQueued
                                ? c.status === 'scheduled'
                                  ? '⏳ Scheduled'
                                  : '⏳ In Queue'
                                : isCompleted
                                ? '✅ Sent'
                                : c.status}
                            </span>
                          </div>

                          {/* Time label */}
                          <div className="text-[11px] text-gray-400 flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3 text-amber-400/80" />
                            <span>
                              {c.status === 'scheduled' && c.scheduled_for
                                ? formatScheduleTime(c.scheduled_for)
                                : new Date(c.created_at).toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                            </span>
                          </div>
                        </div>

                        {/* Title and Message with Photo */}
                        <div className="flex gap-3">
                          {c.image_url && (
                            <img
                              src={c.image_url}
                              alt={c.title}
                              className="w-12 h-16 rounded-lg object-cover border border-white/10 shrink-0 shadow-sm"
                              onError={(e) => {
                                e.target.style.display = 'none';
                              }}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="text-white font-bold text-sm leading-snug line-clamp-2">
                              {c.title}
                            </h4>
                            <p className="text-gray-300 text-xs mt-1.5 leading-relaxed line-clamp-3">
                              {c.body}
                            </p>
                          </div>
                        </div>

                        {/* Target Criteria & Deep Link */}
                        <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3 text-gray-500" />
                            <strong className="text-gray-300">{getTargetLabel(c)}</strong>
                          </span>

                          {c.url && (
                            <span className="text-gray-500 font-mono text-[10px] truncate max-w-[140px]">
                              URL: {c.url}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Footer Actions & Stats */}
                      <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                        {isQueued ? (
                          <>
                            <div className="text-[11px] text-amber-300/90 font-medium flex items-center gap-1">
                              <Clock className="w-3 h-3 text-amber-400" />
                              <span>{c.scheduled_for ? getTimeRemainingText(c.scheduled_for) : (c.status === 'queued' ? 'Ready to Dispatch' : 'In Queue')}</span>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleDispatchSpecificCampaign(c.id)}
                                disabled={isDispatching}
                                className="px-3 py-1.5 bg-gradient-to-r from-amber-600 to-red-600 hover:from-amber-500 hover:to-red-500 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                                title="Send this notification immediately to users"
                              >
                                <Zap className="w-3 h-3" />
                                <span>Send Now</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleCancelCampaign(c.id)}
                                className="p-1.5 text-rose-400 hover:text-white hover:bg-rose-600/20 rounded-lg transition cursor-pointer"
                                title="Cancel and remove from queue"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        ) : isCompleted ? (
                          <div className="flex items-center justify-between w-full text-[11px] text-emerald-300/80">
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Push Sent: <strong>{c.sent_count || c.sent_deliveries || 0} / {c.total_recipients || c.total_deliveries || 1}</strong></span>
                            </span>
                            <span>
                              👥 Recipients: <strong>{c.total_recipients || c.total_deliveries || 1}</strong>
                            </span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500 capitalize">
                            Status: {c.status}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* VIEW B: DISPATCH NEW CAMPAIGN FORM                                        */}
      {/* ========================================================================= */}
      {activeView === 'form' ? (
        <div className="space-y-8 animate-in fade-in duration-300">
          {/* Main Grid: Form & Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Creation Form */}
            <div className="lg:col-span-2 glass-card rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Send className="w-5 h-5 text-[#E50914]" />
                  Dispatch Notification Campaign
                </h3>

                <button
                  type="button"
                  onClick={() => setActiveView('queue')}
                  className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>View Scheduled Queue ({stats.totalQueued})</span>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Campaign Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Inception is now available in 4K HDR!"
                    className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#E50914] transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Notification Message
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Enter compelling details for the push notification..."
                    rows={3}
                    className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#E50914] transition"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#E50914] transition"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Deep Link URL
                    </label>
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="/movie/12345"
                      className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#E50914] transition"
                    />
                  </div>
                </div>

                {/* Target Audience Selector */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Target Audience
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {TARGET_TYPES.map((t) => {
                      const Icon = t.icon;
                      const isSelected = targetType === t.value;
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setTargetType(t.value)}
                          className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                            isSelected
                              ? 'bg-[#E50914]/15 border-[#E50914] text-white shadow-lg shadow-[#E50914]/10'
                              : 'bg-[#141414] border-white/10 text-gray-400 hover:border-white/20'
                          }`}
                        >
                          <Icon className={`w-4 h-4 mb-2 ${isSelected ? 'text-[#E50914]' : 'text-gray-500'}`} />
                          <div>
                            <div className="font-bold text-xs">{t.label}</div>
                            <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{t.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Dynamic Target ID Fields */}
                {targetType !== 'all' && (
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-300 mb-1">
                        {targetType === 'movie' && 'TMDB Movie ID'}
                        {targetType === 'series' && 'TMDB Series ID'}
                        {targetType === 'season' && 'TMDB Series ID'}
                        {targetType === 'actor' && 'TMDB Actor ID'}
                        {targetType === 'genre' && 'Genre ID / Slug'}
                      </label>
                      <input
                        type="text"
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                        placeholder={`Enter ${targetType} identifier...`}
                        className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-2 text-white text-xs focus:outline-none focus:border-[#E50914]"
                      />
                    </div>

                    {targetType === 'season' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1">Season Number</label>
                        <input
                          type="number"
                          min="1"
                          value={seasonNumber}
                          onChange={(e) => setSeasonNumber(e.target.value)}
                          placeholder="e.g. 1"
                          className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-2 text-white text-xs focus:outline-none focus:border-[#E50914]"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Banner / Poster Photo URL */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                    <span>Notification Poster / Banner Photo URL</span>
                    {imageUrl && (
                      <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                        ✓ Photo Attached
                      </span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://image.tmdb.org/t/p/w780/... (Leave empty for auto fallback)"
                      className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-2 text-white text-xs placeholder:text-gray-600 focus:outline-none focus:border-[#E50914] transition"
                    />
                    {imageUrl && (
                      <button
                        type="button"
                        onClick={() => setImageUrl('')}
                        className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white text-xs transition cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {imageUrl ? (
                    <div className="mt-2.5 relative w-full h-28 rounded-xl overflow-hidden border border-white/10 bg-black/50 shadow-inner">
                      <img
                        src={imageUrl}
                        alt="Notification Photo Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.src = '/og-fallback.jpg';
                        }}
                      />
                      <div className="absolute bottom-1.5 right-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-gray-300 font-medium border border-white/10">
                        📸 Photo Preview
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-[11px] mt-1.5">
                      💡 Movie release alerts me photo hone se notification phone par bada aur professional dikhta hai.
                    </p>
                  )}
                </div>

                {/* Scheduling and Draft Controls */}
                <div className="flex flex-wrap items-center gap-6 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={isDraft}
                      onChange={(e) => setIsDraft(e.target.checked)}
                      className="rounded border-white/20 bg-[#141414] text-[#E50914] focus:ring-0"
                    />
                    Save as Draft
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={isScheduled}
                      onChange={(e) => setIsScheduled(e.target.checked)}
                      className="rounded border-white/20 bg-[#141414] text-[#E50914] focus:ring-0"
                    />
                    Schedule Dispatch
                  </label>

                  {isScheduled && (
                    <input
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      className="bg-[#141414] border border-white/10 rounded-xl px-3 py-1.5 text-white text-xs focus:outline-none focus:border-[#E50914] [color-scheme:dark]"
                    />
                  )}
                </div>

                {/* Submit Button & Direct Feedback */}
                <div className="space-y-3">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full font-bold py-3.5 px-6 rounded-xl transition-all duration-300 flex items-center justify-center gap-2.5 shadow-lg disabled:opacity-70 cursor-pointer ${
                      isLaunchSuccess
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 ring-2 ring-emerald-400/50 scale-[1.01]'
                        : isSubmitting
                        ? 'bg-[#E50914]/85 text-white shadow-[#E50914]/20 cursor-wait'
                        : 'bg-[#E50914] hover:bg-[#b80710] text-white shadow-[#E50914]/25 hover:shadow-[#E50914]/40 active:scale-[0.99]'
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin text-white" />
                        <span>
                          {isDraft
                            ? 'Saving Campaign Draft...'
                            : isScheduled
                            ? 'Scheduling Dispatch...'
                            : 'Launching Campaign & Sending Push...'}
                        </span>
                      </>
                    ) : isLaunchSuccess ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-white animate-bounce" />
                        <span>
                          {isDraft
                            ? 'Draft Saved Successfully!'
                            : isScheduled
                            ? 'Campaign Scheduled Successfully!'
                            : 'Campaign Launched & Push Dispatched!'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>
                          {isDraft ? 'Save Campaign Draft' : isScheduled ? 'Schedule Campaign' : 'Launch Campaign'}
                        </span>
                      </>
                    )}
                  </button>

                  {/* Direct Success Feedback Card */}
                  {successInfo && (
                    <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 shadow-xl transition-all animate-in fade-in duration-300">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 mt-0.5">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-bold text-emerald-300 flex items-center gap-1.5">
                              {successInfo.status === 'draft'
                                ? 'Campaign Saved as Draft'
                                : successInfo.status === 'scheduled'
                                ? 'Campaign Scheduled'
                                : 'Campaign Dispatched Successfully!'}
                            </h4>
                            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              {successInfo.status || 'Sent'}
                            </span>
                          </div>
                          <p className="text-xs text-emerald-200/90 mt-1.5 leading-relaxed">
                            {successInfo.message}
                          </p>
                          {successInfo.status !== 'draft' && (
                            <div className="flex flex-wrap items-center gap-2 mt-2.5 pt-2 border-t border-emerald-500/20 text-[11px] text-emerald-300/90">
                              <span className="bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-500/20">
                                📱 Push Queued: <strong>{successInfo.pushCount || 0}</strong>
                              </span>
                              {successInfo.immediateSent !== undefined && (
                                <span className="bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-500/20 text-emerald-200">
                                  ⚡ Instantly Sent: <strong>{successInfo.immediateSent}</strong>
                                </span>
                              )}
                              <span className="bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-500/20">
                                📬 Inbox: <strong>{successInfo.inAppCount || 0}</strong>
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </form>
            </div>

            {/* Live Preview Card */}
            <div className="glass-card rounded-2xl p-6 flex flex-col justify-between shadow-xl">
              <div>
                <div className="flex items-center gap-2 text-white font-bold text-sm mb-4">
                  <Eye className="w-4 h-4 text-[#E50914]" />
                  FCM Device Notification Preview
                </div>

                <div className="bg-black/50 backdrop-blur-md rounded-2xl p-4 border border-white/10 shadow-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-[#E50914] flex items-center justify-center text-white text-[10px] font-black">
                        MV
                      </div>
                      <span className="text-[11px] font-bold text-white tracking-wider">MOVIEVERIFY</span>
                    </div>
                    <span className="text-[10px] text-gray-400">now</span>
                  </div>

                  <div>
                    <p className="text-white text-xs font-bold leading-snug">
                      {title.trim() || 'Notification Title Preview'}
                    </p>
                    <p className="text-gray-300 text-[11px] mt-1 leading-relaxed">
                      {body.trim() || 'This is how your message will appear on user devices and locksreens.'}
                    </p>
                  </div>

                  {imageUrl && (
                    <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40 h-28 w-full relative">
                      <img
                        src={imageUrl}
                        alt="Notification Banner Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.src = '/og-fallback.jpg';
                        }}
                      />
                      <div className="absolute bottom-1 right-2 bg-black/75 px-1.5 py-0.5 rounded text-[9px] text-gray-300 font-mono">
                        Rich Media Push Banner
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-gray-500">
                    <span>Category: {category}</span>
                    <span>Target: {targetType}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-white/10 text-xs text-gray-500">
                Push notifications are delivered via Firebase Cloud Messaging (FCM) v1 HTTP API and synchronized with in-app notification centers.
              </div>
            </div>
          </div>

          {/* Campaigns History Table */}
          <div className="glass-card rounded-2xl p-6 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-[#E50914]" />
                Recent Campaign History
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveView('queue')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white text-xs font-semibold rounded-xl border border-amber-500/30 transition"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Open Category & Schedule Timeline</span>
                </button>

                <button
                  onClick={handleTriggerDispatch}
                  disabled={isDispatching || loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-600 to-red-600 hover:from-amber-500 hover:to-red-500 text-white text-xs font-semibold rounded-xl shadow-md transition disabled:opacity-50"
                  title="Process and send scheduled campaigns that are due right now"
                >
                  <Zap className={`w-3.5 h-3.5 ${isDispatching ? 'animate-bounce text-yellow-300' : ''}`} />
                  <span>{isDispatching ? 'Dispatching...' : 'Dispatch Due Now'}</span>
                  {stats.totalQueued > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 bg-white/20 rounded-full text-[10px] font-bold">
                      {stats.totalQueued}
                    </span>
                  )}
                </button>

                <button
                  onClick={fetchCampaigns}
                  disabled={loading}
                  className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {campaigns.length === 0 ? (
              <p className="text-center py-8 text-gray-500 text-sm">
                {loading ? 'Loading campaign records...' : 'No notification campaigns recorded.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-400">
                      <th className="pb-3 font-semibold">Title</th>
                      <th className="pb-3 font-semibold">Category</th>
                      <th className="pb-3 font-semibold">Status</th>
                      <th className="pb-3 font-semibold">Recipients</th>
                      <th className="pb-3 font-semibold">Deliveries</th>
                      <th className="pb-3 font-semibold">Created / Due</th>
                      <th className="pb-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-gray-300">
                    {campaigns.slice(0, 15).map((c) => (
                      <tr key={c.id} className="hover:bg-white/5 transition">
                        <td className="py-3 font-medium text-white max-w-[200px] truncate">
                          {c.title}
                        </td>
                        <td className="py-3 capitalize">{c.category?.replace('_', ' ')}</td>
                        <td className="py-3">
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold w-fit ${
                                isCampaignCompleted(c)
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : isCampaignQueued(c)
                                  ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
                                  : c.status === 'cancelled'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-gray-500/20 text-gray-300'
                              }`}
                            >
                              {isCampaignCompleted(c)
                                ? 'completed'
                                : isCampaignQueued(c)
                                ? c.status === 'scheduled'
                                  ? 'scheduled'
                                  : 'queued'
                                : c.status}
                            </span>
                            {c.status === 'scheduled' && c.scheduled_for && (
                              <span className="text-[10px] text-gray-400 whitespace-nowrap">
                                {new Date(c.scheduled_for) <= new Date()
                                  ? '⚡ Due Now'
                                  : `Due: ${new Date(c.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3">{c.total_recipients || 0}</td>
                        <td className="py-3">
                          {c.sent_count || c.sent_deliveries || 0} / {c.total_recipients || c.total_deliveries || 0}
                        </td>
                        <td className="py-3 text-gray-500">
                          {new Date(c.scheduled_for || c.created_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isCampaignQueued(c) && (
                              <button
                                onClick={() => handleDispatchSpecificCampaign(c.id)}
                                disabled={isDispatching}
                                className="text-amber-400 hover:text-amber-300 p-1 rounded hover:bg-amber-950/30 transition cursor-pointer"
                                title="Dispatch This Campaign Now"
                              >
                                <Zap className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {c.status !== 'completed' && c.status !== 'cancelled' && (
                              <button
                                onClick={() => handleCancelCampaign(c.id)}
                                className="text-rose-400 hover:text-rose-300 p-1 rounded hover:bg-rose-950/30 transition cursor-pointer"
                                title="Cancel Campaign"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* VIEW C: AUTO-SCAN UPCOMING MOVIES & WEB SERIES                            */}
      {/* ========================================================================= */}
      {activeView === 'scanner' ? (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Header Banner */}
          <div className="glass-card rounded-2xl p-6 shadow-xl border border-rose-500/25 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-rose-600/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-rose-400 text-xs font-bold uppercase tracking-wider mb-1">
                  <Film className="w-4 h-4" />
                  <span>TMDB Live Release Radar</span>
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px]">
                    Movies & Web Series
                  </span>
                </div>
                <h3 className="text-xl font-black text-white">Upcoming Releases Auto-Scanner</h3>
                <p className="text-xs text-gray-300 mt-1 max-w-xl">
                  Automatically scans upcoming South Indian, Bollywood, Hollywood movies, and Hindi & Hollywood web series.
                  One-click auto-schedule push notifications for user devices on their exact release dates.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleBatchScheduleTop(5)}
                  disabled={batchScheduling || scannerLoading}
                  className="px-4 py-2 bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white rounded-xl text-xs font-bold shadow-lg transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                  title="Automatically schedule release notifications for the top 5 unscheduled upcoming titles"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${batchScheduling ? 'animate-spin' : ''}`} />
                  <span>{batchScheduling ? 'Scheduling Top 5...' : '⚡ Auto-Schedule Top 5 Releases'}</span>
                </button>

                <button
                  type="button"
                  onClick={loadUpcomingMovies}
                  disabled={scannerLoading}
                  className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold border border-white/10 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Rescan TMDB for newest upcoming releases"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${scannerLoading ? 'animate-spin' : ''}`} />
                  <span>{scannerLoading ? 'Scanning...' : 'Rescan'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="glass-card rounded-2xl p-5 shadow-xl space-y-4">
            {/* Category / Industry Selection */}
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Filter By Industry / Release Category:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {RELEASE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setScannerCategoryFilter(cat.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      scannerCategoryFilter === cat.id
                        ? 'bg-white/15 border-white/40 text-white shadow-lg ring-1 ring-white/30 scale-[1.02]'
                        : 'bg-[#141414] border-white/5 text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{cat.icon}</span>
                      <span className="text-xs font-bold leading-tight truncate">{cat.label}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5 truncate">{cat.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Timeframe & Keyword Search */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/5">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-gray-400 font-semibold mr-1">Time Horizon:</span>
                {[
                  { value: 'all', label: 'All (90 Days)' },
                  { value: '7', label: 'This Week (7 Days)' },
                  { value: '30', label: 'This Month (30 Days)' },
                ].map((hz) => (
                  <button
                    key={hz.value}
                    type="button"
                    onClick={() => setScannerHorizonFilter(hz.value)}
                    className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
                      scannerHorizonFilter === hz.value
                        ? 'bg-rose-600/30 text-rose-300 font-bold border border-rose-500/40'
                        : 'text-gray-400 hover:text-white bg-white/5'
                    }`}
                  >
                    {hz.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search movie or web series..."
                  value={scannerSearch}
                  onChange={(e) => setScannerSearch(e.target.value)}
                  className="bg-[#141414] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 w-48 sm:w-64"
                />
              </div>
            </div>
          </div>

          {/* Results Grid */}
          {scannerLoading ? (
            <div className="glass-card rounded-2xl p-16 text-center space-y-3">
              <Loader2 className="w-10 h-10 text-rose-500 animate-spin mx-auto" />
              <h4 className="text-white font-bold text-sm">Scanning Upcoming Movies & Web Series Releases...</h4>
              <p className="text-xs text-gray-400">Querying TMDB for South Indian, Bollywood, Hollywood & Web Series schedules.</p>
            </div>
          ) : filteredUpcomingMovies.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center space-y-3">
              <Film className="w-10 h-10 text-gray-600 mx-auto" />
              <h4 className="text-white font-bold text-sm">No Upcoming Releases Found</h4>
              <p className="text-xs text-gray-400 max-w-md mx-auto">
                No upcoming releases match your selected category. Try switching the category filter or resetting search.
              </p>
              <button
                type="button"
                onClick={() => {
                  setScannerCategoryFilter('all');
                  setScannerHorizonFilter('all');
                  setScannerSearch('');
                }}
                className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredUpcomingMovies.map((item) => {
                const isTv = item.media_type === 'tv' || item.release_category?.includes('series');
                const catInfo = RELEASE_CATEGORIES.find((c) => c.id === item.release_category);
                const countdown = getMovieReleaseCountdown(item.release_date);
                const existingCampaign = campaigns.find(
                  (c) =>
                    c.target_criteria?.movie_id === String(item.id) ||
                    c.target_criteria?.series_id === String(item.id) ||
                    c.title?.toLowerCase().includes(item.title.toLowerCase())
                );
                const isAlreadyScheduled = Boolean(existingCampaign);
                const isAlreadySent = existingCampaign && isCampaignCompleted(existingCampaign);

                const imageUrl =
                  (item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null) ||
                  item.backdrop ||
                  (item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null) ||
                  item.poster;

                return (
                  <div
                    key={`${item.media_type || 'movie'}_${item.id}`}
                    className="glass-card rounded-2xl overflow-hidden border border-white/10 hover:border-white/25 transition-all flex flex-col justify-between group hover:-translate-y-1 shadow-xl"
                  >
                    <div
                      onClick={() => setPreviewMovie(item)}
                      className="cursor-pointer"
                      title="Tap to view full details, cast & trailer"
                    >
                      {/* Movie Backdrop / Poster Image */}
                      <div className="relative aspect-video bg-black/50 overflow-hidden">
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={item.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                            loading="lazy"
                            onError={(e) => {
                              if (item.poster && e.currentTarget.src !== item.poster) {
                                e.currentTarget.src = item.poster;
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 bg-gradient-to-br from-white/5 to-white/0 p-4 text-center">
                            <Film className="w-8 h-8 mb-1 opacity-40 text-amber-400" />
                            <span className="text-[11px] font-semibold text-gray-400 line-clamp-1">{item.title}</span>
                            <span className="text-[9px] text-gray-500 uppercase tracking-wider">{item.industry_name || 'Upcoming'}</span>
                          </div>
                        )}

                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none"></div>

                        {/* Hover Overlay indicating preview */}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
                          <span className="px-3 py-1.5 rounded-full bg-black/80 border border-white/20 text-white text-xs font-semibold backdrop-blur-md flex items-center gap-1.5 shadow-lg">
                            <Play className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                            <span>View Details & Trailer</span>
                          </span>
                        </div>

                        {/* Top Badges */}
                        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1 flex-wrap pointer-events-none">
                          <div className="flex items-center gap-1">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-md border ${
                                catInfo?.color || 'text-gray-300 bg-white/10 border-white/20'
                              }`}
                            >
                              {catInfo ? catInfo.label : item.industry_name || 'Release'}
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-md bg-black/60 text-gray-300 border border-white/10">
                              {isTv ? '📺 Series' : '🎬 Movie'}
                            </span>
                          </div>

                          {countdown && (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-md ${
                                countdown.isUrgent
                                  ? 'bg-rose-500/80 text-white animate-pulse font-black'
                                  : 'bg-black/60 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {countdown.text}
                            </span>
                          )}
                        </div>

                        {/* Release Date Banner */}
                        <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-white text-[11px] font-medium pointer-events-none">
                          <span className="flex items-center gap-1 font-mono">
                            <Calendar className="w-3 h-3 text-amber-400" />
                            {item.release_date}
                          </span>
                          {item.vote_average > 0 && (
                            <span className="text-amber-400 font-bold">
                              ★ {Number(item.vote_average).toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Content Body */}
                      <div className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-white font-bold text-sm leading-snug line-clamp-1 group-hover:text-rose-400 transition">
                            {item.title}
                          </h4>
                          <span className="text-[10px] text-gray-500 group-hover:text-amber-400 flex items-center gap-0.5 shrink-0 transition">
                            Details <ArrowUpRight className="w-3 h-3" />
                          </span>
                        </div>
                        <p className="text-gray-400 text-xs line-clamp-2 leading-relaxed">
                          {item.overview || `Upcoming ${catInfo ? catInfo.label : 'entertainment'} release.`}
                        </p>
                      </div>
                    </div>

                    {/* Action Footer */}
                    <div className="p-4 pt-0">
                      {isAlreadySent ? (
                        <div className="w-full py-2 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center justify-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Notification Sent</span>
                        </div>
                      ) : isAlreadyScheduled ? (
                        <div className="w-full py-2 px-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-amber-400" />
                            <span>In Queue</span>
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveView('queue');
                            }}
                            className="text-[10px] text-amber-400 underline hover:text-white cursor-pointer"
                          >
                            View
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAutoScheduleMovie(item);
                          }}
                          disabled={schedulingMovieId === item.id}
                          className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Zap className={`w-3.5 h-3.5 ${schedulingMovieId === item.id ? 'animate-spin' : ''}`} />
                          <span>
                            {schedulingMovieId === item.id
                              ? 'Scheduling...'
                              : isTv
                              ? '⚡ Auto-Schedule Series Alert'
                              : '⚡ Auto-Schedule Movie Alert'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* Dedicated Upcoming Release Admin Preview Modal */}
      <UpcomingReleaseModal
        item={previewMovie}
        isOpen={Boolean(previewMovie)}
        onClose={() => setPreviewMovie(null)}
        onAutoSchedule={handleAutoScheduleMovie}
        onCustomize={handleCustomizeCampaignFromRelease}
        existingCampaign={
          previewMovie
            ? campaigns.find(
                (c) =>
                  c.status !== 'cancelled' &&
                  (c.target_criteria?.movie_id === String(previewMovie.id) ||
                    c.target_criteria?.series_id === String(previewMovie.id))
              )
            : null
        }
        isScheduling={schedulingMovieId === previewMovie?.id}
      />
    </div>
  );
}
