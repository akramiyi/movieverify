export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. If notification or site-lock endpoint, proxy to Vercel Serverless Functions
  if (pathname.startsWith('/api/notifications') || pathname.startsWith('/api/site-lock')) {
    const targetUrl = new URL(pathname + url.search, 'https://movieverify.vercel.app');
    const proxyReq = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'follow',
    });
    return fetch(proxyReq);
  }

  // 2. Otherwise proxy to Render Backend (TMDB proxy, home-feed, image proxy, razorpay)
  const targetUrl = new URL(pathname + url.search, 'https://movieverify-backend.onrender.com');
  const proxyReq = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    redirect: 'follow',
  });
  return fetch(proxyReq);
}
