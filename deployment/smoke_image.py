"""Check the built image without accessing production or calendar providers."""
import json
import secrets
import subprocess
import sys
import time
import uuid


def main(image):
    name = 'timetable-ci-' + uuid.uuid4().hex[:12]
    try:
        subprocess.run([
            'docker', 'run', '--detach', '--name', name, '--network', 'none',
            '-e', 'FLASK_SECRET=' + secrets.token_hex(32),
            '-e', 'ADMIN_PASSWORD=' + secrets.token_hex(24),
            '-e', 'DISABLE_BACKGROUND_TASKS=1', '-e', 'GUNICORN_WORKERS=2',
            image,
        ], check=True, stdout=subprocess.DEVNULL)
        for _ in range(60):
            result = subprocess.run([
                'docker', 'exec', '--user', 'appuser', name, 'python', '-c',
                "import urllib.request; assert urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=2).status == 200",
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                break
            time.sleep(2)
        else:
            subprocess.run(['docker', 'logs', '--tail', '60', name], check=False)
            raise RuntimeError('Image failed its startup/health check')
        check = '''import pathlib
assert not pathlib.Path('/app/.env').exists()
workers = []
for command in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
    try:
        content = command.read_bytes()
        if content.startswith(b'/usr/local/bin/python') and b'gunicorn' in content:
            status = (command.parent / 'status').read_text()
            uid = next(line for line in status.splitlines() if line.startswith('Uid:')).split()[1]
            workers.append(int(uid))
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        pass
assert workers and all(uid != 0 for uid in workers), workers
'''
        subprocess.run(['docker', 'exec', name, 'python', '-c', check], check=True)
        print(json.dumps({'health': 'passed', 'non_root': 'passed', 'local_env_excluded': True}))
    finally:
        subprocess.run(['docker', 'rm', '--force', name], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main(sys.argv[1])
