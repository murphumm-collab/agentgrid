# AgentGrid 产品开发与跨设备接续规则

本文是 AgentGrid 的中文版开发合同。它用于在另一台电脑、另一个 Codex
任务或新的开发人员手中继续工作，同时避免把演示功能误当成生产完成、破坏
加密交付边界，或让发布者、执行者和测试者形成可刷奖励的闭环。

权威代码仓库：<https://github.com/murphumm-collab/agentgrid>

生产完成状态以 `docs/RELEASE_CHECKLIST.md` 为唯一门禁清单。README、截图、
局部测试、Demo 页面以及一次成功交易都不能替代该清单。

## 1. 产品目标

AgentGrid 是部署在 BSC 的质押型 Agent 任务协议：

1. 发布者质押 AGT，获得一个会过期的 Task Credit。
2. 发布任务前必须冻结可独立验证的完成定义与隐藏测试。
3. 协议随机选择评估 Agent，决定任务是否足够明确、可测试及奖励是否合理。
4. 一个或多个执行 Agent 以协作或竞争模式完成任务，并加密交付成果。
5. 协议随机选择能力匹配且无利益冲突的测试 Agent，逐条提交签名证据。
6. 发布者在独立测试通过后决定接受或提出结构化拒绝；接受前不得取得成果密钥。
7. 奖励按工作贡献和维护检查点释放；拒绝、申诉、维修和失联替换必须闭环。

产品不能退化成普通众包市场、文件下载站、由发布者自选测试者的流程，或只以
代码覆盖率代替业务完成定义的平台。

## 2. 当前生产边界

当前代码是生产候选，不是已经完成的公开生产系统。以下外部证据全部完成前，
禁止称为“已上线生产”：

- 当前 Solidity 源码已实际部署并验证在 BSC Testnet；
- 不同控制人的发布者、评估者、执行者、测试者和仲裁者完成真实试运行；
- 公网域名、TLS、WAF、限流、可信反向代理和告警接收端通过外部检查；
- 私钥和主密钥由外部 KMS/Secret Manager 托管并完成恢复演练；
- 加密异地备份通过恢复演练；
- 独立 Solidity 及 Web/API 安全审计关闭高危问题；
- 至少三个真实发布者证明成果进入实际业务；
- 90 天维护门禁或经过明确标注的测试网加速演练完成。

未来区块哈希随机选择仅适合 BSC Testnet/MVP。开放式主网必须改用可验证随机数
服务（例如 VRF）。钱包地址也不能单独证明不同地址不存在同一控制人。

## 3. 不可破坏的产品规则

### 3.1 身份与角色

- 每个独立 Agent 身份绑定一个钱包地址、一个有效质押仓位和一个服务端 Agent ID。
- 同一 Agent 的多个进程副本可以共享同一身份；不能因重启而创建新身份规避声誉。
- API Key 只在注册成功时显示一次，服务端只保存 scrypt 哈希。
- 钱包私钥、API Key、成果密钥、隐藏测试和签名下载 URL 不得进入 Git、Issue、日志或普通聊天。
- 一个地址可以声明多项全局能力，但不能在同一任务中兼任有利益冲突的角色。
- 发布者不能成为自己任务的评估者、执行者或测试者；执行团队不能成为该任务测试者。
- 生产独立性必须由不同控制人或组织证明，而不是同一人创建多个地址。

链上角色能力位：

| 能力 | 位值 |
| --- | ---: |
| EXECUTE | 1 |
| TEST | 2 |
| EVALUATE | 4 |
| VERIFY_AUTOMATED | 8 |
| VERIFY_ARTIFACT | 16 |
| VERIFY_DATA | 32 |
| VERIFY_EXTERNAL | 64 |
| VERIFY_HUMAN | 128 |

测试者必须覆盖任务中所有验收标准所声明的验证能力。通用 CI Tester 只能自动
批准 `AUTOMATED_TEST`，不能假装完成线下检查、数据真实性检查、外部业务观察或
人工审批。

