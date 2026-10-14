import React, { useState, useEffect } from 'react';
import { Search, Bell, User, Menu, X, Clock, Download, LogOut, ShieldCheck, Check, ChevronDown } from 'lucide-react';
import { supabase } from '../data/supabaseClient';
import SearchSuggestions from './SearchSuggestions';
import { searchTMDB } from '../hooks/useTMDB';
import { motion } from 'framer-motion';

const LiveTime = () => {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 10);
    return () => clearInterval(timer);
  }, []);

  // Format: HH:MM:SS.mmm AM/PM
  const h = time.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const formattedTime = `${String(h12).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}:${String(time.getSeconds()).padStart(2,'0')}.${String(time.getMilliseconds()).padStart(3,'0')} ${ampm}`;

  return (
    <div className="hidden sm:flex items-center gap-1.5 text-gray-200 font-mono text-xs tracking-wider mr-2 w-48 font-bold">
      <Clock className="w-4 h-4 text-[#E50914]" />
      {formattedTime}
    </div>
  );
};

const Navbar = ({ onSearch, searchQuery, activeTab = 'home', setActiveTab, onProfileClick, onAdminClick, onHistoryClick }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [pendingReports, setPendingReports] = useState(0);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [logoAnimated, setLogoAnimated] = useState(() => {
    return !localStorage.getItem('movieverify_logo_animated');
  });

  useEffect(() => {
    if (logoAnimated) {
      const timer = setTimeout(() => {
        localStorage.setItem('movieverify_logo_animated', 'true');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [logoAnimated]);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const results = await searchTMDB(searchQuery);
        setSuggestions(results.slice(0, 5));
      } catch (err) {
        console.warn('Suggestion fetch failed:', err.message);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const checkReports = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return; // only fetch if admin is logged in
        
        const { count, error } = await supabase
          .from('movie_reports')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');
        
        if (!error) {
          setPendingReports(count || 0);
        }
      } catch {
        // Silently ignore if database is unreachable
      }
    };
    checkReports();
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 0) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Track session and admin status
  useEffect(() => {
    let isMounted = true;

    const verifyAdmin = async (userId) => {
      try {
        const { data, error } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (isMounted) {
          setIsAdminUser(!error && !!data);
        }
      } catch {
        if (isMounted) setIsAdminUser(false);
      }
    };

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      setCurrentUser(session?.user ?? null);
      if (session?.user?.id) {
        verifyAdmin(session.user.id);
      } else {
        setIsAdminUser(false);
      }
    });

    // Listen to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setCurrentUser(session?.user ?? null);
      if (session?.user?.id) {
        verifyAdmin(session.user.id);
      } else {
        setIsAdminUser(false);
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!isProfileMenuOpen) return;
    const handleOutsideClick = (e) => {
      if (!e.target.closest('#navbar-profile-container')) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isProfileMenuOpen]);

  const handleSignOut = async () => {
    setIsProfileMenuOpen(false);
    try {
      await supabase.auth.signOut();
      setCurrentUser(null);
      setIsAdminUser(false);
    } catch (err) {
      console.warn('Sign out error:', err?.message);
    }
  };

  return (
    <nav 
      className={`fixed top-0 w-full z-50 transition-colors duration-500 ease-in-out ${
        isScrolled || isMobileMenuOpen ? 'bg-[#141414]' : 'bg-gradient-to-b from-black/80 to-transparent'
      }`}
    >
      <div className="px-4 md:px-12 py-4 flex items-center justify-between">
        
        {/* Left Side - Logo & Links */}
        <div className="flex items-center gap-4 md:gap-8">
          {/* Hamburger Menu Icon for Mobile */}
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden text-white focus:outline-none"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <div 
            onClick={() => { setActiveTab('home'); onSearch(''); }}
            className="flex items-center gap-1.5 cursor-pointer select-none font-black text-lg md:text-2xl"
          >
            <motion.div 
              initial={logoAnimated ? { rotate: -360, opacity: 0, scale: 0.5 } : false}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 bg-gradient-to-br from-[#FF3445] to-[#E50914] rounded-md shadow-[0_0_10px_rgba(229,9,20,0.5)] text-white text-sm md:text-base font-black"
            >
              M
            </motion.div>
            <motion.span 
              initial={logoAnimated ? { x: -20, opacity: 0 } : false}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.6, ease: "easeOut" }}
              className="text-white tracking-tighter font-sans uppercase"
            >
              Ovie<span className="text-[#E50914]">verify</span>
            </motion.span>
          </div>
          
          <div className="hidden lg:flex items-center gap-5 text-sm font-medium text-gray-300">
            <button 
              onClick={() => { setActiveTab('home'); onSearch(''); }}
              className={`transition ${activeTab === 'home' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              Home
            </button>
            <button 
              onClick={() => { setActiveTab('tv'); onSearch(''); }}
              className={`transition ${activeTab === 'tv' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              TV Shows
            </button>
            <button 
              onClick={() => { setActiveTab('movies'); onSearch(''); }}
              className={`transition ${activeTab === 'movies' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              Movies
            </button>
            <button 
              onClick={() => { setActiveTab('popular'); onSearch(''); }}
              className={`transition ${activeTab === 'popular' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              New & Popular
            </button>
            <button 
              onClick={() => { setActiveTab('mylist'); onSearch(''); }}
              className={`transition ${activeTab === 'mylist' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              My List
            </button>
          </div>
        </div>

        {/* Right Side - Search & Profile */}
        <div className="flex items-center gap-4 md:gap-6">
          <div className={`relative flex items-center transition-all duration-300 ${isSearchExpanded ? 'bg-black border border-white px-3 py-1.5' : 'bg-transparent'}`}>
            <button 
              onClick={() => setIsSearchExpanded(!isSearchExpanded)}
              className="text-white focus:outline-none flex items-center justify-center"
            >
              <Search className="w-5 h-5 md:w-6 md:h-6 stroke-[2.5]" />
            </button>
            <input 
              type="text"
              placeholder="Titles, genres"
              value={searchQuery}
              onChange={(e) => {
                if(!isSearchExpanded) setIsSearchExpanded(true);
                onSearch(e.target.value);
              }}
              className={`bg-transparent text-white text-sm outline-none transition-all duration-300 placeholder-gray-400 ${
                isSearchExpanded ? 'w-36 md:w-52 ml-3 opacity-100' : 'w-0 opacity-0'
              }`}
            />
            <SearchSuggestions 
              suggestions={suggestions}
              visible={isSearchExpanded && searchQuery.length >= 2}
              onSelect={(movie) => {
                onSearch(movie.title);
                setSuggestions([]);
              }}
            />
          </div>
          
          <LiveTime />

          <button 
            onClick={onHistoryClick}
            className="text-white hidden sm:block hover:text-[#E50914] transition"
            title="Download History"
          >
            <Download className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          <button className="text-white hidden sm:block relative">
            <Bell className="w-5 h-5 md:w-6 md:h-6" />
            {pendingReports > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 
                               bg-[#E50914] rounded-full text-[9px] 
                               font-bold flex items-center justify-center 
                               text-white">
                {pendingReports > 9 ? '9+' : pendingReports}
              </span>
            )}
          </button>
          
          {/* Profile & Auth Section */}
          <div id="navbar-profile-container" className="relative">
            {currentUser ? (
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                aria-expanded={isProfileMenuOpen}
                aria-label="User profile menu"
                className="flex items-center gap-2 cursor-pointer p-0.5 rounded-lg hover:ring-2 hover:ring-white/30 transition-all focus:outline-none"
              >
                {currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture ? (
                  <img
                    src={currentUser.user_metadata.avatar_url || currentUser.user_metadata.picture}
                    alt={currentUser.user_metadata?.full_name || 'Profile'}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-lg object-cover ring-1 ring-white/20"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#E50914] to-red-800 flex items-center justify-center text-white font-bold text-xs shadow-md">
                    {(currentUser.user_metadata?.full_name || currentUser.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 hidden sm:block transition-transform duration-200 ${isProfileMenuOpen ? 'rotate-180 text-white' : ''}`} />
              </button>
            ) : (
              <button 
                type="button"
                onClick={() => {
                  if (onProfileClick) {
                    onProfileClick();
                  } else if (onAdminClick) {
                    onAdminClick();
                  }
                }} 
                aria-label="Sign in"
                className="flex items-center gap-2 cursor-pointer hover:opacity-85 transition-opacity focus:outline-none group"
                title="Sign In / Admin Login"
              >
                <div className="w-8 h-8 rounded bg-[#E50914] group-hover:bg-[#b80710] transition flex items-center justify-center text-white shadow-md">
                  <User className="w-5 h-5 pointer-events-none" />
                </div>
                <span className="hidden sm:block text-white text-xs pointer-events-none">&#9662;</span>
              </button>
            )}

            {/* Profile Dropdown Menu */}
            {isProfileMenuOpen && currentUser && (
              <div className="absolute right-0 top-full mt-3 w-72 bg-[#181818] border border-white/10 rounded-2xl shadow-2xl p-4 text-white z-[120] animate-in fade-in zoom-in-95 duration-150">
                {/* User Info Header */}
                <div className="flex items-center gap-3 pb-3 border-b border-white/10">
                  {currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture ? (
                    <img
                      src={currentUser.user_metadata.avatar_url || currentUser.user_metadata.picture}
                      alt="User avatar"
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-xl object-cover ring-2 ring-white/10 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#E50914] to-red-800 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-md">
                      {(currentUser.user_metadata?.full_name || currentUser.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">
                      {currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || 'Viewer'}
                    </div>
                    <div className="text-xs text-gray-400 truncate">
                      {currentUser.email}
                    </div>
                    <div className="mt-1">
                      {isAdminUser ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-950/80 text-red-400 border border-red-800/60">
                          <ShieldCheck className="w-3 h-3" /> Administrator
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/50">
                          <Check className="w-3 h-3" /> Verified Account
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 space-y-1">
                  {isAdminUser ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsProfileMenuOpen(false);
                        if (onAdminClick) onAdminClick();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg bg-red-950/40 hover:bg-red-900/50 text-red-200 hover:text-white transition cursor-pointer text-left"
                    >
                      <ShieldCheck className="w-4 h-4 text-red-400" />
                      <span>Admin Control Panel</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsProfileMenuOpen(false);
                        if (onAdminClick) onAdminClick();
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg hover:bg-white/5 text-gray-300 hover:text-white transition cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-gray-400" />
                        <span>Admin Login</span>
                      </div>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                        Staff
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg hover:bg-red-950/30 text-gray-400 hover:text-red-400 transition cursor-pointer text-left"
                  >
                    <LogOut className="w-4 h-4 text-gray-400 hover:text-red-400" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown Links */}
      {isMobileMenuOpen && (
        <div className="lg:hidden bg-[#141414] border-t border-white/10 px-6 py-4 flex flex-col gap-4 text-sm font-medium text-gray-300 transition-all duration-300">
          <button 
            onClick={() => { setActiveTab('home'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'home' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            Home
          </button>
          <button 
            onClick={() => { setActiveTab('tv'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'tv' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            TV Shows
          </button>
          <button 
            onClick={() => { setActiveTab('movies'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'movies' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            Movies
          </button>
          <button 
            onClick={() => { setActiveTab('popular'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'popular' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            New & Popular
          </button>
          <button 
            onClick={() => { setActiveTab('mylist'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'mylist' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            My List
          </button>

          {/* Mobile Auth Quick Row */}
          <div className="pt-3 mt-1 border-t border-white/10 flex items-center justify-between">
            {currentUser ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  {currentUser.user_metadata?.avatar_url ? (
                    <img
                      src={currentUser.user_metadata.avatar_url}
                      alt="Avatar"
                      referrerPolicy="no-referrer"
                      className="w-7 h-7 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[#E50914] flex items-center justify-center text-xs font-bold text-white">
                      {(currentUser.user_metadata?.full_name || currentUser.email || 'U')[0]}
                    </div>
                  )}
                  <span className="text-xs text-gray-200 truncate max-w-[140px]">
                    {currentUser.user_metadata?.full_name || currentUser.email}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    handleSignOut();
                  }}
                  className="text-xs text-red-400 hover:text-red-300 font-semibold"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (onProfileClick) onProfileClick();
                }}
                className="w-full py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-center rounded font-semibold text-xs"
              >
                Sign In / Admin Login
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
