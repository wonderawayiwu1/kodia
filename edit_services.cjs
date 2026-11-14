const fs = require('fs');
const path = 'C:\\CodeEditors\\kodia\\src\\vs\\workbench\\contrib\\void\\browser\\react\\src\\util\\services.tsx';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
  "import { IPromptsService } from '../../../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';",
  "import { IPromptsService } from '../../../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';\nimport { IWebSearchService } from '../../../../../../../workbench/contrib/void/common/webSearchTypes.js';"
);
fs.writeFileSync(path, content, 'utf8');
console.log('Done');