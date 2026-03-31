import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MemorySystem } from "./memory/system.ts";
import { MemoryConfigSchema } from "./config/schemas.ts";

const config = MemoryConfigSchema.parse({
	qdrant: { url: process.env.QDRANT_URL || "http://localhost:6333" },
	ollama: { url: process.env.OLLAMA_URL || "http://localhost:11434", model: "nomic-embed-text" }
});

const memory = new MemorySystem(config);
await memory.initialize();

const server = new Server(
	{ name: "phantom-memory-mcp", version: "1.0.0" },
	{ capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			{
				name: "store_memory",
				description: "Store a new memory in the episodic or semantic database for long-term retrieval.",
				inputSchema: {
					type: "object",
					properties: {
						text: { type: "string", description: "The core text of the memory to store." },
						type: { type: "string", enum: ["episodic", "semantic", "procedural"], description: "The category of memory." },
						session_id: { type: "string", description: "Optional session or mission ID to associate with this memory." }
					},
					required: ["text", "type"]
				}
			},
			{
				name: "search_memory",
				description: "Search for related memories across the vector space to recall important context.",
				inputSchema: {
					type: "object",
					properties: {
						query: { type: "string", description: "Natural language search query." },
						limit: { type: "number", description: "Max number of results. Defaults to 5." }
					},
					required: ["query"]
				}
			}
		]
	};
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const now = new Date().toISOString();

	if (request.params.name === "store_memory") {
		const args = request.params.arguments as { text: string; type: string; session_id?: string };
		try {
			const id = crypto.randomUUID();
			const sessionId = args.session_id || "mcp-session";

			if (args.type === "episodic") {
				await memory.storeEpisode({
					id,
					type: "observation",
					summary: args.text.slice(0, 120),
					detail: args.text,
					parent_id: null,
					session_id: sessionId,
					user_id: "mcp",
					tools_used: [],
					files_touched: [],
					outcome: "success",
					outcome_detail: "",
					lessons: [],
					started_at: now,
					ended_at: now,
					duration_seconds: 0,
					importance: 0.7,
					access_count: 0,
					last_accessed_at: now,
					decay_rate: 0.01
				});
			} else if (args.type === "semantic") {
				await memory.storeFact({
					id,
					subject: sessionId,
					predicate: "knows",
					object: args.text.slice(0, 120),
					natural_language: args.text,
					source_episode_ids: [],
					confidence: 1.0,
					valid_from: now,
					valid_until: null,
					version: 1,
					previous_version_id: null,
					category: "domain_knowledge",
					tags: []
				});
			} else {
				await memory.storeProcedure({
					id,
					name: args.text.slice(0, 60),
					description: args.text,
					trigger: args.text.slice(0, 60),
					steps: [],
					preconditions: [],
					postconditions: [],
					parameters: {},
					source_episode_ids: [],
					success_count: 0,
					failure_count: 0,
					last_used_at: now,
					confidence: 1.0,
					version: 1
				});
			}
			return { toolResult: `Successfully stored ${args.type} memory (id: ${id}).` };
		} catch (e: any) {
			return { toolResult: `Error storing memory: ${e.message}`, isError: true };
		}

	} else if (request.params.name === "search_memory") {
		const args = request.params.arguments as { query: string; limit?: number };
		try {
			const limit = args.limit || 5;
			const [episodes, facts, procedure] = await Promise.all([
				memory.recallEpisodes(args.query, { limit, minScore: 0.7 }),
				memory.recallFacts(args.query, { limit, minScore: 0.7 }),
				memory.findProcedure(args.query)
			]);

			const results = [
				...episodes.map(e => `[Episodic | ${e.started_at}] ${e.summary}: ${e.detail}`),
				...facts.map(f => `[Semantic] ${f.natural_language}`),
				...(procedure ? [`[Procedural] ${procedure.description}`] : [])
			];

			return { toolResult: results.length > 0 ? results.join("\n---\n") : "No relevant memories found." };
		} catch (e: any) {
			return { toolResult: `Error searching memory: ${e.message}`, isError: true };
		}
	}

	throw new Error(`Unknown tool: ${request.params.name}`);
});

const httpPortRaw = process.env.MEMORY_MCP_HTTP_PORT;

if (httpPortRaw) {
	const port = Number.parseInt(httpPortRaw, 10);
	if (!Number.isFinite(port) || port <= 0 || port > 65535) {
		throw new Error(`Invalid MEMORY_MCP_HTTP_PORT: ${httpPortRaw}`);
	}

	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	});
	await server.connect(transport);

	const httpServer = createServer((req, res) => {
		const url = req.url ?? "";
		if (!url.startsWith("/mcp")) {
			res.statusCode = 404;
			res.end("Not found");
			return;
		}

		if (req.method === "POST") {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				let parsed: unknown = undefined;
				if (body) {
					try {
						parsed = JSON.parse(body);
					} catch {
						parsed = body;
					}
				}
				transport.handleRequest(req as any, res as any, parsed).catch((err: unknown) => {
					res.statusCode = 500;
					res.end(err instanceof Error ? err.message : String(err));
				});
			});
			return;
		}

		transport.handleRequest(req as any, res as any).catch((err: unknown) => {
			res.statusCode = 500;
			res.end(err instanceof Error ? err.message : String(err));
		});
	});

	httpServer.listen(port, "0.0.0.0", () => {
		console.error(`[memory-mcp] HTTP transport listening on :${port}/mcp`);
	});
} else {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("[memory-mcp] Server started. Waiting for MCP calls via stdio.");
}
