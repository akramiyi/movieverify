import { supabase } from '../data/supabaseClient';

const STORAGE_HASH_KEY = 'moviex_premium_x_pin_hash';
const DEFAULT_FALLBACK_PIN = '123456';

// Cryptographic hash helper using SHA-256 with consistent salt
export async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`moviex_salt_${pin}_2026_secure`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fetch the active PIN hash from Supabase site_settings, falling back to localStorage
export async function getActiveLockerHash() {
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('locker_pin_hash')
      .eq('id', 1)
      .maybeSingle();

    if (!error && data?.locker_pin_hash) {
      localStorage.setItem(STORAGE_HASH_KEY, data.locker_pin_hash);
      return data.locker_pin_hash;
    }
  } catch {}

  const local = localStorage.getItem(STORAGE_HASH_KEY);
  if (local) return local;

  // Generate fallback default hash
  const defaultHash = await hashPin(DEFAULT_FALLBACK_PIN);
  return defaultHash;
}

// Admin only: Update the active 6-digit PIN hash across Supabase and local storage
export async function updateLockerPin(newPin) {
  if (!newPin || String(newPin).length !== 6) {
    throw new Error('Code must be exactly 6 numeric digits');
  }

  const hashed = await hashPin(String(newPin));

  // Save to local
  localStorage.setItem(STORAGE_HASH_KEY, hashed);

  // Sync to database site_settings table if available
  try {
    await supabase
      .from('site_settings')
      .upsert({
        id: 1,
        locker_pin_hash: hashed,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
  } catch (err) {
    console.warn('[Locker] Cloud sync notice:', err.message);
  }

  return hashed;
}

// Verify entered PIN against active master hash
export async function verifyLockerPin(enteredPin) {
  if (!enteredPin || String(enteredPin).length !== 6) return false;
  const activeHash = await getActiveLockerHash();
  const enteredHash = await hashPin(String(enteredPin));
  return activeHash === enteredHash;
}
