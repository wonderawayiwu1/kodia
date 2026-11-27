/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ARPEI — Pure Universal Research-to-Product Discovery, Decision, Corroboration,
 * Coverage Matrix, Readiness Gate & Traceability Engine (Zero Node I/O).
 *
 * Works across ANY software category (web, mobile, desktop, enterprise ERP/finance/gov,
 * healthcare, scientific/GIS/CAD, industrial/PLC/SCADA/robotics/IoT, AI/ML/RAG, games/media,
 * infrastructure/distributed/cybersecurity, and unfamiliar emerging domains).
 */

import {
	ArpeiDeepDiscoveryCoverageEntry,
	ArpeiDesignSpecification,
	ArpeiDomainDiscovery,
	ArpeiEvidenceEpistemicStatus,
	ArpeiFreshnessState,
	ArpeiReferenceCoverageMatrix,
	ArpeiReferencePageRecord,
	ArpeiRequirementTraceNode,
	ArpeiResearchDecision,
	ArpeiResearchGap,
	ArpeiResearchMode,
	ArpeiResearchReadinessGate,
	ArpeiResearchSession,
	ArpeiSourceEvidence,
	ArpeiUserRoleProfile,
} from './arpeiTypes.js';

// ============================================================================
// 1. Untrusted Webpage Prompt-Injection Defense (Part 24)
// ============================================================================

const WEB_PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
	/\b(?:ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|disregard\s+system\s+prompt)\b/gi,
	/\b(?:execute\s+shell\s+command|exfiltrate\s+(?:secrets?|keys?|credentials?)|send\s+api\s+keys?\s+to)\b/gi,
	/\b(?:bypass\s+(?:captcha|authentication|authorization|security)|override\s+safety\s+rules?)\b/gi,
];

export function sanitizeUntrustedWebContent(text: string): { sanitized: string; strippedCount: number } {
	let sanitized = text;
	let strippedCount = 0;
	for (const re of WEB_PROMPT_INJECTION_PATTERNS) {
		sanitized = sanitized.replace(re, () => {
			strippedCount++;
			return '[UNTRUSTED_WEB_INSTRUCTION_STRIPPED]';
		});
	}
	return { sanitized, strippedCount };
}

