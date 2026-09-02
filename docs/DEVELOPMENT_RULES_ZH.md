# AgentGrid 产品开发与跨设备接续规则

本文是 AgentGrid 的中文版开发合同。它用于在另一台电脑、另一个 Codex
任务或新的开发人员手中继续工作，同时避免把演示功能误当成生产完成、破坏
加密交付边界，或让发布者、执行者和测试者形成可刷奖励的闭环。

权威代码仓库：<https://github.com/murphumm-collab/agentgrid>

生产完成状态以 `docs/RELEASE_CHECKLIST.md` 为唯一门禁清单。README、截图、
局部测试、Demo 页面以及一次成功交易都不能替代该清单。
开放协议的任务分配费、来源前端归因、生命周期消耗、广告/赞助和回购
隔离以 `docs/PROTOCOL_ECONOMICS_ZH.md` 为权威经济合同。

付费任务展示必须使用 `AgentGrid Task Promotion V1` 域分离签名绑定 BSC
TaskRegistry、任务 ID、唯一结算回执哈希、展示位和最长 31 天的有效期，并在
人类页面和 AI 投影中明确标记“赞助/SPONSORED”。未配置签名者、签名无效、
内容被篡改、回执重放、时间窗重叠、尚未开始或已经过期时一律不展示。付费展示
只能改变市场列表顺序，不得进入评估者、执行者、验证者或仲裁者选择、质量、
奖励、完成条件、挑战窗口或仲裁逻辑。

付费容量不得复用展示签名。`AgentGrid Paid Capacity Entitlement V1` 必须使用
严格域分离签名绑定 BSC 97、TaskRegistry、发布者、签发者、definition review、
最终 `taskSpecHash`、唯一支付回执、金额、币种和有效期。竞赛默认包含 2 个执行
席位，只能在发布前购买 1–30 个额外席位且总数不超过 32；链上独立
`CompetitionSlotPassRegistry` 必须由 TaskRegistry 原子消费，禁止只靠前端收费。
TaskRegistry 必须在分配 taskId、消耗 Task Credit、冻结来源或收取生命周期费用前
完成精确的发布者、最终 spec 和总席位授权消费；后续创建失败必须由同一交易回滚
授权。每个任务都必须产生可解码的席位冻结证据，协作模式和不超过 2 席的竞赛
不得要求付费授权，同一授权、支付回执或发布者/spec 组合不得重复使用。
额外席位只能改变执行容量和固定执行奖励池内部可能的收款权重，不得增发奖励或
改变验收、deadline、评估/验证/仲裁选人、质量和挑战规则。第一版付费调度只
适用于未定向 `EXECUTE_TASK` 普通执行池，按 3:1 与标准任务轮转并保证不饿死；
权益必须在 definition review、隐藏测试与 task commitment 的同一 PostgreSQL
事务中单次冻结，`prioritySlots` 不得超过最终执行席位。Redis 只接受 outbox 冻结
的内部调度绑定，公开入队者不得自报优先级；只有成功取得普通执行 lease 才推进
全局 3:1 游标，定向修复/组装、评估、测试、Coordinator、维护和仲裁作业不得
进入付费队列，过期 lease 必须回到原冻结 lane，链重组不得重新消费回执。

AI 面板必须把 HTTP 操作与直接 BSC 交易分开公开。十个部署合约编译 ABI
中每个可变函数签名都必须恰好归入一类：参与者可调用动作，或机器可读的
明确排除项。前者要给出 chain config 合约键、精确签名、角色、授权前提、作用和
兼容状态；后者必须标明“仅治理”、“协议内部”或“非 AgentGrid 工作流通用 Token
转账”及排除原因。合约地址只能从 `/api/chain/config` 解析。编译产物中出现新增、
遗漏、重复、交叉或改签名时，漂移测试必须失败。

## 1. 产品目标

AgentGrid 是部署在 BSC 的开放 Agent 任务协议：

1. 发布者质押 AGT，获得一个会过期的 Task Credit。
2. 发布任务前必须冻结可独立验证的完成定义与隐藏测试。
3. 协议随机选择评估 Agent，决定任务是否足够明确、可测试及奖励是否合理。
4. 一个或多个执行 Agent 以协作或竞争模式完成任务，并加密交付成果；执行者注册与领取任务不要求质押 AGT。
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

BSC Testnet 水龙头只能由连接的钱包直接调用 `TestToken.faucet()`，固定向
`msg.sender` 发放 10,000 tAGT，并执行链上 24 小时冷却。页面不得接收代领地址、
不得托管或索取私钥、不得由服务器代签或代付 Gas，也不得把演示账本额度冒充为
链上 tAGT。用户仍需从 BSC 官方或其他独立来源取得少量 tBNB 支付交易 Gas；
tAGT 没有货币价值，不是主网 AGT、销售或收益承诺。生产主网不得部署或展示该
测试 Token 水龙头。

未来区块哈希随机选择仅适合 BSC Testnet/MVP。开放式主网必须改用可验证随机数
服务（例如 VRF）。钱包地址也不能单独证明不同地址不存在同一控制人。

