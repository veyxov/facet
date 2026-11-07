"""Desktop edit return uses temporary files and the real application schema."""
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
from unittest import mock

from fastapi import HTTPException
from PIL import Image
import pytest

from api import darktable_edits as edits
from api.database import get_db
from api.routers import darktable_edits as router


def jxl(color='red', size=(40, 30)):
    import imagecodecs
    import numpy
    return imagecodecs.jpegxl_encode(numpy.asarray(Image.new('RGB', size, color)), level=0)


def jpeg(color='red', size=(40, 30)):
    stream = BytesIO()
    Image.new('RGB', size, color).save(stream, 'JPEG')
    return stream.getvalue()


@pytest.fixture()
def photo(tmp_path, seed_photos_prefix, monkeypatch):
    path = tmp_path / 'photo ü space.jpg'
    path.write_bytes(jpeg())
    Path(str(path) + '.xmp').write_text('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>', encoding='utf-8')
    seed_photos_prefix(str(tmp_path), [{'path': str(path), 'filename': path.name,
                                      'thumbnail': jpeg(), 'gps_latitude': 12.5,
                                      'gps_longitude': -45.5, 'caption': 'Keep this caption',
                                      'image_width': 40, 'image_height': 30}])
    monkeypatch.setenv('FACET_DARKTABLE_EDIT', '1')
    return str(path)


def state(client, photo):
    res = client.get('/api/photo/darktable', params={'path': photo})
    assert res.status_code == 200, res.text
    return res.json()


def apply(client, photo, token):
    return client.post('/api/photo/darktable/apply', json={'path': photo, 'token': token})


def fake_render(_):
    return jpeg('blue', (20, 30)), jpeg('blue', (20, 30)), jpeg('blue', (20, 30)), b'history', 20, 30


def test_apply_keeps_original_and_entire_photo_row_then_reverts(edition_client, photo, monkeypatch):
    original = Path(photo).read_bytes()
    sidecar = Path(photo + '.xmp').read_bytes()
    with get_db() as conn:
        before = dict(conn.execute('SELECT * FROM photos WHERE path=?', (photo,)).fetchone())
    initial = state(edition_client, photo)
    monkeypatch.setattr(edits, 'render', fake_render)
    result = apply(edition_client, photo, initial['token'])
    assert result.status_code == 200, result.text
    assert result.json()['edited']
    with get_db() as conn:
        after = dict(conn.execute('SELECT * FROM photos WHERE path=?', (photo,)).fetchone())
        assert edits.read_edit(conn, photo, 'jpeg') == jpeg('blue', (20, 30))
    assert after.pop('preview_revision') != before.pop('preview_revision')
    assert after == before
    assert Path(photo).read_bytes() == original
    assert Path(photo + '.xmp').read_bytes() == sidecar
    for url in ['/image', '/thumbnail', '/api/photo/darktable/download']:
        response = edition_client.get(url, params={'path': photo})
        assert response.status_code == 200, response.text
        assert Image.open(BytesIO(response.content)).size == (20, 30)
        assert 'private' in response.headers['cache-control']
    thumb = edition_client.get('/thumbnail', params={'path': photo, 'size': 10})
    assert Image.open(BytesIO(thumb.content)).size == (7, 10)
    # A repeated stale apply must never silently overwrite the new rendition.
    assert apply(edition_client, photo, initial['token']).status_code == 409
    reverted = edition_client.post('/api/photo/darktable/revert', json={
        'path': photo, 'token': result.json()['token']})
    assert reverted.status_code == 200
    assert not reverted.json()['edited']
    assert apply(edition_client, photo, initial['token']).status_code == 409
    assert edition_client.get('/image', params={'path': photo}).content == original
    assert edition_client.get('/api/photo/darktable/download', params={'path': photo}).status_code == 404


def test_image_negotiates_jpeg_xl(edition_client, photo, monkeypatch):
    monkeypatch.setattr(edits, 'render', fake_render)
    assert apply(edition_client, photo, state(edition_client, photo)['token']).status_code == 200
    plain = edition_client.get('/image', params={'path': photo})
    assert plain.headers['content-type'] == 'image/jpeg'
    jxl_ok = edition_client.get('/image', params={'path': photo}, headers={'Accept': 'image/jxl,image/*'})
    assert jxl_ok.headers['content-type'] == 'image/jxl'
    assert 'Accept' in jxl_ok.headers['vary']


