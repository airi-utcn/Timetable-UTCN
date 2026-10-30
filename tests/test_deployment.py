import json
import os
from pathlib import Path
import subprocess

import pytest

from deployment.merged_pr import merged_pr

REPOSITORY = 'airi-utcn/Timetable-UTCN'
COMMIT = 'a' * 40
HEAD = 'b' * 40


class FakeGitHub:
    def __init__(self, reviews=None):
        self.pull = {
            'number': 12, 'merged': True, 'merge_commit_sha': COMMIT,
            'base': {'ref': 'main', 'repo': {'full_name': REPOSITORY}},
            'head': {'sha': HEAD}, 'user': {'login': 'author'},
        }
        self.linked = [{'number': 12}]
        self.reviews = reviews if reviews is not None else [review()]
        self.permission = 'write'

    def get(self, path):
        assert '/collaborators/' not in path
        return self.pull

    def pages(self, path):
        assert not path.endswith('/reviews')
        return iter(self.linked)


def review(state='APPROVED', commit=HEAD, login='reviewer', submitted='2026-10-26T10:00:00Z'):
    return {'user': {'login': login}, 'state': state, 'commit_id': commit, 'submitted_at': submitted}


def test_merged_pr_at_current_commit_can_publish():
    assert merged_pr(FakeGitHub(), REPOSITORY, COMMIT) == 12


def test_direct_push_cannot_publish():
    api = FakeGitHub()
    api.linked = []
    assert merged_pr(api, REPOSITORY, COMMIT) is None


@pytest.mark.parametrize('field,value', [('merged', False), ('merge_commit_sha', 'c' * 40)])
def test_unmerged_or_other_commit_cannot_publish(field, value):
    api = FakeGitHub()
    api.pull[field] = value
    assert merged_pr(api, REPOSITORY, COMMIT) is None


def test_merge_without_reviews_can_publish():
    assert merged_pr(FakeGitHub([]), REPOSITORY, COMMIT) == 12


def test_other_target_branch_cannot_publish():
    api = FakeGitHub([])
    api.pull['base']['ref'] = 'develop'
    assert merged_pr(api, REPOSITORY, COMMIT) is None


def test_other_repository_cannot_publish():
    api = FakeGitHub([])
    api.pull['base']['repo']['full_name'] = 'other/repo'
    assert merged_pr(api, REPOSITORY, COMMIT) is None


@pytest.fixture
def deployment_environment(tmp_path):
    app = tmp_path / 'app'
    app.mkdir()
    for name in ('.env', 'docker-compose.yml', 'docker-compose.vm.yml'):
        (app / name).write_text('test fixture\n')
    binaries = tmp_path / 'bin'
    binaries.mkdir()
    docker = binaries / 'docker'
    docker.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['DOCKER_CALLS'], 'a') as output:
 output.write(json.dumps({'args':args, 'image':os.environ.get('TIMETABLE_IMAGE')})+'\\n')
if args[0]=='info': print(os.environ['APP_DIR'])
elif args[0]=='pull': sys.exit(int(os.environ.get('FAIL_PULL', '0')))
elif args[:2]==['image','inspect']:
 if 'RepoDigests' in args[-1]: print(json.dumps(['ghcr.io/airi-utcn/timetable-utcn@sha256:'+'2'*64]))
 else: print('sha256:'+'2'*64)
elif args[0]=='inspect':
 template=args[-1]
 if '.Image' in template: print('sha256:'+os.environ.get('CURRENT_IMAGE', '1')*64)
 elif 'Health' in template: print('healthy')
 else: print(os.environ.get('CURRENT_PROJECT', 'existing-project'))
elif args[0]=='compose' and 'up' in args:
 if '@sha256:' in os.environ.get('TIMETABLE_IMAGE','') and os.environ.get('FAIL_NEW')=='1': sys.exit(1)
''')
    docker.chmod(0o755)
    flock = binaries / 'flock'
    # Lock serialization itself is provided by util-linux on Ubuntu. This shim
    # lets the Docker-state integration tests also run on macOS developer hosts.
    flock.write_text('#!/bin/sh\nexit 0\n')
    flock.chmod(0o755)
    env = {**os.environ, 'APP_DIR': str(app), 'COMPOSE_PROJECT_NAME': 'existing-project',
           'STATE_DIR': str(tmp_path / 'state'), 'DOCKER_CALLS': str(tmp_path / 'docker.jsonl'),
           'PATH': str(binaries) + os.pathsep + os.environ['PATH'], 'MIN_FREE_MB': '0'}
    return env


def run_deployment(env):
    script = Path(__file__).resolve().parents[1] / 'deployment/pull-deploy.sh'
    result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True)
    calls = [json.loads(line) for line in Path(env['DOCKER_CALLS']).read_text().splitlines()]
    return result, calls


def test_changed_image_backs_up_and_deploys_by_digest(deployment_environment):
    env = deployment_environment
    result, calls = run_deployment(env)
    assert result.returncode == 0, result.stderr
    backup_index = next(i for i, call in enumerate(calls) if call['args'][0] == 'exec')
    update_index = next(i for i, call in enumerate(calls) if 'up' in call['args'])
    assert backup_index < update_index
    update = calls[update_index]
    assert '@sha256:' in update['image']
    assert '--no-build' in update['args'] and '--wait' in update['args']
    assert (Path(env['STATE_DIR']) / 'current-image').read_text().strip() == update['image']


def test_unchanged_healthy_image_is_not_restarted(deployment_environment):
    env = {**deployment_environment, 'CURRENT_IMAGE': '2'}
    result, calls = run_deployment(env)
    assert result.returncode == 0
    assert not any('up' in call['args'] for call in calls)


def test_registry_failure_leaves_existing_service_running(deployment_environment):
    result, calls = run_deployment({**deployment_environment, 'FAIL_PULL': '1'})
    assert result.returncode != 0
    assert not any('up' in call['args'] or 'down' in call['args'] for call in calls)


def test_failed_health_rolls_back_and_defers_repeated_failures(deployment_environment):
    env = {**deployment_environment, 'FAIL_NEW': '1'}
    result, calls = run_deployment(env)
    assert result.returncode != 0
    updates = [call for call in calls if 'up' in call['args']]
    assert len(updates) == 2
    assert updates[1]['image'] == 'utcn-timetable-rollback:previous'
    assert (Path(env['STATE_DIR']) / 'failed-image').exists()
    Path(env['DOCKER_CALLS']).write_text('')
    retry, calls = run_deployment(env)
    assert retry.returncode == 0
    assert not any('up' in call['args'] for call in calls)


def test_project_mismatch_cannot_replace_volumes(deployment_environment):
    result, calls = run_deployment({**deployment_environment, 'CURRENT_PROJECT': 'different-project'})
    assert result.returncode != 0
    assert 'project mismatch' in result.stderr
    assert not any('up' in call['args'] for call in calls)
