import React, { useState, useEffect } from 'react';
import { Search, Save, Trash2, Key, Film, AlertCircle, CheckCircle, ArrowLeft, LogOut, X, Edit2 } from 'lucide-react';
import { supabase } from '../data/supabaseClient';
import { searchTMDB, activeLinks } from '../hooks/useTMDB';

const AdminPanel = ({ onClose }) => {
  // Login State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [emailVal, setEmailVal] = useState('');
  const [passVal, setPassVal] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Movie Search/Form State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  
  // Link Quality Fields
  const [link480, setLink480] = useState('');
  const [link720, setLink720] = useState('');
  const [link1080, setLink1080] = useState('');
  
  // Seasons Data for TV Shows
  const [seasonsData, setSeasonsData] = useState([]);

  // Status/Feedbacks
  const [actionStatus, setActionStatus] = useState({ type: '', message: '' });
  const [activeDbList, setActiveDbList] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [qualityFilter, setQualityFilter] = useState('all');

  // Check active session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          // Verify admin role in admin_users table
          const { data: adminData, error: adminErr } = await supabase
            .from('admin_users')
            .select('user_id')
            .eq('user_id', session.user.id)
            .maybeSingle();
          
          console.log('Supabase session:', !!session);
          console.log('Authenticated user ID (mount):', session.user?.id);
          console.log('Admin record found (mount):', adminData);
          console.log('Admin query error (mount):', adminErr);

          if (adminErr) {
             console.error('Admin authorization query failed (mount):', adminErr);
          }

          const isAdmin = !!(adminData && !adminErr);
          console.log('Admin authorized:', isAdmin);

          if (isAdmin) {
            setIsLoggedIn(true);
            fetchCurrentLinks();
          } else {
            // Not authorized
            await supabase.auth.signOut();
          }
        }
      } catch (err) {
        console.error('Session check failed:', err);
      }
    };
    checkSession();
  }, []);

  // Authenticate Admin Credentials using Supabase Auth
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsAuthenticating(true);

    try {
      // 1. Sign in using email/password
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: emailVal.trim(),
        password: passVal.trim()
      });

      if (authErr) {
        setLoginError(authErr.message || 'Invalid login credentials');
        setIsAuthenticating(false);
        return;
      }

      if (authData?.user) {
        // 2. Ensure session is established
        const { data: { user }, error: getUserErr } = await supabase.auth.getUser();
        
        if (getUserErr || !user) {
          setLoginError('Authentication session failed to establish.');
          setIsAuthenticating(false);
          return;
        }

        console.log('Authenticated user ID:', user.id);
        const { data: adminData, error: adminErr } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle();

        console.log('Admin record found:', adminData);
        console.log('Admin query error:', adminErr);

        if (adminErr) {
          console.error('Admin authorization query failed:', adminErr);
          setLoginError('Unable to verify admin access. Please try again.');
          await supabase.auth.signOut();
          setIsAuthenticating(false);
          return;
        }

        if (!adminData) {
          setLoginError('You are not authorized to access the Admin Panel.');
          await supabase.auth.signOut();
          setIsAuthenticating(false);
          return;
        }

        setIsLoggedIn(true);
        fetchCurrentLinks();
      }
    } catch (err) {
      console.error('Authentication process failed:', err);
      setLoginError('Server authentication error. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Sign out admin session
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setIsLoggedIn(false);
      setSelectedMovie(null);
      setEmailVal('');
      setPassVal('');
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  // Fetch all link configurations from Supabase
  const fetchCurrentLinks = async () => {
    setIsLoadingList(true);
    try {
      const { data, error } = await supabase
        .from('download_links')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      if (data) {
        data.forEach(row => {
          activeLinks[row.id] = {
            download480p: row.download480p || null,
            download720p: row.download720p || null,
            download1080p: row.download1080p || null,
            seasons: row.seasons || null
          };
        });
      }

      setActiveDbList(data || []);
    } catch (e) {
      console.error('Failed to load links from Supabase:', e);
    } finally {
      setIsLoadingList(false);
    }
  };

  // Search TMDB when typing movie title
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      try {
        const results = await searchTMDB(searchQuery);
        setSearchResults(results);
      } catch (err) {
        console.error('TMDB Search error in Admin:', err);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  // Load item into form for editing
  const handleEditItem = (item) => {
    const movieObj = {
      id: item.tmdb_id || item.id,
      title: item.title,
      mediaType: item.media_type,
      poster: null 
    };
    handleSelectMovie(movieObj);
  };

  // Handle movie selection from dropdown
  const handleSelectMovie = (movie) => {
    setSelectedMovie(movie);
    setSearchQuery('');
    setSearchResults([]);

    // Check if it already exists in Supabase to pre-fill links
    const existing = activeDbList.find(item => String(item.id) === String(movie.id) || String(item.tmdb_id) === String(movie.id));
    if (existing) {
      setLink480(existing.download480p || '');
      setLink720(existing.download720p || '');
      setLink1080(existing.download1080p || '');
      setSeasonsData(existing.seasons || []);
    } else {
      setLink480('');
      setLink720('');
      setLink1080('');
      setSeasonsData([]);
    }
  };

  // TV Shows dynamic handlers
  const handleAddSeason = () => setSeasonsData([...seasonsData, { season: seasonsData.length + 1, parts: [] }]);
  const handleRemoveSeason = (sIdx) => { const u = [...seasonsData]; u.splice(sIdx, 1); setSeasonsData(u); };
  const handleUpdateSeason = (sIdx, val) => { const u = [...seasonsData]; u[sIdx].season = Number(val); setSeasonsData(u); };
  const handleAddPart = (sIdx) => { const u = [...seasonsData]; u[sIdx].parts.push({ name: `Episode ${u[sIdx].parts.length + 1}`, download480p: '', download720p: '', download1080p: '' }); setSeasonsData(u); };
  const handleRemovePart = (sIdx, pIdx) => { const u = [...seasonsData]; u[sIdx].parts.splice(pIdx, 1); setSeasonsData(u); };
  const handleUpdatePart = (sIdx, pIdx, f, val) => { const u = [...seasonsData]; u[sIdx].parts[pIdx][f] = val; setSeasonsData(u); };

  // Save/Upsert links to Supabase
  const handleSave = async (e) => {
    e.preventDefault();
    if (!selectedMovie) return;

    setActionStatus({ type: '', message: '' });

    try {
      const { error } = await supabase
        .from('download_links')
        .upsert({
          id: `${selectedMovie.id}-${selectedMovie.mediaType || 'movie'}`,
          tmdb_id: String(selectedMovie.id),
          media_type: selectedMovie.mediaType || 'movie',
          title: selectedMovie.title,
          download480p: link480.trim() || null,
          download720p: link720.trim() || null,
          download1080p: link1080.trim() || null,
          seasons: seasonsData.length > 0 ? seasonsData : null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (error) throw error;

      setActionStatus({ type: 'success', message: `Links for "${selectedMovie.title}" successfully updated!` });
      setSelectedMovie(null);
      setLink480('');
      setLink720('');
      setLink1080('');
      setSeasonsData([]);
      fetchCurrentLinks();
    } catch (err) {
      console.error('Supabase save error details:', {
        code: err?.code,
        message: err?.message,
        details: err?.details,
        hint: err?.hint
      });
      setActionStatus({ 
        type: 'error', 
        message: `DB Error: ${err?.message || err?.code || 'Failed to update links'}` 
      });
    }
  };

  // Delete configuration from Supabase
  const handleDelete = async (id, title) => {
    if (!window.confirm(`Are you sure you want to delete download links for "${title}"?`)) return;

    try {
      const { error } = await supabase
        .from('download_links')
        .delete()
        .eq('id', String(id));

      if (error) throw error;

      delete activeLinks[String(id)];
      setActionStatus({ type: 'success', message: `Links for "${title}" deleted.` });
      fetchCurrentLinks();
    } catch (err) {
      console.error('Delete failed:', err);
      setActionStatus({ type: 'error', message: 'Failed to delete configuration.' });
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning, Akram 🌅';
    if (hour < 17) return 'Good Afternoon, Akram ☀️';
    return 'Good Evening, Akram 🌙';
  };

  if (!isLoggedIn) {
    return (
      <div className="fixed inset-0 z-[150] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md">
        <div className="w-full max-w-sm bg-[#181818] border border-white/10 rounded-lg p-6 shadow-2xl relative">
          
          <button 
            onClick={onClose}
            className="absolute top-4 left-4 text-gray-400 hover:text-white transition text-xs font-semibold flex items-center gap-1.5 focus:outline-none"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Site
          </button>

          <div className="flex flex-col items-center mt-6 mb-8 text-center">
            <div className="w-12 h-12 bg-[#E50914]/20 border border-[#E50914] text-[#E50914] flex items-center justify-center rounded-full mb-4">
              <Key className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-black text-white leading-tight">{getGreeting()}</h2>
            <p className="text-gray-400 text-xs mt-2">Sign in to MovieVerify Admin</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Admin Email</label>
              <input 
                type="email" 
                required
                value={emailVal}
                onChange={e => setEmailVal(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded p-3 text-white focus:border-[#E50914] outline-none transition text-sm"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Password</label>
              <input 
                type="password" 
                required
                value={passVal}
                onChange={e => setPassVal(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded p-3 text-white focus:border-[#E50914] outline-none transition text-sm"
              />
            </div>

            {loginError && (
              <div className="flex items-center gap-2 text-red-500 text-xs bg-red-950/30 border border-red-900/50 p-3 rounded">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button 
              type="submit"
              disabled={isAuthenticating}
              className="w-full py-3 bg-[#E50914] hover:bg-[#b80710] disabled:bg-red-800 disabled:opacity-50 text-white rounded font-bold transition text-sm shadow-lg mt-4 focus:outline-none"
            >
              {isAuthenticating ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[150] bg-black/95 flex flex-col p-4 md:p-8 overflow-y-auto backdrop-blur-md">
      <div className="w-full max-w-4xl mx-auto bg-[#181818] border border-white/10 rounded-lg p-6 md:p-8 shadow-2xl flex flex-col md:flex-row gap-8 relative mt-12">
        
        {/* Logout and Close headers */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <button 
            onClick={handleLogout}
            className="bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1 focus:outline-none"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
          <button 
            onClick={onClose}
            className="bg-white/10 hover:bg-white/20 text-white transition text-xs font-bold px-4 py-2 rounded-full focus:outline-none"
          >
            Close Manager
          </button>
        </div>

        {/* Left Form Panel */}
        <div className="flex-1 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 text-center">
              <div className="text-3xl font-black text-white">{totalMovies}</div>
              <div className="text-xs text-gray-400 mt-1">Total Movies</div>
            </div>
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 text-center">
              <div className="text-3xl font-black text-[#E50914]">{missing1080p}</div>
              <div className="text-xs text-gray-400 mt-1">Missing 1080p</div>
            </div>
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 text-center">
              <div className="text-3xl font-black text-yellow-400">{missing720p}</div>
              <div className="text-xs text-gray-400 mt-1">Missing 720p</div>
            </div>
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 text-center flex flex-col justify-center">
              <div className="text-xl font-black text-green-400">{lastUpdated}</div>
              <div className="text-xs text-gray-400 mt-1">Last Updated</div>
            </div>
          </div>

          <div>
            <h2 className="text-xl md:text-2xl font-black text-[#E50914] mb-4">{getGreeting()}</h2>
            <h3 className="text-lg md:text-xl font-bold text-white">Manage Downloads</h3>
            <p className="text-gray-400 text-xs mt-1">Search TMDB movies/series and assign download URLs</p>
          </div>

          {actionStatus.message && (
            <div className={`flex items-center gap-2 p-3 rounded text-xs border ${
              actionStatus.type === 'success' ? 'bg-green-950/20 border-green-900/50 text-green-400' : 'bg-red-950/20 border-red-900/50 text-red-400'
            }`}>
              {actionStatus.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span>{actionStatus.message}</span>
            </div>
          )}

          {/* TMDB Search */}
          <div className="relative">
            <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Search TMDB Movie/Series</label>
            <div className="relative">
              <Search className="absolute left-3 top-3.5 text-gray-400 w-4 h-4" />
              <input 
                type="text"
                placeholder="Type movie name to search TMDB..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded p-3 pl-10 text-white focus:border-[#E50914] outline-none transition text-sm"
              />
            </div>

            {/* Results Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-[#222] border border-white/10 rounded-b shadow-2xl z-50 max-h-60 overflow-y-auto">
                {searchResults.map(item => (
                  <div 
                    key={item.id}
                    onClick={() => handleSelectMovie(item)}
                    className="p-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition flex items-center gap-3 text-sm text-gray-200"
                  >
                    {item.poster ? (
                      <img src={item.poster} alt={item.title} className="w-8 h-12 object-cover rounded" />
                    ) : (
                      <div className="w-8 h-12 bg-white/5 rounded flex items-center justify-center"><Film className="w-4 h-4 text-gray-500" /></div>
                    )}
                    <div>
                      <div className="font-bold text-white">{item.title} ({item.year})</div>
                      <div className="text-xs text-gray-400 capitalize">{item.mediaType}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Form details once a movie is selected */}
          {selectedMovie ? (
            <form onSubmit={handleSave} className="space-y-4 border-t border-white/5 pt-4">
              <div className="flex items-center gap-3 bg-white/5 p-3 rounded">
                {selectedMovie.poster && (
                  <img src={selectedMovie.poster} alt={selectedMovie.title} className="w-10 h-15 object-cover rounded" />
                )}
                <div>
                  <h3 className="font-bold text-white">{selectedMovie.title}</h3>
                  <p className="text-xs text-[#E50914] capitalize font-semibold">{selectedMovie.mediaType} • TMDB ID: {selectedMovie.id}</p>
                </div>
              </div>

              {selectedMovie.mediaType === 'tv' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-white font-bold">Seasons & Episodes</h4>
                    <button type="button" onClick={handleAddSeason} className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-white font-bold transition">+ Add Season</button>
                  </div>
                  {seasonsData.map((s, sIdx) => (
                    <div key={sIdx} className="bg-black/30 p-4 border border-white/5 rounded-lg space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold text-sm">Season</span>
                          <input type="number" value={s.season} onChange={(e) => handleUpdateSeason(sIdx, e.target.value)} className="w-16 bg-black/50 border border-white/10 p-1 text-white text-center rounded outline-none" min="1" />
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => handleAddPart(sIdx)} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 bg-blue-900/20 rounded transition font-bold">+ Add Episode</button>
                          <button type="button" onClick={() => handleRemoveSeason(sIdx)} className="text-xs text-red-500 hover:text-red-400 p-1.5 bg-red-900/20 rounded transition"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                      
                      {s.parts.map((p, pIdx) => (
                        <div key={pIdx} className="bg-white/5 p-3 rounded-lg space-y-3 border border-white/5 relative mt-3">
                          <button type="button" onClick={() => handleRemovePart(sIdx, pIdx)} className="absolute top-2 right-2 text-red-500 hover:text-red-400 p-1"><X className="w-4 h-4" /></button>
                          <div className="pr-8">
                            <label className="block text-gray-400 text-[10px] uppercase mb-1 font-semibold tracking-wider">Episode Title</label>
                            <input type="text" value={p.name} onChange={(e) => handleUpdatePart(sIdx, pIdx, 'name', e.target.value)} placeholder="e.g. S01E01 - Pilot" className="w-full bg-black/50 border border-white/10 p-2 text-white text-sm rounded outline-none focus:border-[#E50914] transition" />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-gray-400 text-[10px] uppercase mb-1 font-semibold tracking-wider">480p URL</label>
                              <input type="url" value={p.download480p} onChange={(e) => handleUpdatePart(sIdx, pIdx, 'download480p', e.target.value)} placeholder="URL" className="w-full bg-black/50 border border-white/10 p-2 text-white text-sm rounded outline-none focus:border-[#E50914] transition" />
                            </div>
                            <div>
                              <label className="block text-gray-400 text-[10px] uppercase mb-1 font-semibold tracking-wider">720p URL</label>
                              <input type="url" value={p.download720p} onChange={(e) => handleUpdatePart(sIdx, pIdx, 'download720p', e.target.value)} placeholder="URL" className="w-full bg-black/50 border border-white/10 p-2 text-white text-sm rounded outline-none focus:border-[#E50914] transition" />
                            </div>
                            <div>
                              <label className="block text-gray-400 text-[10px] uppercase mb-1 font-semibold tracking-wider">1080p URL</label>
                              <input type="url" value={p.download1080p} onChange={(e) => handleUpdatePart(sIdx, pIdx, 'download1080p', e.target.value)} placeholder="URL" className="w-full bg-black/50 border border-white/10 p-2 text-white text-sm rounded outline-none focus:border-[#E50914] transition" />
                            </div>
                          </div>
                        </div>
                      ))}
                      {s.parts.length === 0 && <div className="text-gray-500 text-xs italic">No episodes added yet.</div>}
                    </div>
                  ))}
                  {seasonsData.length === 0 && (
                    <div className="text-center p-6 border border-white/10 border-dashed rounded text-gray-500 text-sm">No seasons added yet. Click "+ Add Season" to begin.</div>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">480p Download URL</label>
                    <input 
                      type="url"
                      placeholder="https://your-authorized-link.com/480p"
                      value={link480}
                      onChange={e => setLink480(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded p-3 text-white focus:border-[#E50914] outline-none transition text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">720p Download URL</label>
                    <input 
                      type="url"
                      placeholder="https://your-authorized-link.com/720p"
                      value={link720}
                      onChange={e => setLink720(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded p-3 text-white focus:border-[#E50914] outline-none transition text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">1080p Download URL</label>
                    <input 
                      type="url"
                      placeholder="https://your-authorized-link.com/1080p"
                      value={link1080}
                      onChange={e => setLink1080(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded p-3 text-white focus:border-[#E50914] outline-none transition text-sm"
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-[#E50914] hover:bg-[#b80710] text-white rounded font-bold transition text-sm flex items-center justify-center gap-2 focus:outline-none"
                >
                  <Save className="w-4 h-4" /> Save Configuration
                </button>
                <button 
                  type="button"
                  onClick={() => setSelectedMovie(null)}
                  className="py-3 px-6 bg-white/10 hover:bg-white/20 text-white rounded font-bold transition text-sm focus:outline-none"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="border border-dashed border-white/10 rounded-lg p-8 text-center text-gray-500">
              <Film className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Search and select a movie above to configure download links.</p>
            </div>
          )}
        </div>

        {/* Right Active Configurations Panel */}
        <div className="w-full md:w-[350px] border-t md:border-t-0 md:border-l border-white/10 pt-6 md:pt-0 md:pl-6 flex flex-col">
          <div className="mb-4">
            <h3 className="font-extrabold text-white text-lg">Configured Downloads</h3>
            <p className="text-gray-400 text-xs">Total configured: {activeDbList.length}</p>
          </div>

          <input
            type="text"
            placeholder="Search movies..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-4 py-2 text-white text-sm outline-none focus:border-[#E50914] transition mb-3"
          />

          <div className="flex gap-2 mb-3 flex-wrap">
            <button
              onClick={() => setQualityFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition ${qualityFilter === 'all' ? 'bg-[#E50914] text-white' : 'bg-[#2a2a2a] text-gray-400 hover:text-white'}`}
            >
              All Movies
            </button>
            <button
              onClick={() => setQualityFilter('missing1080p')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition ${qualityFilter === 'missing1080p' ? 'bg-[#E50914] text-white' : 'bg-[#2a2a2a] text-gray-400 hover:text-white'}`}
            >
              Missing 1080p
            </button>
            <button
              onClick={() => setQualityFilter('missing720p')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition ${qualityFilter === 'missing720p' ? 'bg-[#E50914] text-white' : 'bg-[#2a2a2a] text-gray-400 hover:text-white'}`}
            >
              Missing 720p
            </button>
            <button
              onClick={() => setQualityFilter('complete')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition ${qualityFilter === 'complete' ? 'bg-green-600 text-white' : 'bg-[#2a2a2a] text-gray-400 hover:text-white'}`}
            >
              ✓ Complete
            </button>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[350px] md:max-h-[500px] space-y-3 pr-2">
            {isLoadingList ? (
              <p className="text-gray-500 text-xs">Loading downloads database...</p>
            ) : filteredSavedMovies.length === 0 ? (
              <p className="text-gray-500 text-xs">No movies match your filters.</p>
            ) : (
              filteredSavedMovies.map(item => (
                <div key={item.id} className="flex items-center justify-between bg-[#1a1a1a] rounded-lg px-3 py-2 mb-2 group hover:bg-[#242424] transition border border-white/5">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate" title={item.title}>
                      {item.title}
                    </p>
                    <div className="flex gap-1 mt-1">
                      {item.download480p && item.download480p !== '#' && (
                        <span className="text-[10px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded">480p</span>
                      )}
                      {item.download720p && item.download720p !== '#' && (
                        <span className="text-[10px] bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded">720p</span>
                      )}
                      {item.download1080p && item.download1080p !== '#' && (
                        <span className="text-[10px] bg-purple-900/50 text-purple-400 px-1.5 py-0.5 rounded">1080p</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onClick={() => handleEditItem(item)}
                      className="w-7 h-7 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white flex items-center justify-center transition"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(item.id, item.title)}
                      className="w-7 h-7 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white flex items-center justify-center transition"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