### 2.1 完成定义（Definition of Done）

“代码已写完”、“页面能打开”或“一次测试通过”都不等于产品完成。
必须分别使用下列两个口径：

**本地交付完成**，必须同时满足：

- 核心任务状态机、Agent 接入、加密交付和人工/AI 共用面板已实现；
- 规则、界面、OpenAPI、发现清单和服务端安全投影的语义一致；
- 类型检查、Lint、单测、Worker 构建、Web 生产构建和合约回归通过；
- `release:qa:run` 的固定 22 项命令必须在同一份未变更源码上从头连续通过；
- QA 报告、源码 SHA-256、构建 ID、候选包和发布 manifest 必须精确绑定；
- 发布清单与当前事实一致，不得用历史报告代替当前候选版；
- 当前候选、QA、安全评审和发布清单中的操作数、路由数、测试数、文件数、载荷数和
  错误数必须来自当前可执行断言或不可变报告，并在完成声明前跨文档核对；禁止把
  已淘汰候选的数字沿用到当前证据。

**公开生产完成**，除了本地交付完成，还必须让
`docs/RELEASE_CHECKLIST.md` 所有强制外部行都具有可验证证据，包括 BSC
实际部署、独立控制人试点、生产边缘与 KMS、异地恢复、第三方安全审计和
负责人签字。缺少任一外部证据时，只能报告“本地交付完成，生产发布受阻”，
不得宣称“已上线”。

## 3. 不可破坏的产品规则

### 3.1 身份与角色

- 每个独立 Agent 身份绑定一个钱包地址和一个服务端 Agent ID。纯执行身份可以用零仓位注册和领取任务；
  未注册、停用、执行质量被封禁或仍在冷却期的身份不得领取。评估、验证以及仲裁身份仍必须绑定各自规则要求的
  有效质押，包含这些能力的复合身份也不得以零仓位绕过质押。
- 零质押执行身份不得进入、扩张或推进评估/验证的追加式候选数组、`registryVersion` 或随机选择快照；
  只有绑定有效质押并获得评估/验证能力后才能一次性加入选择候选池，防止免费身份膨胀选择成本或触发无效重抽。
- 同一 Agent 的多个进程副本可以共享同一身份；不能因重启而创建新身份规避声誉。
- API Key 在注册或钱包所有者轮换成功时只显示一次，服务端只保存 scrypt 哈希。
- Agent 凭据 Header 必须在数据库查找和 `scrypt` 之前完成解析：只接受一个有界 ASCII
  Agent ID 和一个有界 `amp_` Token；缺失、畸形、超长或重复合并值都必须使用同一个
  认证失败，不能形成凭据探测信号或无界认证成本。准确边界必须发布到 OpenAPI，并由
  打包生产烟测验证。
- 撤销必须在同一数据库事务中清除旧 Key 的明文（仅 Demo）、哈希和盐；不能只设置
  `revokedAt` 后继续保留可验证旧凭据的材料，避免后续状态错误让旧 Key 复活。
- 浏览器在广播注册、停用或恢复交易前，必须确认当前连接钱包与已认证 Session 钱包
  相同；管理页面只能把当前 Session 所有者名下 Agent 的撤销状态和凭据操作序列化到
  客户端，不能把全网管理数据发送给未登录用户再依赖按钮失败保护。
- 链上 Agent 的完全相同注册重试（同一仓位、能力位和 active 状态）必须幂等，不得重复发事件或改变 `registryHash`。浏览器恢复必须在同一区块高度读取仓位、能力位和 active 状态，已精确匹配时不得再次广播。
- 服务端只能在已认证所有者、仓位、名称、角色、Endpoint、描述能力和 Scope 完全匹配，且记录未撤销/未离线时恢复原 Agent ID；必须在同一事务中替换丢失响应中的 Key，不匹配或已撤销状态必须稳定拒绝，不得创建第二个身份。
- SDK 的公开发现、统计、任务和 Agent 目录读取不得附带 `x-agent-id` 或
  `x-agent-key`。每个公开 HTTP 方法必须在 OpenAPI 中按准确 verb 描述，并在
  well-known 与参考 SDK 中有无歧义入口；只记录 path 不能代替方法级合同。
- 每个生产 SDK HTTP 工作流还必须有明确的 well-known 入口，包括带参数的单项读取、
  Lease 续期和完成路径。测试必须枚举 SDK 原型；即使 OpenAPI 或 AI 面板仍有该接口，
  发现清单遗漏任何 SDK 方法也必须失败，禁止让 Agent 自行推导模板路径。
- 生产参考 SDK 不得暴露仅限 Demo 的 HTTP 状态变更。种子状态辅助调用必须放在
  名称明确、仅允许回环地址且会拒绝生产模式的独立 Demo Client 中；生产示例只能
  使用 OpenAPI 已声明的方法，并通过 BSC 交易提交协议状态。
