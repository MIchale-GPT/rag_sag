#!/usr/bin/env bash
# =============================================================================
# SAG 本地一键启动 / 停止 / 状态 / 日志
#
# 用法:
#   bash scripts/local-dev.sh start          # 启动 embedding + api + web
#   bash scripts/local-dev.sh stop           # 停止全部
#   bash scripts/local-dev.sh restart        # 重启全部
#   bash scripts/local-dev.sh status         # 查看状态
#   bash scripts/local-dev.sh logs [-f]      # 查看日志（-f 跟随）
#
# 环境变量（可选）:
#   SAG_API_PORT   API 端口（默认 8100，因 8000 常被其他项目占用）
#   SAG_WEB_PORT   Web 端口（默认 3000）
#   SAG_BIND       绑定地址（默认 0.0.0.0）
#
# 前置依赖:
#   - conda 环境  sag     (SAG 后端, Python 3.11)
#   - conda 环境  llm2db  (embedding server 运行环境, 含 torch)
#   - LLM 本地服务已启动 (127.0.0.1:43027, Qwen3-235B-A22B)
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONDA_SH="$HOME/miniconda3/etc/profile.d/conda.sh"
EMBED_DIR="$HOME/pgm/embedding_server"
OCR_PROXY_DIR="$HOME/pgm/ocr/proxy_finance"
LLM_BASE_URL="http://127.0.0.1:43027/v1"
OCR_PROXY_HEALTH="http://127.0.0.1:43124/healthz"

# ---- 端口与文件 ----
API_PORT="${SAG_API_PORT:-8100}"
WEB_PORT="${SAG_WEB_PORT:-3000}"
EMBED_PORT=8008
BIND="${SAG_BIND:-0.0.0.0}"

API_PID_FILE=/tmp/sag-api.pid
WEB_PID_FILE=/tmp/sag-web.pid
EMBED_PID_FILE=/tmp/sag-embed.pid
API_LOG=/tmp/sag-api.log
WEB_LOG=/tmp/sag-web.log
EMBED_LOG=/tmp/sag-embed.log

