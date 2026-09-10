import React, { useState, useEffect } from 'react';
import { Coffee } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const SupportSection = () => {
  const [selectedAmount, setSelectedAmount] = useState(10);
  const [isOther, setIsOther] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messageType, setMessageType] = useState(''); // 'success', 'error', 'info'

  // Load Razorpay script
  useEffect(() => {
    const loadRazorpayScript = () => {
      if (document.getElementById('razorpay-checkout-js')) return;
      const script = document.createElement('script');
      script.id = 'razorpay-checkout-js';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);
    };
    loadRazorpayScript();
  }, []);

  const handleAmountClick = (amt) => {
    if (isLoading) return;
    setIsOther(false);
    setSelectedAmount(amt);
    setCustomAmount('');
    setMessage('');
  };

  const handleOtherClick = () => {
    if (isLoading) return;
    setIsOther(true);
    setSelectedAmount('other');
    setMessage('');
  };

  const handleCustomAmountChange = (e) => {
    if (isLoading) return;
    setCustomAmount(e.target.value);
    setMessage('');
  };

  const handleSupport = async () => {
    if (isLoading) return;
    let finalAmount = isOther ? parseFloat(customAmount) : selectedAmount;
    
    if (isNaN(finalAmount) || finalAmount <= 0) {
      setMessage('Please enter a valid positive amount.');
      setMessageType('error');
      return;
    }

    if (!window.Razorpay) {
      setMessage('Razorpay SDK failed to load. Please check your connection.');
      setMessageType('error');
      return;
    }

    try {
      setIsLoading(true);
      setMessage('Creating payment...');
      setMessageType('info');

      // 1. Create Order
      const res = await fetch(`${API_URL}/api/razorpay/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: finalAmount })
      });

      const orderData = await res.json();
      if (!res.ok) throw new Error(orderData.error || 'Failed to create order');

      // 2. Open Checkout
      const options = {
        key: orderData.key_id,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'MovieVerify',
        description: 'Support MovieVerify',
        order_id: orderData.order_id,
        handler: async function (response) {
          try {
            setMessage('Verifying payment...');
            setMessageType('info');
            
            // 3. Verify Payment
            const verifyRes = await fetch(`${API_URL}/api/razorpay/verify-payment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            });
            
            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              setMessage('Payment successful. Thank you for supporting MovieVerify! ❤️');
              setMessageType('success');
            } else {
              throw new Error(verifyData.error || 'Verification failed');
            }
          } catch (err) {
            setMessage(err.message || 'Payment verification failed.');
            setMessageType('error');
          }
        },
        prefill: {
          name: 'MovieVerify Supporter',
        },
        theme: {
          color: '#E50914'
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (response){
        setMessage('Payment was cancelled or failed. Please try again.');
        setMessageType('error');
      });
      rzp.open();

      // Clear the "Creating payment..." message once modal opens
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'Payment failed to initiate.');
      setMessageType('error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full px-4 md:px-12 py-10 md:py-16 bg-[#141414]">
      <div className="max-w-2xl mx-auto bg-[#1a1a1a] border border-white/5 rounded-2xl p-6 md:p-10 shadow-2xl relative overflow-hidden">
        {/* Subtle glow effect */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#E50914] rounded-full mix-blend-multiply filter blur-3xl opacity-20 pointer-events-none"></div>
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 bg-[#242424] border border-[#333] rounded-2xl flex items-center justify-center mb-6 shadow-lg">
            <Coffee className="w-7 h-7 text-[#E50914]" />
          </div>
          
          <h2 className="text-2xl md:text-3xl font-black text-white mb-3 tracking-tight">
            Support MovieVerify
          </h2>
          <p className="text-gray-400 text-sm md:text-base mb-8 max-w-md">
            If you enjoy MovieVerify, you can support us and help keep the platform running.
          </p>

          {/* Amount Options */}
          <div className="flex flex-wrap justify-center gap-3 mb-6 w-full">
            {[5, 10, 50].map((amt) => (
              <button
                key={amt}
                onClick={() => handleAmountClick(amt)}
                className={`px-6 py-3 rounded-xl font-bold transition-all duration-300 ${
                  !isOther && selectedAmount === amt
                    ? 'bg-[#E50914] text-white shadow-[0_0_15px_rgba(229,9,20,0.4)]'
                    : 'bg-[#242424] text-gray-300 hover:bg-[#333] border border-white/5'
                }`}
                aria-label={`Support with ₹${amt}`}
                aria-pressed={!isOther && selectedAmount === amt}
              >
                ₹{amt}
              </button>
            ))}
            <button
              onClick={handleOtherClick}
              className={`px-6 py-3 rounded-xl font-bold transition-all duration-300 ${
                isOther
                  ? 'bg-[#E50914] text-white shadow-[0_0_15px_rgba(229,9,20,0.4)]'
                  : 'bg-[#242424] text-gray-300 hover:bg-[#333] border border-white/5'
              }`}
              aria-pressed={isOther}
            >
              Other
            </button>
          </div>

          {/* Custom Amount Input */}
          {isOther && (
            <div className="w-full max-w-xs mb-6 relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
              <input
                type="number"
                min="1"
                placeholder="Enter amount"
                value={customAmount}
                onChange={handleCustomAmountChange}
                className="w-full bg-[#242424] border border-white/10 rounded-xl py-3 pl-8 pr-4 text-white font-bold outline-none focus:border-[#E50914] transition-colors"
                aria-label="Custom support amount"
              />
            </div>
          )}

          {/* Error / Success Message */}
          {message && (
            <div className={`mb-6 text-sm font-semibold px-4 py-3 rounded-lg ${
              messageType === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
              messageType === 'info' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
              'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {message}
            </div>
          )}

          {/* Payment Button */}
          <button
            onClick={handleSupport}
            disabled={isLoading}
            className={`w-full max-w-xs bg-white text-black font-black text-sm md:text-base py-4 rounded-xl shadow-lg transition-transform mt-2 ${isLoading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-gray-200 active:scale-95'}`}
          >
            {isLoading ? 'Processing...' : 'Support with Razorpay'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SupportSection;