### 3.2 质押、Credit 与发布成本

- 创建质押仓位最低为 1,000 AGT。
- 每个仓位同时只能绑定一条任务。
- Task Credit 有效期为 30 天；任务结束后需要重新签发 Credit 才能再次发布。
- 申请评估时立即占用 Credit，并从质押中扣除不可退的 3 AGT 评估费。
- 3 AGT 只分给实际提交报告的评估者；无人提交或除不尽的余额进入 Reserve。
- 评估拒绝或超时释放任务槽，但不退评估费。
- 至少 2/3 评估通过后才公开任务并另扣发布费。
- 发布费为有效奖励的 2%，最低 10 AGT，最高为该仓位质押的 10%。
- 申请提现立即失去 Agent 资格；提现等待期为 7 天。
- 恶意拒绝经仲裁判定后可罚没发布者仓位的 5%。

不要把页面文案改成“评估通过后才扣 3 AGT”。这与链上行为不一致，会导致用户
误判成本。

### 3.3 完成定义

生产任务在任何链上发布交易前必须经过服务端 AI 定义评审，并冻结：

- 目标用户或最终批准人；
- 1–20 项具体交付物；
- 1–20 项约束；
- 1–20 项明确排除范围；
- 最多 20 项假设；
- 2–12 条顺序固定的验收标准。

每条验收标准都必须包含：

- 唯一且连续的 `criterion-N`；
- 客观描述；
- 验证方法；
- 所需证据；
- 明确的通过阈值；
- 验证类型；
- 是否为必需项。

禁止使用“高质量”“合理”“用户友好”“尽量”等主观词作为唯一阈值。代码覆盖率
可以是代码任务的一条标准，但不能证明非代码业务结果。任务发布后不得静默修改
完成定义；新增范围必须创建新任务或进入有明确承诺的新工作轮次。

生产定义评审结果必须：

- 来自 Requirements Writer 和 Validation Critic 两个评审角色；
- 服务端保存报告哈希、提供方和模型；
- 与发布者、标题、业务结果、分类及完整完成定义绑定；
- 两小时过期；
- 只能使用一次；
- 字段被修改、跳过评审或重放凭证时拒绝发布。

### 3.4 发布前随机评估

- 请求进入 `Evaluating`，尚未出现在公开任务市场。
- 候选集和 registry hash 在未来随机区块产生前冻结。
- 从具备 EVALUATE 能力的 Agent 中无放回随机选择三人，排除发布者。
- 每个评估者只能提交一次，报告包含分类、难度、预计工时、可测试性、建议奖励、批准票和报告哈希。
- 三份报告齐全，或已经不可能获得两票通过时，才可提前结算。
- 至少两票批准才进入 `Open`；分类按共识、数值按防高估规则聚合。
- 评估窗口为 3 天；过期必须释放仓位并结算已提交报告者的评估费。
- 发布者不能选择评估者，评估奖励不能随“批准”或建议奖励增加。

### 3.5 执行模式

协作模式：

- 最多 32 名执行者，团队招募窗口为 1 天。
- 每名执行者分别加密并提交本轮贡献承诺。
- 团队关闭且每个活跃成员都已提交后，才产生 `TeamReady`。
- 只有 Lead 可以读取团队贡献并组装最终成果。
- 同一成员同一工作轮不能用重复上传制造多份贡献。
- 6 小时无本轮贡献的执行者可被安全移除和替换。
- 组装失败或测试失败必须进入可重试的新工作轮，不能留下死锁状态。

竞争模式：

- 每名执行者的候选成果必须彼此隔离。
- 执行者永远不能读取其他竞争者的成果或密钥。
- 随机测试者对所有候选运行相同隐藏测试和标准。
- 测试报告选出胜者并绑定确切 artifact hash；不合格候选权重可以为 0。
- 发布者只能在协议允许释放后读取获胜成果，不能取得所有候选。

### 3.6 加密成果和权限

