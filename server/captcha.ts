import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail, hash, id, token, type AppContext } from './core.js';
import type { Database } from './db.js';

const COOKIE = 'login_challenge';
export const CAPTCHA_TTL = 120;
export type CaptchaSource = () => Promise<{ answer: string; image: Buffer }>;
export const captchaDigest = (secret: string, challengeId: string, answer: string) =>
  createHmac('sha256', secret)
    .update(challengeId + ':' + answer.trim().toUpperCase())
    .digest('hex');

export async function renderCaptcha(answer: string) {
  if (!/^[A-Z2-9]{4}$/.test(answer)) throw new Error('Invalid captcha alphabet');
  const letters = [...answer]
    .map((char, i) => {
      const x = 24 + i * 34,
        y = 39 + randomInt(-4, 5);
      return `<text x="${x}" y="${y}" transform="rotate(${randomInt(-15, 16)} ${x} ${y})" font-family="sans-serif" font-size="30" font-weight="700" fill="${i % 2 ? '#813b43' : '#b82c37'}">${char}</text>`;
    })
    .join('');
  const lines = Array.from(
    { length: 4 },
    () =>
      `<path d="M0 ${randomInt(10, 55)} Q80 ${randomInt(5, 60)} 164 ${randomInt(10, 55)}" fill="none" stroke="#cf8990" stroke-width="1"/>`,
  ).join('');
  const dots = Array.from(
    { length: 45 },
    () => `<circle cx="${randomInt(164)}" cy="${randomInt(60)}" r="1" fill="#d5a1a5"/>`,
  ).join('');
  // Only raster pixels leave the server. SVG text and the answer are never persisted.
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="60"><rect width="164" height="60" rx="8" fill="#fff3f2"/>${dots}${letters}${lines}</svg>`,
    ),
  )
    .png()
    .toBuffer();
}

export const generateCaptcha: CaptchaSource = async () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const answer = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return { answer, image: await renderCaptcha(answer) };
};

export async function captchaRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  source: CaptchaSource = generateCaptcha,
) {
  const limited = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const challenge = async (req: FastifyRequest, reply: FastifyReply, mini = false) => {
      const secret = token(),
        challengeId = id(),
        generated = await source();
      const expiresAt = new Date(Date.now() + CAPTCHA_TTL * 1000).toISOString();
      const previous = mini ? req.headers['x-captcha-token'] : req.cookies[COOKIE];
      await ctx.db.transaction(async (tx) => {
        await tx.query('DELETE FROM login_captchas WHERE expires_at<=now() OR binding_hash=$1', [
          hash(typeof previous === 'string' ? previous : ''),
        ]);
        await tx.query(
          'INSERT INTO login_captchas(id,binding_hash,answer_digest,expires_at) VALUES($1,$2,$3,$4)',
          [
            challengeId,
            hash(secret),
            captchaDigest(secret, challengeId, generated.answer),
            expiresAt,
          ],
        );
      });
      if (!mini) reply.setCookie(COOKIE, secret, {
        httpOnly: true,
        secure: ctx.production,
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: CAPTCHA_TTL,
      });
      return {
        id: challengeId,
        image: 'data:image/png;base64,' + generated.image.toString('base64'),
        expiresAt,
        ...(mini ? { captchaToken: secret } : {}),
      };
  };
  app.get('/api/auth/captcha', limited, (req, reply) => challenge(req, reply));
  if (ctx.miniprogram) app.get('/api/mini/auth/captcha', limited, (req, reply) => challenge(req, reply, true));
}

export async function consumeCaptcha(
  db: Database,
  secret: string | undefined,
  challengeId: string,
  answer: string,
) {
  if (!secret || !challengeId || !answer.trim()) fail(400, '请填写图片验证码');
  // DELETE ... RETURNING makes success, failure and concurrent attempts equally one-use.
  const row = (
    await db.query(
      'DELETE FROM login_captchas WHERE id=$1 AND binding_hash=$2 RETURNING answer_digest,expires_at',
      [challengeId, hash(secret)],
    )
  )[0];
  if (!row || new Date(row.expires_at).getTime() <= Date.now())
    fail(400, '验证码已失效，请换一张后重试');
  const expected = Buffer.from(row.answer_digest, 'hex');
  const actual = Buffer.from(captchaDigest(secret, challengeId, answer), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    fail(400, '验证码不正确，请换一张后重试');
}