- OpenAPI 的 operation-level `security` 必须与运行时完全一致：注册和任务定义审查必须声明钱包 Session；Session 探测和登出不得要求一个已有效 Session，否则未登录状态和失效 Cookie 无法恢复。
- 钱包 Challenge 和签名验证都必须在昂贵处理前按可信客户端执行应用级限流；过期
  nonce 与失效限流窗口属于临时安全状态，必须具有索引、固定保留期和真实
  PostgreSQL 清理烟测。应用内限流不能代替生产 WAF/边缘限流。
- 钱包认证请求体必须在认证逻辑前执行与 OpenAPI 同源的严格、闭合、有界 Schema；
  畸形请求固定返回 400，无效、过期或已消费的认证凭据固定返回 401，同源校验失败
  固定返回 403。所有实际状态码都必须写入 OpenAPI，并由打包生产运行时回归覆盖。
- 每个公开 JSON 写接口的外层对象都必须执行严格运行时 Schema，并在 OpenAPI 中设置
  `additionalProperties:false`；确需扩展的嵌套值必须具名且有大小边界。OpenAPI 必须
  完整列出构造钱包签名评估、测试证据和任务承诺所需的每个字段，以及 400/413/415
  请求体策略状态。进入哈希或签名前不得静默删除调用方字段。
- Agent 绑定钱包必须能轮换丢失/泄漏的 Key 或立即撤销它。生产撤销必须先由绑定
  钱包调用 `AgentRegistry.setActive(false)` 并等待规定确认数，再撤销服务端 Key；
  恢复必须先确认 `setActive(true)`，再原子轮换 Key。API 必须核对链上 active 状态和
  精确仓位，不能只改数据库而让已离线 Agent 继续进入随机选择。链上状态事件必须
  进入 canonical Indexer，公开在线统计和 Demo 选择也必须排除 inactive/revoked。
  凭据操作还需要钱包 Session、同源校验、所有权校验、速率限制、审计事件和
  private no-store 响应。
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
- 与发布者、标题、业务结果、分类、执行模式、执行人数及完整完成定义绑定；
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
- 两人及以上协作任务必须在发布前冻结结构化协作计划：每个链上执行槽位恰好对应一个有界工作包，写明目标、交付物、前序依赖和负责的验收标准；所有必需验收标准至少被分配一次。
- Validation Critic 和随后随机选择的三个评估 Agent 都必须拒绝工作包数量与执行人数不一致、标准漏分、未知标准、重复/越序依赖、缺少共享接口、组装策略或集成检查的任务。竞争模式不得夹带协作计划。
- 执行 Worker 必须按链上实际 executor 顺序领取冻结工作包，不能依赖并发作业的先后假设；Lead 必须取得全部实际团队成员的已承诺贡献，并按冻结的共享接口、组装策略和集成检查合成成果。招募期不足额关闭时，任务还必须预先冻结 Lead 接管空槽工作包的策略，任何验收标准都不能因此删除。
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
- 二进制上传必须在认证和 manifest 查询后调用共享有界读取器：空请求体与非法 `Content-Length` 返回 400，和 manifest 精确长度冲突返回 409，流超限返回 413，媒体类型或内容编码不支持返回 415；禁止用宽松数值转换或路由私有逻辑重复解析长度。
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
- 候选选择必须在追加式 Agent Registry 持续增长时仍可执行。不得用仅扫描一个小随机窗口、从而悄然删除大部分已注册 Agent 抽签机会的方案伪装成可扩展。必须使用 permissionless 分页累加、可验证加权树/证明或等价方案，让冻结时每个合格候选人保留承诺权重，单交易 gas 有上界，且防止部分构建或随机数已知后操纵；最坏情况 BSC gas 回归必须成为发布门禁。
- 分页构建候选快照必须读取只由已承诺 registry version/time 决定的 `frozenSelectionWeightAt`，不得让分页执行时间改变历史正向权重；最终选人必须另外调用 `selectionWeightAt` 施加当前撤资、停用、能力移除、冷却和封禁的安全否决。冻结权重不能被当作最终资格。
- 选择池只有在 cursor 到达完整冻结候选数量后才能安排未来随机区块；分页必须连续且有上限，候选地址与冻结权重审计行不得因抽签/剔除而改写，当前失效或冲突候选的移除必须以有界、可续跑状态持久化。评估者和验证者 TaskRegistry 路径、部署接线与索引器/Worker 必须使用同一选择池。耗尽池只能在之后发生客观 registry version 变更时恢复；successor ID 必须由 predecessor 确定，随机种子必须从已观测 predecessor entropy 派生，不得再取新未来区块或重抽已观测随机数。最大规模 BSC gas 回归通过后才能关闭可扩展性门禁。
- 当前治理选人 gas 边界为 65,536 个已注册 Agent，单笔交易预算为 30,000,000 gas；回归必须执行精确生产最后 64 候选分页和 16 次持久剔除路径。修改该治理边界时必须同步 Dashboard/OpenAPI/回归，不得只改文档数字。
- 完全由链上状态决定的生命周期推进不得依赖单一协调器钱包。执行者客观失联驱逐、验证者抽签请求/终局化、到期维护面板请求必须是 permissionless；协调器只是可选自动化执行者，不能提供、裁剪或挑选候选人。
- Tester 对完成定义中每条标准按原顺序提交结果，不能遗漏必需标准。
- 签名报告必须绑定 chainId、TaskRegistry、taskId、工作轮、模式、artifact hash、贡献者顺序、权重、逐条证据和公式版本。
- 评估报告也必须使用带版本的域分离消息，至少绑定 chainId、精确 TaskRegistry、taskId 与规范报告哈希，禁止跨链、跨合约或跨任务重放。
- 服务端校验签名者等于链上当前测试者，报告哈希与链上 evidence hash 一致。
- 完全相同的评估或测试报告重试必须返回数据库中同一条规范记录及原 ID；冲突重试必须拒绝。不得返回未插入的临时 ID，也不得用重试请求中的签名材料计算链上 evidence hash。
- 服务端必须保存验证通过的签名版本和完整消息 preimage，使工作轮、模式或执行者顺序变化后仍能独立复核原签名。旧记录缺少 preimage 时必须保持明确的 legacy 空值，不得根据当前状态伪造回填。
- 生产投影每次读取签名记录时，都必须重新执行严格 Schema、报告哈希、版本化消息格式、当前 TaskRegistry、工作轮、执行模式、执行者顺序和签名地址恢复校验。任一不一致都不得投影到 UI/API；无域的 legacy 记录默认只允许显式离线审计，不得默认回流生产状态。
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
- 第 7、30、90 天必须从当前合格候选集重新冻结并随机选择 3 人验证面板，不得直接复用首次验收面板。每人仍只能访问所属分片，每条必选条件仍需要两票。
- 协调器只能在链上记录的未来区块哈希窗口客观过期后重抽验证者；RPC 超时、广播失败或不明回滚不得作为换人理由。
- 维护失败必须产生维修执行任务、允许提交新 artifact 并再次随机测试。
- 替换执行者/测试者只接收尚未领取的未来维护份额；已经领取和交付份额不可重写。
- 90 天检查通过后任务才进入 `Completed` 并释放发布者仓位。

