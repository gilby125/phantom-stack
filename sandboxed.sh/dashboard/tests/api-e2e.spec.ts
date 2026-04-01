import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import {
  expectJsonOk,
  expectStatus,
  getApiTestConfig,
  getAuthHeaders,
  parseJson,
} from "./helpers/api";

type Workspace = {
  id: string;
  name: string;
  workspace_type?: string;
  path: string;
  status?: string;
};

type Mission = {
  id: string;
  title?: string | null;
  status?: string;
  workspace_id?: string | null;
  backend?: string;
};

type Automation = {
  id: string;
};

type ProxyKey = {
  id: string;
};

type Chain = {
  id: string;
};

type CreateTaskResponse = {
  id: string;
  status: string;
};

type SuiteContext = {
  baseUrl: string;
  headers: Record<string, string>;
  backendIds: string[];
  hostWorkspace: Workspace;
  createdMissionIds: string[];
  createdWorkspaceIds: string[];
  createdAutomationIds: string[];
  createdProxyKeyIds: string[];
  createdChainIds: string[];
};

const config = getApiTestConfig();
const runOptionalMutations = process.env.E2E_API_RUN_OPTIONAL_MUTATIONS === "1";

let ctx: SuiteContext | undefined;

const requireCtx = (): SuiteContext => {
  if (!ctx) {
    throw new Error("Suite context not initialized. Did test.beforeAll fail?");
  }
  return ctx;
};

test.describe.configure({ mode: "serial" });

async function apiGet(
  request: APIRequestContext,
  path: string,
  headers?: Record<string, string>
): Promise<APIResponse> {
  const suite = requireCtx();
  return request.get(`${suite.baseUrl}${path}`, {
    headers: headers ?? suite.headers,
    failOnStatusCode: false,
  });
}

async function apiPost(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  headers?: Record<string, string>
): Promise<APIResponse> {
  const suite = requireCtx();
  const effectiveHeaders = headers ?? suite.headers;
  return request.post(`${suite.baseUrl}${path}`, {
    headers: data
      ? { ...effectiveHeaders, "Content-Type": "application/json" }
      : effectiveHeaders,
    data,
    failOnStatusCode: false,
  });
}

async function apiPut(
  request: APIRequestContext,
  path: string,
  data: unknown,
  headers?: Record<string, string>
): Promise<APIResponse> {
  const suite = requireCtx();
  const effectiveHeaders = headers ?? suite.headers;
  return request.put(`${suite.baseUrl}${path}`, {
    headers: { ...effectiveHeaders, "Content-Type": "application/json" },
    data,
    failOnStatusCode: false,
  });
}

async function apiPatch(
  request: APIRequestContext,
  path: string,
  data: unknown,
  headers?: Record<string, string>
): Promise<APIResponse> {
  const suite = requireCtx();
  const effectiveHeaders = headers ?? suite.headers;
  return request.patch(`${suite.baseUrl}${path}`, {
    headers: { ...effectiveHeaders, "Content-Type": "application/json" },
    data,
    failOnStatusCode: false,
  });
}

async function apiDelete(
  request: APIRequestContext,
  path: string,
  headers?: Record<string, string>
): Promise<APIResponse> {
  const suite = requireCtx();
  return request.delete(`${suite.baseUrl}${path}`, {
    headers: headers ?? suite.headers,
    failOnStatusCode: false,
  });
}

async function apiPutText(
  request: APIRequestContext,
  path: string,
  body: string,
  headers?: Record<string, string>
): Promise<APIResponse> {
  const suite = requireCtx();
  const effectiveHeaders = headers ?? suite.headers;
  return request.put(`${suite.baseUrl}${path}`, {
    headers: { ...effectiveHeaders, "Content-Type": "text/plain" },
    data: body,
    failOnStatusCode: false,
  });
}

async function cleanupIds(request: APIRequestContext, ids: string[], deleter: (id: string) => Promise<void>) {
  while (ids.length > 0) {
    const id = ids.pop();
    if (!id) continue;
    await deleter(id);
  }
}

