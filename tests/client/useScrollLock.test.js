import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { lockScroll, unlockScroll, getLockCount } from '../../src/hooks/useScrollLock.js';

describe('useScrollLock Reference-Counted Scroll Lock Suite', () => {
  let mockBody;
  let mockDocElement;
  let scrollCalls = [];

  beforeEach(() => {
    // Reset global styles mock
    mockBody = {
      style: {
        overflow: 'auto',
        overflowY: 'auto',
        position: 'static',
        top: '',
        left: '',
        right: '',
        width: '',
        paddingRight: '',
      },
    };

    mockDocElement = {
      style: {
        overflow: 'visible',
        overflowY: 'visible',
      },
      scrollTop: 0,
      clientWidth: 1000,
    };

    // Reset lock count to 0 if leftover from any test
    while (getLockCount() > 0) {
      unlockScroll();
    }

    scrollCalls = [];

    // Setup global window and document mocks for Node.js test environment
    global.window = {
      scrollY: 450,
      pageYOffset: 450,
      innerWidth: 1015,
      scrollTo: (x, y) => scrollCalls.push({ x, y }),
    };

    global.document = {
      body: mockBody,
      documentElement: mockDocElement,
    };
  });

  it('1. lockScroll locks document body and sets position fixed with current scrollY offset', () => {
    assert.strictEqual(getLockCount(), 0);
    lockScroll();

    assert.strictEqual(getLockCount(), 1);
    assert.strictEqual(mockDocElement.style.overflow, 'hidden');
    assert.strictEqual(mockDocElement.style.overflowY, 'hidden');
    assert.strictEqual(mockBody.style.overflow, 'hidden');
    assert.strictEqual(mockBody.style.overflowY, 'hidden');
    assert.strictEqual(mockBody.style.position, 'fixed');
    assert.strictEqual(mockBody.style.top, '-450px');
    assert.strictEqual(mockBody.style.width, '100%');
    assert.strictEqual(mockBody.style.paddingRight, '15px'); // 1015 - 1000 = 15px scrollbar compensation

    unlockScroll();
    assert.strictEqual(getLockCount(), 0);
  });

  it('2. Nested modals maintain scroll lock via reference counting', () => {
    // First modal opens (e.g. Admin Panel)
    lockScroll();
    assert.strictEqual(getLockCount(), 1);
    assert.strictEqual(mockBody.style.position, 'fixed');

    // Second modal opens inside Admin Panel (e.g. UpcomingReleaseModal preview)
    global.window.scrollY = 900; // Simulated inner scroll shouldn't overwrite original 450
    lockScroll();
    assert.strictEqual(getLockCount(), 2);
    assert.strictEqual(mockBody.style.top, '-450px'); // Original top preserved

    // Second modal closes
    unlockScroll();
    assert.strictEqual(getLockCount(), 1);
    // Background MUST still remain locked because Admin Panel is still open!
    assert.strictEqual(mockBody.style.position, 'fixed');
    assert.strictEqual(mockBody.style.overflow, 'hidden');
    assert.strictEqual(scrollCalls.length, 0); // Window scrollTo NOT called yet

    // First modal (Admin Panel) closes
    unlockScroll();
    assert.strictEqual(getLockCount(), 0);
    // Now original styles are restored!
    assert.strictEqual(mockBody.style.position, 'static');
    assert.strictEqual(mockBody.style.overflow, 'auto');
    assert.strictEqual(mockDocElement.style.overflow, 'visible');
    assert.deepStrictEqual(scrollCalls, [{ x: 0, y: 450 }]); // Restored to exact original 450px
  });

  it('3. unlockScroll does not go below zero or throw error when called repeatedly', () => {
    assert.strictEqual(getLockCount(), 0);
    unlockScroll();
    assert.strictEqual(getLockCount(), 0);
    unlockScroll();
    assert.strictEqual(getLockCount(), 0);
  });
});