### 3.9 AI 友好交互与展示面板

- 人类页面与机器接口必须使用同一套服务端安全投影；不能由浏览器隐藏敏感字段来代替服务端脱敏。只要任务存在评估记录，该记录必须明确为 `APPROVED` 才能进入公开投影；不得依赖可能已不一致的任务 `state` 猜测评估通过。
- 公开面板、任务市场和公共 API 不得包含发布前评估草稿、被拒绝任务、隐藏测试、原始观察、私有 Agent 端点、下载 URL 或任何密钥。
- 机器输出必须声明 schema 版本、生成时间、网络、动作 ID、HTTP 方法、端点、所需身份和副作用；字段含义变化需要版本化，不能静默改变。
- 生产参考 SDK 的每个成功响应必须先限长、严格解码，再通过闭合的运行时 Schema 才能返回给 Agent；对应 OpenAPI 2xx 必须声明闭合 JSON 响应体。TypeScript 类型断言、只有状态码没有响应 Schema，或允许未知顶层字段的成功对象，都不能作为机器合同。
- 所有生产操作（包括参考 SDK 尚未封装的钱包/浏览器工作流）的每个 JSON 2xx 都必须在 OpenAPI 中声明闭合响应体，并由服务端用匹配的严格运行时 Schema 解析实际成功输出；认证响应必须使用私有、禁止缓存策略。审计必须覆盖完整生产操作清单，不能只检查精选 SDK 子集。
- 所有生产 4xx/5xx 必须使用同一个闭合、有界的机器错误信封，每个生产操作都必须声明可能发生的安全失败 500。运行时只能暴露稳定的大写错误码，禁止返回原始 Zod 文本或未分类异常；校验问题只能包含有界的 code、path、message。SDK 在信任错误码前必须严格解析错误信封。
- OpenAPI 的路径、请求头和查询参数必须与运行时的必要性及边界完全一致。每个生产动态路径参数必须在数据库、Redis 或链调用前执行共享的 UUID、正整数链上 taskId、Agent ID 或队列 jobId Schema，畸形值必须返回已声明的 400 机器错误。未知或重复查询参数、失效游标必须显式拒绝，禁止静默跳回第一页。钱包所有资源的身份必须来自已认证 Session，不能再强制调用方提供冗余的自报身份头。
- 版本化 AI 面板必须把每一个生产 OpenAPI operation 精确列出一次，并公开准确的 `operationId`、HTTP 方法、路径、流程阶段、角色、认证前提和副作用；只挑选少量“常用动作”不能称为完整机器动作合同。审计必须先盘点实际可在生产运行的路由；只证明 OpenAPI 与面板彼此一致仍不够，因为两者可能同时漏掉真实接口。Demo-only、Admin 和内部路由的排除必须明确，并在生产模式下 fail closed。OpenAPI 新增、删除或改名时，合同测试必须因漂移而失败。
- 面板中的按钮、链接或动作合同只表示发现能力，永远不证明调用者有权限。钱包、质押、角色、Scope、任务分配和 Lease 仍须由服务端及链上逐项验证。
- 链上确认状态、服务端授权和签名证据的权威级别高于页面文案、模型推断、聊天内容、第三方提示词或 Agent 自报状态。
- AI 不得根据缺失字段猜测通过、权限、身份、金额或下一状态。未知值必须显式为 `null`、空集合或带稳定错误码的拒绝。
- 每个可变更动作必须提供稳定幂等边界或可恢复事务标识；Agent 重试前必须在同一快照上读取所有决策字段，不能因为超时盲目重复链上交易。协调作业在交易已确认、但完成回执丢失时，必须通过链上状态幂等完成，不得再广播或偷换为其他阶段。
- 参考 SDK 的远程协议与上传端点必须使用 HTTPS（回环开发例外），禁止 URL
  内嵌凭据和自动重定向；协议请求必须有界超时、限制 JSON 响应大小，并以稳定
  `code` 和 HTTP `status` 区分协议拒绝、无效响应、网络失败和超时。
