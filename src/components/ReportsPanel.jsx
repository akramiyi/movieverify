import React, { useState, useEffect } from 'react';
import { supabase } from '../data/supabaseClient';
import { Check, Trash2, AlertCircle } from 'lucide-react';

const ReportsPanel = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');

  const fetchReports = async () => {
    setLoading(true);
    const query = supabase
      .from('movie_reports')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (filter !== 'all') {
      query.eq('status', filter);
    }
    
    const { data, error } = await query;
    if (!error && data) setReports(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchReports();
  }, [filter]);

  const markResolved = async (id) => {
    const { error } = await supabase
      .from('movie_reports')
      .update({ status: 'resolved' })
      .eq('id', id);
    
    if (!error) {
      setReports(prev => prev.filter(r => r.id !== id));
    }
  };

  const deleteReport = async (id) => {
    if (!window.confirm('Delete this report?')) return;
    const { error } = await supabase
      .from('movie_reports')
      .delete()
      .eq('id', id);
    
    if (!error) {
      setReports(prev => prev.filter(r => r.id !== id));
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold text-lg">
          User Reports
        </h3>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-[#1a1a1a] border border-white/10 
                     rounded-lg px-3 py-1 text-white text-sm"
        >
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : reports.length === 0 ? (
        <p className="text-gray-500 text-sm py-8 text-center">
          No {filter} reports found.
        </p>
      ) : (
        <div className="space-y-3">
          {reports.map(report => (
            <div 
              key={report.id} 
              className="bg-[#1a1a1a] border border-white/5 
                         rounded-lg p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="w-4 h-4 text-yellow-500" />
                    <p className="text-white font-semibold text-sm">
                      {report.movie_title}
                    </p>
                  </div>
                  <p className="text-[#E50914] text-xs font-medium mb-1">
                    {report.issue_type}
                  </p>
                  {report.details && (
                    <p className="text-gray-400 text-xs mb-2">
                      {report.details}
                    </p>
                  )}
                  <p className="text-gray-600 text-xs">
                    {new Date(report.created_at).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="flex gap-2 ml-2">
                  {report.status === 'pending' && (
                    <button
                      onClick={() => markResolved(report.id)}
                      className="w-8 h-8 rounded-lg bg-green-600/20 
                                 hover:bg-green-600 text-green-400 
                                 hover:text-white flex items-center 
                                 justify-center transition"
                      title="Mark Resolved"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteReport(report.id)}
                    className="w-8 h-8 rounded-lg bg-red-600/20 
                               hover:bg-red-600 text-red-400 
                               hover:text-white flex items-center 
                               justify-center transition"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReportsPanel;
