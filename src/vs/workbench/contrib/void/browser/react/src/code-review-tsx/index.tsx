/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js';
import { CodeReviewWorkbenchApp } from './CodeReviewWorkbenchApp.js';
import { CodeReviewSidebarView } from './CodeReviewSidebarView.js';
import { CodeReviewLivePanel } from './CodeReviewLivePanel.js';

export const mountCodeReviewWorkbench = mountFnGenerator(CodeReviewWorkbenchApp);
export const mountCodeReviewSidebar = mountFnGenerator(CodeReviewSidebarView);
export const mountCodeReviewLivePanel = mountFnGenerator(CodeReviewLivePanel);

