import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import { isSticker } from './stickers';

// Match the published renderer: private files or our bundled stickers only.
export function isEditorImage(src: unknown): src is string {
  return (
    typeof src === 'string' &&
    (isSticker(src) || /^\/api\/files\/[0-9a-f-]{36}(\?[^\s<>]*)?$/.test(src))
  );
}

const SafeImage = Image.extend({
  parseHTML() {
    return [
      { tag: 'img[src]', getAttrs: (el) => (isEditorImage(el.getAttribute('src')) ? null : false) },
    ];
  },
  parseMarkdown(token, helpers) {
    return isEditorImage(token.href)
      ? helpers.createNode('image', { src: token.href, alt: token.text, title: token.title })
      : {
          type: 'text',
          text: token.text ? `[${token.text}：请上传图片到站内]` : '[请上传图片到站内]',
        };
  },
  renderHTML({ node }) {
    const { src, alt, title } = node.attrs;
    if (!isEditorImage(src)) return ['span', { class: 'muted' }, '[请上传图片到站内]'];
    return [
      'img',
      { src, alt: alt || '图片', title, class: isSticker(src) ? 'sticker-image' : 'content-image' },
    ];
  },
  renderMarkdown(node) {
    const src = node.attrs?.src || '';
    if (!isEditorImage(src)) return '[请上传图片到站内]';
    const alt = String(node.attrs?.alt || '图片').replace(/[\[\]\\\r\n]/g, ' ');
    return `![${alt}](${src.replaceAll(')', '%29')})`;
  },
}).configure({ inline: true, allowBase64: false });

export function richTextExtensions(maxLength: number, onLimit: () => void) {
  return [
    StarterKit.configure({
      link: { openOnClick: false, defaultProtocol: 'https' },
      // No automatic extra paragraph: avoid changing legacy content on load.
      trailingNode: false,
    }),
    SafeImage,
    TableKit.configure({ table: { resizable: false, renderWrapper: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    Extension.create({
      name: 'storedLengthLimit',
      addProseMirrorPlugins() {
        const editor = this.editor;
        return [
          new Plugin({
            filterTransaction(tr, state) {
              if (!tr.docChanged || !editor.markdown) return true;
              const next = editor.markdown.serialize(tr.doc.toJSON()).length;
              if (next <= maxLength || next <= editor.markdown.serialize(state.doc.toJSON()).length)
                return true;
              queueMicrotask(onLimit);
              return false;
            },
          }),
        ];
      },
    }),
  ];
}
