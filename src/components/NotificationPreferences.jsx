import React, { useState, useEffect } from 'react';
import { Settings, Shield, Bell, Check, Loader2 } from 'lucide-react';
import { supabase } from '../data/supabaseClient';

const CATEGORY_META = {
  movie_release: {
    label: 'New Movie & Show Releases',
    desc: 'Alerts when your subscribed movies, actors, or genres become available.',
  },
  content_update: {
    label: 'Content Updates & Links',
    desc: 'Notifies you when 1080p/4K links or new episodes are added.',
  },
  user_alert: {
    label: 'Personal Account Alerts',
    desc: 'Security alerts and critical updates for your MovieVerify account.',
  },
  admin_announcement: {
    label: 'Community Announcements',
    desc: 'Major platform updates, scheduled maintenance, and new features.',
  },
  promotional: {
    label: 'Recommendations & Discoveries',
    desc: 'Curated weekly recommendations and trending collections.',
  },
};

export default function NotificationPreferences({ onClose }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingCat, setUpdatingCat] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchPrefs = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setLoading(false);
          return;
        }

        const res = await fetch('/api/notifications/preferences', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = await res.json();
          if (isMounted) setCategories(json.categories || []);
        }
      } catch (err) {
        console.warn('Failed to load notification preferences:', err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchPrefs();
    return () => { isMounted = false; };
  }, []);

  const handleToggle = async (catName, currentEnabled) => {
    setUpdatingCat(catName);
    const newEnabled = !currentEnabled;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ category: catName, enabled: newEnabled }),
      });

      if (res.ok) {
        setCategories((prev) =>
          prev.map((c) => (c.category === catName ? { ...c, enabled: newEnabled } : c))
        );
      }
    } catch (err) {
      console.warn('Failed to update preference:', err.message);
    } finally {
      setUpdatingCat(null);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
        <Settings className="w-5 h-5 text-[#E50914]" />
        <h3 className="text-white font-bold text-base">Notification Preferences</h3>
      </div>

      <p className="text-gray-400 text-xs">
        Choose which types of push notifications you want to receive on your registered devices.
      </p>

      {loading ? (
        <div className="py-8 flex justify-center text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin text-[#E50914]" />
        </div>
      ) : categories.length === 0 ? (
        <p className="text-gray-500 text-xs text-center py-4">
          Please sign in to manage personalized notification categories.
        </p>
      ) : (
        <div className="space-y-3">
          {categories.map((cat) => {
            const meta = CATEGORY_META[cat.category] || {
              label: cat.category,
              desc: 'Push notifications for this category',
            };
            const isUpdating = updatingCat === cat.category;

            return (
              <div
                key={cat.category}
                className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition"
              >
                <div className="pr-4">
                  <p className="text-white text-sm font-semibold">{meta.label}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{meta.desc}</p>
                </div>

                <button
                  onClick={() => handleToggle(cat.category, cat.enabled)}
                  disabled={isUpdating}
                  className={`w-12 h-6 flex items-center rounded-full p-1 transition duration-300 focus:outline-none ${
                    cat.enabled ? 'bg-[#E50914]' : 'bg-gray-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition duration-300 flex items-center justify-center ${
                      cat.enabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  >
                    {isUpdating && <Loader2 className="w-2.5 h-2.5 animate-spin text-gray-700" />}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

