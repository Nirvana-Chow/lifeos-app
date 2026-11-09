"""Project locally exported Xunji days into the LifeOS training analytics format."""

import argparse
from datetime import date, timedelta
import json
import math
import os
from pathlib import Path
import re


# Curated primary targets for exact public Xunji names. An unlisted or ambiguous
# movement keeps its completed set, with its primary muscle left unknown.
# Names checked against Foveluy/Xunji-movements at 61064231da4bf9fcb37d2e23b29737271c0ab921.
MUSCLE_GROUPS = {
    "chest": (
        "杠铃卧推", "暂停卧推", "上斜杠铃卧推", "下斜杠铃卧推", "哑铃卧推", "平躺哑铃卧推", "上斜哑铃卧推", "器械推胸", "悍马机推胸",
        "上斜器械推胸", "蝴蝶机飞鸟", "绳索夹胸", "绳索十字夹胸", "俯卧撑", "宽距杠铃卧推", "下斜哑铃卧推", "上斜悍马机推胸",
        "史密斯机卧推", "下斜史密斯机卧推", "上斜史密斯机卧推", "哑铃飞鸟", "平躺哑铃飞鸟", "把手式蝴蝶机飞鸟", "上斜哑铃飞鸟",
        "平板绳索夹胸", "上斜绳索夹胸", "下斜绳索夹胸", "悍马机卧推", "下斜悍马机推胸", "器械推胸（版本2）", "器械推胸（版本3）",
        "对握式器械推胸", "悍马机推胸（版本2）", "蝴蝶机夹胸（版本2）", "直立器械推胸", "塔式平板卧推", "塔式上斜卧推",
    ),
    "back": (
        "引体向上", "宽距高位下拉", "对握高位下拉", "绳索高位下拉", "杠铃划船", "坐姿划船", "器械坐姿划船", "绳索直背坐姿划船",
        "绳索直臂下压", "窄距下拉", "反手杠铃划船", "潘德雷划船", "悍马机划船(v1)", "器械下拉（版本2）", "器械下拉", "分动式高位划船",
        "拉杆坐姿划船(宽握)", "拉杆坐姿划船(窄握)", "哑铃划船", "俯卧杠铃划船", "俯卧哑铃划船", "反手引体向上", "引体向上（辅助）",
        "对握引体向上", "绳索坐姿划船（单手）", "哑铃划船（手扶）", "悍马机划船", "悍马机正手下拉", "反握式悍马划船", "悍马机下拉（版本2）",
        "悍马机划船（版本2）", "支撑式悍马俯身划船", "窄握把手下拉", "器械高位划船", "绳索直臂下拉II", "T杆划船", "反握器械高位下拉",
        "窄距正手下拉",
    ),
    "shoulders": (
        "站姿哑铃推举", "坐姿杠铃肩推", "侧平举", "器械侧平举", "绳索侧平举", "蝴蝶机反向飞鸟", "器械坐姿反向飞鸟", "地雷杆推肩",
        "哑铃推肩", "阿诺德推肩", "哑铃过头侧平举", "半俯身侧平举", "前平举", "杠铃前平举", "杠铃片前平举", "站姿杠铃推举",
        "坐姿杠铃推举", "悍马机坐姿推举", "绳索侧平举（单边）", "器械把手侧平举", "悍马机侧平举", "站姿器械侧平举", "单臂哑铃侧平举",
        "绳索交叉反向飞鸟", "坐姿哑铃侧平举", "坐姿锤式握法器械肩推",
    ),
    "biceps": (
        "哑铃弯举", "杠铃弯举", "哑铃轮换弯举", "绳索弯举", "牧师凳弯举", "单手牧师凳弯举", "坐姿哑铃弯举", "蜘蛛弯举", "锤式弯举",
        "直杆绳索弯举", "集中弯举", "上斜哑铃弯举", "上斜锤式弯举", "器械弯举", "牧师器弯举", "EZ杆二头弯举", "坐姿器械二头弯举",
        "哑铃交替弯举", "绳索单臂弯举",
    ),
    "triceps": (
        "直杆绳索下压", "V-Bar 绳索下压", "哑铃过头臂屈伸", "绳索过头臂屈伸", "绳索臂屈伸", "器械三头下压（正向）",
        "哑铃过头臂屈伸（单手）", "仰卧杠铃臂屈伸", "跪姿绳索臂屈伸", "悍马机三头下压", "器械臂屈伸", "哑铃臂屈伸", "单手绳索臂屈伸",
        "绳索三头下压_SZ杆", "仰卧哑铃臂屈伸", "仰卧EZ杆臂屈伸", "哑铃坐姿臂屈伸", "单臂侧姿绳索下压",
    ),
    "quadriceps": (
        "杠铃深蹲", "杠铃哈克深蹲", "坐姿腿屈伸", "腿举", "窄距腿举", "哈克机深蹲", "史密斯机深蹲", "哑铃酒杯深蹲", "自重深蹲",
        "悍马机深蹲", "钟摆深蹲", "器械单腿腿屈伸", "挂片器单腿屈伸", "器械坐姿深蹲", "连动式仰卧腿举", "杠杆坐姿腿屈伸", "史密斯机仰卧腿举",
    ),
    "hamstrings": (
        "罗马尼亚硬拉", "杠铃罗马尼亚硬拉", "腿弯举", "坐姿腿弯举", "俯卧哑铃腿弯举", "杠铃直腿硬拉", "哑铃直腿硬拉", "单边腿弯举（器械）",
        "自重腿弯举", "俯卧哑铃腘绳肌弯举", "哑铃俯卧腿弯举", "吊环腿弯举", "史密斯罗马尼亚硬拉", "绳索直腿硬拉",
    ),
    "glutes": (
        "杠铃臀桥", "杠铃臀冲", "器械臀冲", "自重臀冲", "史密斯臀冲", "哑铃臀冲", "单腿哑铃臀冲", "悍马机臀冲", "垫高自重臀冲",
        "臀冲架臀冲", "弹力带臀冲", "后倾臀桥", "杠铃单腿臀推",
    ),
    "calves": (
        "站姿器械提踵", "坐姿器械提踵", "站姿自重提踵", "站姿哑铃提踵", "腿举机提踵", "杠铃站姿提踵", "坐姿杠铃提踵",
        "坐姿器械提踵(版本2)", "史密斯机提踵", "驴式提踵", "哑铃单腿提踵", "坐姿哑铃提踵", "站姿杠铃提踵", "单腿站姿提踵",
    ),
    "core": (
        "鸟狗式", "绳索Pallof推", "平板支撑手臂上抬", "死虫", "平板支撑", "平板支撑_计时", "跪姿健腹轮前推", "静态侧卧支撑",
        "侧平板抬腿", "哥本哈根屈膝侧平板支撑", "卷腹", "反向卷腹", "绳索跪姿卷腹", "俄罗斯转体_徒手", "弹力带-下上转体", "站姿绳索转体",
        "侧桥髋外展", "俄罗斯转体", "器械坐姿卷腹", "站姿绳索卷腹", "跪姿平板支撑", "弹力带pallor推", "平板支撑抬腿_单侧",
    ),
}
PRIMARY_MUSCLE = {exercise: muscle for muscle, names in MUSCLE_GROUPS.items() for exercise in names}
STATIC_STRENGTH = {"平板支撑", "平板支撑_计时", "静态侧卧支撑", "哥本哈根屈膝侧平板支撑"}
NON_STRENGTH = {"record", "cardio", "tabata", "apple_health", "aerobic", "stretch", "有氧", "拉伸"}
WARMUP = {"热", "热身", "warmup", "warm-up"}
NONCOMPARABLE_LOAD = re.compile(r"辅助|助力|自重|引体向上|俯卧撑|双杠臂屈伸|单手|单臂|单腿|单侧|单边")
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
MAX_DAYS = 3_660
MAX_SETS = 100_000
MAX_BYTES = 16 * 1024 * 1024


