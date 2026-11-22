import React, { useState, useEffect } from 'react';
import { Mail, Send, CheckCircle2, AlertCircle, RefreshCw, Users, ShieldAlert, Sparkles, ExternalLink, Calendar, Film } from 'lucide-react';
import { supabase } from '../data/supabaseClient';

export default function EmailBroadcastManager() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [secretKey, setSecretKey] = useState(() => localStorage.getItem('mvx_admin_cron_secret') || '');

  const loadStats = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/email-broadcast/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      } else {
        // Fallback: query Supabase directly from client if endpoint is updating
        const { data: campaigns } = await supabase
          .from('notification_campaigns')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);

        setStats({
          totalRegisteredUsers: 'Active',
          provider: 'Resend',
          dispatches: (campaigns || []).filter(c => c?.target_criteria?.channel === 'email' || c?.category === 'movie_release')
        });
      }
    } catch (e) {
      console.warn('Could not load email broadcast stats:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleSendBroadcast = async (target) => {
    const isAll = target === 'users';
    const confirmText = isAll 
      ? "Kya aap sach me saare registered users ko 'Today's Releases' email bhejna chahte hain?"
      : "Send test email to Admin only?";

    if (!window.confirm(confirmText)) return;

    setActionLoading(true);
    setStatusMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const queryParams = new URLSearchParams();
      queryParams.set('target', target);
      if (secretKey.trim()) {
        queryParams.set('secret', secretKey.trim());
      }

      const headers = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/admin/daily-digest?${queryParams.toString()}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ target })
      });

      const result = await res.json();

      if (res.ok && result.success) {
        setStatusMessage({
          type: 'success',
          text: `✅ Safalta se email bheja gaya! (${result.recipientsCount} recipients, ${result.moviesCount} movies included). Resend ID: ${result.emailId || 'OK'}`
        });
        loadStats();
      } else {
        setStatusMessage({
          type: 'error',
          text: `❌ Error: ${result.error || result.message || 'Delivery failed'} ${result.details ? JSON.stringify(result.details) : ''}`
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `Network Error: ${err.message}`
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveSecret = (val) => {
    setSecretKey(val);
    localStorage.setItem('mvx_admin_cron_secret', val);
  };

  return (
    <div className="w-full space-y-6">
      {/* Header Banner */}
      <div className="glass-card rounded-2xl p-5 sm:p-6 border border-white/10 relative overflow-hidden bg-gradient-to-r from-red-950/30 via-black/40 to-black/40">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-500 shrink-0 shadow-[0_0_20px_rgba(229,9,20,0.3)]">
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                Today's Releases Email Broadcast
                <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-mono uppercase">
                  Resend API
                </span>
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Saare registered users ko aaj release hone wali movies & web series ki summary direct unke Gmail inbox me bhejein.
              </p>
            </div>
          </div>

          <button
            onClick={loadStats}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <div className="bg-black/40 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl sm:text-2xl font-black text-white">
              {loading ? '...' : (stats?.totalRegisteredUsers ?? '29+')}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 font-medium flex items-center justify-center gap-1">
              <Users className="w-3 h-3 text-blue-400" />
              <span>Registered Users</span>
            </div>
          </div>

          <div className="bg-black/40 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl sm:text-2xl font-black text-green-400">
              100 / day
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 font-medium flex items-center justify-center gap-1">
              <Sparkles className="w-3 h-3 text-green-400" />
              <span>Free Quota</span>
            </div>
          </div>

          <div className="bg-black/40 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl sm:text-2xl font-black text-amber-400">
              {stats?.dispatches?.length || 0}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 font-medium flex items-center justify-center gap-1">
              <Calendar className="w-3 h-3 text-amber-400" />
              <span>Campaigns Sent</span>
            </div>
          </div>

          <div className="bg-black/40 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl sm:text-2xl font-black text-rose-400">
              Auto Daily
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 font-medium flex items-center justify-center gap-1">
              <Film className="w-3 h-3 text-rose-400" />
              <span>cron-job.org</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Controls & Secret Key */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Dispatch Actions */}
        <div className="md:col-span-2 glass-card rounded-2xl p-5 border border-white/10 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Send className="w-4 h-4 text-red-500" />
            <span>Instant Dispatch Controls</span>
          </h3>

          <p className="text-xs text-gray-400 leading-relaxed">
            Neeche diye gaye buttons se aap abhi turant email dispatch kar sakte hain. Email me aaj ke top trending movies, posters, ratings aur direct moviex.sbs ke links shaamil honge.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => handleSendBroadcast('users')}
              disabled={actionLoading}
              className="bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white font-bold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-[0_0_15px_rgba(229,9,20,0.4)] flex items-center gap-2 transition hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{actionLoading ? 'Dispatching...' : '⚡ Send Today Releases to ALL Registered Users'}</span>
            </button>

            <button
              onClick={() => handleSendBroadcast('admin')}
              disabled={actionLoading}
              className="bg-white/10 hover:bg-white/20 disabled:opacity-50 text-gray-200 font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl border border-white/10 flex items-center gap-2 transition hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              <Mail className="w-4 h-4 text-amber-400" />
              <span>Send Test Email to Admin Only</span>
            </button>
          </div>

          {statusMessage && (
            <div className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 border ${
              statusMessage.type === 'success' 
                ? 'bg-green-950/40 border-green-500/40 text-green-300' 
                : 'bg-red-950/40 border-red-500/40 text-red-300'
            }`}>
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="font-mono break-all leading-relaxed">
                {statusMessage.text}
              </div>
            </div>
          )}
        </div>

        {/* Right: Secret & Cron Setup Info */}
        <div className="glass-card rounded-2xl p-5 border border-white/10 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>Cron Security Secret</span>
          </h3>

          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              CRON_SECRET (Optional Header / Query)
            </label>
            <input
              type="text"
              value={secretKey}
              onChange={(e) => handleSaveSecret(e.target.value)}
              placeholder="e.g. mvx_9f8b2c7d1a6e4f3b5a0d8c2e1"
              className="w-full bg-black/50 border border-white/10 rounded-lg p-2.5 text-xs text-white outline-none focus:border-red-500 font-mono"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Agar aapne Render me <code>CRON_SECRET</code> add kiya hai to yahan paste karein.
            </p>
          </div>

          <div className="bg-black/30 border border-white/5 rounded-xl p-3 text-[11px] text-gray-300 space-y-2">
            <div className="font-bold text-white">Cron Schedule URL:</div>
            <code className="block bg-black/60 p-2 rounded text-[10px] text-red-300 break-all select-all font-mono">
              https://movieverify-backend.onrender.com/api/admin/daily-digest?target=users&secret={secretKey || 'YOUR_SECRET'}
            </code>
            <p className="text-[10px] text-gray-400">
              cron-job.org me daily 9:00 AM IST par set karein.
            </p>
          </div>
        </div>
      </div>

      {/* Broadcast History & Tracking Table */}
      <div className="glass-card rounded-2xl p-5 border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-400" />
            <span>Broadcast History & Tracking</span>
          </h3>
          <span className="text-xs text-gray-400">
            Last {stats?.dispatches?.length || 0} Campaigns
          </span>
        </div>

        {stats?.dispatches?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-white/5 uppercase text-[10px] text-gray-400 font-semibold border-b border-white/10">
                <tr>
                  <th className="py-2.5 px-3">Date / Time</th>
                  <th className="py-2.5 px-3">Subject / Campaign</th>
                  <th className="py-2.5 px-3">Audience</th>
                  <th className="py-2.5 px-3">Recipients</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {stats.dispatches.map((disp, i) => (
                  <tr key={disp.id || i} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3 text-gray-400 whitespace-nowrap">
                      {disp.created_at ? new Date(disp.created_at).toLocaleString() : 'Recent'}
                    </td>
                    <td className="py-2.5 px-3 text-white font-sans max-w-xs truncate">
                      {disp.title || "Today's Release Digest"}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {disp.target_criteria?.target === 'admin' ? 'Admin Only' : 'Registered Users'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-green-400 font-bold">
                      {disp.total_recipients || disp.sent_count || 'All'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-semibold bg-green-500/20 text-green-400 border border-green-500/30">
                        {disp.status || 'Delivered'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400 text-xs">
            <Mail className="w-8 h-8 mx-auto text-gray-500 mb-2 opacity-50" />
            <p>Abhi tak koi email campaign record nahi mila.</p>
            <p className="text-[11px] text-gray-500 mt-1">Upar diye gaye button se test email send karein.</p>
          </div>
        )}
      </div>
    </div>
  );
}
