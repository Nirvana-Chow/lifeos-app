"""Finite, pure adapter for the existing private CD worker. No host writes.

Install only with the reviewed worker/config pins. The host reclassifies verified
source manifests itself; a green/skipped GitHub aggregate is never evidence.
"""
import re

REPOSITORY = 'Nirvana-Chow/lifeos-app'
REPOSITORY_ID = 1443243170
RELEASE_JOBS = {'Unit, types and source contracts', 'Release eligibility'}
FULL_JOBS = {'Qualification policy', 'Tests, types, webpack, isolated Auth and PostgreSQL', 'Isolated PostgreSQL recovery and native MFA'}


def classify(policy, baseline, previous, current, ancestor=False, previous_failed=True):
    if (not isinstance(baseline, dict) or baseline.get('schemaVersion') != 1
            or baseline.get('repository') != REPOSITORY or baseline.get('repositoryId') != REPOSITORY_ID
            or baseline.get('conclusion') != 'success' or not ancestor or previous_failed):
        return 'full'
    if any(not re.fullmatch('[a-f0-9]{40}', baseline.get(k, '')) for k in ('sourceSha', 'treeSha')):
        return 'full'
    if any(not re.fullmatch('[1-9][0-9]*', baseline.get(k, '')) for k in ('runId', 'runAttempt')):
        return 'full'
    if not re.fullmatch('[a-f0-9]{64}', baseline.get('workflowSha256', '')):
        return 'full'
    if not isinstance(policy, dict) or policy.get('schemaVersion') != 1:
        return 'full'
    old = {r['path']: r for r in previous}
    new = {r['path']: r for r in current}
    if len(old) != len(previous) or len(new) != len(current):
        return 'full'
    changed = [p for p in old.keys() | new.keys()
               if old.get(p, {}).get('gitBlobSha') != new.get(p, {}).get('gitBlobSha')
               or old.get(p, {}).get('mode') != new.get(p, {}).get('mode')]
    if not changed:
        return 'full'
    for path in changed:
        if (path not in old or path not in new or old[path].get('mode') != new[path].get('mode')
                or path.startswith('/') or any(p in ('', '.', '..') for p in path.split('/'))
                or re.search(r'[\\\x00-\x1f\x7f]', path)):
            return 'full'
        if (path not in policy['routinePaths']
                and not any(path.startswith(p) and path.endswith('.md') for p in policy['routinePrefixes'])):
            return 'full'
    return 'routine'


def previous_failed(rows, selected):
    if selected.get('run_attempt') != 1:
        return True
    previous = [r for r in rows if type(r.get('id')) is int and r['id'] < selected['id']]
    if not previous:
        return True
    prior = max(previous, key=lambda r: r['id'])
    return prior.get('status') != 'completed' or prior.get('conclusion') != 'success'


def qualify_full(run, jobs, workflow_id, sha):
    """Reject skipped jobs even when the workflow aggregate says success."""
    def require(ok):
        if not ok:
            raise ValueError('FULL_QUALIFICATION_UNCONFIRMED')
    require(type(workflow_id) is int and workflow_id > 0)
    require(type(run.get('id')) is int and run['id'] > 0
            and type(run.get('run_attempt')) is int and run['run_attempt'] > 0)
    expected = {'head_sha': sha, 'head_branch': 'main', 'event': 'push', 'status': 'completed',
                'conclusion': 'success', 'workflow_id': workflow_id, 'path': '.github/workflows/qualification.yml'}
    require(all(run.get(k) == v for k, v in expected.items()))
    for k in ('repository', 'head_repository'):
        require(run.get(k, {}).get('id') == REPOSITORY_ID and run[k].get('full_name') == REPOSITORY)
    url = f"https://github.com/{REPOSITORY}/actions/runs/{run['id']}"
    require(run.get('html_url') == url)
    rows = jobs.get('jobs')
    require(jobs.get('total_count') == 3 and type(rows) is list and len(rows) == 3)
    require({j.get('name') for j in rows} == FULL_JOBS and len({j.get('id') for j in rows}) == 3)
    for j in rows:
        require(type(j.get('id')) is int and j['id'] > 0)
        require(all(j.get(k) == v for k, v in {'head_sha': sha, 'run_id': run['id'],
                    'run_attempt': run['run_attempt'], 'status': 'completed', 'conclusion': 'success',
                    'html_url': url + '/job/' + str(j['id'])}.items()))
    return True
