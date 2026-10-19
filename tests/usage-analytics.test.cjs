const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, customRequire = require) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(code, { exports, require: customRequire });
  return exports;
}
const { getUsagePeriod, aggregateUsage, sortUsage, getUsageSort, usageSortColumns } = load('lib/usage-analytics.ts');

test('periods respect Japan midnight, month/year boundaries and inclusive last 30 days', () => {
  const now = new Date('2026-12-31T15:01:00Z');
  const month = getUsagePeriod({}, now);
  assert.equal(month.start, '2027-01-01');
  assert.equal(month.from, '2026-12-31T15:00:00.000Z');
  assert.equal(month.until, '2027-01-01T15:00:00.000Z');
  const previous = getUsagePeriod({ period: 'previous' }, now);
  assert.equal(previous.start, '2026-12-01');
  assert.equal(previous.end, '2026-12-31');
  assert.equal(getUsagePeriod({ period: '30days' }, now).start, '2026-12-03');
  assert.equal(getUsagePeriod({ period: 'previous' }, new Date('2024-03-15T00:00:00Z')).end, '2024-02-29');
});

test('custom ranges reject impossible dates, reversed ranges and multiple query values', () => {
  for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-03-02', '2026-03-01'], [['2026-03-01'], '2026-03-02'], ['bad', '2026-03-02']]) {
    assert.throws(() => getUsagePeriod({ period: 'custom', start, end }));
  }
  const range = getUsagePeriod({ period: 'custom', start: '2026-10-01', end: '2026-10-01' });
  assert.equal(range.from, '2026-09-30T15:00:00.000Z');
  assert.equal(range.until, '2026-10-01T15:00:00.000Z');
});

test('aggregation includes zero-use members and excludes admins from all metrics', () => {
  const members = [
    { id: 'a', email: 'a@example.com', display_name: 'A' },
    { id: 'b', email: 'admin@example.com', display_name: 'Admin' },
    { id: 'c', email: 'c@example.com', display_name: null }
  ];
  const period = getUsagePeriod({ period: 'custom', start: '2026-10-01', end: '2026-10-02' });
  const interview = (status, started_at, duration_seconds, member_id = 'a') => ({ member_id, status, started_at, duration_seconds });
  const interviews = [
    interview('completed', '2026-09-30T14:59:59Z', 999), // outside
    interview('completed', '2026-09-30T15:00:00Z', 120),
    interview('interrupted', '2026-10-01T01:00:00Z', 0), // same Japan date; zero is recorded
    interview('in_progress', '2026-10-01T16:00:00Z', 999), // unconfirmed; no duration included
    interview('completed', '2026-10-02T01:00:00Z', null),
    interview('preparing', '2026-10-02T02:00:00Z', 999),
    interview('completed', '2026-10-02T15:00:00Z', 888), // outside, but last use
    interview('completed', '2026-10-01T02:00:00Z', 600, 'b')
  ];
  const rows = aggregateUsage(members, interviews, ['ADMIN@EXAMPLE.COM'], period, true);
  assert.equal(rows.length, 2);
  const a = rows.find(row => row.id === 'a');
  assert.equal(a.started, 4);
  assert.equal(a.completed, 2);
  assert.equal(a.interrupted, 1);
  assert.equal(a.unconfirmed, 1);
  assert.equal(a.completionRate, 0.5);
  assert.equal(a.seconds, 120);
  assert.equal(a.timedCount, 2);
  assert.equal(a.days, 2);
  assert.equal(a.lastUsed, '2026-10-02T15:00:00Z');
  const c = rows.find(row => row.id === 'c');
  assert.equal(c.started, 0);
  assert.equal(c.completionRate, null);
  assert.equal(c.lastUsed, null);
  assert.equal(sortUsage(rows, 'oldest')[0].id, 'c');
  assert.equal(sortUsage(rows, 'count')[0].id, 'a');
  assert.equal(aggregateUsage(members, interviews, ['admin@example.com'], period, false).length, 3);
});

test('non-administrators cannot fetch usage data', async () => {
  const { getUsageData } = load('lib/usage-data.ts', name => {
    if (name === 'server-only') return {};
    if (name === './supabase-admin') return {
      getActiveAdministrator: async () => null,
      getSupabaseAdmin: () => { throw new Error('must not fetch data'); }
    };
    throw new Error(name);
  });
  assert.equal(await getUsageData('member@example.com'), null);
});

test('usage data fetches every page beyond Supabase default row limit', async () => {
  const sizes = { members: 1001, interviews: 2001, administrator_accounts: 0 };
  const calls = [];
  const { getUsageData } = load('lib/usage-data.ts', name => {
    if (name === 'server-only') return {};
    if (name === './supabase-admin') return {
      getActiveAdministrator: async () => ({ id: 'admin' }),
      getSupabaseAdmin: () => ({ from: table => {
        const query = {
          select: () => query, eq: () => query, order: () => query,
          range: async (from, to) => {
            calls.push([table, from, to]);
            return { data: Array.from({ length: Math.min(1000, Math.max(0, sizes[table] - from)) }, (_, index) => ({ id: `${from + index}` })), error: null };
          }
        };
        return query;
      } })
    };
    throw new Error(name);
  });
  const result = await getUsageData('admin@example.com');
  assert.equal(result.members.length, 1001);
  assert.equal(result.interviews.length, 2001);
  assert.ok(calls.some(([table, from]) => table === 'interviews' && from === 2000));
});

