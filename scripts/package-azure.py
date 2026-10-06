from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib

root = Path(__file__).resolve().parent.parent
target = root / 'outputs' / 'SDF-Production-Azure-Test.zip'
target.parent.mkdir(exist_ok=True)
files = ['Dockerfile', '.dockerignore', 'DEPLOY-AZURE-TEST.md', 'README.md', 'SECURITY.md',
         'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'index.html',
         'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'sdf-ui.lock.json']
directories = ['src', 'server', 'shared', 'public', 'offline', 'scripts', 'tests', 'docs', 'dist', 'dist-server', 'vendor/sdf-ui', 'deployment']
paths = [root / name for name in files]
for directory in directories:
    paths.extend(p for p in (root / directory).rglob('*') if p.is_file())
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(paths):
        relative = path.relative_to(root)
        assert not any(part in {'data', 'node_modules', 'tmp', '.git'} for part in relative.parts)
        assert not path.name.startswith('.env')
        archive.write(path, relative.as_posix())
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert 'Dockerfile' in archive.namelist()
    assert 'server/runtime.ts' in archive.namelist()
    assert 'public/sdf-ui/sdf-logo-report-white.png' in archive.namelist()
    print(f'{len(archive.namelist())} files; {target.stat().st_size:,} bytes')
digest = hashlib.sha256(target.read_bytes()).hexdigest()
target.with_suffix('.zip.sha256').write_text(digest + '  ' + target.name + '\n')
print(target)
print('SHA256:', digest)
