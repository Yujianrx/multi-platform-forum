import { Badge, MarkdownBody } from '../components';
import { size } from '../api';
import './review-materials.css';

type ReviewFile = {
  id: string;
  original_name: string;
  kind: string;
  size: number;
  scan_status: string;
  scan_reason?: string;
  deleted: boolean;
};
type ReviewJob = {
  id: string;
  comment_body?: string;
  data?: { title?: string; summary?: string; body: string; fields?: Record<string, string> };
  files?: ReviewFile[];
};
const labels: Record<string, string> = {
  problem: '解决的问题 / 技能用途',
  techStack: '技术栈',
  usage: '使用方法',
  members: '参与成员',
  tool: '适用工具 / 模型',
  dependencies: '运行环境与依赖',
  installation: '安装步骤',
  example: '使用示例',
  scenario: '应用场景',
  input: '输入说明',
  result: '效果示例',
  changelog: '更新日志',
  prompt: '提示词',
  version: '版本',
  repoUrl: '项目地址',
  demoUrl: '演示地址',
};

export function ReviewMaterials({ job }: { job: ReviewJob }) {
  const files = job.files || [];
  const url = (id: string) => `/api/admin/moderation/${job.id}/files/${id}`;
  const fileUrl = (source: string) => {
    const match = source.match(/^\/api\/files\/([0-9a-f-]{36})(?:\?.*)?$/);
    if (!match) return source;
    const file = files.find((f) => f.id === match[1] && !f.deleted && f.scan_status !== 'blocked');
    return file ? url(file.id) : undefined;
  };
  return (
    <div className="review-materials">
      {job.data?.title && <h3>{job.data.title}</h3>}
      {job.data?.summary && <p>{job.data.summary}</p>}
      <MarkdownBody fileUrl={fileUrl}>{job.data?.body || job.comment_body || ''}</MarkdownBody>
      {Object.entries(job.data?.fields || {})
        .filter(([, value]) => value)
        .map(([key, value]) => (
          <section key={key}>
            <h4>{labels[key] || key}</h4>
            <MarkdownBody fileUrl={fileUrl}>{value}</MarkdownBody>
          </section>
        ))}
      {files.length > 0 && (
        <section className="review-files" aria-label="关联图片与附件">
          <h4>图片与附件 · {files.length}</h4>
          {files.map((f) => (
            <div className="review-file" key={f.id}>
              {f.kind === 'image' && !f.deleted && f.scan_status !== 'blocked' && (
                <a href={url(f.id)} target="_blank" rel="noopener noreferrer">
                  <img src={url(f.id)} alt={f.original_name} loading="lazy" />
                </a>
              )}
              <div className="review-file-info">
                {f.deleted || f.scan_status === 'blocked' ? (
                  <b>{f.original_name}</b>
                ) : (
                  <a href={url(f.id)} target="_blank" rel="noopener noreferrer">
                    {f.original_name} ↗
                  </a>
                )}
                <small>
                  {size(f.size)} <Badge status={f.deleted ? 'deleted' : f.scan_status} />
                </small>
                {f.scan_reason && <small>{f.scan_reason}</small>}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
