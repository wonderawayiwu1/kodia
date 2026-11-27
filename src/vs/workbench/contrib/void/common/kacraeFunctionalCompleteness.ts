/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * KACRAE Functional Completeness, Incomplete Implementation & Static-UI Detection Engine
 *
 * Determines whether an application's features are genuinely implemented and operational,
 * not merely compiling or visually rendered:
 *  - Detects placeholder, stubbed, mocked, and unfinished code
 *  - Distinguishes requirement-blocking TODO/FIXME items from harmless informational notes
 *  - Detects static/dead UI controls (empty onClick, preventDefault-only forms, href="#" dead links, unmounted handlers)
 *  - Cross-checks frontend API calls against backend routes to expose disconnected UI/backend layers
 *  - Detects stubbed backend endpoints returning hardcoded/mock data instead of persistence/business logic
 *  - Detects missing validation, error handling, loading states, and user feedback on async mutations
 *  - Builds the 7-column Functional Completeness Matrix separating confirmed failures, suspected issues & unverified items
 */

import { ScannedSourceFile } from './projectHealth.js';
import {
	KacraeFinding,
	KacraeFunctionalCompletenessReport,
	KacraeFunctionalMatrixRow,
	KacraeSeverity,
} from './kacraeTypes.js';

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isTestPath(p: string): boolean {
	const l = normPath(p).toLowerCase();
	return /(?:^|\/)(?:__tests__|tests?|spec|fixtures|mocks)\//.test(l) || /\.(?:test|spec)\.[a-z0-9]+$/.test(l);
}

function normalizeEndpoint(raw: string): string {
	return raw
		.replace(/\$\{[^}]+\}/g, ':param')
		.replace(/\{[^}]+\}/g, ':param')
		.replace(/:([a-zA-Z_]\w*)/g, ':param')
		.replace(/\?.*$/, '')
		.replace(/\/+$/, '') || '/';
}

function hashId(prefix: string, seed: string): string {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return `${prefix}-${(h >>> 0).toString(16)}`;
}

function makeFinding(params: {
	ruleId: string;
	title: string;
	severity: KacraeSeverity;
	classification: KacraeFinding['classification'];
	confidence: number;
	file: string;
	line: number;
	snippet: string;
	explanation: string;
	whyItMatters: string;
	impact: string;
}): KacraeFinding {
	const file = normPath(params.file);
	return {
		id: hashId(`kacrae-${params.ruleId.toLowerCase()}`, `${file}:${params.line}:${params.title}`),
		ruleId: params.ruleId,
		title: params.title,
		category: 'correctness',
		severity: params.severity,
		classification: params.classification,
		confidence: params.confidence,
		location: { file, startLine: Math.max(1, params.line), endLine: Math.max(1, params.line) },
		codeContext: params.snippet.slice(0, 360),
		explanation: params.explanation,
		whyItMatters: params.whyItMatters,
		preconditions: [],
		impact: params.impact,
		evidence: [`${file}:${params.line} -> ${params.snippet.trim().slice(0, 140)}`],
		relatedFindingIds: [],
		affectedComponents: [file],
		detectionMethod: 'deterministic_static',
		lifecycle: 'new',
		lifecycleHistory: [],
		createdAt: new Date().toISOString(),
	};
}

interface BackendRouteInfo {
	readonly method: string;
	readonly normalizedPath: string;
	readonly rawPath: string;
	readonly file: string;
	readonly line: number;
	readonly isStubbed: boolean;
	readonly stubReason?: string;
	readonly hasPersistenceOrService: boolean;
}

interface FrontendCallInfo {
	readonly method: string;
	readonly normalizedPath: string;
	readonly rawPath: string;
	readonly file: string;
	readonly line: number;
	readonly snippet: string;
}

