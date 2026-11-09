"""Local desktop darktable handoff and atomic rendition publication."""
from datetime import timedelta
import logging
import os
import subprocess
import sys
import threading

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from api.auth import CurrentUser, create_access_token, decode_access_token, require_edition
from api.database import get_db
from api.db_helpers import assert_photo_visible
from api.path_validation import resolve_photo_disk_path
from api import darktable_edits as edits

logger = logging.getLogger(__name__)
router = APIRouter(tags=['darktable edits'])


class EditState(BaseModel):
    enabled: bool
    available: bool
    edited: bool
    token: str
    sidecar: str | None = None


class EditRequest(BaseModel):
    path: str
    token: str


def _visible(conn, user, path):
    try:
        assert_photo_visible(conn, user.user_id, path)
    except LookupError as exc:
        raise HTTPException(404, 'Photo not found') from exc
    if conn.execute('SELECT 1 FROM photos WHERE path=?', (path,)).fetchone() is None:
        raise HTTPException(404, 'Photo not found')


def _source(path):
    disk = resolve_photo_disk_path(path)
    try:
        return disk, edits.source_stamp(disk)
    except OSError as exc:
        raise HTTPException(409, 'Original photo is unavailable') from exc


def _state(path, user):
    with get_db() as conn:
        _visible(conn, user, path)
        revision = edits.read_edit(conn, path)
        photo_revision = conn.execute('SELECT preview_revision FROM photos WHERE path=?', (path,)).fetchone()[0]
    disk, stamp = _source(path)
    gui, cli, exiftool = edits.tools()
    sidecar = edits.sidecar_digest(disk)
    token = create_access_token({'purpose': 'darktable_edit', 'path': path,
                                 'uid': user.user_id, 'source': stamp, 'revision': revision, 'photo_revision': photo_revision},
                                expires_delta=timedelta(hours=8))
    return EditState(enabled=os.environ.get('FACET_DARKTABLE_EDIT') == '1',
                     available=bool(gui and cli and exiftool), edited=bool(revision), token=token, sidecar=sidecar)


def _check(body, user, conn):
    _visible(conn, user, body.path)
    payload = decode_access_token(body.token)
    if (not payload or payload.get('purpose') != 'darktable_edit'
            or payload.get('path') != body.path or payload.get('uid') != user.user_id):
        raise HTTPException(409, 'Edit session expired; reopen the editor')
    disk, stamp = _source(body.path)
    photo_revision = conn.execute('SELECT preview_revision FROM photos WHERE path=?', (body.path,)).fetchone()[0]
    if (payload.get('source') != stamp or payload.get('revision') != edits.read_edit(conn, body.path)
            or payload.get('photo_revision') != photo_revision):
        raise HTTPException(409, 'Photo changed; reopen the editor')
    return disk


def _enabled():
    if os.environ.get('FACET_DARKTABLE_EDIT') != '1':
        raise HTTPException(503, 'Enable the local darktable integration first')


@router.get('/api/photo/darktable', response_model=EditState)
def state(path: str, response: Response, user: CurrentUser = Depends(require_edition)):
    response.headers['Cache-Control'] = 'no-store'
    return _state(path, user)


@router.post('/api/photo/darktable/open', response_model=EditState)
def open_editor(body: EditRequest, user: CurrentUser = Depends(require_edition)):
    _enabled()
    with get_db() as conn:
        disk = _check(body, user, conn)
    gui, cli, exiftool = edits.tools()
    if not gui or not cli or not exiftool:
        raise HTTPException(503, 'Install darktable and ExifTool on the viewer computer')
    try:
        # Starting the binary again while darktable runs fails with "database is locked";
        # LaunchServices hands the file to the running instance instead.
        bundle = gui.split('.app/', 1)[0] + '.app' if '.app/' in gui else None
        command = ['open', '-a', bundle, disk] if bundle and sys.platform == 'darwin' else [gui, disk]
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Reap a forwarding process without waiting for the desktop editor to exit.
        threading.Thread(target=process.wait, daemon=True).start()
    except OSError as exc:
        raise HTTPException(502, 'Could not open darktable') from exc
    return _state(body.path, user)


@router.post('/api/photo/darktable/apply', response_model=EditState)
def apply_edit(body: EditRequest, user: CurrentUser = Depends(require_edition)):
    _enabled()
    with get_db() as conn:
        disk = _check(body, user, conn)
    try:
        data, preview, thumbnail, history, width, height = edits.render(disk)
        display = edits.display_jpeg(data)  # decode/encode before taking the write lock
        with get_db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            _check(body, user, conn)  # authorization, source and revision after slow work
            conn.execute(
                'INSERT INTO photo_darktable_edits '
                '(photo_path, revision, source, jpeg, jxl, preview, thumbnail, history, width, height) VALUES (?,?,?,?,?,?,?,?,?,?) '
                'ON CONFLICT(photo_path) DO UPDATE SET revision=excluded.revision, source=excluded.source, jpeg=excluded.jpeg, jxl=excluded.jxl, '
                'preview=excluded.preview, thumbnail=excluded.thumbnail, history=excluded.history, width=excluded.width, height=excluded.height',
                (body.path, edits.revision(), edits.source_stamp(disk), display, data, preview, thumbnail, history, width, height))
            conn.execute('UPDATE photos SET preview_revision=? WHERE path=?', ('dt-' + edits.revision(), body.path))
            conn.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception('Could not apply darktable edit')
        raise HTTPException(502, 'Could not apply edit; the previous image is unchanged') from exc
    return _state(body.path, user)


@router.post('/api/photo/darktable/revert', response_model=EditState)
def revert_edit(body: EditRequest, user: CurrentUser = Depends(require_edition)):
    _enabled()
    with get_db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        _check(body, user, conn)
        conn.execute('DELETE FROM photo_darktable_edits WHERE photo_path=?', (body.path,))
        conn.execute('UPDATE photos SET preview_revision=? WHERE path=?', ('dt-' + edits.revision(), body.path))
        conn.commit()
    return _state(body.path, user)


@router.get('/api/photo/darktable/download')
def download_edit(path: str, user: CurrentUser = Depends(require_edition)):
    with get_db() as conn:
        _visible(conn, user, path)
        data = edits.read_edit(conn, path, 'jxl')
    if not data:
        raise HTTPException(404, 'No edited rendition')
    return Response(data, media_type='image/jxl', headers={
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="edited.jxl"'})
