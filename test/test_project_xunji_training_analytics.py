import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "project-xunji-training-analytics.py"


def export(date, movements, **result_fields):
    return {
        "cached": False,
        "data": {
            "res": {
                "datestr": date,
                "mode": "full",
                "includeFullData": True,
                "trains": [{"localid": 1, "datestr": date, "movements": movements}],
                **result_fields,
            }
        },
    }


class ProjectionTest(unittest.TestCase):
    def setUp(self):
        workspace = TemporaryDirectory()
        self.addCleanup(workspace.cleanup)
        self.root = Path(workspace.name)
        self.source = self.root / "input"
        self.source.mkdir()
        self.target = self.root / "derived.json"

    def record(self, date, payload):
        (self.source / f"{date}.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def project(self, *args, expect_success=True):
        result = subprocess.run([
            sys.executable, str(SCRIPT), "--input-dir", str(self.source), "--output", str(self.target), *args
        ], capture_output=True, text=True)
        if expect_success:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(self.target.read_text(encoding="utf-8"))
        self.assertNotEqual(result.returncode, 0)

    def test_completed_working_sets_and_noncomparable_loads(self):
        day = "2026-04-03"
        self.record(day, export(day, [
            {"name": "杠铃卧推", "sets": [
                {"done": False, "reps": 8, "weight": 50, "unit": "kg"},
                {"done": True, "reps": 12, "weight": 20, "unit": "kg", "setType": "热"},
                {"done": True, "reps": "8", "weight": "55.5", "unit": "kg", "dropSets": [
                    {"done": True, "reps": 5, "weight": 20, "unit": "kg"}
                ]},
                {"done": True, "reps": 8, "weight": 25, "unit": "kg", "leftWeight": 20},
            ]},
            {"name": "双杠臂屈伸（辅助）", "sets": [
                {"done": True, "reps": 6, "weight": 25, "unit": "kg"},
            ]},
            {"name": "未知练习", "sets": [
                {"done": True, "reps": 12, "weight": 10, "unit": ""},
            ]},
            {"name": "卷腹", "sets": [
                {"done": True, "reps": 12, "weight": 62, "unit": "kg", "selfWeight": True},
            ]},
            {"name": "平板支撑_计时", "exetype": "timer", "sets": [{"done": True, "time": 30}]},
            {"name": "跑步", "exetype": "record", "sets": [{"done": True, "time": 30}]},
        ]))
        self.assertEqual(self.project(), {
            "schemaVersion": 1,
            "source": "xunji",
            "days": [{
                "date": day,
                "status": "complete",
                "sets": [
                    {"exercise": "杠铃卧推", "muscle": "chest", "reps": 8, "load": {"amount": 55.5, "unit": "kg"}},
                    {"exercise": "杠铃卧推", "muscle": "chest", "reps": 8, "load": None},
                    {"exercise": "双杠臂屈伸（辅助）", "muscle": None, "reps": 6, "load": None},
                    {"exercise": "未知练习", "muscle": None, "reps": 12, "load": None},
                    {"exercise": "卷腹", "muscle": "core", "reps": 12, "load": None},
                    {"exercise": "平板支撑_计时", "muscle": "core", "reps": None, "load": None},
                ],
            }],
        })

    def test_nested_sets_and_coverage_states(self):
        day = "2026-04-04"
        self.record(day, export(day, [{"sets": [
            {"done": True, "items": [
                {"index": 0, "name": "杠铃卧推", "set": {"done": True, "reps": 7, "weight": 90, "unit": "lb"}},
                {"index": 1, "name": "卷腹", "set": {"reps": 7}},
                {"index": 2, "name": "卷腹", "set": {"done": False, "reps": 7}},
            ], "truncated": True},
        ]}]))
        self.record("2026-04-06", export("2026-04-06", [], mode="light", includeFullData=False))
        self.record("2026-04-07", export("2026-04-08", []))
        self.record("2026-04-08", export("2026-04-08", [], trains=[]))
        actual = self.project("--start", day, "--end", "2026-04-08")["days"]
        self.assertEqual([(entry["date"], entry["status"]) for entry in actual], [
            (day, "partial"),
            ("2026-04-05", "unavailable"),
            ("2026-04-06", "unavailable"),
            ("2026-04-07", "unavailable"),
            ("2026-04-08", "complete"),
        ])
        self.assertEqual(actual[0]["sets"], [
            {"exercise": "杠铃卧推", "muscle": "chest", "reps": 7, "load": {"amount": 90, "unit": "lb"}},
        ])
        self.assertTrue(all(not entry["sets"] for entry in actual[1:]))

    def test_omitted_movements_are_partial_but_explicitly_empty_movements_are_complete(self):
        day = "2026-04-09"
        self.record(day, export(day, [], trains=[
            {"localid": 1, "datestr": day},
            {"localid": 2, "datestr": day, "movements": [
                {"name": "卷腹", "sets": [{"done": True, "reps": 12}]},
            ]},
        ]))
        rest = "2026-04-10"
        self.record(rest, export(rest, []))

        self.assertEqual(self.project()["days"], [
            {"date": day, "status": "partial", "sets": [
                {"exercise": "卷腹", "muscle": "core", "reps": 12, "load": None},
            ]},
            {"date": rest, "status": "complete", "sets": []},
        ])

    def test_existing_output_is_preserved(self):
        self.record("2026-04-01", export("2026-04-01", []))
        self.target.write_text("keep", encoding="utf-8")
        self.project(expect_success=False)
        self.assertEqual(self.target.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
