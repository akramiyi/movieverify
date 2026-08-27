import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';

const InstallPWA = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowButton(true);
    });
    window.addEventListener('appinstalled', () => {
      setShowButton(false);
    });
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShowButton(false);
    setDeferredPrompt(null);
  };

  if (!showButton) return null;

  return (
    <button
      onClick={handleInstall}
      className="fixed bottom-6 left-6 z-50 bg-[#E50914] 
                 text-white rounded-full px-5 py-3 
                 flex items-center gap-2 shadow-lg 
                 hover:bg-[#b81d24] transition font-bold text-sm"
    >
      <Download className="w-4 h-4" />
      Install App
    </button>
  );
};

export default InstallPWA;