export function analyzeFunctionalCompleteness(files: readonly ScannedSourceFile[]): KacraeFunctionalCompletenessReport {
	const findings: KacraeFinding[] = [];
	const matrix: KacraeFunctionalMatrixRow[] = [];
	const backendRoutes: BackendRouteInfo[] = [];
	const frontendCalls: FrontendCallInfo[] = [];

	let staticUiDefectsCount = 0;
	let disconnectedFrontendCount = 0;
	let stubBackendCount = 0;
	let hardcodedDataCount = 0;
	let requirementBlockingTodosCount = 0;
	let informationalTodosIgnored = 0;

	const prodFiles = files.filter(f => !isTestPath(f.relativePath));

	// Pass 1: Collect backend endpoints, frontend API calls, static UI defects, stubs, hardcoded mocks & contextual TODOs
	for (const file of prodFiles) {
		const rel = normPath(file.relativePath);
		const content = file.content;
		const lines = content.split(/\r?\n/);
		const isUiFile = /\.(?:tsx|jsx|vue|svelte|html)$/.test(rel) || /(?:components?|pages?|views?|ui|frontend|client)\//i.test(rel);
		const isCodeFile = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|cs|php|rb|rs|vue|svelte|html)$/.test(rel);
		if (!isCodeFile) { continue; }

		// 1A. Backend route extraction + stubbed endpoint check
		const routeRe = /\b(?:app|router|fastify|server)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`\n]+)['"`]/i;
		const pyRouteRe = /@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`\n]+)['"`]/i;
		for (let i = 0; i < lines.length; i++) {
			const m = routeRe.exec(lines[i]) ?? pyRouteRe.exec(lines[i]);
			if (!m) { continue; }
			const method = m[1].toUpperCase();
			const rawPath = m[2];
			const normalizedPath = normalizeEndpoint(rawPath);
			// Scope handler body accurately up to balanced closing brace or next route/export declaration
			let handlerEnd = Math.min(lines.length, i + 22);
			let braceDepth = 0;
			let sawBrace = false;
			for (let k = i; k < handlerEnd; k++) {
				if (k > i && /^\s*(?:app|router|fastify|server)\.(?:get|post|put|patch|delete)|^\s*export\s+/.test(lines[k])) {
					handlerEnd = k;
					break;
				}
				for (const ch of lines[k]) {
					if (ch === '{') { braceDepth++; sawBrace = true; }
					else if (ch === '}') { braceDepth--; }
				}
				if (sawBrace && braceDepth <= 0) {
					handlerEnd = k + 1;
					break;
				}
			}
			const block = lines.slice(i, handlerEnd).join('\n');

			const hasRealPersistence = /\b(?:db|pool|prisma|knex|sequelize|mongoose|sqlite|sql|store|repo|repository|service|fs\.|redis|stripe|sendMail|await\s+\w+\.(?:create|update|delete|insert|save|find|query|execute|get|set))\b/i.test(block);
			const explicitlyStubbed = /not\s+implemented|501|coming\s+soon|TODO.*implement|mock|dummy|placeholder|hardcoded/i.test(block);
			const ignoresWriteBody = (method === 'POST' || method === 'PUT' || method === 'PATCH') &&
				!/req\.body|request\.json|payload|data|params|formData/i.test(block) &&
				/res\.(?:json|send)\s*\(\s*\{[^}]*(?:ok|success|created|saved|true)/i.test(block);

			const isStubbed = explicitlyStubbed || ignoresWriteBody;
			const stubReason = explicitlyStubbed
				? 'Route handler contains explicit stub/placeholder/mock indicator or returns 501 Not Implemented'
				: ignoresWriteBody
					? `${method} endpoint returns synthetic success response without reading request body or persisting state`
					: undefined;

			backendRoutes.push({
				method,
				normalizedPath,
				rawPath,
				file: rel,
				line: i + 1,
				isStubbed,
				stubReason,
				hasPersistenceOrService: hasRealPersistence,
			});

			if (isStubbed) {
				stubBackendCount++;
				const f = makeFinding({
					ruleId: 'KACRAE-FC-STUB-API',
					title: `Stubbed/incomplete backend endpoint: ${method} ${rawPath}`,
					severity: 'high',
					classification: 'confirmed_defect',
					confidence: 0.92,
					file: rel,
					line: i + 1,
					snippet: lines[i],
					explanation: stubReason!,
					whyItMatters: 'Frontend actions targeting this endpoint appear to succeed or return fake data without performing real business logic or persistence.',
					impact: 'Broken end-to-end feature functionality and silent data loss.',
				});
				findings.push(f);
				matrix.push({
					id: hashId('fc', `${method}:${rawPath}:${rel}`),
					feature: `Backend API ${method} ${rawPath}`,
					expectedBehavior: `Execute real business logic and persistence for ${method} ${rawPath}`,
					sourceFiles: [rel],
					uiComponents: [],
					backendDependencies: [`${method} ${rawPath} (${rel}:${i + 1})`],
					verificationMethod: 'static_call_graph',
					evidence: [stubReason!],
					testResults: 'Static handler audit detected stub/no-op implementation',
					status: 'placeholder',
					certainty: 'confirmed_failure',
					severity: 'high',
					remediation: 'Implement real input validation, service/database persistence, and error handling in this endpoint.',
				});
			} else {
				matrix.push({
					id: hashId('fc', `${method}:${rawPath}:${rel}`),
					feature: `Backend API ${method} ${rawPath}`,
					expectedBehavior: `Handle ${method} ${rawPath} requests with real domain logic`,
					sourceFiles: [rel],
					uiComponents: [],
					backendDependencies: [`${method} ${rawPath} (${rel}:${i + 1})`],
					verificationMethod: 'static_call_graph',
					evidence: [hasRealPersistence ? 'Connected to persistence/service layer' : 'Handler implemented (runtime probe recommended)'],
					testResults: hasRealPersistence ? 'Static wiring verified; runtime execution pending' : 'No persistence call detected in handler body',
					status: hasRealPersistence ? 'complete' : 'partially_implemented',
					certainty: hasRealPersistence ? 'verified_working' : 'suspected_issue',
					severity: hasRealPersistence ? 'info' : 'medium',
					remediation: hasRealPersistence ? 'Run live API/integration test to verify runtime behavior.' : 'Verify whether this endpoint requires persistence or database integration.',
				});
			}
		}

		// 1B. Frontend API call extraction
		const fetchRe = /\bfetch\s*\(\s*[`'"]((?:https?:\/\/[^`'"\s]+)?\/api\/[^`'"\s]+|\/v\d+\/[^`'"\s]+)[`'"]/gi;
		const axiosRe = /\baxios\.(get|post|put|patch|delete)\s*\(\s*[`'"]([^`'"\s]+)[`'"]/gi;
		for (let i = 0; i < lines.length; i++) {
			let fm: RegExpExecArray | null;
			fetchRe.lastIndex = 0;
			while ((fm = fetchRe.exec(lines[i])) !== null) {
				const rawUrl = fm[1].replace(/^https?:\/\/[^/]+/, '');
				const surrounding = lines.slice(i, Math.min(lines.length, i + 4)).join(' ');
				const methodMatch = /method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i.exec(surrounding);
				frontendCalls.push({
					method: (methodMatch?.[1] ?? 'GET').toUpperCase(),
					normalizedPath: normalizeEndpoint(rawUrl),
					rawPath: rawUrl,
					file: rel,
					line: i + 1,
					snippet: lines[i].trim(),
				});
			}
			axiosRe.lastIndex = 0;
			while ((fm = axiosRe.exec(lines[i])) !== null) {
				const rawUrl = fm[2].replace(/^https?:\/\/[^/]+/, '');
				if (rawUrl.startsWith('/')) {
					frontendCalls.push({
						method: fm[1].toUpperCase(),
						normalizedPath: normalizeEndpoint(rawUrl),
						rawPath: rawUrl,
						file: rel,
						line: i + 1,
						snippet: lines[i].trim(),
					});
				}
			}
		}

		// 1C. Unimplemented stubs (`throw new Error('Not implemented')`, Python `raise NotImplementedError`, Rust `todo!()`/`unimplemented!()`)
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNo = i + 1;
			const trimmed = line.trim();

			if (/throw\s+new\s+Error\s*\(\s*['"`](?:not\s+implemented|todo|unimplemented|stub)/i.test(line) ||
				/\braise\s+NotImplementedError\b/.test(line) ||
				/\b(?:todo!|unimplemented!)\s*\(/.test(line)) {
				const f = makeFinding({
					ruleId: 'KACRAE-FC-UNIMPL-001',
					title: 'Unimplemented function stub throws NotImplemented error',
					severity: 'critical',
					classification: 'confirmed_defect',
					confidence: 0.98,
					file: rel,
					line: lineNo,
					snippet: trimmed,
					explanation: 'Executable code path throws a NotImplemented / todo! stub error at runtime.',
					whyItMatters: 'Any user or caller invoking this feature will encounter an immediate crash.',
					impact: 'Incomplete advertised functionality that fails at runtime.',
				});
				findings.push(f);
				matrix.push({
					id: hashId('fc-unimpl', `${rel}:${lineNo}`),
					feature: `Function in ${rel}:${lineNo}`,
					expectedBehavior: 'Execute real feature behavior instead of throwing NotImplemented',
					sourceFiles: [rel],
					uiComponents: isUiFile ? [rel] : [],
					backendDependencies: [],
					verificationMethod: 'static_call_graph',
					evidence: [trimmed],
					testResults: 'Confirmed unimplemented stub in source code',
					status: 'placeholder',
					certainty: 'confirmed_failure',
					severity: 'critical',
					remediation: 'Replace stub with complete business logic and automated verification test.',
				});
			}

			// 1D. Contextual TODO / FIXME classification (do NOT blindly flag every TODO!)
			const todoMatch = /(?:\/\/|#|\/\*)\s*(TODO|FIXME)\b[:\s-]*(.*)$/i.exec(line);
			if (todoMatch) {
				const desc = (todoMatch[2] ?? '').trim();
				const isRequirementBlocking = /\b(?:implement|wire|connect|auth|security|validate|validation|persist|save|database|db|payment|billing|backend|api|real\s+data|replace\s+mock|missing|broken|fix\s+bug|error\s+handling|submit|upload|delete)\b/i.test(desc);
				if (isRequirementBlocking) {
					requirementBlockingTodosCount++;
					findings.push(makeFinding({
						ruleId: 'KACRAE-FC-TODO-001',
						title: `Requirement-blocking ${todoMatch[1].toUpperCase()}: ${desc.slice(0, 80)}`,
						severity: 'medium',
						classification: 'strongly_supported',
						confidence: 0.84,
						file: rel,
						line: lineNo,
						snippet: trimmed,
						explanation: `Comment marks unfinished functional requirement: "${desc}".`,
						whyItMatters: 'Indicates unimplemented behavior rather than a cosmetic note.',
						impact: 'Feature is incomplete or missing required behavior.',
					}));
				} else {
					informationalTodosIgnored++;
				}
			}

			// 1E. Hardcoded / simulated mock data used directly in production modules
			if (/\b(?:const|let|var)\s+(?:MOCK_|DUMMY_|FAKE_|SAMPLE_|PLACEHOLDER_)[A-Z0-9_]+\s*=\s*[\[{]/.test(line) ||
				/\buseState\s*(?:<[^>]+>)?\s*\(\s*(?:MOCK_|DUMMY_|FAKE_|SAMPLE_)[A-Z0-9_]+/.test(line)) {
				hardcodedDataCount++;
				const f = makeFinding({
					ruleId: 'KACRAE-FC-MOCK-DATA',
					title: 'Hardcoded mock/dummy data used in production component or service',
					severity: 'high',
					classification: 'strongly_supported',
					confidence: 0.86,
					file: rel,
					line: lineNo,
					snippet: trimmed,
					explanation: 'Production module initializes or serves hardcoded mock/sample data instead of real backend/database persistence.',
					whyItMatters: 'Users see simulated data and changes will not persist across reloads or sessions.',
					impact: 'Simulated feature presented as live operational functionality.',
				});
				findings.push(f);
				matrix.push({
					id: hashId('fc-mock', `${rel}:${lineNo}`),
					feature: `Data source in ${rel}:${lineNo}`,
					expectedBehavior: 'Load and persist real records from backend API / database',
					sourceFiles: [rel],
					uiComponents: isUiFile ? [rel] : [],
					backendDependencies: ['Missing real persistence wiring'],
					verificationMethod: 'static_call_graph',
					evidence: [trimmed],
					testResults: 'Detected hardcoded mock/dummy constant in production code',
					status: 'placeholder',
					certainty: 'confirmed_failure',
					severity: 'high',
					remediation: 'Replace hardcoded mock dataset with real backend API / database queries and loading/error states.',
				});
			}

			// 1F. Static UI & Dead Interactive Controls (UI files only)
			if (isUiFile) {
				// Empty / no-op onClick, alert('Coming soon'), console.log-only onClick
				const emptyClick = /\bonClick\s*=\s*\{\s*(?:\(\s*\)\s*=>\s*\{\s*(?:\/\*[\s\S]*?\*\/)?\s*\}|\(\s*\)\s*=>\s*(?:null|undefined|void\s+0|alert\s*\(\s*['"`][^'"`]*(?:coming\s+soon|not\s+implemented|todo|placeholder)[^'"`]*['"`]\s*\)|console\.log\s*\([^)]*\)))\s*\}/i.test(line);
				if (emptyClick) {
					staticUiDefectsCount++;
					const f = makeFinding({
						ruleId: 'KACRAE-FC-DEAD-BTN',
						title: 'Static/nonfunctional UI button with empty or placeholder onClick handler',
						severity: 'high',
						classification: 'confirmed_defect',
						confidence: 0.96,
						file: rel,
						line: lineNo,
						snippet: trimmed,
						explanation: 'Button renders an interactive control whose onClick handler does nothing, only logs to console, or alerts "Coming soon".',
						whyItMatters: 'Creates a deceptive static UI where clicking advertised controls produces no real outcome.',
						impact: 'Nonfunctional user control.',
					});
					findings.push(f);
					matrix.push({
						id: hashId('fc-btn', `${rel}:${lineNo}`),
						feature: `Interactive control at ${rel}:${lineNo}`,
						expectedBehavior: 'Perform real state mutation, navigation, or backend API action on click',
						sourceFiles: [rel],
						uiComponents: [rel],
						backendDependencies: [],
						verificationMethod: 'static_call_graph',
						evidence: [trimmed],
						testResults: 'Confirmed no-op or placeholder onClick handler',
						status: 'nonfunctional',
						certainty: 'confirmed_failure',
						severity: 'high',
						remediation: 'Wire button onClick to real application logic, state update, or backend API call with user feedback.',
					});
				}

				// Dead link href="#" or javascript:void(0) without onClick on the anchor itself
				const deadAnchorMatch = /<a\b[^>]*href\s*=\s*['"](?:#|javascript:void\(0\))['"][^>]*>/i.exec(line);
				if (deadAnchorMatch && !/\bonClick\s*=/.test(deadAnchorMatch[0])) {
					staticUiDefectsCount++;
					findings.push(makeFinding({
						ruleId: 'KACRAE-FC-DEAD-LINK',
						title: 'Dead navigation link (href="#" with no click handler)',
						severity: 'medium',
						classification: 'confirmed_defect',
						confidence: 0.94,
						file: rel,
						line: lineNo,
						snippet: deadAnchorMatch[0],
						explanation: 'Anchor link uses href="#" or javascript:void(0) without any event handler or real destination.',
						whyItMatters: 'Users clicking the navigation item stay stuck on the current page.',
						impact: 'Broken navigation workflow.',
					}));
				}

				// <button> with no onClick, no disabled, and not type="submit" (check 2-line window)
				if (/<button\b/i.test(line)) {
					const btnWindow = lines.slice(i, Math.min(lines.length, i + 4)).join(' ');
					const openTag = /<button\b[^>]*>/i.exec(btnWindow)?.[0] ?? '';
					if (openTag && !/\bonClick\s*=|type\s*=\s*['"]submit['"]|\bdisabled\b|\{\.\.\./i.test(openTag) && !/<form\b/i.test(lines.slice(Math.max(0, i - 12), i).join(' '))) {
						staticUiDefectsCount++;
						findings.push(makeFinding({
							ruleId: 'KACRAE-FC-UNWIRED-BTN',
							title: 'Static <button> element has no onClick handler and is outside a submit form',
							severity: 'high',
							classification: 'strongly_supported',
							confidence: 0.87,
							file: rel,
							line: lineNo,
							snippet: openTag,
							explanation: 'Button is rendered in the UI without an onClick handler, submit type, or prop spread.',
							whyItMatters: 'Clicking this button performs no action.',
							impact: 'Dead UI control.',
						}));
					}
				}

				// Form with onSubmit={e => e.preventDefault()} doing nothing else
				if (/\bonSubmit\s*=\s*\{\s*(?:\(?\s*e\s*\)?\s*=>\s*\{\s*e\.preventDefault\(\)\s*;?\s*\}|\(?\s*e\s*\)?\s*=>\s*e\.preventDefault\(\))\s*\}/.test(line)) {
					staticUiDefectsCount++;
					const f = makeFinding({
						ruleId: 'KACRAE-FC-DEAD-FORM',
						title: 'Nonfunctional form: onSubmit only calls e.preventDefault() with no submission logic',
						severity: 'critical',
						classification: 'confirmed_defect',
						confidence: 0.97,
						file: rel,
						line: lineNo,
						snippet: trimmed,
						explanation: 'Form intercepts submission with e.preventDefault() and performs zero validation, state update, or API call.',
						whyItMatters: 'Users can fill and submit the form, but nothing is saved or executed.',
						impact: 'Completely nonfunctional form workflow.',
					});
					findings.push(f);
					matrix.push({
						id: hashId('fc-form', `${rel}:${lineNo}`),
						feature: `Form submission at ${rel}:${lineNo}`,
						expectedBehavior: 'Validate inputs, call backend/service, show loading & success/error feedback',
						sourceFiles: [rel],
						uiComponents: [rel],
						backendDependencies: [],
						verificationMethod: 'static_call_graph',
						evidence: [trimmed],
						testResults: 'Confirmed preventDefault()-only form handler',
						status: 'nonfunctional',
						certainty: 'confirmed_failure',
						severity: 'critical',
						remediation: 'Implement validation, backend API submission, loading indicator, error display, and success state.',
					});
				}
			}
		}
	}

	// Pass 2: Cross-check frontend API calls against backend routes to detect disconnected UI -> missing backend!
	if (frontendCalls.length > 0) {
		const routeKeys = new Set(backendRoutes.map(r => `${r.method} ${r.normalizedPath}`));
		const routePaths = new Set(backendRoutes.map(r => r.normalizedPath));

		for (const call of frontendCalls) {
			const exactMatch = routeKeys.has(`${call.method} ${call.normalizedPath}`);
			const pathOnlyMatch = routePaths.has(call.normalizedPath);
			if (backendRoutes.length > 0 && !exactMatch && !pathOnlyMatch) {
				disconnectedFrontendCount++;
				const f = makeFinding({
					ruleId: 'KACRAE-FC-DISCONNECTED-API',
					title: `Disconnected frontend call: ${call.method} ${call.rawPath} has no matching backend endpoint`,
					severity: 'critical',
					classification: 'confirmed_defect',
					confidence: 0.93,
					file: call.file,
					line: call.line,
					snippet: call.snippet,
					explanation: `Frontend invokes ${call.method} ${call.rawPath}, but none of the ${backendRoutes.length} discovered backend route(s) handle this path.`,
					whyItMatters: 'Clicking the UI action triggers a 404 Not Found failure at runtime.',
					impact: 'Broken frontend-to-backend integration.',
				});
				findings.push(f);
				matrix.push({
					id: hashId('fc-disc', `${call.file}:${call.line}:${call.rawPath}`),
					feature: `Frontend -> Backend integration (${call.method} ${call.rawPath})`,
					expectedBehavior: `Frontend call to ${call.method} ${call.rawPath} connects to an operational backend handler`,
					sourceFiles: [call.file],
					uiComponents: [call.file],
					backendDependencies: [`Missing route: ${call.method} ${call.rawPath}`],
					verificationMethod: 'static_call_graph',
					evidence: [call.snippet, `Discovered backend routes: ${[...routeKeys].slice(0, 8).join(', ')}`],
					testResults: 'Cross-layer call-graph check found no matching backend handler',
					status: 'broken',
					certainty: 'confirmed_failure',
					severity: 'critical',
					remediation: `Implement ${call.method} ${call.rawPath} in the backend router or align the frontend URL with the real backend endpoint.`,
				});
			}
		}
	}

	const counts = {
		complete: matrix.filter(m => m.status === 'complete').length,
		partially_implemented: matrix.filter(m => m.status === 'partially_implemented').length,
		nonfunctional: matrix.filter(m => m.status === 'nonfunctional').length,
		placeholder: matrix.filter(m => m.status === 'placeholder').length,
		broken: matrix.filter(m => m.status === 'broken').length,
		unverified: matrix.filter(m => m.status === 'unverified').length,
	};

	const totalDefects = counts.nonfunctional + counts.placeholder + counts.broken + staticUiDefectsCount + disconnectedFrontendCount + stubBackendCount;

	return {
		analyzedAt: new Date().toISOString(),
		browserVerified: false,
		apiVerified: false,
		counts,
		staticUiDefectsCount,
		disconnectedFrontendCount,
		stubBackendCount,
		hardcodedDataCount,
		requirementBlockingTodosCount,
		informationalTodosIgnored,
		matrix,
		findings,
		summary: totalDefects > 0
			? `Functional Completeness audit detected ${findings.length} completeness defect(s): ${staticUiDefectsCount} static/dead UI control(s), ${disconnectedFrontendCount} disconnected frontend-backend call(s), ${stubBackendCount} stubbed backend endpoint(s), ${hardcodedDataCount} hardcoded mock dataset(s), ${requirementBlockingTodosCount} requirement-blocking TODO(s) (${informationalTodosIgnored} benign TODOs ignored).`
			: `Static functional completeness check found 0 placeholder/dead-UI/disconnected-API defects across ${prodFiles.length} file(s) (${counts.complete} wired feature(s)). Run live browser/API verification to confirm runtime behavior.`,
		honestLimitations: [
			'Static call-graph analysis identifies structural stubs, dead UI controls, mock data, and disconnected routes, but live runtime verification (browser automation + API probes + database assertions) is required to prove end-to-end runtime behavior.',
		],
	};
}
