const fs = require('fs');
const path = 'C:\\CodeEditors\\kodia\\src\\vs\\workbench\\contrib\\void\\browser\\react\\src\\util\\services.tsx';
let content = fs.readFileSync(path, 'utf8');
// Match the exact pattern: import line followed by \r\n\r\n\r\n (three CRLF = two blank lines)
content = content.replace(
  "import { IPromptsService } from '../../../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';\r\n\r\n\r\n",
  "import { IPromptsService } from '../../../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';\r\nimport { IWebSearchService } from '../../../../../../../workbench/contrib/void/common/webSearchTypes.js';\r\n\r\n\r\n"
);
fs.writeFileSync(path, content, 'utf8');
console.log('Done');