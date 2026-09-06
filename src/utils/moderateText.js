const BLOCKED_WORDS = [
  // Add common profanity/spam terms here as needed
  'spam', 'scam', 'fake'
];

export const containsBlockedContent = (text) => {
  if (!text) return false;
  const lower = text.toLowerCase();
  return BLOCKED_WORDS.some((word) => lower.includes(word));
};

export const moderateText = (text) => {
  if (!text) return { allowed: true, reason: null };
  if (containsBlockedContent(text)) {
    return { 
      allowed: false, 
      reason: 'Your review contains content that is not allowed.' 
    };
  }
  if (text.trim().length < 3) {
    return { 
      allowed: false, 
      reason: 'Review is too short. Please share more detail.' 
    };
  }
  return { allowed: true, reason: null };
};