def test_original_option_bypasses_the_edit(edition_client, photo, monkeypatch):
    monkeypatch.setattr(edits, 'render', fake_render)
    assert apply(edition_client, photo, state(edition_client, photo)['token']).status_code == 200
    assert edition_client.get('/image', params={'path': photo}).content == jpeg('blue', (20, 30))
    assert edition_client.get('/image', params={'path': photo, 'original': 1}).content == Path(photo).read_bytes()
    stored = edition_client.get('/thumbnail', params={'path': photo, 'original': 1}).content
    assert stored != jpeg('blue', (20, 30))
    assert edition_client.get('/thumbnail', params={'path': photo}).content == jpeg('blue', (20, 30))


def test_sidecar_digest_follows_content_not_mtime(tmp_path):
    source = tmp_path / 'a.jpg'
    source.write_bytes(jpeg())
    assert edits.sidecar_digest(source) is None
    sidecar = Path(str(source) + '.xmp')
    sidecar.write_bytes(b'history')
    first = edits.sidecar_digest(source)
    os.utime(sidecar, (1, 1))
    assert edits.sidecar_digest(source) == first
    sidecar.write_bytes(b'history 2')
    assert edits.sidecar_digest(source) != first
    sidecar.write_bytes(b'x' * (8 * 1024 * 1024 + 1))
    assert edits.sidecar_digest(source) is None


def test_state_reports_the_sidecar_digest(edition_client, photo):
    assert state(edition_client, photo)['sidecar'] == edits.sidecar_digest(photo)


def test_display_jpeg_converts_the_master_and_passes_jpeg_through():
    master = jxl('blue', (20, 30))
    converted = edits.display_jpeg(master)
    assert converted[:2] == b'\xff\xd8'
    assert Image.open(BytesIO(converted)).size == (20, 30)
    already = jpeg()
    assert edits.display_jpeg(already) is already


def test_source_change_during_render_refuses_publication(edition_client, photo, monkeypatch):
    token = state(edition_client, photo)['token']
    def changed(_):
        Path(photo).write_bytes(jpeg('green'))
        return fake_render(photo)
    monkeypatch.setattr(edits, 'render', changed)
    assert apply(edition_client, photo, token).status_code == 409
    assert not state(edition_client, photo)['edited']


def test_render_failure_preserves_previous_and_retry_is_safe(edition_client, photo, monkeypatch):
    monkeypatch.setattr(edits, 'render', fake_render)
    first = apply(edition_client, photo, state(edition_client, photo)['token']).json()
    with mock.patch.object(edits, 'render', side_effect=HTTPException(502, 'Failed')):
        assert apply(edition_client, photo, first['token']).status_code == 502
    assert edition_client.get('/image', params={'path': photo}).content == jpeg('blue', (20, 30))
    assert apply(edition_client, photo, first['token']).status_code == 200


def test_disabled_and_missing_tools_do_not_launch(edition_client, photo, monkeypatch):
    body = {'path': photo, 'token': state(edition_client, photo)['token']}
    monkeypatch.delenv('FACET_DARKTABLE_EDIT')
    with mock.patch.object(router.subprocess, 'Popen') as launch:
        assert edition_client.post('/api/photo/darktable/open', json=body).status_code == 503
        launch.assert_not_called()
    monkeypatch.setenv('FACET_DARKTABLE_EDIT', '1')
    monkeypatch.setattr(edits, 'tools', lambda: (None, None, None))
    assert edition_client.post('/api/photo/darktable/open', json=body).status_code == 503


def test_unknown_photo_and_wrong_token(edition_client, photo):
    assert edition_client.get('/api/photo/darktable', params={'path': '/unknown.jpg'}).status_code == 404
    assert apply(edition_client, photo, 'bad').status_code == 409
    token = state(edition_client, photo)['token']
    assert apply(edition_client, '/unknown.jpg', token).status_code == 404


def test_read_only_cannot_launch_apply_revert_or_download(regular_client, photo):
    for operation in ['open', 'apply', 'revert']:
        assert regular_client.post('/api/photo/darktable/' + operation,
                                   json={'path': photo, 'token': 'x'}).status_code in (401, 403)
    assert regular_client.get('/api/photo/darktable/download', params={'path': photo}).status_code in (401, 403)


