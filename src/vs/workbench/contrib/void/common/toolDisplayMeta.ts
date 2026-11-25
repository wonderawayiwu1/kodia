/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Universal display metadata for all Kodia built-in tools.
 * Ensures every tool (146+) renders a clear, accurate activity card in the Chat UI
 * and never throws or disappears when proposing, running, succeeding, or failing.
 */

export type ToolCategory =
	| 'file'
	| 'edit'
	| 'search'
	| 'terminal'
	| 'git'
	| 'test'
	| 'debug'
	| 'browser'
	| 'agent'
	| 'plan'
	| 'memory'
	| 'web'
	| 'api'
	| 'notebook'
	| 'design'
	| 'ai'
	| 'mcp';

export interface ToolDisplayTitles {
	readonly done: string;
	readonly proposed: string;
	readonly running: string;
}

const EXPLICIT_TITLES: Readonly<Record<string, ToolDisplayTitles>> = {
	// Files & editing
	read_file: { done: 'Read file', proposed: 'Read file', running: 'Reading file' },
	ls_dir: { done: 'Inspected folder', proposed: 'Inspect folder', running: 'Inspecting folder' },
	get_dir_tree: { done: 'Inspected folder tree', proposed: 'Inspect folder tree', running: 'Inspecting folder tree' },
	create_file_or_folder: { done: 'Created', proposed: 'Create', running: 'Creating' },
	delete_file_or_folder: { done: 'Deleted', proposed: 'Delete', running: 'Deleting' },
	edit_file: { done: 'Edited file', proposed: 'Edit file', running: 'Editing file' },
	rewrite_file: { done: 'Rewrote file', proposed: 'Rewrite file', running: 'Rewriting file' },
	write_file: { done: 'Wrote file', proposed: 'Write file', running: 'Writing file' },
	read_lint_errors: { done: 'Read diagnostics', proposed: 'Read diagnostics', running: 'Reading diagnostics' },

	// Search & code intelligence
	search_pathnames_only: { done: 'Searched file names', proposed: 'Search file names', running: 'Searching file names' },
	search_for_files: { done: 'Searched files', proposed: 'Search files', running: 'Searching files' },
	search_in_file: { done: 'Searched in file', proposed: 'Search in file', running: 'Searching in file' },
	go_to_definition: { done: 'Went to definition', proposed: 'Go to definition', running: 'Going to definition' },
	find_references: { done: 'Found references', proposed: 'Find references', running: 'Finding references' },
	search_symbols: { done: 'Searched symbols', proposed: 'Search symbols', running: 'Searching symbols' },
	code_index: { done: 'Indexed codebase', proposed: 'Index codebase', running: 'Indexing codebase' },
	code_index_file: { done: 'Indexed file', proposed: 'Index file', running: 'Indexing file' },
	code_semantic_search: { done: 'Semantic code search', proposed: 'Semantic code search', running: 'Searching codebase' },
	code_keyword_search: { done: 'Keyword code search', proposed: 'Keyword code search', running: 'Searching code' },
	code_hybrid_search: { done: 'Hybrid code search', proposed: 'Hybrid code search', running: 'Searching code' },
	code_index_stats: { done: 'Checked index stats', proposed: 'Check index stats', running: 'Checking index stats' },
	code_index_clear: { done: 'Cleared code index', proposed: 'Clear code index', running: 'Clearing code index' },
	project_health_scan: { done: 'Scanned project health', proposed: 'Scan project health', running: 'Scanning project health' },
	architecture_map: { done: 'Mapped architecture', proposed: 'Map architecture', running: 'Mapping architecture' },

	// Terminal & dev lifecycle
	run_command: { done: 'Ran command', proposed: 'Run command', running: 'Running command' },
	run_persistent_command: { done: 'Ran terminal command', proposed: 'Run terminal command', running: 'Running terminal command' },
	open_persistent_terminal: { done: 'Opened terminal', proposed: 'Open terminal', running: 'Opening terminal' },
	kill_persistent_terminal: { done: 'Killed terminal', proposed: 'Kill terminal', running: 'Killing terminal' },
	list_terminals: { done: 'Listed terminals', proposed: 'List terminals', running: 'Listing terminals' },
	read_terminal: { done: 'Read terminal', proposed: 'Read terminal', running: 'Reading terminal' },
	send_command_to_terminal: { done: 'Sent to terminal', proposed: 'Send to terminal', running: 'Sending to terminal' },
	interrupt_terminal: { done: 'Interrupted terminal', proposed: 'Interrupt terminal', running: 'Interrupting terminal' },
	close_terminal: { done: 'Closed terminal', proposed: 'Close terminal', running: 'Closing terminal' },
	dev_server_start: { done: 'Started dev server', proposed: 'Start dev server', running: 'Starting dev server' },
	dev_server_stop: { done: 'Stopped dev server', proposed: 'Stop dev server', running: 'Stopping dev server' },
	dev_server_list: { done: 'Listed dev servers', proposed: 'List dev servers', running: 'Listing dev servers' },
	dev_server_status: { done: 'Checked dev server', proposed: 'Check dev server', running: 'Checking dev server' },
	dep_install: { done: 'Installed dependencies', proposed: 'Install dependencies', running: 'Installing dependencies' },
	db_migrate: { done: 'Ran DB migration', proposed: 'Run DB migration', running: 'Running DB migration' },
	lint_run: { done: 'Ran linter', proposed: 'Run linter', running: 'Running linter' },
	log_read: { done: 'Read log file', proposed: 'Read log file', running: 'Reading log file' },
	port_check: { done: 'Checked port', proposed: 'Check port', running: 'Checking port' },
	autonomous_dev_cycle: { done: 'Ran dev cycle', proposed: 'Run dev cycle', running: 'Running dev cycle' },

	// Planning & orchestration
	create_task_plan: { done: 'Created task plan', proposed: 'Create task plan', running: 'Creating task plan' },
	update_task_plan: { done: 'Updated task plan', proposed: 'Update task plan', running: 'Updating task plan' },
	get_task_plan: { done: 'Checked task plan', proposed: 'Check task plan', running: 'Checking task plan' },
	todo: { done: 'Updated checklist', proposed: 'Update checklist', running: 'Updating checklist' },
	subagent: { done: 'Subagent finished', proposed: 'Delegate to subagent', running: 'Running subagent' },

	// Memory & web
	read_project_memory: { done: 'Read project memory', proposed: 'Read project memory', running: 'Reading project memory' },
	write_project_memory: { done: 'Saved project memory', proposed: 'Save project memory', running: 'Saving project memory' },
	fetch_url: { done: 'Fetched URL', proposed: 'Fetch URL', running: 'Fetching URL' },
	web_search: { done: 'Searched web', proposed: 'Search web', running: 'Searching web' },

	// Git
	git_status: { done: 'Checked Git status', proposed: 'Check Git status', running: 'Checking Git status' },
	git_diff: { done: 'Inspected Git diff', proposed: 'Inspect Git diff', running: 'Inspecting Git diff' },
	git_log: { done: 'Read Git log', proposed: 'Read Git log', running: 'Reading Git log' },
	git_show: { done: 'Inspected commit', proposed: 'Inspect commit', running: 'Inspecting commit' },
	git_branch_list: { done: 'Listed branches', proposed: 'List branches', running: 'Listing branches' },
	git_branch_create: { done: 'Created branch', proposed: 'Create branch', running: 'Creating branch' },
	git_branch_switch: { done: 'Switched branch', proposed: 'Switch branch', running: 'Switching branch' },
	git_stage: { done: 'Staged files', proposed: 'Stage files', running: 'Staging files' },
	git_unstage: { done: 'Unstaged files', proposed: 'Unstage files', running: 'Unstaging files' },
	git_commit: { done: 'Created commit', proposed: 'Create commit', running: 'Creating commit' },
	git_commit_context: { done: 'Gathered commit context', proposed: 'Gather commit context', running: 'Gathering commit context' },
	git_pr_prepare: { done: 'Prepared PR summary', proposed: 'Prepare PR summary', running: 'Preparing PR summary' },
	git_fetch: { done: 'Fetched remote', proposed: 'Fetch remote', running: 'Fetching remote' },
	git_pull: { done: 'Pulled changes', proposed: 'Pull changes', running: 'Pulling changes' },
	git_push: { done: 'Pushed changes', proposed: 'Push changes', running: 'Pushing changes' },
	git_merge: { done: 'Merged branch', proposed: 'Merge branch', running: 'Merging branch' },
	git_rebase: { done: 'Rebased branch', proposed: 'Rebase branch', running: 'Rebasing branch' },
	git_cherry_pick: { done: 'Cherry-picked commit', proposed: 'Cherry-pick commit', running: 'Cherry-picking commit' },
	git_revert: { done: 'Reverted commit', proposed: 'Revert commit', running: 'Reverting commit' },
	git_reset: { done: 'Reset branch', proposed: 'Reset branch', running: 'Resetting branch' },
	git_continue: { done: 'Continued Git op', proposed: 'Continue Git op', running: 'Continuing Git op' },
	git_abort: { done: 'Aborted Git op', proposed: 'Abort Git op', running: 'Aborting Git op' },
	git_stash: { done: 'Stashed changes', proposed: 'Stash changes', running: 'Stashing changes' },
	git_stash_pop: { done: 'Popped stash', proposed: 'Pop stash', running: 'Popping stash' },
	git_tag_list: { done: 'Listed tags', proposed: 'List tags', running: 'Listing tags' },
	git_tag_create: { done: 'Created tag', proposed: 'Create tag', running: 'Creating tag' },
	git_remote_list: { done: 'Listed remotes', proposed: 'List remotes', running: 'Listing remotes' },
	git_worktree_list: { done: 'Listed worktrees', proposed: 'List worktrees', running: 'Listing worktrees' },
	git_worktree_add: { done: 'Added worktree', proposed: 'Add worktree', running: 'Adding worktree' },

	// Testing
	test_discover: { done: 'Discovered tests', proposed: 'Discover tests', running: 'Discovering tests' },
	test_list: { done: 'Listed tests', proposed: 'List tests', running: 'Listing tests' },
	test_run: { done: 'Ran tests', proposed: 'Run tests', running: 'Running tests' },
	test_run_targeted: { done: 'Ran targeted tests', proposed: 'Run targeted tests', running: 'Running targeted tests' },
	test_rerun_failed: { done: 'Reran failed tests', proposed: 'Rerun failed tests', running: 'Rerunning failed tests' },
	test_coverage: { done: 'Measured coverage', proposed: 'Measure coverage', running: 'Measuring coverage' },
	test_history: { done: 'Checked test history', proposed: 'Check test history', running: 'Checking test history' },
	test_check_flaky: { done: 'Checked flaky tests', proposed: 'Check flaky tests', running: 'Checking flaky tests' },
	test_debug: { done: 'Debugged test', proposed: 'Debug test', running: 'Debugging test' },
	test_cancel: { done: 'Cancelled tests', proposed: 'Cancel tests', running: 'Cancelling tests' },

	// Debugger
	debug_list_configurations: { done: 'Listed debug configs', proposed: 'List debug configs', running: 'Listing debug configs' },
	debug_list_sessions: { done: 'Listed debug sessions', proposed: 'List debug sessions', running: 'Listing debug sessions' },
	debug_get_session_status: { done: 'Checked debug status', proposed: 'Check debug status', running: 'Checking debug status' },
	debug_start_session: { done: 'Started debugger', proposed: 'Start debugger', running: 'Starting debugger' },
	debug_attach_session: { done: 'Attached debugger', proposed: 'Attach debugger', running: 'Attaching debugger' },
	debug_stop_session: { done: 'Stopped debugger', proposed: 'Stop debugger', running: 'Stopping debugger' },
	debug_restart_session: { done: 'Restarted debugger', proposed: 'Restart debugger', running: 'Restarting debugger' },
	debug_set_breakpoint: { done: 'Set breakpoint', proposed: 'Set breakpoint', running: 'Setting breakpoint' },
	debug_remove_breakpoint: { done: 'Removed breakpoint', proposed: 'Remove breakpoint', running: 'Removing breakpoint' },
	debug_set_breakpoint_enabled: { done: 'Toggled breakpoint', proposed: 'Toggle breakpoint', running: 'Toggling breakpoint' },
	debug_list_breakpoints: { done: 'Listed breakpoints', proposed: 'List breakpoints', running: 'Listing breakpoints' },
	debug_set_exception_breakpoints: { done: 'Set exception breaks', proposed: 'Set exception breaks', running: 'Setting exception breaks' },
	debug_continue: { done: 'Continued execution', proposed: 'Continue execution', running: 'Continuing execution' },
	debug_pause: { done: 'Paused execution', proposed: 'Pause execution', running: 'Pausing execution' },
	debug_step_over: { done: 'Stepped over', proposed: 'Step over', running: 'Stepping over' },
	debug_step_into: { done: 'Stepped into', proposed: 'Step into', running: 'Stepping into' },
	debug_step_out: { done: 'Stepped out', proposed: 'Step out', running: 'Stepping out' },
	debug_list_threads: { done: 'Listed threads', proposed: 'List threads', running: 'Listing threads' },
	debug_get_stack_trace: { done: 'Read stack trace', proposed: 'Read stack trace', running: 'Reading stack trace' },
	debug_get_scopes: { done: 'Read scopes', proposed: 'Read scopes', running: 'Reading scopes' },
	debug_get_variables: { done: 'Inspected variables', proposed: 'Inspect variables', running: 'Inspecting variables' },
	debug_evaluate_expression: { done: 'Evaluated expression', proposed: 'Evaluate expression', running: 'Evaluating expression' },
	debug_get_exception_info: { done: 'Read exception info', proposed: 'Read exception info', running: 'Reading exception info' },
	debug_get_console_output: { done: 'Read debug console', proposed: 'Read debug console', running: 'Reading debug console' },

	// Browser automation
	browser_launch: { done: 'Launched browser', proposed: 'Launch browser', running: 'Launching browser' },
	browser_close: { done: 'Closed browser', proposed: 'Close browser', running: 'Closing browser' },
	browser_shutdown: { done: 'Shut down browser', proposed: 'Shut down browser', running: 'Shutting down browser' },
	browser_list_sessions: { done: 'Listed browser sessions', proposed: 'List browser sessions', running: 'Listing browser sessions' },
	browser_new_tab: { done: 'Opened browser tab', proposed: 'Open browser tab', running: 'Opening browser tab' },
	browser_list_tabs: { done: 'Listed browser tabs', proposed: 'List browser tabs', running: 'Listing browser tabs' },
	browser_switch_tab: { done: 'Switched browser tab', proposed: 'Switch browser tab', running: 'Switching browser tab' },
	browser_close_tab: { done: 'Closed browser tab', proposed: 'Close browser tab', running: 'Closing browser tab' },
	browser_navigate: { done: 'Navigated browser', proposed: 'Navigate browser', running: 'Navigating browser' },
	browser_back: { done: 'Navigated back', proposed: 'Navigate back', running: 'Navigating back' },
	browser_forward: { done: 'Navigated forward', proposed: 'Navigate forward', running: 'Navigating forward' },
	browser_reload: { done: 'Reloaded page', proposed: 'Reload page', running: 'Reloading page' },
	browser_inspect_page: { done: 'Inspected page', proposed: 'Inspect page', running: 'Inspecting page' },
	browser_click_element: { done: 'Clicked element', proposed: 'Click element', running: 'Clicking element' },
	browser_click_at: { done: 'Clicked coordinates', proposed: 'Click coordinates', running: 'Clicking coordinates' },
	browser_hover: { done: 'Hovered element', proposed: 'Hover element', running: 'Hovering element' },
	browser_fill_element: { done: 'Filled input', proposed: 'Fill input', running: 'Filling input' },
	browser_type_text: { done: 'Typed text', proposed: 'Type text', running: 'Typing text' },
	browser_press_key: { done: 'Pressed key', proposed: 'Press key', running: 'Pressing key' },
	browser_scroll: { done: 'Scrolled page', proposed: 'Scroll page', running: 'Scrolling page' },
	browser_drag_and_drop: { done: 'Dragged element', proposed: 'Drag element', running: 'Dragging element' },
	browser_select_option: { done: 'Selected option', proposed: 'Select option', running: 'Selecting option' },
	browser_check_element: { done: 'Toggled checkbox', proposed: 'Toggle checkbox', running: 'Toggling checkbox' },
	browser_submit_form: { done: 'Submitted form', proposed: 'Submit form', running: 'Submitting form' },
	browser_upload_file: { done: 'Uploaded file', proposed: 'Upload file', running: 'Uploading file' },
	browser_evaluate: { done: 'Evaluated page JS', proposed: 'Evaluate page JS', running: 'Evaluating page JS' },
	browser_accessibility_snapshot: { done: 'Captured ARIA tree', proposed: 'Capture ARIA tree', running: 'Capturing ARIA tree' },
	browser_wait_for_element: { done: 'Waited for element', proposed: 'Wait for element', running: 'Waiting for element' },
	browser_wait_for_text: { done: 'Waited for text', proposed: 'Wait for text', running: 'Waiting for text' },
	browser_wait_for_network_idle: { done: 'Waited for network', proposed: 'Wait for network', running: 'Waiting for network idle' },
	browser_set_viewport: { done: 'Set viewport', proposed: 'Set viewport', running: 'Setting viewport' },
	browser_screenshot: { done: 'Captured screenshot', proposed: 'Capture screenshot', running: 'Capturing screenshot' },
	browser_console: { done: 'Read browser console', proposed: 'Read browser console', running: 'Reading browser console' },
	browser_network_failures: { done: 'Checked network errors', proposed: 'Check network errors', running: 'Checking network errors' },
	browser_network_log: { done: 'Inspected network log', proposed: 'Inspect network log', running: 'Inspecting network log' },
	browser_handle_dialog: { done: 'Configured dialog handler', proposed: 'Configure dialog handler', running: 'Configuring dialog handler' },
	browser_storage: { done: 'Inspected browser storage', proposed: 'Inspect browser storage', running: 'Inspecting browser storage' },
	browser_download: { done: 'Downloaded file', proposed: 'Download file', running: 'Downloading file' },
	browser_list_downloads: { done: 'Listed downloads', proposed: 'List downloads', running: 'Listing downloads' },

	// Antigravity Live Focus, Steps Checklist, Questions, Artifacts, Scheduler & Multi-Agent Workflows
	update_focus: { done: 'Updated focus', proposed: 'Update focus', running: 'Updating focus' },
	update_steps: { done: 'Updated checklist', proposed: 'Update checklist', running: 'Updating checklist' },
	ask_user_question: { done: 'Answered question', proposed: 'Ask user question', running: 'Waiting for user answer' },
	create_artifact: { done: 'Created artifact', proposed: 'Create artifact', running: 'Creating artifact' },
	update_artifact: { done: 'Updated artifact', proposed: 'Update artifact', running: 'Updating artifact' },
	read_artifact: { done: 'Read artifact', proposed: 'Read artifact', running: 'Reading artifact' },
	list_artifacts: { done: 'Listed artifacts', proposed: 'List artifacts', running: 'Listing artifacts' },
	schedule_task: { done: 'Scheduled task', proposed: 'Schedule task', running: 'Scheduling task' },
	manage_scheduled_tasks: { done: 'Managed schedules', proposed: 'Manage schedules', running: 'Managing schedules' },
	define_subagent: { done: 'Defined subagent', proposed: 'Define subagent', running: 'Defining subagent' },
	manage_subagents: { done: 'Managed subagents', proposed: 'Manage subagents', running: 'Managing subagents' },
	run_parallel_workflow: { done: 'Ran parallel workflow', proposed: 'Run parallel workflow', running: 'Running parallel workflow' },
	multi_edit_file: { done: 'Applied batch edits', proposed: 'Apply batch edits', running: 'Applying batch edits' },
	view_file_outline: { done: 'Read file outline', proposed: 'Read file outline', running: 'Reading file outline' },
	view_code_item: { done: 'Inspected code item', proposed: 'Inspect code item', running: 'Inspecting code item' },
	review_code_changes: { done: 'Reviewed git diff', proposed: 'Review git diff', running: 'Reviewing git diff' },
	manage_notepads: { done: 'Updated notepads', proposed: 'Manage notepads', running: 'Managing notepads' },
	manage_rules: { done: 'Updated rules', proposed: 'Manage rules', running: 'Managing rules' },
	render_interactive_widget: { done: 'Rendered widget', proposed: 'Render widget', running: 'Rendering interactive widget' },
	workspace_search_replace: { done: 'Replaced across workspace', proposed: 'Workspace search & replace', running: 'Replacing across workspace' },
	api_test_sse_stream: { done: 'Tested SSE stream', proposed: 'Test SSE stream', running: 'Streaming SSE endpoint' },
	open_live_preview: { done: 'Opened live preview', proposed: 'Open live preview', running: 'Opening live preview' },
	manage_env_file: { done: 'Updated .env (masked)', proposed: 'Manage .env (masked)', running: 'Inspecting .env (masked)' },

	// API / Notebooks
	api_request: { done: 'Sent API request', proposed: 'Send API request', running: 'Sending API request' },
	read_notebook: { done: 'Read notebook', proposed: 'Read notebook', running: 'Reading notebook' },
	write_notebook: { done: 'Wrote notebook', proposed: 'Write notebook', running: 'Writing notebook' },
	edit_notebook: { done: 'Edited notebook', proposed: 'Edit notebook', running: 'Editing notebook' },
	execute_notebook_cell: { done: 'Ran notebook cell', proposed: 'Run notebook cell', running: 'Running notebook cell' },
	execute_notebook: { done: 'Ran notebook', proposed: 'Run notebook', running: 'Running notebook' },
	restart_notebook_kernel: { done: 'Restarted kernel', proposed: 'Restart kernel', running: 'Restarting kernel' },
	interrupt_notebook_kernel: { done: 'Interrupted kernel', proposed: 'Interrupt kernel', running: 'Interrupting kernel' },
	search_notebook: { done: 'Searched notebook', proposed: 'Search notebook', running: 'Searching notebook' },
	validate_notebook: { done: 'Validated notebook', proposed: 'Validate notebook', running: 'Validating notebook' },
	select_notebook_kernel: { done: 'Selected kernel', proposed: 'Select kernel', running: 'Selecting kernel' },
	list_notebook_kernels: { done: 'Listed kernels', proposed: 'List kernels', running: 'Listing kernels' },

	// Workspace Intelligence & Security
	workspace_diagnostics: { done: 'Read workspace problems', proposed: 'Read workspace problems', running: 'Reading workspace problems' },
	move_or_rename_file: { done: 'Moved / renamed file', proposed: 'Move / rename file', running: 'Moving / renaming file' },
	file_metadata: { done: 'Inspected file metadata', proposed: 'Inspect file metadata', running: 'Inspecting file metadata' },
	dependency_audit: { done: 'Audited dependencies', proposed: 'Audit dependencies', running: 'Auditing dependencies' },
	env_inspect: { done: 'Inspected environment', proposed: 'Inspect environment', running: 'Inspecting environment' },
	docker_status: { done: 'Checked Docker status', proposed: 'Check Docker status', running: 'Checking Docker status' },
	docker_logs: { done: 'Read Docker logs', proposed: 'Read Docker logs', running: 'Reading Docker logs' },
	db_inspect: { done: 'Inspected database schema', proposed: 'Inspect database schema', running: 'Inspecting database schema' },
	db_query: { done: 'Queried database', proposed: 'Query database', running: 'Querying database' },
	change_impact_analysis: { done: 'Analyzed change impact', proposed: 'Analyze change impact', running: 'Analyzing change impact' },
	knowledge_graph_query: { done: 'Queried knowledge graph', proposed: 'Query knowledge graph', running: 'Querying knowledge graph' },
	evaluate_quality_gates: { done: 'Evaluated quality gates', proposed: 'Evaluate quality gates', running: 'Evaluating quality gates' },
	record_verification_evidence: { done: 'Recorded verification proof', proposed: 'Record verification proof', running: 'Recording verification proof' },
	factory_manage_requirements: { done: 'Updated factory requirements', proposed: 'Update factory requirements', running: 'Updating factory requirements' },

	// Autonomous UI/UX Design Intelligence, Assets & Visual QA
	analyze_product_design_requirements: { done: 'Analyzed product requirements', proposed: 'Analyze product requirements', running: 'Analyzing product requirements' },
	generate_design_brief: { done: 'Created design brief', proposed: 'Create design brief', running: 'Creating design brief' },
	generate_visual_direction: { done: 'Selected visual direction', proposed: 'Select visual direction', running: 'Selecting visual direction' },
	generate_color_palette: { done: 'Generated color palette', proposed: 'Generate color palette', running: 'Generating color palette' },
	generate_design_tokens: { done: 'Created design tokens', proposed: 'Create design tokens', running: 'Creating design tokens' },
	generate_page_architecture: { done: 'Planned page architecture', proposed: 'Plan page architecture', running: 'Planning page architecture' },
	generate_responsive_layout: { done: 'Designed responsive layout', proposed: 'Design responsive layout', running: 'Designing responsive layout' },
	discover_visual_assets: { done: 'Discovered visual assets', proposed: 'Discover visual assets', running: 'Searching for imagery' },
	search_image_providers: { done: 'Searched image providers', proposed: 'Search image providers', running: 'Searching image providers' },
	download_visual_assets: { done: 'Downloaded visual assets', proposed: 'Download visual assets', running: 'Downloading visual assets' },
	optimize_visual_assets: { done: 'Optimized visual assets', proposed: 'Optimize visual assets', running: 'Optimizing visual assets' },
	discover_icon_library: { done: 'Selected icon system', proposed: 'Select icon system', running: 'Inspecting icon libraries' },
	recommend_typography: { done: 'Selected typography system', proposed: 'Select typography system', running: 'Selecting typography pairing' },
	recommend_ui_components: { done: 'Planned UI components', proposed: 'Plan UI components', running: 'Planning UI components' },
	generate_component_variants: { done: 'Generated component variants', proposed: 'Generate component variants', running: 'Generating component variants' },
	inspect_existing_design_system: { done: 'Inspected existing design system', proposed: 'Inspect existing design system', running: 'Inspecting existing design system' },
	audit_design_consistency: { done: 'Audited design consistency', proposed: 'Audit design consistency', running: 'Auditing design consistency' },
	inspect_responsive_layout: { done: 'Tested responsive layouts', proposed: 'Test responsive layouts', running: 'Testing responsive layouts' },
	capture_application_screenshots: { done: 'Captured preview screenshots', proposed: 'Capture preview screenshots', running: 'Rendering previews & capturing screenshots' },
	inspect_visual_quality: { done: 'Inspected visual quality', proposed: 'Inspect visual quality', running: 'Inspecting visual quality' },
	audit_accessibility: { done: 'Audited accessibility (WCAG)', proposed: 'Audit accessibility (WCAG)', running: 'Auditing accessibility' },
	audit_frontend_performance: { done: 'Audited frontend performance', proposed: 'Audit frontend performance', running: 'Auditing frontend performance' },
	critique_interface_design: { done: 'Critiqued interface design', proposed: 'Critique interface design', running: 'Performing design review' },
	repair_visual_defects: { done: 'Planned visual defect repairs', proposed: 'Plan visual defect repairs', running: 'Identifying visual defects' },
	compare_visual_revisions: { done: 'Compared visual revisions', proposed: 'Compare visual revisions', running: 'Comparing visual revisions' },

	// Universal AI Engineering Engine & Unified Orchestrator
	ai_orchestrate_project: { done: 'Orchestrated dual-engine plan', proposed: 'Orchestrate project engines', running: 'Routing Universal & AI engines' },
	ai_design_architecture: { done: 'Designed AI architecture', proposed: 'Design AI architecture', running: 'Designing AI architecture' },
	ai_probe_compute_hardware: { done: 'Probed compute & GPUs', proposed: 'Probe compute hardware', running: 'Probing CPUs, GPUs & AI runtimes' },
	ai_recommend_training_strategy: { done: 'Planned training strategy', proposed: 'Recommend training strategy', running: 'Planning model training strategy' },
	ai_profile_dataset: { done: 'Profiled dataset', proposed: 'Profile dataset', running: 'Profiling dataset schema & quality' },
	ai_rag_build_index: { done: 'Built hybrid RAG index', proposed: 'Build hybrid RAG index', running: 'Ingesting & indexing RAG knowledge' },
	ai_rag_query: { done: 'Queried RAG knowledge', proposed: 'Query RAG index', running: 'Retrieving grounded RAG context' },
	ai_rag_evaluate: { done: 'Evaluated RAG retrieval', proposed: 'Evaluate RAG retrieval', running: 'Running RAG retrieval benchmarks' },
	ai_experiment_manage: { done: 'Updated AI experiments', proposed: 'Manage AI experiments', running: 'Tracking AI experiment run' },
	ai_model_registry: { done: 'Updated model registry', proposed: 'Manage model registry', running: 'Updating model registry' },
	ai_evaluate_system: { done: 'Evaluated AI system', proposed: 'Evaluate AI system', running: 'Running quantitative AI evaluation' },
	ai_audit_security: { done: 'Audited AI security', proposed: 'Audit AI security', running: 'Scanning AI security & governance' },
	ai_estimate_performance_cost: { done: 'Estimated AI cost & latency', proposed: 'Estimate AI cost & latency', running: 'Estimating AI latency & cost' },
	ai_create_workflow: { done: 'Compiled AI workflow', proposed: 'Create AI workflow', running: 'Compiling executable AI workflow' },
	ai_run_workflow: { done: 'Executed AI workflow', proposed: 'Run AI workflow', running: 'Executing AI workflow steps' },
	ai_research_analyze: { done: 'Synthesized AI research', proposed: 'Analyze AI research', running: 'Analyzing AI research methods' },
	ai_discover_capabilities: { done: 'Explored AI capabilities', proposed: 'Discover AI capabilities', running: 'Searching future AI capabilities' },
	ai_scaffold_product_factory: { done: 'Generated AI Product Factory blueprint', proposed: 'Scaffold AI Product Factory', running: 'Planning 9-phase AI Product Factory' },
	ai_diagnose_failure: { done: 'Diagnosed AI failure', proposed: 'Diagnose AI failure', running: 'Investigating AI failure root cause' },
	ai_check_provider_capabilities: { done: 'Checked AI provider matrix', proposed: 'Check AI providers', running: 'Inspecting BYOK & local model capabilities' },
	// Kodia API Engineering Studio
	api_open_studio: { done: 'Opened Kodia API Studio', proposed: 'Open API Studio', running: 'Opening native API Engineering Studio' },
	api_discover_project: { done: 'Discovered project APIs', proposed: 'Discover project APIs', running: 'Scanning routes, specs & services' },
	api_runtime_start: { done: 'Started API service runtime', proposed: 'Start API runtime', running: 'Starting API server & checking health' },
	api_runtime_status: { done: 'Checked API runtimes', proposed: 'Check API runtimes', running: 'Inspecting running API services & logs' },
	api_runtime_stop: { done: 'Stopped API service runtime', proposed: 'Stop API runtime', running: 'Stopping API server process' },
	api_send_request: { done: 'Executed API request', proposed: 'Send API request', running: 'Sending live API request' },
	api_websocket_session: { done: 'Updated WebSocket session', proposed: 'Manage WebSocket session', running: 'Running live WebSocket operation' },
	api_generate_test_suite: { done: 'Generated API test suite', proposed: 'Generate API test suite', running: 'Synthesizing automated API tests' },
	api_run_test_suite: { done: 'Ran API test suite', proposed: 'Run API test suite', running: 'Executing live API test suite' },
	api_run_load_test: { done: 'Completed API load test', proposed: 'Run API load test', running: 'Executing concurrent performance load test' },
	api_security_audit: { done: 'Audited API security', proposed: 'Audit API security', running: 'Running static & live API security assessment' },
	api_compare_responses: { done: 'Compared API responses', proposed: 'Compare API responses', running: 'Diffing response status, headers & JSON' },
	api_generate_openapi: { done: 'Generated OpenAPI 3.1 spec', proposed: 'Generate OpenAPI spec', running: 'Generating OpenAPI 3.1 specification' },
	api_diff_specs: { done: 'Compared OpenAPI specs', proposed: 'Diff OpenAPI specs', running: 'Checking for API breaking changes' },
	api_generate_client_sdk: { done: 'Generated API client SDK', proposed: 'Generate API client SDK', running: 'Generating typed API client code' },
	api_mock_server: { done: 'Managed API mock server', proposed: 'Manage API mock server', running: 'Configuring local API mock server' },
	api_manage_collection: { done: 'Updated API collections', proposed: 'Manage API collection', running: 'Updating API collections & imports' },
	api_manage_environment: { done: 'Updated API environment', proposed: 'Manage API environment', running: 'Updating API environment & variables' },
	api_assess_production_readiness: { done: 'Assessed API readiness', proposed: 'Assess production readiness', running: 'Evaluating 6-pillar API production readiness' },
	api_correlate_failure: { done: 'Correlated API failure', proposed: 'Correlate API failure', running: 'Correlating failure with logs & source code' },
	// Kodia Deep Debugging, Software Correctness & Independent Verification
	correctness_open_hub: { done: 'Opened Correctness Hub', proposed: 'Open Correctness Hub', running: 'Opening Debugging & Correctness Hub' },
	correctness_analyze_workspace: { done: 'Analyzed workspace correctness', proposed: 'Analyze correctness', running: 'Running incremental & deep defect analysis' },
	correctness_run_compilers: { done: 'Ran multi-language compilers', proposed: 'Run compiler checks', running: 'Executing native compilers & syntax checks' },
	correctness_taint_analysis: { done: 'Completed taint analysis', proposed: 'Run taint analysis', running: 'Tracing data flows from sources to sinks' },
	correctness_investigate_root_cause: { done: 'Completed root-cause analysis', proposed: 'Investigate root cause', running: 'Ranking evidence-backed root-cause hypotheses' },
	correctness_run_fuzz_test: { done: 'Completed property/fuzz test', proposed: 'Run fuzz test', running: 'Fuzzing inputs & minimizing counterexamples' },
	correctness_run_mutation_test: { done: 'Completed mutation testing', proposed: 'Run mutation test', running: 'Evaluating isolated mutants against test suite' },
	correctness_plan_repair: { done: 'Planned targeted repair', proposed: 'Plan targeted repair', running: 'Computing smallest safe fix & blast radius' },
	correctness_independent_verify: { done: 'Issued independent verdict', proposed: 'Run independent verification', running: 'Independently verifying compilers, taint & tests' },
	correctness_create_proof_record: { done: 'Saved proof-carrying record', proposed: 'Create proof record', running: 'Persisting proof-carrying change evidence' },
	correctness_assess_release_readiness: { done: 'Assessed release readiness', proposed: 'Assess release readiness', running: 'Evaluating risk-based release readiness gates' },
	correctness_export_sarif: { done: 'Exported SARIF 2.1.0 report', proposed: 'Export SARIF report', running: 'Formatting diagnostics as SARIF 2.1.0' },
	correctness_list_proofs: { done: 'Listed proof records', proposed: 'List proof records', running: 'Loading persisted verification proofs' },
	correctness_manage_suppressions: { done: 'Updated suppressions', proposed: 'Manage suppressions', running: 'Updating justified diagnostic suppressions' },
	// Kodia Next-Gen Evolution, Supply-Chain, IaC/FinOps, Ops & Governance
	evolution_open_hub: { done: 'Opened Evolution & Ops Hub', proposed: 'Open Evolution Hub', running: 'Opening Next-Gen Evolution & Ops Hub' },
	evolution_supply_chain_sbom: { done: 'Generated CycloneDX SBOM & supply-chain audit', proposed: 'Audit supply chain & SBOM', running: 'Scanning dependencies, licenses & CycloneDX 1.5 SBOM' },
	evolution_audit_iac_finops: { done: 'Audited IaC & FinOps costs', proposed: 'Audit IaC & FinOps', running: 'Auditing Dockerfile/K8s/Terraform/CI-CD & cloud costs' },
	evolution_analyze_incident: { done: 'Completed incident & SLO forensics', proposed: 'Analyze incident logs', running: 'Computing error clusters, P95 latency & SLO burn rate' },
	evolution_plan_release: { done: 'Generated autonomous release plan', proposed: 'Plan release & migrations', running: 'Analyzing git history, SemVer & migration safety' },
	evolution_audit_privacy_compliance: { done: 'Audited privacy & compliance', proposed: 'Audit GDPR/SOC2/HIPAA/AI Act', running: 'Scanning PII flows & compliance controls' },
	evolution_plan_modernization: { done: 'Planned Strangler-Fig modernization', proposed: 'Plan legacy modernization', running: 'Analyzing monolith hotspots & migration waves' },
	evolution_run_capability_radar: { done: 'Completed Capability Evolution Radar', proposed: 'Run capability radar', running: 'Evaluating emerging capabilities & filtering hype' },
	evolution_evaluate_technology: { done: 'Evaluated technology candidate', proposed: 'Evaluate technology signal vs hype', running: 'Scoring maturity, license compatibility & hype risk' },
	evolution_manage_proposals: { done: 'Updated Evolution proposals', proposed: 'Manage evolution proposals', running: 'Updating governed capability proposals' },
	evolution_schedule_periodic_audit: { done: 'Scheduled periodic evolution audit', proposed: 'Schedule periodic audit', running: 'Registering recurring capability-discovery job' },
	evolution_workspace_overview: { done: 'Loaded Evolution & Ops overview', proposed: 'Load evolution overview', running: 'Aggregating supply-chain, IaC, prod, compliance & radar' },
	// Kodia Permanent Mobile Application Engineering Platform
	mobile_open_studio: { done: 'Opened Mobile Studio', proposed: 'Open Mobile Studio', running: 'Opening Kodia Mobile Engineering Studio' },
	mobile_probe_environment: { done: 'Probed mobile SDKs & devices', proposed: 'Probe mobile environment', running: 'Detecting Android/iOS/Flutter/RN SDKs & devices' },
	mobile_inspect_project: { done: 'Inspected mobile project', proposed: 'Inspect mobile project', running: 'Analyzing mobile architecture, screens & configs' },
	mobile_design_architecture: { done: 'Designed mobile architecture', proposed: 'Design mobile architecture', running: 'Orchestrating Three-Engine mobile architecture' },
	mobile_scaffold_project: { done: 'Scaffolded mobile project', proposed: 'Scaffold mobile project', running: 'Generating mobile client, backend & tests' },
	mobile_device_action: { done: 'Executed device action', proposed: 'Run mobile device action', running: 'Running ADB/Emulator/Simulator control' },
	mobile_build_and_test: { done: 'Ran mobile build/tests', proposed: 'Run mobile build/tests', running: 'Executing mobile/backend build & test suite' },
	mobile_audit_security: { done: 'Audited mobile security', proposed: 'Audit mobile security (MASVS)', running: 'Scanning OWASP MASVS/MASTG security rules' },
	mobile_audit_performance: { done: 'Audited mobile performance', proposed: 'Audit mobile performance', running: 'Analyzing mobile rendering & startup hotspots' },
	mobile_assess_readiness: { done: 'Assessed store readiness', proposed: 'Assess mobile store readiness', running: 'Evaluating Android/iOS production & store gates' },
	mobile_discover_capabilities: { done: 'Discovered mobile capabilities', proposed: 'Discover mobile capabilities', running: 'Querying mobile technology catalogue' },
	mobile_workspace_overview: { done: 'Loaded Mobile Studio snapshot', proposed: 'Load mobile overview', running: 'Loading persisted .kodia/mobile/ state' },
	lei_open_dashboard: { done: 'Opened Live Engineering Intelligence', proposed: 'Open Live Engineering Intelligence', running: 'Opening Live Engineering Intelligence dashboard' },
	lei_assess_freshness: { done: 'Assessed knowledge freshness', proposed: 'Assess freshness risk', running: 'Evaluating information freshness category (A–D)' },
	lei_research_technology: { done: 'Completed live technology research', proposed: 'Research official documentation', running: 'Researching current official documentation' },
	lei_discover_models: { done: 'Discovered current AI models', proposed: 'Discover provider model catalog', running: 'Querying current AI provider model catalog' },
	lei_verify_model: { done: 'Verified AI model selection', proposed: 'Verify AI model identifier', running: 'Checking model availability, deprecation & capabilities' },
	lei_check_dependency: { done: 'Verified dependency metadata', proposed: 'Verify package registry & security', running: 'Inspecting package registry & OSV advisories' },
	lei_check_security: { done: 'Checked security advisories', proposed: 'Check OSV/CVE security advisories', running: 'Querying official security advisory databases' },
	lei_diagnose_error: { done: 'Diagnosed failure with live docs', proposed: 'Research failure root cause', running: 'Researching current docs for failure migration' },
	lei_inspect_evidence: { done: 'Loaded verified research evidence', proposed: 'Inspect research evidence', running: 'Loading persisted verification evidence' },
	lei_refresh_knowledge: { done: 'Refreshed stale knowledge cache', proposed: 'Refresh stale engineering cache', running: 'Refreshing expired engineering intelligence' },
	kdre_inspect_config: { done: 'Inspected project configuration', proposed: 'Inspect project configuration', running: 'Scanning tsconfig, package, Python & build configs' },
	kdre_check_dependencies: { done: 'Verified dependency resolution', proposed: 'Verify dependency resolution', running: 'Checking node_modules, @types, venv & autoload' },
	kdre_probe_servers: { done: 'Probed language server health', proposed: 'Probe language server health', running: 'Checking language server versions & status' },
	kdre_verify_compilers: { done: 'Ran independent compiler check', proposed: 'Run independent compiler check', running: 'Running workspace compiler & type checkers' },
	kdre_evaluate_diagnostics: { done: 'Classified & cross-checked diagnostics', proposed: 'Classify editor diagnostics', running: 'Cross-checking editor diagnostics against compilers' },
	kdre_investigate_diagnostic: { done: 'Investigated suspicious diagnostic', proposed: 'Investigate suspicious diagnostic', running: 'Investigating potential false positive with evidence' },
	kdre_recover: { done: 'Executed diagnostic recovery action', proposed: 'Recover language server / diagnostics', running: 'Executing safe diagnostic recovery action' },
	fpere_analyze_architecture: { done: 'Analyzed repository architecture', proposed: 'Analyze repository architecture', running: 'Mapping symbols, layers, APIs & conventions' },
	fpere_create_blueprint: { done: 'Saved contract-first blueprint', proposed: 'Create engineering blueprint', running: 'Persisting contracts, models & Task DAG' },
	fpere_validate_imports: { done: 'Validated imports, exports & hygiene', proposed: 'Validate imports & exports', running: 'Verifying relative imports, exports & packages' },
	fpere_check_integration: { done: 'Checked full-stack integration', proposed: 'Check full-stack integration', running: 'Cross-checking frontend/backend/DB/env contracts' },
	fpere_run_quality_gate: { done: 'Evaluated First-Pass Quality Gate', proposed: 'Run First-Pass Quality Gate', running: 'Running imports, contracts, compiler & tests' },
	fpere_coordinate_agents: { done: 'Updated multi-agent ownership', proposed: 'Coordinate agent ownership', running: 'Checking DAG readiness & file ownership leases' },
	fpere_plan_repair: { done: 'Created root-cause repair plan', proposed: 'Plan controlled repair', running: 'Classifying root cause & bounded retry plan' },
	fpere_get_status: { done: 'Loaded FPERE live status', proposed: 'Load FPERE status', running: 'Loading blueprint, quality gate & leases' },
	eric_specify_behavior: { done: 'Saved behavioral specification', proposed: 'Specify behavioral requirements', running: 'Recording requirements, edge cases & acceptance criteria' },
	eric_evaluate_approaches: { done: 'Evaluated technical approaches', proposed: 'Evaluate technical approaches', running: 'Scoring engineering trade-offs & reliability' },
	eric_verify_api_usage: { done: 'Verified installed API declarations', proposed: 'Verify installed API usage', running: 'Inspecting node_modules declarations against code' },
	eric_analyze_semantics: { done: 'Completed semantic & behavioral audit', proposed: 'Analyze semantic correctness', running: 'Auditing async races, algorithms, security & test oracles' },
	eric_independent_review: { done: 'Completed independent engineering review', proposed: 'Run independent engineering review', running: 'Auditing evidence, assumptions, risks & tests' },
	eric_record_failure_lesson: { done: 'Recorded verified engineering lesson', proposed: 'Record failure lesson', running: 'Validating verification evidence & persisting lesson' },
	uabe_open_workspace: { done: 'Opened Universal App Builder', proposed: 'Open Universal App Builder', running: 'Opening Kodia Universal App Builder workspace' },
	uabe_init_project: { done: 'Initialized App Builder project', proposed: 'Initialize App Builder project', running: 'Extracting requirements, stack & IRIRE credentials' },
	uabe_analyze_contract: { done: 'Extracted Contract-to-Product matrix', proposed: 'Analyze contract / brief', running: 'Extracting traceable requirements & workflows' },
	uabe_recommend_stack: { done: 'Selected universal architecture & stack', proposed: 'Recommend architecture & stack', running: 'Evaluating architecture & stack trade-offs' },
	uabe_discover_integrations: { done: 'Discovered external requirements (IRIRE)', proposed: 'Discover external requirements', running: 'Scanning accounts, API keys & official setup links' },
	uabe_configure_integration: { done: 'Saved encrypted credential (IRIRE)', proposed: 'Configure integration credential', running: 'Encrypting secret & validating credential format' },
	uabe_apply_visual_edit: { done: 'Synced visual edit to source code', proposed: 'Apply visual edit to source', running: 'Creating checkpoint & patching real source file' },
	uabe_scaffold_app: { done: 'Scaffolded verified application', proposed: 'Scaffold application', running: 'Generating starter architecture & runnable tests' },
	uabe_evaluate_reliability: { done: 'Evaluated truthful reliability dashboard', proposed: 'Evaluate application reliability', running: 'Running FPERE + ERIC + IRIRE + runtime checks' },
	uabe_generate_handover: { done: 'Generated client handover package', proposed: 'Generate client handover', running: 'Building docs, QA report, deck & secret-free .env' },
	uaep_open_studio: { done: 'Opened Automation Studio', proposed: 'Open Automation Studio', running: 'Opening Kodia Universal Automation Studio' },
	uaep_generate_workflow: { done: 'Generated visual workflow', proposed: 'Generate visual workflow', running: 'Compiling natural language into visual workflow IR' },
	uaep_modify_workflow: { done: 'Modified workflow graph', proposed: 'Modify workflow graph', running: 'Updating workflow nodes & edges safely' },
	uaep_compile_workflow: { done: 'Compiled visual workflow to code', proposed: 'Compile visual workflow', running: 'Validating graph & generating TS/JS/Python + Docker' },
	uaep_check_code_sync: { done: 'Checked workflow-to-code sync', proposed: 'Check workflow-code sync', running: 'Comparing IR provenance hash & manual edits' },
	uaep_execute_workflow: { done: 'Executed durable workflow', proposed: 'Execute workflow', running: 'Running durable workflow steps & connectors' },
	uaep_resume_execution: { done: 'Resumed workflow execution', proposed: 'Resume workflow execution', running: 'Resuming from durable checkpoint / approval gate' },
	uaep_save_credential: { done: 'Saved encrypted tenant credential', proposed: 'Save tenant credential', running: 'Encrypting secret in tenant-isolated vault' },
	uaep_export_portable_package: { done: 'Exported standalone runtime package', proposed: 'Export standalone runtime', running: 'Packaging independent runtime, Docker & env template' },
	uaep_generate_embedded_platform: { done: 'Generated embedded automation platform', proposed: 'Generate embedded platform', running: 'Scaffolding standalone multi-tenant automation app' },
};

