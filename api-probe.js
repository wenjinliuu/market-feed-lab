'use strict';
const fs = require('node:fs/promises');
const report = { runId: process.env.GITHUB_RUN_ID || null, startedAt: new Date().toISOString(), stage: 'start', results: [] };
const base = 'https://api.lxaa.top';
const keys = x => x && typeof x === 'object' ? Object.keys(x).slice(0, 80) : [];

async function api(route, body, token) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: abort.signal
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  } finally { clearTimeout(timer); }
}

async function pdfSample(file) {
  if (typeof file !== 'string' || !file) return { fileFound: false };
  let url;
  try { url = new URL(file, base); } catch { return { fileFound: true, tested: false }; }
  if (url.protocol !== 'https:') return { fileFound: true, tested: false };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    // Never send the member token to file storage; never save the URL or PDF bytes.
    const response = await fetch(url, { headers: { range: 'bytes=0-4' }, signal: abort.signal });
    const reader = response.body?.getReader();
    const chunk = reader ? await reader.read() : {};
    await reader?.cancel().catch(() => {});
    return { fileFound: true, tested: true, status: response.status,
      contentType: response.headers.get('content-type')?.split(';')[0] || '',
      pdfMagic: chunk.value ? Buffer.from(chunk.value).subarray(0, 5).toString() === '%PDF-' : false,
      origin: new URL(response.url).origin };
  } catch { return { fileFound: true, tested: true, error: 'file fetch failed or timed out' }; }
  finally { clearTimeout(timer); }
}

async function main() {
  const phone = process.env.TA_USERNAME, password = process.env.TA_PASSWORD;
  if (!phone || !password) throw Error('Missing GitHub Secrets');
  report.stage = 'login';
  const login = await api('/api/v1/auth/login/password', { phone, password });
  report.results.push({ route: '/auth/login/password', status: login.status,
    success: login.data?.success === true, dataKeys: keys(login.data?.data) });
  const token = login.data?.data?.access_token;
  if (login.status !== 200 || login.data?.success !== true || typeof token !== 'string' || !token)
    throw Error('Login failed or token absent');

  report.stage = 'member';
  const member = await api('/api/v1/auth/member', undefined, token);
  report.results.push({ route: '/auth/member', status: member.status, success: member.data?.success === true });
  if (member.status !== 200 || member.data?.success !== true) throw Error('Member verification failed');

  report.stage = 'news';
  const news = await api('/api/v1/news/search', { page: 1, page_size: 15 }, token);
  const newsList = news.data?.data?.news_list, first = Array.isArray(newsList) ? newsList[0] : null;
  report.results.push({ route: '/news/search', status: news.status, success: news.data?.success === true,
    count: Array.isArray(newsList) ? newsList.length : null, itemKeys: keys(first),
    paginationKeys: keys(news.data?.data?.pagination),
    firstMetadata: first ? { id: first.id, datetime: first.datetime, level: first.level,
      source: first.source, category: first.category, contentLength: first.content?.length } : null });
  if (news.status !== 200 || news.data?.success !== true || !Array.isArray(newsList))
    throw Error('Authenticated news unavailable');

  report.stage = 'research';
  const research = await api('/api/v1/research-reports/search',
    { language: 'cn', page: 1, page_size: 10, recommend: false }, token);
  const list = research.data?.data?.report_list, item = Array.isArray(list) ? list[0] : null;
  report.results.push({ route: '/research-reports/search', status: research.status,
    success: research.data?.success === true, count: Array.isArray(list) ? list.length : null,
    itemKeys: keys(item), paginationKeys: keys(research.data?.data?.pagination) });
  report.stage = 'pdf';
  report.pdf = research.status === 200 && research.data?.success === true
    ? await pdfSample(item?.file_cn || item?.file_en) : { fileFound: false };
  report.stage = 'complete';
}

(async () => {
  try { await main(); }
  catch (e) {
    report.error = ['Missing GitHub Secrets', 'Login failed or token absent', 'Member verification failed',
      'Authenticated news unavailable'].includes(e.message) ? e.message : 'Request failed at ' + report.stage;
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.mkdir('diagnostic', { recursive: true });
    await fs.writeFile('diagnostic/report.json', JSON.stringify(report, null, 2));
    console.log(`API probe: ${report.stage}; results: ${report.results.length}`);
  }
})();
