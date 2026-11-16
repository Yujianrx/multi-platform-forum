import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { EditorState } from '@tiptap/pm/state';
import { richTextExtensions } from './rich-text';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code2,
  Link2,
  ImagePlus,
  Smile,
  Paperclip,
  Maximize2,
  Minimize2,
  RemoveFormatting,
  Table2,
  ListChecks,
  Unlink,
  Undo2,
  Redo2,
  X,
  FileText,
  UploadCloud,
} from './icons';
import { Badge } from './components';
import { size } from './api';
import { stickers, stickerSrc, emojiGroups } from './stickers';
import { mediaAccept, type MediaFile, type MediaComposerProps } from './MediaComposer';
export default function RichTextComposer({
  label,
  value,
  onChange,
  files,
  onFilesChange,
  uploadFile,
  onBusyChange,
  removeFile,
  maxLength = 150000,
  maxFiles = 30,
  rows = 12,
  disabled = false,
  placeholder = '写下你的想法…',
  focusRef,
}: MediaComposerProps) {
  const uid = useId(),
    root = useRef<HTMLDivElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const [full, setFull] = useState(false),
    [picker, setPicker] = useState(false),
    [tab, setTab] = useState('表情包'),
    [error, setError] = useState(''),
    [progress, setProgress] = useState<{ name: string; n: number } | null>(null),
    [dragging, setDragging] = useState(false),
    [editorReady, setEditorReady] = useState(false);
  const latest = useRef({ value, files, onChange, disabled });
  latest.current = { value, files, onChange, disabled };
  const uploading = useRef(false),
    appliedValue = useRef(value);
  const editor = useEditor({
    extensions: richTextExtensions(maxLength, () =>
      setError('内容已达到长度上限，请精简后继续输入。'),
    ),
    content: value,
    contentType: 'markdown',
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: 'rich-text-surface',
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
        'data-placeholder': placeholder,
      },
      handlePaste: (_view, event) => {
        const pasted = Array.from(event.clipboardData?.files || []).filter((f) =>
          f.type.startsWith('image/'),
        );
        if (!pasted.length) return false;
        void uploadMany(pasted);
        return true;
      },
    },
    onCreate: () => setEditorReady(true),
    onUpdate: ({ editor: current }) => {
      const next = current.isEmpty ? '' : current.getMarkdown();
      appliedValue.current = next;
      latest.current.value = next;
      latest.current.onChange(next);
      setError('');
    },
  });
  const locked = disabled || !!progress || !editor;
  useEffect(() => {
    if (!editor || !editorReady || editor.isDestroyed) return;
    editor.setEditable(!disabled, false);
    if (focusRef)
      focusRef.current = root.current?.querySelector<HTMLElement>('[role=textbox]') || null;
    return () => {
      if (focusRef) focusRef.current = null;
    };
  }, [editor, editorReady, disabled, focusRef]);
  useEffect(() => {
    if (!editor || !editorReady || editor.isDestroyed || value === appliedValue.current) return;
    appliedValue.current = value;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    // A successfully sent reply starts a new draft, including a fresh undo history.
    if (!value)
      editor.view.updateState(
        EditorState.create({
          schema: editor.schema,
          doc: editor.state.doc,
          plugins: editor.state.plugins,
        }),
      );
  }, [editor, editorReady, value]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPicker(false);
        setFull(false);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  useEffect(() => {
    if (!full) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [full]);
  function insertImage(src: string, alt: string) {
    editor?.chain().focus().setImage({ src, alt }).run();
  }
  function setLink() {
    if (!editor) return;
    const url = window.prompt(
      '输入链接地址（http 或 https），留空可移除链接',
      editor.getAttributes('link').href || 'https://',
    );
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      if (editor.state.selection.empty && !editor.isActive('link')) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text: parsed.href,
            marks: [{ type: 'link', attrs: { href: parsed.href } }],
          })
          .run();
      } else editor.chain().focus().extendMarkRange('link').setLink({ href: parsed.href }).run();
    } catch {
      setError('请输入有效的 http 或 https 链接');
    }
  }
  async function uploadMany(chosen: File[]) {
    if (uploading.current || latest.current.disabled || !editor || editor.isDestroyed) return;
    if (latest.current.files.length + chosen.length > maxFiles) {
      setError(`最多添加 ${maxFiles} 个文件`);
      return;
    }
    uploading.current = true;
    onBusyChange?.(true);
    setPicker(false);
    setError('');
    try {
      for (const file of chosen) {
        setProgress({ name: file.name, n: 0 });
        try {
          const f = await uploadFile(file, (n) => setProgress({ name: file.name, n }));
          const next = [...latest.current.files, f];
          latest.current.files = next;
          onFilesChange(next);
          if (f.kind === 'image' && !editor.isDestroyed)
            insertImage('/api/files/' + f.id, f.original_name);
        } catch (e: any) {
          setError(file.name + '：' + e.message);
          break;
        }
      }
    } finally {
      uploading.current = false;
      setProgress(null);
      onBusyChange?.(false);
    }
  }
  async function remove(f: MediaFile) {
    try {
      if (removeFile) await removeFile(f);
      const next = latest.current.files.filter((x) => x.id !== f.id);
      latest.current.files = next;
      onFilesChange(next);
      if (editor) {
        const tr = editor.state.tr,
          ranges: { from: number; to: number }[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (
            node.type.name === 'image' &&
            String(node.attrs.src).split('?')[0] === '/api/files/' + f.id
          )
            ranges.push({ from: pos, to: pos + node.nodeSize });
        });
        ranges.reverse().forEach(({ from, to }) => tr.delete(from, to));
        editor.view.dispatch(tr);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }
  function tool(name: string, Icon: any, fn: () => void, off = locked, active?: boolean) {
    return (
      <button
        type="button"
        title={name}
        aria-label={name}
        disabled={off}
        aria-pressed={active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={fn}
      >
        <Icon size={16} />
      </button>
    );
  }
  return (
    <div
      ref={root}
      className={
        'media-composer' + (full ? ' is-fullscreen' : '') + (dragging ? ' is-dragging' : '')
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        uploadMany(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="media-toolbar" role="toolbar" aria-label={label + '工具栏'}>
        <div className="media-tool-group">
          {tool(
            '撤销',
            Undo2,
            () => editor?.chain().focus().undo().run(),
            locked || !editor?.can().undo(),
          )}
          {tool(
            '重做',
            Redo2,
            () => editor?.chain().focus().redo().run(),
            locked || !editor?.can().redo(),
          )}
        </div>
        <div className="media-tool-group">
          <select
            aria-label="段落样式"
            disabled={locked}
            value={
              editor?.isActive('heading') ? editor.getAttributes('heading').level : 'paragraph'
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'paragraph') editor?.chain().focus().setParagraph().run();
              else
                editor
                  ?.chain()
                  .focus()
                  .setHeading({ level: Number(v) as 1 | 2 | 3 | 4 | 5 | 6 })
                  .run();
            }}
          >
            <option value="paragraph">正文</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                标题 {n}
              </option>
            ))}
          </select>
          {tool(
            '加粗',
            Bold,
            () => editor?.chain().focus().toggleBold().run(),
            locked,
            editor?.isActive('bold'),
          )}
          {tool(
            '斜体',
            Italic,
            () => editor?.chain().focus().toggleItalic().run(),
            locked,
            editor?.isActive('italic'),
          )}
          {tool(
            '下划线',
            Underline,
            () => editor?.chain().focus().toggleUnderline().run(),
            locked,
            editor?.isActive('underline'),
          )}
          {tool(
            '删除线',
            Strikethrough,
            () => editor?.chain().focus().toggleStrike().run(),
            locked,
            editor?.isActive('strike'),
          )}
          {tool('清除格式', RemoveFormatting, () =>
            editor?.chain().focus().unsetAllMarks().clearNodes().run(),
          )}
        </div>
        <div className="media-tool-group">
          {tool(
            '无序列表',
            List,
            () => editor?.chain().focus().toggleBulletList().run(),
            locked,
            editor?.isActive('bulletList'),
          )}
          {tool(
            '有序列表',
            ListOrdered,
            () => editor?.chain().focus().toggleOrderedList().run(),
            locked,
            editor?.isActive('orderedList'),
          )}
          {tool(
            '任务列表',
            ListChecks,
            () => editor?.chain().focus().toggleTaskList().run(),
            locked,
            editor?.isActive('taskList'),
          )}
          {tool(
            '引用',
            Quote,
            () => editor?.chain().focus().toggleBlockquote().run(),
            locked,
            editor?.isActive('blockquote'),
          )}
          {tool(
            '代码块',
            Code2,
            () => editor?.chain().focus().toggleCodeBlock().run(),
            locked,
            editor?.isActive('codeBlock'),
          )}
          {tool('插入链接', Link2, setLink, locked, editor?.isActive('link'))}
          {editor?.isActive('link') &&
            tool('移除链接', Unlink, () =>
              editor.chain().focus().extendMarkRange('link').unsetLink().run(),
            )}
          {tool(
            '插入表格',
            Table2,
            () =>
              editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
            locked || !!editor?.isActive('table'),
          )}
        </div>
        <div className="media-tool-group media-upload-tools">
          <button
            type="button"
            disabled={locked}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => imageInput.current?.click()}
          >
            <ImagePlus size={17} />
            <span>图片</span>
          </button>
          <button
            type="button"
            disabled={locked}
            onMouseDown={(e) => e.preventDefault()}
            aria-expanded={picker}
            aria-controls={uid + '-picker'}
            onClick={() => setPicker(!picker)}
          >
            <Smile size={17} />
            <span>表情</span>
          </button>
          <button
            type="button"
            disabled={locked}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={17} />
            <span>附件</span>
          </button>
        </div>
        <div className="media-tool-group media-view-tools">
          {tool(
            full ? '退出全屏' : '全屏编辑',
            full ? Minimize2 : Maximize2,
            () => setFull(!full),
            false,
          )}
        </div>
      </div>
      <input
        className="media-file-input"
        ref={imageInput}
        type="file"
        aria-label={label + '上传图片'}
        multiple
        accept=".png,.jpg,.jpeg,.webp,.gif"
        disabled={locked}
        onChange={(e) => {
          uploadMany(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
      <input
        className="media-file-input"
        ref={fileInput}
        type="file"
        aria-label={label + '上传附件'}
        multiple
        accept={mediaAccept}
        disabled={locked}
        onChange={(e) => {
          uploadMany(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
      {picker && (
        <div className="media-picker" id={uid + '-picker'} role="region" aria-label="表情选择器">
          <div className="media-picker-tabs">
            {['表情包', ...Object.keys(emojiGroups)].map((t) => (
              <button
                type="button"
                key={t}
                className={t === tab ? 'active' : ''}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              className="media-close-picker"
              aria-label="关闭表情选择器"
              onClick={() => setPicker(false)}
            >
              <X size={15} />
            </button>
          </div>
          {tab === '表情包' ? (
            <div className="sticker-picker-grid">
              {stickers.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  title={s.label}
                  aria-label={'表情包：' + s.label}
                  onClick={() => {
                    insertImage(stickerSrc(s.id), s.label);
                    setPicker(false);
                  }}
                >
                  <img src={stickerSrc(s.id)} alt="" />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="emoji-picker-grid">
              {emojiGroups[tab].map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  aria-label={'表情：' + emoji}
                  onClick={() => {
                    editor?.chain().focus().insertContent({ type: 'text', text: emoji }).run();
                    setPicker(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {editor?.isActive('table') && (
        <div className="media-table-tools" role="toolbar" aria-label="表格工具">
          <button
            type="button"
            disabled={locked}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            添加行
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            添加列
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            删除行
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            删除列
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            删除表格
          </button>
        </div>
      )}
      <EditorContent
        editor={editor}
        className="rich-text-content"
        style={{ '--editor-min-height': Math.max(180, rows * 26) + 'px' } as CSSProperties}
      />
      {dragging && (
        <div className="media-drop-overlay">
          <UploadCloud size={30} />
          松开鼠标添加图片或附件
        </div>
      )}
      <div className="media-editor-foot">
        <span>{(editor?.state.doc.textContent.length || 0).toLocaleString()} 字</span>
      </div>
      {progress && (
        <div className="media-upload-progress" role="status">
          <span>
            正在上传 {progress.name} · {progress.n}%
          </span>
          <progress max={100} value={progress.n} />
        </div>
      )}
      {error && (
        <p className="media-editor-error" role="alert">
          {error}
          <button type="button" aria-label="关闭上传提示" onClick={() => setError('')}>
            <X size={14} />
          </button>
        </p>
      )}
      {!!files.length && (
        <div className="media-file-list">
          {files.map((f) => (
            <div className="media-file-card" key={f.id}>
              {f.kind === 'image' && f.scan_status === 'clean' ? (
                <img src={'/api/files/' + f.id} alt={f.original_name} />
              ) : (
                <FileText size={25} />
              )}
              <div>
                <b>{f.original_name}</b>
                <small>{size(Number(f.size))}</small>
                {f.scan_status !== 'clean' && <Badge status={f.scan_status} />}
              </div>
              <button
                type="button"
                aria-label={'移除附件：' + f.original_name}
                disabled={locked}
                onClick={() => remove(f)}
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
