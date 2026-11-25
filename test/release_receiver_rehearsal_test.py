"""Offline webhook-to-claim rehearsal. SQLite and native activation are fixtures only."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from hashlib import sha256
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock

from release_event_compat_test import UNIFIED_SHA, fixture, git_blob
from scripts import release_event_compat as compat

OLD = '428b974cd4981edc3967c8beb8a3dad014206c31'
UNIFIED = UNIFIED_SHA
WORKFLOWS = {compat.CI: 404768741, compat.LEGACY_QUALIFICATION: 407828015}
PINS = {
    OLD: {
        compat.CI: 'da08f412b20a21a1d36642cf137acadcae917fe054803bca6bf63e9021bbd724',
        compat.LEGACY_QUALIFICATION: '384e14c8680899a8e170d05dfa10ceb50e6eb33a2ca299dd843859b3d5c666d4',
    },
    UNIFIED: {compat.CI: '4d2371cb10485e12d32407adc4aa897672ad4d91dfd91a0ed64a792706078612'},
}
KEY = b'fixture-only-webhook-key'
TARGET = 'fixture-platform'


def delivery(event):
    body = json.dumps(event, sort_keys=True, separators=(',', ':')).encode()
    return body, 'sha256=' + hmac.digest(KEY, body, 'sha256').hex()


def crash_at(actual, expected):
    if actual == expected:
        os._exit(86)


def publish_fast_fixture(eligible, approved_overlay, existing, build, switch):
    """Model the private handoff without access to the actual publisher."""
    binding = (eligible.sha, eligible.run_id, eligible.attempt, approved_overlay)
    receipt = existing if existing is not None else build(binding)
    if receipt['binding'] != binding or not re.fullmatch(r'sha256:[a-f0-9]{64}', receipt['image']):
        raise ValueError('PRIVATE_IMAGE_UNCONFIRMED')
    switch(receipt['image'])


class Receiver:
    """Fake receiver with independent authenticated source selection and canonical Actions rows."""

    def __init__(self, ledger):
        self.ledger = str(ledger)
        self.actions = {
            OLD: fixture('legacy', source=OLD, workflow_ids=WORKFLOWS),
            UNIFIED: fixture('unified', source=UNIFIED, workflow_ids=WORKFLOWS, release_run_id=4201),
        }

    def initialize(self):
        with sqlite3.connect(self.ledger) as db:
            db.executescript("""
                CREATE TABLE selected (target TEXT PRIMARY KEY, source TEXT, revision INTEGER);
                CREATE TABLE claims (
                    repository INTEGER, target TEXT, source TEXT, phase TEXT,
                    PRIMARY KEY(repository, target, source)
                );
                CREATE TABLE native_switches (
                    repository INTEGER, target TEXT, source TEXT,
                    PRIMARY KEY(repository, target, source)
                );
            """)
            db.executemany('INSERT INTO selected VALUES (?, ?, ?)', [(TARGET, OLD, 1), ('fixture-preview', OLD, 1)])

    def selection(self, target=TARGET):
        with sqlite3.connect(self.ledger) as db:
            return db.execute('SELECT source, revision FROM selected WHERE target=?', (target,)).fetchone()

    def rotate(self, before, after, crash=None):
        if after not in self.actions:
            raise ValueError('SWITCH_SOURCE_UNCONFIRMED')
        with sqlite3.connect(self.ledger) as db:
            db.execute('BEGIN IMMEDIATE')
            pending = db.execute('SELECT 1 FROM claims WHERE target=? AND phase=?',
                                 (TARGET, 'switch_started')).fetchone()
            if pending:
                raise ValueError('ACTIVATION_REQUIRES_RECONCILIATION')
            changed = db.execute(
                'UPDATE selected SET source=?,revision=revision+1 WHERE target=? AND source=? AND revision=?',
                (after, TARGET, *before),
            ).rowcount
            if changed != 1:
                raise ValueError('SWITCH_SELECTION_CHANGED')
            crash_at('before-selection-commit', crash)
        crash_at('after-selection-commit', crash)

    def receive(self, body, signature, *, target=TARGET, event_name='workflow_run', crash=None):
        if (event_name != 'workflow_run'
                or not hmac.compare_digest('sha256=' + hmac.digest(KEY, body, 'sha256').hex(), signature)):
            raise ValueError('EVENT_UNCONFIRMED')
        event = json.loads(body)
        with sqlite3.connect(self.ledger) as db:
            # Hold the same transaction across profile selection and claim.
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT source FROM selected WHERE target=?', (target,)).fetchone()
            if not row:
                raise ValueError('TARGET_UNCONFIRMED')
            source = row[0]
            chosen = self.actions[source]
            contract = chosen['contract']
            # These digests are fixed separately from the candidate bytes and cannot come from the event.
            reviewed = {path: compat.WorkflowPin(WORKFLOWS[path], digest)
                        for path, digest in PINS[source].items()}
            if contract.sha != source or contract.pins != reviewed:
                raise ValueError('REVIEWED_PINS_CHANGED')
            content = {path: git_blob(source, path) for path in PINS[source]}

            def claim(identity):
                repo, sha = identity
                written = db.execute('INSERT OR IGNORE INTO claims VALUES (?, ?, ?, ?)',
                                     (repo, target, sha, 'claimed')).rowcount
                crash_at('before-claim-commit', crash)
                return written == 1

            eligible = compat.claim_completion(
                event, signature_verified=True, contract=contract, workflow_bytes=content,
                release=chosen['release'], qualification=chosen['qualification'], try_claim=claim,
            )
        crash_at('after-claim-commit', crash)
        return eligible

    def rows(self, table):
        statements = {'claims': 'SELECT target,source,phase FROM claims ORDER BY target,source',
                      'switches': 'SELECT target,source FROM native_switches ORDER BY target,source'}
        with sqlite3.connect(self.ledger) as db:
            return db.execute(statements[table]).fetchall()

    def activate_fixture(self, crash=None):
        with sqlite3.connect(self.ledger) as db:
            db.execute('BEGIN IMMEDIATE')
            selected = db.execute('SELECT source FROM selected WHERE target=?', (TARGET,)).fetchone()
            if selected != (UNIFIED,):
                raise ValueError('ACTIVATION_SOURCE_CHANGED')
            changed = db.execute(
                'UPDATE claims SET phase=? WHERE target=? AND source=? AND phase=?',
                ('switch_started', TARGET, UNIFIED, 'claimed'),
            ).rowcount
            if changed != 1:
                raise ValueError('ACTIVATION_REQUIRES_RECONCILIATION')
            crash_at('before-activation-marker', crash)
        crash_at('before-native-switch', crash)
        # Separate commit models one external Native switch with later private readback.
        with sqlite3.connect(self.ledger) as db:
            db.execute('INSERT INTO native_switches VALUES (?, ?, ?)', (compat.REPOSITORY_ID, TARGET, UNIFIED))
        crash_at('after-native-switch', crash)
        self.reconcile_fixture()

    def reconcile_fixture(self):
        with sqlite3.connect(self.ledger) as db:
            observed = db.execute('SELECT 1 FROM native_switches WHERE target=? AND source=?',
                                  (TARGET, UNIFIED)).fetchone()
            if not observed:
                return 'unconfirmed'
            db.execute('UPDATE claims SET phase=? WHERE target=? AND source=? AND phase=?',
                       ('verified', TARGET, UNIFIED, 'switch_started'))
            return 'verified'


class RehearsalTest(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory(prefix='lifeos-cutover-rehearsal-')
        self.addCleanup(directory.cleanup)
        self.receiver = Receiver(Path(directory.name) / 'fixture.sqlite')
        self.receiver.initialize()

    def emit(self, event=None, **options):
        if event is None:
            event = self.receiver.actions[self.receiver.selection()[0]]['event']
        return self.receiver.receive(*delivery(event), **options)

    def crash(self, step):
        result = subprocess.run([sys.executable, __file__, '--fixture-crash', self.receiver.ledger, step],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 86, result.stdout + result.stderr)
        return Receiver(self.receiver.ledger)

    def select_unified(self):
        self.receiver.rotate((OLD, 1), UNIFIED)

    def test_compatibility_first_old_pair_and_unified_profile_each_complete(self):
        original = self.receiver.actions[OLD]
        self.assertEqual(set(original['contract'].pins), {compat.CI, compat.LEGACY_QUALIFICATION})
        self.assertEqual(self.emit().mode, 'legacy')
        self.select_unified()
        self.assertEqual(self.emit().mode, 'unified')
        self.assertEqual(set(self.receiver.rows('claims')), {(TARGET, OLD, 'claimed'), (TARGET, UNIFIED, 'claimed')})

    def test_signed_pair_retry_reordered_and_concurrent_duplicates_share_source_target(self):
        old = self.receiver.actions[OLD]
        qualification = old['qualification']
        old['qualification'] = None
        with self.assertRaisesRegex(ValueError, 'QUALIFICATION_SCOPE_UNCONFIRMED'):
            self.emit()
        self.assertEqual(self.receiver.rows('claims'), [])
        old['qualification'] = qualification
        completion = deepcopy(old['event'])
        completion['workflow'] = {'id': WORKFLOWS[compat.LEGACY_QUALIFICATION], 'path': compat.LEGACY_QUALIFICATION}
        completion['workflow_run'] = qualification.run

        def send(event):
            try:
                self.emit(event)
                return 'accepted'
            except ValueError as error:
                return str(error)

        with ThreadPoolExecutor(max_workers=3) as pool:
            self.assertCountEqual(pool.map(send, [completion, old['event'], completion]),
                                  ['accepted', 'SOURCE_ALREADY_CLAIMED', 'SOURCE_ALREADY_CLAIMED'])
        self.assertEqual(self.emit(old['event'], target='fixture-preview').sha, OLD)
        self.assertEqual(len(self.receiver.rows('claims')), 2)

    def test_reject_bad_signatures_wrong_workflow_manual_stale_commit_partial_and_profile_mix(self):
        self.select_unified()
        chosen = self.receiver.actions[UNIFIED]
        original_event = chosen['event']
        body, signature = delivery(original_event)
        with self.assertRaisesRegex(ValueError, 'EVENT_UNCONFIRMED'):
            self.receiver.receive(body + b' ', signature)
        with self.assertRaisesRegex(ValueError, 'EVENT_UNCONFIRMED'):
            self.receiver.receive(body, signature, event_name='check_run')
        for mutate, reason in (
                (lambda row: row['workflow'].update(id=407862133), 'EVENT_WORKFLOW_UNCONFIRMED'),
                (lambda row: row['workflow_run'].update(event='workflow_dispatch'), 'EVENT_RUN_UNCONFIRMED'),
                (lambda row: row['workflow_run'].update(head_sha=OLD), 'EVENT_RUN_UNCONFIRMED'),
                (lambda row: row['workflow_run'].update(run_attempt=2), 'EVENT_RUN_UNCONFIRMED'),
                (lambda row: row['workflow_run'].update(id=4099), 'EVENT_RUN_UNCONFIRMED')):
            event = deepcopy(original_event)
            mutate(event)
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, reason):
                self.emit(event)
        legacy = self.receiver.actions[OLD]
        chosen['qualification'] = legacy['qualification']
        with self.assertRaisesRegex(ValueError, 'QUALIFICATION_SCOPE_UNCONFIRMED'):
            self.emit()
        chosen['qualification'] = None
        jobs = chosen['release'].jobs
        previous = deepcopy(jobs)
        jobs['jobs'] = [row for row in jobs['jobs'] if row['name'] != compat.RECOVERY]
        jobs['total_count'] = len(jobs['jobs'])
        with self.assertRaisesRegex(ValueError, 'JOBS_UNCONFIRMED'):
            self.emit()
        jobs.update(previous)
        jobs['jobs'][0]['run_attempt'] += 1
        with self.assertRaisesRegex(ValueError, 'JOBS_UNCONFIRMED'):
            self.emit()
        self.assertEqual(self.receiver.rows('claims'), [])
        jobs['jobs'][0]['run_attempt'] -= 1
        self.assertEqual(self.emit().sha, UNIFIED)

    def test_legacy_pair_requires_exact_distinct_runs_and_same_sha(self):
        old = self.receiver.actions[OLD]
        run = old['qualification'].run
        for fields, reason in (
                ({'head_sha': UNIFIED}, 'RUN_UNCONFIRMED'),
                ({'event': 'workflow_dispatch'}, 'RUN_UNCONFIRMED'),
                ({'id': old['release'].run['id'], 'html_url': old['release'].run['html_url']}, 'RUN_PAIR_UNCONFIRMED')):
            saved = dict(run)
            run.update(fields)
            with self.subTest(fields=fields), self.assertRaisesRegex(ValueError, reason):
                self.emit()
            run.clear()
            run.update(saved)
        old['qualification'].jobs['jobs'][0]['run_attempt'] += 1
        with self.assertRaisesRegex(ValueError, 'FULL_QUALIFICATION_UNCONFIRMED'):
            self.emit()
        self.assertEqual(self.receiver.rows('claims'), [])

    def test_signed_failed_or_cancelled_unified_attempt_cannot_claim_or_activate(self):
        self.select_unified()
        chosen = self.receiver.actions[UNIFIED]
        complete = chosen['event']
        run = chosen['release'].run
        gate = next(job for job in chosen['release'].jobs['jobs'] if job['name'] == compat.GATE)
        for conclusion in ('failure', 'cancelled'):
            with self.subTest(conclusion=conclusion):
                event = deepcopy(complete)
                event['workflow_run']['conclusion'] = conclusion
                with self.assertRaisesRegex(ValueError, 'EVENT_RUN_UNCONFIRMED'):
                    self.emit(event)

                run['conclusion'] = conclusion
                with self.assertRaisesRegex(ValueError, 'RUN_UNCONFIRMED'):
                    self.emit(complete)
                run['conclusion'] = 'success'

                gate['conclusion'] = conclusion
                with self.assertRaisesRegex(ValueError, 'JOBS_UNCONFIRMED'):
                    self.emit(complete)
                gate['conclusion'] = 'success'

                self.assertEqual(self.receiver.rows('claims'), [])
                self.assertEqual(self.receiver.rows('switches'), [])

    def test_routine_ui_claim_builds_once_or_reuses_the_exact_private_image(self):
        overlay = 'a' * 64
        image = 'sha256:' + 'b' * 64
        self.select_unified()
        self.receiver.actions[UNIFIED] = fixture(
            'unified', profile='routine', visual=True, source=UNIFIED, workflow_ids=WORKFLOWS, release_run_id=4201)
        eligible = self.emit()
        binding = (UNIFIED, 4201, 1, overlay)
        self.assertEqual(self.receiver.actions[UNIFIED]['release'].artifacts['artifacts'], [])
        for already_bound in (False, True):
            with self.subTest(already_bound=already_bound):
                receipt = {'binding': binding, 'image': image}
                builder = Mock(return_value=receipt)
                switch = Mock()
                publish_fast_fixture(eligible, overlay, receipt if already_bound else None, builder, switch)
                if already_bound:
                    builder.assert_not_called()
                else:
                    builder.assert_called_once_with(binding)
                switch.assert_called_once_with(image)
        for receipt in (
            {'binding': (UNIFIED, 4201, 2, overlay), 'image': image},
            {'binding': (UNIFIED, 4202, 1, overlay), 'image': image},
            {'binding': (OLD, 4201, 1, overlay), 'image': image},
            {'binding': (UNIFIED, 4201, 1, 'c' * 64), 'image': image},
            {'binding': binding, 'image': 'fixture:latest'},
        ):
            builder = Mock()
            switch = Mock()
            with self.assertRaisesRegex(ValueError, 'PRIVATE_IMAGE_UNCONFIRMED'):
                publish_fast_fixture(eligible, overlay, receipt, builder, switch)
            builder.assert_not_called()
            switch.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'SOURCE_ALREADY_CLAIMED'):
            self.emit()

    def test_atomic_selection_crashes_before_and_after_commit_and_exact_old_mode_restore(self):
        self.receiver = self.crash('before-selection-commit')
        self.assertEqual(self.receiver.selection(), (OLD, 1))
        self.emit()
        self.receiver = self.crash('after-selection-commit')
        self.assertEqual(self.receiver.selection(), (UNIFIED, 2))
        with self.assertRaisesRegex(ValueError, 'SWITCH_SELECTION_CHANGED'):
            self.receiver.rotate((OLD, 1), UNIFIED)
        with self.assertRaisesRegex(ValueError, 'EVENT_RUN_UNCONFIRMED'):
            self.emit(self.receiver.actions[OLD]['event'])
        self.emit()
        self.receiver.rotate((UNIFIED, 2), OLD)
        self.assertEqual(self.receiver.selection(), (OLD, 3))
        with self.assertRaisesRegex(ValueError, 'ACTIVATION_SOURCE_CHANGED'):
            self.receiver.activate_fixture()
        self.assertEqual(self.receiver.rows('switches'), [])
        with self.assertRaisesRegex(ValueError, 'EVENT_RUN_UNCONFIRMED'):
            self.emit(self.receiver.actions[UNIFIED]['event'])
        with self.assertRaisesRegex(ValueError, 'SOURCE_ALREADY_CLAIMED'):
            self.emit()
        self.assertEqual(set(self.receiver.rows('claims')), {(TARGET, OLD, 'claimed'), (TARGET, UNIFIED, 'claimed')})

    def test_worker_crash_before_claim_commit_and_after_commit_before_ack(self):
        self.select_unified()
        self.receiver = self.crash('before-claim-commit')
        self.assertEqual(self.receiver.rows('claims'), [])
        self.receiver = self.crash('after-claim-commit')
        self.assertEqual(self.receiver.rows('claims'), [(TARGET, UNIFIED, 'claimed')])
        with self.assertRaisesRegex(ValueError, 'SOURCE_ALREADY_CLAIMED'):
            self.emit()
        self.receiver.actions[UNIFIED] = fixture(
            'unified', attempt=2, source=UNIFIED, workflow_ids=WORKFLOWS, release_run_id=4201)
        with self.assertRaisesRegex(ValueError, 'SOURCE_ALREADY_CLAIMED'):
            self.emit()
        self.assertEqual(self.receiver.rows('claims'), [(TARGET, UNIFIED, 'claimed')])

    def test_native_before_activation_marker_and_after_switch_recovery(self):
        self.select_unified()
        self.emit()
        self.receiver = self.crash('before-activation-marker')
        self.assertEqual(self.receiver.rows('claims'), [(TARGET, UNIFIED, 'claimed')])
        self.receiver = self.crash('after-native-switch')
        self.assertEqual(self.receiver.rows('claims'), [(TARGET, UNIFIED, 'switch_started')])
        with self.assertRaisesRegex(ValueError, 'ACTIVATION_REQUIRES_RECONCILIATION'):
            self.receiver.rotate((UNIFIED, 2), OLD)
        self.assertEqual(self.receiver.reconcile_fixture(), 'verified')
        self.assertEqual(self.receiver.rows('claims'), [(TARGET, UNIFIED, 'verified')])
        with self.assertRaisesRegex(ValueError, 'ACTIVATION_REQUIRES_RECONCILIATION'):
            self.receiver.activate_fixture()
        self.assertEqual(self.receiver.rows('switches'), [(TARGET, UNIFIED)])
        self.receiver.rotate((UNIFIED, 2), OLD)
        self.assertEqual(self.receiver.selection(), (OLD, 3))

    def test_native_unknown_after_marker_never_blindly_switches_again(self):
        self.select_unified()
        self.emit()
        self.receiver = self.crash('before-native-switch')
        self.assertEqual(self.receiver.reconcile_fixture(), 'unconfirmed')
        self.assertEqual(self.receiver.rows('claims'), [(TARGET, UNIFIED, 'switch_started')])
        with self.assertRaisesRegex(ValueError, 'ACTIVATION_REQUIRES_RECONCILIATION'):
            self.receiver.activate_fixture()
        self.assertEqual(self.receiver.rows('switches'), [])


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--fixture-crash':
        receiver = Receiver(sys.argv[2])
        point = sys.argv[3]
        if point.endswith('selection-commit'):
            receiver.rotate((OLD, 1), UNIFIED, crash=point)
        elif point.endswith('claim-commit'):
            receiver.receive(*delivery(receiver.actions[UNIFIED]['event']), crash=point)
        else:
            receiver.activate_fixture(crash=point)
    else:
        unittest.main()
