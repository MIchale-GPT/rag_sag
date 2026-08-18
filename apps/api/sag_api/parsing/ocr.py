"""本地/代理多模态 OCR 解析适配器（OpenAI 兼容视觉模型）。

流程：PDF → 逐页渲染 PNG（pypdfium2）→ 调 OpenAI 兼容 `chat/completions`
（image_url + 提示词）→ 模型输出 Markdown → 合并各页。

适合已有本地或代理多模态 LLM 的场景（如 qwen3.5-4b / qwen3.6-vl 等），
不依赖 MinerU / 302.AI。鉴权与错误映射与其他解析适配器保持一致。
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from sag_api.core.config import Settings
from sag_api.core.errors import (
    ConfigurationError,
    ServiceUnavailableError,
    UpstreamError,
    ValidationError,
)

StateCallback = Callable[[dict[str, Any]], Awaitable[None]]

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}

_PROMPT = (
    "请对这张文档页面图片做 OCR 识别，完整保留原文文字内容与层级结构，"
    "以 Markdown 格式输出（标题、列表、表格、代码块等）。"
    "只输出识别到的原文，不要添加原文没有的内容、解释或评论。"
)


class OcrClient:
    """OpenAI 兼容多模态 OCR 客户端（仅处理 PDF）。"""

    def __init__(self, settings: Settings):
        if not settings.ocr_configured:
            raise ConfigurationError("本地 OCR 尚未配置 Base URL 与 API Key")
        self._base_url = str(settings.ocr_base_url).rstrip("/")
        self._api_key = str(settings.ocr_api_key)
        self._model = settings.ocr_model
        self._max_pages = settings.ocr_max_pages
        self._scale = settings.ocr_page_scale
        self._concurrency = settings.ocr_concurrency
        self._timeout = settings.ocr_request_timeout
        self._max_tokens = settings.ocr_max_tokens

    async def parse(
        self,
        path: str,
        *,
        state: dict[str, Any] | None = None,
        on_state: StateCallback | None = None,
    ) -> str:
        if on_state:
            await on_state({**(state or {}), "status": "rendering"})
        suffix = os.path.splitext(path)[1].lower()
        if suffix in _IMAGE_SUFFIXES:
            # 图片：无需渲染，直接读取像素（动图取首帧）
            pages = [await asyncio.to_thread(self._load_image, path)]
        else:
            pages = await asyncio.to_thread(self._render_pdf, path)
        if not pages:
            raise UpstreamError("OCR 解析失败：PDF 没有可渲染的页面")
        if len(pages) > self._max_pages:
            raise ValidationError(f"PDF 页数超过 OCR 上限（{self._max_pages} 页）")

        if on_state:
            await on_state(
                {**(state or {}), "status": "ocr", "pages": len(pages)}
            )

        semaphore = asyncio.Semaphore(self._concurrency)

        async def _recognize(index: int, png: bytes) -> str:
            async with semaphore:
                return await self._ocr_page(index, png)

        results = await asyncio.gather(
            *(_recognize(index, png) for index, png in enumerate(pages)),
            return_exceptions=True,
        )
        parts: list[str] = []
        for index, result in enumerate(results):
            if isinstance(result, BaseException):
                raise result
            text = str(result).strip()
            if text:
                parts.append(f"\n\n<!-- OCR 第 {index + 1} 页 -->\n\n{text}")
        if not parts:
            raise UpstreamError("OCR 解析结果为空")
        return "\n".join(parts).strip() + "\n"

    @staticmethod
    def _load_image(path: str) -> bytes:
        """图片直接转为 PNG 字节（用于多模态 OCR 输入）。"""
        from PIL import Image

        try:
            img = Image.open(path)
            img.load()
        except Exception as exc:  # noqa: BLE001 - 损坏/格式未知统一转上游错误
            raise UpstreamError(f"无法打开图片：{exc}") from exc
        if img.mode != "RGB":
            img = img.convert("RGB")
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        return buffer.getvalue()

    def _render_pdf(self, path: str) -> list[bytes]:
        import pypdfium2 as pdfium

        try:
            document = pdfium.PdfDocument(path)
        except Exception as exc:  # noqa: BLE001 - 未知 PDF 损坏/格式错误统一转上游错误
            raise UpstreamError(f"无法打开 PDF：{exc}") from exc
        try:
            pages: list[bytes] = []
            for index in range(len(document)):
                page = document[index]
                bitmap = page.render(scale=self._scale)
                pil = bitmap.to_pil()
                buffer = io.BytesIO()
                pil.save(buffer, format="PNG")
                pages.append(buffer.getvalue())
        finally:
            document.close()
        return pages

    async def _ocr_page(self, index: int, png: bytes) -> str:
        encoded = base64.b64encode(png).decode("ascii")
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{encoded}"},
                        },
                        {"type": "text", "text": _PROMPT},
                    ],
                }
            ],
            "max_tokens": self._max_tokens,
            "temperature": 0.1,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    f"{self._base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        # 本地代理可能剥掉上游的 Content-Encoding 头却保留 gzip body，
                        # 显式要求明文响应，避免响应体无法解析。
                        "Accept-Encoding": "identity",
                    },
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            raise ServiceUnavailableError(f"OCR 请求超时（第 {index + 1} 页）") from exc
        except httpx.RequestError as exc:
            raise ServiceUnavailableError(f"无法连接 OCR 服务：{exc}") from exc

        if not response.is_success:
            self._raise_status(response, f"OCR 识别（第 {index + 1} 页）")

        content = response.content
        if content[:2] == b"\x1f\x8b":  # gzip magic：代理剥头保留体的防御
            try:
                import gzip

                content = gzip.decompress(content)
            except Exception:  # noqa: BLE001 - 解压失败保持原样交由下方解析报错
                pass
        try:
            payload = json.loads(content.decode("utf-8"))
            content_text = payload["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError, UnicodeDecodeError) as exc:
            raise UpstreamError(
                f"OCR 响应缺少内容字段（第 {index + 1} 页）"
            ) from exc
        if not isinstance(content_text, str) or not content_text.strip():
            raise UpstreamError(f"OCR 返回空内容（第 {index + 1} 页）")
        return content_text

    @staticmethod
    def _raise_status(response: httpx.Response, action: str) -> None:
        try:
            payload = response.json()
            detail = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
            detail = detail or (payload.get("message") if isinstance(payload, dict) else None)
        except ValueError:
            detail = (response.text or response.reason_phrase).strip()
        message = f"{action}失败（{response.status_code}）：{detail or '未知错误'}"
        if response.status_code in {401, 403}:
            raise ConfigurationError(f"{action}鉴权失败，请检查 OCR API Key")
        if response.status_code == 429 or response.status_code >= 500:
            raise ServiceUnavailableError(message)
        raise UpstreamError(message)
