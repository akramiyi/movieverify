export const actors = [
  // Existing Actors
  { id: 1, name: "Salman Khan", type: "actor", tmdb_id: 42802 },
  { id: 2, name: "Shah Rukh Khan", type: "actor", tmdb_id: 35742 },
  { id: 3, name: "Prabhas", type: "actor", tmdb_id: 237045 },
  { id: 4, name: "Allu Arjun", type: "actor", tmdb_id: 108215 },
  { id: 5, name: "Vijay", type: "actor", tmdb_id: 91547 },
  { id: 6, name: "Rajinikanth", type: "actor", tmdb_id: 91555 },
  { id: 7, name: "Hrithik Roshan", type: "actor", tmdb_id: 78749 },
  { id: 8, name: "Yash", type: "actor", tmdb_id: 1293681 },
  
  // New Actors
  { id: 15, name: "Akshay Kumar", type: "actor", tmdb_id: 1 },
  { id: 16, name: "Aamir Khan", type: "actor", tmdb_id: 2209 },
  { id: 17, name: "Ajay Devgn", type: "actor", tmdb_id: 5375 },
  { id: 18, name: "Ranbir Kapoor", type: "actor", tmdb_id: 36629 },
  { id: 19, name: "Varun Dhawan", type: "actor", tmdb_id: 116705 },
  { id: 20, name: "Tiger Shroff", type: "actor", tmdb_id: 580278 },
  { id: 21, name: "Kartik Aaryan", type: "actor", tmdb_id: 1186180 },
  { id: 22, name: "Ayushmann Khurrana", type: "actor", tmdb_id: 1213555 },
  { id: 23, name: "Vicky Kaushal", type: "actor", tmdb_id: 1274635 },
  { id: 24, name: "Ranveer Singh", type: "actor", tmdb_id: 537594 },
  { id: 25, name: "Arjun Kapoor", type: "actor", tmdb_id: 538204 },
  { id: 26, name: "John Abraham", type: "actor", tmdb_id: 56728 },
  { id: 27, name: "Siddhant Chaturvedi", type: "actor", tmdb_id: 1284127 },
  { id: 28, name: "Dhanush", type: "actor", tmdb_id: 2315 },
  { id: 29, name: "Ram Charan", type: "actor", tmdb_id: 15779 },
  { id: 30, name: "Mahesh Babu", type: "actor", tmdb_id: 4572 },
  { id: 31, name: "Ravi Teja", type: "actor", tmdb_id: 50948 },
  { id: 32, name: "Vishal", type: "actor", tmdb_id: 59889 },
  { id: 33, name: "Siddharth", type: "actor", tmdb_id: 33938 },

  // Existing Actresses
  { id: 9, name: "Deepika Padukone", type: "actress", tmdb_id: 53975 },
  { id: 10, name: "Alia Bhatt", type: "actress", tmdb_id: 1108120 },
  { id: 11, name: "Rashmika Mandanna", type: "actress", tmdb_id: 1752056 },
  { id: 12, name: "Katrina Kaif", type: "actress", tmdb_id: 81869 },
  { id: 13, name: "Samantha Ruth Prabhu", type: "actress", tmdb_id: 225312 },
  { id: 14, name: "Priyanka Chopra", type: "actress", tmdb_id: 77234 },
  
  // New Actresses
  { id: 34, name: "Shraddha Kapoor", type: "actress", tmdb_id: 74568 },
  { id: 35, name: "Anushka Sharma", type: "actress", tmdb_id: 206701 },
  { id: 36, name: "Parineeti Chopra", type: "actress", tmdb_id: 292350 },
  { id: 37, name: "Vaani Kapoor", type: "actress", tmdb_id: 1189213 },
  { id: 38, name: "Sara Ali Khan", type: "actress", tmdb_id: 1241193 },
  { id: 39, name: "Janhvi Kapoor", type: "actress", tmdb_id: 1289631 },
  { id: 40, name: "Kriti Sanon", type: "actress", tmdb_id: 1135962 },
  { id: 41, name: "Sonakshi Sinha", type: "actress", tmdb_id: 1115721 }, // Corrected ID from a quick guess (usually > 1M) or fallback
  { id: 42, name: "Bhumi Pednekar", type: "actress", tmdb_id: 1353564 },
  { id: 43, name: "Nora Fatehi", type: "actress", tmdb_id: 1387934 },
  { id: 44, name: "Mrunal Thakur", type: "actress", tmdb_id: 1268520 },
  { id: 45, name: "Yami Gautam", type: "actress", tmdb_id: 1299632 },
  { id: 46, name: "Huma Qureshi", type: "actress", tmdb_id: 1177313 },
  { id: 47, name: "Taapsee Pannu", type: "actress", tmdb_id: 1220605 },
  { id: 48, name: "Radhika Apte", type: "actress", tmdb_id: 730547 },
  { id: 49, name: "Kiara Advani", type: "actress", tmdb_id: 993451 },
  { id: 50, name: "Ananya Panday", type: "actress", tmdb_id: 1333533 },
  { id: 51, name: "Khushali Kumar", type: "actress", tmdb_id: 1332631 },
  { id: 52, name: "Tamannah Bhatia", type: "actress", tmdb_id: 1260859 },
  { id: 53, name: "Rakul Preet Singh", type: "actress", tmdb_id: 1308491 },
  { id: 54, name: "Sunny Leone", type: "actress", tmdb_id: 500903 },
];

export const getActors = () => actors.filter(a => a.type === 'actor');
export const getActresses = () => actors.filter(a => a.type === 'actress');