# ---- 输出 ----
log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
ok()   { printf '\033[1;32m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
err()  { printf '\033[1;31m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }

# ---- 工具函数 ----
port_in_use() { ss -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${1}$"; }

pid_alive() { [ -f "$1" ] && [ -n "$(cat "$1" 2>/dev/null)" ] && kill -0 "$(cat "$1" 2>/dev/null)" 2>/dev/null; }

# 按 PID 文件 + 命令行模式兜底清理（排除自身）
cleanup() {
  local pid_file="$1" pattern="$2" pid
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file" 2>/dev/null)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
    rm -f "$pid_file"
  fi
  for p in $(pgrep -f "$pattern" 2>/dev/null); do
    [ "$p" = "$$" ] && continue
    kill "$p" 2>/dev/null
  done
}

wait_http() {
  local url="$1" name="$2" tries="${3:-40}"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

require_conda_env() {
  if [ ! -f "$CONDA_SH" ]; then
    err "未找到 conda: $CONDA_SH"; exit 1
  fi
  # shellcheck disable=SC1090
  source "$CONDA_SH"
  if ! conda env list | awk '{print $1}' | grep -qx "$1"; then
    err "conda 环境不存在: $1"; exit 1
  fi
}

check_llm_proxy() {
  # ponytail: 直接探 /v1/models，兼容 vLLM 与代理，无需猜 health 路径
  if ! curl -fsS -m 3 "$LLM_BASE_URL/models" >/dev/null 2>&1; then
    err "LLM 服务未运行 ($LLM_BASE_URL)，请先启动 Qwen3-235B-A22B"
    return 1
  fi
  return 0
}

check_ocr_proxy() {
  # OCR 代理（qwen3.5-4b 多模态，用于 PDF OCR 解析）
  if curl -fsS -m 3 "$OCR_PROXY_HEALTH" >/dev/null 2>&1; then
    ok "OCR 代理就绪 (qwen3.5-4b @43124)"
    return 0
  fi
  warn "OCR 代理未运行 (127.0.0.1:43124)。PDF 将回退本地 MarkItDown 解析。"
  warn "启动方式: bash $OCR_PROXY_DIR/start_proxy.sh qwen3.5-4b"
  return 1
}

start_ocr_proxy() {
  curl -fsS -m 3 "$OCR_PROXY_HEALTH" >/dev/null 2>&1 && { ok "OCR 代理已在运行 (qwen3.5-4b @43124)"; return 0; }
  if [ ! -f "$OCR_PROXY_DIR/start_proxy.sh" ]; then
    warn "未找到 OCR 代理脚本: $OCR_PROXY_DIR/start_proxy.sh，跳过"
    return 1
  fi
  log "启动 OCR 代理 (qwen3.5-4b @43124) ..."
  if ! bash "$OCR_PROXY_DIR/start_proxy.sh" qwen3.5-4b >/tmp/sag-ocr-proxy.log 2>&1; then
    warn "OCR 代理启动失败，日志 /tmp/sag-ocr-proxy.log"
    return 1
  fi
  if wait_http "$OCR_PROXY_HEALTH" ocr-proxy 20; then
    ok "OCR 代理就绪 (qwen3.5-4b @43124)"
  else
    warn "OCR 代理未就绪，日志 /tmp/sag-ocr-proxy.log"
    return 1
  fi
}

stop_ocr_proxy() {
  local pid_file="$OCR_PROXY_DIR/run/openai_local_proxy_qwen35_4b.pid"
  local pid="" p
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file" 2>/dev/null)"
  fi
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    ok "已停止 OCR 代理 (pid $pid)"
  else
    # 兜底：按监听端口精确匹配（不影响 paddle-ocr / qwen3.5-9b 等其他代理）
    for p in $(pgrep -f "listen-port 43124" 2>/dev/null); do
      [ "$p" = "$$" ] && continue
      kill "$p" 2>/dev/null
    done
    log "OCR 代理未在运行"
  fi
  rm -f "$pid_file"
}

sync_web_env() {
  local env_local="$ROOT/apps/web/.env.local"
  local want="NEXT_PUBLIC_API_BASE=http://localhost:$API_PORT"
  if [ -f "$env_local" ] && grep -q "^NEXT_PUBLIC_API_BASE=" "$env_local"; then
    sed -i "s|^NEXT_PUBLIC_API_BASE=.*|$want|" "$env_local"
  else
    printf '# 后端 API 地址（浏览器直连）\n%s\n' "$want" > "$env_local"
  fi
  log "web 环境已同步: $want"
}

# ---- 启动 ----
start_embedding() {
  pid_alive "$EMBED_PID_FILE" && { ok "embedding 已在运行 (pid $(cat "$EMBED_PID_FILE"))"; return 0; }
  if port_in_use "$EMBED_PORT"; then
    ok "端口 $EMBED_PORT 已在监听（假设 embedding 已运行）"
    return 0
  fi
  log "启动 embedding server (CPU 模式, 环境 llm2db) ..."
  ( cd "$EMBED_DIR" && EMBEDDING_DEVICE=cpu CONDA_ENV=llm2db nohup ./run.sh >"$EMBED_LOG" 2>&1 & echo $! > "$EMBED_PID_FILE" )
  if wait_http "http://127.0.0.1:$EMBED_PORT/health" embedding 40; then
    ok "embedding 就绪: http://127.0.0.1:$EMBED_PORT/health"
  else
    err "embedding 启动失败，日志: $EMBED_LOG"; tail -5 "$EMBED_LOG" >&2
    return 1
  fi
}

start_api() {
  pid_alive "$API_PID_FILE" && { ok "API 已在运行 (pid $(cat "$API_PID_FILE"))"; return 0; }
  if port_in_use "$API_PORT"; then
    err "端口 $API_PORT 被占用，无法启动 API（换端口: SAG_API_PORT=xxxx bash scripts/local-dev.sh start）"
    return 1
  fi
  require_conda_env sag
  log "启动 SAG API (端口 $API_PORT, 环境 sag) ..."
  conda activate sag
  ( cd "$ROOT/apps/api" && nohup uvicorn sag_api.main:app --reload --host "$BIND" --port "$API_PORT" >"$API_LOG" 2>&1 & echo $! > "$API_PID_FILE" )
  conda deactivate
  if wait_http "http://localhost:$API_PORT/api/v1/system/ready" api 40; then
    ok "API 就绪: http://localhost:$API_PORT/docs"
  else
    err "API 启动失败，日志: $API_LOG"; tail -10 "$API_LOG" >&2
    return 1
  fi
}

start_web() {
  pid_alive "$WEB_PID_FILE" && { ok "Web 已在运行 (pid $(cat "$WEB_PID_FILE"))"; return 0; }
  if port_in_use "$WEB_PORT"; then
    err "端口 $WEB_PORT 被占用，无法启动 Web（换端口: SAG_WEB_PORT=xxxx bash scripts/local-dev.sh start）"
    return 1
  fi
  log "启动 SAG Web (端口 $WEB_PORT) ..."
  ( cd "$ROOT/apps/web" && nohup npm run dev -- -H "$BIND" >"$WEB_LOG" 2>&1 & echo $! > "$WEB_PID_FILE" )
  if wait_http "http://localhost:$WEB_PORT" web 60; then
    ok "Web 就绪: http://localhost:$WEB_PORT"
  else
    err "Web 启动失败，日志: $WEB_LOG"; tail -10 "$WEB_LOG" >&2
    return 1
  fi
}

start_all() {
  check_llm_proxy || exit 1
  start_ocr_proxy
  sync_web_env
  start_embedding || exit 1
  start_api     || exit 1
  start_web     || exit 1
  echo
  ok "全部就绪:"
  ok "  Web     http://localhost:$WEB_PORT"
  ok "  API     http://localhost:$API_PORT/docs"
  ok "  Embed   http://127.0.0.1:$EMBED_PORT/health"
  echo
  ok "日志: tail -f $API_LOG $WEB_LOG $EMBED_LOG"
}

# ---- 停止 ----
stop_embedding() { cleanup "$EMBED_PID_FILE" "uvicorn app:app"; }
stop_api()       { cleanup "$API_PID_FILE" "uvicorn sag_api.main"; }
stop_web()       { cleanup "$WEB_PID_FILE" "next-server"; }

stop_all() {
  stop_embedding; stop_api; stop_web; stop_ocr_proxy
  sleep 2
  ok "已停止全部服务"
}

# ---- 状态 ----
status_all() {
  echo "──────────────────────────────"
  local name port pid_file url
  for entry in "embedding|$EMBED_PORT|$EMBED_PID_FILE|http://127.0.0.1:$EMBED_PORT/health" \
               "api|$API_PORT|$API_PID_FILE|http://localhost:$API_PORT/api/v1/system/health" \
               "web|$WEB_PORT|$WEB_PID_FILE|http://localhost:$WEB_PORT"; do
    IFS='|' read -r name port pid_file url <<< "$entry"
    if pid_alive "$pid_file"; then
      printf '  %-10s 端口 %-5s 运行中 (pid %s)\n' "$name" "$port" "$(cat "$pid_file")"
    elif port_in_use "$port"; then
      printf '  %-10s 端口 %-5s 被其他进程占用（未由本脚本管理）\n' "$name" "$port"
    else
      printf '  %-10s 端口 %-5s 已停止\n' "$name" "$port"
    fi
  done
  echo "──────────────────────────────"
  echo "LLM 服务: $(curl -fsS -m 2 "$LLM_BASE_URL/models" 2>/dev/null >/dev/null && echo 运行中 || echo 未运行)"
  echo "OCR 代理: $(curl -fsS -m 2 $OCR_PROXY_HEALTH 2>/dev/null >/dev/null && echo 运行中 || echo 未运行)"
}

# ---- 日志 ----
logs() {
  local f
  if [ "${1:-}" = "-f" ]; then
    tail -f "$API_LOG" "$WEB_LOG" "$EMBED_LOG" 2>/dev/null
  else
    for f in "$API_LOG" "$WEB_LOG" "$EMBED_LOG"; do
      echo "════════ $f ════════"
      tail -n "${TAIL_LINES:-30}" "$f" 2>/dev/null || echo "(无日志)"
    done
  fi
}

# ---- 入口 ----
case "${1:-}" in
  start)   start_all ;;
  stop)    stop_all ;;
  restart) stop_all; sleep 2; start_all ;;
  status)  status_all ;;
  logs)    logs "${2:-}" ;;
  *)
    echo "用法: $0 {start|stop|restart|status|logs [-f]}"
    exit 1
    ;;
esac
