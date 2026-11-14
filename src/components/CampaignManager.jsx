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
} from 'lucide-react';
import { supabase } from '../data/supabaseClient';

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
          msg += ` ⚠️ ${suppressedCount} device(s) reached daily limit (5/day). Increase limit in Preferences to receive more.`;
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

      const sentCount = data.dispatch_summary?.sent || 0;
      const promotedCount = data.promotion_summary?.promoted_count || 0;
      setActionStatus({
        type: 'success',
        message: `Dispatch Cycle complete! ${promotedCount} scheduled campaign(s) promoted, ${sentCount} push delivery attempts executed.`,
      });
      fetchCampaigns();
    } catch (err) {
      setActionStatus({ type: 'error', message: err.message });
    } finally {
      setIsDispatching(false);
    }
  };

  const handleDispatchSpecificCampaign = async (campaignId) => {
    if (!confirm('Are you sure you want to dispatch this scheduled campaign right now to active user devices?')) {
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

      const sentCount = data.dispatch_summary?.sent || 0;
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
      const isQueued = c.status === 'scheduled' || c.status === 'processing';
      const isSent = c.status === 'completed';

      if (isQueued) {
        totalQueued += 1;
        if (c.scheduled_for) {
          if (isSameCalendarDay(c.scheduled_for, today)) dueToday += 1;
          if (isSameCalendarDay(c.scheduled_for, tomorrow)) dueTomorrow += 1;
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
      const isQueued = c.status === 'scheduled' || c.status === 'processing';
      const isSent = c.status === 'completed';
      if (statusFilter === 'queue' && !isQueued) return false;
      if (statusFilter === 'sent' && !isSent) return false;

      // 3. Day / Date Filter
      const campaignDate =
        c.status === 'scheduled' && c.scheduled_for ? new Date(c.scheduled_for) : new Date(c.created_at);

      if (dayFilter === 'today') {
        if (!isSameCalendarDay(campaignDate, today)) return false;
      } else if (dayFilter === 'tomorrow') {
        if (!isSameCalendarDay(campaignDate, tomorrow)) return false;
      } else if (dayFilter === 'upcoming') {
        if (c.status !== 'scheduled') return false;
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

  return (
    <div className="space-y-6">
      {/* Top View Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#141414] p-2 rounded-2xl border border-white/10 shadow-lg">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveView('form')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeView === 'form'
                ? 'bg-[#E50914] text-white shadow-lg shadow-[#E50914]/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Launch Campaign</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('queue')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeView === 'queue'
                ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Scheduled Queue & Category Tracker</span>
            {stats.totalQueued > 0 && (
              <span className="bg-amber-400 text-black px-2 py-0.2 rounded-full text-[10px] font-black animate-pulse">
                {stats.totalQueued}
              </span>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={fetchCampaigns}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition"
          title="Refresh campaigns data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Global Status Banner */}
      {actionStatus.message && (
        <div
          className={`p-4 rounded-xl flex items-center gap-3 border shadow-lg ${
            actionStatus.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-950/50 border-rose-500/30 text-rose-200'
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
            <div className="bg-[#1a1a1a] border border-amber-500/20 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center justify-between text-amber-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider">In Queue</span>
                <Clock className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black text-white">{stats.totalQueued}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Scheduled to be sent</div>
            </div>

            <div className="bg-[#1a1a1a] border border-blue-500/20 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center justify-between text-blue-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider">Due Today</span>
                <Calendar className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black text-white">{stats.dueToday}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Scheduled for today</div>
            </div>

            <div className="bg-[#1a1a1a] border border-purple-500/20 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center justify-between text-purple-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider">Due Tomorrow</span>
                <Clock className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black text-white">{stats.dueTomorrow}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Scheduled for tomorrow</div>
            </div>

            <div className="bg-[#1a1a1a] border border-emerald-500/20 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center justify-between text-emerald-400 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider">Dispatched</span>
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black text-white">{stats.totalSent}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Delivered to devices</div>
            </div>
          </div>

          {/* Category Selector Pills */}
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-5 shadow-xl space-y-3">
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
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    statusFilter === 'queue' ? 'bg-amber-600/30 text-amber-300 font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  ⏳ Queue ({campaigns.filter((c) => c.status === 'scheduled').length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('sent')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    statusFilter === 'sent' ? 'bg-emerald-600/30 text-emerald-300 font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  ✅ Sent ({campaigns.filter((c) => c.status === 'completed').length})
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
                  const isQueued = c.status === 'scheduled' || c.status === 'processing';
                  const isCompleted = c.status === 'completed';
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
                                isQueued
                                  ? isDueNow
                                    ? 'bg-amber-400 text-black font-black animate-pulse'
                                    : 'bg-amber-500/20 text-amber-300'
                                  : isCompleted
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : c.status === 'cancelled'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-gray-500/20 text-gray-300'
                              }`}
                            >
                              {isDueNow ? '⚡ Due Now' : isQueued ? '⏳ In Queue' : c.status}
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

                        {/* Title and Message */}
                        <div>
                          <h4 className="text-white font-bold text-sm leading-snug line-clamp-2">
                            {c.title}
                          </h4>
                          <p className="text-gray-300 text-xs mt-1.5 leading-relaxed line-clamp-3">
                            {c.body}
                          </p>
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
                            <div className="text-[11px] text-amber-300/90 font-medium">
                              {c.scheduled_for ? getTimeRemainingText(c.scheduled_for) : 'Waiting'}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleDispatchSpecificCampaign(c.id)}
                                disabled={isDispatching}
                                className="px-3 py-1.5 bg-gradient-to-r from-amber-600 to-red-600 hover:from-amber-500 hover:to-red-500 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1 disabled:opacity-50"
                                title="Send this scheduled notification immediately to users"
                              >
                                <Zap className="w-3 h-3" />
                                <span>Send Now</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleCancelCampaign(c.id)}
                                className="p-1.5 text-rose-400 hover:text-white hover:bg-rose-600/20 rounded-lg transition"
                                title="Cancel and remove from queue"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        ) : isCompleted ? (
                          <div className="flex items-center justify-between w-full text-[11px] text-emerald-300/80">
                            <span>
                              📱 Push Sent: <strong>{c.sent_deliveries || 0} / {c.total_deliveries || 0}</strong>
                            </span>
                            <span>
                              👥 Recipients: <strong>{c.total_recipients || 0}</strong>
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
            <div className="lg:col-span-2 bg-[#1a1a1a] border border-white/10 rounded-2xl p-6">
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
            <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-white font-bold text-sm mb-4">
                  <Eye className="w-4 h-4 text-[#E50914]" />
                  FCM Device Notification Preview
                </div>

                <div className="bg-[#242424] rounded-2xl p-4 border border-white/10 shadow-xl space-y-3">
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
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6">
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
                                c.status === 'completed'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : c.status === 'processing'
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : c.status === 'cancelled'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : c.status === 'scheduled'
                                  ? 'bg-blue-500/20 text-blue-300'
                                  : 'bg-gray-500/20 text-gray-300'
                              }`}
                            >
                              {c.status}
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
                          {c.sent_deliveries || 0} / {c.total_deliveries || 0}
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
                            {c.status === 'scheduled' && (
                              <button
                                onClick={() => handleDispatchSpecificCampaign(c.id)}
                                disabled={isDispatching}
                                className="text-amber-400 hover:text-amber-300 p-1 rounded hover:bg-amber-950/30 transition"
                                title="Dispatch This Campaign Now"
                              >
                                <Zap className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {c.status !== 'completed' && c.status !== 'cancelled' && (
                              <button
                                onClick={() => handleCancelCampaign(c.id)}
                                className="text-rose-400 hover:text-rose-300 p-1 rounded hover:bg-rose-950/30 transition"
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
    </div>
  );
}
