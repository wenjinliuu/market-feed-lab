'use strict';

const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const OUT = path.join(process.cwd(), 'diagnostic');
const report = { startedAt: new Date().toISOString(), runId: process.env.GITHUB_RUN_ID || null,
  stage: 'start', observations: [], errors: [] };
let collecting = false;
let browser;

function safeUrl(raw) {
  try { const u = new URL(raw); return `${u.origin}${u.pathname}`; }
  catch { return '[unparseable URL]'; }
}

function shape(v, depth = 0) {
  if (depth > 5) return '...';
  if (Array.isArray(v)) return { type: 'array', length: v.length, first: v.length ? shape(v[0], depth + 1) : null };
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 80)
    .filter(([k]) => !/password|secret|token|cookie|session|authorization|credential|phone|mobile|email|key/i.test(k))
    .map(([k, val]) => [k, shape(val, depth + 1)]));
  return v === null ? 'null' : typeof v;
}

async function enableSemantics(page) {
  try { await page.locator('flt-semantics-placeholder').click({ timeout: 2000 }); }
  catch { /* Already enabled or not present. */ }
}

async function login(page) {
  if (!process.env.TA_USERNAME || !process.env.TA_PASSWORD) throw new Error('Missing TA_USERNAME or TA_PASSWORD repository secret');
  report.stage = 'login';
  await enableSemantics(page);
  const skipGift = page.getByText('暂不领取，先看看', { exact: true });
  if (await skipGift.count()) await skipGift.first().click();
  else {
    // Flutter canvas may not expose the gift sheet through DOM semantics.
    // Its skip control was observed at the bottom center of a 1280x720 viewport.
    await page.mouse.click(640, 679);
    await page.waitForTimeout(500);
  }
  await enableSemantics(page);
  report.stage = 'login_entry';
  const loginButton = page.getByRole('button', { name: /登录|注册/ });
  if (await loginButton.count()) await loginButton.first().click();
  else {
    const loginText = page.getByText(/登录并升级会员|登录\/注册/).first();
    if (await loginText.count()) await loginText.click();
  }
  const passwordMode = page.getByText('密码登录', { exact: true });
  if (await passwordMode.count()) await passwordMode.first().click();

  const password = page.locator('input[type="password"]');
  await password.first().waitFor({ state: 'visible', timeout: 15000 });
  const username = page.locator('input[type="text"], input[type="tel"], input:not([type])').filter({ visible: true });
  if (!(await username.count())) throw new Error('Username input not found; inspect diagnostic screenshot to adjust Flutter login selector');
  await username.first().fill(process.env.TA_USERNAME);
  await password.first().fill(process.env.TA_PASSWORD);
  const submit = page.getByRole('button', { name: /登录|登 录|立即登录/ });
  if (await submit.count()) await submit.first().click();
  else await password.first().press('Enter');
  await page.getByRole('button', { name: '快讯监控' }).waitFor({ state: 'visible', timeout: 25000 });
  report.login = 'success';
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('response', async response => {
    if (!collecting) return;
    const request = response.request();
    const type = response.headers()['content-type'] || '';
    if (!['fetch', 'xhr', 'eventsource'].includes(request.resourceType()) && !/json|pdf|event-stream/i.test(type)) return;
    const entry = { kind: 'http', url: safeUrl(response.url()), method: request.method(),
      status: response.status(), resourceType: request.resourceType(), contentType: type };
    if (/json/i.test(type)) {
      try { const body = await response.body(); entry.bytes = body.length;
        if (body.length < 1_000_000) entry.shape = shape(JSON.parse(body.toString('utf8')));
      } catch { entry.body = 'not JSON or unreadable'; }
    }
    report.observations.push(entry);
  });
  page.on('websocket', ws => {
    if (!collecting) return;
    const entry = { kind: 'websocket', url: safeUrl(ws.url()), received: [], sent: [] };
    report.observations.push(entry);
    for (const [event, list] of [['framereceived', entry.received], ['framesent', entry.sent]]) {
      ws.on(event, frame => {
        if (list.length >= 10) return;
        const raw = frame.payload;
        const value = { bytes: typeof raw === 'string' ? Buffer.byteLength(raw) : raw.length };
        if (typeof raw === 'string' && raw.length < 1_000_000) {
          try { value.shape = shape(JSON.parse(raw)); } catch { value.shape = 'non-JSON text'; }
        }
        list.push(value);
      });
    }
  });
  page.on('download', async download => {
    if (!collecting) return;
    const filename = path.join(OUT, 'sample.pdf');
    try {
      await download.saveAs(filename);
      const bytes = await fs.readFile(filename);
      report.download = { observed: true, bytes: bytes.length,
        pdfMagic: bytes.subarray(0, 5).toString() === '%PDF-', sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
      await fs.unlink(filename); // The report records successful bytes, not the copyrighted PDF.
    } catch (error) { report.download = { observed: false, error: String(error) }; }
  });

  report.stage = 'open_site';
  await page.goto('https://alpha.lxaa.top/#/home', { waitUntil: 'domcontentloaded', timeout: 30000 }); // Clean URL, no referral.
  await login(page);
  collecting = true;
  report.stage = 'news';
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);
  await enableSemantics(page);
  report.newsVisible = await page.getByText('实时更新中').count() > 0;
  report.stage = 'report_pdf';
  await page.getByRole('button', { name: '投研' }).click({ timeout: 10000 });
  await page.getByRole('button', { name: '研报精选' }).click({ timeout: 10000 });
  await page.getByRole('button', { name: '原文' }).first().click({ timeout: 15000 });
  await page.getByRole('button', { name: '下载PDF' }).click({ timeout: 20000 });
  await page.waitForTimeout(5000);
  report.stage = 'complete';
}

(async () => {
  try { await main(); }
  catch (error) {
    report.errors.push(`${report.stage}: ${error.message}`);
    try { const page = browser?.contexts()[0]?.pages()[0];
      if (page) {
        report.visibleInputs = await page.locator('input').evaluateAll(els => els.map(e => ({type:e.type, placeholder:e.placeholder}))).catch(() => []);
        report.visibleButtons = (await page.getByRole('button').allTextContents().catch(() => [])).slice(0, 30);
        await page.screenshot({ path: path.join(OUT, 'failure.png') });
      }
    } catch { /* Ignore screenshot failure. */ }
    process.exitCode = 1;
  } finally {
    collecting = false;
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(OUT, { recursive: true });
    await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    console.log(`Probe stage: ${report.stage}; observations: ${report.observations.length}; errors: ${report.errors.length}`);
  }
})();
