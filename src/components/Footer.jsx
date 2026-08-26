import React from 'react';
import { Download, Heart, Tv2, Send, Globe } from 'lucide-react';

const Footer = () => {
  return (
    <footer className="relative mt-20 border-t border-white/10 bg-background pt-16 pb-8 overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-1/2 bg-primary/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Download className="text-primary w-8 h-8" />
              <h2 className="text-2xl font-bold tracking-wider">
                Movie<span className="text-primary">Verfy</span>
              </h2>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed max-w-xs">
              Your ultimate destination for downloading premium movies and web series in stunning high definition quality. Experience cinema like never before.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-bold mb-6 text-lg">Quick Links</h3>
            <ul className="space-y-3">
              {['Home', 'Latest Releases', 'Request Movie', 'DMCA', 'Contact Us'].map((link) => (
                <li key={link}>
                  <a href="#" className="text-gray-400 hover:text-primary transition-colors text-sm flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-primary/50 before:rounded-full before:transition-all hover:before:bg-primary hover:before:scale-150">
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h3 className="text-white font-bold mb-6 text-lg">Top Categories</h3>
            <ul className="space-y-3">
              {['Bollywood', 'Hollywood', 'South Indian', 'Web Series', 'Anime'].map((cat) => (
                <li key={cat}>
                  <a href="#" className="text-gray-400 hover:text-primary transition-colors text-sm flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-secondary/50 before:rounded-full before:transition-all hover:before:bg-secondary hover:before:scale-150">
                    {cat}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Social */}
          <div>
            <h3 className="text-white font-bold mb-6 text-lg">Connect With Us</h3>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 rounded-full glass hover:bg-white/10 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors group">
                <Tv2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full glass hover:bg-white/10 flex items-center justify-center text-gray-300 hover:text-blue-400 transition-colors group">
                <Send className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full glass hover:bg-white/10 flex items-center justify-center text-gray-300 hover:text-white transition-colors group">
                <Globe className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </a>
            </div>
            <p className="text-gray-500 text-xs mt-6">
              Join our Telegram channel for the fastest updates and direct links.
            </p>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-gray-500 text-sm">
            © {new Date().getFullYear()} MovieVerfy. All rights reserved.
          </p>
          <p className="text-gray-500 text-sm flex items-center gap-1">
            Made with <Heart className="w-4 h-4 text-red-500" /> for movie lovers
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