test.beforeAll(async ({ request }) => {
  const headers = await getAuthHeaders(request, config);

  const workspacesRes = await request.get(`${config.baseUrl}/api/workspaces`, {
    headers,
    failOnStatusCode: false,
  });
  const workspaces = await expectJsonOk<Workspace[]>(workspacesRes, "list workspaces");
  const hostWorkspace =
    workspaces.find((workspace) => workspace.id === "00000000-0000-0000-0000-000000000000") ||
    workspaces.find((workspace) => workspace.workspace_type === "host");

  expect(hostWorkspace, "expected a host workspace for API E2E tests").toBeTruthy();

  const backendsRes = await request.get(`${config.baseUrl}/api/backends`, {
    headers,
    failOnStatusCode: false,
  });
  const backends = await expectJsonOk<Array<{ id: string }>>(backendsRes, "list backends");

  ctx = {
    baseUrl: config.baseUrl,
    headers,
    backendIds: backends.map((backend) => backend.id),
    hostWorkspace: hostWorkspace!,
    createdMissionIds: [],
    createdWorkspaceIds: [],
    createdAutomationIds: [],
    createdProxyKeyIds: [],
    createdChainIds: [],
  };
});

test.afterAll(async ({ request }) => {
  if (!ctx) {
    return;
  }
  await cleanupIds(request, ctx.createdAutomationIds, async (id) => {
    await apiDelete(request, `/api/control/automations/${id}`);
  });
  await cleanupIds(request, ctx.createdMissionIds, async (id) => {
    await apiDelete(request, `/api/control/missions/${id}`);
  });
  await cleanupIds(request, ctx.createdWorkspaceIds, async (id) => {
    await apiDelete(request, `/api/workspaces/${id}`);
  });
  await cleanupIds(request, ctx.createdProxyKeyIds, async (id) => {
    await apiDelete(request, `/api/proxy-keys/${id}`);
  });
  await cleanupIds(request, ctx.createdChainIds, async (id) => {
    await apiDelete(request, `/api/model-routing/chains/${id}`);
  });
});

test("auth and system endpoints respond", async ({ request }) => {
  const suite = requireCtx();
  const healthRes = await request.get(`${suite.baseUrl}/api/health`, {
    failOnStatusCode: false,
  });
  expectStatus(healthRes, [200], "GET /api/health");

  const authStatusRes = await apiGet(request, "/api/auth/status");
  expectStatus(authStatusRes, [200], "GET /api/auth/status");

  const statsRes = await apiGet(request, "/api/stats");
  expectStatus(statsRes, [200], "GET /api/stats");

  const systemRes = await apiGet(request, "/api/system/components");
  expectStatus(systemRes, [200], "GET /api/system/components");

  const settingsRes = await apiGet(request, "/api/settings");
  expectStatus(settingsRes, [200], "GET /api/settings");

  const settingsBackupRes = await apiGet(request, "/api/settings/backup");
  expectStatus(settingsBackupRes, [200], "GET /api/settings/backup");
});

test("settings mutation endpoints respond with exact request shapes", async ({ request }) => {
  const currentSettingsRes = await apiGet(request, "/api/settings");
  const currentSettings = await expectJsonOk<{
    rtk_enabled?: boolean | null;
    max_parallel_missions?: number | null;
    library_remote?: string | null;
    sandboxed_repo_path?: string | null;
  }>(currentSettingsRes, "GET settings before mutation");

  const nextRtk = !(currentSettings.rtk_enabled ?? false);
  expectStatus(
    await apiPut(request, "/api/settings/rtk-enabled", { rtk_enabled: nextRtk }),
    [200],
    "PUT /api/settings/rtk-enabled"
  );
  expectStatus(
    await apiPut(request, "/api/settings", {
      rtk_enabled: currentSettings.rtk_enabled ?? false,
      max_parallel_missions: currentSettings.max_parallel_missions ?? 1,
    }),
    [200],
    "PUT /api/settings"
  );
});

test("backend configuration endpoints respond", async ({ request }) => {
  const suite = requireCtx();
  for (const backendId of suite.backendIds) {
    expectStatus(await apiGet(request, `/api/backends/${backendId}`), [200], `GET /api/backends/${backendId}`);
    expectStatus(
      await apiGet(request, `/api/backends/${backendId}/agents`),
      [200],
      `GET /api/backends/${backendId}/agents`
    );
    expectStatus(
      await apiGet(request, `/api/backends/${backendId}/config`),
      [200, 404],
      `GET /api/backends/${backendId}/config`
    );
  }

  expectStatus(await apiGet(request, "/api/providers"), [200], "GET /api/providers");
  expectStatus(
    await apiGet(request, "/api/providers/backend-models"),
    [200],
    "GET /api/providers/backend-models"
  );
});

