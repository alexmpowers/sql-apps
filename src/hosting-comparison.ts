import { z } from 'zod';

const workload = z.strictObject({
  monthlyRequests: z.number().int().finite().nonnegative(),
  monthlyDataTransferGb: z.number().finite().nonnegative(),
  activeBackendHours: z.number().finite().nonnegative(),
});

const httpsSource = z.string().url().refine(value => new URL(value).protocol === 'https:',
  'Cost evidence sources must use HTTPS.');

const hostingCost = z.strictObject({
  hosting: z.enum(['container-apps', 'static-web-apps']),
  monthlyCost: z.number().finite().positive(),
  source: httpsSource,
});

const comparisonSchema = z.strictObject({
  version: z.literal(1),
  profile: z.literal('public-demo'),
  region: z.string().regex(/^[a-z0-9-]+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  checkedOn: z.iso.date(),
  workload,
  current: hostingCost.extend({ hosting: z.literal('container-apps') }),
  candidate: hostingCost.extend({ hosting: z.literal('static-web-apps') }),
  liveAcceptance: z.boolean(),
});

export interface HostingComparisonResult {
  deltaMonthly: number;
  deltaPercent: number | null;
  recommendedDefault: 'container-apps' | 'static-web-apps';
  reason:
    | 'candidate-costs-more'
    | 'candidate-not-live-accepted'
    | 'candidate-costs-no-more-and-is-live-accepted';
  defaultChangeAuthorized: false;
}

export function compareHosting(input: unknown, now = new Date()): HostingComparisonResult {
  const config = comparisonSchema.parse(input);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const checkedOn = Date.parse(`${config.checkedOn}T00:00:00Z`);
  const ageDays = (today - checkedOn) / 86_400_000;
  if (ageDays < 0) throw new Error('Hosting cost evidence cannot be dated in the future.');
  if (ageDays > 30) throw new Error('Hosting cost evidence must be no more than 30 days old.');

  const deltaMonthly = config.candidate.monthlyCost - config.current.monthlyCost;
  const candidateEligible = config.liveAcceptance &&
    config.candidate.monthlyCost <= config.current.monthlyCost;
  const reason = config.candidate.monthlyCost > config.current.monthlyCost ?
    'candidate-costs-more' :
    !config.liveAcceptance ? 'candidate-not-live-accepted' :
      'candidate-costs-no-more-and-is-live-accepted';

  return {
    deltaMonthly,
    deltaPercent: config.current.monthlyCost === 0 ? null :
      deltaMonthly / config.current.monthlyCost * 100,
    recommendedDefault: candidateEligible ? 'static-web-apps' : 'container-apps',
    reason,
    defaultChangeAuthorized: false,
  };
}
