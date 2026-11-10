"""Compare public images on a disposable GitHub-hosted Linux runner only."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


BASE = 'bc9965965661a5588b749b2b5a88e54841cfd5d5'
SOURCE = '12946ffd4378514ce27ed81ae30875e676d54d3e'
DOCKERFILE = 'Dockerfile.platform-review'
BENCHMARK_REF = 'refs/heads/owner/experiment-image-benchmark-43'


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def available(path):
    state = os.statvfs(path)
    return [state.f_bavail * state.f_frsize, state.f_favail]


def measure(paths, *args):
    before = {name: available(path) for name, path in paths.items()}
    low = {name: values[:] for name, values in before.items()}
    start = time.monotonic()
    with subprocess.Popen(args) as process:
        while True:
            for name, path in paths.items():
                low[name] = list(map(min, zip(low[name], available(path))))
            try:
                status = process.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                continue
            if status:
                raise subprocess.CalledProcessError(status, args)
            break
    after = {name: available(path) for name, path in paths.items()}
    return {'seconds': round(time.monotonic() - start, 3), 'before': before,
            'low': {name: list(map(min, zip(low[name], after[name]))) for name in paths},
            'after': after}


def export_source(source, destination):
    destination.mkdir()
    with subprocess.Popen(['git', 'archive', source], stdout=subprocess.PIPE) as git:
        with git.stdout:
            subprocess.run(['tar', '-xf', '-', '-C', str(destination)], stdin=git.stdout, check=True)
        if git.wait():
            raise RuntimeError('Fixed source export failed')


def main():
    context_guard = {'GITHUB_ACTIONS': 'true', 'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64',
                     'RUNNER_ENVIRONMENT': 'github-hosted',
                     'GITHUB_REPOSITORY': 'Nirvana-Chow/lifeos-app',
                     'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': BENCHMARK_REF}
    if any(os.environ.get(key) != value for key, value in context_guard.items()):
        raise SystemExit('Disposable benchmark runner required')
    run = os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT']
    if not re.fullmatch(r'[1-9][0-9]{0,19}-[1-9][0-9]{0,9}', run):
        raise SystemExit('Wrong benchmark run identity')
    if os.environ.get('DOCKER_HOST') or os.environ.get('DOCKER_CONTEXT') or output('docker', 'context', 'show') != 'default':
        raise SystemExit('Default runner Docker daemon required')
    if output('docker', 'context', 'inspect', 'default', '--format', '{{.Endpoints.docker.Host}}') != 'unix:///var/run/docker.sock':
        raise SystemExit('Local runner Docker socket required')
    if output('git', 'diff', '--name-only', BASE, SOURCE) != DOCKERFILE:
        raise SystemExit('Application sources differ')

    with tempfile.TemporaryDirectory(prefix='lifeos-image-bench-', dir=os.environ['RUNNER_TEMP']) as tmp:
        root = Path(tmp)
        docker_root = Path(output('docker', 'info', '--format', '{{.DockerRootDir}}'))
        paths = {'docker': docker_root, 'workspace': root}
        result = {'dockerVersion': output('docker', 'version', '--format', '{{.Server.Version}}'),
                  'builderScope': 'shared-ephemeral-daemon-no-cache-and-warm-samples',
                  'sameFilesystem': docker_root.stat().st_dev == root.stat().st_dev}
        for name, source in [('baseline', BASE), ('comparison', SOURCE)]:
            context = root / name
            export_source(source, context)
            recipe = context / DOCKERFILE
            recipe_sha = hashlib.sha256(recipe.read_bytes()).hexdigest()
            if name == 'baseline' and recipe_sha != '00b89e6578e848ceb8982b38a0c653f7d2dc1022c0059998eff1d96069341061':
                raise RuntimeError('Canonical recipe changed')
            tag = 'lifeos-capacity-benchmark:' + name + '-' + run
            if output('docker', 'image', 'ls', '--quiet', '--filter', 'reference=' + tag):
                raise RuntimeError('Unexpected existing benchmark tag')
            build = ['docker', 'build', '--platform', 'linux/amd64', '--progress', 'plain',
                     '--file', str(recipe), '--build-arg', 'SOURCE_COMMIT=' + source, '--tag', tag]
            cold = measure(paths, *build, '--no-cache', str(context))
            warm = measure(paths, *build, str(context))
            identity, size, revision = output('docker', 'image', 'inspect', '--format',
                '{{.Id}} {{.Size}} {{index .Config.Labels "org.opencontainers.image.revision"}}', tag).split()
            if revision != source or not re.fullmatch(r'sha256:[a-f0-9]{64}', identity):
                raise RuntimeError('Wrong image revision')
            packed = root / (name + '.tar.gz')
            export = measure(paths, 'bash', '-o', 'pipefail', '-o', 'noclobber', '-c',
                             'docker image save "$1" | gzip -n -6 -c > "$2"', 'stream', identity, str(packed))
            subprocess.run(['docker', 'image', 'rm', tag], check=True)
            if identity in output('docker', 'image', 'ls', '--no-trunc', '--quiet').splitlines():
                raise RuntimeError('Image still present before load')
            load = measure(paths, 'docker', 'load', '--input', str(packed))
            if output('docker', 'image', 'inspect', '--format', '{{.Id}}', identity) != identity:
                raise RuntimeError('Loaded a different image')
            script = ("const p=require('/app/.image-source-proof.json');"
                      "console.log(JSON.stringify([p.sourceSha,p.files.find("
                      "x=>x.path==='Dockerfile.platform-review').sha256]))")
            proof = output('docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
                           '--read-only', '--cap-drop', 'ALL', '--entrypoint', 'node', identity, '-e', script)
            if json.loads(proof) != [source, recipe_sha]:
                raise RuntimeError('Wrong loaded source proof')
            result[name] = {'sourceSha': source, 'recipeSha256': recipe_sha, 'imageId': identity,
                            'imageBytes': int(size), 'archiveBytes': packed.stat().st_size, 'export': export,
                            'load': load, 'noCacheBuild': cold, 'warmBuild': warm}
            packed.unlink()
        print('LIFEOS_IMAGE_CAPACITY ' + json.dumps(result, sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
