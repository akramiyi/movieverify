const fs = require('fs');
let data = fs.readFileSync('src/data/movies.js', 'utf8');

const mapping = [
  {oldId: 1, newId: 524},
  {oldId: 2, newId: 27205},
  {oldId: 3, newId: 976573},
  {oldId: 4, newId: 848538},
  {oldId: 5, newId: 76479},
  {oldId: 6, newId: 1215162},
  {oldId: 7, newId: 784651},
  {oldId: 8, newId: 690957},
  {oldId: 9, newId: 66732},
  {oldId: 10, newId: 864692},
  {oldId: 11, newId: 603692},
  {oldId: 12, newId: 71446}
];

mapping.forEach(m => {
  data = data.replace(new RegExp('id: ' + m.oldId + ',', 'g'), 'id: ' + m.newId + ',');
});

data = data.replace(/poster: \"https:\/\/placehold\.co[^\"]+\",/g, 'poster_path: null,');
data = data.replace(/backdrop: \"https:\/\/placehold\.co[^\"]+\",/g, 'backdrop_path: null,');

fs.writeFileSync('src/data/movies.js', data);
console.log('movies.js updated successfully!');
