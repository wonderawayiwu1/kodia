/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Full Kodia integration for the Agents Window (Sessions Workbench):
// Loads Kodia's settings, providers, LLM service, ALL engineering engines, ALL full-page
// studio EditorPanes, and IToolsService so every setting, studio, and tool available in
// the Code Editor also works natively inside the Agents Window without switching windows.

// Core Kodia settings, models, LLM & metrics
import '../common/voidSettingsService.js'
import '../common/metricsService.js'
import '../common/mlxService.js'
import '../common/sendLLMMessageService.js'
import '../common/refreshModelService.js'
import '../common/voidUpdateService.js'
import '../common/voidModelService.js'
import '../common/directoryStrService.js'
import '../common/projectMemoryService.js'
import '../common/agentSkills.js'
import '../common/executionObservability.js'
import './providerModelsContrib.js'
import './mlxWorkbenchContrib.js'
import './voidUpdateActions.js'
import './convertToLLMMessageWorkbenchContrib.js'
import './helperServices/consistentItemService.js'
import './tooltipService.js'
import './fileService.js'
import './voidSCMService.js'
import './metricsPollService.js'
import './miscWokrbenchContrib.js'

// Kodia styling
import './media/void.css'

// Kodia Settings & ALL Full-Page Engineering Studio EditorPanes
import './voidSettingsPane.js'
import './apiStudioService.js'
import './apiStudioPane.js'
import './codeReviewService.js'
import './codeReviewPane.js'
import './arpeiService.js'
import './arpeiPane.js'
import './correctnessService.js'
import './correctnessPane.js'
import './evolutionService.js'
import './evolutionPane.js'
import './mobileEngineeringService.js'
import './mobileStudioPane.js'
import './liveIntelligenceService.js'
import './liveIntelligencePane.js'
import './universalAppBuilderService.js'
import './universalAppBuilderPane.js'
import './universalAutomationService.js'
import './universalAutomationPane.js'

// Additional Kodia Engineering Intelligence Services
import './designIntelligenceService.js'
import './aiEngineeringService.js'
import './diagnosticReliabilityService.js'
import './firstPassReliabilityService.js'
import './verificationLedgerService.js'
import './softwareFactoryService.js'
import './customCommandsService.js'
import './kodiaWorkflowsService.js'

// Full Kodia Tool Execution Stack (shared with KodiaAgentHostLmHandler)
import './editCodeService.js'
import './voidCommandBarService.js'
import './terminalToolService.js'
import './gitToolService.js'
import './testToolService.js'
import './debugToolService.js'
import './debuggerActivityService.js'
import './toolsService.js'

// Reverse bridge serving Kodia models + ALL Kodia engine tools to KodiaAgent
import './kodiaAgentHostLmHandler.js'