test("workspace endpoints support read, exec, and CRUD flows", async ({ request }) => {
  const suite = requireCtx();
  expectStatus(await apiGet(request, "/api/workspaces"), [200], "GET /api/workspaces");
  expectStatus(
    await apiGet(request, `/api/workspaces/${suite.hostWorkspace.id}`),
    [200],
    "GET host workspace"
  );
  expectStatus(
    await apiPost(request, `/api/workspaces/${suite.hostWorkspace.id}/sync`),
    [200],
    "POST host workspace sync"
  );

  const execRes = await apiPost(request, `/api/workspaces/${suite.hostWorkspace.id}/exec`, {
    command: "printf API_E2E_OK",
    timeout_secs: 30,
  });
  const execBody = await expectJsonOk<{ exit_code: number; stdout: string }>(
    execRes,
    "POST host workspace exec"
  );
  expect(execBody.exit_code).toBe(0);
  expect(execBody.stdout).toContain("API_E2E_OK");

  expectStatus(
    await apiGet(request, `/api/workspaces/${suite.hostWorkspace.id}/debug`),
    [200],
    "GET host workspace debug"
  );
  expectStatus(
    await apiGet(request, `/api/workspaces/${suite.hostWorkspace.id}/init-log`),
    [200, 404],
    "GET host workspace init log"
  );
  expectStatus(
    await apiGet(request, `/api/workspaces/${suite.hostWorkspace.id}/memory`),
    [200],
    "GET host workspace memory"
  );
  expectStatus(
    await apiGet(request, "/api/workspaces/memory/all"),
    [200],
    "GET all workspace memory"
  );

  const backendId = suite.backendIds[0];
  expectStatus(
    await apiGet(request, `/api/workspaces/${suite.hostWorkspace.id}/backends/${backendId}/preflight`),
    [200],
    "GET workspace backend preflight"
  );

  const createRes = await apiPost(request, "/api/workspaces", {
    name: `api-e2e-${Date.now()}`,
    workspace_type: "host",
    path: `${suite.hostWorkspace.path}/api-e2e-workspace-${Date.now()}`,
    env_vars: { API_E2E_SAMPLE: "1" },
  });
  const created = await expectJsonOk<Workspace>(createRes, "POST /api/workspaces");
  suite.createdWorkspaceIds.push(created.id);

  expectStatus(
    await apiPut(request, `/api/workspaces/${created.id}`, {
      name: `${created.name}-updated`,
      env_vars: { API_E2E_SAMPLE: "2" },
    }),
    [200],
    "PUT /api/workspaces/:id"
  );
});

test("task endpoints support lifecycle coverage", async ({ request }) => {
  expectStatus(await apiGet(request, "/api/tasks"), [200], "GET /api/tasks");

  const taskRes = await apiPost(request, "/api/task", {
    task: "Return a short status line only.",
    model: "",
  });
  const task = await expectJsonOk<CreateTaskResponse>(taskRes, "POST /api/task");

  expectStatus(await apiGet(request, `/api/task/${task.id}`), [200], "GET /api/task/:id");
  expectStatus(
    await apiGet(request, `/api/task/${task.id}/stream`),
    [200],
    "GET /api/task/:id/stream"
  );
  expectStatus(
    await apiPost(request, `/api/task/${task.id}/stop`, {}),
    [200, 400],
    "POST /api/task/:id/stop"
  );
});

