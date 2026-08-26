import React from 'react';
import { motion } from 'framer-motion';
import { Play, Download } from 'lucide-react';

const Hero = ({ onExplore }) => {
  return (
    <div className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Animated Background Gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[10%] w-[70%] h-[70%] rounded-full bg-primary/20 blur-[120px] animate-blob" />
        <div className="absolute top-[20%] -right-[20%] w-[60%] h-[60%] rounded-full bg-secondary/20 blur-[120px] animate-blob" style={{ animationDelay: '2s' }} />
        <div className="absolute -bottom-[40%] left-[20%] w-[80%] h-[80%] rounded-full bg-accent/20 blur-[120px] animate-blob" style={{ animationDelay: '4s' }} />
      </div>

      {/* Floating Glass Shapes */}
      <motion.div 
        animate={{ y: [0, -20, 0], rotate: [0, 10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-1/4 left-[10%] w-32 h-32 glass rounded-2xl hidden lg:block opacity-50"
      />
      <motion.div 
        animate={{ y: [0, 30, 0], rotate: [0, -15, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-1/4 right-[10%] w-48 h-48 glass rounded-full hidden lg:block opacity-50 border-primary/30"
      />

      <div className="container mx-auto px-4 z-10 text-center mt-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl mx-auto"
        >
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-6 tracking-tight">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400">
              Discover
            </span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-secondary text-glow">
              MOVIEVERFY
            </span>
          </h1>
          
          <p className="text-lg md:text-2xl text-gray-400 mb-10 max-w-2xl mx-auto font-light">
            Your Next Movie Starts Here. Download premium movies and web series in stunning 4K and 1080p quality.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button 
              onClick={onExplore}
              className="w-full sm:w-auto px-8 py-4 bg-primary hover:bg-primary/90 text-white rounded-full font-semibold transition-all duration-300 shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] flex items-center justify-center gap-2 group"
            >
              <Download className="w-5 h-5 group-hover:-translate-y-1 transition-transform" />
              Explore Movies
            </button>
            <button className="w-full sm:w-auto px-8 py-4 glass-button rounded-full font-semibold flex items-center justify-center gap-2 text-white group">
              <Play className="w-5 h-5 group-hover:text-primary transition-colors" />
              Latest Releases
            </button>
          </div>
        </motion.div>
      </div>

      {/* Fade to background at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
};

export default Hero;