def iso_date(value):
    if not isinstance(value, str) or ISO_DATE.fullmatch(value) is None:
        raise ValueError("expected an ISO date YYYY-MM-DD")
    return date.fromisoformat(value)


def text(value):
    return value.strip() if isinstance(value, str) else ""


def positive_number(value):
    if type(value) not in (int, float, str):
        return None
    try:
        number = float(value)
    except (ValueError, OverflowError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def weight_flag(value):
    if isinstance(value, str):
        stripped = value.strip().casefold()
        return stripped not in {"", "false", "0", "0.0"}
    return bool(value)


def has_truncation(value):
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, dict):
            if item.get("truncated") is True:
                return True
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return False


def comparable_load(exercise, record, reps):
    if (
        reps is None
        or exercise in STATIC_STRENGTH
        or NONCOMPARABLE_LOAD.search(exercise)
        or weight_flag(record.get("selfWeight"))
        or weight_flag(record.get("leftWeight"))
    ):
        return None
    unit = text(record.get("unit")).casefold()
    amount = positive_number(record.get("weight"))
    return {"amount": amount, "unit": unit} if amount is not None and amount <= 100_000 and unit in {"kg", "lb"} else None


class DayProjection:
    def __init__(self, day, result):
        self.day = day
        self.partial = has_truncation(result)
        self.sets = []
        for train in self.rows(result["trains"], "localid"):
            if train.get("datestr", day) != day:
                self.partial = True
                continue
            for movement in self.rows(train.get("movements"), "index"):
                self.add_movement(movement)

    def rows(self, values, identity):
        if not isinstance(values, list):
            self.partial = True
            return
        seen = set()
        for value in values:
            if not isinstance(value, dict):
                self.partial = True
                continue
            key = value.get(identity)
            if type(key) in (str, int) and key != "":
                key = str(key)
                if key in seen:
                    self.partial = True
                    continue
                seen.add(key)
            yield value

    def add_movement(self, movement):
        exercise = text(movement.get("name"))
        kinds = {text(movement.get("type")).casefold(), text(movement.get("exetype")).casefold()}
        if movement.get("cardio") is True or kinds & NON_STRENGTH:
            return
        if "timer" in kinds and exercise not in STATIC_STRENGTH:
            return
        for record in self.rows(movement.get("sets"), "index"):
            self.add_set(exercise, record)

    def add_set(self, exercise, record):
        if text(record.get("setType")).casefold() in WARMUP:
            return
        if "items" in record and record["items"] not in (None, []):
            for item in self.rows(record["items"], "index"):
                child = item.get("set")
                if not isinstance(child, dict):
                    self.partial = True
                    continue
                self.add_set(text(item.get("name")), child)
            return
        if record.get("done") is not True:
            if record.get("done") is not False:
                self.partial = True
            return
        if not exercise or len(exercise) > 240:
            self.partial = True
            return

        reps = positive_number(record.get("reps"))
        reps = int(reps) if reps is not None and reps <= 10_000 and reps.is_integer() else None
        # Drop segments belong to the parent set. A flat analytics row cannot
        # represent their separate load and repetitions without inflating set counts.
        self.sets.append({
            "exercise": exercise,
            "muscle": PRIMARY_MUSCLE.get(exercise),
            "reps": reps,
            "load": comparable_load(exercise, record, reps),
        })

    def result(self):
        return {"date": self.day, "status": "partial" if self.partial else "complete", "sets": self.sets}


