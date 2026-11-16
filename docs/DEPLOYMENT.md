# Linux 容器部署、备份与恢复

## 环境假设

尚未连接美国服务器，以下配置没有在那台服务器运行，也没有上线。假设 Linux x86-64/ARM64、Docker Engine 与 Compose v2、可持久化磁盘、可用域名和 80/443 端口。建议小规模试用从 2 vCPU / 2 GiB 内存与 20 GiB 磁盘起；启用 ClamAV 建议至少 4 GiB。容量取决于附件量与并发，正式上线前应做本机容量验证。

Node 22 + Fastify 单体服务，PostgreSQL 17，私有本地存储卷，Caddy HTTPS。上传上限 100 MiB，每个上传和下载最多在应用内持有该文件大小的缓冲；初版适合低到中等并发，部署时按内存限制并发并监控，后续可改为流式存储。嵌入式 PGlite 仅用于本地单进程开发，生产强制 DATABASE_URL。

## 首次部署

```bash
# 上传完整源码并进入项目目录
cp deploy/production.env.example .env
chmod 600 .env
# 编辑 APP_DOMAIN，并用 openssl rand -hex 32 生成 POSTGRES_PASSWORD
# 密码用十六进制，避免连接 URL 中的转义问题。
docker compose config --quiet
docker compose build
docker compose up -d db
docker compose run --rm app node dist/server/cli.js migrate

# 管理员密码不写入源码、命令历史或 Compose 文件。
read -r -p '管理员账号（例如 admin）: ' ADMIN_USERNAME
read -r -s -p '管理员密码（6–20位，无需字母数字组合）: ' ADMIN_PASSWORD
echo
export ADMIN_USERNAME ADMIN_PASSWORD
docker compose run --rm -e ADMIN_USERNAME -e ADMIN_PASSWORD app node dist/server/cli.js admin
unset ADMIN_USERNAME ADMIN_PASSWORD

docker compose up -d
docker compose ps
docker compose logs --tail 100 app
```

Docker 容器使用编译后的 CLI，因此不依赖生产未安装的 TypeScript 工具。不要在 production 使用 `seed` 或开发访问说明中的密码。Compose 中生产审核固定为 none，配置真实适配器前人工复核。

应用内部端口不映射公网，仅 Caddy 暴露 80/443。数据库与 ClamAV 不暴露宿主端口。让 DNS 指向服务器，Caddy 会按域名申请证书；如果公司只允许内网/VPN 访问，请在防火墙和企业网络层配置相应入口。管理员先创建部门、标签、工具名称，再生成邀请码。

当前示例镜像使用官方维护的 Node 22、PostgreSQL 17、Caddy 2 和可选 ClamAV 标签；上线前应拉取、扫描并固定镜像 digest。npm 依赖已由 package-lock.json 锁定。

### 可选恶意文件扫描

将 `.env` 中 `CLAMAV_HOST=clamav`，执行 `docker compose --profile scanner up -d`。病毒库首次下载可能耗时。上传测试文件并检查后台实际 scan_status；不得仅凭“已配置”当作服务健康。

### 已有反向代理

若使用已有 Nginx/Caddy，可移除示例 caddy 服务，把 app 端口仅映射为 `127.0.0.1:3000:3000`，由现有代理转发。必须保留 HTTPS、Cookie 转发、正确 Host/Origin、105 MiB 请求体限制及充足超时。只有经过一个可信代理时才设置 TRUST_PROXY=true。

## 更新与回滚

1. 先备份同一时刻的数据库和文件卷。
2. 查看迁移差异，禁止多个部署进程同时迁移；本首版迁移是初始建表。
3. `docker compose build`，然后 `docker compose up -d app`；服务启动检查迁移。
4. 验证健康、登录、邀请、部门隔离、发布审核与文件下载。
5. 回滚需保留上个应用镜像；若数据库迁移不向后兼容，应恢复对应数据库与附件备份，不能仅切镜像。

## 备份

```bash
bash deploy/backup.sh /srv/backups/ai-community
```

脚本暂停应用写入，导出 PostgreSQL 自定义格式 dump 和私有附件卷，并产生 SHA256 清单，随后恢复服务。备份会造成短暂停机，请在维护时间执行。将备份复制到不同磁盘/机房并加密；不要只保存在同一服务器。备份目录权限建议 0700，文件 0600；另行安全保存 `.env`、域名配置和镜像版本。

## 恢复

在隔离环境先演练，确认校验和。只使用可信备份包。

```bash
sha256sum -c /srv/backups/ai-community/checksums-TIMESTAMP.txt
bash deploy/restore.sh /srv/backups/ai-community/community-TIMESTAMP.dump /srv/backups/ai-community/uploads-TIMESTAMP.tar.gz
```

恢复脚本明确确认后覆盖数据库。附件以备份内容覆盖同名文件，不主动删除额外孤立文件，避免误删；恢复后由管理员按数据库清点多余文件。不能用不可信 tar 文件执行恢复。恢复后抽查不同部门账号、历史版本、隔离文件和未完成任务。

## 本地开发数据备份

先停止本地服务，再完整复制 `data/`（`pg/` 与 `uploads/` 同时复制）。不要在 PGlite 正运行时直接拷贝数据库目录，也不要开两个进程使用同一个目录。PGlite 数据目录不能直接作为正式 PostgreSQL 的物理数据目录；开发示例不迁移到生产。

## 上线前仍需提供

- 服务器系统、架构、CPU/内存/磁盘及现有 Docker/反向代理情况。
- 域名、DNS、HTTPS 与公司内网/VPN 访问策略。
- 真实审核供应商、服务区域、支持类别及服务端凭证；ClamAV 实例与病毒库更新策略。
- 初始管理员、正式部门和明确的公司审核规则。
- 备份保存位置、保留周期与恢复演练负责人。

## 登录验证码与部门迁移

服务启动自动执行 008（验证码摘要表）和 009（部门排序与组织名称）迁移。升级前备份数据；009 会保留原演示部门 ID，仅对应重命名并补齐 13 个组织，不删除额外自定义部门。

验证码有效期 120 秒，登录校验和刷新均在服务端处理。数据库只保存 HMAC-SHA256 校验摘要、HttpOnly 随机浏览器凭证的摘要和有效期；PNG 中显示验证码，接口无答案字段，日志不记录密码与验证码。无需第三方验证码服务或额外密钥；必须保留 HTTPS 和 Cookie，正式环境凭证 Cookie 设置 Secure。

容器运行层安装 fonts-dejavu-core 供验证码栅格渲染，并复制 public 品牌素材参与前端构建。非容器 Linux 部署也应安装可供 fontconfig 使用的英文字体。当前未在本机运行 Docker，目标服务器仍需构建与启动验收。
