"""当 git push 不通时，用 GitHub API 重建整个仓库内容。

流程：逐个文件建 blob -> 建 tree -> 建 commit（无 parent，历史清零）-> 强更 master -> 重建 tag
"""
import base64
import json
import os
import subprocess
import sys
import tempfile

ROOT = r'D:\WDY\截图待办'
REPO = 'repos/rainlv00/screenshot-todo'
MSG = '截图待办 v1.0\n\n微信截图自动进待办的 Windows 桌面工具，纯本地运行。'
TAG = 'V1.0'
TAG_MSG = '截图待办 1.0 正式版'

os.chdir(ROOT)


def gh(args, payload=None):
    cmd = ['gh', 'api'] + args
    tmp = None
    if payload is not None:
        fd, tmp = tempfile.mkstemp(suffix='.json')
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False)
        cmd += ['--input', tmp]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip()[:300])
        return r.stdout.strip()
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)


# 用 -z 避免 git 把中文路径转义成 "\344\275\277..." 形式
raw = subprocess.run(['git', 'ls-files', '-z'], capture_output=True).stdout.decode('utf-8')
files = [f for f in raw.split('\0') if f.strip()]
print(f'共 {len(files)} 个文件')

tree = []
for i, rel in enumerate(files, 1):
    abspath = os.path.join(ROOT, rel)
    with open(abspath, 'rb') as f:
        data = f.read()
    payload = {'content': base64.b64encode(data).decode('ascii'), 'encoding': 'base64'}
    sha = json.loads(gh(['-X', 'POST', f'{REPO}/git/blobs'], payload))['sha']
    tree.append({'path': rel.replace('\\', '/'), 'mode': '100644', 'type': 'blob', 'sha': sha})
    if i % 10 == 0 or i == len(files):
        print(f'  上传 {i}/{len(files)}', flush=True)

print('建 tree...')
tree_sha = json.loads(gh(['-X', 'POST', f'{REPO}/git/trees'], {'tree': tree}))['sha']

print('建 commit（无 parent，历史清零）...')
commit_sha = json.loads(gh(['-X', 'POST', f'{REPO}/git/commits'], {
    'message': MSG, 'tree': tree_sha, 'parents': []
}))['sha']

# 分支名可能是 main 也可能是 master，按仓库实际默认分支来
branch = json.loads(gh([REPO]))['default_branch']
print(f'强更 {branch}...')
try:
    gh(['-X', 'PATCH', f'{REPO}/git/refs/heads/{branch}'], {'sha': commit_sha, 'force': True})
except Exception:
    gh(['-X', 'POST', f'{REPO}/git/refs'], {'ref': f'refs/heads/{branch}', 'sha': commit_sha})

print('重建 tag...')
try:
    gh(['-X', 'DELETE', f'{REPO}/git/refs/tags/{TAG}'])
except Exception:
    pass
tag_obj = json.loads(gh(['-X', 'POST', f'{REPO}/git/tags'], {
    'tag': TAG, 'message': TAG_MSG, 'object': commit_sha, 'type': 'commit'
}))['sha']
gh(['-X', 'POST', f'{REPO}/git/refs'], {'ref': f'refs/tags/{TAG}', 'sha': tag_obj})

print(f'完成 commit={commit_sha[:7]} tree={tree_sha[:7]}')