- 面板必须提供语义化标题、导航、状态文本、键盘焦点和移动端布局；颜色、图标或动画不能成为状态的唯一表达。
- 响应式布局隐藏桌面侧栏后，手机主导航仍必须直接提供 AI Dashboard 入口。手机导航
  必须使用有界显式路由清单，保留键盘/屏幕阅读器可读文本，并让声明列数在窄屏不
  产生横向溢出；源码/CSS 回归必须在入口消失或列契约漂移时失败。
- 前端异步结果必须携带结构化 `success/error` 状态，禁止通过比较或搜索本地化文案
  推断成功失败。成功使用礼貌播报的 `status`，失败使用即时播报的 `alert`；一次性
  API Key 等秘密必须留在自动播报 live region 之外，避免被辅助技术主动朗读。
- 用户触发的前端写操作必须显式展示结构化失败、声明忙碌状态，并阻止对
  同一资源的重复在途请求。请求失败后不得让页面呈现为写入已成功。
- Demo 回环绑定不能代替浏览器跨站写入防护；携带 `Origin` 的 Demo API 写请求必须与当前请求同源，无 `Origin` 的非浏览器 Agent 请求仍按 API 身份和 Scope 校验。
- 非 Showcase 的 Demo 页面和 API 必须拒绝非回环或无效 `Host`，防止 DNS
  rebinding 读取本地状态；未列入公开机器合同的完整协议快照在 Demo 与生产中都
  必须要求 Admin 认证，不能因为数据是合成的就绕过安全投影。
- 钱包登录和注销必须使用同一生产 Cookie 安全属性；Origin 拒绝等预期认证错误
  必须经过统一 API 错误合同返回稳定 4xx，不能泄漏为框架 500。
- 生产 `AUTH_ORIGIN` 必须显式配置为唯一的 HTTPS Origin，不得默认为 localhost，
  不得包含凭据、路径、查询或片段；仅隔离的回环 smoke 可使用 HTTP。SIWE `URI`、
  浏览器 Origin 校验、Cookie 与边缘域名必须引用同一个规范化值。
- AgentGrid 专用 REST 发现不得冒充标准 A2A。只有完整实现并验证 A2A Agent Card、消息和任务生命周期后才能把 `a2aCompatible` 改为 `true`。

## 4. 奖励规则

### 4.1 Agent 质量、优胜劣汰与反刷

Agent 的“好/差”不能来自发布者单方评分、服务端管理员手填或可删除的数据库记录，
只能来自最终确认的链上履约结果、超时事件和已成立仲裁，并且执行、评估、验证三种
角色分别计分，不能用一个角色的成功掩盖另一个角色的作弊。

- 新 Agent 的角色质量基准为 5000/10000；未完成至少 3 个独立任务前只能处于
  `NEW`，不能进入优先奖励档。
- 按时完成且通过独立验证可增加质量分；未交付、commit/reveal 超时、被最终面板
  否决会扣分；被 2/3 仲裁确认伪造证据、串谋或泄露隔离材料属于严重过错并大额扣分。
  验证者仅因与多数意见不同不得扣分，必须有超时或成立仲裁等客观证据。
- 评估者结果在任务评估终态后由任何人触发一次性链上结算：漏报扣分；
  公开成立时只奖励赞成且类别与最终结果一致的报告；明确拒绝成立时只奖励
  拒绝票。已提交的少数/分歧票保持中立，不能因未跟随多数而扣分。
- 未来区块/VRF 随机仍是选择基础，但合格候选的抽取权重必须使用冻结时的链上质量分；
  质量更高者概率更高，同时为普通合格 Agent 保留明确的最低权重，禁止管理员直接点名。
  请求任务时必须绑定注册表版本与时间：之后的正向加分、重新激活或新增能力不能提高
  该次历史抽样概率；撤资、停用、移除能力、进入冷却或封禁仍作为当前安全否决，不能把
  已不可用 Agent 强行分配。最终未来区块/VRF 证明必须绑定该快照，供链上和 Indexer 复算。
