import { z } from 'zod';

export const identifier = z.string().uuid();
const storedTitle = z.string().min(1).refine(value => value.length <= 200, 'Title must be at most 200 UTF-16 code units');
export const title = z.string().trim().pipe(storedTitle);
export const itemSchema = z.strictObject({ id: identifier, title: storedTitle, completed: z.boolean() });
export const createSchema = z.strictObject({ title });
export const updateSchema = z.strictObject({ title: title.optional(), completed: z.boolean().optional() })
  .refine(value => value.title !== undefined || value.completed !== undefined);
export type TodoItem = z.infer<typeof itemSchema>;