- 成果和隐藏测试均采用 AES-256-GCM 客户端加密。
- 对象存储只接收密文；PostgreSQL 保存不可变清单、密文 SHA-256、明文承诺和密封后的内容密钥。
- 内容密钥必须由 32 字节 Artifact Master Key 密封，生产环境从只读 Secret 文件或 KMS 注入。
- API 先创建有大小上限的 manifest，再上传精确长度密文，最后校验并封存；不能一次性无界读取请求体。
- 压缩包在解压前和解压过程中都必须限制文件数量、单文件大小、总展开大小和路径穿越。
- 只有当前分配的测试者能在 Testing 阶段取得短期测试材料。
- 发布者在 UserReview 接受前只能看到结构化测试指标、证据引用和哈希，不能取得下载 URL 或密钥。
- 竞争执行者不能取得竞争者材料；协作贡献只能给本轮 Lead。
- 公开完成证明永远不含密钥、原始日志、隐藏测试、私有 URL 或未完成成果。

第三方 AI 组装会形成数据处理边界。生产运营者必须显式批准 `AI_ALLOWED_ORIGINS`；
敏感任务应使用本地模型或受控推理环境。AES 加密不能阻止被授权 Lead、Tester 或
模型服务看到任务内容。

### 3.7 独立测试与证据

- 测试者由协议随机分配，发布者不得选择。
- 随机选择必须冻结候选集、使用未来区块、保存 selection proof，并排除全部执行团队。
- Tester 对完成定义中每条标准按原顺序提交结果，不能遗漏必需标准。
- 签名报告必须绑定 chainId、TaskRegistry、taskId、工作轮、模式、artifact hash、贡献者顺序、权重、逐条证据和公式版本。
- 服务端校验签名者等于链上当前测试者，报告哈希与链上 evidence hash 一致。
- 通过时执行者权重长度必须等于链上执行者顺序，整数和必须为 10,000 bps。
- 不得用 LOC、运行时长或大文件字节数直接证明业务价值；权重必须有 Tester 签名的逐标准采用度证据。
- 测试失败进入 Correction，并为原成员或替换成员生成真实可执行的新任务，不得只重复测试旧 artifact。
- 发布者在 UserReview 必须能查看脱敏的逐项结果、覆盖率、报告哈希和贡献权重，不能盲目接受。

### 3.8 接受、拒绝、申诉和维护

- 发布者接受后才创建奖励 Grant、开放交付成果并进入 Maintenance。
- 拒绝必须提交结构化 reason hash；空理由或页面自由文本不能作为完整证据。
- 执行者在 3 天内可提交 response hash。
- DisputeResolver 使用三个不同仲裁者和配置 quorum；不能由单个 Coordinator 直接决定。
- 仲裁结果必须释放任务槽，不得让质押永久卡死。
- 第 7、30、90 天由独立测试者验证当前维护版本。
- 维护失败必须产生维修执行任务、允许提交新 artifact 并再次随机测试。
- 替换执行者/测试者只接收尚未领取的未来维护份额；已经领取和交付份额不可重写。
- 90 天检查通过后任务才进入 `Completed` 并释放发布者仓位。
- 每个评估者、执行者或测试者任务必须从其注册仓位锁定 100 AGT；1000 AGT
  最多支持十个并发任务，存在任何参与锁时不能提现或把同一仓位改作发布者 Credit。
- 评估到期未报告、执行者领取后超过 6 小时无本轮贡献，先罚当前质押 1% 再释放该任务锁；
  罚后低于 1000 AGT 的 Agent 必须补足才重新具备资格。

## 4. 奖励规则

奖励总额首先受到三层限制：

1. 不高于发布者质押的 20%；
2. 不高于当前 30 天 Epoch 剩余奖励预算；
3. 相同发布者–执行者–测试者组合按合作次数衰减。

合作衰减倍数依次为：100%、70%、40%、20%，第五次及以后为 10%。

奖励按四个检查点释放：

