class ImageManager {
  constructor() {
    this.state = new Map();
    this.listeners = new Map();
  }

  // Gets current state of an image URL: 'NOT_REQUESTED', 'REQUESTING', 'LOADED', 'ERROR'
  getState(url) {
    return this.state.get(url) || 'NOT_REQUESTED';
  }

  // Request to load an image
  requestImage(url) {
    if (!url) return;
    const currentState = this.getState(url);
    
    // If it's already requesting or loaded, don't do anything
    if (currentState === 'REQUESTING' || currentState === 'LOADED') {
      return;
    }

    this.state.set(url, 'REQUESTING');
    this.notify(url, 'REQUESTING');

    const img = new Image();
    img.onload = () => {
      this.state.set(url, 'LOADED');
      this.notify(url, 'LOADED');
    };
    img.onerror = () => {
      this.state.set(url, 'ERROR');
      this.notify(url, 'ERROR');
    };
    img.src = url;
  }

  // Subscribe to changes for a specific URL
  subscribe(url, callback) {
    if (!this.listeners.has(url)) {
      this.listeners.set(url, new Set());
    }
    this.listeners.get(url).add(callback);

    // Call immediately with current state
    callback(this.getState(url));

    return () => {
      const listeners = this.listeners.get(url);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.listeners.delete(url);
        }
      }
    };
  }

  notify(url, newState) {
    const listeners = this.listeners.get(url);
    if (listeners) {
      listeners.forEach(cb => cb(newState));
    }
  }
}

export const imageManager = new ImageManager();
