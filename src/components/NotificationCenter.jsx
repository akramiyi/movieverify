import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCircle2, Clock, ExternalLink, Settings, X, Film, CheckCheck, Loader2 } from 'lucide-react';
import { supabase } from '../data/supabaseClient';
import NotificationPreferences from './NotificationPreferences';

export default function NotificationCenter({ isOpen, onClose, onSelectMovie, onSelectActor }) {
  const [activeTab, setActiveTab] = useState('inbox'); // 'inbox' | 'preferences'
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setNotifications([]);
        setUnreadCount(0);
        return;
      }

      const res = await fetch('/api/notifications/user', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        const json = await res.json();
        setNotifications(json.notifications || []);
        setUnreadCount(json.unread_count || 0);
      }
    } catch (err) {
      console.warn('Failed to load notifications:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  const handleMarkAsRead = async (id) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch('/api/notifications/user', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ notification_id: id }),
      });

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err) {
      console.warn('Failed to mark read:', err.message);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setMarkingAll(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch('/api/notifications/user', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ mark_all: true }),
      });

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
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

    if (item.url) {
      // Check for deep link
      if (item.url.includes('id=') && onSelectMovie) {
        try {
          const match = item.url.match(/id=([0-9a-zA-Z_-]+)/);
          if (match && match[1]) {
            const cleanId = match[1].split('-')[0];
            onSelectMovie({ id: cleanId, title: item.title });
            onClose();
            return;
          }
        } catch {}
      }
      window.location.href = item.url;
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

              <div className="flex items-center gap-2">
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

            {/* Sub-header / Actions */}
            {activeTab === 'inbox' && (
              <div className="px-4 py-2 border-b border-white/5 bg-[#171717] flex items-center justify-between text-xs">
                <span className="text-gray-400">
                  {notifications.length} {notifications.length === 1 ? 'alert' : 'alerts'}
                </span>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    disabled={markingAll}
                    className="text-[#E50914] hover:underline flex items-center gap-1 font-semibold disabled:opacity-50"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    {markingAll ? 'Marking...' : 'Mark all as read'}
                  </button>
                )}
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
              ) : (
                <div className="divide-y divide-white/5">
                  {notifications.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleNotificationClick(item)}
                      className={`p-4 transition cursor-pointer hover:bg-white/5 flex gap-3 ${
                        !item.is_read ? 'bg-white/[0.03] border-l-2 border-[#E50914]' : ''
                      }`}
                    >
                      <div className="shrink-0 pt-0.5">
                        <div className="w-8 h-8 rounded-full bg-[#E50914]/10 border border-[#E50914]/20 flex items-center justify-center text-[#E50914]">
                          <Film className="w-4 h-4" />
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-white text-sm font-semibold truncate">
                            {item.title}
                          </h4>
                          <span className="text-[10px] text-gray-500 shrink-0">
                            {new Date(item.created_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}
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
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