function humanizeToolName(toolName: string): string {
	return toolName
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\w/, c => c.toUpperCase());
}

export function getToolDisplayTitles(toolName: string): ToolDisplayTitles {
	const explicit = EXPLICIT_TITLES[toolName];
	if (explicit) { return explicit; }
	const label = humanizeToolName(toolName);
	return {
		done: label,
		proposed: label,
		running: `Running ${label.toLowerCase()}`,
	};
}

export function getToolCategory(toolName: string): ToolCategory {
	if (toolName.startsWith('ai_') || toolName.startsWith('uabe_') || toolName.startsWith('uaep_')) { return 'ai'; }
	if (toolName.startsWith('api_') || toolName.startsWith('oauth2_')) { return 'api'; }
	if (toolName.startsWith('correctness_') || toolName.startsWith('eric_') || toolName.startsWith('fpere_') || toolName.startsWith('kdre_')) { return 'debug'; }
	if (toolName.startsWith('evolution_')) { return 'ai'; }
	if (
		toolName.includes('design_')
		|| toolName.includes('visual_')
		|| toolName.includes('color_palette')
		|| toolName.includes('page_architecture')
		|| toolName.includes('responsive_layout')
		|| toolName.includes('image_providers')
		|| toolName.includes('icon_library')
		|| toolName.includes('typography')
		|| toolName.includes('ui_components')
		|| toolName.includes('component_variants')
		|| toolName === 'capture_application_screenshots'
		|| toolName === 'audit_accessibility'
		|| toolName === 'audit_frontend_performance'
		|| toolName === 'critique_interface_design'
		|| toolName === 'repair_visual_defects'
	) { return 'design'; }
	if (toolName.startsWith('git_')) { return 'git'; }
	if (toolName.startsWith('test_')) { return 'test'; }
	if (toolName.startsWith('debug_')) { return 'debug'; }
	if (toolName.startsWith('browser_')) { return 'browser'; }
	if (toolName.startsWith('code_') || toolName.startsWith('search_') || toolName === 'go_to_definition' || toolName === 'find_references') { return 'search'; }
	if (toolName === 'subagent') { return 'agent'; }
	if (toolName.includes('task_plan') || toolName === 'todo') { return 'plan'; }
	if (toolName.includes('project_memory')) { return 'memory'; }
	if (toolName === 'fetch_url' || toolName === 'web_search') { return 'web'; }
	if (toolName.startsWith('api_') || toolName.startsWith('oauth2_')) { return 'api'; }
	if (toolName.includes('notebook')) { return 'notebook'; }
	if (toolName === 'edit_file' || toolName === 'rewrite_file' || toolName === 'write_file' || toolName === 'create_file_or_folder' || toolName === 'delete_file_or_folder' || toolName === 'move_or_rename_file') { return 'edit'; }
	if (toolName === 'read_file' || toolName === 'ls_dir' || toolName === 'get_dir_tree' || toolName === 'read_lint_errors' || toolName === 'workspace_diagnostics' || toolName === 'file_metadata' || toolName === 'log_read') { return 'file'; }
	if (toolName === 'project_health_scan' || toolName === 'architecture_map' || toolName === 'dependency_audit') { return 'search'; }
	if (toolName.includes('terminal') || toolName.includes('command') || toolName.startsWith('dev_server_') || toolName.startsWith('docker_') || toolName.startsWith('db_') || toolName === 'env_inspect' || toolName === 'dep_install' || toolName === 'lint_run' || toolName === 'port_check' || toolName === 'autonomous_dev_cycle') { return 'terminal'; }
	return 'mcp';
}

