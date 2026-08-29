const TOKEN = import.meta.env.VITE_TMDB_TOKEN;
const cache = new Map();

export const searchActorByName = async (name) => {
  if (cache.has(name)) return cache.get(name);

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
    
    if (!res.ok) return null;
    
    const data = await res.json();
    // Pick the result with highest popularity that matches
    // "known_for_department": "Acting" to avoid wrong matches
    const match = data.results?.find(
      p => p.known_for_department === 'Acting'
    ) || data.results?.[0];

    if (!match) return null;

    const result = {
      tmdb_id: match.id,
      image: match.profile_path 
        ? `https://image.tmdb.org/t/p/w342${match.profile_path}` 
        : null
    };
    
    cache.set(name, result);
    return result;
  } catch (err) {
    console.warn(`Actor search failed for ${name}`, err.message);
    return null;
  }
};
