import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type CspDirectives = Record<string, string | string[]>;

function productionCsp(): CspDirectives {
  const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const csp = config.app?.security?.csp;

  if (typeof csp === 'string') {
    return Object.fromEntries(
      csp
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [directive, ...sources] = part.split(/\s+/);
          return [directive, sources];
        })
    );
  }

  return csp;
}

function devCsp(): CspDirectives {
  const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  return config.app?.security?.devCsp;
}

function policyString(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([directive, sources]) => {
      const list = Array.isArray(sources) ? sources.join(' ') : sources;
      return `${directive} ${list}`;
    })
    .join('; ');
}

test('the production CSP stops injected script, handlers, frames and javascript: URLs', async ({
  page,
}) => {
  const csp = policyString(productionCsp());
  const html = `<!doctype html>
<html>
  <head><title>csp probe</title></head>
  <body>
    <script>window.__inlineScriptRan = true;</script>
    <img id="evil-img" src="http://127.0.0.1:9/pixel.png" onerror="window.__onerrorRan = true" />
    <iframe id="evil-frame" src="https://example.com/"></iframe>
    <a id="evil-link" href="javascript:window.__javascriptUrlRan = true">click</a>
  </body>
</html>`;

  // Tauri injects the policy as a response header; a routed navigation keeps
  // that shape and, unlike setContent, lets init scripts run before the HTML.
  await page.route('http://csp-probe.test/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'content-security-policy': csp },
      body: html,
    })
  );
  await page.route('http://127.0.0.1:9/**', (route) => route.abort());
  await page.route('https://example.com/**', (route) => route.abort());

  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        event.effectiveDirective
      );
    });
  });

  await page.goto('http://csp-probe.test/');
  await page.click('#evil-link');
  await page.waitForTimeout(100);

  const state = await page.evaluate(() => {
    const probe = window as unknown as Record<string, unknown> & { __cspViolations: string[] };
    return {
      inline: probe.__inlineScriptRan,
      onerror: probe.__onerrorRan,
      javascriptUrl: probe.__javascriptUrlRan,
      violations: probe.__cspViolations,
    };
  });

  expect(state.inline).toBeUndefined();
  expect(state.onerror).toBeUndefined();
  expect(state.javascriptUrl).toBeUndefined();
  // Chromium reports the element/attribute subdirectives; both fall back to script-src.
  const effective = state.violations.map((directive) => directive.replace(/-(elem|attr)$/, ''));
  expect(effective).toContain('script-src');
  expect(effective).toContain('img-src');
  expect(effective).toContain('frame-src');
});

test('the Vite dev server serves devCsp and the app runs under it', async ({ page, request }) => {
  // Tauri only injects CSP for its own asset protocol; with a devUrl the
  // document must carry the policy or dev silently skips CSP.
  const response = await request.get('/');
  expect(response.headers()['content-security-policy']).toBe(policyString(devCsp()));

  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        event.effectiveDirective
      );
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'beadazzled' })).toBeVisible();

  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations
  );
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