export function summarizeToolParams(toolName: string, params: Record<string, unknown> | undefined): { desc1: string; desc1Info?: string } {
	if (!params || typeof params !== 'object') { return { desc1: '' }; }

	const str = (key: string): string | undefined => {
		const v = params[key];
		if (typeof v === 'string' && v.trim()) { return v.trim(); }
		return undefined;
	};

	const uriPath = (): string | undefined => {
		const u = params.uri as { fsPath?: string; path?: string } | string | undefined;
		if (!u) { return undefined; }
		if (typeof u === 'string') { return u; }
		return u.fsPath || u.path;
	};

	const base = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;

	if (toolName === 'subagent') {
		const agent = str('agent') ?? 'general';
		const desc = str('description') ?? '';
		return { desc1: desc ? `[${agent}] ${desc}` : `[${agent}]`, desc1Info: str('model') };
	}
	if (toolName === 'create_task_plan') {
		const title = str('title') ?? '';
		const count = Array.isArray(params.tasks) ? params.tasks.length : 0;
		return { desc1: title ? `${title} (${count} tasks)` : `${count} tasks` };
	}
	if (toolName === 'update_task_plan') {
		const id = str('taskId') ?? str('task_id') ?? '';
		const status = str('status') ?? '';
		return { desc1: [id, status].filter(Boolean).join(' → ') };
	}
	if (toolName === 'todo') {
		const count = Array.isArray(params.todos) ? params.todos.length : 0;
		return { desc1: `${count} item${count === 1 ? '' : 's'}` };
	}
	if (toolName === 'web_search' || toolName === 'code_semantic_search' || toolName === 'code_keyword_search' || toolName === 'code_hybrid_search') {
		const q = str('query');
		return { desc1: q ? `"${q}"` : '' };
	}
	if (toolName === 'browser_navigate' || toolName === 'browser_new_tab' || toolName === 'browser_download') {
		const url = str('url');
		return { desc1: url ?? '' };
	}
	if (toolName.startsWith('browser_') && str('selector')) {
		return { desc1: str('selector')! };
	}
	if (toolName === 'debug_set_breakpoint' || toolName === 'debug_remove_breakpoint') {
		const file = str('file') ?? str('path') ?? uriPath();
		const line = typeof params.line === 'number' ? `:${params.line}` : '';
		return { desc1: file ? `${base(file)}${line}` : (str('breakpointId') ?? ''), desc1Info: file };
	}
	if (toolName === 'debug_evaluate_expression') {
		return { desc1: str('expression') ?? '' };
	}
	if (toolName === 'debug_start_session' || toolName === 'debug_attach_session') {
		const cfg = params.configuration as { name?: string; type?: string } | undefined;
		return { desc1: str('configurationName') ?? str('name') ?? cfg?.name ?? cfg?.type ?? '' };
	}
	if (toolName.startsWith('git_')) {
		const target = str('message') ?? str('branchName') ?? str('branch') ?? str('name') ?? str('ref') ?? str('path') ?? str('commit');
		if (target) { return { desc1: target.length > 60 ? `${target.slice(0, 57)}...` : target }; }
		if (Array.isArray(params.paths) && params.paths.length > 0) {
			return { desc1: `${params.paths.length} path${params.paths.length === 1 ? '' : 's'}` };
		}
		return { desc1: '' };
	}
	if (toolName.startsWith('test_')) {
		const files = Array.isArray(params.files) ? params.files : Array.isArray(params.testFiles) ? params.testFiles : undefined;
		const names = Array.isArray(params.testNames) ? params.testNames : undefined;
		if (names?.length) { return { desc1: names.slice(0, 2).join(', ') }; }
		if (files?.length) { return { desc1: files.slice(0, 2).map(f => base(String(f))).join(', ') }; }
		return { desc1: str('testName') ?? str('file') ?? '' };
	}

	const p = uriPath() ?? str('path') ?? str('command') ?? str('url') ?? str('query') ?? str('name') ?? str('title') ?? str('expression') ?? '';
	if (!p) { return { desc1: '' }; }
	if (uriPath() || str('path')) {
		return { desc1: base(p), desc1Info: p };
	}
	return { desc1: p.length > 60 ? `${p.slice(0, 57)}...` : p };
}
