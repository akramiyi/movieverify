const TOKEN = import.meta.env.VITE_TMDB_TOKEN;
const cache = new Map();
const pending = new Map();

const queue = [];
let isProcessingQueue = false;

const processQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (queue.length > 0) {
    const batch = queue.splice(0, 5);
    await Promise.all(batch.map(async ({ name, resolve }) => {
      try {
        const res = await fetch(
          `https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(name)}&language=en-US&page=1&include_adult=false`,
          {
            headers: {
              Authorization: `Bearer ${TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (!res.ok) {
           resolve(null);
           return;
        }
        
        const data = await res.json();
        const match = data.results?.find(
          p => p.known_for_department === 'Acting'
        ) || data.results?.[0];

        if (!match) {
           resolve(null);
           return;
        }

        const result = {
          tmdb_id: match.id,
          image: match.profile_path 
            ? `https://image.tmdb.org/t/p/w342${match.profile_path}` 
            : null
        };
        
        cache.set(name, result);
        resolve(result);
      } catch (err) {
        console.warn(`Actor search failed for ${name}`, err.message);
        resolve(null);
      }
    }));

    if (queue.length > 0) {
      await new Promise(r => setTimeout(r, 330));
    }
  }

  isProcessingQueue = false;
};

export const searchActorByName = (name) => {
  if (cache.has(name)) return Promise.resolve(cache.get(name));
  if (pending.has(name)) return pending.get(name);

  const promise = new Promise((resolve) => {
    queue.push({ name, resolve });
    processQueue();
  }).then(res => {
    pending.delete(name);
    return res;
  });

  pending.set(name, promise);
  return promise;
};
