import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('MovieVerify ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetAndReload = () => {
    try {
      localStorage.removeItem('introShown');
      localStorage.removeItem('movieverify_auth_popup_dismissed');
      sessionStorage.clear();
    } catch {}
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#141414] text-white flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FF3445] to-[#E50914] flex items-center justify-center text-white font-black text-2xl shadow-[0_0_25px_rgba(229,9,20,0.6)] mb-6">
            M
          </div>
          <h1 className="text-2xl font-bold mb-2 tracking-tight">MovieVerify</h1>
          <p className="text-gray-400 text-sm max-w-sm mb-6">
            Something unexpected occurred while loading the application.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full py-2.5 px-4 bg-[#E50914] hover:bg-[#b80710] text-white rounded-xl font-bold text-sm shadow-lg transition cursor-pointer"
            >
              Reload Page
            </button>
            <button
              type="button"
              onClick={this.handleResetAndReload}
              className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/15 text-gray-300 hover:text-white rounded-xl font-medium text-sm transition cursor-pointer border border-white/10"
            >
              Reset & Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
