#!/usr/bin/env python3
"""Derive public homepage assets from the supplied design, without touching originals.

Development-only: /usr/bin/python3 with Pillow, fontTools and Brotli. The static
site serves the checked derivatives and does not run Python or load source TTFs.
"""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'FrontEnd_Resource'
TARGET = ROOT / 'src/assets/home'
FONTS = ROOT / 'src/assets/fonts'


def digest(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    FONTS.mkdir(parents=True, exist_ok=True)
    license_text = (ROOT / 'docs/licenses/invitation-fonts-OFL.txt').read_text()
    license_text = license_text.replace('NotoSansSC-Regular.ttf / NotoSansSC-Medium.ttf',
                                        'NotoSansSC-Regular.ttf / NotoSansSC-Bold.ttf')
    license_text = license_text.replace('ARTDiCO Invitation SC', 'ARTDiCO Home SC')
    if 'SIL OPEN FONT LICENSE Version 1.1' not in license_text:
        raise ValueError('A complete font redistribution license is required')
    (FONTS / 'home-font-OFL.txt').write_text(license_text)

    planet_source = SOURCE / '组件/紫色星球组件.png'
    with Image.open(planet_source) as planet:
        planet.thumbnail((960, 960))
        planet.save(TARGET / 'planet-purple.webp', 'WEBP', quality=82, method=6)
    with Image.open(SOURCE / '组件/HOST文字组件.png') as host:
        host.thumbnail((640, 1144))
        host.save(TARGET / 'host-wordmark.webp', 'WEBP', quality=78, method=6)

    # Use the two current homepage weights only. A new family name preserves the
    # reserved-name condition; the full license is embedded in each output font.
    paths = list((ROOT / 'src/components').glob('*.astro'))
    paths += list((ROOT / 'src/scripts').glob('*.mjs'))
    paths += [ROOT / 'src/config/event.mjs', ROOT / 'docs/redesign/README.md']
    paths += list((ROOT / 'shared').glob('*faq*.mjs'))
    paths += list((ROOT / 'src/lib').glob('*faq*.mjs'))
    text = ''.join(path.read_text() for path in paths)
    points = set(range(0x20, 0x180)) | set(map(ord, text))
    font_records = []
    for weight, style, filename in [(400, 'Regular', 'NotoSansSC-Regular.ttf'),
                                    (700, 'Bold', 'NotoSansSC-Bold.ttf')]:
        source = SOURCE / '字体' / filename
        font = TTFont(source, recalcTimestamp=False)
        options = subset.Options()
        options.name_IDs = ['*']
        options.name_legacy = True
        options.name_languages = ['*']
        options.layout_features = ['*']
        worker = subset.Subsetter(options=options)
        worker.populate(unicodes=points.intersection(font.getBestCmap()))
        worker.subset(font)
        family = 'ARTDiCO Home SC'
        names = {1: family, 2: style, 3: 'ARTDiCOHomeSC-' + style,
                 4: family + ' ' + style, 6: 'ARTDiCOHomeSC-' + style,
                 16: family, 17: style}
        for record in font['name'].names:
            if record.nameID in names:
                record.string = names[record.nameID].encode(record.getEncoding())
            elif record.nameID == 13:
                record.string = license_text.encode(record.getEncoding())
        font.flavor = 'woff2'
        output = FONTS / ('home-' + style.lower() + '.woff2')
        font.save(output)
        if output.stat().st_size > 300_000:
            raise ValueError('A homepage font exceeds its 300 KB design budget')
        font_records.append({'path': str(output.relative_to(ROOT)), 'weight': weight,
                             'codePoints': len(font.getBestCmap()), 'source': digest(source),
                             **digest(output)})

    # A separate social preview is derived from the same organizer-supplied art.
    # It contains event facts only, without guest faces, sponsor marks or counts.
    share = Image.new('RGB', (1200, 630), '#000000')
    with Image.open(planet_source).convert('RGBA') as planet:
        planet = planet.resize((750, 750), Image.Resampling.LANCZOS)
        share.paste(planet, (275, -75), planet)
    draw = ImageDraw.Draw(share)
    source_font = SOURCE / '字体/NotoSansSC-Bold.ttf'
    def write(position, value, size, fill):
        draw.text(position, value, font=ImageFont.truetype(str(source_font), size), fill=fill)
    write((60, 24), 'ARTDiCO HOST / 2026', 18, '#b5a4d7')
    write((58, 83), 'GLOBAL GAME JAM', 70, '#9e78ff')
    write((62, 175), '中国交流聚会', 34, '#b299ef')
    write((360, 285), 'ARTDiCO HOST', 76, '#9e78ff')
    write((770, 382), '学生嘉年华', 32, '#b299ef')
    draw.line((60, 495, 1140, 495), fill='#443454', width=1)
    write((60, 526), '2026.12.05   10:00–18:00', 28, '#f7f4fc')
    write((755, 533), '深圳 · 前海5号楼 3F', 25, '#f7f4fc')
    write((60, 580), '组织者交流 / 学生作品 / 游戏体验', 18, '#b9b0c9')
    share.save(TARGET / 'event-share.png', optimize=True)
    manifest = {
        'schemaVersion': 1, 'family': 'ARTDiCO Home SC', 'license': 'SIL Open Font License 1.1',
        'fonts': font_records,
        'images': [{'path': str(path.relative_to(ROOT)), **digest(path)}
                   for path in sorted(TARGET.iterdir()) if path.suffix in ['.webp', '.png']],
    }
    (ROOT / 'docs/home-asset-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
