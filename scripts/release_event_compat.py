"""Read-only compatibility contract for a private worker integration review.

The existing receiver authenticates the webhook and the worker supplies reviewed
source pins, independent scope and canonical Actions evidence. The adapter has
no network, build, deployment or storage implementation.
"""
from dataclasses import dataclass
from hashlib import sha256
import re

from .release_eligibility import FULL_JOBS, REPOSITORY, REPOSITORY_ID, RELEASE_JOBS, qualify_full

CI = '.github/workflows/ci.yml'
LEGACY_QUALIFICATION = '.github/workflows/qualification.yml'
POLICY = 'Qualification policy'
PLATFORM = 'Isolated Auth, permissions and PostgreSQL'
RECOVERY = 'Isolated PostgreSQL recovery and native MFA'
RENDERED = 'Exact package and isolated TLS/browser qualification'
GATE = 'Release eligibility'
GATE_STEP = 'Verify exact attempt and all required qualification evidence'
LEGACY_GATE_STEP = 'Verify real full-green evidence and cumulative source policy'
IMAGE_STEP = 'Build the exact public source image and read back its source proof'
COMPILED_STEP = 'Publish exact compiled Next output'
CAPTURE_STEP = 'Upload only named synthetic images and their finite manifest'
CAPTURE_GUARD = 'Verify finite synthetic capture manifest and PNGs'


@dataclass(frozen=True)
class WorkflowPin:
    id: int
    digest: str


@dataclass(frozen=True)
class SourceContract:
    sha: str
    mode: str
    profile: str
    visual: bool
    pins: dict[str, WorkflowPin]
    affected_ui: bool = False


@dataclass(frozen=True)
class RunEvidence:
    run: dict
    jobs: dict
    artifacts: dict


@dataclass(frozen=True)
class Eligibility:
    sha: str
    run_id: int
    attempt: int
    mode: str


def _require(condition, code):
    if not condition:
        raise ValueError(code)


def _positive(value):
    return type(value) is int and value > 0


def _hex(value, count):
    return isinstance(value, str) and re.fullmatch(f'[a-f0-9]{{{count}}}', value) is not None


def _repo(row):
    return (isinstance(row, dict) and type(row.get('id')) is int
            and row['id'] == REPOSITORY_ID and row.get('full_name') == REPOSITORY)


def _matches(row, fields):
    return isinstance(row, dict) and all(
        type(row.get(key)) is type(value) and row[key] == value for key, value in fields.items())


def _completion_fields(sha, workflow_id):
    return {'head_sha': sha, 'head_branch': 'main', 'event': 'push',
            'status': 'completed', 'conclusion': 'success', 'workflow_id': workflow_id}


def _source(contract, workflow_bytes):
    _require(_hex(contract.sha, 40) and contract.sha != '0' * 40 and contract.mode in ('legacy', 'unified')
             and contract.profile in ('routine', 'full') and type(contract.visual) is bool,
             'SOURCE_CONTRACT_UNCONFIRMED')
    paths = {CI, LEGACY_QUALIFICATION} if contract.mode == 'legacy' else {CI}
    if contract.mode == 'unified':
        _require(type(contract.affected_ui) is bool
                 and contract.visual is (contract.profile == 'full' and contract.affected_ui),
                 'SOURCE_CONTRACT_UNCONFIRMED')
    _require(set(contract.pins) == paths and set(workflow_bytes) == paths,
             'SOURCE_CONTRACT_UNCONFIRMED')
    for path, pin in contract.pins.items():
        content = workflow_bytes[path]
        _require(_positive(pin.id) and _hex(pin.digest, 64) and isinstance(content, bytes)
                 and sha256(content).hexdigest() == pin.digest, 'WORKFLOW_PIN_UNCONFIRMED')
    _require(len({pin.id for pin in contract.pins.values()}) == len(paths), 'WORKFLOW_PIN_UNCONFIRMED')


def _run(evidence, path, contract):
    _require(isinstance(evidence, RunEvidence) and isinstance(evidence.run, dict),
             'RUN_UNCONFIRMED')
    run = evidence.run
    run_id, attempt = run.get('id'), run.get('run_attempt')
    _require(_positive(run_id) and _positive(attempt), 'RUN_UNCONFIRMED')
    url = f'https://github.com/{REPOSITORY}/actions/runs/{run_id}'
    _require(_matches(run, {**_completion_fields(contract.sha, contract.pins[path].id),
                           'path': path, 'html_url': url})
             and _repo(run.get('repository')) and _repo(run.get('head_repository')), 'RUN_UNCONFIRMED')
    return run_id, attempt


def _rows(payload, key, limit, code):
    rows = payload.get(key) if isinstance(payload, dict) else None
    _require(isinstance(rows, list) and len(rows) <= limit
             and _matches(payload, {'total_count': len(rows)})
             and all(isinstance(row, dict) and _positive(row.get('id')) for row in rows)
             and len({row['id'] for row in rows}) == len(rows), code)
    return rows


def _jobs(evidence, identity, expected):
    code = 'JOBS_UNCONFIRMED'
    rows = _rows(evidence.jobs, 'jobs', len(expected), code)
    found = {}
    for job in rows:
        name, job_id = job.get('name'), job['id']
        _require(isinstance(name, str) and name in expected and name not in found, code)
        _require(_matches(job, {'head_sha': identity.sha, 'run_id': identity.run_id,
                               'run_attempt': identity.attempt, 'status': 'completed',
                               'conclusion': expected[name],
                               'html_url': f'https://github.com/{REPOSITORY}/actions/runs/{identity.run_id}/job/{job_id}'}), code)
        found[name] = job
    _require(all(name in found for name, result in expected.items() if result == 'success'), code)
    return found


