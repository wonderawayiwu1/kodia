const fs = require('fs');
const file = 'C:/CodeEditors/kodia/src/vs/workbench/contrib/void/common/autonomousExecutor.ts';
let c = fs.readFileSync(file, 'utf8');
c = c.replace(
  'import { TaskPlan, TaskPlanTask, verifyFileExists, verifyCommandSuccess, verifyFileContains, verifyTerminalOutput, formatTaskPlanForLLM, getPlanProgress, getNextPendingTask } from \'./autonomousTask.js\';',
  'import { TaskPlan, TaskPlanTask, TaskStatus, verifyFileExists, formatTaskPlanForLLM, getPlanProgress, getNextPendingTask } from \'./autonomousTask.js\';'
);
fs.writeFileSync(file, c);
console.log('Done');