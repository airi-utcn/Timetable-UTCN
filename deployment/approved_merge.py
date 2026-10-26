"""Allow production publication only for an approved PR merged at this commit."""
import json
import os
import re
from urllib.parse import quote
from urllib.request import Request, urlopen


class GitHubAPI:
    def __init__(self):
        self.base = os.environ.get('GITHUB_API_URL', 'https://api.github.com')
        self.token = os.environ['GH_TOKEN']

    def get(self, path):
        request = Request(self.base + path, headers={
            'Authorization': 'Bearer ' + self.token,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        })
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    def pages(self, path):
        for page in range(1, 101):
            items = self.get(f'{path}?per_page=100&page={page}')
            if not isinstance(items, list):
                raise ValueError('Unexpected GitHub API response')
            yield from items
            if len(items) < 100:
                return
        raise ValueError('GitHub pagination limit exceeded')


def approved_merge(api, repository, commit):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid repository')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Invalid commit')
    prefix = f'/repos/{repository}'
    for linked in api.pages(f'{prefix}/commits/{commit}/pulls'):
        pull = api.get(f'{prefix}/pulls/{int(linked["number"])}')
        if not (pull.get('merged') and pull.get('merge_commit_sha') == commit
                and pull.get('base', {}).get('ref') == 'main'
                and pull.get('base', {}).get('repo', {}).get('full_name', '').lower() == repository.lower()):
            continue
        # Neutral comments do not dismiss an existing approval; formal review
        # decisions do. Approvals must cover the final PR head before merging.
        decisions = {}
        reviews = sorted(api.pages(f'{prefix}/pulls/{pull["number"]}/reviews'),
                         key=lambda item: item.get('submitted_at') or '')
        for review in reviews:
            login = review.get('user', {}).get('login')
            if login and review.get('state') in {'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'}:
                decisions[login] = review
        approvals = []
        blocked = False
        for login, review in decisions.items():
            if login == pull.get('user', {}).get('login'):
                continue
            permission = api.get(f'{prefix}/collaborators/{quote(login, safe="")}/permission')
            if permission.get('permission') not in {'write', 'maintain', 'admin'}:
                continue
            if review['state'] == 'CHANGES_REQUESTED':
                blocked = True
            if review['state'] == 'APPROVED' and review.get('commit_id') == pull['head']['sha']:
                approvals.append(login)
        if approvals and not blocked:
            return pull['number']
    return None


def main():
    number = approved_merge(GitHubAPI(), os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_SHA'])
    eligible = number is not None
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        output.write(f'approved={str(eligible).lower()}\n')
    print(f'Production publication allowed for merged PR #{number}.' if eligible else
          'No eligible approved merge at this commit; production publication skipped.')


if __name__ == '__main__':
    main()