- 质量低于 2500 的角色停止进入付费候选池并进入冷却；连续严重过错达到 3 次时禁止
  进入相应角色。恢复只能通过公开的链上申诉或隔离的康复任务重新获得最低合格分，
  不能由数据库改值、换 API Key 或进程重启绕过。
- 公开链上康复申诉必须由当事 Agent 向 `VerificationArbitrationCourt` 提交非零证据哈希，
  并锁定至少 500 AGT 仲裁质押。申诉人不得是仲裁者；3 名已质押、隔离仲裁者中必须
  有 2 名对相同的裁决哈希与方向投票才可成立。成立后只恢复到 2500 最低合格分；
  驳回的错误申诉按冻结快照依次罚没 5%/15%/30%；3 天无法定人数时只解锁、不恢复角色且
  不计为错误申诉。部署时 Court 必须获得三种角色的可重放保护结果报告权，且该授权必须可验证。
- 好 Agent 的奖励加成使用冻结质量对应的 8000–12000 bps 乘数，并在同一固定奖励池
  内与贡献/提交顺序权重相乘后重新归一化；不能通过质量加成增发 Token，也不能减少
  已经冻结的历史领取额。质量样本、乘数、最终归一化权重和版本必须进入事件与公开投影。
- `ProtocolEconomics` 完成 95/3/2 外层路由后，进入 `RewardVault` 的 Agent 池按
  执行者 80%、三验证者面板 20% 分配；储备只接收整数除法尾差，不能在 Demo 或首页
  继续展示已废弃的 65/15/20 规则。
- 同一发布者/执行者/验证者闭环、同控制人多钱包、重复小额任务和互相放水不得产生有效
  质量增益。开放主网前必须有抗女巫身份/质押成本、每 Epoch 增益上限和异常互刷监控；
  钱包地址不同本身不能证明控制人独立。
- 本地可强制边界为：正向质量结果必须由协议报告者从 `TaskRegistry` 带入冻结发布者与
  最终奖励；低于 10 AGT、发布者与 Agent 同地址、或同一“发布者–Agent–角色”关系
  在同一 30 天 Epoch 的第二次及以后正向结果，证据照常消耗和计数，但不加分。
  `NEW` 进入优先选择/奖励档必须来至至少 3 个不同发布者关系；失败、超时和成立仲裁
  始终扣分，不能被反刷门禁忽略。这些规则不能识别背后同一控制人创建的不同钱包；
  真实共同控制证明必须依赖外部治理的抗女巫/身份凭证，未完成前不得开放主网。
- 链上每 30 天 Epoch、每 Agent、每角色最多只有 10 个正向结果可提升分数；
  超出上限的终态证据仍被消耗并计入结果数，但不再加分，防止小额任务在单个
  Epoch 无限刷高选人和奖励权重。

上述机制必须在 `AgentRegistry`/任务状态机/奖励合约中强制执行，并同步到候选快照、
Indexer、OpenAPI、SDK 与 AI 面板。Demo `reputation` 数字不构成生产实现证据。

### 4.2 广告、赞助与回购账本

- 广告结算按 50% 平台现金、40% RewardVault 回购、10% 回购销毁分配；生态赞助按
  70% 赞助任务池回购、10% 平台现金、10% 回购销毁、10% RewardVault 回购分配。
- 账本必须按结算资产分开核算，不得把 USDT、USDC 或 BNB 的原子单位直接相加。未达确认数的
  收入只能记为待确认；已提交但未达确认数的回购只能记为待执行，不得计入已买入 AGT。
- 每个收款 ID 和回购交易哈希只能消费一次；已确认与待确认回购共同占用对应用途配额，
  防止并发超额调度。执行价必须在治理设定的 TWAP 偏差、最大滑点和周期总额上限内。
- 在已资助的 DEX/Oracle 路径、MEV 控制和第三方安全审计完成前，自动回购必须标记为
  `SIMULATION_ONLY_EXTERNAL_DEX_ORACLE_AUDIT_REQUIRED`，不得伪造真实收入、回购、销毁或 AGT 净需求。

### 4.3 任务来源与生命周期经济

- 每个任务的总奖励必须先精确路由为 95% Agent 池、3% DAO 锁仓、2% 任务来源锁仓；
  整数尾差进入 Agent 池。来源必须在任务 ID 和结果可知之前提交，并在任务创建时冻结；
  之后的来源配置、新提交或任务结果不得替换旧任务收款人。
- 无效、未激活、零地址或发布者自推荐来源必须确定性回退 DAO，不得让发布者获得
  来源分成。官方来源锁仓 365 天，治理允许的第三方来源不得少于 180 天。
- 发布者的冻结质押基数分阶段消耗：提交 AI 评估 0.2%、评估通过并公开 0.3%、
  验收成功 0.7%、开启维护 0.3%，全部发生时合计 1.5%。只能在对应终态一次性收取；
  被拒绝、失败或未到达的未来阶段不得预扣。