def read_day(source, day):
    unavailable = {"date": day, "status": "unavailable", "sets": []}
    try:
        payload = json.loads((source / f"{day}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return unavailable
    data = payload.get("data") if isinstance(payload, dict) else None
    result = data.get("res") if isinstance(data, dict) else None
    if not isinstance(result, dict) or result.get("datestr") != day or not isinstance(result.get("trains"), list):
        return unavailable
    full_flags = [result[key] for key in ("includeFullData", "include_full_data") if key in result]
    mode = result.get("mode")
    if (
        any(flag is not True for flag in full_flags)
        or (mode is not None and mode != "full")
        or (mode != "full" and not full_flags)
    ):
        return unavailable
    return DayProjection(day, result).result()


def date_range(source, start, end):
    if start is not None or end is not None:
        first, last = iso_date(start), iso_date(end)
    else:
        dates = sorted(iso_date(path.stem) for path in source.glob("*.json") if ISO_DATE.fullmatch(path.stem))
        if not dates:
            raise ValueError("the input directory contains no dated JSON files")
        first, last = dates[0], dates[-1]
    if first > last:
        raise ValueError("the start date must be on or before the end date")
    count = (last - first).days + 1
    if count > MAX_DAYS:
        raise ValueError("select a date range of at most 3660 days")
    return ((first + timedelta(days=offset)).isoformat() for offset in range(count))


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog="Supply private full-read YYYY-MM-DD.json files. Missing dates remain unavailable. "
        "With no range, project every day between the first and last input date. "
        "Drop-set child segments are excluded from working-set counts and supported load volume. "
        "Keep both the source files and the derived file outside Git.",
    )
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path, help="new private JSON file, outside the input directory")
    parser.add_argument("--start", help="optional inclusive date range start")
    parser.add_argument("--end", help="optional inclusive date range end")
    args = parser.parse_args()
    try:
        if not args.input_dir.is_dir():
            raise ValueError("the input directory does not exist")
        if args.input_dir.resolve() in args.output.resolve().parents:
            raise ValueError("the output must be outside the input directory")
        days = [read_day(args.input_dir, day) for day in date_range(args.input_dir, args.start, args.end)]
        if sum(len(day["sets"]) for day in days) > MAX_SETS:
            raise ValueError("select a date range with at most 100000 completed sets")
        document = {"schemaVersion": 1, "source": "xunji", "days": days}
        contents = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(contents) > MAX_BYTES:
            raise ValueError("select a date range that fits in a 16 MiB snapshot")
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(contents)
    except ValueError as error:
        parser.error(str(error))
    except OSError:
        parser.error("unable to create a new private output file")


if __name__ == "__main__":
    main()
