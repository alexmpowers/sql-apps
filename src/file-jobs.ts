import { z } from 'zod';

export const jobMessageSchema = z.strictObject({
  id: z.string().uuid(), oid: z.string().uuid(), tenantId: z.string().uuid(), key: z.string().min(1).max(256),
  trace: z.object({ traceId: z.string().regex(/^[a-f0-9]{32}$/), spanId: z.string().regex(/^[a-f0-9]{16}$/) }).optional(),
});
export type JobMessage = z.infer<typeof jobMessageSchema>;
export const fileJobSchema = z.object({
  id: z.string().uuid().transform(value => value.toLowerCase()),
  filename: z.string().min(1).refine(value => value.length <= 128, 'Filename must be at most 128 UTF-16 code units'),
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), byte_count: z.number().int().nonnegative().nullable(),
  line_count: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  parent_job_id: z.string().uuid().nullable().optional(),
});
export type FileJob = z.infer<typeof fileJobSchema>;
