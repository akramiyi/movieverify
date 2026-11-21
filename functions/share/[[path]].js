export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = new URL(url.pathname + url.search, 'https://movieverify.vercel.app');
  const proxyReq = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    redirect: 'follow',
  });
  return fetch(proxyReq);
}
