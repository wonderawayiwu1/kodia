/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
	ApiAssertionResult,
	ApiAssertionSpec,
	ApiCollection,
	ApiFailureCorrelationReport,
	ApiFrameworkId,
	ApiGrpcMethodInfo,
	ApiHttpMethod,
	ApiKeyValuePair,
	ApiLoadTestResult,
	ApiManagedRuntimeInfo,
	ApiProductionReadinessReport,
	ApiProjectDiscoveryReport,
	ApiProtocol,
	ApiReadinessPillar,
	ApiRequestSpec,
	ApiResponseDiffReport,
	ApiResponseResult,
	ApiSecurityFinding,
	ApiSecurityReport,
	ApiSpecDiffReport,
	ApiTestRunResult,
	ApiTestSuite,
	DiscoveredApiRoute,
	DiscoveredApiService,
	DiscoveredApiSpecFile,
	ReadinessStatus,
} from './apiStudioTypes.js';

export interface ApiSourceFile {
	readonly path: string;
	readonly content: string;
}

const SENSITIVE_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-secret|x-csrf-token)$/i;

// ============================================================================
// 1. VARIABLE INTERPOLATION & SECRET REDACTION
// ============================================================================

export function buildDynamicValue(token: string): string | undefined {
	switch (token) {
		case '$timestamp': return String(Math.floor(Date.now() / 1000));
		case '$isoTimestamp': return new Date().toISOString();
		case '$randomInt': return String(Math.floor(Math.random() * 100_000));
		case '$uuid':
		case '$guid': {
			const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
			return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
		}
		default: return undefined;
	}
}

export function resolveApiVariables(input: string, vars: Readonly<Record<string, string>>): string {
	if (!input || !input.includes('{{')) { return input; }
	return input.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key: string) => {
		if (key.startsWith('$')) {
			return buildDynamicValue(key) ?? match;
		}
		return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
	});
}

export function redactHeaders(headers: Readonly<Record<string, string>>, secretValues: readonly string[] = []): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		if (SENSITIVE_HEADER_RE.test(k)) {
			out[k] = v.length > 10 ? `${v.slice(0, 6)}...[REDACTED]` : '[REDACTED]';
		} else {
			out[k] = redactApiSecrets(v, secretValues);
		}
	}
	return out;
}

export function redactApiSecrets(text: string, secretValues: readonly string[] = []): string {
	let out = text;
	for (const s of secretValues) {
		if (s && s.length >= 6) {
			out = out.split(s).join('[REDACTED_SECRET]');
		}
	}
	out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, '$1[REDACTED]');
	out = out.replace(/\b(sk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED_KEY]');
	return out;
}

// ============================================================================
// 2. UNIVERSAL MULTI-LANGUAGE API & SPECIFICATION DISCOVERY
// ============================================================================

function normalizePath(p: string): string {
	const cleaned = p.trim().replace(/['"`]/g, '');
	if (!cleaned) { return '/'; }
	return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function extractPathParams(routePath: string): string[] {
	const params = new Set<string>();
	for (const m of routePath.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)(?::[^}]+)?\}|<(?:\w+:)?([A-Za-z_][A-Za-z0-9_]*)>/g)) {
		const name = m[1] || m[2] || m[3];
		if (name) { params.add(name); }
	}
	return [...params];
}

function detectFrameworkFromManifest(files: readonly ApiSourceFile[]): { frameworks: ApiFrameworkId[]; languages: string[]; databases: string[]; queues: string[]; defaultStartCmd?: string; defaultPort?: number } {
	const frameworks = new Set<ApiFrameworkId>();
	const languages = new Set<string>();
	const databases = new Set<string>();
	const queues = new Set<string>();
	let defaultStartCmd: string | undefined;
	let defaultPort: number | undefined;

	for (const f of files) {
		const lower = f.path.toLowerCase();
		const text = f.content;

		if (lower.endsWith('package.json')) {
			languages.add('TypeScript / JavaScript');
			if (/"express"/.test(text)) { frameworks.add('express'); }
			if (/"@nestjs\/core"/.test(text)) { frameworks.add('nestjs'); }
			if (/"fastify"/.test(text)) { frameworks.add('fastify'); }
			if (/"hono"/.test(text)) { frameworks.add('hono'); }
			if (/"koa"/.test(text)) { frameworks.add('koa'); }
			if (/"next"/.test(text)) { frameworks.add('nextjs'); }
			if (/"pg"|"prisma"|"typeorm"|"drizzle-orm"|"sequelize"/.test(text)) { databases.add('PostgreSQL / SQL ORM'); }
			if (/"sqlite3"|"better-sqlite3"/.test(text)) { databases.add('SQLite'); }
			if (/"mongoose"|"mongodb"/.test(text)) { databases.add('MongoDB'); }
			if (/"redis"|"ioredis"|"bullmq"/.test(text)) { queues.add('Redis / BullMQ'); }
			if (/"kafkajs"|"amqplib"/.test(text)) { queues.add('Kafka / RabbitMQ'); }
			try {
				const pkg = JSON.parse(text) as { scripts?: Record<string, string> };
				if (!defaultStartCmd) {
					if (pkg.scripts?.dev) { defaultStartCmd = 'npm run dev'; }
					else if (pkg.scripts?.start) { defaultStartCmd = 'npm start'; }
				}
			} catch { /* ignore */ }
		} else if (lower.endsWith('requirements.txt') || lower.endsWith('pyproject.toml')) {
			languages.add('Python');
			if (/fastapi/i.test(text)) { frameworks.add('fastapi'); defaultStartCmd ??= 'uvicorn main:app --reload'; defaultPort ??= 8000; }
			if (/django/i.test(text)) { frameworks.add('django'); defaultStartCmd ??= 'python manage.py runserver'; defaultPort ??= 8000; }
			if (/flask/i.test(text)) { frameworks.add('flask'); defaultStartCmd ??= 'flask run'; defaultPort ??= 5000; }
			if (/sqlalchemy|psycopg|asyncpg/i.test(text)) { databases.add('PostgreSQL / SQLAlchemy'); }
			if (/redis|celery/i.test(text)) { queues.add('Redis / Celery'); }
		} else if (lower.endsWith('go.mod')) {
			languages.add('Go');
			if (/gin-gonic\/gin/.test(text)) { frameworks.add('gin'); }
			if (/gofiber\/fiber/.test(text)) { frameworks.add('fiber'); }
			if (/labstack\/echo/.test(text)) { frameworks.add('echo'); }
			if (/go-chi\/chi/.test(text)) { frameworks.add('chi'); }
			if (frameworks.size === 0) { frameworks.add('go-std'); }
			defaultStartCmd ??= 'go run .';
			defaultPort ??= 8080;
		} else if (lower.endsWith('cargo.toml')) {
			languages.add('Rust');
			if (/\baxum\b/.test(text)) { frameworks.add('axum'); }
			if (/\bactix-web\b/.test(text)) { frameworks.add('actix-web'); }
			defaultStartCmd ??= 'cargo run';
			defaultPort ??= 3000;
		} else if (lower.endsWith('pom.xml') || lower.endsWith('build.gradle') || lower.endsWith('build.gradle.kts')) {
			languages.add('Java / Kotlin');
			if (/spring-boot/i.test(text)) { frameworks.add('spring-boot'); defaultStartCmd ??= './mvnw spring-boot:run'; defaultPort ??= 8080; }
		} else if (lower.endsWith('.csproj')) {
			languages.add('C# / .NET');
			if (/Microsoft\.NET\.Sdk\.Web|AspNetCore/i.test(text)) { frameworks.add('aspnet-core'); defaultStartCmd ??= 'dotnet run'; defaultPort ??= 5000; }
		} else if (lower.endsWith('composer.json')) {
			languages.add('PHP');
			if (/laravel\/framework/i.test(text)) { frameworks.add('laravel'); defaultStartCmd ??= 'php artisan serve'; defaultPort ??= 8000; }
		} else if (lower.endsWith('gemfile')) {
			languages.add('Ruby');
			if (/rails/i.test(text)) { frameworks.add('rails'); defaultStartCmd ??= 'bundle exec rails server'; defaultPort ??= 3000; }
		} else if (lower.endsWith('mix.exs')) {
			languages.add('Elixir');
			if (/:phoenix/.test(text)) { frameworks.add('phoenix'); defaultStartCmd ??= 'mix phx.server'; defaultPort ??= 4000; }
		}
	}

	return {
		frameworks: [...frameworks],
		languages: [...languages],
		databases: [...databases],
		queues: [...queues],
		defaultStartCmd,
		defaultPort,
	};
}

