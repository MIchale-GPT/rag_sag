"""Bounded lexical query analysis for retrieval."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass

_QUERY_NOISE = (
    "知识库",
    "资料库",
    "资料中",
    "文档中",
    "告诉我",
    "帮我查",
    "搜索",
    "查询",
    "请问",
    "关于",
    "最新",
    "最近",
    "动态",
    "消息",
    "新闻",
    "内容",
    "资料",
    "一下",
    "是什么",
    "有哪些",
    "有什么",
)
_QUERY_INSTRUCTION_TERMS = frozenset(
    {
        "如何",
        "怎么",
        "怎样",
        "为什么",
        "为何",
        "是否",
        "能否",
        "进行",
        "介绍",
        "说明",
        "解释",
    }
)
_CHINESE_RUN_RE = re.compile(r"[\u3400-\u9fff]+")
_LEXICAL_PART_RE = re.compile(
    r"[a-z0-9][a-z0-9_.+-]{1,31}|[\u3400-\u9fff]+",
)
_LEGACY_TERM_RE = re.compile(
    r"[a-z0-9][a-z0-9_.+-]{1,31}|[\u3400-\u9fff]{2,16}",
)

Segmenter = Callable[[str], Iterable[str]]


@dataclass(frozen=True, slots=True)
class QueryAnalysis:
    normalized_phrase: str
    scoring_terms: tuple[str, ...]
    lookup_terms: tuple[str, ...]
    chinese_segmentation_used: bool


def normalize_lexical_text(value: str) -> str:
    return "".join(re.findall(r"[a-z0-9\u3400-\u9fff]+", value.lower()))


def _remove_query_noise(query: str) -> str:
    cleaned = query.strip().lower()
    for phrase in _QUERY_NOISE:
        cleaned = cleaned.replace(phrase, " ")
    return cleaned


def _is_valid_term(value: str) -> bool:
    normalized = normalize_lexical_text(value)
    return len(normalized) >= 2 and not normalized.isdigit()


def _bounded_unique(values: Iterable[str], *, limit: int) -> tuple[str, ...]:
    terms: list[str] = []
    keys: set[str] = set()
    for candidate in values:
        value = candidate.strip().lower()
        key = normalize_lexical_text(value)
        if not _is_valid_term(value) or key in keys:
            continue
        terms.append(value)
        keys.add(key)
        if len(terms) >= limit:
            break
    return tuple(terms)


def _legacy_query_terms(cleaned: str) -> tuple[str, ...]:
    return _bounded_unique(_LEGACY_TERM_RE.findall(cleaned), limit=4)


def _chinese_runs(cleaned: str) -> tuple[str, ...]:
    return tuple(_CHINESE_RUN_RE.findall(cleaned))


def _jieba_segment(text: str) -> Iterable[str]:
    import jieba

    return jieba.cut(text, cut_all=False)


def _segmented_terms(cleaned: str, segmenter: Segmenter) -> tuple[str, ...]:
    values: list[str] = []
    for part in _LEXICAL_PART_RE.findall(cleaned):
        if _CHINESE_RUN_RE.fullmatch(part):
            if len(part) < 2:
                continue
            values.extend(segmenter(part))
        else:
            values.append(part)
    informative = (
        value
        for value in values
        if normalize_lexical_text(value) not in _QUERY_INSTRUCTION_TERMS
    )
    return _bounded_unique(informative, limit=4)


def analyze_query(
    query: str,
    *,
    segmentation_enabled: bool = True,
    segmenter: Segmenter | None = None,
) -> QueryAnalysis:
    cleaned = _remove_query_noise(query)
    phrase = normalize_lexical_text(cleaned)
    legacy_terms = _legacy_query_terms(cleaned)
    chinese_runs = _chinese_runs(cleaned)
    if not segmentation_enabled or not chinese_runs:
        return QueryAnalysis(phrase, legacy_terms, legacy_terms, False)

    try:
        scoring_terms = _segmented_terms(cleaned, segmenter or _jieba_segment)
    except Exception:  # noqa: BLE001 -- retrieval must survive tokenizer failure
        return QueryAnalysis(phrase, legacy_terms, legacy_terms, False)

    lookup_terms = _bounded_unique((*scoring_terms, phrase), limit=4)
    return QueryAnalysis(phrase, scoring_terms, lookup_terms, True)


def query_terms(query: str, *, segmentation_enabled: bool = True) -> list[str]:
    """Return bounded lookup terms for compatibility with existing callers."""

    return list(analyze_query(query, segmentation_enabled=segmentation_enabled).lookup_terms)
