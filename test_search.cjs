const searchStr = "import { IPromptsService } from '../../../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';\r\n\r\n\r\n";
console.log('searchStr length:', searchStr.length);
console.log('Last 10 char codes:', Array.from(searchStr.slice(-10)).map(c => c.charCodeAt(0)));