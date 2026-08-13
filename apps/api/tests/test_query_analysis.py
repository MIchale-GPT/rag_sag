"""Query analysis keeps Chinese lexical retrieval bounded and recoverable."""

from sag_api.services.query_analysis import QueryAnalysis, analyze_query


def split_meat_soup(_text: str) -> list[str]:
    return ["肉类", "清汤"]


def test_contiguous_and_spaced_chinese_have_equivalent_core_analysis():
    contiguous = analyze_query("肉类清汤", segmenter=split_meat_soup)
    spaced = analyze_query("肉类 清汤", segmenter=lambda text: [text])

    expected = QueryAnalysis(
        normalized_phrase="肉类清汤",
        scoring_terms=("肉类", "清汤"),
        lookup_terms=("肉类清汤", "肉类", "清汤"),
        chinese_segmentation_used=True,
    )
    assert contiguous == expected
    assert spaced == expected


def test_analysis_filters_single_characters_numbers_duplicates_and_noise():
    result = analyze_query(
        "请问 A 123 肉类肉类是什么",
        segmenter=lambda _text: ["肉类", "肉类"],
    )

    assert result.normalized_phrase == "a123肉类肉类"
    assert result.scoring_terms == ("肉类",)
    assert result.lookup_terms == ("a123肉类肉类", "肉类")


def test_disabled_segmentation_uses_legacy_regex_terms():
    result = analyze_query("肉类清汤", segmentation_enabled=False)

    assert result.lookup_terms == ("肉类清汤",)
    assert result.scoring_terms == ("肉类清汤",)
    assert result.chinese_segmentation_used is False


def test_segmenter_failure_uses_legacy_regex_terms():
    def broken(_text: str) -> list[str]:
        raise RuntimeError("tokenizer unavailable")

    result = analyze_query("肉类清汤", segmenter=broken)

    assert result.lookup_terms == ("肉类清汤",)
    assert result.scoring_terms == ("肉类清汤",)
    assert result.chinese_segmentation_used is False


def test_lookup_terms_are_deduplicated_and_capped_at_four():
    result = analyze_query(
        "甲乙丙丁戊己庚辛",
        segmenter=lambda _text: ["甲乙", "丙丁", "戊己", "庚辛"],
    )

    assert result.lookup_terms == ("甲乙丙丁戊己庚辛", "甲乙", "丙丁", "戊己")