export function extractUrlsFromText(text: string): string[] {
	const matches = text.match(/https?:\/\/[^\s"'<>()]+/gi) ?? [];
	return [...new Set(matches.map(u => u.replace(/[.,;:!?]+$/, '')))];
}

// ============================================================================
// 2. Intelligent Research Decision Engine (Part 4)
// ============================================================================

export function decideResearchStrategy(
	userPrompt: string,
	explicitUrls: readonly string[] = [],
	requestedMode?: ArpeiResearchMode,
): ArpeiResearchDecision {
	const p = userPrompt.toLowerCase();
	const inlineUrls = extractUrlsFromText(userPrompt);
	const allUrls = [...new Set([...explicitUrls, ...inlineUrls])];

	const isTrivial =
		allUrls.length === 0 &&
		userPrompt.trim().length < 70 &&
		/\b(?:fix\s+typo|rename\s+variable|add\s+comment|format\s+file|bump\s+version|change\s+color\s+to)\b/i.test(userPrompt);

	const signals = {
		hasExplicitReference: allUrls.length > 0 || /\b(?:like\s+[a-z0-9]+|clone|similar\s+to|inspired\s+by|reference|competitor|recreate)\b/i.test(p),
		involvesChangingTech: /\b(?:api|sdk|llm|ai|openai|anthropic|gemini|next\.?js|react|flutter|swift|kubernetes|terraform|stripe|supabase|playwright|ros2|cuda|webgpu)\b/i.test(p),
		requiresDomainKnowledge: /\b(?:healthcare|hospital|ehr|fhir|banking|fintech|payment|insurance|aviation|scada|plc|robotics|cad|gis|geospatial|erp|crm|hr|government|education|logistics|supply\s+chain|scientific|laboratory|energy|iot|firmware|game|cybersecurity)\b/i.test(p),
		needsVisualInspiration: /\b(?:website|web\s+app|landing\s+page|dashboard|store|ecommerce|marketplace|mobile\s+app|ui|ux|design|portal|studio|platform)\b/i.test(p),
		requiresExternalServices: /\b(?:stripe|twilio|oauth|saml|oidc|s3|cloudflare|aws|gcp|azure|maps|mapbox|email|webhook|payment|sms|search)\b/i.test(p),
		involvesStandardsOrSafety: /\b(?:hipaa|fhir|hl7|pci|soc2|iso\s*27001|gdpr|wcag|faa|do-178|iec\s*62443|iec\s*61508|fda|government|safety|medical|financial|aviation|automotive)\b/i.test(p),
		needsAssetsOrDatasets: /\b(?:images?|photos?|icons?|illustrations?|thumbnails?|media|3d|textures?|audio|video|dataset|maps?|sprites?|assets?)\b/i.test(p),
		benefitsFromCompetitorResearch: /\b(?:build|create|develop|design|platform|marketplace|saas|app|system|portal|tool|product)\b/i.test(p) && !isTrivial,
		needsBrowserInspection: allUrls.length > 0 || /\b(?:inspect|browse|visit|screenshot|compare|website|webapp|reference|like\s+\w+)\b/i.test(p),
		requiresPlatformOrHardwareDocs: /\b(?:android|ios|macos|windows|linux|embedded|firmware|esp32|stm32|raspberry|arduino|plc|modbus|opc-ua|can\s*bus|bluetooth|ble|usb|gpu|cuda|sensor|robot)\b/i.test(p),
	};

	const activeSignalCount = Object.values(signals).filter(Boolean).length;
	const shouldResearch = requestedMode === 'fast_implementation'
		? signals.hasExplicitReference
		: !isTrivial && activeSignalCount >= 1;

	const reasons: string[] = [];
	if (signals.hasExplicitReference) { reasons.push('User supplied or implied a reference product/website that should be directly inspected.'); }
	if (signals.requiresDomainKnowledge) { reasons.push('Request targets a specialized domain with non-trivial operational workflows, terminology, and rules.'); }
	if (signals.involvesStandardsOrSafety) { reasons.push('Domain involves regulatory, accessibility, or safety standards requiring authoritative documentation.'); }
	if (signals.involvesChangingTech) { reasons.push('Technology stack involves rapidly evolving SDKs, APIs, or model identifiers.'); }
	if (signals.needsVisualInspiration) { reasons.push('Visual design language, navigation, and interaction patterns should be evidence-backed.'); }
	if (signals.requiresPlatformOrHardwareDocs) { reasons.push('Target involves platform/hardware protocols requiring official specifications.'); }

	const recommendedDepth: ArpeiResearchDecision['recommendedDepth'] =
		!shouldResearch ? 'skip_trivial' :
		requestedMode === 'fast_implementation' ? 'targeted' :
		(signals.hasExplicitReference || signals.requiresDomainKnowledge || signals.involvesStandardsOrSafety || activeSignalCount >= 4) ? 'deep_discovery' :
		activeSignalCount >= 2 ? 'standard' : 'targeted';

	const recommendedMode: ArpeiResearchMode =
		requestedMode ??
		(isTrivial ? 'fast_implementation' :
			allUrls.length > 0 ? 'user_directed_research' :
			/\b(?:existing|enhance|improve|upgrade|add\s+to\s+our)\b/i.test(p) ? 'existing_project_enhancement' :
			'autonomous_research_and_build');

	const coreTopic = userPrompt.trim().replace(/https?:\/\/\S+/g, '').trim().slice(0, 90);
	const proposedQueries: string[] = [];
	if (shouldResearch) {
		if (coreTopic) {
			proposedQueries.push(`${coreTopic} architecture features workflows`);
			if (signals.involvesStandardsOrSafety) { proposedQueries.push(`${coreTopic} standards compliance security best practices`); }
			if (signals.involvesChangingTech || signals.requiresPlatformOrHardwareDocs) { proposedQueries.push(`${coreTopic} official documentation API SDK latest`); }
			if (signals.needsVisualInspiration && allUrls.length === 0) { proposedQueries.push(`leading examples of ${coreTopic} UI UX`); }
		}
	}

	return {
		shouldResearch,
		recommendedMode,
		recommendedDepth,
		signals,
		reasons,
		proposedQueries: proposedQueries.slice(0, 5),
		skipReason: !shouldResearch ? 'Trivial/localized edit does not justify external web research.' : undefined,
	};
}

// ============================================================================
// 3. Universal Domain & Role Discovery (Part 2.2 & Master Addition §2)
// ============================================================================

export function discoverDomainProfile(userPrompt: string): ArpeiDomainDiscovery {
	const p = userPrompt.toLowerCase();

	let softwareCategory = 'Custom Software Application';
	let industry = 'General Software & Digital Products';
	let domain = 'Multi-tier Software System';
	let requiresQualifiedHumanReview = false;
	let humanReviewReason: string | undefined;

	const regulations: string[] = [];
	const testingMethods = new Set<string>(['Unit tests', 'Integration tests', 'End-to-end workflow tests', 'Functional completeness verification']);
	const hardwareOrInfra: string[] = [];
	const externalServices: string[] = [];
	const securityReqs = new Set<string>(['Server-side input validation', 'Least-privilege authorization', 'Secret redaction & safe credential handling']);
	const workflows = new Set<string>(['Onboarding & configuration', 'Core operational workflow', 'Search/filter & inspection', 'Error handling & recovery']);
	const entities = new Set<string>(['User', 'Workspace', 'AuditEvent']);
	const rules = new Set<string>(['Enforce server-side validation and authorization on all state mutations', 'Persist real application state rather than simulated UI state']);
	const roles: ArpeiUserRoleProfile[] = [
		{
			role: 'Standard User',
			description: 'Primary end user performing day-to-day product workflows.',
			capabilities: ['View domain data', 'Execute core workflows', 'Manage personal preferences'],
			permissionsBoundary: 'Scoped strictly to own/assigned workspace or tenant records.',
			distinctWorkflows: ['Discovery & search', 'Create/update core items', 'Review history'],
			observedOrDocumented: 'strongly_inferred',
		},
		{
			role: 'Administrator',
			description: 'Operator managing configuration, permissions, integrations, and audit governance.',
			capabilities: ['Manage users & roles', 'Configure policies & integrations', 'Inspect audit logs'],
			permissionsBoundary: 'Role-gated administrative endpoints with full audit logging.',
			distinctWorkflows: ['User/role provisioning', 'Policy configuration', 'System diagnostics'],
			observedOrDocumented: 'strongly_inferred',
		},
	];

	if (/\b(?:hospital|clinic|patient|ehr|emr|telehealth|healthcare|medical|pharmacy|fhir|hl7)\b/.test(p)) {
		softwareCategory = 'Healthcare Information System';
		industry = 'Healthcare & Life Sciences';
		domain = 'Clinical & Patient Operations';
		regulations.push('HIPAA / HITECH', 'HL7 FHIR R4/R5', 'WCAG 2.1 AA Accessibility');
		requiresQualifiedHumanReview = true;
		humanReviewReason = 'Healthcare software handling PHI or clinical workflows requires qualified clinical, privacy, and compliance review.';
		entities.add('Patient'); entities.add('Encounter'); entities.add('Appointment'); entities.add('ClinicalRecord');
		workflows.add('Patient intake & scheduling'); workflows.add('Clinical documentation & orders'); workflows.add('Audit trail & consent management');
		securityReqs.add('PHI encryption at rest & in transit'); securityReqs.add('Strict tenant & role-based chart isolation');
		roles.push({
			role: 'Clinician / Provider',
			description: 'Licensed practitioner viewing patient charts, schedules, and clinical orders.',
			capabilities: ['Access assigned patient charts', 'Record clinical notes', 'Manage appointments'],
			permissionsBoundary: 'Break-glass audited access; minimum-necessary PHI rule.',
			distinctWorkflows: ['Patient consultation', 'Order entry', 'Discharge/follow-up'],
			observedOrDocumented: 'strongly_inferred',
		});
	} else if (/\b(?:bank|banking|fintech|ledger|payment|wallet|trading|insurance|accounting|erp|invoice)\b/.test(p)) {
		softwareCategory = 'Financial & Enterprise Transaction System';
		industry = 'Financial Services & FinTech';
		domain = 'Double-Entry Ledger & Regulated Transactions';
		regulations.push('PCI-DSS (if handling card data)', 'SOC 2 Type II', 'ISO 27001', 'AML / KYC Controls');
		requiresQualifiedHumanReview = true;
		humanReviewReason = 'Financial systems require independent security, reconciliation, and regulatory review before production deployment.';
		entities.add('Account'); entities.add('Transaction'); entities.add('LedgerEntry'); entities.add('ReconciliationBatch');
		workflows.add('Idempotent transfer/payment execution'); workflows.add('Approval & separation-of-duties workflow'); workflows.add('Ledger reconciliation & dispute resolution');
		rules.add('Use integer minor units or fixed-point decimals — never unrounded IEEE-754 floats for money');
		rules.add('Enforce idempotency keys and database row locks/transactions to prevent double-spend');
		testingMethods.add('Concurrency & double-spend race tests'); testingMethods.add('Property-based ledger invariant tests');
	} else if (/\b(?:scada|plc|robotics|industrial|manufacturing|iot|sensor|firmware|embedded|modbus|opc-ua|energy|grid|drone|autonomous\s+vehicle|aviation)\b/.test(p)) {
		softwareCategory = 'Industrial, Robotics & Cyber-Physical Software';
		industry = 'Industrial Automation, Robotics & Embedded Systems';
		domain = 'Real-Time Telemetry, Control & Hardware Interface';
		regulations.push('IEC 62443 (Industrial Cybersecurity)', 'ISO 13849 / IEC 61508 (Functional Safety where applicable)');
		requiresQualifiedHumanReview = true;
		humanReviewReason = 'Physical-world, robotics, aviation, and industrial control software requires qualified safety engineering and hardware-in-the-loop verification.';
		hardwareOrInfra.push('Hardware-in-the-loop (HIL) or protocol simulator', 'Low-latency telemetry bus (MQTT / OPC-UA / Modbus / ROS 2)');
		entities.add('Device'); entities.add('TelemetryFrame'); entities.add('Alarm'); entities.add('ControlCommand');
		workflows.add('Device registration & heartbeat monitoring'); workflows.add('Real-time alarm escalation & safe-state interlock'); workflows.add('Command authorization & audit');
		testingMethods.add('Protocol simulator & hardware-in-the-loop tests'); testingMethods.add('Fail-safe & watchdog recovery tests');
	} else if (/\b(?:scientific|simulation|cad|gis|geospatial|laboratory|lims|bioinformatics|genomics|physics|math|computational)\b/.test(p)) {
		softwareCategory = 'Scientific & Computational Engineering Platform';
		industry = 'Science, Engineering & Research';
		domain = 'Numerical Computation, Visualization & Reproducible Experiments';
		entities.add('Dataset'); entities.add('ExperimentRun'); entities.add('ParameterSet'); entities.add('Artifact');
		workflows.add('Data ingestion & schema validation'); workflows.add('Deterministic simulation/computation execution'); workflows.add('Reproducible result export & visualization');
		testingMethods.add('Numerical precision & golden-dataset regression tests');
	} else if (/\b(?:game|3d|shader|webgl|unity|godot|audio|video\s+edit|daw|animation|creative|streaming)\b/.test(p)) {
		softwareCategory = 'Interactive Creative / Media / Game Software';
		industry = 'Media, Gaming & Creative Tools';
		domain = 'Real-Time Rendering, Asset Pipeline & Interactive State';
		entities.add('Project'); entities.add('Scene'); entities.add('Asset'); entities.add('TimelineTrack');
		workflows.add('Asset import & preview'); workflows.add('Interactive canvas/timeline editing with undo/redo'); workflows.add('Render/export pipeline');
		testingMethods.add('Frame-time / rendering performance profiling'); testingMethods.add('State serialization & undo/redo tests');
	} else if (/\b(?:ecommerce|marketplace|shop|store|booking|hotel|restaurant|travel|saas|crm|portal|social|learning|lms|course)\b/.test(p)) {
		softwareCategory = 'Full-Stack Web / Commerce / SaaS Platform';
		industry = 'Digital Products & Online Services';
		domain = 'Multi-Role Web Application & Transactional Workflows';
		entities.add('CatalogItem'); entities.add('OrderOrBooking'); entities.add('Customer'); entities.add('ReviewOrMessage');
		workflows.add('Browse, search & multi-facet filtering'); workflows.add('Detail inspection & booking/checkout'); workflows.add('Account management & seller/admin operations');
		testingMethods.add('Playwright live browser E2E journey tests'); testingMethods.add('Responsive multi-viewport visual comparison');
		externalServices.push('Payment gateway (if transactional)', 'Email/notification provider', 'Object/asset storage');
	} else if (/\b(?:ai|llm|agent|rag|ml|machine\s+learning|computer\s+vision|speech|multimodal|knowledge\s+graph)\b/.test(p)) {
		softwareCategory = 'AI & Intelligent Software System';
		industry = 'Artificial Intelligence & Applied ML';
		domain = 'Model Orchestration, Retrieval, Evaluation & Guardrails';
		entities.add('PromptTemplate'); entities.add('KnowledgeDocument'); entities.add('EvaluationRun'); entities.add('TraceSpan');
		workflows.add('Document ingestion & chunk indexing'); workflows.add('Grounded inference with citations'); workflows.add('Offline & online evaluation + safety guardrails');
		securityReqs.add('Prompt-injection defense & tool permission sandboxing');
		testingMethods.add('Eval dataset regression & hallucination checks');
	} else if (/\b(?:desktop|windows|macos|linux|cli|terminal|network|os\s+utility|database|compiler|devtools|ide)\b/.test(p)) {
		softwareCategory = 'Desktop / Systems / Developer Tool';
		industry = 'Systems & Developer Infrastructure';
		domain = 'Native OS / Systems Runtime Engineering';
		entities.add('WorkspaceConfig'); entities.add('Session'); entities.add('DiagnosticRecord');
		testingMethods.add('Cross-platform filesystem/IPC integration tests');
	}

	return {
		softwareCategory,
		industry,
		domain,
		targetUsers: roles.map(r => r.role),
		userProblems: [
			`Deliver a complete, operationally reliable ${softwareCategory.toLowerCase()} matching real-world domain workflows rather than superficial UI`,
		],
		userRoles: roles,
		operationalWorkflows: [...workflows],
		regulationsAndStandards: regulations.length ? regulations : ['OWASP ASVS baseline web/API security', 'WCAG 2.1 AA accessibility where UI is present'],
		domainTerminology: [...entities],
		coreDataEntities: [...entities],
		businessRules: [...rules],
		technicalConstraints: ['Maintain strict separation between verified facts, documented specs, and engineering assumptions'],
		hardwareOrInfraRequirements: hardwareOrInfra.length ? hardwareOrInfra : ['Standard local/cloud compute runtime with persistent storage'],
		externalServices,
		securityAndPrivacyRequirements: [...securityReqs],
		requiredTestingMethods: [...testingMethods],
		productionExpectations: ['Real persistence', 'Actionable error & recovery states', 'Observable logging & health checks'],
		requiresQualifiedHumanReview,
		humanReviewReason,
	};
}

// ============================================================================
// 4. HTML / Sitemap / Design Signal Extraction (Pure Parsers)
// ============================================================================

export function parseSitemapUrls(xmlContent: string, limit = 30): string[] {
	const urls: string[] = [];
	const re = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xmlContent)) !== null) {
		urls.push(m[1].trim());
		if (urls.length >= limit) { break; }
	}
	return [...new Set(urls)];
}