export function parseProtobufFile(filePath: string, content: string): ApiGrpcMethodInfo[] {
	const methods: ApiGrpcMethodInfo[] = [];
	const serviceRegex = /service\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g;
	for (const sm of content.matchAll(serviceRegex)) {
		const serviceName = sm[1];
		const body = sm[2];
		const rpcRegex = /rpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(stream\s+)?([A-Za-z0-9_.]+)\s*\)\s*returns\s*\(\s*(stream\s+)?([A-Za-z0-9_.]+)\s*\)/g;
		for (const rm of body.matchAll(rpcRegex)) {
			const clientStream = Boolean(rm[2]);
			const serverStream = Boolean(rm[4]);
			const streaming: ApiGrpcMethodInfo['streaming'] =
				clientStream && serverStream ? 'bidirectional'
					: serverStream ? 'server_streaming'
						: clientStream ? 'client_streaming'
							: 'unary';
			methods.push({
				serviceName,
				methodName: rm[1],
				requestType: rm[3],
				responseType: rm[5],
				streaming,
				protoFile: filePath,
			});
		}
	}
	return methods;
}

export function discoverWorkspaceApis(workspaceRoot: string, files: readonly ApiSourceFile[]): ApiProjectDiscoveryReport {
	const manifestInfo = detectFrameworkFromManifest(files);
	const frameworks = new Set<ApiFrameworkId>(manifestInfo.frameworks);
	const languages = new Set<string>(manifestInfo.languages);
	const protocols = new Set<ApiProtocol>();
	const authMechanisms = new Set<string>();
	const databases = new Set<string>(manifestInfo.databases);
	const queuesAndCaches = new Set<string>(manifestInfo.queues);
	const envVariables = new Set<string>();
	const routes: DiscoveredApiRoute[] = [];
	const specFiles: DiscoveredApiSpecFile[] = [];
	const grpcMethods: ApiGrpcMethodInfo[] = [];
	const seenRouteKeys = new Set<string>();

	const addRoute = (r: Omit<DiscoveredApiRoute, 'id'>) => {
		const normPath = normalizePath(r.path);
		const key = `${r.method}:${normPath}:${r.filePath}:${r.line}`;
		if (seenRouteKeys.has(key)) { return; }
		seenRouteKeys.add(key);
		protocols.add(r.protocol);
		routes.push({
			id: `rt-${routes.length + 1}`,
			...r,
			path: normPath,
			pathParams: extractPathParams(normPath),
		});
	};

	for (const f of files) {
		const lower = f.path.toLowerCase();
		const lines = f.content.split(/\r?\n/);

		// Auth, DB, Env detection across code
		if (/\b(jwt|jsonwebtoken|bearer|oauth2?|passport|nextauth|auth0|clerk|oidc)\b/i.test(f.content)) {
			authMechanisms.add('JWT / Bearer / OAuth2');
		}
		if (/\b(x-api-key|api[_-]?key)\b/i.test(f.content)) {
			authMechanisms.add('API Key');
		}
		if (/\b(basic\s+auth|www-authenticate)\b/i.test(f.content)) {
			authMechanisms.add('Basic Auth');
		}
		if (/\b(sqlite|postgres|postgresql|mysql|mongodb|prisma|sequelize|sqlalchemy|gorm|sqlx)\b/i.test(f.content)) {
			if (/sqlite/i.test(f.content)) { databases.add('SQLite'); }
			if (/postgres|pg\b/i.test(f.content)) { databases.add('PostgreSQL'); }
			if (/mongodb|mongoose/i.test(f.content)) { databases.add('MongoDB'); }
			if (/mysql/i.test(f.content)) { databases.add('MySQL'); }
		}
		if (/\b(redis|kafka|rabbitmq|amqp|mqtt|bullmq|celery|sqs)\b/i.test(f.content)) {
			if (/redis/i.test(f.content)) { queuesAndCaches.add('Redis'); }
			if (/kafka/i.test(f.content)) { queuesAndCaches.add('Kafka'); }
			if (/rabbitmq|amqp/i.test(f.content)) { queuesAndCaches.add('RabbitMQ / AMQP'); }
			if (/mqtt/i.test(f.content)) { queuesAndCaches.add('MQTT'); }
		}

		for (const em of f.content.matchAll(/(?:process\.env\.|os\.environ\.get\(["']|os\.getenv\(["']|os\.Getenv\(["'])([A-Z][A-Z0-9_]{2,})/g)) {
			envVariables.add(em[1]);
		}

		// Spec files: OpenAPI / Swagger / GraphQL / Proto / WSDL / AsyncAPI
		if (/\.(json|ya?ml)$/i.test(lower) && (/"openapi"\s*:|^openapi\s*:/m.test(f.content) || /"swagger"\s*:|^swagger\s*:/m.test(f.content))) {
			const isSwagger = /swagger/i.test(f.content) && !/openapi/i.test(f.content);
			let title: string | undefined;
			let version: string | undefined;
			let opCount = 0;
			if (lower.endsWith('.json')) {
				try {
					const parsed = JSON.parse(f.content) as { info?: { title?: string; version?: string }; paths?: Record<string, Record<string, unknown>> };
					title = parsed.info?.title;
					version = parsed.info?.version;
					for (const [p, methodsObj] of Object.entries(parsed.paths ?? {})) {
						for (const m of Object.keys(methodsObj ?? {})) {
							const upper = m.toUpperCase();
							if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(upper)) {
								opCount++;
								addRoute({
									method: upper as ApiHttpMethod,
									path: p,
									protocol: 'http',
									framework: frameworks.values().next().value ?? 'generic',
									filePath: f.path,
									line: 1,
									handlerName: 'OpenAPI Operation',
								});
							}
						}
					}
				} catch { /* ignore malformed */ }
			} else {
				const tm = /title:\s*(.+)/.exec(f.content);
				title = tm?.[1]?.trim();
				opCount = (f.content.match(/^\s+(get|post|put|patch|delete):/gm) ?? []).length;
			}
			specFiles.push({ path: f.path, kind: isSwagger ? 'swagger' : 'openapi', title, version, operationCount: opCount });
			protocols.add('http');
		} else if (/\.(graphql|gql)$/i.test(lower)) {
			const ops = (f.content.match(/\b(Query|Mutation|Subscription)\b/g) ?? []).length;
			specFiles.push({ path: f.path, kind: 'graphql', operationCount: Math.max(1, ops) });
			protocols.add('graphql');
			addRoute({ method: 'GRAPHQL', path: '/graphql', protocol: 'graphql', framework: frameworks.values().next().value ?? 'generic', filePath: f.path, line: 1 });
		} else if (lower.endsWith('.proto')) {
			const parsed = parseProtobufFile(f.path, f.content);
			grpcMethods.push(...parsed);
			specFiles.push({ path: f.path, kind: 'protobuf', operationCount: parsed.length });
			protocols.add('grpc');
			for (const gm of parsed) {
				addRoute({ method: 'GRPC', path: `/${gm.serviceName}/${gm.methodName}`, protocol: 'grpc', framework: 'generic', filePath: f.path, line: 1, handlerName: gm.methodName });
			}
		} else if (lower.endsWith('.wsdl')) {
			specFiles.push({ path: f.path, kind: 'wsdl', operationCount: (f.content.match(/<wsdl:operation|<operation/gi) ?? []).length });
			protocols.add('soap');
		}

		// Route extraction by language
		const isJsTs = /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(lower);
		const isPy = /\.py$/i.test(lower);
		const isGo = /\.go$/i.test(lower);
		const isRust = /\.rs$/i.test(lower);
		const isJava = /\.(java|kt)$/i.test(lower);
		const isCs = /\.cs$/i.test(lower);
		const isPhp = /\.php$/i.test(lower);

		if (isJsTs) {
			languages.add('TypeScript / JavaScript');
			// Next.js App Router API routes
			const nextApi = /(?:^|\/)app\/(api\/.+)\/route\.(ts|js)$/i.exec(f.path);
			if (nextApi) {
				frameworks.add('nextjs');
				const routePath = `/${nextApi[1].replace(/\[([^\]]+)\]/g, ':$1')}`;
				for (const m of f.content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
					addRoute({ method: m[1] as ApiHttpMethod, path: routePath, protocol: 'http', framework: 'nextjs', filePath: f.path, line: 1, handlerName: m[1] });
				}
			}
			// Express / Fastify / Hono / Koa / NestJS / WebSocket / SSE
			let nestPrefix = '';
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineNum = i + 1;
				const ctrlMatch = /@Controller\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/.exec(line);
				if (ctrlMatch) {
					frameworks.add('nestjs');
					nestPrefix = ctrlMatch[1].startsWith('/') ? ctrlMatch[1] : `/${ctrlMatch[1]}`;
				}
				const nestMethod = /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/.exec(line);
				if (nestMethod) {
					frameworks.add('nestjs');
					const sub = nestMethod[2] ?? '';
					const fullPath = `${nestPrefix}${sub ? (sub.startsWith('/') ? sub : `/${sub}`) : ''}` || '/';
					addRoute({ method: nestMethod[1].toUpperCase() as ApiHttpMethod, path: fullPath, protocol: 'http', framework: 'nestjs', filePath: f.path, line: lineNum, requiresAuth: /@UseGuards|Auth/i.test(lines.slice(Math.max(0, i - 3), i + 2).join(' ')) });
				}
				const expressRoute = /\b(?:app|router|server|fastify|hono)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/i.exec(line);
				if (expressRoute) {
					const fw: ApiFrameworkId = /\bfastify\b/.test(line) ? 'fastify' : /\bhono\b/.test(line) ? 'hono' : frameworks.has('koa') ? 'koa' : 'express';
					frameworks.add(fw);
					addRoute({
						method: expressRoute[1].toUpperCase() as ApiHttpMethod,
						path: expressRoute[2],
						protocol: /text\/event-stream/i.test(lines.slice(i, i + 12).join('\n')) ? 'sse' : 'http',
						framework: fw,
						filePath: f.path,
						line: lineNum,
						requiresAuth: /auth|jwt|guard|protect|verifyToken|requireRole/i.test(line),
					});
				}
				const nodeHttpRoute = /req\.url\s*(?:===|\.startsWith\()\s*['"`]([^'"`]+)['"`]/.exec(line);
				if (nodeHttpRoute) {
					const mMatch = /req\.method\s*===\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i.exec(line);
					addRoute({
						method: (mMatch ? mMatch[1].toUpperCase() : 'GET') as ApiHttpMethod,
						path: nodeHttpRoute[1],
						protocol: /text\/event-stream/i.test(lines.slice(i, i + 8).join('\n')) ? 'sse' : 'http',
						framework: 'generic',
						filePath: f.path,
						line: lineNum,
					});
				}
				if (/new\s+WebSocketServer|ws\.on\(\s*['"`]connection['"`]|@WebSocketGateway/i.test(line)) {
					protocols.add('websocket');
					const wsPath = /path\s*:\s*['"`]([^'"`]+)['"`]/.exec(line)?.[1] ?? '/ws';
					addRoute({ method: 'WS', path: wsPath, protocol: 'websocket', framework: frameworks.values().next().value ?? 'generic', filePath: f.path, line: lineNum });
				}
				if (/ApolloServer|createYoga|graphqlHTTP|\/graphql/i.test(line)) {
					protocols.add('graphql');
				}
			}
		} else if (isPy) {
			languages.add('Python');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineNum = i + 1;
				const fastApi = /@(?:app|router)\.(get|post|put|patch|delete|websocket)\s*\(\s*['"]([^'"]+)['"]/i.exec(line);
				if (fastApi) {
					frameworks.add('fastapi');
					const isWs = fastApi[1].toLowerCase() === 'websocket';
					addRoute({
						method: isWs ? 'WS' : fastApi[1].toUpperCase() as ApiHttpMethod,
						path: fastApi[2],
						protocol: isWs ? 'websocket' : 'http',
						framework: 'fastapi',
						filePath: f.path,
						line: lineNum,
						requiresAuth: /Depends\([^)]*(?:auth|user|token|oauth)/i.test(lines.slice(i, i + 4).join(' ')),
					});
				}
				const flask = /@(?:app|bp|blueprint)\.route\s*\(\s*['"]([^'"]+)['"](?:[^)]*methods\s*=\s*\[([^\]]+)\])?/i.exec(line);
				if (flask) {
					frameworks.add('flask');
					const methods = flask[2] ? flask[2].replace(/['"\s]/g, '').split(',').filter(Boolean) : ['GET'];
					for (const m of methods) {
						addRoute({ method: m.toUpperCase() as ApiHttpMethod, path: flask[1], protocol: 'http', framework: 'flask', filePath: f.path, line: lineNum });
					}
				}
			}
		} else if (isGo) {
			languages.add('Go');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineNum = i + 1;
				const goRoute = /\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"/.exec(line);
				if (goRoute) {
					const fw: ApiFrameworkId = frameworks.has('gin') ? 'gin' : frameworks.has('fiber') ? 'fiber' : frameworks.has('echo') ? 'echo' : frameworks.has('chi') ? 'chi' : 'go-std';
					frameworks.add(fw);
					addRoute({ method: goRoute[1].toUpperCase() as ApiHttpMethod, path: goRoute[2], protocol: 'http', framework: fw, filePath: f.path, line: lineNum });
				}
				const stdRoute = /HandleFunc\s*\(\s*"([^"]+)"/.exec(line);
				if (stdRoute) {
					frameworks.add('go-std');
					addRoute({ method: 'ALL', path: stdRoute[1], protocol: 'http', framework: 'go-std', filePath: f.path, line: lineNum });
				}
			}
		} else if (isRust) {
			languages.add('Rust');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineNum = i + 1;
				const axum = /\.route\s*\(\s*"([^"]+)"\s*,\s*(get|post|put|patch|delete)\s*\(/i.exec(line);
				if (axum) {
					frameworks.add('axum');
					addRoute({ method: axum[2].toUpperCase() as ApiHttpMethod, path: axum[1], protocol: 'http', framework: 'axum', filePath: f.path, line: lineNum });
				}
				const actix = /#\[(get|post|put|patch|delete)\s*\(\s*"([^"]+)"\s*\)\]/i.exec(line);
				if (actix) {
					frameworks.add('actix-web');
					addRoute({ method: actix[1].toUpperCase() as ApiHttpMethod, path: actix[2], protocol: 'http', framework: 'actix-web', filePath: f.path, line: lineNum });
				}
			}
		} else if (isJava) {
			languages.add('Java / Kotlin');
			for (let i = 0; i < lines.length; i++) {
				const m = /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/.exec(lines[i]);
				if (m) {
					frameworks.add('spring-boot');
					addRoute({ method: m[1].toUpperCase() as ApiHttpMethod, path: m[2], protocol: 'http', framework: 'spring-boot', filePath: f.path, line: i + 1 });
				}
			}
		} else if (isCs) {
			languages.add('C# / .NET');
			for (let i = 0; i < lines.length; i++) {
				const minimal = /\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"/.exec(lines[i]);
				if (minimal) {
					frameworks.add('aspnet-core');
					addRoute({ method: minimal[1].toUpperCase() as ApiHttpMethod, path: minimal[2], protocol: 'http', framework: 'aspnet-core', filePath: f.path, line: i + 1 });
				}
				const attr = /\[Http(Get|Post|Put|Patch|Delete)\s*(?:\(\s*"([^"]*)"\s*\))?\]/.exec(lines[i]);
				if (attr) {
					frameworks.add('aspnet-core');
					addRoute({ method: attr[1].toUpperCase() as ApiHttpMethod, path: attr[2] || '/', protocol: 'http', framework: 'aspnet-core', filePath: f.path, line: i + 1 });
				}
			}
		} else if (isPhp) {
			languages.add('PHP');
			for (let i = 0; i < lines.length; i++) {
				const lar = /Route::(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/i.exec(lines[i]);
				if (lar) {
					frameworks.add('laravel');
					addRoute({ method: lar[1].toUpperCase() as ApiHttpMethod, path: lar[2], protocol: 'http', framework: 'laravel', filePath: f.path, line: i + 1 });
				}
			}
		}
	}

	if (protocols.size === 0 && routes.length > 0) { protocols.add('http'); }

	// Group into services (monorepo / multi-service aware)
	const serviceBuckets = new Map<string, DiscoveredApiRoute[]>();
	for (const r of routes) {
		const parts = r.filePath.replace(/\\/g, '/').split('/');
		const svcName = (parts[0] === 'services' || parts[0] === 'apps' || parts[0] === 'packages') && parts[1]
			? parts[1]
			: 'primary-api';
		const list = serviceBuckets.get(svcName) ?? [];
		list.push(r);
		serviceBuckets.set(svcName, list);
	}

	const primaryFw: ApiFrameworkId = [...frameworks][0] ?? 'generic';
	const primaryLang = [...languages][0] ?? 'Unknown';
	const services: DiscoveredApiService[] = [...serviceBuckets.entries()].map(([name, svcRoutes], idx) => ({
		id: `svc-${idx + 1}`,
		name,
		rootPath: name === 'primary-api' ? '.' : `services/${name}`,
		language: primaryLang,
		framework: svcRoutes[0]?.framework ?? primaryFw,
		startCommand: manifestInfo.defaultStartCmd,
		defaultPort: manifestInfo.defaultPort ?? (3000 + idx),
		healthPath: svcRoutes.find(r => /health|ready|live|ping/i.test(r.path))?.path,
		routeCount: svcRoutes.length,
		dependencies: [...databases, ...queuesAndCaches],
	}));

	if (services.length === 0) {
		services.push({
			id: 'svc-1',
			name: 'primary-api',
			rootPath: '.',
			language: primaryLang,
			framework: primaryFw,
			startCommand: manifestInfo.defaultStartCmd,
			defaultPort: manifestInfo.defaultPort,
			routeCount: 0,
			dependencies: [...databases, ...queuesAndCaches],
		});
	}

	const mermaidLines: string[] = ['flowchart LR', '  Client["API Client / Studio"]'];
	for (const svc of services) {
		const sid = svc.id.replace(/[^a-zA-Z0-9]/g, '');
		mermaidLines.push(`  Client --> ${sid}["${svc.name} (${svc.framework}, ${svc.routeCount} routes)"]`);
		for (let i = 0; i < svc.dependencies.length; i++) {
			const depId = `dep_${sid}_${i}`;
			mermaidLines.push(`  ${sid} --> ${depId}[("${svc.dependencies[i]}")]`);
		}
	}

	const fwList = [...frameworks];
	const langList = [...languages];
	const protoList = [...protocols];

	return {
		scannedAt: new Date().toISOString(),
		workspaceRoot,
		filesScanned: files.length,
		frameworks: fwList,
		languages: langList,
		protocols: protoList.length > 0 ? protoList : ['http'],
		services,
		routes,
		specFiles,
		grpcMethods,
		authMechanisms: [...authMechanisms],
		databases: [...databases],
		queuesAndCaches: [...queuesAndCaches],
		envVariables: [...envVariables].slice(0, 60),
		mermaidTopology: mermaidLines.join('\n'),
		summary: `Discovered ${routes.length} API route(s) across ${services.length} service(s), ${specFiles.length} spec file(s), frameworks=[${fwList.join(', ') || 'generic'}], protocols=[${(protoList.length ? protoList : ['http']).join(', ')}].`,
	};
}

// ============================================================================
// 3. JSONPATH ENGINE & ASSERTION EVALUATOR
// ============================================================================

export function queryJsonPath(obj: unknown, expr: string): { found: boolean; value: unknown } {
	const cleaned = expr.trim().replace(/^\$\.?/, '');
	if (!cleaned) { return { found: true, value: obj }; }
	const tokens: string[] = [];
	for (const m of cleaned.matchAll(/([^.\[\]]+)|\[(\d+)\]|\[['"]([^'"]+)['"]\]/g)) {
		tokens.push(m[1] ?? m[2] ?? m[3]);
	}
	let cur: unknown = obj;
	for (const tok of tokens) {
		if (cur === null || cur === undefined || typeof cur !== 'object') {
			return { found: false, value: undefined };
		}
		if (Array.isArray(cur)) {
			if (tok === 'length') {
				cur = cur.length;
				continue;
			}
			const idx = Number(tok);
			if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
				return { found: false, value: undefined };
			}
			cur = cur[idx];
		} else {
			const rec = cur as Record<string, unknown>;
			if (!Object.prototype.hasOwnProperty.call(rec, tok)) {
				return { found: false, value: undefined };
			}
			cur = rec[tok];
		}
	}
	return { found: true, value: cur };
}

export function evaluateApiAssertions(
	assertions: readonly ApiAssertionSpec[],
	response: Pick<ApiResponseResult, 'status' | 'headers' | 'body' | 'sizeBytes' | 'timing' | 'cookies'>,
): ApiAssertionResult[] {
	let parsedJson: unknown;
	let jsonParsed = false;
	const getJson = () => {
		if (!jsonParsed) {
			jsonParsed = true;
			try { parsedJson = JSON.parse(response.body); } catch { parsedJson = undefined; }
		}
		return parsedJson;
	};

	const lowerHeaders = new Map<string, string>();
	for (const [k, v] of Object.entries(response.headers)) {
		lowerHeaders.set(k.toLowerCase(), v);
	}

	const results: ApiAssertionResult[] = [];
	for (const a of assertions) {
		if (a.enabled === false) { continue; }
		const name = a.name || `${a.kind}${a.target ? ` (${a.target})` : ''}`;
		const exp = a.expected ?? '';
		let passed = false;
		let actual = '';
		let message = '';

		switch (a.kind) {
			case 'status_equals': {
				const want = Number(exp);
				passed = response.status === want;
				actual = String(response.status);
				message = passed ? `Status is ${response.status}` : `Expected status ${want}, got ${response.status}`;
				break;
			}
			case 'status_range': {
				const [lo, hi] = exp.split('-').map(Number);
				passed = response.status >= (lo || 200) && response.status <= (hi || 299);
				actual = String(response.status);
				message = passed ? `Status ${response.status} within ${exp}` : `Status ${response.status} outside range ${exp}`;
				break;
			}
			case 'header_exists': {
				const key = (a.target ?? exp).toLowerCase();
				const val = lowerHeaders.get(key);
				passed = val !== undefined;
				actual = val ?? '<missing>';
				message = passed ? `Header "${key}" present` : `Header "${key}" missing`;
				break;
			}
			case 'header_contains': {
				const key = (a.target ?? '').toLowerCase();
				const val = lowerHeaders.get(key) ?? '';
				passed = val.toLowerCase().includes(exp.toLowerCase());
				actual = val || '<missing>';
				message = passed ? `Header "${key}" contains "${exp}"` : `Header "${key}" ("${actual}") does not contain "${exp}"`;
				break;
			}
			case 'body_contains': {
				passed = response.body.includes(exp);
				actual = response.body.slice(0, 120);
				message = passed ? `Body contains "${exp}"` : `Body does not contain "${exp}"`;
				break;
			}
			case 'body_regex': {
				try {
					const re = new RegExp(exp);
					passed = re.test(response.body);
					actual = response.body.slice(0, 120);
					message = passed ? `Body matched /${exp}/` : `Body did not match /${exp}/`;
				} catch (e) {
					passed = false;
					actual = 'invalid regex';
					message = `Invalid regex: ${e instanceof Error ? e.message : String(e)}`;
				}
				break;
			}
			case 'jsonpath_exists': {
				const q = queryJsonPath(getJson(), a.target ?? '$');
				passed = q.found && q.value !== undefined;
				actual = q.found ? JSON.stringify(q.value) : '<not found>';
				message = passed ? `${a.target} exists` : `JSONPath ${a.target} not found`;
				break;
			}
			case 'jsonpath_equals': {
				const q = queryJsonPath(getJson(), a.target ?? '$');
				const actualStr = q.found ? (typeof q.value === 'string' ? q.value : JSON.stringify(q.value)) : '<not found>';
				passed = q.found && actualStr === exp;
				actual = actualStr;
				message = passed ? `${a.target} === ${exp}` : `Expected ${a.target} === ${exp}, got ${actualStr}`;
				break;
			}
			case 'jsonpath_type': {
				const q = queryJsonPath(getJson(), a.target ?? '$');
				const t = !q.found ? 'undefined' : Array.isArray(q.value) ? 'array' : q.value === null ? 'null' : typeof q.value;
				passed = t === exp.toLowerCase();
				actual = t;
				message = passed ? `${a.target} is type ${t}` : `Expected ${a.target} to be ${exp}, got ${t}`;
				break;
			}
			case 'jsonpath_length_gte': {
				const q = queryJsonPath(getJson(), a.target ?? '$');
				const len = Array.isArray(q.value) || typeof q.value === 'string' ? q.value.length : -1;
				const min = Number(exp);
				passed = len >= min;
				actual = String(len);
				message = passed ? `${a.target} length ${len} >= ${min}` : `Expected length >= ${min}, got ${len}`;
				break;
			}
			case 'response_time_lt': {
				const limit = Number(exp);
				passed = response.timing.totalMs < limit;
				actual = `${response.timing.totalMs}ms`;
				message = passed ? `Response time ${response.timing.totalMs}ms < ${limit}ms` : `Response time ${response.timing.totalMs}ms exceeded ${limit}ms`;
				break;
			}
			case 'size_lt': {
				const limit = Number(exp);
				passed = response.sizeBytes < limit;
				actual = `${response.sizeBytes}B`;
				message = passed ? `Size ${response.sizeBytes}B < ${limit}B` : `Size ${response.sizeBytes}B exceeded ${limit}B`;
				break;
			}
			case 'cookie_exists': {
				const cname = a.target ?? exp;
				const found = response.cookies.find(c => c.name === cname);
				passed = Boolean(found);
				actual = found ? found.name : '<missing>';
				message = passed ? `Cookie "${cname}" present` : `Cookie "${cname}" missing`;
				break;
			}
			case 'json_schema_keys': {
				const obj = getJson();
				const requiredKeys = exp.split(',').map(s => s.trim()).filter(Boolean);
				if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
					const rec = obj as Record<string, unknown>;
					const missing = requiredKeys.filter(k => !Object.prototype.hasOwnProperty.call(rec, k));
					passed = missing.length === 0;
					actual = Object.keys(rec).join(', ');
					message = passed ? `All required keys present (${requiredKeys.join(', ')})` : `Missing required JSON keys: ${missing.join(', ')}`;
				} else {
					passed = false;
					actual = typeof obj;
					message = 'Response body is not a JSON object';
				}
				break;
			}
		}

		results.push({ id: a.id, name, kind: a.kind, passed, expected: exp || (a.target ?? ''), actual, message });
	}
	return results;
}

// ============================================================================
// 4. STRUCTURAL RESPONSE DIFF ENGINE
// ============================================================================

function diffJsonValues(
	left: unknown,
	right: unknown,
	path: string,
	out: Array<{ path: string; left?: string; right?: string; kind: 'added' | 'removed' | 'changed' | 'type_changed' }>,
): void {
	if (out.length > 150) { return; }
	if (left === right) { return; }
	const lt = Array.isArray(left) ? 'array' : left === null ? 'null' : typeof left;
	const rt = Array.isArray(right) ? 'array' : right === null ? 'null' : typeof right;
	if (lt !== rt) {
		out.push({ path, left: JSON.stringify(left), right: JSON.stringify(right), kind: 'type_changed' });
		return;
	}
	if (lt === 'array') {
		const la = left as unknown[];
		const ra = right as unknown[];
		const max = Math.max(la.length, ra.length);
		for (let i = 0; i < max; i++) {
			if (i >= la.length) { out.push({ path: `${path}[${i}]`, right: JSON.stringify(ra[i]), kind: 'added' }); }
			else if (i >= ra.length) { out.push({ path: `${path}[${i}]`, left: JSON.stringify(la[i]), kind: 'removed' }); }
			else { diffJsonValues(la[i], ra[i], `${path}[${i}]`, out); }
		}
		return;
	}
	if (lt === 'object') {
		const lo = left as Record<string, unknown>;
		const ro = right as Record<string, unknown>;
		const keys = new Set([...Object.keys(lo), ...Object.keys(ro)]);
		for (const k of keys) {
			const nextPath = `${path}.${k}`;
			if (!(k in lo)) { out.push({ path: nextPath, right: JSON.stringify(ro[k]), kind: 'added' }); }
			else if (!(k in ro)) { out.push({ path: nextPath, left: JSON.stringify(lo[k]), kind: 'removed' }); }
			else { diffJsonValues(lo[k], ro[k], nextPath, out); }
		}
		return;
	}
	out.push({ path, left: JSON.stringify(left), right: JSON.stringify(right), kind: 'changed' });
}

export function compareApiResponses(left: ApiResponseResult, right: ApiResponseResult, leftLabel = 'Baseline', rightLabel = 'Current'): ApiResponseDiffReport {
	const headerDiffs: Array<{ key: string; left?: string; right?: string; kind: 'added' | 'removed' | 'changed' }> = [];
	const allHeaderKeys = new Set([...Object.keys(left.headers), ...Object.keys(right.headers)]);
	for (const k of allHeaderKeys) {
		if (/^(date|etag|x-request-id)$/i.test(k)) { continue; }
		const lv = left.headers[k];
		const rv = right.headers[k];
		if (lv === undefined) { headerDiffs.push({ key: k, right: rv, kind: 'added' }); }
		else if (rv === undefined) { headerDiffs.push({ key: k, left: lv, kind: 'removed' }); }
		else if (lv !== rv) { headerDiffs.push({ key: k, left: lv, right: rv, kind: 'changed' }); }
	}

	const bodyDiffs: Array<{ path: string; left?: string; right?: string; kind: 'added' | 'removed' | 'changed' | 'type_changed' }> = [];
	try {
		const lj = JSON.parse(left.body);
		const rj = JSON.parse(right.body);
		diffJsonValues(lj, rj, '$', bodyDiffs);
	} catch {
		if (left.body !== right.body) {
			bodyDiffs.push({ path: '$body', left: left.body.slice(0, 200), right: right.body.slice(0, 200), kind: 'changed' });
		}
	}

	const statusChanged = left.status !== right.status;
	const identical = !statusChanged && headerDiffs.length === 0 && bodyDiffs.length === 0;
	const latencyDeltaMs = Math.round((right.timing.totalMs - left.timing.totalMs) * 10) / 10;
	const sizeDeltaBytes = right.sizeBytes - left.sizeBytes;

	return {
		leftLabel,
		rightLabel,
		statusChanged,
		leftStatus: left.status,
		rightStatus: right.status,
		latencyDeltaMs,
		sizeDeltaBytes,
		headerDiffs,
		bodyDiffs,
		identical,
		summary: identical
			? `Responses are structurally identical (HTTP ${right.status}, latency delta ${latencyDeltaMs >= 0 ? '+' : ''}${latencyDeltaMs}ms).`
			: `Found ${bodyDiffs.length} body diff(s), ${headerDiffs.length} header diff(s)${statusChanged ? `, status changed ${left.status} -> ${right.status}` : ''}.`,
	};
}

// ============================================================================
// 5. INTELLIGENT TEST SUITE GENERATOR, OPENAPI 3.1 & BREAKING-CHANGE DIFF
// ============================================================================

export function generateApiTestSuiteFromDiscovery(opts: {
	name?: string;
	baseUrl: string;
	discovery: ApiProjectDiscoveryReport;
	includeNegativeTests?: boolean;
}): ApiTestSuite {
	const base = opts.baseUrl.replace(/\/+$/, '');
	const now = new Date().toISOString();
	const requests: ApiRequestSpec[] = [];

	const httpRoutes = opts.discovery.routes.filter(r => r.protocol === 'http' && r.method !== 'ALL');
	for (const r of httpRoutes) {
		const resolvedPath = r.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, a, b) => `{{${a || b}}}`);
		const method = r.method as ApiHttpMethod;
		const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH';
		const assertions: ApiAssertionSpec[] = [
			{ id: `a-status-${requests.length}`, name: 'Expected 2xx status', kind: 'status_range', expected: '200-299', enabled: true },
			{ id: `a-time-${requests.length}`, name: 'Response under 2000ms', kind: 'response_time_lt', expected: '2000', enabled: true },
		];
		requests.push({
			id: `req-${requests.length + 1}`,
			name: `${method} ${r.path}`,
			protocol: 'http',
			method,
			url: `${base}${resolvedPath}`,
			description: `Auto-generated from ${r.filePath}:${r.line}`,
			params: [],
			headers: isMutating ? [{ id: 'h-ct', key: 'Content-Type', value: 'application/json', enabled: true }] : [],
			auth: r.requiresAuth ? { type: 'bearer', token: '{{authToken}}' } : { type: 'none' },
			body: isMutating ? { mode: 'json', raw: '{\n  "name": "kodia-test-item"\n}' } : { mode: 'none' },
			assertions,
		});

		if (opts.includeNegativeTests !== false && r.requiresAuth) {
			requests.push({
				id: `req-${requests.length + 1}`,
				name: `[Auth Negative] ${method} ${r.path} without credentials`,
				protocol: 'http',
				method,
				url: `${base}${resolvedPath}`,
				description: `Verifies unauthenticated access to ${r.path} is rejected with 401/403`,
				params: [],
				headers: [],
				auth: { type: 'none' },
				body: { mode: 'none' },
				assertions: [
					{ id: `a-unauth-${requests.length}`, name: 'Rejects unauthenticated request (401-403)', kind: 'status_range', expected: '401-403', enabled: true },
				],
			});
		}
	}

	return {
		id: `suite-${Date.now().toString(36)}`,
		name: opts.name || 'Discovered API Verification Suite',
		description: `Generated from ${opts.discovery.routes.length} discovered route(s) (${opts.discovery.frameworks.join(', ') || 'generic'}).`,
		baseUrl: base,
		requests,
		createdAt: now,
		updatedAt: now,
	};
}

export function generateOpenApiSpecFromDiscovery(opts: {
	title: string;
	version?: string;
	serverUrl?: string;
	discovery: ApiProjectDiscoveryReport;
}): Record<string, unknown> {
	const paths: Record<string, Record<string, unknown>> = {};
	for (const r of opts.discovery.routes.filter(x => x.protocol === 'http')) {
		const oasPath = r.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
		const method = (r.method === 'ALL' ? 'get' : r.method.toLowerCase());
		paths[oasPath] ??= {};
		const parameters = (r.pathParams ?? []).map(p => ({
			name: p,
			in: 'path',
			required: true,
			schema: { type: 'string' },
		}));
		paths[oasPath][method] = {
			summary: `${r.method} ${oasPath}`,
			description: `Discovered in ${r.filePath}:${r.line} (${r.framework})`,
			...(parameters.length > 0 ? { parameters } : {}),
			...(r.requiresAuth ? { security: [{ bearerAuth: [] }] } : {}),
			responses: {
				'200': { description: 'Successful response' },
				...(r.requiresAuth ? { '401': { description: 'Unauthorized' } } : {}),
			},
		};
	}

	return {
		openapi: '3.1.0',
		info: {
			title: opts.title,
			version: opts.version ?? '1.0.0',
			description: `Generated by Kodia API Engineering Studio from ${opts.discovery.routes.length} discovered route(s).`,
		},
		servers: [{ url: opts.serverUrl ?? 'http://localhost:3000' }],
		components: {
			securitySchemes: {
				bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
			},
		},
		paths,
	};
}

export function diffOpenApiSpecs(baseJson: string, targetJson: string): ApiSpecDiffReport {
	const breaking: string[] = [];
	const nonBreaking: string[] = [];
	const added: string[] = [];
	const removed: string[] = [];

	const base = JSON.parse(baseJson) as { info?: { title?: string; version?: string }; paths?: Record<string, Record<string, { parameters?: Array<{ name: string; required?: boolean }> }>> };
	const target = JSON.parse(targetJson) as { info?: { title?: string; version?: string }; paths?: Record<string, Record<string, { parameters?: Array<{ name: string; required?: boolean }> }>> };

	const basePaths = base.paths ?? {};
	const targetPaths = target.paths ?? {};

	for (const [p, ops] of Object.entries(basePaths)) {
		for (const m of Object.keys(ops ?? {})) {
			const opKey = `${m.toUpperCase()} ${p}`;
			if (!targetPaths[p]?.[m]) {
				removed.push(opKey);
				breaking.push(`Removed operation: ${opKey}`);
			} else {
				const baseParams = new Map((ops[m]?.parameters ?? []).map(x => [x.name, x]));
				const nextParams = new Map((targetPaths[p][m]?.parameters ?? []).map(x => [x.name, x]));
				for (const [pname, pdef] of nextParams) {
					if (pdef.required && !baseParams.get(pname)?.required) {
						breaking.push(`New required parameter "${pname}" added to ${opKey}`);
					}
				}
			}
		}
	}

	for (const [p, ops] of Object.entries(targetPaths)) {
		for (const m of Object.keys(ops ?? {})) {
			const opKey = `${m.toUpperCase()} ${p}`;
			if (!basePaths[p]?.[m]) {
				added.push(opKey);
				nonBreaking.push(`Added operation: ${opKey}`);
			}
		}
	}

	return {
		baseSpec: `${base.info?.title ?? 'Base'} (${base.info?.version ?? 'unknown'})`,
		targetSpec: `${target.info?.title ?? 'Target'} (${target.info?.version ?? 'unknown'})`,
		breakingChanges: breaking,
		nonBreakingChanges: nonBreaking,
		addedEndpoints: added,
		removedEndpoints: removed,
		summary: breaking.length > 0
			? `BREAKING CHANGES DETECTED: ${breaking.length} breaking, ${nonBreaking.length} non-breaking (${added.length} added, ${removed.length} removed).`
			: `Backwards-compatible change: 0 breaking changes, ${added.length} endpoint(s) added.`,
	};
}

// ============================================================================
// 6. MULTI-LANGUAGE CLIENT / SDK GENERATOR & IMPORT/EXPORT CONVERTERS
// ============================================================================

export type ClientCodeTarget = 'curl' | 'fetch' | 'typescript-sdk' | 'python' | 'go' | 'rust' | 'csharp' | 'java';

export function generateApiClientCode(req: ApiRequestSpec, target: ClientCodeTarget): string {
	const headers = req.headers.filter(h => h.enabled && h.key.trim());
	const hasBody = req.body.mode !== 'none' && Boolean(req.body.raw || req.body.graphqlQuery);
	const bodyStr = req.body.mode === 'graphql'
		? JSON.stringify({ query: req.body.graphqlQuery ?? '', variables: req.body.graphqlVariables ? JSON.parse(req.body.graphqlVariables) : {} })
		: (req.body.raw ?? '');

	switch (target) {
		case 'curl': {
			const parts = [`curl -X ${req.method} '${req.url}'`];
			for (const h of headers) { parts.push(`  -H '${h.key}: ${h.value}'`); }
			if (req.auth.type === 'bearer') { parts.push(`  -H 'Authorization: Bearer <TOKEN>'`); }
			if (hasBody) { parts.push(`  -d '${bodyStr.replace(/'/g, "'\\''")}'`); }
			return parts.join(' \\\n');
		}
		case 'fetch':
		case 'typescript-sdk': {
			const hdrObj: Record<string, string> = {};
			for (const h of headers) { hdrObj[h.key] = h.value; }
			if (req.auth.type === 'bearer') { hdrObj['Authorization'] = 'Bearer ${token}'; }
			return [
				`export async function executeRequest(baseUrl = ${JSON.stringify(req.url)}, token = '') {`,
				`  const response = await fetch(baseUrl, {`,
				`    method: ${JSON.stringify(req.method)},`,
				`    headers: ${JSON.stringify(hdrObj, null, 4)},`,
				...(hasBody ? [`    body: ${JSON.stringify(bodyStr)},`] : []),
				`  });`,
				`  if (!response.ok) throw new Error(\`HTTP \${response.status}: \${await response.text()}\`);`,
				`  return response.json();`,
				`}`,
			].join('\n');
		}
		case 'python':
			return [
				`import httpx`,
				``,
				`headers = ${JSON.stringify(Object.fromEntries(headers.map(h => [h.key, h.value])), null, 2)}`,
				`with httpx.Client(timeout=15.0) as client:`,
				`    resp = client.request(${JSON.stringify(req.method)}, ${JSON.stringify(req.url)}, headers=headers${hasBody ? `, content=${JSON.stringify(bodyStr)}` : ''})`,
				`    resp.raise_for_status()`,
				`    print(resp.status_code, resp.text)`,
			].join('\n');
		case 'go':
			return [
				`package main`,
				`import ("bytes"; "fmt"; "io"; "net/http")`,
				`func main() {`,
				`  req, _ := http.NewRequest(${JSON.stringify(req.method)}, ${JSON.stringify(req.url)}, ${hasBody ? `bytes.NewBufferString(${JSON.stringify(bodyStr)})` : 'nil'})`,
				...headers.map(h => `  req.Header.Set(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`),
				`  resp, err := http.DefaultClient.Do(req)`,
				`  if err != nil { panic(err) }`,
				`  defer resp.Body.Close()`,
				`  b, _ := io.ReadAll(resp.Body)`,
				`  fmt.Println(resp.StatusCode, string(b))`,
				`}`,
			].join('\n');
		case 'rust':
			return [
				`let client = reqwest::Client::new();`,
				`let resp = client.request(reqwest::Method::from_bytes(b${JSON.stringify(req.method)})?, ${JSON.stringify(req.url)})`,
				...headers.map(h => `    .header(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`),
				...(hasBody ? [`    .body(${JSON.stringify(bodyStr)})`] : []),
				`    .send().await?;`,
			].join('\n');
		case 'csharp':
			return [
				`using var client = new HttpClient();`,
				`using var req = new HttpRequestMessage(new HttpMethod(${JSON.stringify(req.method)}), ${JSON.stringify(req.url)});`,
				...headers.map(h => `req.Headers.TryAddWithoutValidation(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)});`),
				...(hasBody ? [`req.Content = new StringContent(${JSON.stringify(bodyStr)}, System.Text.Encoding.UTF8, "application/json");`] : []),
				`using var resp = await client.SendAsync(req);`,
				`Console.WriteLine(await resp.Content.ReadAsStringAsync());`,
			].join('\n');
		case 'java':
			return [
				`HttpClient client = HttpClient.newHttpClient();`,
				`HttpRequest request = HttpRequest.newBuilder().uri(URI.create(${JSON.stringify(req.url)}))`,
				...headers.map(h => `    .header(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`),
				`    .method(${JSON.stringify(req.method)}, ${hasBody ? `HttpRequest.BodyPublishers.ofString(${JSON.stringify(bodyStr)})` : 'HttpRequest.BodyPublishers.noBody()'})`,
				`    .build();`,
				`HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());`,
			].join('\n');
	}
}

export function importFromCurl(curlCmd: string): ApiRequestSpec {
	const methodMatch = /-X\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i.exec(curlCmd);
	const urlMatch = /(https?:\/\/[^\s'"]+)/i.exec(curlCmd);
	const headers: ApiKeyValuePair[] = [];
	for (const hm of curlCmd.matchAll(/(?:-H|--header)\s+['"]([^:'"]+):\s*([^'"]+)['"]/g)) {
		headers.push({ id: `h-${headers.length + 1}`, key: hm[1].trim(), value: hm[2].trim(), enabled: true });
	}
	const dataMatch = /(?:-d|--data|--data-raw)\s+['"]([\s\S]*?)['"]/.exec(curlCmd);
	const method: ApiHttpMethod = (methodMatch ? methodMatch[1].toUpperCase() : dataMatch ? 'POST' : 'GET') as ApiHttpMethod;
	return {
		id: `req-${Date.now().toString(36)}`,
		name: `Imported ${method} ${urlMatch ? new URL(urlMatch[1]).pathname : '/'}`,
		protocol: 'http',
		method,
		url: urlMatch ? urlMatch[1] : 'http://localhost:3000',
		params: [],
		headers,
		auth: { type: 'none' },
		body: dataMatch ? { mode: 'json', raw: dataMatch[1] } : { mode: 'none' },
	};
}

export function importFromPostmanCollection(rawJson: string): ApiCollection {
	const doc = JSON.parse(rawJson) as {
		info?: { name?: string; description?: string };
		item?: Array<{
			name?: string;
			request?: {
				method?: string;
				url?: string | { raw?: string };
				header?: Array<{ key: string; value: string; disabled?: boolean }>;
				body?: { mode?: string; raw?: string };
			};
			item?: unknown[];
		}>;
	};
	const now = new Date().toISOString();
	const requests: ApiRequestSpec[] = [];
	const walk = (items: typeof doc.item, folderPath: string) => {
		for (const it of items ?? []) {
			if (it.item && Array.isArray(it.item)) {
				walk(it.item as typeof doc.item, folderPath ? `${folderPath}/${it.name ?? 'Folder'}` : (it.name ?? 'Folder'));
			} else if (it.request) {
				const url = typeof it.request.url === 'string' ? it.request.url : (it.request.url?.raw ?? '');
				const method = (it.request.method?.toUpperCase() || 'GET') as ApiHttpMethod;
				requests.push({
					id: `pm-${requests.length + 1}`,
					name: it.name || `${method} ${url}`,
					protocol: 'http',
					method,
					url,
					folderPath: folderPath || undefined,
					params: [],
					headers: (it.request.header ?? []).map((h, i) => ({ id: `h-${i}`, key: h.key, value: h.value, enabled: !h.disabled })),
					auth: { type: 'none' },
					body: it.request.body?.raw ? { mode: 'json', raw: it.request.body.raw } : { mode: 'none' },
				});
			}
		}
	};
	walk(doc.item, '');
	return {
		id: `col-${Date.now().toString(36)}`,
		name: doc.info?.name || 'Imported Postman Collection',
		description: doc.info?.description,
		variables: [],
		requests,
		createdAt: now,
		updatedAt: now,
	};
}

export function exportCollectionToPostman(col: ApiCollection): Record<string, unknown> {
	return {
		info: {
			name: col.name,
			description: col.description ?? '',
			schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
		},
		item: col.requests.map(r => ({
			name: r.name,
			request: {
				method: r.method,
				header: r.headers.filter(h => !h.secret).map(h => ({ key: h.key, value: redactApiSecrets(h.value), disabled: !h.enabled })),
				url: { raw: r.url },
				...(r.body.mode !== 'none' && r.body.raw ? { body: { mode: 'raw', raw: r.body.raw } } : {}),
			},
		})),
	};
}

export function exportTestRunToCsv(run: ApiTestRunResult): string {
	const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
	const header = 'Request,Method,URL,Status,HTTP,DurationMs,PassedAssertions,TotalAssertions,FailureReason';
	const rows = run.cases.map(c => [
		esc(c.name),
		c.method,
		esc(c.url),
		c.status,
		String(c.httpStatus ?? ''),
		String(c.durationMs),
		String(c.assertions.filter(a => a.passed).length),
		String(c.assertions.length),
		esc(c.failureReason ?? ''),
	].join(','));
	return [header, ...rows].join('\n');
}

// ============================================================================
// 7. STATIC API SECURITY AUDIT, FAILURE CORRELATION & PRODUCTION READINESS
// ============================================================================

export function auditApiWorkspaceStaticSecurity(files: readonly ApiSourceFile[]): { findings: ApiSecurityFinding[]; passedControls: string[] } {
	const findings: ApiSecurityFinding[] = [];
	const passed = new Set<string>();
	const add = (f: Omit<ApiSecurityFinding, 'id'>) => {
		findings.push({ id: `APISEC-${String(findings.length + 1).padStart(3, '0')}`, ...f });
	};

	for (const f of files) {
		const lines = f.content.split(/\r?\n/);
		if (/helmet|content-security-policy|strict-transport-security/i.test(f.content)) { passed.add('Security headers middleware detected'); }
		if (/rate.?limit|express-rate-limit|slowapi|throttl/i.test(f.content)) { passed.add('Rate limiting control detected'); }
		if (/zod|joi|yup|pydantic|class-validator/i.test(f.content)) { passed.add('Request input schema validation detected'); }

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1;
			if (/Access-Control-Allow-Origin['"`:\s,]+['"`]\*['"`]/i.test(line) || /cors\(\s*\{\s*origin:\s*['"`]\*['"`]/i.test(line)) {
				add({
					severity: 'medium',
					confidence: 'heuristic',
					category: 'cors',
					title: 'Wildcard CORS Access-Control-Allow-Origin: *',
					file: f.path,
					line: lineNum,
					evidence: line.trim().slice(0, 140),
					remediation: 'Restrict CORS origins to an explicit allowlist, especially for authenticated APIs.',
				});
			}
			if (/(?:query|execute)\s*\(\s*(?:`[^`]*\$\{|f["'][^"']*\{|["'](?:SELECT|INSERT|UPDATE|DELETE)[^"']*["']\s*\+)/i.test(line)) {
				add({
					severity: 'critical',
					confidence: 'heuristic',
					category: 'injection',
					title: 'Potential SQL injection via string-interpolated query',
					file: f.path,
					line: lineNum,
					evidence: line.trim().slice(0, 140),
					remediation: 'Use parameterized queries / prepared statements instead of string concatenation.',
				});
			}
			if (/jwt\.decode\s*\(/i.test(line) && !/jwt\.verify/i.test(f.content)) {
				add({
					severity: 'high',
					confidence: 'heuristic',
					category: 'authentication',
					title: 'JWT decoded without cryptographic signature verification',
					file: f.path,
					line: lineNum,
					evidence: line.trim().slice(0, 140),
					remediation: 'Always verify JWT signature, issuer, audience, and expiration using jwt.verify().',
				});
			}
			if (/res\.(?:status\([^)]*\)\.)?(?:json|send)\s*\([^)]*(?:err\.stack|error\.stack)/i.test(line)) {
				add({
					severity: 'medium',
					confidence: 'heuristic',
					category: 'error-leakage',
					title: 'Internal stack trace returned in HTTP response',
					file: f.path,
					line: lineNum,
					evidence: line.trim().slice(0, 140),
					remediation: 'Return sanitized error codes to clients and log full stack traces server-side with a correlation ID.',
				});
			}
		}
	}

	return { findings, passedControls: [...passed] };
}

export function correlateApiFailure(opts: {
	response: ApiResponseResult;
	discovery?: ApiProjectDiscoveryReport | null;
	runtimes?: readonly ApiManagedRuntimeInfo[];
}): ApiFailureCorrelationReport {
	let pathname = '/';
	try { pathname = new URL(opts.response.resolvedUrl).pathname; } catch { pathname = opts.response.resolvedUrl; }

	const matchedRoute = opts.discovery?.routes.find(r => {
		const pattern = '^' + r.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)|\{([^}]+)\}/g, '[^/]+') + '/?$';
		try {
			return (r.method === opts.response.method || r.method === 'ALL') && new RegExp(pattern).test(pathname);
		} catch {
			return false;
		}
	});

	const allLogs = (opts.runtimes ?? []).flatMap(rt => rt.recentLogs.map(l => `[${rt.name}] ${l}`));
	const matchedLogLines = allLogs.filter(l =>
		l.includes(pathname) || /error|exception|traceback|unhandled|500|401|403|404|refused|timeout/i.test(l),
	).slice(-15);

	const failedAssertions = opts.response.assertionResults.filter(a => !a.passed).map(a => `${a.name}: ${a.message}`);
	const likelyRootCauses: string[] = [];
	const repairSteps: string[] = [];

	if (opts.response.error) {
		likelyRootCauses.push(`Network/transport error: ${opts.response.error}`);
		repairSteps.push('Verify target API service is running, listening on the expected port, and passing health checks.');
	} else if (opts.response.status === 401 || opts.response.status === 403) {
		likelyRootCauses.push(`Authentication/authorization rejected request (HTTP ${opts.response.status}).`);
		repairSteps.push('Inspect Authorization header / token expiration / RBAC middleware for this route.');
	} else if (opts.response.status === 404) {
		likelyRootCauses.push(`Route ${opts.response.method} ${pathname} not mounted or resource ID missing.`);
		repairSteps.push('Verify route path prefix, HTTP method registration, and test fixture creation order.');
	} else if (opts.response.status >= 500) {
		likelyRootCauses.push(`Server-side unhandled exception (HTTP ${opts.response.status}).`);
		repairSteps.push('Inspect correlated runtime logs and route handler implementation for null dereference, DB constraint, or validation error.');
	} else if (failedAssertions.length > 0) {
		likelyRootCauses.push(`Response contract/assertion mismatch (${failedAssertions.length} assertion(s) failed).`);
		repairSteps.push('Compare actual response payload against route handler logic and expected contract.');
	}

	if (matchedRoute) {
		repairSteps.push(`Open ${matchedRoute.filePath}:${matchedRoute.line} to inspect or patch the route handler, then rerun the API test suite.`);
	}

	return {
		requestId: opts.response.requestId,
		endpoint: `${opts.response.method} ${pathname}`,
		status: opts.response.status,
		failedAssertions,
		matchedRoute,
		matchedLogLines,
		likelyRootCauses,
		repairSteps,
		summary: `Correlated failure on ${opts.response.method} ${pathname} (HTTP ${opts.response.status})${matchedRoute ? ` -> ${matchedRoute.filePath}:${matchedRoute.line}` : ''}. ${likelyRootCauses[0] ?? ''}`,
	};
}

export function assessApiProductionReadiness(opts: {
	discovery?: ApiProjectDiscoveryReport | null;
	latestTestRun?: ApiTestRunResult | null;
	latestLoadRun?: ApiLoadTestResult | null;
	latestSecurityReport?: ApiSecurityReport | null;
	runtimes?: readonly ApiManagedRuntimeInfo[];
}): ApiProductionReadinessReport {
	const pillars: ApiReadinessPillar[] = [];
	const blockers: string[] = [];
	const recommendations: string[] = [];

	// 1. Functional
	if (!opts.latestTestRun || opts.latestTestRun.total === 0) {
		pillars.push({ pillar: 'functional', status: 'not_tested', score: 0, evidence: [], gaps: ['No automated API functional test suite has been executed yet.'] });
		blockers.push('Functional API test suite has not executed.');
	} else {
		const passed = opts.latestTestRun.failed === 0 && opts.latestTestRun.blocked === 0 && opts.latestTestRun.timedOut === 0;
		pillars.push({
			pillar: 'functional',
			status: passed ? 'passed' : 'failed',
			score: Math.round(opts.latestTestRun.passRate * 100),
			evidence: [`Latest suite "${opts.latestTestRun.suiteName}": ${opts.latestTestRun.passed}/${opts.latestTestRun.total} passed (${Math.round(opts.latestTestRun.passRate * 100)}%).`],
			gaps: passed ? [] : [`${opts.latestTestRun.failed} failed, ${opts.latestTestRun.blocked} blocked, ${opts.latestTestRun.timedOut} timed out.`],
		});
		if (!passed) { blockers.push(`Functional tests failing (${opts.latestTestRun.failed} failed).`); }
	}

	// 2. Security
	if (!opts.latestSecurityReport) {
		pillars.push({ pillar: 'security', status: 'not_tested', score: 0, evidence: [], gaps: ['No API security audit has been run yet.'] });
		blockers.push('API security audit has not executed.');
	} else {
		const secOk = opts.latestSecurityReport.criticalCount === 0 && opts.latestSecurityReport.highCount === 0;
		pillars.push({
			pillar: 'security',
			status: secOk ? 'passed' : 'failed',
			score: opts.latestSecurityReport.score,
			evidence: [`Security score ${opts.latestSecurityReport.score}/100 across ${opts.latestSecurityReport.filesScanned} file(s) and ${opts.latestSecurityReport.liveEndpointsProbed} live endpoint(s).`],
			gaps: secOk ? [] : [`${opts.latestSecurityReport.criticalCount} critical, ${opts.latestSecurityReport.highCount} high security finding(s).`],
		});
		if (!secOk) { blockers.push(`Unresolved critical/high API security findings (${opts.latestSecurityReport.criticalCount} critical, ${opts.latestSecurityReport.highCount} high).`); }
	}

	// 3. Performance
	if (!opts.latestLoadRun) {
		pillars.push({ pillar: 'performance', status: 'not_tested', score: 0, evidence: [], gaps: ['No performance/load test has been executed yet.'] });
		recommendations.push('Run a controlled load test via api_run_load_test to establish latency (P50/P95/P99) and error-rate baselines.');
	} else {
		const perfOk = opts.latestLoadRun.passedThresholds && !opts.latestLoadRun.error;
		pillars.push({
			pillar: 'performance',
			status: perfOk ? (opts.latestLoadRun.generatorSaturated ? 'requires_review' : 'passed') : 'failed',
			score: perfOk ? Math.max(70, Math.round((1 - opts.latestLoadRun.errorRate) * 100)) : 40,
			evidence: [`Load test "${opts.latestLoadRun.name}": ${opts.latestLoadRun.rps} RPS, P95=${opts.latestLoadRun.latencyMs.p95}ms, errorRate=${(opts.latestLoadRun.errorRate * 100).toFixed(2)}% (${opts.latestLoadRun.totalRequests} requests).`],
			gaps: perfOk ? (opts.latestLoadRun.generatorSaturated ? ['Load generator reported saturation; validate with distributed workers before claiming production scale.'] : []) : opts.latestLoadRun.thresholdDetails,
		});
		if (!perfOk) { blockers.push('Performance thresholds failed in latest load test.'); }
	}

	// 4. Reliability
	const hasHealth = Boolean(opts.discovery?.services.some(s => s.healthPath) || opts.runtimes?.some(r => r.status === 'ready'));
	pillars.push({
		pillar: 'reliability',
		status: hasHealth && (opts.latestLoadRun?.errorRate ?? 0) < 0.02 ? 'passed' : 'requires_review',
		score: hasHealth ? 80 : 50,
		evidence: hasHealth ? ['Health endpoint or live verified runtime readiness detected.'] : [],
		gaps: hasHealth ? [] : ['Add explicit /health or /ready endpoint and verify graceful shutdown + retry/idempotency semantics.'],
	});

	// 5. Operational
	const hasEnvOrRuntime = Boolean((opts.discovery?.envVariables.length ?? 0) > 0 || (opts.runtimes?.length ?? 0) > 0);
	pillars.push({
		pillar: 'operational',
		status: hasEnvOrRuntime ? 'requires_review' : 'not_tested',
		score: hasEnvOrRuntime ? 75 : 40,
		evidence: hasEnvOrRuntime ? [`Detected ${opts.discovery?.envVariables.length ?? 0} env variable(s) and ${opts.discovery?.services.length ?? 0} service(s).`] : [],
		gaps: ['Confirm structured logging, correlation IDs, metrics/tracing export, and CI/CD deployment manifests before production rollout.'],
	});

	// 6. Documentation
	const hasSpec = (opts.discovery?.specFiles.length ?? 0) > 0;
	pillars.push({
		pillar: 'documentation',
		status: hasSpec ? 'passed' : 'requires_review',
		score: hasSpec ? 90 : 45,
		evidence: hasSpec ? [`Discovered ${opts.discovery!.specFiles.length} formal API specification file(s).`] : [],
		gaps: hasSpec ? [] : ['No OpenAPI/GraphQL/Protobuf specification file found; generate one via api_generate_openapi.'],
	});

	const avgScore = Math.round(pillars.reduce((s, p) => s + p.score, 0) / pillars.length);
	let overallStatus: ReadinessStatus;
	if (pillars.some(p => p.status === 'failed')) {
		overallStatus = 'failed';
	} else if (pillars.some(p => p.status === 'blocked')) {
		overallStatus = 'blocked';
	} else if (pillars.filter(p => p.status === 'not_tested').length >= 2) {
		overallStatus = 'not_tested';
	} else if (blockers.length > 0 || pillars.some(p => p.status === 'requires_review' || p.status === 'not_tested')) {
		overallStatus = 'requires_review';
	} else {
		overallStatus = 'passed';
	}

	return {
		generatedAt: new Date().toISOString(),
		overallStatus,
		overallScore: avgScore,
		pillars,
		blockers,
		recommendations,
		summary: `Production Readiness: **${overallStatus.toUpperCase()}** (Score: ${avgScore}/100, ${blockers.length} blocker(s)).`,
	};
}

// ============================================================================
// 8. LLM FORMATTERS
// ============================================================================

export function formatDiscoveryForLLM(d: ApiProjectDiscoveryReport): string {
	return [
		`# Kodia API Project Discovery`,
		d.summary,
		`Languages: ${d.languages.join(', ') || 'Unknown'} | Frameworks: ${d.frameworks.join(', ') || 'generic'} | Protocols: ${d.protocols.join(', ')}`,
		`Auth: ${d.authMechanisms.join(', ') || 'none detected'} | Databases: ${d.databases.join(', ') || 'none'} | Queues/Caches: ${d.queuesAndCaches.join(', ') || 'none'}`,
		`## Routes (${d.routes.length})`,
		...d.routes.slice(0, 40).map(r => `- **${r.method}** \`${r.path}\` [${r.protocol}/${r.framework}] -> \`${r.filePath}:${r.line}\`${r.requiresAuth ? ' (auth)' : ''}`),
		...(d.specFiles.length ? [`## Specs\n${d.specFiles.map(s => `- ${s.path} (${s.kind}, ${s.operationCount} ops)`).join('\n')}`] : []),
		`## Service Topology\n\`\`\`mermaid\n${d.mermaidTopology}\n\`\`\``,
	].join('\n');
}

export function formatResponseForLLM(r: ApiResponseResult): string {
	const passedCount = r.assertionResults.filter(a => a.passed).length;
	return [
		`# API Response: ${r.method} ${r.resolvedUrl}${r.isMock ? ' [MOCK SERVER]' : ''}`,
		`Status: **${r.status} ${r.statusText}** | Total: ${r.timing.totalMs}ms (TTFB: ${r.timing.ttfbMs ?? 'n/a'}ms, DNS: ${r.timing.dnsMs ?? 'n/a'}ms, Connect: ${r.timing.connectMs ?? 'n/a'}ms) | Size: ${r.sizeBytes}B`,
		...(r.error ? [`Error: ${r.error}`] : []),
		...(r.assertionResults.length ? [`Assertions: ${passedCount}/${r.assertionResults.length} passed\n${r.assertionResults.map(a => `- [${a.passed ? 'PASS' : 'FAIL'}] ${a.name}: ${a.message}`).join('\n')}`] : []),
		...(r.scriptLogs.length ? [`Script Logs:\n${r.scriptLogs.map(l => `- ${l}`).join('\n')}`] : []),
		...(r.scriptErrors.length ? [`Script Errors:\n${r.scriptErrors.map(e => `- ${e}`).join('\n')}`] : []),
		`Body Preview:\n\`\`\`\n${r.body.slice(0, 1800)}${r.body.length > 1800 ? '\n...[truncated]' : ''}\n\`\`\``,
	].join('\n');
}
