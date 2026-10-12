import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareHosting } from '../src/hosting-comparison.js';

const now = new Date('2026-10-11T15:30:23-05:00');
const evidence = {
  version: 1,
  profile: 'public-demo',
  region: 'eastus',
  currency: 'USD',
  checkedOn: '2026-10-11',
  workload: {
    monthlyRequests: 10000,
    monthlyDataTransferGb: 1,
    activeBackendHours: 20,
  },
  current: {
    hosting: 'container-apps',
    monthlyCost: 12.34,
    source: 'https://prices.azure.com/',
  },
  candidate: {
    hosting: 'static-web-apps',
    monthlyCost: 21.34,
    source: 'https://prices.azure.com/',
  },
  liveAcceptance: false,
} as const;

test('keeps Container Apps as the default when the candidate costs more', () => {
  const result = compareHosting(evidence, now);
  assert.equal(result.recommendedDefault, 'container-apps');
  assert.equal(result.deltaMonthly, 9);
  assert.ok(Math.abs((result.deltaPercent ?? 0) - 72.9335494327) < 0.000001);
  assert.equal(result.reason, 'candidate-costs-more');
  assert.equal(result.defaultChangeAuthorized, false);
});

test('recommends an accepted candidate that costs no more without authorizing a change', () => {
  const result = compareHosting({
    ...evidence,
    candidate: { ...evidence.candidate, monthlyCost: 10 },
    liveAcceptance: true,
  }, now);
  assert.equal(result.recommendedDefault, 'static-web-apps');
  assert.equal(result.reason, 'candidate-costs-no-more-and-is-live-accepted');
  assert.equal(result.defaultChangeAuthorized, false);
});

test('does not promote a cheaper candidate before live acceptance', () => {
  const result = compareHosting({
    ...evidence,
    candidate: { ...evidence.candidate, monthlyCost: 10 },
  }, now);
  assert.equal(result.recommendedDefault, 'container-apps');
  assert.equal(result.reason, 'candidate-not-live-accepted');
});

test('rejects future, stale, insecure, placeholder, and invalid cost evidence', () => {
  for (const input of [
    { ...evidence, checkedOn: '2026-10-12' },
    { ...evidence, checkedOn: '2026-09-10' },
    { ...evidence, current: { ...evidence.current, source: 'http://prices.azure.com/' } },
    { ...evidence, current: { ...evidence.current, monthlyCost: 0 } },
    { ...evidence, current: { ...evidence.current, monthlyCost: -1 } },
    { ...evidence, candidate: { ...evidence.candidate, monthlyCost: Number.POSITIVE_INFINITY } },
  ]) assert.throws(() => compareHosting(input, now));
});

test('rejects cost entries that claim a different region, currency, or workload basis', () => {
  for (const candidate of [
    { ...evidence.candidate, region: 'westus' },
    { ...evidence.candidate, currency: 'EUR' },
    { ...evidence.candidate, workload: { ...evidence.workload, monthlyRequests: 1 } },
  ]) assert.throws(() => compareHosting({ ...evidence, candidate }, now));
});

test('example uses rejected placeholders and cannot promote a default', async () => {
  const example = JSON.parse(await readFile('azure-demo-hosting-comparison.example.json', 'utf8'));
  assert.equal(example.current.monthlyCost, 0);
  assert.equal(example.candidate.monthlyCost, 0);
  assert.equal(example.liveAcceptance, false);
  assert.throws(() => compareHosting(example, now));
});
