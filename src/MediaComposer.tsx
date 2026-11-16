import { lazy, Suspense, type RefObject } from 'react';
import { FileText } from './icons';
import { MarkdownBody } from './components';
import { size } from './api';
import './media-editor.css';

export type MediaFile = {
  id: string;
  original_name: string;
  size: number;
  kind: string;
  scan_status: string;
  mime?: string;
};
export const mediaAccept =
  '.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.json,.csv,.zip,.pdf,.docx,.xlsx,.pptx';
export function CommentMedia({ body, files = [] }: { body: string; files?: MediaFile[] }) {
  return (
    <div className="comment-media">
      <MarkdownBody>{body}</MarkdownBody>
      <div className="media-image-gallery">
        {files
          .filter((f) => f.kind === 'image' && !body.includes('/api/files/' + f.id))
          .map((f) => (
            <a href={'/api/files/' + f.id} key={f.id} target="_blank" rel="noopener noreferrer">
              <img src={'/api/files/' + f.id} alt={f.original_name} />
            </a>
          ))}
      </div>
      <AttachmentList files={files} />
    </div>
  );
}
export function AttachmentList({
  files,
  images = false,
}: {
  files: MediaFile[];
  images?: boolean;
}) {
  return (
    <div className="media-downloads">
      {files
        .filter((f) => images || f.kind !== 'image')
        .map((f) => (
          <a key={f.id} className="media-download" href={'/api/files/' + f.id + '?download=1'}>
            <FileText size={19} />
            <span>
              <b>{f.original_name}</b>
              <small>
                {size(Number(f.size))}
                {f.scan_status !== 'clean' ? ' · 等待安全复核' : ' · 点击下载'}
              </small>
            </span>
          </a>
        ))}
    </div>
  );
}
export type MediaComposerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  files: MediaFile[];
  onFilesChange: (files: MediaFile[]) => void;
  uploadFile: (file: File, onProgress: (n: number) => void) => Promise<MediaFile>;
  onBusyChange?: (busy: boolean) => void;
  removeFile?: (file: MediaFile) => Promise<void>;
  maxLength?: number;
  maxFiles?: number;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  focusRef?: RefObject<HTMLElement | null>;
};
const RichTextComposer = lazy(() => import('./RichTextComposer'));
export function MediaComposer(props: MediaComposerProps) {
  return (
    <Suspense
      fallback={
        <div className="media-composer rich-text-loading" role="status">
          正在加载编辑器…
        </div>
      }
    >
      <RichTextComposer {...props} />
    </Suspense>
  );
}
