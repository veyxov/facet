"""Experimental nondestructive desktop edit return. Originals remain canonical."""
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import uuid

from PIL import Image
from fastapi import HTTPException

from api.database import get_db

MAX_RENDER_BYTES = 64 * 1024 * 1024
MAX_SOURCE_BYTES = 512 * 1024 * 1024
_RENDER_LOCK = threading.Lock()


def source_stamp(path):
    s = os.stat(path)
    raw = json.dumps([os.path.realpath(path), s.st_dev, s.st_ino, s.st_size,
                      s.st_mtime_ns, s.st_ctime_ns])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def sidecar_digest(disk):
    """Content hash, not mtime: darktable rewrites an unchanged sidecar on every autosave."""
    try:
        with open(str(disk) + '.xmp', 'rb') as f:
            data = f.read(8 * 1024 * 1024 + 1)
    except OSError:
        return None
    return hashlib.sha256(data).hexdigest() if len(data) <= 8 * 1024 * 1024 else None


def read_edit(conn, path, column='revision'):
    # Read-only delivery also works against databases not upgraded by this branch.
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='photo_darktable_edits' AND type='table'").fetchone():
        return None
    if column not in {'revision', 'jpeg', 'jxl', 'preview', 'thumbnail'}:
        raise ValueError('Unsupported rendition column')
    row = conn.execute(f'SELECT {column}, source FROM photo_darktable_edits WHERE photo_path=?', (path,)).fetchone()
    if not row:
        return None
    from api.path_validation import resolve_photo_disk_path
    try:
        if source_stamp(resolve_photo_disk_path(path)) != row[1]:
            return None
    except (OSError, HTTPException):
        return None
    return row[0]


def rendition(path, size=None, jxl=False):
    with get_db() as conn:
        data = read_edit(conn, path, ('thumbnail' if size <= 640 else 'preview') if size else 'jxl' if jxl else 'jpeg')
    if data and size:
        with Image.open(BytesIO(data)) as image:
            if max(image.size) > size:
                image.thumbnail((size, size), Image.Resampling.LANCZOS)
                out = BytesIO()
                image.save(out, 'JPEG', quality=90)
                return out.getvalue()
    return data


def display_jpeg(master):
    """Browsers cannot all show JPEG XL, so the gallery is served a JPEG made from the master."""
    if master[:2] == b'\xff\xd8':
        return master
    from utils import image_loading  # noqa: F401  registers the bounded JPEG XL opener
    with Image.open(BytesIO(master)) as image:
        out = BytesIO()
        image.convert('RGB').save(out, 'JPEG', quality=95)
        return out.getvalue()


def tools():
    gui = os.environ.get('FACET_DARKTABLE_GUI', 'darktable')
    cli = os.environ.get('FACET_DARKTABLE_CLI', 'darktable-cli')
    mac = Path('/Applications/darktable.app/Contents/MacOS')
    return (shutil.which(gui) or (str(mac / 'darktable') if (mac / 'darktable').is_file() else None),
            shutil.which(cli) or (str(mac / 'darktable-cli') if (mac / 'darktable-cli').is_file() else None),
            shutil.which('exiftool'))