test("mission and automation endpoints support CRUD flows", async ({ request }) => {
  const suite = requireCtx();
  expectStatus(await apiGet(request, "/api/control/missions"), [200], "GET /api/control/missions");
  expectStatus(
    await apiGet(request, "/api/control/missions/current"),
    [200],
    "GET /api/control/missions/current"
  );
  expectStatus(await apiGet(request, "/api/control/tree"), [200], "GET /api/control/tree");
  expectStatus(await apiGet(request, "/api/control/progress"), [200], "GET /api/control/progress");
  expectStatus(await apiGet(request, "/api/control/running"), [200], "GET /api/control/running");
  expectStatus(
    await apiGet(request, "/api/control/parallel/config"),
    [200],
    "GET /api/control/parallel/config"
  );
  expectStatus(await apiGet(request, "/api/control/queue"), [200], "GET /api/control/queue");
  expectStatus(await apiDelete(request, "/api/control/queue"), [200, 204], "DELETE /api/control/queue");
  expectStatus(
    await apiGet(request, "/api/control/diagnostics/opencode"),
    [200, 404, 500],
    "GET /api/control/diagnostics/opencode"
  );

  const backend = suite.backendIds.includes("opencode") ? "opencode" : suite.backendIds[0];
  const missionRes = await apiPost(request, "/api/control/missions", {
    title: `api-e2e-mission-${Date.now()}`,
    workspace_id: suite.hostWorkspace.id,
    backend,
  });
  const mission = await expectJsonOk<Mission>(missionRes, "POST /api/control/missions");
  suite.createdMissionIds.push(mission.id);

  // Fail-fast: reject unknown backend IDs (no aliasing/mapping).
  const badBackendRes = await apiPost(request, "/api/control/missions", {
    title: `api-e2e-mission-bad-backend-${Date.now()}`,
    workspace_id: suite.hostWorkspace.id,
    backend: "google",
  });
  expectStatus(badBackendRes, [400], "POST /api/control/missions (unknown backend)");

  expectStatus(await apiGet(request, `/api/control/missions/${mission.id}`), [200], "GET mission");
  expectStatus(
    await apiPost(request, `/api/control/missions/${mission.id}/load`, {}),
    [200],
    "POST mission load"
  );
  expectStatus(
    await apiGet(request, `/api/control/missions/${mission.id}/tree`),
    [200],
    "GET mission tree"
  );
  expectStatus(
    await apiGet(request, `/api/control/missions/${mission.id}/events?limit=20&offset=0`),
    [200],
    "GET mission events"
  );
  expectStatus(
    await apiPost(request, `/api/control/missions/${mission.id}/status`, { status: "completed" }),
    [200],
    "POST mission status"
  );
  expectStatus(
    await apiPost(request, `/api/control/missions/${mission.id}/title`, { title: "API E2E Mission" }),
    [200],
    "POST mission title"
  );
  expectStatus(
    await apiGet(request, "/api/control/missions/search?q=api-e2e"),
    [200],
    "GET mission search"
  );
  expectStatus(
    await apiGet(request, "/api/control/missions/search/moments?q=api-e2e"),
    [200],
    "GET mission moments search"
  );

  const automationRes = await apiPost(request, `/api/control/missions/${mission.id}/automations`, {
    command_source: {
      type: "inline",
      content: "echo api-e2e",
    },
    trigger: {
      type: "interval",
      seconds: 300,
    },
  });
  const automation = await expectJsonOk<Automation>(
    automationRes,
    "POST /api/control/missions/:id/automations"
  );
  suite.createdAutomationIds.push(automation.id);

  expectStatus(
    await apiGet(request, `/api/control/missions/${mission.id}/automations`),
    [200],
    "GET mission automations"
  );
  expectStatus(await apiGet(request, "/api/control/automations"), [200], "GET active automations");
  expectStatus(
    await apiGet(request, `/api/control/automations/${automation.id}`),
    [200],
    "GET automation"
  );
  expectStatus(
    await apiPatch(request, `/api/control/automations/${automation.id}`, { active: false }),
    [200],
    "PATCH automation"
  );
  expectStatus(
    await apiGet(request, `/api/control/automations/${automation.id}/executions`),
    [200],
    "GET automation executions"
  );
  expectStatus(
    await apiGet(request, `/api/control/missions/${mission.id}/automation-executions`),
    [200],
    "GET mission automation executions"
  );
  expectStatus(
    await apiPost(request, "/api/control/missions/cleanup", {}),
    [200],
    "POST mission cleanup"
  );
});

