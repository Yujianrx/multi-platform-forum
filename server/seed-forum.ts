import { type AppContext, id, hash, audit } from './core.js';
import { contentData } from './content.js';
export async function seedForum(ctx: AppContext) {
  if (ctx.production) throw new Error('生产环境禁止导入示例话题');
  const { db } = ctx;
  if (!(await db.query("SELECT id FROM audit_logs WHERE action='development.seed' LIMIT 1")).length)
    throw new Error('仅允许在已初始化的开发示例库补充论坛示例');
  if (
    (await db.query("SELECT id FROM audit_logs WHERE action='development.forum-seed' LIMIT 1"))
      .length
  )
    return;
  const users = await db.query(
      "SELECT id,username FROM users WHERE username IN ('admin','lin.xia','chen.yu','zhou.ning') ORDER BY username",
    ),
    cats = await db.query('SELECT id,name FROM categories');
  const user = (name: string) => users.find((u) => u.username === name)!.id,
    cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const resource = (
    await db.query(
      "SELECT c.id FROM contents c JOIN revisions r ON r.id=c.published_revision_id WHERE c.type='skill' AND c.visibility='company' AND c.state='published' ORDER BY c.created_at LIMIT 1",
    )
  )[0];
  const examples = [
    {
      title: '欢迎来到讨论区：好问题，也是共创的开始',
      kind: 'discussion',
      board: '办公提效',
      author: 'admin',
      pinned: true,
      body: '## 这里可以聊什么？\n\n不用准备完整的分享文章，你可以直接开帖：\n\n- **遇到问题**：说明场景、报错和尝试过的方法。\n- **分享发现**：聊聊好用的工具、工作习惯或一点灵感。\n- **提出建议**：给项目、技能包和社区提反馈。\n- **随意交流**：欢迎不同岗位的同事一起参与。\n\n在资源详情页点击「发起讨论」，就可以把话题和那份内容关联起来。\n\n> 友善交流，避免在帖子中放入客户隐私、密码等敏感信息。',
      replies: [
        '这个入口很实用，以后遇到零散的小问题也有地方交流了。',
        '建议提问时附上预期结果和实际结果，大家会更容易帮忙。',
      ],
    },
    {
      title: '大家是怎么用 AI 整理每周工作记录的？',
      kind: 'question',
      board: '办公提效',
      author: 'zhou.ning',
      body: '试过直接把一周的记录交给 AI，输出看起来很完整，但容易漏掉需要跟进的小事项。\n\n大家会先按项目整理，还是按日期记录？希望找到一个不增加太多日常操作的办法。',
      replies: [
        '我按项目维护三列：已完成、待确认、下一步。每天只加事实，周五再汇总。',
        '可以在输入里明确要求：每条待办保留负责人和截止时间，缺失的信息标记待确认。',
      ],
    },
    {
      title: '技能包安装后，如何确认运行环境配置正确？',
      kind: 'question',
      board: '研发技术',
      author: 'lin.xia',
      related: resource?.id,
      body: '准备试用这份技能包，想先做一次环境自检。\n\n除了核对依赖版本，大家通常还会检查哪些配置？有没有适合新同事的快速检查清单？',
      replies: [
        '可以按顺序检查：依赖是否安装、工作目录是否正确、输入文件是否能读取，最后用示例数据跑一次。',
      ],
    },
    {
      title: '做 AI 原型时，你会先画流程还是先写提示词？',
      kind: 'discussion',
      board: '设计创作',
      author: 'lin.xia',
      body: '最近在做一个内部工具原型，发现先写提示词容易陷入细节，先画流程又担心忽略模型实际能力。\n\n我现在的做法是：先画一条最短流程，再用真实样例验证关键一步。大家有什么不同的实践？',
      replies: ['我会先写输入和输出的例子，这样产品与开发对验收结果比较容易达成一致。'],
    },
    {
      title: '建议给常用提示词加上适用场景和反例',
      kind: 'feedback',
      board: '业务应用',
      author: 'zhou.ning',
      body: '同一个提示词换到不同场景，结果可能差很多。建议分享时补充：\n\n1. 适合处理什么任务。\n2. 哪些场景不适用。\n3. 一个正确输入和一个容易误用的反例。\n\n大家觉得还有哪些信息值得一起保留？',
      replies: [],
    },
    {
      title: '这周你发现了什么有趣的 AI 小用法？',
      kind: 'chat',
      board: '数据分析',
      author: 'chen.yu',
      body: '开一个轻松的交流帖。不一定是大项目，也许只是让日常工作少一步操作的小发现。\n\n欢迎贴出你的使用场景，说说哪里好用、哪里还需要人工把关。',
      replies: ['让 AI 帮忙列出一份表格中值得人工核对的异常情况，比直接让它给结论更有用。'],
    },
  ];
  await db.transaction(async (tx) => {
    for (let i = 0; i < examples.length; i++) {
      const e = examples[i],
        cid = id(),
        rid = id(),
        uid = user(e.author),
        time = new Date(Date.now() - (examples.length - i) * 86400000).toISOString();
      const data = contentData.parse({
        title: e.title,
        summary: e.body.slice(0, 180),
        body: e.body + '\n\n_开发环境示例话题，用于体验论坛交互。_',
        categoryId: cat(e.board),
        visibility: 'company',
      });
      await tx.query(
        "INSERT INTO contents(id,author_id,type,category_id,pinned,created_at) VALUES($1,$2,'discussion',$3,$4,$5)",
        [cid, uid, data.categoryId, !!e.pinned, time],
      );
      await tx.query(
        'INSERT INTO forum_topics(content_id,kind,related_content_id) VALUES($1,$2,$3)',
        [cid, e.kind, e.related || null],
      );
      await tx.query(
        "INSERT INTO revisions(id,content_id,number,data,digest,status,reason,created_at) VALUES($1,$2,1,$3::jsonb,$4,'approved','开发示例内容',$5)",
        [rid, cid, JSON.stringify(data), hash(JSON.stringify(data)), time],
      );
      await tx.query(
        "UPDATE contents SET state='published',latest_revision_id=$2,published_revision_id=$2,published_at=$3 WHERE id=$1",
        [cid, rid, time],
      );
      await tx.query('INSERT INTO forum_subscriptions(content_id,user_id) VALUES($1,$2)', [
        cid,
        uid,
      ]);
      for (let j = 0; j < e.replies.length; j++)
        await tx.query(
          "INSERT INTO comments(id,content_id,author_id,body,digest,status,reason,created_at) VALUES($1,$2,$3,$4,$5,'approved','开发示例回复',$6)",
          [
            id(),
            cid,
            users[(i + j + 1) % users.length].id,
            e.replies[j],
            hash(e.replies[j]),
            new Date(Date.now() - (examples.length - i) * 3600000 + j * 60000).toISOString(),
          ],
        );
    }
    await audit(tx, user('admin'), 'development.forum-seed', 'database', {
      topics: examples.length,
    });
  });
}