def test_real_metadata_copy_and_private_snapshot(tmp_path, monkeypatch):
    exiftool = shutil.which('exiftool')
    if not exiftool:
        pytest.skip('ExifTool not installed')
    source = tmp_path / 'é original.jpg'
    source.write_bytes(jpeg())
    subprocess.run([exiftool, '-overwrite_original', '-Make=Camera ü', '-GPSLatitude=12.5',
                    '-GPSLatitudeRef=N', '-GPSLongitude=45.5', '-GPSLongitudeRef=W',
                    '-Orientation#=6', str(source)], check=True, capture_output=True)
    embedded = tmp_path / 'embedded.jpg'
    embedded.write_bytes(jpeg('green', (10, 10)))
    subprocess.run([exiftool, '-overwrite_original', f'-ThumbnailImage<={embedded}', str(source)],
                   check=True, capture_output=True)
    original = source.read_bytes()
    history = Path(str(source) + '.xmp')
    history.write_bytes(b'<history>preserved</history>')
    monkeypatch.setattr(edits, 'tools', lambda: ('gui', 'fake-cli', exiftool))
    real_run = subprocess.run
    snapshot_paths = []
    def run(args, **kwargs):
        if args[0] == 'fake-cli':
            snapshot_paths.append(Path(args[1]))
            assert Path(args[1]).read_bytes() == original
            assert Path(args[2]).read_bytes() == history.read_bytes()
            assert Path(args[1]) != source
            Path(args[3]).write_bytes(jxl('blue', (20, 30)))
            return subprocess.CompletedProcess(args, 0)
        return real_run(args, **kwargs)
    monkeypatch.setattr(edits.subprocess, 'run', run)
    data, preview, thumbnail, saved_history, width, height = edits.render(str(source))
    assert (width, height) == (20, 30)
    assert saved_history == history.read_bytes()
    assert source.read_bytes() == original
    assert all(not path.exists() for path in snapshot_paths)
    exported = tmp_path / 'result.jxl'
    exported.write_bytes(data)
    tags = json.loads(real_run([exiftool, '-j', '-n', str(exported)], capture_output=True, check=True).stdout)[0]
    assert tags['Make'] == 'Camera ü'
    assert tags['GPSLatitude'] == 12.5
    assert tags['GPSLongitude'] == -45.5
    assert tags['Orientation'] == 1
    assert 'ThumbnailImage' not in tags
    assert 'PreviewImage' not in tags
    assert tags['ExifImageWidth'] == 20
    assert Image.open(BytesIO(thumbnail)).size == (20, 30)


def test_admission_and_timeout_release(tmp_path, monkeypatch):
    source = tmp_path / 'photo.jpg'
    source.write_bytes(jpeg())
    Path(str(source) + '.xmp').write_bytes(b'history')
    monkeypatch.setattr(edits, 'tools', lambda: ('gui', 'cli', 'exiftool'))
    with mock.patch.object(edits.subprocess, 'run', side_effect=subprocess.TimeoutExpired('cli', 120)):
        for _ in range(2):
            with pytest.raises(HTTPException) as error:
                edits.render(str(source))
            assert error.value.status_code == 502  # a leaked permit would return 409
    assert not edits._RENDER_LOCK.locked()


