"""Exercise the actual candidate ZIP offline; never test a real account or OSS."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

release = json.loads(Path('/code/release.json').read_text())
assert release['kind'] == 'fc-cloud-content-candidate'
assert release['schemaVersion'] == 1
expected_health = {
    'status': 'ok',
    'scope': 'process-only',
    'sourceCommit': release['sourceCommit'],
}
assets = {asset['url']: asset for asset in release['assets']}


def request(path, method='GET', host='api.artdico.host', origin=None):
    data = b'{}' if method == 'POST' else None
    headers = {'Host': host}
    if origin is not None:
        headers['Origin'] = origin
    if data is not None:
        headers.update({'Origin': 'https://api.artdico.host',
                        'Content-Type': 'application/json'})
    try:
        response = urlopen(Request('http://127.0.0.1:9000' + path,
                                   data=data, headers=headers, method=method),
                           timeout=2)
    except HTTPError as error:
        response = error
    with response:
        body = response.read(2 * 1024 * 1024 + 1)
        assert len(body) <= 2 * 1024 * 1024
        return response.status, response.headers, body


def launch(configured):
    # Only these synthetic settings enter the isolated, network-less child.
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8',
           'NODE_ENV': 'production', 'ARTDICO_CLOUD_CONTENT_ENABLED': 'false'}
    if configured:
        env.update({
            'ARTDICO_CLOUD_CONTENT_ENABLED': 'true',
            'ARTDICO_CONTENT_API_ORIGIN': 'https://api.artdico.host',
            'ARTDICO_PUBLIC_SITE_ORIGIN': 'https://artdico.host',
            'ARTDICO_CONTENT_BUCKET': 'artdicohost-data-hk',
            'ARTDICO_CONTENT_REGION': 'cn-hongkong',
            'ALIBABA_CLOUD_ACCESS_KEY_ID': 'synthetic-offline-only',
            'ALIBABA_CLOUD_ACCESS_KEY_SECRET': 'synthetic-offline-only',
            'ALIBABA_CLOUD_SECURITY_TOKEN': 'synthetic-offline-only',
            'ADMIN_USERS_JSON': json.dumps([{
                'id': 'synthetic-candidate-only',
                'username': 'synthetic-candidate-only',
                'label': 'Synthetic offline fixture',
                'roles': ['editor', 'publisher', 'outreach'],
                # Valid syntax only; this is not a usable staff account.
                'passwordHash': 'scrypt$16384$8$1$' + 'A' * 22 + '$' + 'A' * 86,
            }]),
        })
    return subprocess.Popen(['/code/bootstrap'], env=env,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)


def health(child):
    deadline = time.monotonic() + 45
    while True:
        if child.poll() is not None:
            raise RuntimeError('Candidate exited before process health')
        try:
            status, headers, body = request('/healthz')
            assert status == 200 and json.loads(body) == expected_health
            break
        except OSError:
            if time.monotonic() >= deadline:
                raise RuntimeError('Candidate process health timed out') from None
            time.sleep(0.1)
    executable = Path('/proc') / str(child.pid) / 'exe'
    digest = hashlib.sha256()
    with executable.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    assert digest.hexdigest() == release['node']['sha256']
    version = subprocess.check_output([str(executable), '--version'], timeout=5,
                                      stderr=subprocess.DEVNULL).decode().strip()
    assert version == 'v24.19.0'


def stop(child):
    child.terminate()
    try:
        child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=3)
    # The Node runtime lives in /tmp after exec. Remove only this smoke child
    # directory between launches so the bounded tmpfs can hold the next runtime.
    for path in Path('/tmp').glob('artdicohost-node-*'):
        if path.is_dir() and not path.is_symlink():
            import shutil
            shutil.rmtree(path)


started = time.monotonic()
for configured in [False, True]:
    child = launch(configured)
    try:
        health(child)
        if not configured:
            for path, method in [('/admin/', 'GET'),
                                 ('/admin/contacts/', 'GET'),
                                 ('/admin/registrations/', 'GET'),
                                 ('/admin/tasks/', 'GET'),
                                 ('/api/admin/login', 'POST'),
                                 ('/api/registrations', 'POST')]:
                status, headers, body = request(path, method)
                assert status == 503 and headers.get('cache-control') == 'no-store'
                assert json.loads(body)['error']['code'] == 'CONTENT_NOT_READY'
        else:
            for path in ['/admin/', '/admin/contacts/', '/admin/registrations/', '/admin/tasks/']:
                status, headers, body = request(path)
                assert status == 200 and 'text/html' in headers['content-type']
                assert headers.get('cache-control') == 'no-store'
                assert "frame-ancestors 'none'" in headers['content-security-policy']
                assert hashlib.sha256(body).hexdigest() == assets[path]['sha256']
                assert b'synthetic-offline-only' not in body
                assert b'scrypt$' not in body
            for path, record in assets.items():
                status, headers, body = request(path)
                assert status == 200
                assert len(body) == record['bytes']
                assert hashlib.sha256(body).hexdigest() == record['sha256']
            status, headers, body = request('/api/admin/environment')
            assert status == 200
            assert json.loads(body) == {
                'mode': 'cloud', 'scope': 'content-and-outreach',
                'registration': 'closed',
            }
            status, headers, body = request('/api/admin/contacts')
            assert status == 401 and headers.get('cache-control') == 'no-store'
            status, headers, body = request('/api/registrations', 'POST')
            assert status == 503
            assert json.loads(body)['error']['code'] == 'UNAVAILABLE'
            for path in ['/api/admin/registration/config', '/api/registration/config']:
                status, headers, body = request(path, origin='https://artdico.host')
                assert status == 200 and headers.get('cache-control') == 'no-store'
                assert headers.get('access-control-allow-origin') == 'https://artdico.host'
                assert json.loads(body) == {'enabled': False, 'reason': 'unavailable'}
            for path in ['/release.json', '/.env',
                         '/functions/cloud-content/server.mjs']:
                assert request(path)[0] == 404
            assert request('/admin/', host='example.invalid')[0] == 421
    finally:
        stop(child)

print(json.dumps({
    'kind': release['kind'], 'sourceCommit': release['sourceCommit'],
    'bootstrap': 'passed', 'closedMode': 'passed',
    'syntheticConfigurationOnly': 'passed', 'staticAssets': len(assets),
    'seconds': round(time.monotonic() - started, 3),
    'network': 'none', 'code': 'read-only', 'realAccounts': 'not-used',
    'privateOssReadWrite': 'not-tested', 'deployed': False,
}))
