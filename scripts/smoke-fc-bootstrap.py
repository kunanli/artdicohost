"""Run the actual compact ZIP in the offline Debian 11 / Python path fixture."""
import hashlib
import json
from pathlib import Path
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

release = json.loads(Path('/code/release.json').read_text())
child = subprocess.Popen(['/code/bootstrap'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
started = time.monotonic()


def request(path, method='GET'):
    data = b'SYNTHETIC-NOT-PERSISTED' if method == 'POST' else None
    try:
        response = urlopen(Request('http://127.0.0.1:9000' + path, data=data, method=method), timeout=1)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, json.loads(response.read(16 * 1024))


try:
    deadline = started + 45
    while True:
        if child.poll() is not None:
            raise RuntimeError('Compact bootstrap exited before readiness')
        try:
            status, headers, body = request('/healthz')
            if status != 200 or body != {'status': 'ok', 'scope': 'process-only', 'sourceCommit': release['sourceCommit']}:
                raise RuntimeError('Unexpected bootstrap health')
            break
        except OSError:
            if time.monotonic() >= deadline:
                raise RuntimeError('Compact bootstrap did not become ready') from None
            time.sleep(0.1)
    executable = Path('/proc') / str(child.pid) / 'exe'
    digest = hashlib.sha256()
    with executable.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    assert digest.hexdigest() == release['node']['sha256']
    version = subprocess.check_output([str(executable), '--version'], timeout=5, stderr=subprocess.DEVNULL).decode().strip()
    assert version == 'v24.19.0'
    for path, method in [('/api/health', 'GET'), ('/api/registrations', 'POST'), ('/api/admin', 'POST')]:
        status, headers, body = request(path, method)
        assert status == 503 and headers.get('cache-control') == 'no-store'
        assert body == {'status': 'not_ready', 'registration': 'closed', 'storage': 'not_verified'}
    print(json.dumps({'debian': '11', 'python': '3.12.4', 'node': version, 'sourceCommit': release['sourceCommit'], 'bootstrap': 'passed', 'bootstrapSeconds': round(time.monotonic() - started, 3), 'liveness': 'process-only', 'business': 'closed', 'network': 'none', 'code': 'read-only', 'runtime': 'verified-ephemeral-tmp'}))
finally:
    child.terminate()
    try:
        child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=3)
