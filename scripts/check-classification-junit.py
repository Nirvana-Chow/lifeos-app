"""Finite enabled classification results; Node parent totals are not leaf counts.

Reuses the workflow's standard-library ElementTree checks. The case manifest is
calibrated against captured Node JUnit, independently of the test source text.
This validates results only; it does not replace the test process exit status.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check(profile, report):
    profiles = json.loads(Path(__file__).with_name('classification-junit-cases.json').read_text())
    require(profile in profiles, 'unknown profile')
    expected = profiles[profile]
    data = Path(report).read_bytes()
    require(0 < len(data) <= 2_000_000, 'empty or oversized report')
    # Decode before scanning/parsing: ElementTree otherwise auto-detects UTF-16
    # and can expand declarations that an ASCII byte scan never observes.
    text = data.decode('utf-8')
    require('\x00' not in text, 'NUL is not allowed in UTF-8 XML')
    declaration = re.match(r'\ufeff?<\?xml\s.*?\?>', text, re.DOTALL)
    if declaration:
        encoding = re.search(r"""\bencoding\s*=\s*(['"])(.*?)\1""", declaration.group())
        require(encoding is None or encoding.group(2).lower() == 'utf-8', 'UTF-8 XML encoding required')
    require('<!DOCTYPE' not in text and '<!ENTITY' not in text, 'unsupported XML declarations')
    root = ET.fromstring(text)
    require(root.tag == 'testsuites', 'expected Node testsuites root')
    # A skipped top-level test may be a direct testcase rather than a suite.
    require(not any(node.tag in ('skipped', 'failure', 'error') for node in root.iter()),
            'skipped, failed or errored result')
    require(all(node.tag in ('testsuite', 'testcase') for node in root), 'unexpected root result')
    suites = root.findall('testsuite')
    names = [suite.get('name') for suite in suites]
    require(len(names) == len(set(names)) and set(names) == set(expected['suites']),
            'missing, duplicate or unexpected suite')

    def cases(parent, wanted):
        require(all(node.tag == 'testcase' for node in parent), 'unexpected suite result')
        found = list(parent)
        names = [case.get('name') for case in found]
        require(len(names) == len(set(names)) and set(names) == set(wanted),
                'missing, duplicate or unexpected leaf case')
        for case in found:
            require(not list(case), 'unexpected leaf result')
            source = (case.get('file') or '').replace('\\', '/')
            require(source == expected['file'] or source.endswith('/' + expected['file']),
                    'unexpected leaf source')
        return len(found)

    count = 0
    for suite in suites:
        leaf_count = cases(suite, expected['suites'][suite.get('name')])
        for field in ('tests', 'disabled', 'errors', 'failures', 'skipped'):
            value = suite.get(field, '')
            require(re.fullmatch(r'0|[1-9][0-9]*', value) is not None, 'missing or malformed summary')
            require(int(value) == (leaf_count if field == 'tests' else 0), 'incorrect or nonzero summary')
        count += leaf_count
    direct = ET.Element('direct')
    direct.extend(root.findall('testcase'))
    count += cases(direct, expected['cases'])
    require(count > 0, 'expected enabled leaf cases')
    print(f'PASS: classification {profile}, {len(suites)} suites, {count} leaf cases; zero skips/failures/errors.')


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 3, 'usage: profile report.xml')
        check(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, KeyError, TypeError, ET.ParseError) as error:
        print(f'CLASSIFICATION_JUNIT_DENIED: {error}', file=sys.stderr)
        sys.exit(1)
