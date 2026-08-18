# SAG 对外 MCP 服务接入指南

> SAG 知识库内置标准 MCP（Model Context Protocol）服务端，供外部 AI 客户端
> （Cursor、Claude Desktop 等）直接检索知识库内容。

---

## 1. 服务信息

| 项 | 值 |
|---|---|
| **端点** | `http://localhost:8100/mcp/`（全库） |
| **单信源限定** | `http://localhost:8100/mcp/?source_id=<信源 id>` |
| **传输协议** | Streamable HTTP（MCP 标准传输，`2024-11-05`） |
| **服务端标识** | `sag-knowledge v1.29.0` |
| **认证** | Bearer token（JWT，当前为永不过期 token） |
| **工具性质** | 全部只读（检索 / 读原文），无写操作 |

### 服务端状态检查

```bash
# 健康检查（API 本体，MCP 随 API 同生命周期）
curl -s http://localhost:8100/api/v1/system/ready
# 期望输出：{"status":"ready","db":true}
```

---

## 2. 认证（Bearer Token）

请求头携带：

```
Authorization: Bearer <token>
```

### 当前可用 token（永不过期）

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MWE2MWM3ZDc5NTc0Yjg2YWFkNzRjZTczZDk1NDNhNSIsImlhdCI6MTc4NjY4MzMzOH0.ETHNMjpCCLFZqVgIO5sxkn3Y6wSo9xzmmxwkAmyuuMc
```

> **说明**：token 已配置为**永不过期**（`SAG_ACCESS_TOKEN_EXPIRE_MINUTES=0`，不写入 `exp`）。
> 配置该 token 后长期有效，无需刷新。
>
> ⚠️ 若需更换 token：调用登录接口获取新 token，或在 API 服务端重新签发（见 `sag_api/core/security.py` 的 `create_access_token`）。

### 自行签发新 token

```python
from sag_api.core.security import create_access_token

new_token = create_access_token("51a61c7d79574b86aad74ce73d9543a5")
print(new_token)
```

---

## 3. 客户端配置

### Cursor（`.cursor/mcp.json`）

```json
{
  "mcpServers": {
    "sag-knowledge": {
      "type": "http",
      "url": "http://localhost:8100/mcp/",
      "headers": {
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MWE2MWM3ZDc5NTc0Yjg2YWFkNzRjZTczZDk1NDNhNSIsImlhdCI6MTc4NjY4MzMzOH0.ETHNMjpCCLFZqVgIO5sxkn3Y6wSo9xzmmxwkAmyuuMc"
      }
    }
  }
}
```

### Claude Desktop（`claude_desktop_config.json`）

```json
{
  "mcpServers": {
    "sag-knowledge": {
      "type": "http",
      "url": "http://localhost:8100/mcp/",
      "headers": {
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MWE2MWM3ZDc5NTc0Yjg2YWFkNzRjZTczZDk1NDNhNSIsImlhdCI6MTc4NjY4MzMzOH0.ETHNMjpCCLFZqVgIO5sxkn3Y6wSo9xzmmxwkAmyuuMc"
      }
    }
  }
}
```

### 仅接入单个信源（如智能问数图谱）

```json
{
  "mcpServers": {
    "sag-zhishu-tupu": {
      "type": "http",
      "url": "http://localhost:8100/mcp/?source_id=19d09d3733c34716bcdf906738d10b03",
      "headers": {
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MWE2MWM3ZDc5NTc0Yjg2YWFkNzRjZTczZDk1NDNhNSIsImlhdCI6MTc4NjY4MzMzOH0.ETHNMjpCCLFZqVgIO5sxkn3Y6wSo9xzmmxwkAmyuuMc"
      }
    }
  }
}
```

> `source_id` 可用 `tools/call list_sources` 查询全部信源。

---

## 4. 信源 vs 文档（概念澄清）

层级结构为 **信源（Source）→ 文档（Document）→ 分块（Chunk）**：

```
信源 Source（= 一个知识库 / 集合）
 └─ 文档 Document（信源下的具体文件，可有多个）
     └─ 分块 Chunk（检索的最小单位）
```

> **`source_id` 指的是知识库（信源），不是单个文档。**
> 文档级别用 `document_id`（`list_documents` 获取）。

### 当前实例（示例）

| 信源（知识库） | 内含文档 |
|---|---|
| 智能问数图谱 | 1 篇（答题图谱 md） |
| 燃料报告 | 21 份 PDF |
| 故宫六百年 | 1 篇 |
| 解说稿 | 2 篇 |

### 工具与层级的对应

| 工具 | 操作对象 |
|---|---|
| `list_sources` | 列出**知识库**（信源），返回 `source_id` |
| `list_documents(source_id=...)` | 列出该知识库下的**文档**，返回 `document_id` |
| `search` / `grep` / `get_entity` | 在知识库内检索内容 |
| `outline` / `read` / `get_chunk` | 针对单个**文档 / 分块**读取 |

### 限定检索范围两种方式

```
# 方式一：URL 参数（整个端点限定）
http://localhost:8100/mcp/?source_id=19d09d3733c34716bcdf906738d10b03

# 方式二：工具参数（单次调用限定）
search(query="...", source_id="19d09d3733c34716bcdf906738d10b03")
```

---

## 5. 暴露的工具（8 个，全部只读）

| 工具 | 作用 | 典型用法 |
|---|---|---|
| `list_sources` | 查看可访问的知识来源、文档/分块数，获取 source_id | 先了解资料范围 |
| `search` | 语义检索：按含义查找资料，适合自然语言问题、概念、模糊表述 | 问"存货包含哪些明细" |
| `get_entity` | 查询人物/组织/概念，汇总相关上下文 | 查某科目/实体 |
| `list_documents` | 列出文档、处理状态、分块数，获取 document_id | 查看信源内文档 |
| `outline` | 查看文档章节与分块结构，获取 chunk_id | 定位内容位置 |
| `grep` | 原文字面精确查找：专名、编号、固定短语、代码 | 找精确数字/条款 |
| `read` | 按行分页读取文档原文 | 看连续上下文 |
| `get_chunk` | 通过 chunk_id 读取单个分块完整原文 | 核对引用证据 |

---

## 6. 自测方法（curl）

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MWE2MWM3ZDc5NTc0Yjg2YWFkNzRjZTczZDk1NDNhNSIsImlhdCI6MTc4NjY4MzMzOH0.ETHNMjpCCLFZqVgIO5sxkn3Y6wSo9xzmmxwkAmyuuMc"

# 1) initialize
curl -s -X POST "http://localhost:8100/mcp/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# 2) 列出工具
curl -s -X POST "http://localhost:8100/mcp/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 3) 语义检索测试
curl -s -X POST "http://localhost:8100/mcp/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search","arguments":{"query":"存货包含哪些明细","limit":2}}}'
```

---

## 7. 常见问题

| 问题 | 处理 |
|---|---|
| 401 Unauthorized | token 失效或错误；确认 `Authorization: Bearer <token>` 格式 |
| 连接被拒 | API 未启动；`bash scripts/local-dev.sh start` 或确认 8100 端口 |
| 响应超时 | 首个请求需预热（embedding 模型加载），稍后重试 |
| 想限定信源 | URL 加 `?source_id=<信源 id>`，或工具参数传 source_id |

---

## 8. 安全注意事项

- token 当前**永不过期**，泄露即永久有效：仅限内网/本机使用，勿提交到公开仓库
- 工具全部只读，不暴露文档上传、删除、配置修改等操作
- `source_id` 作用域随请求隔离，外部宿主与进程内 Agent 共用同一服务端互不影响
