const fs = require('fs');
const path = 'C:\\CodeEditors\\kodia\\src\\vs\\workbench\\contrib\\void\\browser\\react\\src\\util\\services.tsx';
let content = fs.readFileSync(path, 'utf8');
const searchStr = "import { IPromptsService } from '../../../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';\r\n\r\n\r\n";
const idx = content.indexOf(searchStr);
console.log('Search string found at index:', idx);
if (idx === -1) {
  console.log('NOT FOUND!');
  console.log('Looking for:', JSON.stringify(searchStr));
  // Try to find just the import line
  const idx2 = content.indexOf("import { IPromptsService }");
  console.log('Import line at:', idx2);
  console.log('Context:', JSON.stringify(content.substring(idx2, idx2 + 200)));
} else {
  content = content.replace(searchStr, "import { IPromptsService } from '../../../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';\r\nimport { IWebSearchService } from '../../../../../../../workbench/contrib/void/common/webSearchTypes.js';\r\n\r\n\r\n");
  fs.writeFileSync(path, content, 'utf8');
  console.log('Done');
}