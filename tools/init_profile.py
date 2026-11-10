import io
import json
import os
import glob

profiles = [p for p in glob.glob('/root/.dsh/profiles/*') if os.path.isdir(p)]
if not profiles:
    raise SystemExit('找不到 profile 目录')
profile = sorted(profiles)[0]
path = os.path.join(profile, 'package.json')

with io.open(path, encoding='utf-8') as f:
    pkg = json.load(f)

deps = pkg.setdefault('dependencies', {})
links = {
    'dsh-qq-bridge': '/root/dsh-plugins/dsh-qq-bridge',
    'dsh-persona': '/root/dsh-plugins/dsh-persona',
    'dsh-qbot-launcher': '/root/dsh-plugins/dsh-qbot-launcher',
}
for name, target in links.items():
    deps[name] = 'link:' + target
deps['dsh-mnemon'] = '0.5.39'

bundles = pkg.setdefault('dsh', {}).setdefault('profile', {}).setdefault('bundles', [])
for name in ('dsh-qq-bridge', 'dsh-persona', 'dsh-qbot-launcher', 'dsh-mnemon'):
    if name not in bundles:
        bundles.append(name)

with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)
print('profile updated:', path)

patch = os.path.join(profile, 'cordis.patch.yml')
text = ''
if os.path.isfile(patch):
    with io.open(patch, encoding='utf-8') as f:
        text = f.read()
if 'personaFile' not in text:
    if text and not text.endswith('\n'):
        text += '\n'
    text += (
        "- id: qq-bridge\n"
        "  config:\n"
        "    personaFile: /root/.dsh/qq-bridge/personas.json\n"
        "    stickerDir: /sdcard/Pictures/表情包\n"
        "- id: dsh-persona\n"
        "  config:\n"
        "    personaFile: /root/.dsh/qq-bridge/personas.json\n"
    )
    with io.open(patch, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print('cordis.patch.yml updated:', patch)
