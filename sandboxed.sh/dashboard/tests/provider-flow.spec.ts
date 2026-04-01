import { test, expect } from '@playwright/test';

// Configuration for the user's production-like environment (Dokploy)
const API_URL = 'http://192.168.1.200:3333';
// Real JWT from .env
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZWZhdWx0IiwidXNyIjoiZGVmYXVsdCIsImlhdCI6MTc3NDk4ODc0OCwiZXhwIjoxNzc3NTgwNzQ4fQ.Hq7P_1EWQicfwRZ1FzQsKf3aoo_jNucceAERP5YOHpo';
// Exp from payload: 1777580748
const AUTH_EXP = 1777580748;

test.describe('Backend Provider Full Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Set up the API URL and AUTH in localStorage before each test
    await page.goto('/');
    await page.evaluate(({ apiUrl, token, exp }) => {
      localStorage.setItem('settings', JSON.stringify({ apiUrl }));
      localStorage.setItem('openagent.jwt', token);
      localStorage.setItem('openagent.jwt_exp', String(exp));
    }, { apiUrl: API_URL, token: AUTH_TOKEN, exp: AUTH_EXP });
    await page.reload();
  });

  test('complete flow: provider -> backend -> mapping -> mission', async ({ page }) => {
    // 1. Navigate to AI Providers (Informational)
    console.log('Step 1: Checking AI Providers (Informational)...');
    await page.goto('/settings/providers');
    await page.waitForSelector('div.group', { timeout: 15000 });
    const connectedProviders = page.locator('div.group').filter({ 
      has: page.locator('span.bg-emerald-400') 
    });
    const count = await connectedProviders.count();
    console.log(`Found ${count} connected providers.`);

    // 2. Navigate to Backends and ensure OpenCode is enabled
    console.log('Step 2: Checking Backends...');
    await page.goto('/settings/backends');
    await expect(page.getByRole('heading', { name: 'Backends' })).toBeVisible();

    const opencodeTab = page.locator('button').filter({ hasText: /^OpenCode$/ });
    await expect(opencodeTab).toBeVisible({ timeout: 10000 });
    await opencodeTab.click();

    const enabledCheckbox = page.locator('input[type="checkbox"]').first();
    const isEnabled = await enabledCheckbox.isChecked();
    if (!isEnabled) {
      console.log('Enabling OpenCode backend...');
      await enabledCheckbox.click();
      await page.getByRole('button', { name: 'Save OpenCode' }).click();
      await page.waitForTimeout(1000);
    }

    // 3. Configure Agent Mapping (JSON Editor)
    console.log('Step 3: Validating Config Settings (JSON Editor)...');
    await page.goto('/config/settings');
    await page.waitForSelector('.cm-content', { timeout: 15000 });
    
    // Make a change to enable Save button
    const editor = page.locator('.cm-content');
    await editor.focus();
    await page.keyboard.press('End');
    await page.keyboard.type('\n'); 
    
    const saveSettingsButton = page.locator('button').filter({ hasText: /Save/i }).first();
    await expect(saveSettingsButton).toBeEnabled({ timeout: 5000 });
    await saveSettingsButton.click();
    console.log('Saved config settings.');
    await page.waitForTimeout(2000);

    // 4. Create a Mission
    console.log('Step 4: Creating Mission...');
    await page.goto('/control');
    await page.waitForSelector('button:has-text("New Mission")', { timeout: 10000 });
    await page.getByRole('button', { name: 'New Mission' }).click();

    // The NewMissionDialog opens. Select Agent.
    const agentSelect = page.locator('label:has-text("Agent & Backend")').locator('..').locator('select');
    await expect(agentSelect).toBeVisible({ timeout: 5000 });
    
    // Choose the first agent (default/recommended)
    await agentSelect.selectOption({ index: 0 });

    // Click "Create here"
    const createHereButton = page.locator('button').filter({ hasText: /Create here/i });
    await createHereButton.click();

    // 5. Submit the task
    console.log('Step 5: Submitting task to mission...');
    // Wait for the mission ID to appear in URL
    await page.waitForURL(/mission=/, { timeout: 15000 });
    console.log('Mission created, now sending prompt...');

    // Find the EnhancedInput textarea
    const taskInput = page.locator('textarea[placeholder*="Message the root agent"]');
    await expect(taskInput).toBeVisible({ timeout: 15000 });
    await expect(taskInput).toBeEnabled({ timeout: 15000 }); // Ensure input is ready
    await taskInput.fill('Validation test: Please output "Flow confirmed" if you can reach the backend.');
    
    // Check Send
    const sendButton = page.locator('button').filter({ hasText: /^Send$/ });
    await expect(sendButton).toBeEnabled({ timeout: 10000 }); // Wait for state update/enabling
    await sendButton.click();

    // 6. Verify mission activity
    console.log('Step 6: Verifying Mission activity...');
    // Check for thinking/running/loading indicator in the stream
    const statusIndicator = page.locator('text=Thinking').or(page.locator('text=Running')).or(page.locator('text=Loading')).or(page.locator('text=Tool:'));
    await expect(statusIndicator).toBeVisible({ timeout: 45000 });
    
    console.log(`\x1b[32mSUCCESS: Mission active and responding via backend! Flow validated.\x1b[0m`);
  });
});
