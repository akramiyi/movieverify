import React, { useState, useEffect } from 'react';
import { supabase } from '../data/supabaseClient';
import { Film, Star, Flag, TrendingUp, Clock } from 'lucide-react';

const AnalyticsDashboard = () => {
  const [stats, setStats] = useState({
    totalMovies: 0,
    totalReviews: 0,
    totalReports: 0,
    pendingReports: 0,
    avgRating: 0,
    missing1080p: 0,
  });
  const [topReviewed, setTopReviewed] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const [linksRes, reviewsRes, reportsRes, pendingRes] = 
        await Promise.all([
          supabase.from('download_links').select('*'),
          supabase.from('movie_reviews').select('*'),
          supabase.from('movie_reports')
            .select('*', { count: 'exact', head: true }),
          supabase.from('movie_reports')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending'),
        ]);

      const links = linksRes.data || [];
      const reviews = reviewsRes.data || [];

      const avgRating = reviews.length
        ? (reviews.reduce((a, r) => a + r.rating, 0) / 
           reviews.length).toFixed(1)
        : 0;

      const missing1080p = links.filter(
        (l) => !l.download1080p || l.download1080p === '#'
      ).length;

      setStats({
        totalMovies: links.length,
        totalReviews: reviews.length,
        totalReports: reportsRes.count || 0,
        pendingReports: pendingRes.count || 0,
        avgRating,
        missing1080p,
      });

      // Top reviewed movies (group by movie_title)
      const grouped = {};
      reviews.forEach((r) => {
        if (!grouped[r.movie_title]) {
          grouped[r.movie_title] = { count: 0, totalRating: 0 };
        }
        grouped[r.movie_title].count += 1;
        grouped[r.movie_title].totalRating += r.rating;
      });

      const topList = Object.entries(grouped)
        .map(([title, data]) => ({
          title,
          count: data.count,
          avgRating: (data.totalRating / data.count).toFixed(1),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setTopReviewed(topList);

      // Recent activity - last 5 reviews
      const recent = [...reviews]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5);
      setRecentActivity(recent);

    } catch (err) {
      console.warn('Analytics fetch failed:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ icon: Icon, label, value, color }) => (
    <div className="bg-[#1a1a1a] border border-white/5 
                    rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="text-2xl md:text-3xl font-black text-white">
        {value}
      </div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-4">
        <p className="text-gray-500 text-sm">Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="text-white font-bold text-lg mb-4">
        Analytics Dashboard
      </h3>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <StatCard 
          icon={Film} 
          label="Total Movies" 
          value={stats.totalMovies} 
          color="text-blue-400" 
        />
        <StatCard 
          icon={Star} 
          label="Avg Rating" 
          value={stats.avgRating || 'N/A'} 
          color="text-yellow-400" 
        />
        <StatCard 
          icon={TrendingUp} 
          label="Total Reviews" 
          value={stats.totalReviews} 
          color="text-green-400" 
        />
        <StatCard 
          icon={Flag} 
          label="Pending Reports" 
          value={stats.pendingReports} 
          color="text-[#E50914]" 
        />
        <StatCard 
          icon={Flag} 
          label="Total Reports" 
          value={stats.totalReports} 
          color="text-gray-400" 
        />
        <StatCard 
          icon={Film} 
          label="Missing 1080p" 
          value={stats.missing1080p} 
          color="text-purple-400" 
        />
      </div>

      {/* Top Reviewed Movies */}
      <div className="mb-6">
        <h4 className="text-white font-semibold text-sm mb-3">
          Most Reviewed Movies
        </h4>
        {topReviewed.length === 0 ? (
          <p className="text-gray-500 text-sm">No reviews yet.</p>
        ) : (
          <div className="space-y-2">
            {topReviewed.map((item, idx) => (
              <div 
                key={idx} 
                className="flex items-center justify-between 
                           bg-[#1a1a1a] rounded-lg px-4 py-2"
              >
                <span className="text-white text-sm truncate">
                  {item.title}
                </span>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-gray-400 text-xs">
                    {item.count} reviews
                  </span>
                  <span className="flex items-center gap-1 
                                   text-yellow-400 text-xs font-bold">
                    <Star className="w-3 h-3 fill-current" />
                    {item.avgRating}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div>
        <h4 className="text-white font-semibold text-sm mb-3">
          Recent Reviews
        </h4>
        {recentActivity.length === 0 ? (
          <p className="text-gray-500 text-sm">No recent activity.</p>
        ) : (
          <div className="space-y-2">
            {recentActivity.map((item) => (
              <div 
                key={item.id} 
                className="flex items-start gap-2 bg-[#1a1a1a] 
                           rounded-lg px-4 py-2"
              >
                <Clock className="w-4 h-4 text-gray-500 mt-0.5 
                                  flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-white text-xs">
                    <span className="font-semibold">
                      {item.user_name}
                    </span>{' '}
                    reviewed{' '}
                    <span className="text-[#E50914]">
                      {item.movie_title}
                    </span>{' '}
                    ({item.rating}★)
                  </p>
                  <p className="text-gray-600 text-[10px] mt-0.5">
                    {new Date(item.created_at).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