test("desktop session endpoints respond", async ({ request }) => {
  expectStatus(await apiGet(request, "/api/desktop/sessions"), [200], "GET /api/desktop/sessions");
  expectStatus(
    await apiPost(request, "/api/desktop/sessions/cleanup", {}),
    [200],
    "POST /api/desktop/sessions/cleanup"
  );
  expectStatus(
    await apiPost(request, "/api/desktop/sessions/cleanup-stopped", {}),
    [200],
    "POST /api/desktop/sessions/cleanup-stopped"
  );
  expectStatus(
    await apiPost(request, "/api/desktop/sessions/999/keep-alive", { extension_secs: 60 }),
    [404],
    "POST /api/desktop/sessions/:display/keep-alive"
  );
  expectStatus(
    await apiPost(request, "/api/desktop/sessions/999/close", {}),
    [200, 500],
    "POST /api/desktop/sessions/:display/close"
  );
});

test("library, MCP, secrets, and config endpoints respond", async ({ request }) => {
  const getOnlyPaths = [
    "/api/library/status",
    "/api/library/skill",
    "/api/library/skills",
    "/api/library/command",
    "/api/library/commands",
    "/api/library/builtin-commands",
    "/api/library/agent",
    "/api/library/workspace-template",
    "/api/library/init-script",
    "/api/library/config-profile",
    "/api/library/opencode/settings",
    "/api/library/sandboxed-sh/config",
    "/api/library/sandboxed-sh/agents",
    "/api/library/claudecode/config",
    "/api/library/mcps",
    "/api/mcp",
    "/api/tools",
    "/api/secrets/status",
    "/api/secrets/encryption",
    "/api/secrets/registries",
    "/api/opencode/agents",
    "/api/opencode/settings",
    "/api/opencode/config",
    "/api/claudecode/config",
    "/api/amp/config",
  ];

  for (const path of getOnlyPaths) {
    expectStatus(await apiGet(request, path), [200], `GET ${path}`);
  }
});