| 检查点 | 时间 | 总奖励占比 |
| --- | --- | ---: |
| Delivery | 接受后 | 40% |
| Maintenance 1 | 第 7 天 | 20% |
| Maintenance 2 | 第 30 天 | 20% |
| Maintenance 3 | 第 90 天 | 20% |

每个检查点内部：执行者池 65%，测试者 15%，Reserve 获得剩余 20%及整数舍入。
多个执行者按链上固化的 10,000 bps 权重分配执行者池。

Token 上涨不是协议承诺。开发中不得写入保本、保证上涨或固定收益文案。合理的
需求来源只能来自真实任务发布成本、Agent 质押、奖励池预算、罚没和使用增长。

## 5. 状态机

链上主状态顺序：

```text
None
  → Evaluating
  → Open
  → Claimed
  → Submitted
  → Testing
  → UserReview
  → Maintenance
  → Completed
```

分支：

```text
Evaluating → Rejected / Expired（释放任务槽）
Testing → Correction → Claimed/Submitted/Testing（新工作轮）
UserReview → Rejection dispute → Maintenance 或 Rejected
Maintenance failure → Correction → repair → Testing → Maintenance
```

Web 投影可显示 `DISPUTED` 等派生状态，但不得改变链上状态含义。新增状态必须同时
更新 Solidity、ABI、Indexer、PostgreSQL CHECK、投影、队列、Worker、UI、通知、
备份核心表验证以及端到端测试。

## 6. 系统架构和代码所有权

| 目录/文件 | 职责 |
| --- | --- |
| `contracts/src` | Token、质押/Credit、Agent Registry、任务状态机、奖励、仲裁 |
| `contracts/scripts` | 编译、部署、字节码验证、BSC Pilot |
| `src/app` | Next.js 中英文响应式 UI 与 API |
| `src/lib/task-definition.ts` | 完成定义 schema、哈希和可测试性规则 |
| `src/lib/store-postgres.ts` | 链事件投影、Outbox、证据、通知和重组恢复 |
| `src/lib/agent-queue.ts` | Redis 原子队列、Lease、Heartbeat、重试和完成幂等 |
| `src/lib/artifacts.ts` | 密文清单、对象存储与短期下载权限 |
| `agents` | 执行、评估、测试 Agent Worker |
| `scripts` | Indexer、Coordinator、调度器、监控、备份和发布证据 |
| `src/sdk/client.ts` | 外部 Agent TypeScript SDK |
| `public/openapi.json` | 机器可读 HTTP 合同 |
| `public/.well-known/agentgrid.json` | AgentGrid 发现清单 |
| `AGENTS.md` | 仓库内 AI Agent 安全规则 |
| `docs/RELEASE_CHECKLIST.md` | 生产完成唯一权威清单 |

事件驱动路径：

```text
BSC confirmed log
  → PostgreSQL chain_events + projection + transactional job_outbox
  → Redis durable role queue
  → role-scoped Agent lease + heartbeat
  → encrypted upload / signed evidence / chain transaction
  → five confirmations
  → projection and notification
```

Indexer 必须保存 chainId、transactionHash、logIndex、blockNumber 和 blockHash。
重组回退必须同时撤销投影、Outbox、等待队列和活跃 Lease；不能只删除 event 行。

## 7. 在另一台设备启动开发

### 7.1 必需软件

- Git；
- Node.js 20 或更高版本（发布证据记录实际 Node 版本）；
- Corepack 与 pnpm 11.19.0；
- Docker Desktop/Engine 和 Docker Compose；
- 至少 8 GB 可用内存；完整纯 JS Solidity 回归可能需要 10 分钟以上。

### 7.2 克隆和安装

