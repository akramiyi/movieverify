import React, { useState, useEffect } from 'react';
import { Send, Calendar, Users, Film, User, Layers, AlertCircle, CheckCircle, CheckCircle2, Clock, Trash2, RefreshCw, Eye, Zap, Loader2 } from 'lucide-react';
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
  { value: 'movie_release', label: 'Movie Release' },
  { value: 'content_update', label: 'Content Update' },
  { value: 'user_alert', label: 'User Alert' },
  { value: 'admin_announcement', label: 'Announcement' },
  { value: 'promotional', label: 'Promotional' },
];

export default function CampaignManager() {
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

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(25);

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
        msg = `📅 Campaign scheduled for ${new Date(schedTime).toLocaleString()}! When due, it will be dispatched automatically, or you can click "Dispatch Due Now" to trigger it immediately.`;
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
        throw new Error(data.message || data.error || 'Failed to trigger dispatch');
      }

      const promoted = data.promoted_campaigns || 0;
      const sent = data.sent || 0;
      const processed = data.processed || 0;

      let msg = `⚡ Dispatch complete! ${promoted} scheduled campaign(s) promoted, ${sent} push notification(s) sent successfully.`;
      if (promoted === 0 && sent === 0) {
        msg = `Checked: No scheduled campaigns are currently due (or all have already been dispatched).`;
      }

      setActionStatus({
        type: 'success',
        message: msg,
      });

      await fetchCampaigns();
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

  return (
    <div className="space-y-8">
      {/* Status banner */}
      {actionStatus.message && (
        <div
          className={`p-4 rounded-xl flex items-center gap-3 border ${
            actionStatus.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
          }`}
        >
          {actionStatus.type === 'success' ? (
            <CheckCircle className="w-5 h-5 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0" />
          )}
          <span className="text-sm font-medium">{actionStatus.message}</span>
        </div>
      )}

      {/* Main Grid: Form & Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Creation Form */}
        <div className="lg:col-span-2 bg-[#1a1a1a] border border-white/10 rounded-2xl p-6">
          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <Send className="w-5 h-5 text-[#E50914]" />
            Dispatch Notification Campaign
          </h3>

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
                maxLength={150}
                required
                className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-[#E50914] text-sm"
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
                maxLength={1000}
                required
                className="w-full bg-[#141414] border border-white/10 rounded-xl p-4 text-white placeholder-gray-600 focus:outline-none focus:border-[#E50914] text-sm resize-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-[#141414] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#E50914]"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
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
                  placeholder="/?type=movie&id=550"
                  className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#E50914]"
                />
              </div>
            </div>

            {/* Target Criteria */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Target Audience
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {TARGET_TYPES.map((t) => {
                  const Icon = t.icon;
                  const isSelected = targetType === t.value;
                  return (
                    <button
                      type="button"
                      key={t.value}
                      onClick={() => setTargetType(t.value)}
                      className={`p-3 rounded-xl border text-left transition flex flex-col gap-1.5 ${
                        isSelected
                          ? 'bg-[#E50914]/15 border-[#E50914] text-white'
                          : 'bg-[#141414] border-white/5 text-gray-400 hover:border-white/20'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-[#E50914]' : 'text-gray-400'}`} />
                      <span className="text-xs font-bold">{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {targetType !== 'all' && (
                <div className={targetType === 'season' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
                  <input
                    type="text"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    placeholder={`Enter TMDB ${targetType} ID or slug`}
                    required
                    className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#E50914]"
                  />
                  {targetType === 'season' && (
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={seasonNumber}
                      onChange={(e) => setSeasonNumber(e.target.value)}
                      placeholder="Season number (e.g. 2)"
                      required
                      className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#E50914]"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Scheduling & Draft */}
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
                  className="bg-[#141414] border border-white/10 rounded-xl px-3 py-1.5 text-white text-xs focus:outline-none focus:border-[#E50914]"
                />
              )}
            </div>

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
                    <span>{isDraft ? 'Save Campaign Draft' : isScheduled ? 'Schedule Campaign' : 'Launch Campaign'}</span>
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
            Campaign Dispatch & Delivery History
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerDispatch}
              disabled={isDispatching || loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-600 to-red-600 hover:from-amber-500 hover:to-red-500 text-white text-xs font-semibold rounded-xl shadow-md transition disabled:opacity-50"
              title="Process and send scheduled campaigns that are due right now"
            >
              <Zap className={`w-3.5 h-3.5 ${isDispatching ? 'animate-bounce text-yellow-300' : ''}`} />
              <span>{isDispatching ? 'Dispatching...' : 'Dispatch Due Now'}</span>
              {campaigns.filter((c) => c.status === 'scheduled').length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-white/20 rounded-full text-[10px] font-bold">
                  {campaigns.filter((c) => c.status === 'scheduled').length}
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
                  <th className="pb-3 font-semibold">Created</th>
                  <th className="pb-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-gray-300">
                {campaigns.map((c) => (
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
                      {new Date(c.created_at).toLocaleDateString([], {
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
                            onClick={handleTriggerDispatch}
                            disabled={isDispatching}
                            className="text-amber-400 hover:text-amber-300 p-1 rounded hover:bg-amber-950/30 transition"
                            title="Dispatch Due Scheduled Campaigns Now"
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
  );
}

