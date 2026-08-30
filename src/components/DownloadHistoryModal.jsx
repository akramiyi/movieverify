import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Trash2, Clock } from 'lucide-react';

const DownloadHistoryModal = ({ isOpen, onClose, history, onClear }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center 
                     justify-center p-4"
        >
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            className="relative w-full max-w-lg bg-[#141414] 
                       rounded-2xl overflow-hidden z-10 max-h-[80vh] 
                       flex flex-col"
          >
            <div className="flex items-center justify-between 
                            p-5 border-b border-white/10">
              <h2 className="text-xl font-bold text-white flex 
                             items-center gap-2">
                <Download className="w-5 h-5 text-[#E50914]" />
                Download History
              </h2>
              <button
                onClick={onClose}
                className="w-8 h-8 bg-[#242424] hover:bg-[#E50914] 
                           rounded-full flex items-center 
                           justify-center text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4">
              {history.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-10">
                  No downloads yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {history.map((item) => (
                    <div 
                      key={item.id} 
                      className="flex items-center justify-between 
                                 bg-[#1e1e1e] rounded-lg px-4 py-3"
                    >
                      <div>
                        <p className="text-white text-sm font-medium">
                          {item.movieTitle}
                        </p>
                        <p className="text-gray-500 text-xs flex 
                                      items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {new Date(item.downloadedAt)
                            .toLocaleString('en-IN')}
                        </p>
                      </div>
                      <span className="text-[10px] bg-[#E50914]/20 
                                       text-[#E50914] px-2 py-1 
                                       rounded font-bold">
                        {item.quality}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {history.length > 0 && (
              <div className="p-4 border-t border-white/10">
                <button
                  onClick={onClear}
                  className="flex items-center gap-2 text-gray-400 
                             hover:text-[#E50914] text-sm transition 
                             mx-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear History
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DownloadHistoryModal;
