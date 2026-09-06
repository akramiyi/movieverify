import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { supabase } from '../data/supabaseClient';

const SiteLockScreen = ({ onUnlock }) => {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleUnlock = async (e) => {
    e.preventDefault();
    setChecking(true);
    setError('');

    try {
      const { data, error: fetchErr } = await supabase
        .from('site_settings')
        .select('lock_password')
        .eq('id', 1)
        .single();

      if (fetchErr) {
        setError('Unable to verify key. Try again.');
        setChecking(false);
        return;
      }

      if (keyInput.trim() === data.lock_password) {
        sessionStorage.setItem('movieverify_unlocked', 'true');
        onUnlock();
      } else {
        setError('Incorrect key. Please try again.');
      }
    } catch (err) {
      setError('Something went wrong.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#181818] border border-white/10 rounded-lg p-8 text-center">
        <div className="w-14 h-14 bg-[#E50914]/20 border border-[#E50914] text-[#E50914] flex items-center justify-center rounded-full mb-4 mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-2xl font-black text-white mb-2">Site Locked</h2>
        <p className="text-gray-400 text-sm mb-6">
          This site is currently private. Enter the access key to continue.
        </p>

        <form onSubmit={handleUnlock} className="space-y-4">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Enter access key"
            className="w-full bg-black/50 border border-white/10 rounded p-3 text-white text-center focus:border-[#E50914] outline-none transition text-sm"
            required
          />

          {error && (
            <p className="text-red-500 text-xs">{error}</p>
          )}

          <button
            type="submit"
            disabled={checking}
            className="w-full py-3 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white rounded font-bold transition text-sm"
          >
            {checking ? 'Checking...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default SiteLockScreen;
