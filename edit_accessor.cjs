const fs = require('fs');
const path = 'C:\\CodeEditors\\kodia\\src\\vs\\workbench\\contrib\\void\\browser\\react\\src\\util\\services.tsx';
let content = fs.readFileSync(path, 'utf8');

const searchStr = "IPromptsService: accessor.get(IPromptsService),\r\n\r\n";
const idx = content.indexOf(searchStr);
console.log('Search string found at index:', idx);
if (idx === -1) {
  console.log('NOT FOUND!');
} else {
  const replaceStr = "IPromptsService: accessor.get(IPromptsService),\r\n\t\tIWebSearchService: accessor.get(IWebSearchService),\r\n\r\n";
  content = content.replace(searchStr, replaceStr);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Done - replaced at index', idx);
}