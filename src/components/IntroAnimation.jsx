import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const IntroAnimation = ({ onComplete }) => {
  const [phase, setPhase] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [reducedMotion, setReducedMotion] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (sessionStorage.getItem('introShown')) {
      onComplete();
      return;
    }

    // Accessibility check
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);

    const handleMouse = (e) => {
      if (mediaQuery.matches) return;
      const { clientX, clientY } = e;
      const { innerWidth, innerHeight } = window;
      const x = (clientX - innerWidth / 2) / (innerWidth / 2) * 6; // ±6px
      const y = (clientY - innerHeight / 2) / (innerHeight / 2) * 6;
      setMousePos({ x, y });
    };

    window.addEventListener('mousemove', handleMouse);

    // Cinematic Timeline Timers
    const timers = [
      setTimeout(() => setPhase(1), 700),   // 0.7s - Projector Light Turns On
      setTimeout(() => setPhase(2), 1400),  // 1.4s - Film Reel Spins & shoots film strip
      setTimeout(() => setPhase(3), 2200),  // 2.2s - Film transforms into MOVIE VERFY letters
      setTimeout(() => setPhase(4), 3000),  // 3.0s - Premium Glass & Light Sweep Lock-in
      setTimeout(() => setPhase(5), 3600),  // 3.6s - Cinematic Impact & Sparks
      setTimeout(() => setPhase(6), 4000),  // 4.0s - Exit Transition Begins
    ];

    const completeTimer = setTimeout(() => {
      sessionStorage.setItem('introShown', 'true');
      onComplete();
    }, 4700); // 4.7s total duration

    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(completeTimer);
      window.removeEventListener('mousemove', handleMouse);
    };
  }, [onComplete]);

  // Projector dust particles
  const dustParticles = React.useMemo(() => {
    return Array.from({ length: reducedMotion ? 8 : 28 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      speedX: Math.random() * 10 - 5,
      speedY: Math.random() * -15 - 10,
      opacity: Math.random() * 0.4 + 0.1,
    }));
  }, [reducedMotion]);

  // Sparks on impact
  const sparks = React.useMemo(() => {
    return Array.from({ length: 20 }).map((_, i) => ({
      id: i,
      angle: (i / 20) * Math.PI * 2 + (Math.random() * 0.4 - 0.2),
      speed: Math.random() * 120 + 80,
      size: Math.random() * 2 + 1,
      duration: Math.random() * 0.8 + 0.5,
    }));
  }, []);

  return (
    <motion.div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-[#030303] flex items-center justify-center overflow-hidden select-none"
      animate={phase >= 6 ? { opacity: 0, scale: 1.05 } : { opacity: 1 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
    >
      {/* 1. Cinematic Film Grain Overlay & Vignette */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03] z-50 bg-repeat bg-center" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />
      <div className="absolute inset-0 pointer-events-none bg-radial-vignette opacity-80 z-40" />

      {/* Background Projector Light Cone */}
      <AnimatePresence>
        {phase >= 1 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ 
              opacity: phase >= 6 ? 0 : [0.4, 0.7, 0.6], 
              scale: phase === 5 ? 1.1 : 1 
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute w-[650px] h-[650px] pointer-events-none rounded-full filter blur-[100px] z-10"
            style={{
              background: 'radial-gradient(circle, rgba(229,9,20,0.25) 0%, rgba(255,52,69,0.1) 50%, transparent 70%)',
              x: mousePos.x * -0.6,
              y: mousePos.y * -0.6,
            }}
          />
        )}
      </AnimatePresence>

      {/* Volumetric Projector Beam Shape */}
      <AnimatePresence>
        {phase === 1 && (
          <motion.div
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ opacity: 0.8, scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute w-[300px] h-[100vh] pointer-events-none z-10"
            style={{
              background: 'linear-gradient(to bottom, rgba(255,255,255,0.2) 0%, rgba(229,9,20,0.08) 50%, transparent 100%)',
              clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
              originY: 0,
            }}
          />
        )}
      </AnimatePresence>

      {/* Floating Projector Dust Particles */}
      {phase >= 1 && (
        <div className="absolute inset-0 pointer-events-none z-20">
          {dustParticles.map((p) => (
            <motion.div
              key={p.id}
              className="absolute rounded-full bg-white/20"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
              }}
              animate={
                reducedMotion
                  ? {}
                  : {
                      y: [0, p.speedY],
                      x: [0, p.speedX],
                      opacity: [0, p.opacity, 0],
                    }
              }
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: 'linear',
              }}
            />
          ))}
        </div>
      )}

      {/* Main Animation Stage */}
      <motion.div
        className="relative flex flex-col items-center justify-center z-30"
        style={{
          x: mousePos.x,
          y: mousePos.y,
          perspective: 1200,
        }}
        animate={
          phase === 5
            ? { scale: [1, 1.035, 1] }
            : {}
        }
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        {/* Spark System for Cinematic Impact */}
        {phase === 5 && !reducedMotion && (
          <div className="absolute pointer-events-none z-50">
            {sparks.map((spark) => (
              <motion.div
                key={spark.id}
                className="absolute rounded-full bg-[#FF3445] shadow-[0_0_8px_#E50914]"
                style={{
                  width: `${spark.size}px`,
                  height: `${spark.size}px`,
                  left: '50%',
                  top: '50%',
                }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{
                  x: Math.cos(spark.angle) * spark.speed,
                  y: Math.sin(spark.angle) * spark.speed,
                  opacity: 0,
                  scale: 0.2,
                }}
                transition={{
                  duration: spark.duration,
                  ease: 'easeOut',
                }}
              />
            ))}
          </div>
        )}

        {/* Film Reel Animation */}
        <AnimatePresence>
          {phase === 2 && (
            <motion.div
              initial={{ scale: 0, opacity: 0, rotate: -180 }}
              animate={
                reducedMotion
                  ? { scale: 1, opacity: 1, rotate: 0 }
                  : { scale: 1, opacity: 1, rotate: 720 }
              }
              exit={{ scale: 0.4, opacity: 0, y: 100 }}
              transition={{ duration: 0.8, ease: 'easeInOut' }}
              className="relative w-36 h-36 md:w-48 md:h-48 flex-none z-30 mb-4"
            >
              {/* Metallic Film Reel Design */}
              <svg className="w-full h-full filter drop-shadow-[0_10px_20px_rgba(0,0,0,0.7)]" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" fill="#151515" stroke="#333" strokeWidth="2" />
                <circle cx="50" cy="50" r="18" fill="none" stroke="#222" strokeWidth="1" />
                
                {/* Film Reel Holes */}
                {Array.from({ length: 5 }).map((_, idx) => {
                  const angle = (idx * 360) / 5;
                  const rad = (angle * Math.PI) / 180;
                  const cx = 50 + 26 * Math.cos(rad);
                  const cy = 50 + 26 * Math.sin(rad);
                  return <circle key={idx} cx={cx} cy={cy} r="10" fill="#050505" stroke="#444" strokeWidth="1" />;
                })}
                
                {/* Center cap */}
                <circle cx="50" cy="50" r="6" fill="#444" />
                <circle cx="50" cy="50" r="2" fill="#000" />
              </svg>

              {/* Glowing Red Edge Film Strip Shooting out */}
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: '300px', opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.5, ease: 'easeOut' }}
                className="absolute top-1/2 left-full h-8 bg-gradient-to-r from-[#181818] via-[#E50914] to-transparent border-t-2 border-b-2 border-red-500/40 opacity-70 pointer-events-none flex items-center justify-between px-2"
                style={{
                  transform: 'translateY(-50%)',
                  backgroundSize: '20px 100%',
                }}
              >
                {/* Film Sprocket Holes */}
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i} className="flex flex-col justify-between h-full py-1">
                    <div className="w-2 h-1.5 bg-[#030303] rounded-sm" />
                    <div className="w-2 h-1.5 bg-[#030303] rounded-sm" />
                  </div>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Logo Text Wrapper */}
        <div className="relative flex items-center justify-center overflow-visible select-none px-4 py-2">
          {/* Phase 3 & 4 & 5: Letters Formed from Film */}
          {phase >= 3 && (
            <div className="flex flex-wrap justify-center gap-0.5 md:gap-1.5 relative overflow-visible">
              
              {/* MOVIE Segment */}
              <div className="flex">
                {"MOVIE".split("").map((char, index) => (
                  <motion.span
                    key={`movie-${index}`}
                    className={`font-black tracking-tight ${phase >= 4 ? 'text-white' : 'text-[#E50914]'}`}
                    style={{
                      fontSize: 'clamp(36px, 8vw, 85px)',
                      fontFamily: '"Montserrat", "Arial Black", sans-serif',
                      textShadow: phase >= 4 
                        ? '0 0 15px rgba(229,9,20,0.6), inset 0 0 4px rgba(255,255,255,0.4)' 
                        : '0 0 20px rgba(229,9,20,0.8)',
                      display: 'inline-block',
                      // Glass look on Phase 4+
                      background: phase >= 4 ? 'linear-gradient(to bottom, #ffffff 30%, #a3a3a3 70%)' : 'none',
                      WebkitBackgroundClip: phase >= 4 ? 'text' : 'none',
                      WebkitTextFillColor: phase >= 4 ? 'transparent' : 'initial',
                    }}
                    initial={reducedMotion ? { opacity: 1 } : { x: -40, y: 15, opacity: 0, rotate: -15, filter: 'blur(8px)' }}
                    animate={
                      phase >= 6
                        ? { scale: 3, opacity: 0, filter: 'blur(12px)', transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: index * 0.03 } }
                        : { x: 0, y: 0, opacity: 1, rotate: 0, filter: 'blur(0px)' }
                    }
                    transition={{
                      duration: 0.8,
                      delay: index * 0.06,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    {char}
                  </motion.span>
                ))}
              </div>

              {/* VERIFY Segment */}
              <div className="flex">
                {"VERIFY".split("").map((char, index) => (
                  <motion.span
                    key={`verify-${index}`}
                    className={`font-black tracking-tight ${phase >= 4 ? 'text-white' : 'text-[#E50914]'}`}
                    style={{
                      fontSize: 'clamp(36px, 8vw, 85px)',
                      fontFamily: '"Montserrat", "Arial Black", sans-serif',
                      textShadow: phase >= 4 
                        ? '0 0 15px rgba(229,9,20,0.6), inset 0 0 4px rgba(255,255,255,0.4)' 
                        : '0 0 20px rgba(229,9,20,0.8)',
                      display: 'inline-block',
                      background: phase >= 4 ? 'linear-gradient(to bottom, #ffffff 30%, #a3a3a3 70%)' : 'none',
                      WebkitBackgroundClip: phase >= 4 ? 'text' : 'none',
                      WebkitTextFillColor: phase >= 4 ? 'transparent' : 'initial',
                    }}
                    initial={reducedMotion ? { opacity: 1 } : { x: 40, y: -15, opacity: 0, rotate: 15, filter: 'blur(8px)' }}
                    animate={
                      phase >= 6
                        ? { scale: 3, opacity: 0, filter: 'blur(12px)', transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.15 + index * 0.03 } }
                        : { x: 0, y: 0, opacity: 1, rotate: 0, filter: 'blur(0px)' }
                    }
                    transition={{
                      duration: 0.8,
                      delay: 0.3 + index * 0.06,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    {char}
                  </motion.span>
                ))}
              </div>

              {/* Phase 4+: Premium Glass Specular Reflection light sweep */}
              {phase >= 4 && (
                <motion.div
                  className="absolute inset-0 pointer-events-none mix-blend-overlay z-40"
                  style={{
                    background: 'linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.85) 45%, rgba(229,9,20,0.5) 50%, transparent 60%)',
                  }}
                  initial={{ x: '-100%' }}
                  animate={{ x: '180%' }}
                  transition={{ duration: 0.9, ease: 'easeInOut' }}
                />
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Optional cinematic sound effect anchor:
          // /sounds/movieverify-intro.mp3 */}
    </motion.div>
  );
};

export default IntroAnimation;
