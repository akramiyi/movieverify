import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronRight, ChevronLeft, Check, Sparkles } from 'lucide-react';

const STORAGE_GUIDE_SEEN_KEY = 'movieverify_new_user_guide_completed';

const TOUR_STEPS = [
  {
    id: 'telegram',
    selector: '#tour-telegram-bot',
    badge: '1 of 3 • Telegram Bot',
    title: 'Movie Find ⚡ on Telegram',
    description: 'Telegram par direct movies search karne, download links paane aur updates ke liye is icon par tap karein (@movieverify_bot).',
    actionText: 'Next →',
    color: '#229ED9',
  },
  {
    id: 'notification',
    selector: '#tour-notification-bell',
    badge: '2 of 3 • Release Alerts',
    title: 'Release Alerts Turn On Karein 🔔',
    description: 'Nayi Bollywood, South aur Hollywood OTT movies aate hi sabse pehle alert paane ke liye is Bell icon par tap karein.',
    actionText: 'Next →',
    color: '#E50914',
  },
  {
    id: 'today-releases',
    selector: '#tour-today-releases',
    badge: '3 of 3 • Live Releases',
    title: 'Today Releases Tracker 🎬',
    description: 'Aaj release hone wali movies & web series ke live trailers aur verified 1080p download links yahan se dekhein.',
    actionText: 'Got It ✓',
    color: '#f43f5e',
  },
];

export const NewUserGuide = ({ isOpen = false, onClose }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const resizeRaf = useRef(null);

  const step = TOUR_STEPS[currentStepIndex];

  const updatePosition = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.selector);
    if (el && el.offsetParent !== null) {
      const rect = el.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        centerX: rect.left + rect.width / 2,
      });
    } else {
      // If target element is not in DOM or hidden on small screen, skip to next or fallback
      setTargetRect(null);
    }
  }, [step]);

  useEffect(() => {
    if (!isOpen) return;

    // Small delay to ensure DOM and navbar are fully painted
    const timer = setTimeout(updatePosition, 100);

    const onResize = () => {
      cancelAnimationFrame(resizeRaf.current);
      resizeRaf.current = requestAnimationFrame(updatePosition);
    };

    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(resizeRaf.current);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, updatePosition, currentStepIndex]);

  if (!isOpen) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_GUIDE_SEEN_KEY, 'true');
    } catch {}
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  const handleNext = () => {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      handleDismiss();
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  // Calculate safe horizontal alignment for tooltip card
  const tooltipWidth = 300;
  let tooltipLeft = targetRect ? targetRect.centerX - tooltipWidth / 2 : window.innerWidth / 2 - tooltipWidth / 2;
  const padding = 16;
  if (tooltipLeft < padding) tooltipLeft = padding;
  if (tooltipLeft + tooltipWidth > window.innerWidth - padding) {
    tooltipLeft = window.innerWidth - tooltipWidth - padding;
  }

  // Calculate arrow horizontal position relative to tooltip card
  const arrowLeft = targetRect
    ? Math.max(20, Math.min(tooltipWidth - 20, targetRect.centerX - tooltipLeft))
    : tooltipWidth / 2;

  const tooltipTop = targetRect ? targetRect.bottom + 18 : 100;

  return (
    <aside 
      aria-label="Interactive Feature Tour"
      className="fixed inset-0 z-[150] pointer-events-auto"
    >
      {/* Dimmed Background Overlay */}
      <div 
        onClick={handleDismiss}
        className="absolute inset-0 bg-black/60 transition-opacity duration-300" 
      />

      {/* Target Highlight Spotlight Ring */}
      {targetRect && (
        <div
          style={{
            top: `${targetRect.top - 5}px`,
            left: `${targetRect.left - 5}px`,
            width: `${targetRect.width + 10}px`,
            height: `${targetRect.height + 10}px`,
            borderColor: step.color,
            boxShadow: `0 0 25px ${step.color}99`,
          }}
          className="fixed rounded-full border-2 pointer-events-none z-[155] animate-pulse transition-all duration-300"
        />
      )}

      {/* Tooltip Card with Upward Arrow */}
      <div
        style={{
          top: `${tooltipTop}px`,
          left: `${tooltipLeft}px`,
          width: `${tooltipWidth}px`,
        }}
        className="fixed z-[160] bg-[#121217]/95 backdrop-blur-xl border border-white/20 rounded-2xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.95)] animate-in fade-in zoom-in-95 duration-200 select-none"
      >
        {/* Animated Bouncing Pointer Arrow pointing directly UP to target element */}
        <div
          style={{ left: `${arrowLeft}px` }}
          className="absolute -top-3 -translate-x-1/2 flex flex-col items-center pointer-events-none animate-bounce"
        >
          <div 
            style={{ borderBottomColor: step.color }}
            className="w-0 h-0 border-l-[9px] border-l-transparent border-r-[9px] border-r-transparent border-b-[12px] filter drop-shadow-[0_-3px_6px_rgba(0,0,0,0.9)]"
          />
        </div>

        {/* Card Header */}
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
          <span 
            style={{ color: step.color, backgroundColor: `${step.color}15`, borderColor: `${step.color}35` }}
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wider"
          >
            <Sparkles className="w-2.5 h-2.5" />
            {step.badge}
          </span>
          <button
            onClick={handleDismiss}
            aria-label="Skip tour"
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Card Content */}
        <div className="space-y-1.5">
          <h4 className="text-sm font-black text-white leading-snug">
            {step.title}
          </h4>
          <p className="text-xs text-gray-300 leading-relaxed">
            {step.description}
          </p>
        </div>

        {/* Card Footer Controls */}
        <div className="mt-3.5 pt-2.5 border-t border-white/10 flex items-center justify-between">
          {currentStepIndex > 0 ? (
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-[11px] font-bold text-gray-400 hover:text-white py-1 px-2 rounded-lg hover:bg-white/5 transition cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
          ) : (
            <button
              onClick={handleDismiss}
              className="text-[11px] text-gray-400 hover:text-gray-200 py-1 px-2 cursor-pointer"
            >
              Skip
            </button>
          )}

          {/* Dots Indicator */}
          <div className="flex items-center gap-1">
            {TOUR_STEPS.map((_, idx) => (
              <span
                key={idx}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  idx === currentStepIndex ? 'w-4 bg-white' : 'bg-white/20'
                }`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            style={{
              background: currentStepIndex === TOUR_STEPS.length - 1
                ? 'linear-gradient(to right, #E50914, #b80710)'
                : step.color,
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-white text-[11px] font-bold shadow-md hover:brightness-110 active:scale-95 transition cursor-pointer"
          >
            <span>{step.actionText}</span>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default NewUserGuide;
 