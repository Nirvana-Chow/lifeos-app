"""Offline replay of the legacy and unified private CD evidence contracts."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
from pathlib import Path
import sqlite3
import subprocess
from tempfile import TemporaryDirectory
import unittest

from scripts import release_event_compat as compat
from scripts.release_eligibility import FULL_JOBS, RELEASE_JOBS

ROOT = Path(__file__).resolve().parents[1]
LEGACY_SHA = '428b974cd4981edc3967c8beb8a3dad014206c31'
UNIFIED_SHA = 'e' * 40  # Fixture identity, using the candidate workflow bytes.
REPO = {'id': compat.REPOSITORY_ID, 'full_name': compat.REPOSITORY}
WORKFLOW_IDS = {compat.CI: 101, compat.LEGACY_QUALIFICATION: 102}  # Synthetic IDs.


def git_blob(rev, path):
    if rev == UNIFIED_SHA and path == compat.CI:
        return (ROOT / path).read_bytes()
    return subprocess.check_output(['git', '--no-replace-objects', 'show', f'{rev}:{path}'], cwd=ROOT)


def step(name, conclusion='success'):
    return {'name': name, 'status': 'completed', 'conclusion': conclusion}


def payload(rows, key):
    return {'total_count': len(rows), key: rows}


def run_evidence(path, contract, run_id, attempt=1):
    url = f'https://github.com/{compat.REPOSITORY}/actions/runs/{run_id}'
    full = contract.profile == 'full'
    run = {'id': run_id, 'run_attempt': attempt, 'head_sha': contract.sha, 'head_branch': 'main',
           'path': path, 'event': 'push', 'status': 'completed', 'conclusion': 'success',
           'workflow_id': contract.pins[path].id, 'html_url': url,
           'repository': dict(REPO), 'head_repository': dict(REPO)}
    definitions = {name: [] for name in (RELEASE_JOBS if path == compat.CI else FULL_JOBS)}
    artifacts = []
    if path == compat.CI:
        definitions[compat.GATE].append(step(compat.GATE_STEP if contract.mode == 'unified' else compat.LEGACY_GATE_STEP))
    if contract.mode == 'unified':
        definitions[compat.POLICY] = []
        if full:
            definitions[compat.PLATFORM] = []
            definitions[compat.RECOVERY] = []
        if full or contract.affected_ui:
            full_result = 'success' if full else 'skipped'
            definitions[compat.RENDERED] = [
                step(compat.IMAGE_STEP, full_result), step('Verify compiled default-closed routes', full_result),
                step('Verify exact scoped release cases and cleanup', full_result),
                step('Verify additional UI cases actually ran', 'success' if contract.affected_ui else 'skipped'),
                step(compat.COMPILED_STEP, full_result),
                step(compat.CAPTURE_GUARD, 'success' if contract.visual else 'skipped'),
                step(compat.CAPTURE_STEP, 'success' if contract.visual else 'skipped'),
            ]
        suffix = f'{contract.sha}-{run_id}-{attempt}'
        names = []
        if full:
            names.append('lifeos-compiled-' + suffix)
        if contract.visual:
            names.append('synthetic-rendered-' + suffix)
        if full and attempt == 1:
            definitions[compat.GATE].append(step('Publish full qualification index'))
            names.append('lifeos-unified-full-green-v1')
        for index, name in enumerate(names, 500):
            artifacts.append({'id': index, 'name': name, 'size_in_bytes': 42, 'expired': False,
                              'digest': 'sha256:' + 'c' * 64,
                              'workflow_run': {'id': run_id, 'head_sha': contract.sha, 'head_branch': 'main',
                                               'repository_id': REPO['id'], 'head_repository_id': REPO['id']}})
    jobs = [{'id': index, 'name': name, 'run_id': run_id, 'run_attempt': attempt, 'head_sha': contract.sha,
             'status': 'completed', 'conclusion': 'success', 'html_url': f'{url}/job/{index}', 'steps': steps}
            for index, (name, steps) in enumerate(sorted(definitions.items()), 200)]
    return compat.RunEvidence(run, payload(jobs, 'jobs'), payload(artifacts, 'artifacts'))


def fixture(mode='unified', profile='full', visual=True, attempt=1, wake=None, source=None, workflow_ids=None, release_run_id=4101):
    sha = source or (UNIFIED_SHA if mode == 'unified' else LEGACY_SHA)
    workflow_ids = WORKFLOW_IDS if workflow_ids is None else workflow_ids
    paths = [compat.CI] + ([compat.LEGACY_QUALIFICATION] if mode == 'legacy' else [])
    workflow_bytes = {path: git_blob(sha, path) for path in paths}
    pins = {path: compat.WorkflowPin(workflow_ids[path], sha256(content).hexdigest())
            for path, content in workflow_bytes.items()}
    contract = compat.SourceContract(sha, mode, profile, visual if mode == 'legacy' else profile == 'full' and visual,
                                     pins, affected_ui=visual)
    release = run_evidence(compat.CI, contract, release_run_id, attempt)
    qualification = run_evidence(compat.LEGACY_QUALIFICATION, contract, 4102) if mode == 'legacy' and profile == 'full' else None
    event_run = qualification.run if wake == compat.LEGACY_QUALIFICATION else release.run
    event = {'action': 'completed', 'repository': dict(REPO),
             'workflow': {'id': event_run['workflow_id'], 'path': event_run['path']},
             'workflow_run': deepcopy(event_run)}
    return dict(event=event, signature_verified=True, contract=contract, workflow_bytes=workflow_bytes,
                release=release, qualification=qualification)


class CompatTest(unittest.TestCase):
    def assert_rejected(self, fixture, code):
        def unexpected(_):
            self.fail('rejected evidence reached the build claim')
        with self.assertRaisesRegex(ValueError, code):
            compat.claim_completion(**fixture, try_claim=unexpected)

    def test_scope_matrix_and_exact_attempt(self):
        for profile in ('routine', 'full'):
            for visual in (False, True):
                with self.subTest(profile=profile, visual=visual):
                    data = fixture(profile=profile, visual=visual, attempt=2)
                    claims = []
                    def claim(key):
                        claims.append(key)
                        return True

                    result = compat.claim_completion(**data, try_claim=claim)
                    self.assertEqual(result, compat.Eligibility(UNIFIED_SHA, 4101, 2, 'unified'))
                    self.assertEqual(claims, [(REPO['id'], UNIFIED_SHA)])

    def test_absent_empty_unsigned_ineligible_or_stale_events(self):
        changes = {
            'missing event': (None, 'EVENT_UNCONFIRMED'),
            'empty event': ({}, 'EVENT_UNCONFIRMED'),
            'requested event': ({'action': 'requested', 'repository': REPO}, 'EVENT_UNCONFIRMED'),
        }
        for label, (event, reason) in changes.items():
            with self.subTest(label=label):
                data = fixture()
                data['event'] = event
                self.assert_rejected(data, reason)
        data = fixture()
        data['signature_verified'] = False
        self.assert_rejected(data, 'EVENT_UNCONFIRMED')
        for fields in ({'head_sha': LEGACY_SHA}, {'id': 4100}, {'run_attempt': 1}, {'run_attempt': True},
                       {'head_branch': 'feature'}, {'conclusion': 'failure'}, {'status': 'in_progress'},
                       {'event': 'workflow_dispatch'}, {'workflow_id': 102}):
            with self.subTest(fields=fields):
                data = fixture(attempt=2)
                data['event']['workflow_run'].update(fields)
                self.assert_rejected(data, 'EVENT_RUN_UNCONFIRMED')
        data = fixture()
        data['event']['workflow_run'] = {}
        self.assert_rejected(data, 'EVENT_RUN_UNCONFIRMED')

    def test_bad_canonical_run_or_wrong_source_pin(self):
        for fields in ({'head_sha': LEGACY_SHA}, {'head_repository': {}}, {'path': compat.LEGACY_QUALIFICATION},
                       {'workflow_id': 102}, {'conclusion': 'cancelled'}, {'id': True}):
            with self.subTest(fields=fields):
                data = fixture()
                data['release'].run.update(fields)
                self.assert_rejected(data, 'RUN_UNCONFIRMED')
        data = fixture()
        data['workflow_bytes'][compat.CI] += b'\n'
        self.assert_rejected(data, 'WORKFLOW_PIN_UNCONFIRMED')

    def test_missing_empty_duplicate_and_wrong_attempt_evidence(self):
        for mutation in ('empty', 'missing', 'duplicate', 'stale', 'skipped'):
            with self.subTest(jobs=mutation):
                data = fixture()
                jobs = data['release'].jobs['jobs']
                if mutation == 'empty':
                    jobs.clear()
                elif mutation == 'missing':
                    jobs.pop()
                elif mutation == 'duplicate':
                    jobs[-1]['name'] = jobs[0]['name']
                elif mutation == 'stale':
                    jobs[0]['run_attempt'] += 1
                else:
                    jobs[0]['conclusion'] = 'skipped'
                data['release'].jobs['total_count'] = len(jobs)
                self.assert_rejected(data, 'JOBS_UNCONFIRMED')
        for mutation in ('empty', 'duplicate', 'stale', 'expired', 'wrong sha', 'wrong run'):
            with self.subTest(artifacts=mutation):
                data = fixture(attempt=2)
                evidence = data['release'].artifacts
                rows = evidence['artifacts']
                if mutation == 'empty':
                    rows.clear()
                elif mutation == 'duplicate':
                    rows.append(dict(rows[0], id=999))
                elif mutation == 'stale':
                    rows[0]['name'] = rows[0]['name'][:-1] + '1'
                elif mutation == 'expired':
                    rows[0]['expired'] = True
                elif mutation == 'wrong sha':
                    rows[0]['workflow_run']['head_sha'] = LEGACY_SHA
                else:
                    rows[0]['workflow_run']['id'] = 4102
                evidence['total_count'] = len(rows)
                self.assert_rejected(data, 'ARTIFACT_UNCONFIRMED')
        for name in (compat.GATE_STEP, compat.IMAGE_STEP, compat.CAPTURE_GUARD):
            with self.subTest(missing_step=name):
                data = fixture()
                for job in data['release'].jobs['jobs']:
                    job['steps'] = [row for row in job['steps'] if row['name'] != name]
                self.assert_rejected(data, 'STEP_UNCONFIRMED')

    def test_old_event_is_eligible_only_under_the_approved_legacy_source(self):
        old = fixture('legacy', wake=compat.LEGACY_QUALIFICATION)
        new = fixture()
        new['event'] = old['event']
        self.assert_rejected(new, 'EVENT_WORKFLOW_UNCONFIRMED')
        wrongly_pinned = dict(old, contract=replace(old['contract'], sha=UNIFIED_SHA))
        self.assert_rejected(wrongly_pinned, 'RUN_UNCONFIRMED')
        incomplete = dict(old, qualification=None)
        self.assert_rejected(incomplete, 'QUALIFICATION_SCOPE_UNCONFIRMED')
        result = compat.claim_completion(**old, try_claim=lambda key: key == (REPO['id'], LEGACY_SHA))
        self.assertEqual(result, compat.Eligibility(LEGACY_SHA, 4101, 1, 'legacy'))
        invalid = deepcopy(old)
        invalid['qualification'].jobs['jobs'][0]['conclusion'] = 'skipped'
        self.assert_rejected(invalid, 'FULL_QUALIFICATION_UNCONFIRMED')

    def test_one_atomic_source_claim_across_restart_rerun_and_old_twin_events(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic-claims.sqlite'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE claims (repo INTEGER, sha TEXT, PRIMARY KEY (repo, sha))')

            def claim(key):
                with sqlite3.connect(path) as db:
                    return db.execute('INSERT OR IGNORE INTO claims VALUES (?, ?)', key).rowcount == 1

            first = fixture()

            def deliver(_):
                try:
                    compat.claim_completion(**first, try_claim=claim)
                    return 'claimed'
                except ValueError as error:
                    return str(error)

            with ThreadPoolExecutor(max_workers=2) as workers:
                self.assertCountEqual(workers.map(deliver, range(2)), ['claimed', 'SOURCE_ALREADY_CLAIMED'])
            for later in (first, fixture(attempt=2)):
                with self.assertRaisesRegex(ValueError, 'SOURCE_ALREADY_CLAIMED'):
                    compat.claim_completion(**later, try_claim=claim)
            compat.claim_completion(**fixture('legacy', wake=compat.LEGACY_QUALIFICATION), try_claim=claim)
            with self.assertRaisesRegex(ValueError, 'SOURCE_ALREADY_CLAIMED'):
                compat.claim_completion(**fixture('legacy'), try_claim=claim)
            with sqlite3.connect(path) as db:
                self.assertEqual(set(db.execute('SELECT sha FROM claims')), {(UNIFIED_SHA,), (LEGACY_SHA,)})

    def test_candidate_still_has_one_entry_and_image_build(self):
        workflow = (ROOT / compat.CI).read_text()
        self.assertEqual([path.name for path in (ROOT / '.github/workflows').glob('*.yml')], ['ci.yml'])
        for command in ('npm test', 'npm run typecheck', 'npm audit --audit-level=high', 'docker build --pull'):
            self.assertEqual(workflow.count(command), 1, command)
        self.assertEqual(workflow.count('"$CI_IMAGE_ID"'), 2)
        for marker in (compat.GATE_STEP, compat.IMAGE_STEP, compat.COMPILED_STEP, compat.CAPTURE_GUARD, compat.CAPTURE_STEP):
            self.assertIn('name: ' + marker, workflow)
        for marker in (compat.IMAGE_STEP, 'Verify compiled default-closed routes'):
            self.assertIn("name: " + marker + "\n        if: needs.policy.outputs.profile == 'full'", workflow)


if __name__ == '__main__':
    unittest.main()
