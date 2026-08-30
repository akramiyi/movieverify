import React, { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { supabase } from '../data/supabaseClient';

const ReviewSection = ({ movieId, movieTitle }) => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const fetchReviews = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('movie_reviews')
      .select('*')
      .eq('movie_id', String(movieId))
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error && data) setReviews(data);
    setLoading(false);
  };

  useEffect(() => {
    if (movieId) fetchReviews();
  }, [movieId]);

  const handleSubmit = async () => {
    if (!rating || !comment.trim() || submitting) return;
    setSubmitting(true);

    try {
      const { error } = await supabase.from('movie_reviews').insert({
        movie_id: String(movieId),
        movie_title: movieTitle,
        user_name: userName.trim() || 'Anonymous',
        rating,
        comment: comment.trim(),
      });

      if (!error) {
        setRating(0);
        setComment('');
        setUserName('');
        setSubmitted(true);
        fetchReviews();
        setTimeout(() => setSubmitted(false), 2500);
      }
    } catch (err) {
      console.warn('Review submission failed:', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const avgRating = reviews.length
    ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">User Reviews</h3>
        {avgRating && (
          <div className="flex items-center gap-2 bg-[#242424] 
                          px-3 py-1.5 rounded-full">
            <Star className="w-4 h-4 text-yellow-400 fill-current" />
            <span className="text-white font-bold text-sm">
              {avgRating}
            </span>
            <span className="text-gray-400 text-xs">
              ({reviews.length})
            </span>
          </div>
        )}
      </div>

      {/* Write Review Form */}
      <div className="bg-[#242424] rounded-xl p-4 mb-6">
        <input
          type="text"
          placeholder="Your name (optional)"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          maxLength={30}
          className="w-full bg-[#181818] border border-white/10 
                     rounded-lg px-3 py-2 text-white text-sm mb-3 
                     outline-none focus:border-[#E50914] transition"
        />

        <div className="flex gap-1 mb-3">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(star)}
            >
              <Star
                className={`w-6 h-6 transition ${
                  star <= (hoverRating || rating)
                    ? 'text-yellow-400 fill-current'
                    : 'text-gray-600'
                }`}
              />
            </button>
          ))}
        </div>

        <textarea
          placeholder="Share your thoughts..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={2}
          className="w-full bg-[#181818] border border-white/10 
                     rounded-lg px-3 py-2 text-white text-sm mb-3 
                     outline-none focus:border-[#E50914] transition 
                     resize-none"
        />

        <button
          onClick={handleSubmit}
          disabled={!rating || !comment.trim() || submitting}
          className="bg-[#E50914] hover:bg-[#b81d24] 
                     disabled:bg-gray-600 disabled:cursor-not-allowed 
                     text-white text-sm font-bold px-5 py-2 
                     rounded-lg transition"
        >
          {submitting ? 'Posting...' : submitted ? '✓ Posted!' : 'Post Review'}
        </button>
      </div>

      {/* Reviews List */}
      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-gray-500 text-sm">Loading reviews...</p>
        ) : reviews.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6">
            No reviews yet. Be the first!
          </p>
        ) : (
          reviews.map((review) => (
            <div key={review.id} className="bg-[#1e1e1e] rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#E50914] 
                                  flex items-center justify-center 
                                  text-white font-bold text-[10px]">
                    {review.user_name[0].toUpperCase()}
                  </div>
                  <span className="text-white text-xs font-semibold">
                    {review.user_name}
                  </span>
                </div>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={`w-3 h-3 ${
                        s <= review.rating
                          ? 'text-yellow-400 fill-current'
                          : 'text-gray-700'
                      }`}
                    />
                  ))}
                </div>
              </div>
              <p className="text-gray-300 text-xs leading-relaxed">
                {review.comment}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ReviewSection;