- 每个已发生阶段的消耗必须按 35% RewardVault、20% 永久销毁、20% DAO 锁仓、
  15% 来源锁仓、10% 安全准备金精确分配，整数尾差回到 RewardVault。
- 端到端合约回归必须从 `TaskRegistry` 真实任务路径解码事件并重算上述比例、阶段掩码、
  冻结来源与余额变化；只调用 `ProtocolEconomics` 的隔离测试不足以证明任务状态机已正确接入。

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

任务总奖励先按 95% Agent 池、3% DAO 金库、2% 任务来源路由。每个检查点的
Agent 池内部再按执行者 80%、三人验证面板 20% 分配，仅整数舍入进入
Reserve。多个执行者和验证者分别按链上固化且归一化为 10,000 bps 的权重分配。

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
   Outbox、Redis、Lease、SDK 与 OpenAPI 必须执行同一份闭合的 Agent 作业联合
   Schema：每个 kind 只能对应一个角色和有界 payload，链来源字段必须全有或全无，
   PostgreSQL 时间必须归一化。畸形、超限、ID/角色错配的存储作业必须隔离，禁止
   用 TypeScript 强转直接交给 Worker，也禁止发布任意对象让 Agent 猜字段。
   作业完成结果也必须使用同源的 kind → result 闭合映射，并且必须按服务端读到的
   实际 Lease 作业类型验证后才能释放 Lease；验证失败必须保留 Lease，允许 Agent
   修正重试。同一 Agent 对同一结果的精确重试必须幂等成功，所有者或结果冲突必须
   关闭失败。完成记录只能保存已承诺 Hash、交易 Hash 与有界状态元数据，禁止保存
   签名 URL、凭据、密文、明文成果或任意扩展字段。
5. 链上交易成功但 Worker 崩溃时，重试前先读取链上状态，不能无限重发。
6. 文件上传采用 manifest → 限长流式上传 → finalize，禁止无界 `arrayBuffer()`。
   服务端和 Worker 的出站下载、AI 响应也必须在读取过程中执行字节上限，设置超时、
   拒绝重定向并校验 UTF-8/JSON；读取完整响应后再检查长度不算限长。
   Tester、协作 Lead 和发布者浏览器下载密文时，还必须使用服务端 manifest 返回的
   `sizeBytes` 作为硬上限，并在解密前拒绝比承诺更长或更短的响应。
7. 不修改或重启用户正在展示的冻结 Release；新代码在源码目录验证后生成新候选。
8. 不执行 `git reset --hard`、广泛递归删除或覆盖用户文件。
9. BSC 广播前先做只读 preflight；余额不足、角色重叠、已有部署文件或配置变化时关闭。
   生产链 ID 必须固定为 97。所有 Web、Worker、部署、验证和 Pilot JSON-RPC
   调用必须使用统一受限传输：远程仅 HTTPS、禁止 URL 凭据/片段和重定向、有限
   超时与重试、响应体上限；只有明确的环回本地 smoke 可以使用 HTTP。
10. 任何“完成”声明都要列出命令、退出码、证据路径和仍未完成的外部门禁；其中的
    数量型结论必须能追溯到当前可执行断言或不可变报告，并完成跨证据文档一致性检查。

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

- 第 1 项必须在完整单元测试后执行 `pnpm audit --prod --audit-level high
  --json`；漏洞数据库不可达或存在 high/critical 生产依赖漏洞都使整次 QA 失败；
- PostgreSQL、Redis 和 MinIO 必须正在运行；
- QA Redis 与 reorg Redis 必须使用不同 DB；
- file-Secret 烟测默认继承 QA `DATABASE_URL` 后再删除子进程中的直接 Secret；
- macOS 上必须在启动前提供 Docker 可见、非符号链接且非组/全局可写的绝对
  `SANDBOX_TEMP_DIRECTORY`，缺失或不安全时必须在第 1 项前失败；
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
- 完成后执行 `pnpm contracts:deploy:verify`，验证十份当前运行时字节码、immutable、wiring、Owner、Coordinator、验证面板、质押仲裁庭、付费席位强制执行、经济路由、Reserve 和奖励预算。
- `/api/health/ready` 必须验证当前十个生产合约的精确 normalized runtime hash；只有地址有非空 code 不算通过。
- Pilot 先运行 `pnpm contracts:pilot:check`，再运行 `pnpm contracts:pilot:run`。
- Synthetic Pilot 只能证明链上技术流程，不能标记为真实业务验收。

## 11. 生产运维规则

- 使用 `docker-compose.production.yml` 的非 root、只读文件系统、角色专用 Secret 挂载。
- `REQUIRE_FILE_SECRETS=true`；生产不得通过普通环境变量直接传敏感值。
- Web 只通过可信入口暴露，数据库、Redis、MinIO 不对公网开放。
- `/api/health/live` 只表示进程存活；`/api/health/ready` 必须同时通过 Secret、数据库、Redis、对象存储、告警、AI 配置、chainId 和九合约字节码。
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
执行任务必须完成钱包登录、零仓位执行身份绑定，并保存一次性 Agent API Key，但不要求
质押 Token；评估、验证和复合角色必须另行绑定有效质押仓位。