test('analytics page protects data and renders member filters and history links', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const analytics = { getUsagePeriod, aggregateUsage, sortUsage, getUsageSort, usageSortColumns };
  let session = null;
  let allowed = false;
  let reads = 0;
  const exports = {};
  const code = ts.transpileModule(readFileSync(resolve(__dirname, '..', 'app/analytics/page.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  vm.runInNewContext(code, { exports, Intl, URLSearchParams, require: name => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '../../auth') return { auth: async () => session };
    if (name === '../../lib/supabase-admin') return { ensureActiveMember: async () => ({ id: 'a' }) };
    if (name === '../../lib/usage-analytics') return analytics;
    if (name === '../../lib/usage-data') return { getUsageData: async () => {
      reads++;
      return allowed ? {
        members: [{ id: 'a', email: 'member@example.com', display_name: 'メンバー' }, { id: 'b', email: 'admin@example.com', display_name: '管理者本人' }],
        interviews: [], administratorEmails: ['admin@example.com']
      } : null;
    } };
    if (name.endsWith('/LoginPage')) return { default: () => React.createElement('p', null, 'ログイン') };
    if (name.endsWith('/AccessDeniedPage')) return { default: () => React.createElement('p', null, '利用不可') };
    if (name.endsWith('/HistoryFrame')) return { default: ({ children }) => React.createElement('main', null, children) };
    throw new Error(name);
  } });
  const props = { searchParams: Promise.resolve({ period: 'custom', start: '2026-10-01', end: '2026-10-20', excludeAdmins: '1' }) };
  assert.match(renderToStaticMarkup(await exports.default(props)), /ログイン/);
  assert.equal(reads, 0);
  session = { user: { email: 'member@example.com' } };
  const denied = renderToStaticMarkup(await exports.default(props));
  assert.match(denied, /管理者専用の画面です/);
  assert.doesNotMatch(denied, /<table/);
  allowed = true;
  const html = renderToStaticMarkup(await exports.default(props));
  assert.match(html, /name="excludeAdmins"/);
  assert.match(html, /メンバー別利用状況（1人）/);
  assert.match(html, /memberId=a/);
  assert.doesNotMatch(html, /管理者本人/);
  assert.doesNotMatch(html, /並び順/);
  assert.match(html, /aria-sort="descending"/);
  const links = [...html.matchAll(/class="analytics-sort" href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll('&amp;', '&'), 'http://localhost'));
  assert.equal(links.length, 10);
  for (const link of links) {
    assert.equal(link.searchParams.get('excludeAdmins'), '1');
    assert.equal(link.searchParams.get('period'), 'custom');
    assert.equal(link.searchParams.get('start'), '2026-10-01');
    assert.equal(link.searchParams.get('end'), '2026-10-20');
    assert.equal(link.searchParams.get('direction'), 'asc');
  }
  const ascending = renderToStaticMarkup(await exports.default({ searchParams: Promise.resolve({ ...(await props.searchParams), sort: 'average', direction: 'asc' }) }));
  assert.match(ascending, /aria-sort="ascending"/);
  assert.match(ascending, /sort=average&amp;direction=desc/);
});


test('every data column supports ascending and descending with numeric and date comparisons', () => {
  const base = { display_name: null, isAdministrator: false, started: 0, completed: 0, interrupted: 0, unconfirmed: 0, seconds: 0, timedCount: 1, days: 0, lastUsed: null, completionRate: 0 };
  const low = { ...base, id: 'low', email: 'a@example.com', display_name: 'A', started: 2, completed: 2, interrupted: 2, unconfirmed: 2, seconds: 200, days: 2, lastUsed: '2026-01-01T00:00:00Z', completionRate: 0.2 };
  const high = { ...base, id: 'high', email: 'z@example.com', display_name: 'Z', started: 10, completed: 10, interrupted: 10, unconfirmed: 10, seconds: 1000, days: 10, lastUsed: '2026-10-01T00:00:00Z', completionRate: 1 };
  const rows = [high, low];
  for (const { key } of usageSortColumns) {
    assert.equal(sortUsage(rows, key, 'asc')[0].id, 'low', key);
    assert.equal(sortUsage(rows, key, 'desc')[0].id, 'high', key);
  }
  assert.equal(rows[0].id, 'high', 'does not mutate the input');
  const unknown = { ...base, id: 'unknown', email: 'u@example.com', timedCount: 0, completionRate: null };
  for (const key of ['seconds', 'average', 'completionRate']) {
    for (const direction of ['asc', 'desc']) {
      assert.equal(sortUsage([unknown, low], key, direction)[1].id, 'unknown');
    }
  }
  assert.equal(sortUsage([high, unknown], 'lastUsed', 'asc')[0].id, 'unknown');
  assert.equal(sortUsage([high, unknown], 'lastUsed', 'desc')[0].id, 'high');
  const longTotal = { ...high, timedCount: 10 };
  assert.equal(sortUsage([longTotal, low], 'average', 'asc')[0].id, 'high', 'sorts averages rather than totals');
  assert.equal(getUsageSort({ sort: 'bogus', direction: 'bad' }).column, 'started');
  assert.equal(getUsageSort({ sort: '__proto__' }).column, 'started');
  assert.equal(getUsageSort({ sort: 'oldest' }).direction, 'asc');
});
