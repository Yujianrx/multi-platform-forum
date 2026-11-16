import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkRichText } from '../src/remark-rich-text';

const render = (value: string) => renderToStaticMarkup(createElement(Markdown, {
  remarkPlugins: [remarkGfm, remarkRichText], children: value,
}));

describe('富文本存储格式的安全展示', () => {
  test('下划线、重叠格式和表格换行渲染为实际格式', () => {
    const html = render('**重点** <u>跟进</u> <em>斜体 **加粗**</em>\n\n| 事项 |\n| --- |\n| 第一步<br>第二步 |');
    expect(html).toContain('<u>跟进</u>');
    expect(html).toContain('<em>斜体 <strong>加粗</strong></em>');
    expect(html).toMatch(/<td>第一步<br\/>\s*第二步<\/td>/);
  });
  test('属性、事件、脚本、任意 HTML 和危险链接均不可执行', () => {
    const html = render('<u onclick="alert(1)">内容</u>\n\n<script>alert(2)</script>\n\n<iframe src="https://bad.invalid"></iframe>\n\n[x](javascript:alert(3))\n\n<br onmouseover="alert(4)">');
    expect(html).not.toMatch(/<(?:script|iframe|u\s|br\s)/i);
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;script&gt;');
  });
  test('代码中的标签与转义文本保持字面量', () => {
    const html = render('`<u>代码</u>`\n\n```html\n<br>\n```\n\n\\<u>字面量\\</u>');
    expect(html).not.toContain('<u>');
    expect(html).not.toContain('<br');
    expect(html).toContain('&lt;u&gt;代码&lt;/u&gt;');
  });
  test('未闭合和不匹配标记不丢失用户文字', () => {
    const html = render('开始 <u>未闭合 **内容**\n\n下一段 <em>保留</u>');
    expect(html).toContain('开始 &lt;u&gt;未闭合 <strong>内容</strong>');
    expect(html).toContain('下一段 &lt;em&gt;保留&lt;/u&gt;');
  });
});