test("library content endpoints support CRUD flows", async ({ request }) => {
  const suffix = `${Date.now()}`;
  const skillName = `api-e2e-skill-${suffix}`;
  const commandName = `api-e2e-command-${suffix}`;
  const initScriptName = `api-e2e-init-${suffix}`;
  const templateName = `api-e2e-template-${suffix}`;
  const profileName = `api-e2e-profile-${suffix}`;

  expectStatus(
    await apiPut(request, `/api/library/skill/${skillName}`, {
      content: `---\ndescription: API E2E skill\n---\n# ${skillName}\n`,
    }),
    [200],
    "PUT /api/library/skill/:name"
  );
  expectStatus(await apiGet(request, `/api/library/skill/${skillName}`), [200], "GET created skill");
  expectStatus(
    await apiPut(request, `/api/library/skill/${skillName}/files/notes.md`, {
      content: "api-e2e reference",
    }),
    [200],
    "PUT /api/library/skill/:name/files/*path"
  );
  expectStatus(
    await apiGet(request, `/api/library/skill/${skillName}/files/notes.md`),
    [200],
    "GET skill reference"
  );
  expectStatus(
    await apiDelete(request, `/api/library/skill/${skillName}/files/notes.md`),
    [200],
    "DELETE skill reference"
  );

  expectStatus(
    await apiPut(request, `/api/library/command/${commandName}`, {
      content: "echo api-e2e-command",
    }),
    [200],
    "PUT /api/library/command/:name"
  );
  expectStatus(
    await apiGet(request, `/api/library/command/${commandName}`),
    [200],
    "GET created command"
  );

  expectStatus(
    await apiPut(request, `/api/library/init-script/${initScriptName}`, {
      content: "#!/bin/bash\necho api-e2e-init\n",
    }),
    [200],
    "PUT /api/library/init-script/:name"
  );
  expectStatus(
    await apiGet(request, `/api/library/init-script/${initScriptName}`),
    [200],
    "GET created init script"
  );

  expectStatus(
    await apiPut(request, `/api/library/workspace-template/${templateName}`, {
      description: "API E2E template",
      distro: "ubuntu-noble",
      skills: [],
      env_vars: { API_E2E_TEMPLATE: "1" },
      init_scripts: [],
      init_script: "",
      mcps: [],
    }),
    [200],
    "PUT /api/library/workspace-template/:name"
  );
  expectStatus(
    await apiGet(request, `/api/library/workspace-template/${templateName}`),
    [200],
    "GET created workspace template"
  );

  const createProfileRes = await apiPost(request, "/api/library/config-profile", {
    name: profileName,
  });
  expectStatus(createProfileRes, [200], "POST /api/library/config-profile");
  expectStatus(
    await apiGet(request, `/api/library/config-profile/${profileName}`),
    [200],
    "GET created config profile"
  );
  expectStatus(
    await apiPut(request, `/api/library/config-profile/${profileName}/opencode/settings`, {
      model: "builtin/smart",
    }),
    [200],
    "PUT profile opencode settings"
  );
  expectStatus(
    await apiGet(request, `/api/library/config-profile/${profileName}/opencode/settings`),
    [200],
    "GET profile opencode settings"
  );
  expectStatus(
    await apiPutText(
      request,
      `/api/library/config-profile/${profileName}/file/custom.txt`,
      "api-e2e-profile-file"
    ),
    [200],
    "PUT profile file"
  );
  expectStatus(
    await apiGet(request, `/api/library/config-profile/${profileName}/files`),
    [200],
    "GET profile file list"
  );
  expectStatus(
    await apiGet(request, `/api/library/config-profile/${profileName}/file/custom.txt`),
    [200],
    "GET profile file"
  );
  expectStatus(
    await apiDelete(request, `/api/library/config-profile/${profileName}/file/custom.txt`),
    [200],
    "DELETE profile file"
  );

  expectStatus(
    await apiGet(request, "/api/library/harness-default/opencode"),
    [200],
    "GET harness default file list"
  );
  expectStatus(
    await apiGet(request, "/api/library/skill/registry/search?q=react"),
    [200],
    "GET skill registry search"
  );

  expectStatus(await apiDelete(request, `/api/library/skill/${skillName}`), [200], "DELETE skill");
  expectStatus(
    await apiDelete(request, `/api/library/command/${commandName}`),
    [200],
    "DELETE command"
  );
  expectStatus(
    await apiDelete(request, `/api/library/init-script/${initScriptName}`),
    [200],
    "DELETE init script"
  );
  expectStatus(
    await apiDelete(request, `/api/library/workspace-template/${templateName}`),
    [200],
    "DELETE workspace template"
  );
  expectStatus(
    await apiDelete(request, `/api/library/config-profile/${profileName}`),
    [200],
    "DELETE config profile"
  );
});

test("filesystem endpoints support exact CRUD flows", async ({ request }) => {
  const suite = requireCtx();
  const dirPath = `/tmp/api-e2e-fs-${Date.now()}`;
  const filePath = `${dirPath}/hello.txt`;
  const chunkFilePath = `${dirPath}/chunked.txt`;
  const uploadId = `api-e2e-${Date.now()}`;

  expectStatus(await apiPost(request, "/api/fs/mkdir", { path: dirPath }), [200], "POST /api/fs/mkdir");
  expectStatus(
    await apiGet(request, `/api/fs/list?path=${encodeURIComponent(dirPath)}`),
    [200],
    "GET /api/fs/list"
  );

  const uploadRes = await request.post(`${suite.baseUrl}/api/fs/upload?path=${encodeURIComponent(dirPath)}`, {
    headers: suite.headers,
    multipart: {
      file: {
        name: "hello.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("api-e2e-upload"),
      },
    },
    failOnStatusCode: false,
  });
  expectStatus(uploadRes, [200], "POST /api/fs/upload");

  expectStatus(
    await apiGet(request, `/api/fs/validate?path=${encodeURIComponent(filePath)}`),
    [200],
    "GET /api/fs/validate"
  );
  expectStatus(
    await apiGet(request, `/api/fs/download?path=${encodeURIComponent(filePath)}`),
    [200],
    "GET /api/fs/download"
  );

  const uploadChunkRes = await request.post(
    `${suite.baseUrl}/api/fs/upload-chunk?path=${encodeURIComponent(dirPath)}&upload_id=${encodeURIComponent(uploadId)}&chunk_index=0&total_chunks=1`,
    {
      headers: suite.headers,
      multipart: {
        file: {
          name: "chunk",
          mimeType: "text/plain",
          buffer: Buffer.from("chunked-content"),
        },
      },
      failOnStatusCode: false,
    }
  );
  expectStatus(uploadChunkRes, [200], "POST /api/fs/upload-chunk");

  expectStatus(
    await apiPost(request, "/api/fs/upload-finalize", {
      path: dirPath,
      upload_id: uploadId,
      file_name: "chunked.txt",
      total_chunks: 1,
    }),
    [200],
    "POST /api/fs/upload-finalize"
  );
  expectStatus(
    await apiGet(request, `/api/fs/download?path=${encodeURIComponent(chunkFilePath)}`),
    [200],
    "GET downloaded chunked file"
  );

  expectStatus(await apiPost(request, "/api/fs/rm", { path: filePath }), [200], "POST /api/fs/rm file");
  expectStatus(
    await apiPost(request, "/api/fs/rm", { path: dirPath, recursive: true }),
    [200],
    "POST /api/fs/rm recursive"
  );
});

