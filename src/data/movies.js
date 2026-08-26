export const movies = [
  {
    id: 1,
    title: "Interstellar",
    poster: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg",
    year: 2014,
    language: "English",
    quality: "1080p",
    genre: "Sci-Fi",
    rating: 8.6,
    description: "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.",
    trailerUrl: "https://www.youtube.com/watch?v=zSWdZVtXT7E",
    download480p: "#",
    download720p: "#",
    download1080p: "#",
    featured: true,
    trending: true,
    latest: false
  },
  {
    id: 2,
    title: "Inception",
    poster: "https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg",
    year: 2010,
    language: "English, Hindi Dubbed",
    quality: "4K",
    genre: "Action",
    rating: 8.8,
    description: "A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.",
    trailerUrl: "https://www.youtube.com/watch?v=YoHD9XEInc0",
    download480p: "#",
    download720p: "#",
    download1080p: "#",
    featured: false,
    trending: true,
    latest: false
  },
  {
    id: 3,
    title: "Jawan",
    poster: "https://image.tmdb.org/t/p/w500/jILeVkOBfQxJb950nE334a1W4T.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/1X7vow16X7CnCoexXh4H4F2yDJv.jpg",
    year: 2023,
    language: "Hindi",
    quality: "1080p",
    genre: "Bollywood",
    rating: 7.5,
    description: "A high-octane action thriller which outlines the emotional journey of a man who is set to rectify the wrongs in the society.",
    trailerUrl: "#",
    download480p: "#",
    download720p: "#",
    download1080p: "#",
    featured: false,
    trending: true,
    latest: true
  },
  {
    id: 4,
    title: "Salaar",
    poster: "https://image.tmdb.org/t/p/w500/c7aM3xWbsoA6m6R5pZID9104GZ6.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/2wA3mGj6P6Fz8lYjY6H3O5I2K7h.jpg",
    year: 2023,
    language: "Telugu, Hindi",
    quality: "1080p",
    genre: "South Indian",
    rating: 7.1,
    description: "A gang leader tries to keep a promise made to his dying friend and takes on the other criminal gangs.",
    trailerUrl: "#",
    download480p: "#",
    download720p: "#",
    download1080p: "#",
    featured: false,
    trending: false,
    latest: true
  },
  {
    id: 5,
    title: "The Boys",
    poster: "https://image.tmdb.org/t/p/w500/7Ns6tOqsT7h2R5F6L8A6L6F45t.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/mGVrXeIjyecj6TKmwOQ0N3e1W5Z.jpg",
    year: 2024,
    language: "English, Hindi",
    quality: "4K",
    genre: "Web Series",
    rating: 8.7,
    description: "A group of vigilantes set out to take down corrupt superheroes who abuse their superpowers.",
    trailerUrl: "#",
    download480p: "#",
    download720p: "#",
    download1080p: "#",
    featured: false,
    trending: true,
    latest: true
  }
];

export const getFeaturedMovie = () => movies.find(m => m.featured);
export const getTrendingMovies = () => movies.filter(m => m.trending);
export const getLatestMovies = () => movies.filter(m => m.latest);
export const getMoviesByCategory = (category) => {
  if (category === 'All') return movies;
  return movies.filter(m => m.genre.includes(category) || m.language.includes(category));
};