def test_simultaneous_returns_cannot_overwrite_each_other(edition_client, photo, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    token = state(edition_client, photo)['token']
    def blocked(_):
        entered.set()
        assert release.wait(10)
        return fake_render(photo)
    monkeypatch.setattr(edits, 'render', blocked)
    results = []
    worker = threading.Thread(target=lambda: results.append(apply(edition_client, photo, token)))
    worker.start()
    assert entered.wait(10)
    try:
        with get_db() as conn:
            conn.execute('INSERT INTO photo_darktable_edits(photo_path,revision,source,jpeg,preview,thumbnail,history,width,height) VALUES (?,?,?,?,?,?,?,?,?)',
                         (photo, 'other-return', edits.source_stamp(photo), jpeg('green'), jpeg('green'), jpeg('green'), b'other', 40, 30))
            conn.commit()
    finally:
        release.set()
        worker.join(10)
    assert not worker.is_alive()
    assert results[0].status_code == 409
    assert edition_client.get('/image', params={'path': photo}).content == jpeg('green')


def test_source_replacement_hides_old_edit_and_geometry(edition_client, photo, monkeypatch):
    monkeypatch.setattr(edits, 'render', fake_render)
    assert apply(edition_client, photo, state(edition_client, photo)['token']).status_code == 200
    detail = edition_client.get('/api/photo', params={'path': photo})
    assert detail.status_code == 200, detail.text
    assert detail.json()['display_aspect'] == 20 / 30
    assert detail.json()['image_width'] == 40
    Path(photo).write_bytes(jpeg('green'))
    assert edition_client.get('/image', params={'path': photo}).content == jpeg('green')
    detail = edition_client.get('/api/photo', params={'path': photo}).json()
    assert detail.get('display_aspect') is None
    assert not state(edition_client, photo)['edited']


def test_native_darktable_return(tmp_path, monkeypatch):
    _, cli, exiftool = edits.tools()
    if not cli or not exiftool:
        pytest.skip('darktable-cli and ExifTool required')
    source = tmp_path / 'native original.jpg'
    source.write_bytes(jpeg('red', (64, 48)))
    subprocess.run([exiftool, '-o', str(source) + '.xmp', '-XMP:Rating=3', str(source)],
                   capture_output=True, check=True)
    config = tmp_path / 'config'
    config.mkdir()
    original_run = edits._run
    def isolated(args):
        if args[0] == cli:
            args += ['--configdir', str(config)]
        return original_run(args)
    monkeypatch.setattr(edits, '_run', isolated)
    data, _, _, _, width, height = edits.render(str(source))
    assert (width, height) == (64, 48)
    assert Image.open(BytesIO(data)).size == (64, 48)


def test_private_receipts_are_omitted_from_full_export_but_preserved_at_destination(tmp_path):
    import sqlite3
    from db.schema import init_database
    from db.maintenance import export_viewer_db
    source, target = str(tmp_path / 'source.db'), str(tmp_path / 'viewer.db')
    init_database(source)
    with sqlite3.connect(source) as conn:
        conn.execute('INSERT INTO photos(path,filename,thumbnail) VALUES (?,?,?)', ('/a.jpg', 'a.jpg', jpeg()))
        conn.execute('INSERT INTO photo_darktable_edits(photo_path,revision,source,jpeg,preview,thumbnail,history,width,height) VALUES (?,?,?,?,?,?,?,?,?)',
                     ('/a.jpg', 'source-edit', 'stamp', jpeg(), jpeg(), jpeg(), b'private history', 40, 30))
    export_viewer_db(source, target, verbose=False)
    with sqlite3.connect(target) as conn:
        assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name='photo_darktable_edits'").fetchone()
    init_database(target)
    with sqlite3.connect(target) as conn:
        conn.execute('INSERT INTO photo_darktable_edits(photo_path,revision,source,jpeg,preview,thumbnail,history,width,height) VALUES (?,?,?,?,?,?,?,?,?)',
                     ('/a.jpg', 'destination-edit', 'stamp', jpeg('blue'), jpeg('blue'), jpeg('blue'), b'local history', 40, 30))
    export_viewer_db(source, target, verbose=False)
    with sqlite3.connect(target) as conn:
        assert conn.execute('SELECT revision,history FROM photo_darktable_edits').fetchall() == [('destination-edit', b'local history')]


def test_face_records_and_people_survive_apply(edition_client, photo, monkeypatch):
    with get_db() as conn:
        person = conn.execute("INSERT INTO persons(name) VALUES ('Alice')").lastrowid
        face = conn.execute('INSERT INTO faces(photo_path,face_index,embedding,person_id,bbox_x1,bbox_y1,bbox_x2,bbox_y2,face_thumbnail) VALUES (?,0,?,?,?,?,?,?,?)',
                            (photo, b'identity-vector', person, 3, 5, 9, 12, jpeg('green'))).lastrowid
        conn.commit()
        before = tuple(conn.execute('SELECT * FROM faces WHERE id=?', (face,)).fetchone())
    try:
        monkeypatch.setattr(edits, 'render', fake_render)
        assert apply(edition_client, photo, state(edition_client, photo)['token']).status_code == 200
        with get_db() as conn:
            assert tuple(conn.execute('SELECT * FROM faces WHERE id=?', (face,)).fetchone()) == before
            assert conn.execute('SELECT name FROM persons WHERE id=?', (person,)).fetchone()[0] == 'Alice'
        assert edition_client.get('/face_thumbnail/' + str(face)).content == jpeg('green')
    finally:
        with get_db() as conn:
            conn.execute('DELETE FROM faces WHERE id=?', (face,))
            conn.execute('DELETE FROM persons WHERE id=?', (person,))
            conn.commit()
