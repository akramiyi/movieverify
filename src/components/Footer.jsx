import React from 'react';

const Footer = () => {
  return (
    <footer className="w-full bg-[#141414] text-gray-500 py-12 px-4 md:px-16 mt-20">
      <div className="max-w-6xl mx-auto">
        {/* Social Links */}
        <div className="flex items-center gap-6 mb-8 text-white">
          {/* Facebook */}
          <a href="#" className="hover:text-gray-300 transition text-white">
            <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
              <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.8z"/>
            </svg>
          </a>
          {/* Instagram */}
          <a href="https://instagram.com/movieverify" target="_blank" rel="noopener noreferrer" className="hover:text-gray-300 transition text-white">
            <svg className="w-6 h-6 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
          </a>
          {/* Twitter */}
          <a href="#" className="hover:text-gray-300 transition text-white">
            <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
          {/* YouTube */}
          <a href="#" className="hover:text-gray-300 transition text-white">
            <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
              <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.108C19.527 3.545 12 3.545 12 3.545s-7.527 0-9.388.51a3.003 3.003 0 0 0-2.11 2.108C0 8.024 0 12 0 12s0 3.976.502 5.837a3.003 3.003 0 0 0 2.11 2.108c1.86.51 9.388.51 9.388.51s7.527 0 9.388-.51a3.003 3.003 0 0 0 2.11-2.108c.502-1.86.502-5.837.502-5.837s0-3.976-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          </a>
        </div>

        {/* Links Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 text-sm">
          <a href="#" className="hover:underline">Audio Description</a>
          <a href="#" className="hover:underline">Help Center</a>
          <a href="#" className="hover:underline">Gift Cards</a>
          <a href="#" className="hover:underline">Media Center</a>
          <a href="#" className="hover:underline">Investor Relations</a>
          <a href="#" className="hover:underline">Jobs</a>
          <a href="#" className="hover:underline">Terms of Use</a>
          <a href="#" className="hover:underline">Privacy</a>
          <a href="#" className="hover:underline">Legal Notices</a>
          <a href="#" className="hover:underline">Cookie Preferences</a>
          <a href="#" className="hover:underline">Corporate Information</a>
          <a href="#" className="hover:underline">Contact Us</a>
        </div>

        {/* Service Code Button */}
        <button className="border border-gray-500 text-gray-500 px-2 py-1 text-sm hover:text-gray-400 hover:border-gray-400 transition mb-6">
          Service Code
        </button>

        {/* Copyright */}
        <div className="text-xs">
          © 2024-2026 MovieVerify, Inc.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