export function parseRobotsTxtSitemaps(robotsContent: string): { sitemaps: string[]; disallowedPrefixes: string[] } {
	const sitemaps: string[] = [];
	const disallowedPrefixes: string[] = [];
	for (const raw of robotsContent.split(/\r?\n/)) {
		const line = raw.trim();
		const sm = /^Sitemap:\s*(https?:\/\/\S+)/i.exec(line);
		if (sm) { sitemaps.push(sm[1]); }
		const dis = /^Disallow:\s*(\/\S*)/i.exec(line);
		if (dis) { disallowedPrefixes.push(dis[1]); }
	}
	return { sitemaps: [...new Set(sitemaps)], disallowedPrefixes: [...new Set(disallowedPrefixes)] };
}

export function extractDesignSpecificationFromEvidence(
	pages: readonly ArpeiReferencePageRecord[],
	rawColors: readonly string[],
	rawFonts: readonly string[],
	fidelityMode: ArpeiDesignSpecification['fidelityMode'] = 'original_inspired_by_research',
): ArpeiDesignSpecification {
	const uniqueColors = [...new Set(rawColors.filter(c => /^#[0-9a-fA-F]{3,8}$/.test(c)))].slice(0, 8);
	const palette = uniqueColors.length > 0
		? uniqueColors.map((hex, idx) => ({
			token: idx === 0 ? 'primary' : idx === 1 ? 'surface' : idx === 2 ? 'accent' : `tone-${idx + 1}`,
			hex,
			usage: idx === 0 ? 'Primary brand / action emphasis' : idx === 1 ? 'Base surface / container' : 'Supporting visual token observed from reference',
		}))
		: [
			{ token: 'surface', hex: '#0f172a', usage: 'Neutral engineering canvas' },
			{ token: 'primary', hex: '#2563eb', usage: 'Primary interactive accent' },
			{ token: 'muted', hex: '#64748b', usage: 'Secondary labels & metadata' },
		];

	const headingFont = rawFonts[0] || 'Inter, system-ui, sans-serif';
	const bodyFont = rawFonts[1] || rawFonts[0] || 'Inter, system-ui, sans-serif';
	const navItems = [...new Set(pages.flatMap(p => p.navigationItems))].slice(0, 12);
	const features = [...new Set(pages.flatMap(p => p.extractedFeatures))].slice(0, 15);

	return {
		fidelityMode,
		visualDirection: pages.length > 0
			? `Evidence-backed design synthesis derived from ${pages.filter(p => p.status === 'inspected').length} inspected reference page(s).`
			: 'Clean domain-appropriate visual direction awaiting live reference inspection.',
		palette,
		typography: {
			headingFont,
			bodyFont,
			scaleNotes: 'Clear typographic hierarchy with distinct heading weights, tabular numbers for metrics, and >=14px readable body text.',
		},
		spacingAndGrid: 'Responsive 12-column CSS grid with 8px spacing rhythm and generous content breathing room.',
		navigationPattern: navItems.length > 0 ? `Primary navigation derived from observed structure: ${navItems.join(' · ')}` : 'Adaptive top navigation + contextual sub-navigation',
		componentPatterns: features.length > 0 ? features : ['Search & filter bar', 'Structured data cards/tables', 'Validated forms with loading/error states', 'Detail inspector & dialogs'],
		motionAndResponsive: 'Fluid desktop/tablet/mobile breakpoints with prefers-reduced-motion compliance.',
		accessibilityPatterns: ['Semantic landmarks (header/nav/main/footer)', 'Keyboard-navigable controls & focus rings', 'WCAG AA contrast >= 4.5:1'],
		originalityDisclaimer: 'Original Kodia implementation using properly licensed assets; does not copy proprietary source code, trademarks, or copyrighted assets.',
	};
}

// ============================================================================
// 5. Independent Source Corroboration & Freshness (Master Addition §5 & Part 20)
// ============================================================================

export function computeFreshness(retrievedAtIso: string, maxAgeHours = 168): ArpeiFreshnessState {
	const ageMs = Date.now() - Date.parse(retrievedAtIso);
	const ageHours = ageMs / (1000 * 60 * 60);
	if (!Number.isFinite(ageHours) || ageHours < 0) { return 'fresh'; }
	if (ageHours > maxAgeHours) { return 'stale'; }
	if (ageHours > maxAgeHours * 0.5) { return 'aging'; }
	return 'fresh';
}

export function corroborateEvidenceRecords(evidence: readonly ArpeiSourceEvidence[]): ArpeiSourceEvidence[] {
	// Group by normalized topic words; when 2+ independent URLs support the same topic, upgrade epistemicStatus to independently_corroborated
	return evidence.map(item => {
		const itemHost = (() => { try { return new URL(item.sourceUrl).hostname; } catch { return item.sourceUrl; } })();
		const topicKey = item.topic.toLowerCase().trim();
		const peers = evidence.filter(other => {
			if (other.id === item.id) { return false; }
			const otherHost = (() => { try { return new URL(other.sourceUrl).hostname; } catch { return other.sourceUrl; } })();
			return otherHost !== itemHost && (other.topic.toLowerCase().includes(topicKey) || topicKey.includes(other.topic.toLowerCase()));
		});
		if (peers.length > 0 && (item.epistemicStatus === 'directly_observed' || item.epistemicStatus === 'officially_documented')) {
			return {
				...item,
				epistemicStatus: 'independently_corroborated' as ArpeiEvidenceEpistemicStatus,
				confidence: Math.min(0.98, Number((item.confidence + 0.08).toFixed(2))),
				corroboratedByIds: [...new Set([...item.corroboratedByIds, ...peers.map(p => p.id)])],
			};
		}
		return item;
	});
}

// ============================================================================
// 6. 18-Category Deep Discovery Coverage Matrix & 13-Point Readiness Gate
// ============================================================================

export function buildDeepDiscoveryCoverageMatrix(session: Pick<
	ArpeiResearchSession,
	'domainDiscovery' | 'pages' | 'interactions' | 'evidence' | 'screenshots' | 'assets' | 'gaps'
>): ArpeiDeepDiscoveryCoverageEntry[] {
	const inspectedPages = session.pages.filter(p => p.status === 'inspected');
	const restrictedPages = session.pages.filter(p => p.status === 'restricted' || p.status === 'inaccessible');
	const docEvidence = session.evidence.filter(e => e.sourceKind === 'official_docs' || e.sourceKind === 'api_spec');
	const corroboratedCount = session.evidence.filter(e => e.epistemicStatus === 'independently_corroborated').length;

	return [
		{ category: 'product_overview', label: 'Product Overview', status: inspectedPages.length > 0 ? 'directly_observed' : 'discovered', evidenceCount: inspectedPages.length + session.evidence.length, summary: `${session.domainDiscovery.softwareCategory} (${session.domainDiscovery.industry})` },
		{ category: 'user_roles', label: 'User Roles', status: restrictedPages.length > 0 ? 'partially_investigated' : 'inferred', evidenceCount: session.domainDiscovery.userRoles.length, summary: session.domainDiscovery.userRoles.map(r => r.role).join(', ') },
		{ category: 'pages', label: 'Pages & Navigation', status: inspectedPages.length > 0 ? 'directly_observed' : 'not_investigated', evidenceCount: inspectedPages.length, summary: `${inspectedPages.length} inspected, ${restrictedPages.length} restricted/inaccessible` },
		{ category: 'features', label: 'Features', status: inspectedPages.some(p => p.extractedFeatures.length > 0) ? 'directly_observed' : 'discovered', evidenceCount: inspectedPages.reduce((a, p) => a + p.extractedFeatures.length, 0), summary: 'Extracted from live pages & documentation' },
		{ category: 'workflows', label: 'User Workflows', status: session.interactions.length > 0 ? 'directly_observed' : 'partially_investigated', evidenceCount: session.interactions.length + session.domainDiscovery.operationalWorkflows.length, summary: `${session.interactions.length} live interaction(s) observed` },
		{ category: 'business_rules', label: 'Business Rules', status: corroboratedCount > 0 ? 'corroborated' : 'inferred', evidenceCount: session.domainDiscovery.businessRules.length, summary: `${session.domainDiscovery.businessRules.length} domain rule(s) captured` },
		{ category: 'integrations', label: 'External Integrations', status: session.domainDiscovery.externalServices.length > 0 ? 'discovered' : 'not_applicable', evidenceCount: session.domainDiscovery.externalServices.length, summary: session.domainDiscovery.externalServices.join(', ') || 'None required yet' },
		{ category: 'apis', label: 'APIs & Contracts', status: docEvidence.length > 0 ? 'documented' : 'unverified', evidenceCount: docEvidence.length, summary: `${docEvidence.length} technical/API source(s) reviewed` },
		{ category: 'data_entities', label: 'Data Entities', status: 'inferred', evidenceCount: session.domainDiscovery.coreDataEntities.length, summary: session.domainDiscovery.coreDataEntities.join(', ') },
		{ category: 'permissions', label: 'Permissions & Access', status: restrictedPages.length > 0 ? 'inaccessible' : 'inferred', evidenceCount: session.domainDiscovery.userRoles.length, summary: restrictedPages.length > 0 ? 'Authenticated role views require user-authorized login' : 'Role boundaries defined from domain model' },
		{ category: 'technical_requirements', label: 'Technical Requirements', status: docEvidence.length > 0 ? 'documented' : 'partially_investigated', evidenceCount: docEvidence.length, summary: `${docEvidence.length} official doc source(s)` },
		{ category: 'security_requirements', label: 'Security Requirements', status: 'documented', evidenceCount: session.domainDiscovery.securityAndPrivacyRequirements.length, summary: session.domainDiscovery.securityAndPrivacyRequirements.slice(0, 3).join('; ') },
		{ category: 'operational_requirements', label: 'Operational Requirements', status: 'inferred', evidenceCount: session.domainDiscovery.productionExpectations.length, summary: session.domainDiscovery.productionExpectations.join(', ') },
		{ category: 'mobile_experiences', label: 'Mobile & Responsive', status: session.screenshots.some(s => s.viewport.width <= 480) ? 'directly_observed' : 'unverified', evidenceCount: session.screenshots.filter(s => s.viewport.width <= 480).length, summary: `${session.screenshots.filter(s => s.viewport.width <= 480).length} mobile viewport capture(s)` },
		{ category: 'edge_cases', label: 'Edge Cases', status: session.gaps.length > 0 ? 'discovered' : 'partially_investigated', evidenceCount: session.gaps.length, summary: `${session.gaps.length} open/documented gap(s)` },
		{ category: 'error_and_recovery_flows', label: 'Error & Recovery Flows', status: 'partially_investigated', evidenceCount: 1, summary: 'Validation, network failure, and retry behaviors specified' },
		{ category: 'current_changes', label: 'Freshness & Current Changes', status: session.evidence.length > 0 ? 'documented' : 'not_investigated', evidenceCount: session.evidence.filter(e => e.freshness === 'fresh').length, summary: `${session.evidence.filter(e => e.freshness === 'fresh').length} fresh source(s)` },
		{ category: 'unverified_areas', label: 'Unverified & Restricted Areas', status: restrictedPages.length > 0 || session.gaps.some(g => g.status === 'open') ? 'unverified' : 'not_applicable', evidenceCount: restrictedPages.length + session.gaps.filter(g => g.status === 'open').length, summary: `${restrictedPages.length} restricted page(s), ${session.gaps.filter(g => g.status === 'open').length} open gap(s)` },
	];
}

export function evaluatePreImplementationReadinessGate(
	session: Pick<
		ArpeiResearchSession,
		'userPrompt' | 'decision' | 'domainDiscovery' | 'pages' | 'interactions' | 'evidence' | 'assets' | 'gaps' | 'traceability' | 'architectureDecisions'
	>,
	userFastTrack = false,
): ArpeiResearchReadinessGate {
	const inspected = session.pages.filter(p => p.status === 'inspected').length;
	const restricted = session.pages.filter(p => p.status === 'restricted' || p.status === 'inaccessible').length;
	const openHighGaps = session.gaps.filter(g => g.impact === 'high' && g.status === 'open');
	const explicitAssumptions = session.gaps.filter(g => g.assumptionMade).map(g => `${g.question} -> Assumption: ${g.assumptionMade}`);

	const checks = [
		{ id: '1_intent', label: 'User requested outcome understood', status: session.userPrompt.trim().length > 0 ? 'satisfied' as const : 'incomplete' as const, detail: session.userPrompt.slice(0, 120) },
		{ id: '2_domain', label: 'Relevant domain & standards identified', status: 'satisfied' as const, detail: `${session.domainDiscovery.softwareCategory} (${session.domainDiscovery.industry})` },
		{ id: '3_ref_discovery', label: 'Reference discovery completed where useful', status: !session.decision.shouldResearch || inspected > 0 || session.evidence.length > 0 ? 'satisfied' as const : userFastTrack ? 'bypassed_by_user' as const : 'incomplete' as const, detail: `${inspected} inspected page(s), ${session.evidence.length} evidence record(s)` },
		{ id: '4_pages', label: 'Available key pages investigated', status: !session.decision.signals.needsBrowserInspection || inspected > 0 ? 'satisfied' as const : restricted > 0 ? 'satisfied_with_documented_gaps' as const : userFastTrack ? 'bypassed_by_user' as const : 'incomplete' as const, detail: `${inspected} inspected, ${restricted} restricted` },
		{ id: '5_roles', label: 'User roles & permission boundaries identified', status: session.domainDiscovery.userRoles.length > 0 ? 'satisfied' as const : 'incomplete' as const, detail: session.domainDiscovery.userRoles.map(r => r.role).join(', ') },
		{ id: '6_workflows', label: 'Major user workflows investigated', status: session.domainDiscovery.operationalWorkflows.length > 0 ? (session.interactions.length > 0 ? 'satisfied' as const : 'satisfied_with_documented_gaps' as const) : 'incomplete' as const, detail: `${session.domainDiscovery.operationalWorkflows.length} workflow(s), ${session.interactions.length} live interaction(s)` },
		{ id: '7_features', label: 'Core & nested features identified', status: session.traceability.length > 0 ? 'satisfied' as const : 'satisfied_with_documented_gaps' as const, detail: `${session.traceability.length} traced requirement(s)` },
		{ id: '8_tech', label: 'Current technical requirements researched', status: session.evidence.length > 0 || !session.decision.signals.involvesChangingTech ? 'satisfied' as const : userFastTrack ? 'bypassed_by_user' as const : 'incomplete' as const, detail: `${session.evidence.length} technical/reference source(s)` },
		{ id: '9_integrations', label: 'Required integrations identified', status: 'satisfied' as const, detail: session.domainDiscovery.externalServices.join(', ') || 'Self-contained / no mandatory external service' },
		{ id: '10_assets', label: 'Assets & visual resources planned', status: !session.decision.signals.needsAssetsOrDatasets || session.assets.length > 0 ? 'satisfied' as const : 'satisfied_with_documented_gaps' as const, detail: `${session.assets.length} asset record(s)` },
		{ id: '11_unknowns', label: 'Inaccessible & unverified areas recorded honestly', status: 'satisfied' as const, detail: `${restricted} inaccessible page(s), ${session.gaps.length} gap(s) logged` },
		{ id: '12_spec', label: 'Structured product specification & traceability built', status: session.traceability.length > 0 ? 'satisfied' as const : 'incomplete' as const, detail: `${session.traceability.length} traced requirement node(s)` },
		{ id: '13_arch', label: 'Architecture & acceptance criteria established', status: session.architectureDecisions.length > 0 ? 'satisfied' as const : 'satisfied_with_documented_gaps' as const, detail: `${session.architectureDecisions.length} architecture decision(s)` },
	];

	const incompleteCount = checks.filter(c => c.status === 'incomplete').length;
	let verdict: ArpeiResearchReadinessGate['verdict'];
	let readyToImplement: boolean;
	if (userFastTrack) {
		verdict = 'user_fast_track';
		readyToImplement = true;
	} else if (incompleteCount === 0 && openHighGaps.length === 0) {
		verdict = explicitAssumptions.length > 0 || restricted > 0 ? 'ready_with_assumptions' : 'ready';
		readyToImplement = true;
	} else if (incompleteCount <= 2 && openHighGaps.length === 0) {
		verdict = 'ready_with_assumptions';
		readyToImplement = true;
	} else {
		verdict = 'more_research_recommended';
		readyToImplement = false;
	}

	return {
		evaluatedAt: new Date().toISOString(),
		readyToImplement,
		verdict,
		checks,
		highImpactUnknowns: openHighGaps.map(g => g.question),
		explicitAssumptions,
		summary: `Research Readiness Gate: ${verdict.toUpperCase()} (${checks.filter(c => c.status === 'satisfied' || c.status === 'satisfied_with_documented_gaps').length}/13 checks satisfied, ${openHighGaps.length} open high-impact unknown(s)).`,
	};
}

export function buildReferenceCoverageMatrix(
	productName: string,
	rootUrl: string,
	pages: readonly ArpeiReferencePageRecord[],
	interactionsCount: number,
	screenshotsCount: number,
): ArpeiReferenceCoverageMatrix {
	const inspected = pages.filter(p => p.status === 'inspected');
	const restricted = pages.filter(p => p.status === 'restricted');
	const unavailable = pages.filter(p => p.status === 'inaccessible' || p.status === 'failed');
	const features = [...new Set(pages.flatMap(p => p.extractedFeatures))].slice(0, 40);

	const hasLayer = (l: ArpeiReferencePageRecord['layer']) => pages.filter(p => p.layer === l);
	const rowStatus = (list: readonly ArpeiReferencePageRecord[]) => {
		if (list.length === 0) { return 'not_inspected' as const; }
		if (list.some(p => p.status === 'inspected')) { return list.some(p => p.status !== 'inspected') ? 'partially_inspected' as const : 'inspected' as const; }
		if (list.some(p => p.status === 'restricted')) { return 'restricted' as const; }
		return 'not_found' as const;
	};

	const rows = [
		{ area: 'Main & Public Interface', status: rowStatus(hasLayer('public_landing')), pagesCount: hasLayer('public_landing').length, screenshotsCount, interactionsCount, notes: 'Public entry pages & primary layout' },
		{ area: 'Navigation & Nested Pages', status: rowStatus(hasLayer('navigation_nested')), pagesCount: hasLayer('navigation_nested').length, screenshotsCount: 0, interactionsCount: 0, notes: 'Secondary/category/detail pages discovered via nav/sitemap' },
		{ area: 'Authenticated & Role Views', status: rowStatus(hasLayer('authenticated')), pagesCount: hasLayer('authenticated').length, screenshotsCount: 0, interactionsCount: 0, notes: restricted.length > 0 ? 'Requires authorized user session' : 'No authenticated pages explored' },
		{ area: 'Documentation & API Portal', status: rowStatus([...hasLayer('documentation'), ...hasLayer('api_portal')]), pagesCount: hasLayer('documentation').length + hasLayer('api_portal').length, screenshotsCount: 0, interactionsCount: 0, notes: 'Official technical docs, help center, and API specifications' },
	];

	const unverifiedAreas = rows.filter(r => r.status !== 'inspected').map(r => `${r.area} (${r.status})`);

	return {
		referenceProduct: productName,
		rootUrl,
		discoveredPagesCount: pages.length,
		visitedPagesCount: pages.filter(p => Boolean(p.visitedAt)).length,
		inspectedPagesCount: inspected.length,
		restrictedPagesCount: restricted.length,
		unavailablePagesCount: unavailable.length,
		screenshotsCapturedCount: screenshotsCount,
		interactionsTestedCount: interactionsCount,
		featuresIdentified: features,
		unverifiedAreas,
		rows,
	};
}

export function buildInitialTraceabilityAndGaps(
	domain: ArpeiDomainDiscovery,
	evidence: readonly ArpeiSourceEvidence[],
	pages: readonly ArpeiReferencePageRecord[],
): { traceability: ArpeiRequirementTraceNode[]; gaps: ArpeiResearchGap[] } {
	const traceability: ArpeiRequirementTraceNode[] = [];
	const evidenceIds = evidence.map(e => e.id);

	domain.operationalWorkflows.forEach((wf, idx) => {
		traceability.push({
			requirementId: `ARPEI-REQ-${String(idx + 1).padStart(3, '0')}`,
			origin: pages.some(p => p.status === 'inspected') ? 'observed_reference' : 'research_recommendation',
			researchQuestion: `How should "${wf}" work end-to-end for ${domain.softwareCategory}?`,
			sourceEvidenceIds: evidenceIds.slice(0, 3),
			verifiedFinding: pages.some(p => p.status === 'inspected')
				? `Informed by ${pages.filter(p => p.status === 'inspected').length} inspected reference page(s) and domain research.`
				: `Derived from ${domain.industry} domain discovery.`,
			productRequirement: `Implement complete, persistent, validated "${wf}" workflow with real error/recovery handling.`,
			architecturalDecision: `Dedicated domain service + validated API contract + interactive UI connected to persistent storage.`,
			designComponents: [`${wf} View`, 'Validation & Feedback Controls'],
			implementationFiles: [],
			testCases: [`E2E test verifying ${wf} observable outcome`],
			verificationStatus: 'not_implemented',
		});
	});

	const gaps: ArpeiResearchGap[] = [
		{
			id: 'gap-auth-roles',
			question: 'Are there additional authenticated role capabilities or private admin workflows not visible publicly?',
			impact: 'medium',
			status: pages.some(p => p.status === 'restricted') ? 'inaccessible' : 'assumed_explicitly',
			assumptionMade: 'Model Standard User and Administrator role boundaries explicitly until user provides authenticated role access.',
		},
		{
			id: 'gap-integrations',
			question: 'Which production third-party credentials/environments (payment, email, cloud, hardware) will be authorized?',
			impact: domain.externalServices.length > 0 ? 'high' : 'low',
			status: domain.externalServices.length > 0 ? 'open' : 'assumed_explicitly',
			assumptionMade: domain.externalServices.length === 0 ? 'Self-contained local/standard persistence without mandatory paid third-party service.' : undefined,
		},
	];

	return { traceability, gaps };
}
