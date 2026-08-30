import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flag, X } from 'lucide-react';
import { supabase } from '../data/supabaseClient';

const ReportProblemButton = ({ movieId, movieTitle }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [issueType, setIssueType] = useState('Broken Link');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    
    try {
      const { error } = await supabase.from('movie_reports').insert({
        movie_id: String(movieId),
        movie_title: movieTitle,
        issue_type: issueType,
        details: details.trim() || null,
      });
      
      if (!error) {
        setSubmitted(true);
        setDetails('');
        setTimeout(() => {
          setSubmitted(false);
          setIsOpen(false);
        }, 2000);
      }
    } catch (err) {
      console.warn('Report submission failed:', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-gray-400 
                   hover:text-[#E50914] text-sm transition"
      >
        <Flag className="w-4 h-4" />
        Report a Problem
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 bg-[#242424] rounded-lg p-4 overflow-hidden"
          >
            {submitted ? (
              <p className="text-green-400 text-sm">
                ✓ Thanks! Your report has been submitted.
              </p>
            ) : (
              <>
                <select
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value)}
                  className="w-full bg-[#181818] border border-white/10 
                             rounded-lg px-3 py-2 text-white text-sm 
                             mb-3 outline-none focus:border-[#E50914]"
                >
                  <option>Broken Link</option>
                  <option>Wrong Movie</option>
                  <option>Wrong Quality</option>
                  <option>Poor Video Quality</option>
                  <option>Other</option>
                </select>

                <textarea
                  placeholder="Additional details (optional)"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  maxLength={300}
                  rows={2}
                  className="w-full bg-[#181818] border border-white/10 
                             rounded-lg px-3 py-2 text-white text-sm 
                             mb-3 outline-none focus:border-[#E50914] 
                             resize-none"
                />

                <div className="flex gap-2">
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="bg-[#E50914] hover:bg-[#b81d24] 
                               disabled:opacity-50 text-white text-sm 
                               font-semibold px-4 py-2 rounded-lg 
                               transition"
                  >
                    {submitting ? 'Submitting...' : 'Submit Report'}
                  </button>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="text-gray-400 hover:text-white text-sm 
                               px-4 py-2"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ReportProblemButton;
