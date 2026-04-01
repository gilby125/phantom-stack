import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

export type ApiTestConfig = {
  baseUrl: string;
  password?: string;
  username?: string;
};

const DEFAULT_API_BASE = "http://192.168.1.200:3333";

export function getApiTestConfig(): ApiTestConfig {
  const baseUrl =
    process.env.E2E_API_BASE ||
    process.env.OPEN_AGENT_API_BASE ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_API_BASE;

  if (baseUrl !== DEFAULT_API_BASE && !process.env.E2E_API_BASE && !process.env.OPEN_AGENT_API_BASE && !process.env.NEXT_PUBLIC_API_URL) {
    throw new Error(`Unexpected API base resolution: ${baseUrl}`);
  }

  return {
    baseUrl,
    password:
      process.env.E2E_API_PASSWORD ||
      process.env.SANDBOXED_DASHBOARD_PASSWORD ||
      process.env.OPEN_AGENT_API_PASSWORD,
    username: process.env.E2E_API_USERNAME || process.env.OPEN_AGENT_API_USERNAME,
  };
}

export async function getAuthHeaders(
  request: APIRequestContext,
  config = getApiTestConfig()
): Promise<Record<string, string>> {
  if (!config.password) {
    throw new Error(
      "Missing API password. Set E2E_API_PASSWORD or SANDBOXED_DASHBOARD_PASSWORD for authenticated E2E API tests."
    );
  }

  const response = await request.post(`${config.baseUrl}/api/auth/login`, {
    data: {
      password: config.password,
      ...(config.username ? { username: config.username } : {}),
    },
    failOnStatusCode: false,
  });

  const body = await parseJson<{ token?: string; error?: string }>(response);
  if (!response.ok() || !body?.token) {
    throw new Error(
      `Login failed against ${config.baseUrl}: ${response.status()} ${await response.text()}`
    );
  }

  return {
    Authorization: `Bearer ${body.token}`,
  };
}

export async function parseJson<T>(response: APIResponse): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as T;
}

export function expectStatus(response: APIResponse, allowed: number[], label: string): void {
  expect(
    allowed,
    `${label} returned ${response.status()} (${response.statusText()})`
  ).toContain(response.status());
}

export async function expectJsonOk<T>(response: APIResponse, label: string): Promise<T> {
  expect(response.ok(), `${label} failed with ${response.status()} ${await response.text()}`).toBe(
    true
  );
  return (await response.json()) as T;
}
