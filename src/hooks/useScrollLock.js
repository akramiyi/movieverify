import { useEffect } from 'react';

// Module-level reference-counted state for nested modal & overlay scroll locking
let lockCount = 0;
let savedScrollY = 0;
let originalStyles = null;

export const getLockCount = () => lockCount;

export const lockScroll = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body || !document.documentElement) {
    return;
  }

  if (lockCount === 0) {
    savedScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    originalStyles = {
      bodyOverflow: document.body.style.overflow,
      bodyOverflowY: document.body.style.overflowY,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyLeft: document.body.style.left,
      bodyRight: document.body.style.right,
      bodyWidth: document.body.style.width,
      bodyPaddingRight: document.body.style.paddingRight,
      htmlOverflow: document.documentElement.style.overflow,
      htmlOverflowY: document.documentElement.style.overflowY,
    };

    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overflowY = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.overflowY = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }

  lockCount++;
};

export const unlockScroll = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body || !document.documentElement) {
    return;
  }

  if (lockCount > 0) {
    lockCount--;
  }

  if (lockCount === 0 && originalStyles) {
    document.documentElement.style.overflow = originalStyles.htmlOverflow;
    document.documentElement.style.overflowY = originalStyles.htmlOverflowY;
    document.body.style.overflow = originalStyles.bodyOverflow;
    document.body.style.overflowY = originalStyles.bodyOverflowY;
    document.body.style.position = originalStyles.bodyPosition;
    document.body.style.top = originalStyles.bodyTop;
    document.body.style.left = originalStyles.bodyLeft;
    document.body.style.right = originalStyles.bodyRight;
    document.body.style.width = originalStyles.bodyWidth;
    document.body.style.paddingRight = originalStyles.bodyPaddingRight;

    if (typeof window.scrollTo === 'function') {
      window.scrollTo(0, savedScrollY);
    }
    originalStyles = null;
  }
};

/**
 * React hook to lock document body scroll when a modal or overlay is open.
 * Supports nested overlays with reference counting to prevent premature unlocking.
 *
 * @param {boolean} isLocked - Whether scroll should currently be locked (defaults to true)
 */
export function useScrollLock(isLocked = true) {
  useEffect(() => {
    if (!isLocked) return;

    lockScroll();

    return () => {
      unlockScroll();
    };
  }, [isLocked]);
}

export default useScrollLock;
