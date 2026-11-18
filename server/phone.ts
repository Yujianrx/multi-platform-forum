import { z } from 'zod';

export const phoneNumber = z
  .string()
  .trim()
  .max(32)
  .transform((input) => input.replace(/[\s()\-]/g, ''))
  .transform((input) => /^1[3-9]\d{9}$/.test(input) ? `+86${input}` : input)
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, '请输入中国大陆手机号或带国家区号的号码'));
