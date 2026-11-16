import type { FastifyInstance, InjectOptions } from 'fastify';
import { renderCaptcha } from '../server/captcha';

// Dependency injection is restricted to test bootstraps; main.ts always uses random codes.
export const testCaptchaSource = async () => ({
  answer: 'AB7K',
  image: await renderCaptcha('AB7K'),
});
export async function testRequest(app: FastifyInstance, options: InjectOptions) {
  if (options.url === '/api/auth/login') {
    const challenge = await app.inject({
      url: '/api/auth/captcha',
      remoteAddress: options.remoteAddress,
    });
    if (challenge.statusCode !== 200)
      throw new Error('Test challenge failed: ' + challenge.statusCode);
    const cookie = challenge.cookies.find((c) => c.name === 'login_challenge')!;
    options = {
      ...options,
      headers: { ...options.headers, cookie: cookie.name + '=' + cookie.value },
      payload: {
        ...(options.payload as object),
        captchaId: challenge.json().id,
        captchaCode: 'AB7K',
      },
    };
  }
  return app.inject(options);
}
