import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  Settings,
  X,
  Film,
  CheckCheck,
  Loader2,
  Calendar,
  RefreshCw,
  CalendarDays,
  RotateCcw,
} from 'lucide-react';
import { supabase } from '../data/supabaseClient';
import NotificationPreferences from './NotificationPreferences';
import {
  resolveNotificationTargetUrl,
  parseNotificationMovieLink,
} from '../utils/notificationLinks';
import { reportNotificationTelemetry } from '../utils/notificationTelemetry';

// Format Date object or ISO string to local 'YYYY-MM-DD'
const toLocalDateKey = (dateInput) => {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Friendly relative header label
const getRelativeDayLabel = (dateStr) => {
  if (!dateStr) return '';
  const todayKey = toLocalDateKey(new Date());

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toLocalDateKey(yesterday);

  if (dateStr === todayKey) return 'Today';
  if (dateStr === yesterdayKey) return 'Yesterday';

  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  }
  return dateStr;
};

export default function NotificationCenter({
  isOpen,
  onClose,
  onSelectMovie,
  onSelectActor,
  onUnreadCountChange,
  refreshTrigger = 0,
}) {
  const [activeTab, setActiveTab] = useState('inbox'); // 'inbox' | 'preferences'
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  // Daily organization & interactive calendar filter
  const [dateFilter, setDateFilter] = useState('all'); // 'all' | 'today' | 'yesterday' | 'calendar'
  const [customDate, setCustomDate] = useState(() => toLocalDateKey(new Date()));
  const dateInputRef = useRef(null);
  const displayedTrackedRef = useRef(new Set());

  const todayKey = useMemo(() => toLocalDateKey(new Date()), []);
  const yesterdayKey = useMemo(() => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return toLocalDateKey(y);
  }, []);

  const fetchNotifications = async (manual = false) => {
    try {
      if (manual) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setNotifications([]);
        setUnreadCount(0);
        onUnreadCountChange?.(0);
        return;
      }

      const res = await fetch('/api/notifications/user', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        const json = await res.json();
        const nextUnread = json.unread_count || 0;
        const rows = json.notifications || [];
        setNotifications(rows);
        setUnreadCount(nextUnread);
        onUnreadCountChange?.(nextUnread);

        // Fire non-blocking 'displayed' telemetry once per inbox session for each delivery-backed alert
        for (const item of rows) {
          if (item.delivery_id && !displayedTrackedRef.current.has(item.id)) {
            displayedTrackedRef.current.add(item.id);
            reportNotificationTelemetry({
              deliveryId: item.delivery_id,
              notificationId: item.id,
              eventType: 'displayed',
              eventNonce: `inbox-display-${item.id}`,
              metadata: { surface: 'notification_center' },
            });
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load notifications:', err.message);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, refreshTrigger]);

  const handleMarkAsRead = async (id) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/notifications/user', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ notification_id: id }),
      });

      if (!res.ok) return;

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prevCount) => {
        const nextCount = Math.max(0, prevCount - 1);
        onUnreadCountChange?.(nextCount);
        return nextCount;
      });
    } catch (err) {
      console.warn('Failed to mark read:', err.message);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setMarkingAll(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/notifications/user', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ mark_all: true }),
      });

      if (!res.ok) return;

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      onUnreadCountChange?.(0);
    } catch (err) {
      console.warn('Failed to mark all read:', err.message);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleNotificationClick = (item) => {
    if (!item.is_read) {
      handleMarkAsRead(item.id);
    }

    if (item.delivery_id) {
      reportNotificationTelemetry({
        deliveryId: item.delivery_id,
        notificationId: item.id,
        eventType: 'opened',
        eventNonce: `inbox-open-${item.id}`,
        metadata: { surface: 'notification_center' },
      });
    }

    const targetUrl = resolveNotificationTargetUrl(item);
    if (targetUrl) {
      if (item.delivery_id) {
        reportNotificationTelemetry({
          deliveryId: item.delivery_id,
          notificationId: item.id,
          eventType: 'clicked',
          eventNonce: `inbox-click-${item.id}-${Date.now()}`,
          metadata: { surface: 'notification_center', target_url: targetUrl },
        });
      }
      const movieTarget = parseNotificationMovieLink(targetUrl, item.title);
      if (movieTarget && onSelectMovie) {
        onSelectMovie(movieTarget);
        onClose();
        return;
      }
      window.location.href = targetUrl;
    }
  };

  // Filter notifications by day or custom calendar selection
  const filteredNotifications = useMemo(() => {
    if (dateFilter === 'all') return notifications;
    if (dateFilter === 'today') {
      return notifications.filter((n) => toLocalDateKey(n.created_at) === todayKey);
    }
    if (dateFilter === 'yesterday') {
      return notifications.filter((n) => toLocalDateKey(n.created_at) === yesterdayKey);
    }
    if (dateFilter === 'calendar' && customDate) {
      return notifications.filter((n) => toLocalDateKey(n.created_at) === customDate);
    }
    return notifications;
  }, [notifications, dateFilter, customDate, todayKey, yesterdayKey]);

  // Group notifications day-wise for chronological visual flow
  const groupedNotifications = useMemo(() => {
    const groups = {};
    filteredNotifications.forEach((item) => {
      const key = toLocalDateKey(item.created_at) || 'Earlier';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [filteredNotifications]);

  // Count alerts per date filter
  const todayCount = useMemo(() => {
    return notifications.filter((n) => toLocalDateKey(n.created_at) === todayKey).length;
  }, [notifications, todayKey]);

  const yesterdayCount = useMemo(() => {
    return notifications.filter((n) => toLocalDateKey(n.created_at) === yesterdayKey).length;
  }, [notifications, yesterdayKey]);

  const handleOpenDatePicker = () => {
    if (dateInputRef.current) {
      if (typeof dateInputRef.current.showPicker === 'function') {
        dateInputRef.current.showPicker();
      } else {
        dateInputRef.current.focus();
      }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[250] flex justify-end"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="relative w-full max-w-md h-full bg-[#141414] border-l border-white/10 shadow-2xl flex flex-col z-10"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-[#E50914]" />
                <h2 className="text-white font-bold text-lg">Notifications</h2>
                {unreadCount > 0 && (
                  <span className="bg-[#E50914] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {unreadCount} new
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {/* Manual Daily Refresh Button */}
                <button
                  onClick={() => fetchNotifications(true)}
                  disabled={loading || isRefreshing}
                  className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition disabled:opacity-50"
                  title="Refresh Notifications"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#E50914]' : ''}`}
                  />
                </button>
                <button
                  onClick={() => setActiveTab(activeTab === 'inbox' ? 'preferences' : 'inbox')}
                  className={`p-2 rounded-lg transition ${
                    activeTab === 'preferences'
                      ? 'bg-[#E50914] text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                  title="Notification Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sub-header / Actions & Filters */}
            {activeTab === 'inbox' && (
              <div className="border-b border-white/5 bg-[#171717] px-4 py-2.5 flex flex-col gap-2">
                {/* Top Summary & Mark All Read */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400 font-medium">
                    {notifications.length} {notifications.length === 1 ? 'alert' : 'alerts'} total
                    {dateFilter !== 'all' && (
                      <span className="text-gray-500 text-[11px] ml-1">
                        ({filteredNotifications.length} shown)
                      </span>
                    )}
                  </span>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      disabled={markingAll}
                      className="text-[#E50914] hover:underline flex items-center gap-1 font-semibold disabled:opacity-50 text-xs"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      {markingAll ? 'Marking...' : 'Mark all as read'}
                    </button>
                  )}
                </div>

                {/* Day Filters & Interactive Calendar Picker */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
                  {/* All */}
                  <button
                    onClick={() => setDateFilter('all')}
                    className={`px-2.5 py-1 rounded-full font-medium transition shrink-0 ${
                      dateFilter === 'all'
                        ? 'bg-[#E50914] text-white shadow-sm'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    All
                  </button>

                  {/* Today */}
                  <button
                    onClick={() => setDateFilter('today')}
                    className={`px-2.5 py-1 rounded-full font-medium transition shrink-0 flex items-center gap-1 ${
                      dateFilter === 'today'
                        ? 'bg-[#E50914] text-white shadow-sm'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    Today
                    {todayCount > 0 && (
                      <span className="text-[10px] bg-black/30 px-1.5 py-0.2 rounded-full font-bold">
                        {todayCount}
                      </span>
                    )}
                  </button>

                  {/* Yesterday */}
                  <button
                    onClick={() => setDateFilter('yesterday')}
                    className={`px-2.5 py-1 rounded-full font-medium transition shrink-0 flex items-center gap-1 ${
                      dateFilter === 'yesterday'
                        ? 'bg-[#E50914] text-white shadow-sm'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    Yesterday
                    {yesterdayCount > 0 && (
                      <span className="text-[10px] bg-black/30 px-1.5 py-0.2 rounded-full font-bold">
                        {yesterdayCount}
                      </span>
                    )}
                  </button>

                  {/* Calendar Picker Trigger */}
                  <div className="relative shrink-0 flex items-center">
                    <input
                      ref={dateInputRef}
                      type="date"
                      value={customDate}
                      onChange={(e) => {
                        if (e.target.value) {
                          setCustomDate(e.target.value);
                          setDateFilter('calendar');
                        }
                      }}
                      className="sr-only"
                      aria-label="Pick notification date"
                    />
                    <button
                      type="button"
                      onClick={handleOpenDatePicker}
                      className={`px-2.5 py-1 rounded-full font-medium transition flex items-center gap-1.5 ${
                        dateFilter === 'calendar'
                          ? 'bg-[#E50914] text-white shadow-sm'
                          : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                      }`}
                      title="Select date from calendar"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>
                        {dateFilter === 'calendar' && customDate
                          ? new Date(customDate + 'T00:00:00').toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })
                          : 'Calendar'}
                      </span>
                    </button>
                  </div>

                  {/* Clear Filter button if custom date selected */}
                  {dateFilter === 'calendar' && (
                    <button
                      onClick={() => setDateFilter('all')}
                      className="p-1 text-gray-400 hover:text-white rounded-full hover:bg-white/10 transition"
                      title="Clear date filter"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'preferences' ? (
                <NotificationPreferences onClose={() => setActiveTab('inbox')} />
              ) : loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#E50914]" />
                  <p className="text-xs">Loading alerts...</p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-3 px-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-gray-400">
                    <Bell className="w-6 h-6" />
                  </div>
                  <p className="text-white font-semibold text-sm">No notifications yet</p>
                  <p className="text-xs text-gray-400">
                    Subscribe to movies, actors, or genres to get notified the second they are available.
                  </p>
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3 px-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-gray-400">
                    <CalendarDays className="w-6 h-6 text-[#E50914]" />
                  </div>
                  <p className="text-white font-semibold text-sm">No notifications on this day</p>
                  <p className="text-xs text-gray-400">
                    {dateFilter === 'today'
                      ? 'No alerts received today.'
                      : dateFilter === 'yesterday'
                      ? 'No alerts received yesterday.'
                      : `No alerts found for ${getRelativeDayLabel(customDate)}.`}
                  </p>
                  <button
                    onClick={() => setDateFilter('all')}
                    className="mt-2 text-xs font-semibold text-[#E50914] bg-[#E50914]/10 hover:bg-[#E50914]/20 border border-[#E50914]/30 px-3 py-1.5 rounded-lg transition"
                  >
                    View All Notifications
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {Object.entries(groupedNotifications).map(([dayKey, items]) => (
                    <div key={dayKey} className="border-b border-white/5 last:border-b-0">
                      {/* Day Group Header */}
                      <div className="sticky top-0 z-10 px-4 py-1.5 bg-[#171717]/95 backdrop-blur-md flex items-center justify-between border-b border-white/5 text-[11px] font-semibold text-gray-400">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-[#E50914]" />
                          <span>{getRelativeDayLabel(dayKey)}</span>
                        </div>
                        <span className="text-[10px] bg-white/10 text-gray-300 px-1.5 py-0.5 rounded-full font-mono">
                          {items.length} {items.length === 1 ? 'alert' : 'alerts'}
                        </span>
                      </div>

                      {/* Items for this day */}
                      <div className="divide-y divide-white/5">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => handleNotificationClick(item)}
                            className={`p-4 transition cursor-pointer hover:bg-white/5 flex gap-3 ${
                              !item.is_read ? 'bg-white/[0.03] border-l-2 border-[#E50914]' : ''
                            }`}
                          >
                            <div className="shrink-0 pt-0.5">
                              {item.image_url ? (
                                <img
                                  src={item.image_url}
                                  alt={item.title}
                                  className="w-10 h-14 object-cover rounded-md border border-white/10 shadow-sm shrink-0"
                                  onError={(e) => {
                                    e.target.style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-[#E50914]/10 border border-[#E50914]/20 flex items-center justify-center text-[#E50914]">
                                  <Film className="w-4 h-4" />
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="text-white text-sm font-semibold truncate">
                                  {item.title}
                                </h4>
                                <span className="text-[10px] text-gray-400 shrink-0 font-medium">
                                  {item.created_at
                                    ? new Date(item.created_at).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : ''}
                                </span>
                              </div>

                              <p className="text-gray-300 text-xs mt-1 line-clamp-2 leading-relaxed">
                                {item.body}
                              </p>

                              <div className="flex items-center justify-between mt-2 pt-1">
                                <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
                                  {item.category?.replace('_', ' ') || 'Notification'}
                                </span>
                                {!item.is_read && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMarkAsRead(item.id);
                                    }}
                                    className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1"
                                  >
                                    <CheckCircle2 className="w-3 h-3" /> Mark read
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