def render(source):
    """Render a private snapshot, never allowing the CLI to rewrite a real sidecar."""
    _, cli, exiftool = tools()
    if not cli or not exiftool:
        raise HTTPException(503, 'Install darktable and ExifTool to return edits')
    if not _RENDER_LOCK.acquire(blocking=False):
        raise HTTPException(409, 'Another photo edit is being rendered; try again')
    try:
        with tempfile.TemporaryDirectory(prefix='facet-darktable-') as tmp:
            original = Path(source)
            if original.stat().st_size > MAX_SOURCE_BYTES:
                raise HTTPException(413, 'Original exceeds the experimental edit size limit')
            sidecar = Path(str(source) + '.xmp')
            if not sidecar.is_file():
                raise HTTPException(409, 'Save the darktable XMP sidecar before applying the edit')
            if sidecar.stat().st_size > 8 * 1024 * 1024:
                raise HTTPException(413, 'Edit history is too large')
            sidecar_stamp = source_stamp(sidecar)
            history = sidecar.read_bytes()
            if source_stamp(sidecar) != sidecar_stamp:
                raise HTTPException(409, 'Edit history changed; try again')
            snapshot = Path(tmp) / ('source' + original.suffix)
            shutil.copyfile(source, snapshot)
            xmp = Path(tmp) / 'history.xmp'
            xmp.write_bytes(history)
            output = Path(tmp) / 'edited.jxl'
            _run([cli, str(snapshot), str(xmp), str(output), '--apply-custom-presets', 'false',
                  '--core', '--library', ':memory:', '--conf', 'plugins/imageio/format/jxl/quality=97', '--conf', 'plugins/imageio/format/jxl/effort=7',
                  '--conf', 'plugins/imageio/format/jxl/bpp=8'])
            if not output.is_file() or output.stat().st_size > MAX_RENDER_BYTES:
                raise HTTPException(413, 'Rendered photo exceeds the edit size limit')
            from utils import image_loading  # noqa: F401  registers the bounded JPEG XL opener
            with Image.open(output) as image:
                if image.format != 'JXL' or image.width * image.height > 60_000_000:
                    raise HTTPException(413, 'Rendered photo exceeds the pixel limit')
                image.load()
                width, height = image.size
                image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
                preview = BytesIO()
                image.save(preview, 'JPEG', quality=85)
                image.thumbnail((640, 640), Image.Resampling.LANCZOS)
                thumb = BytesIO()
                image.save(thumb, 'JPEG', quality=90)
            # Keep camera/capture/GPS metadata, but never attach original-space face
            # boxes or orientation to cropped/rotated output. Originals keep all tags.
            # -m: darktable writes a bare JPEG XL codestream, which ExifTool only wraps in a container
            # (needed to write metadata) when minor warnings are tolerated.
            _run([exiftool, '-m', '-overwrite_original', '-TagsFromFile', str(snapshot),
                  '-EXIF:all', '-IPTC:all', '-XMP:all', '-EXIF:Orientation#=1', '-XMP-tiff:Orientation#=1',
                  f'-ExifImageWidth={width}', f'-ExifImageHeight={height}',
                  '-XMP-mwg-rs:all=', '-XMP-MP:all=', '-ThumbnailImage=', '-PreviewImage=',
                  '-JpgFromRaw=', '-XMP-tiff:ImageWidth=', '-XMP-tiff:ImageLength=', str(output)])
            data = output.read_bytes()
            if len(data) > MAX_RENDER_BYTES:
                raise HTTPException(413, 'Rendered photo exceeds the edit size limit')
            if source_stamp(sidecar) != sidecar_stamp:
                raise HTTPException(409, 'Edit history changed during rendering; try again')
            return data, preview.getvalue(), thumb.getvalue(), history, width, height
    finally:
        _RENDER_LOCK.release()


def _run(args):
    try:
        result = subprocess.run(args, capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(502, 'Photo editor failed or timed out; the previous image is unchanged') from exc
    if result.returncode:
        # Subprocess stderr may contain private resolved paths.
        raise HTTPException(502, 'Photo editor failed; the previous image is unchanged')


def revision():
    return uuid.uuid4().hex


async def attach_display_aspects(photos, conn):
    """Display geometry only; detector coordinates remain on the canonical original."""
    import asyncio
    cursor = await conn.execute("SELECT 1 FROM sqlite_master WHERE name='photo_darktable_edits'")
    exists = await cursor.fetchone()
    await cursor.close()
    if not exists:
        return
    lookup = {photo['path']: photo for photo in photos}
    paths = list(lookup)
    rows = []
    for start in range(0, len(paths), 400):
        chunk = paths[start:start + 400]
        marks = ','.join('?' for _ in chunk)
        cursor = await conn.execute(
            f'SELECT photo_path, source, width, height FROM photo_darktable_edits WHERE photo_path IN ({marks})', chunk)
        rows.extend(await cursor.fetchall())
        await cursor.close()
    def current():
        from api.path_validation import resolve_photo_disk_path
        found = []
        for row in rows:
            try:
                if row['source'] == source_stamp(resolve_photo_disk_path(row['photo_path'])):
                    found.append((row['photo_path'], row['width'] / row['height']))
            except (OSError, HTTPException):
                continue
        return found
    for path, aspect in await asyncio.to_thread(current):
        lookup[path]['display_aspect'] = aspect
