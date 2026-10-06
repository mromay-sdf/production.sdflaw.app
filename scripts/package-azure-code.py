from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import shutil

root = Path(__file__).resolve().parent.parent
stage = root / 'tmp' / 'azure-code'
target = root / 'outputs' / 'SDF-Production-Azure-Code.zip'
target.parent.mkdir(exist_ok=True)
stage.mkdir(parents=True, exist_ok=True)
for name in ('package.json', 'package-lock.json'):
    shutil.copyfile(root / 'deployment' / name, stage / name)
for directory in ('dist', 'dist-server', 'public', 'offline'):
    shutil.copytree(root / directory, stage / directory, dirs_exist_ok=True)
shutil.copyfile(root / 'DEPLOY-AZURE-CODE.md', stage / 'DEPLOY-AZURE-CODE.md')
shutil.copyfile(root / 'azure-start.sh', stage / 'azure-start.sh')
paths = [stage / name for name in ('package.json', 'package-lock.json', 'DEPLOY-AZURE-CODE.md', 'azure-start.sh')]
for directory in ('dist', 'dist-server', 'public', 'offline'):
    paths.extend(p for p in (root / directory).rglob('*') if p.is_file())
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(paths):
        relative = path.relative_to(stage if path.is_relative_to(stage) else root)
        assert not any(part in {'data', 'node_modules', '.git'} for part in relative.parts)
        assert not path.name.startswith('.env')
        archive.write(path, relative.as_posix())
with ZipFile(target) as archive:
    assert archive.testzip() is None
    for required in ('package.json', 'package-lock.json', 'dist/index.html', 'dist-server/index.js', 'public/sdf-ui/sdf-logo-report-white.png'):
        assert required in archive.namelist()
    print(f'{len(archive.namelist())} files; {target.stat().st_size:,} bytes')
digest = hashlib.sha256(target.read_bytes()).hexdigest()
target.with_suffix('.zip.sha256').write_text(digest + '  ' + target.name + '\n')
print(target)
print('SHA256:', digest)
