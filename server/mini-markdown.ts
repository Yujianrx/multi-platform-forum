import { Marked, Renderer } from 'marked';

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

type BodyBlock = { html: string } | { path: string; alt: string };
const imagePath = /^\/(?:api\/files\/[0-9a-f-]{36}|stickers\/(?:received|like|thanks|cheer|thinking|laugh|wow|celebrate|agree|coffee|question|done)\.svg)$/;

export function miniBodyBlocks(body: string): BodyBlock[] {
  const images: BodyBlock[] = [];
  const renderer = new Renderer();
  renderer.html = ({ text }) => /^<\/?(?:strong|em|u|s|del)>$|^<br\s*\/?>$/i.test(text) ? text : escape(text);
  renderer.link = function ({ tokens }) { return this.parser.parseInline(tokens); };
  renderer.image = ({ href, text }) => {
    const path = href.split('?')[0];
    if (!imagePath.test(path)) return escape(text || '图片');
    const index = images.push({ path, alt: text || '图片' }) - 1;
    return `<mini-image>${index}</mini-image>`;
  };
  const html = new Marked({ renderer, gfm: true }).parse(body, { async: false });
  return html.split(/<mini-image>(\d+)<\/mini-image>/).flatMap((value, index) => {
    if (index % 2) return images[Number(value)] ? [images[Number(value)]] : [];
    return value.trim() ? [{ html: value }] : [];
  });
}
