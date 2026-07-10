#!/usr/bin/env python3
"""Unit tests for RapidOCR worker normalization helpers.

These tests do not import or initialize RapidOCR. They only validate the worker's
best-effort normalization logic for result shapes observed across RapidOCR
versions.
"""

from __future__ import annotations

import unittest

from rapidocr_worker import normalize_rapidocr_result


class NumpyLikeArray:
    def __init__(self, value):
        self.value = value

    def tolist(self):
        return self.value

    def __bool__(self):
        raise ValueError("The truth value of an array with more than one element is ambiguous")


class NumpyLikeScalar:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class RapidOcrObjectResult:
    def __init__(self):
        self.txts = NumpyLikeArray(["Цена 99 90", "Кофе 250 г"])
        self.scores = NumpyLikeArray([NumpyLikeScalar(0.91), NumpyLikeScalar(0.84)])
        self.boxes = NumpyLikeArray([
            [[0, 0], [120, 0], [120, 30], [0, 30]],
            [[0, 35], [160, 35], [160, 65], [0, 65]],
        ])


class NormalizeRapidOcrResultTest(unittest.TestCase):
    def test_normalizes_object_result_with_numpy_like_arrays(self):
        blocks = normalize_rapidocr_result(RapidOcrObjectResult())

        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0]["text"], "Цена 99 90")
        self.assertEqual(blocks[0]["confidence"], 0.91)
        self.assertEqual(blocks[0]["bbox"], {"x": 0, "y": 0, "width": 120, "height": 30})
        self.assertEqual(blocks[1]["text"], "Кофе 250 г")
        self.assertEqual(blocks[1]["confidence"], 0.84)

    def test_normalizes_tuple_result_shape(self):
        rapidocr_tuple = ([
            [[[10, 20], [90, 20], [90, 40], [10, 40]], ["Сыр 400 г", 0.88]],
        ], None)

        blocks = normalize_rapidocr_result(rapidocr_tuple)

        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["text"], "Сыр 400 г")
        self.assertEqual(blocks[0]["confidence"], 0.88)
        self.assertEqual(blocks[0]["bbox"], {"x": 10, "y": 20, "width": 80, "height": 20})

    def test_empty_or_unknown_shapes_do_not_crash(self):
        self.assertEqual(normalize_rapidocr_result(None), [])
        self.assertEqual(normalize_rapidocr_result(object()), [])
        self.assertEqual(normalize_rapidocr_result(NumpyLikeArray([])), [])


if __name__ == "__main__":
    unittest.main()