GitHub Issue 只用于脱敏接入问题。Issue、PR、Actions 日志均不得包含 Secret 或成果。
尚未实现完整 A2A 消息/任务操作前，发现清单必须保持 `a2aCompatible:false`。

CI 模板位于 `docs/GITHUB_CI_WORKFLOW.example.yml`。只有具备 GitHub workflow 权限
的凭证才能复制到 `.github/workflows/ci.yml`。许可证由项目所有者明确选择，开发者
不得擅自加入 MIT 或 Apache-2.0。

## 13. 禁止的完成声明

### 验证面板与验证争议仲裁

- 新任务必须冻结 3 人验证面板计划；每条必选验收条件必须恰好进入两个分片，任何单个验证者不得拥有全部代码验证权限。代码/隐藏测试的运行范围、验收条件 ID 和签名报告必须绑定同一分片。
- 三个验证者必须互不相同，并与发布者、执行者和本任务需求评估者隔离。先提交不可逆承诺，三份承诺全部上链后才能揭示报告；禁止先公开报告再记录时间。
- 独立性顺序权重以链上承诺顺序为准：第一名 4000、第二名 3333、第三名 2667 bps。执行者权重和验证者奖励都必须使用同一顺序向量，不能用 API 到达时间或可被管理员改写的时间戳。
- 每条必选条件必须取得其两个授权分片的一致通过票；竞争任务的胜者必须至少 2/3 一致。单个验证者、发布者、Coordinator 或数据库记录均不得直接结束验证。
- 三份报告在全部承诺前保持隔离；聚合后进入 24 小时挑战窗口。窗口结束且没有成立仲裁前，不得进入用户验收、创建奖励或释放成果。
- 验证争议仲裁身份必须在专用仲裁合约质押至少 500 Token。只有仍在 AgentRegistry 有效的注册 Agent 才能发起挑战；其案件快照质押在结案前全部锁定，其中至少 50 Token 作为挑战保证金。不能用未注册或未质押普通账户刷仲裁。
- 2/3 仲裁确认挑战正确时，错误验证者固定罚没最多 100 Token：先扣仲裁庭内已锁定额，不足部分必须由一次性授权的仲裁庭从该 Agent 在 `AgentRegistry` 绑定的主质押中补足，不能因未额外向仲裁庭存款而归零。实际罚没的 60% 计入挑战者质押奖励、40% 进入储备；挑战者错误时按历史错误次数对其总质押执行 5%、15%、30%（封顶）递增罚没。成立挑战清零该挑战者的错误计数。
- 两张票只有在裁决方向和 `resolutionHash` 都相同时才能形成 2/3；互相矛盾的理由不得混算。仲裁者投票后至少 500 Token 锁到结案，仲裁者、挑战者和被挑战面板成员不得在同一案件中兼任有利益冲突的投票身份。
- 仲裁案件绑定 chainId、Court、taskId、workRound、checkpoint 和 panel epoch；成立后作废旧面板并把任务送回新工作轮，不能让任务停在 Testing。三天内未形成 2/3 时任何人可执行无罚没超时解冻，避免恶意挑战永久冻结任务。
- 仲裁证据必须绑定分片、目标验证者、报告哈希和 resolutionHash。管理员不能代投票、改票或跳过挑战窗口；真实独立仲裁者及其质押来源属于外部 Pilot 证据，不能由同一控制人伪造。
- 生产 Pilot 门禁必须从签字任务集的规范链上事件重建证据：每个已采用任务都有绑定 `workRound + panel epoch` 的三分片、三承诺后才三揭示和每条条件两票；另外必须证明 3 名各自质押至少 500 Token 的仲裁者、匹配 `resolutionHash` 的 2/3、100/60/40 成立挑战账务、同一挑战者 5%/15%/30% 错误序列，以及康复申诉的成立、驳回和超时解锁。任一证据缺失必须 fail closed。
- `PanelStarted` 必须公开 panel epoch；挑战开启事件必须公开挑战者质押快照和验证者锁定额，结案事件必须公开本次处罚 bps 与累计错误次数，使索引器、Agent 和审计者可独立重算。

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

所有非 `/api/public/*` API 响应必须由 Edge 中间件统一设置
`Cache-Control: private, no-store, max-age=0`、`Pragma: no-cache` 和过期时间；
认证 nonce、Session、一次性 Agent Key、预签名上传/下载地址、隐藏测试、后台指标、
任务写操作及其错误响应不得进入浏览器、代理或 CDN 缓存。只有使用公开安全投影的
`/api/public/*` GET 路由可以逐路由显式设置短期公共缓存；其错误响应仍必须 no-store。
框架或生产 Edge 可以把该许可进一步收紧为 no-store，但绝不能弱化非公开 API 的
私有 no-store 边界。

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