def _step(job, name, conclusion='success'):
    steps = job.get('steps')
    _require(isinstance(steps, list) and all(isinstance(row, dict) for row in steps),
             'STEP_UNCONFIRMED')
    matches = [row for row in steps if row.get('name') == name]
    _require(len(matches) == 1 and _matches(matches[0], {'status': 'completed', 'conclusion': conclusion}),
             'STEP_UNCONFIRMED')


def _artifacts(evidence, identity, expected_names):
    code = 'ARTIFACT_UNCONFIRMED'
    rows = _rows(evidence.artifacts, 'artifacts', 100, code)
    for name in expected_names:
        matches = [row for row in rows if row.get('name') == name]
        _require(len(matches) == 1, code)
        artifact = matches[0]
        digest = artifact.get('digest')
        _require(artifact.get('expired') is False and _positive(artifact.get('size_in_bytes'))
                 and isinstance(digest, str) and digest.startswith('sha256:') and _hex(digest[7:], 64)
                 and _matches(artifact.get('workflow_run'), {'id': identity.run_id,
                              'head_sha': identity.sha, 'head_branch': 'main',
                              'repository_id': REPOSITORY_ID, 'head_repository_id': REPOSITORY_ID}), code)


def _unified(evidence, identity, contract):
    full = contract.profile == 'full'
    visual = contract.visual
    expected = {name: 'success' for name in RELEASE_JOBS | {POLICY}}
    expected[PLATFORM] = expected[RECOVERY] = 'success' if full else 'skipped'
    expected[RENDERED] = 'success' if full or contract.affected_ui else 'skipped'
    jobs = _jobs(evidence, identity, expected)
    # The exact pinned gate checks all named producers, case guards and outputs.
    _step(jobs[GATE], GATE_STEP)
    names = []
    suffix = f'{identity.sha}-{identity.run_id}-{identity.attempt}'
    if full or contract.affected_ui:
        rendered = jobs[RENDERED]
        for name in (IMAGE_STEP, 'Verify compiled default-closed routes', COMPILED_STEP,
                     'Verify exact scoped release cases and cleanup'):
            _step(rendered, name, 'success' if full else 'skipped')
        _step(rendered, 'Verify additional UI cases actually ran', 'success' if contract.affected_ui else 'skipped')
        for name in (CAPTURE_GUARD, CAPTURE_STEP):
            _step(rendered, name, 'success' if visual else 'skipped')
    if full:
        names.append('lifeos-compiled-' + suffix)
    if visual:
        names.append('synthetic-rendered-' + suffix)
    if full and identity.attempt == 1:
        _step(jobs[GATE], 'Publish full qualification index')
        names.append('lifeos-unified-full-green-v1')
    if names:
        _artifacts(evidence, identity, names)


def claim_completion(event, *, signature_verified, contract, workflow_bytes,
                     release, qualification=None, try_claim):
    """Return exact eligibility only after the existing worker atomically claims the SHA.

    The caller selects the currently approved source (or the explicitly approved
    legacy rollback target) and obtains the current canonical run/attempt for each
    pinned workflow from Actions. Webhook fields are just a wake-up identity.
    The SHA claim is scoped to this repository and must survive deliveries and
    restarts. The worker owns durable retries and every existing publication gate.
    """
    _require(signature_verified is True and isinstance(event, dict)
             and event.get('action') == 'completed' and _repo(event.get('repository')),
             'EVENT_UNCONFIRMED')
    _source(contract, workflow_bytes)
    workflow = event.get('workflow')
    path = workflow.get('path') if isinstance(workflow, dict) else None
    _require(isinstance(path, str) and path in contract.pins
             and _matches(workflow, {'id': contract.pins[path].id}), 'EVENT_WORKFLOW_UNCONFIRMED')
    full = contract.profile == 'full'
    _require(path == CI or full, 'EVENT_SCOPE_UNCONFIRMED')
    _require((qualification is not None) == (contract.mode == 'legacy' and full),
             'QUALIFICATION_SCOPE_UNCONFIRMED')
    release_id, release_attempt = _run(release, CI, contract)
    secondary = _run(qualification, LEGACY_QUALIFICATION, contract) if qualification is not None else None
    _require(secondary is None or secondary[0] != release_id, 'RUN_PAIR_UNCONFIRMED')
    event_id, event_attempt = (release_id, release_attempt) if path == CI else secondary
    _require(_matches(event.get('workflow_run'), {**_completion_fields(contract.sha, contract.pins[path].id),
                         'id': event_id, 'run_attempt': event_attempt}), 'EVENT_RUN_UNCONFIRMED')
    identity = Eligibility(contract.sha, release_id, release_attempt, contract.mode)
    if contract.mode == 'legacy':
        jobs = _jobs(release, identity, dict.fromkeys(RELEASE_JOBS, 'success'))
        _step(jobs[GATE], LEGACY_GATE_STEP)
        if qualification is not None:
            _rows(qualification.jobs, 'jobs', len(FULL_JOBS), 'JOBS_UNCONFIRMED')
            qualify_full(qualification.run, qualification.jobs, contract.pins[LEGACY_QUALIFICATION].id, identity.sha)
    else:
        _unified(release, identity, contract)
    _require(try_claim((REPOSITORY_ID, identity.sha)) is True, 'SOURCE_ALREADY_CLAIMED')
    return identity
