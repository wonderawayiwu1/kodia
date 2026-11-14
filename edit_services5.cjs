const fs = require('fs');
const path = 'C:\\CodeEditors\\kodia\\src\\vs\\workbench\\contrib\\void\\browser\\react\\src\\util\\services.tsx';
let content = fs.readFileSync(path, 'utf8');

// Use explicit \r\n in the search string since the target file has CRLF
const searchStr = "import { IPromptsService } from '../../../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';\r\n\r\n\r\n";
const idx = content.indexOf(searchStr);
console.log('Search string found at index:', idx);
if (idx === -1) {
  console.log('NOT FOUND!');
} else {
  const replaceStr = "import { IPromptsService } from '../../../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';\r\nimport { IWebSearchService } from '../../../../../../../workbench/contrib/void/common/webSearchTypes.js';\r\n\r\n\r\n";
  content = content.replace(searchStr, replaceStr);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Done - replaced at index', idx);
}