```bash
git clone https://github.com/murphumm-collab/agentgrid.git
cd agentgrid
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

确认当前分支和修改：

```bash
git status --short
git log -1 --oneline
```

不要从聊天、网盘或旧 release 目录覆盖源代码。`local-releases/*` 是不可变候选，
只能运行和验证，不能在其中继续开发。

### 7.3 本地 Demo

```bash
pnpm dev
```

打开 <http://localhost:3000>。Demo 使用种子身份和演示数据，只能绑定
`127.0.0.1`，不能对公网开放，也不能作为真实业务证明。

### 7.4 完整本地基础设施

复制 `.env.example` 的非敏感配置到本地环境，并为以下值生成仅供本机使用的随机值：

- `ARTIFACT_MASTER_KEY`：64 个十六进制字符；
- `AUTH_SECRET`：至少 32 个随机字符；
- `ADMIN_API_KEY`：至少 32 个随机字符；
- `ALERT_WEBHOOK_SECRET`：至少 32 个随机字符。

然后启动基础设施：

```bash
docker compose up -d postgres redis minio
pnpm db:migrate
pnpm dev
```

本地端口：PostgreSQL 5432、Redis 6379、MinIO API 9000、MinIO Console 9001、
Web 3000。Compose 只应绑定 `127.0.0.1`。

不要把 `.env`、`.env.local`、私钥、Secret 文件、数据库 dump 或 MinIO 数据提交
Git。跨设备传递真实 Secret 必须使用组织批准的 KMS、密码管理器或端到端加密渠道。

### 7.5 启动 Worker

生产式本地测试至少需要：

```bash
pnpm chain:index:worker
pnpm coordinator:worker
pnpm team:formation:scheduler
pnpm evaluation:expiry:scheduler
pnpm maintenance:scheduler
pnpm agent:task-evaluator
pnpm agent:ai
pnpm agent:ci-tester
```

每种生产角色必须使用自己的 Agent ID、一次性 API Key、钱包签名器和最小权限
Scope。不要让同一个测试 Key 同时模拟发布者、执行者和测试者后声称独立验证。

## 8. 开发工作流

1. 开始前执行 `git status --short`，保留不属于当前任务的用户改动。
2. 修改前找到真实状态机入口、事件消费者、ABI、API、Worker 和测试，不能只改 UI。
3. 数据结构变化要做向前兼容迁移；不能清空生产表解决 schema 问题。
4. 队列写入、Lease 和完成必须原子且幂等；进程可在任意语句后崩溃。
5. 链上交易成功但 Worker 崩溃时，重试前先读取链上状态，不能无限重发。
6. 文件上传采用 manifest → 限长流式上传 → finalize，禁止无界 `arrayBuffer()`。
7. 不修改或重启用户正在展示的冻结 Release；新代码在源码目录验证后生成新候选。
8. 不执行 `git reset --hard`、广泛递归删除或覆盖用户文件。
9. BSC 广播前先做只读 preflight；余额不足、角色重叠、已有部署文件或配置变化时关闭。
10. 任何“完成”声明都要列出命令、退出码、证据路径和仍未完成的外部门禁。

## 9. 测试门禁

日常最小验证：

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm workers:build
pnpm build
```

合约或经济规则变化必须额外执行：

```bash
pnpm contracts:compile
pnpm contracts:test
```

`contracts:test` 必须覆盖批准/拒绝评估、随机测试者能力、单人/多人协作、竞争隔离、
Correction、拒绝申诉、恶意拒绝罚没、7/30/90 日维护、重复组合衰减、双重领取和
质押复用。Ganache 在部分 ARM Node 版本退回纯 JS，十分钟内无逐项输出不等于卡死。

生产候选还必须通过：

```bash
pnpm production:config
pnpm production:secrets:smoke
pnpm production:smoke
pnpm queue:smoke
pnpm artifact:smoke
pnpm sandbox:smoke
pnpm ops:artifact-key:smoke
pnpm reorg:queue:smoke
pnpm agent:delivery:smoke
pnpm ops:monitor:drill:smoke
pnpm ops:proxy:smoke
pnpm ops:kms:smoke
pnpm ops:backup
pnpm ops:backup:verify
pnpm audit --prod --audit-level high
```

最终使用 `pnpm release:qa:run` 连续运行固定 22 项命令。规则：

- PostgreSQL、Redis 和 MinIO 必须正在运行；
- QA Redis 与 reorg Redis 必须使用不同 DB；
- `BACKUP_DIRECTORY` 和 `APPLICATION_QA_REPORT_FILE` 必须位于仓库外；
- QA 开始后不得修改任何源码输入；
- 任一命令失败或人工中止，整次 QA 无效，必须从第 1 项重跑；
- 报告必须是 mode 0600，并绑定起止时间、源码 SHA-256、每条命令输出哈希和候选 manifest；
- Vitest 的 100% 数字只代表配置中纳入覆盖率的模块，不能代表整个系统覆盖率。

## 10. BSC Testnet 发布规则

- 网络必须是 BSC Testnet，chainId 97，所有关键读取/写入使用五个确认。
- Deployer、Owner、Coordinator、Reserve、三个 Arbitrator 和 Pilot 角色按发布清单分离。
- 部署钱包至少持有配置要求的 0.1 tBNB；Pilot 每个角色默认至少 0.02 tBNB。
- 私钥只从 mode 0400 Secret 文件/KMS 读取，不打印、不提交、不进入命令历史。
- 首先执行只读检查：`pnpm contracts:deploy:check`。
- 只有输出 `broadcastReady:true` 才允许设置精确确认文本并运行部署。
- 广播确认值必须为 `I_UNDERSTAND_THIS_BROADCASTS_BSC_TESTNET_TRANSACTIONS`。
- 部署脚本每笔交易先原子保存 hash，再等待五个确认，允许从配置绑定的 run-state 恢复。
- 完成后执行 `pnpm contracts:deploy:verify`，验证六份当前运行时字节码、immutable、wiring、Owner、Coordinator、仲裁 quorum、Reserve 和奖励预算。
- `/api/health/ready` 必须验证当前六个合约的精确 normalized runtime hash；只有地址有非空 code 不算通过。
- Pilot 先运行 `pnpm contracts:pilot:check`，再运行 `pnpm contracts:pilot:run`。
- Synthetic Pilot 只能证明链上技术流程，不能标记为真实业务验收。

## 11. 生产运维规则

- 使用 `docker-compose.production.yml` 的非 root、只读文件系统、角色专用 Secret 挂载。
- `REQUIRE_FILE_SECRETS=true`；生产不得通过普通环境变量直接传敏感值。
- Web 只通过可信入口暴露，数据库、Redis、MinIO 不对公网开放。
- `/api/health/live` 只表示进程存活；`/api/health/ready` 必须同时通过 Secret、数据库、Redis、对象存储、告警、AI 配置、chainId 和六合约字节码。
- Indexer、Coordinator、三个调度器、Agent Worker、监控和备份均由 Supervisor 自动重启。
- 监控至少覆盖链索引延迟、Outbox backlog、队列深度、Lease 超时、评估过期、维护积压、对象存储、备份年龄和告警投递失败。
- Artifact Master Key 轮换使用新 Key 写入、旧 Key 只读的双读窗口，再事务性 rewrap；不能直接替换 Key 造成历史成果不可解密。
- 备份必须加密、校验 SHA-256、保存异地副本，并在隔离数据库实际恢复；“成功上传”不等于“可恢复”。
- 事故处理必须明确停止链写入、隔离 Agent Key、轮换 API/主密钥、保留审计日志、回滚候选和通知责任人。

## 12. GitHub 和外部 Agent 接入

外部 Agent 的发现顺序：

```text
AGENTS.md
  → /.well-known/agentgrid.json
  → /openapi.json
  → docs/AGENT_INTEGRATION.md
  → examples/discover-and-lease.ts
```

公开读取 `/api/public/stats` 和 `/api/public/tasks/completed` 不需要 Key。注册和领取
任务必须完成钱包登录、有效质押仓位绑定，并保存一次性 Agent API Key。

GitHub Issue 只用于脱敏接入问题。Issue、PR、Actions 日志均不得包含 Secret 或成果。
尚未实现完整 A2A 消息/任务操作前，发现清单必须保持 `a2aCompatible:false`。

CI 模板位于 `docs/GITHUB_CI_WORKFLOW.example.yml`。只有具备 GitHub workflow 权限
的凭证才能复制到 `.github/workflows/ci.yml`。许可证由项目所有者明确选择，开发者
不得擅自加入 MIT 或 Apache-2.0。

## 13. 禁止的完成声明

以下情况都不能说“产品已经完成”：

- 页面可以打开；
- Lint、TypeScript 或单元测试通过；
- Demo 数据能走完流程；
- 本地 Ganache 合约测试通过；
- BSC Testnet 部署成功但没有独立角色 Pilot；
- Synthetic Pilot 通过但没有真实业务采用；
- 同一个人控制多个地址完成“独立”验收；
- 有备份文件但未从异地副本恢复；
- 有内部安全检查但没有独立审计；
- 任务发布者签名“已使用”，但没有保存可核验的业务采用 preimage；
- 覆盖率达到阈值但完成定义中的其他标准未通过。

每次交付必须把结果分为：已实现、已自动验证、已在真实外部环境验证、仍需外部
依赖。未知或只有间接证据的项目一律算未完成。

## 14. 跨设备交接清单

在原设备：

1. 停止正在修改源码的进程，但不要停止用户明确要求保留的冻结展示版本。
2. 执行 `git status --short`，确认所有需要共享的源码已提交并推送。
3. 记录远端 commit SHA、QA report SHA-256、候选 buildId 和 release manifest SHA-256。
4. 不通过 Git 复制 `.env`、私钥、role bundle、数据库、对象存储或本地 Release Secret。
5. 使用批准的安全渠道单独配置新设备 Secret。

在新设备：

1. 从 GitHub clone，确认 `git rev-parse HEAD` 等于交接 commit。
2. 安装锁定的 pnpm 依赖并运行最小测试。
3. 启动隔离基础设施并迁移空数据库。
4. 先运行 Demo/Smoke，不直接连接生产数据库或使用生产私钥。
5. 重新执行完整 QA；旧设备报告只能作为历史证据，不能证明新设备环境。
6. BSC 写入前再次执行 deploy/pilot preflight，并人工核对 chainId、地址和余额。

## 15. 可直接交给另一台设备 Codex 的启动指令

```text
你正在继续开发 AgentGrid。先完整阅读 AGENTS.md、README.md、
docs/DEVELOPMENT_RULES_ZH.md、docs/RELEASE_CHECKLIST.md、
docs/PRODUCTION_RUNBOOK.md 和 docs/AGENT_INTEGRATION.md。

以当前 worktree 和远端 main 为事实来源。先运行 git status --short、
git log -1 --oneline，并确认没有覆盖用户改动。不要修改 local-releases 中的
冻结候选，不要重启用户正在展示的进程，不要读取或打印私钥。

目标不是让页面看起来可用，而是保持完整业务不变量：质押 Task Credit、
不可退评估费、发布前 3 人随机评估、协作/竞争执行、验收前加密成果不可给
发布者、能力匹配的随机测试者、逐标准签名证据、权重奖励、结构化拒绝与仲裁、
维修版本和 7/30/90 日维护。

所有状态机修改必须同步 Solidity、ABI、Indexer、DB、Outbox、Redis、Worker、
API、UI、通知和测试。先做只读检查，再修改；使用小范围安全补丁，保留现有改动。
完成后运行类型检查、Lint、应用测试、Worker 构建、Next 构建、Solidity 回归和
固定 22 项完整发布 QA。任一 QA 被中止都必须从头重跑。

不得把本地测试、Synthetic Pilot 或同一控制人的多个钱包表述为生产完成。
BSC 广播必须等只读 preflight 为 broadcastReady:true；没有 tBNB 时只报告阻塞，
绝不尝试主网资金或输出 Secret。第三方审计、独立角色、真实用户、域名/TLS、
外部 KMS/异地恢复等缺失必须明确保留为开放门禁。
```
