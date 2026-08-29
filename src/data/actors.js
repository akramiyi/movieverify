export const actors = [
  // Actors
  {
    id: 1,
    name: "Salman Khan",
    type: "actor",
    image: "https://image.tmdb.org/t/p/w342/euJUfGBBEOJv2oDPmXzeFJIAMkr.jpg",
    tmdb_id: 42802,
    movies: ["Dabangg", "Tiger Zinda Hai", "Bajrangi Bhaijaan", 
             "Sultan", "Kick", "Ready", "Wanted", "Race 3",
             "Bodyguard", "Ek Tha Tiger"]
  },
  {
    id: 2,
    name: "Shah Rukh Khan",
    type: "actor",
    image: "https://image.tmdb.org/t/p/w342/nXBDODCmFJMmRfOHgZgFf6sVFGQ.jpg",
    tmdb_id: 35742,
    movies: ["Jawan", "Pathaan", "Dilwale Dulhania Le Jayenge",
             "Kabhi Khushi Kabhie Gham", "My Name is Khan",
             "Chennai Express", "Happy New Year", "Zero"]
  },
  {
    id: 3,
    name: "Prabhas",
    type: "actor", 
    image: "https://image.tmdb.org/t/p/w342/7Uqxv6tpIXyxkGJaFfxkKkBFxoR.jpg",
    tmdb_id: 237045,
    movies: ["Baahubali", "Baahubali 2", "Saaho", 
             "Radhe Shyam", "Adipurush", "Kalki 2898 AD"]
  },
  {
    id: 4,
    name: "Allu Arjun",
    type: "actor",
    image: "https://image.tmdb.org/t/p/w342/9GqDZkRCDPdVaFpGxHnDmfy9J6N.jpg",
    tmdb_id: 108215,
    movies: ["Pushpa: The Rise", "Pushpa 2: The Rule",
             "Ala Vaikunthapurramuloo", "Arya", "Julayi"]
  },
  {
    id: 5,
    name: "Vijay",
    type: "actor",
    image: "https://image.tmdb.org/t/p/w342/qCpZn2e3dimwbryLnqxZuI88PTi.jpg",
    tmdb_id: 91547,
    movies: ["Leo", "Varisu", "Beast", "Master", 
             "Bigil", "Mersal", "Theri"]
  },
  {
    id: 6,
    name: "Rajinikanth",
    type: "actor",
    image: "https://image.tmdb.org/t/p/w342/7dDkjpfv8z7P9Xm1gy9HQJNQFX8.jpg",
    tmdb_id: 91555,
    movies: ["Jailer", "Vettaiyan", "Annaatthe", 
             "Darbar", "Petta", "2.0", "Kabali"]
  },
  {
    id: 7,
    name: "Hrithik Roshan",
    type: "actor",
    image: "https://image.tmdb.org/t/p/w342/k8mxZkpkQNKvwvDzNtBfHyJbhFv.jpg",
    tmdb_id: 78749,
    movies: ["War", "Krrish", "Dhoom 2", "Bang Bang",
             "Super 30", "War 2", "Fighter"]
  },
  {
    id: 8,
    name: "Yash",
    type: "actor",
    image: "https://image.tmdb.org/t/p/w342/6P3HWcuHmgKtPIiHbFLrDGfXiLC.jpg",
    tmdb_id: 1293681,
    movies: ["KGF Chapter 1", "KGF Chapter 2", "Toxic"]
  },

  // Actresses
  {
    id: 9,
    name: "Deepika Padukone",
    type: "actress",
    image: "https://image.tmdb.org/t/p/w342/9Pxv3nLbHLPGHQzfVHCYNqUDKHG.jpg",
    tmdb_id: 53975,
    movies: ["Pathaan", "Jawan", "Gehraiyaan", 
             "Padmaavat", "Om Shanti Om", "Chennai Express"]
  },
  {
    id: 10,
    name: "Alia Bhatt",
    type: "actress",
    image: "https://image.tmdb.org/t/p/w342/wFzAqjGXqFBHkMbRpkNqBEqxoFj.jpg",
    tmdb_id: 1108120,
    movies: ["RRR", "Gangubai Kathiawadi", "Brahmastra",
             "Raazi", "Udta Punjab", "2 States"]
  },
  {
    id: 11,
    name: "Rashmika Mandanna",
    type: "actress",
    image: "https://image.tmdb.org/t/p/w342/7dG8H8bDnXBPAqrhPJtHTCBrHkf.jpg",
    tmdb_id: 1752056,
    movies: ["Pushpa: The Rise", "Pushpa 2", "Animal",
             "Mission Majnu", "Goodbye"]
  },
  {
    id: 12,
    name: "Katrina Kaif",
    type: "actress",
    image: "https://image.tmdb.org/t/p/w342/nWpFKGKkLkMHjfFKPqYVkPpkFEy.jpg",
    tmdb_id: 81869,
    movies: ["Tiger Zinda Hai", "Ek Tha Tiger", 
             "Phone Bhoot", "Sooryavanshi", "Bang Bang"]
  },
  {
    id: 13,
    name: "Samantha Ruth Prabhu",
    type: "actress",
    image: "https://image.tmdb.org/t/p/w342/hJVJTMIbNFHJJqTjIgxnBmfFHCG.jpg",
    tmdb_id: 225312,
    movies: ["Pushpa: The Rise", "The Family Man 2",
             "Shakuntalam", "Yashoda"]
  },
  {
    id: 14,
    name: "Priyanka Chopra",
    type: "actress",
    image: "https://image.tmdb.org/t/p/w342/qNBAXBIQlnOThrVvA6mA2B5ggkb.jpg",
    tmdb_id: 77234,
    movies: ["Bajirao Mastani", "Mary Kom", 
             "Barfi!", "Don", "Dil Dhadakne Do"]
  }
];

export const getActors = () => actors.filter(a => a.type === 'actor');
export const getActresses = () => actors.filter(a => a.type === 'actress');
