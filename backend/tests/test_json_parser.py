import pytest

from app.utils.json_parser import parse_json


def test_parse_json_strips_garbage_spliced_into_number():
    # Real failure from a judge pass: the LLM sampled CJK tokens mid-number,
    # producing `"overall_score": 8.下场` which json.loads cannot parse.
    raw = (
        '[{"question_index": 0, "grammar_naturalness": 8.5,\n'
        '  "overall_score": 8.下场,\n'
        '  "pass": false,\n'
        '  "issues": []}]'
    )
    result = parse_json(raw)
    assert result[0]["overall_score"] == 8
    assert result[0]["grammar_naturalness"] == 8.5
    assert result[0]["pass"] is False


def test_parse_json_strips_trailing_garbage_after_full_number():
    raw = '{"score": 7.5れる, "ok": true}'
    assert parse_json(raw) == {"score": 7.5, "ok": True}


def test_parse_json_fixes_dangling_decimal_point():
    raw = '{"score": 8., "ok": true}'
    assert parse_json(raw) == {"score": 8, "ok": True}


def test_parse_json_leaves_valid_numbers_untouched():
    raw = '{"a": -3.25, "b": 1e5, "c": 2.5e-3, "d": 10}'
    assert parse_json(raw) == {"a": -3.25, "b": 1e5, "c": 2.5e-3, "d": 10}


def test_parse_json_does_not_touch_numbers_inside_strings():
    raw = '{"stem": "He scored 8.下场 points", "score": 9}'
    assert parse_json(raw) == {"stem": "He scored 8.下场 points", "score": 9}


def test_parse_json_still_raises_on_unrepairable_input():
    with pytest.raises(Exception):
        parse_json('{"score": }')