test("proxy key and model routing endpoints support CRUD flows", async ({ request }) => {
  const suite = requireCtx();
  expectStatus(await apiGet(request, "/api/proxy-keys"), [200], "GET /api/proxy-keys");

  const keyRes = await apiPost(request, "/api/proxy-keys", {
    name: `api-e2e-key-${Date.now()}`,
  });
  expectStatus(keyRes, [201], "POST /api/proxy-keys");
  const key = (await parseJson<ProxyKey>(keyRes))!;
  suite.createdProxyKeyIds.push(key.id);

  expectStatus(await apiGet(request, "/api/model-routing/chains"), [200], "GET model chains");
  expectStatus(await apiGet(request, "/api/model-routing/health"), [200], "GET model routing health");
  expectStatus(await apiGet(request, "/api/model-routing/events"), [200], "GET model routing events");
  expectStatus(await apiGet(request, "/api/model-routing/rtk-stats"), [200], "GET model routing rtk stats");

  const chainId = `api-e2e-${Date.now()}`;
  const chainRes = await apiPost(request, "/api/model-routing/chains", {
    id: chainId,
    name: "API E2E Chain",
    entries: [
      {
        provider_id: "example-provider",
        model_id: "example-model",
      },
    ],
  });
  const chain = await expectJsonOk<Chain>(chainRes, "POST /api/model-routing/chains");
  suite.createdChainIds.push(chain.id);

  expectStatus(
    await apiGet(request, `/api/model-routing/chains/${chain.id}`),
    [200],
    "GET model routing chain"
  );
  expectStatus(
    await apiGet(request, `/api/model-routing/chains/${chain.id}/resolve`),
    [200],
    "GET model routing chain resolve"
  );
  expectStatus(
    await apiPut(request, `/api/model-routing/chains/${chain.id}`, {
      name: "API E2E Chain Updated",
      entries: [
        {
          provider_id: "example-provider-2",
          model_id: "example-model-2",
        },
      ],
    }),
    [200],
    "PUT model routing chain"
  );
  expectStatus(
    await apiGet(request, "/api/model-routing/health/unknown-account"),
    [400, 404],
    "GET model routing account health missing"
  );
  expectStatus(
    await apiPost(request, "/api/model-routing/health/unknown-account/clear", {}),
    [400, 404],
    "POST model routing clear cooldown missing"
  );
});

test("miscellaneous API collections respond", async ({ request }) => {
  expectStatus(await apiGet(request, "/api/runs"), [200], "GET /api/runs");
  expectStatus(await apiGet(request, "/api/memory/search?q=test"), [200], "GET /api/memory/search");
});

test("optional destructive endpoints can be enabled explicitly", async ({ request }) => {
  test.skip(
    !runOptionalMutations,
    "Set E2E_API_RUN_OPTIONAL_MUTATIONS=1 to exercise mutation-heavy optional endpoints."
  );

  expectStatus(await apiPost(request, "/api/library/sync", {}), [200], "POST /api/library/sync");
  expectStatus(await apiPost(request, "/api/mcp/refresh", {}), [200], "POST /api/mcp/refresh");
  expectStatus(await apiPost(request, "/api/opencode/restart", {}), [200, 500], "POST /api/opencode/restart");
});
