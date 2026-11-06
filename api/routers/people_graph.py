"""Authenticated people connections and author-scoped notes."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.auth import CurrentUser, require_authenticated, require_edition
from api.database import get_db
from api.db_helpers import person_visibility_exists
from db.people_graph import PeopleGraphError, add_connection

router = APIRouter(prefix='/api/people-graph', tags=['people-graph'])


class ConnectionRequest(BaseModel):
    source_id: int = Field(gt=0, le=9223372036854775807)
    target_id: int = Field(gt=0, le=9223372036854775807)
    type_id: str = Field(min_length=1, max_length=100)
    starts_on: str | None = None
    ends_on: str | None = None


class NoteRequest(BaseModel):
    body: str = Field(max_length=20000)


def _person(conn, user, identity):
    visible, params = person_visibility_exists(user.user_id, 'p.id')
    condition = ' AND ' + visible if visible else ''
    if not conn.execute('SELECT 1 FROM persons p WHERE p.id=? AND COALESCE(p.is_hidden,0)=0' + condition,
                        [identity, *params]).fetchone():
        raise HTTPException(404, 'Person not found')


@router.get('/connections/{person_id}')
def connections(person_id: int, user: CurrentUser = Depends(require_authenticated)):
    with get_db() as conn:
        _person(conn, user, person_id)
        visible, params = person_visibility_exists(user.user_id, 'p.id')
        condition = ' AND ' + visible if visible else ''
        rows = conn.execute("""SELECT c.*,t.forward_label,t.reverse_label,t.mutual,p.name AS other_name
            FROM people_connections c JOIN people_connection_types t ON t.id=c.type_id
            JOIN persons p ON p.id=CASE WHEN c.source_id=? THEN c.target_id ELSE c.source_id END
            WHERE (c.source_id=? OR c.target_id=?) AND COALESCE(p.is_hidden,0)=0""" + condition + ' ORDER BY p.name,c.id',
            [person_id, person_id, person_id, *params]).fetchall()
        return {'connections': [dict(row) for row in rows],
                'types': [dict(row) for row in conn.execute('SELECT * FROM people_connection_types ORDER BY id')]}


@router.post('/connections')
def connect(body: ConnectionRequest, user: CurrentUser = Depends(require_edition)):
    with get_db() as conn:
        with conn:
            conn.execute('BEGIN IMMEDIATE')
            _person(conn, user, body.source_id)
            _person(conn, user, body.target_id)
            try:
                identity = add_connection(conn, body.source_id, body.target_id, body.type_id,
                                          user.user_id or '', body.starts_on, body.ends_on)
            except PeopleGraphError as exc:
                raise HTTPException(409, str(exc)) from exc
        return {'id': identity}


@router.delete('/connections/{connection_id}')
def disconnect(connection_id: str, user: CurrentUser = Depends(require_edition)):
    with get_db() as conn:
        with conn:
            row = conn.execute('SELECT source_id,target_id FROM people_connections WHERE id=?', (connection_id,)).fetchone()
            if row is None:
                raise HTTPException(404, 'Connection not found')
            for identity in row:
                _person(conn, user, identity)
            conn.execute('DELETE FROM people_connections WHERE id=?', (connection_id,))
        return {'success': True}


@router.get('/notes/{person_id}')
def note(person_id: int, user: CurrentUser = Depends(require_authenticated)):
    with get_db() as conn:
        _person(conn, user, person_id)
        row = conn.execute('SELECT body FROM people_private_notes WHERE person_id=? AND owner=?',
                           (person_id, user.user_id or '')).fetchone()
        return {'body': row[0] if row else ''}


@router.put('/notes/{person_id}')
def save_note(person_id: int, body: NoteRequest, user: CurrentUser = Depends(require_edition)):
    with get_db() as conn:
        with conn:
            _person(conn, user, person_id)
            conn.execute('INSERT INTO people_private_notes VALUES(?,?,?) '
                         'ON CONFLICT(person_id,owner) DO UPDATE SET body=excluded.body',
                         (person_id, user.user_id or '', body.body))
        return {'success': True}


class ConnectionTypeRequest(BaseModel):
    forward_label: str = Field(min_length=1, max_length=80)
    reverse_label: str = Field(min_length=1, max_length=80)
    mutual: bool = False


@router.post('/types')
def create_type(body: ConnectionTypeRequest, user: CurrentUser = Depends(require_edition)):
    forward, reverse = body.forward_label.strip(), body.reverse_label.strip()
    if not forward or not reverse:
        raise HTTPException(422, 'Connection labels cannot be blank')
    if body.mutual and forward != reverse:
        raise HTTPException(422, 'Mutual connections use the same label in both directions')
    identity = str(uuid4())
    with get_db() as conn:
        with conn:
            conn.execute('INSERT INTO people_connection_types VALUES(?,?,?,?,0)',
                         (identity, forward, reverse, int(body.mutual)))
    return {'id': identity}


class GroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: str | None = Field(default=None, min_length=1, max_length=100)


@router.get('/groups')
def groups(user: CurrentUser = Depends(require_authenticated)):
    with get_db() as conn:
        visible, params = person_visibility_exists(user.user_id, 'p.id')
        condition = ' AND ' + visible if visible else ''
        members = [dict(row) for row in conn.execute(
            'SELECT m.group_id,m.person_id FROM people_group_members m JOIN persons p ON p.id=m.person_id '
            'WHERE COALESCE(p.is_hidden,0)=0' + condition, params)]
        readable = {row['group_id'] for row in members}
        definitions = {row['id']: dict(row) for row in conn.execute('SELECT * FROM people_groups')}
        readable.update(key for key, group in definitions.items() if group['created_by'] == (user.user_id or ''))
        pending = list(readable)
        while pending:
            group = definitions.get(pending.pop())
            parent = group['parent_id'] if group else None
            if parent and parent not in readable:
                readable.add(parent)
                pending.append(parent)
        return {'groups': [{**{key: value for key, value in definitions[identity].items() if key != 'created_by'},
                            'can_edit': definitions[identity]['created_by'] == (user.user_id or '')}
                           for identity in sorted(readable) if identity in definitions], 'members': members}


def _group(conn, user, identity):
    # Structural edits require ownership: a visible shared membership does not
    # grant authority over a group containing inaccessible people.
    row = conn.execute('SELECT 1 FROM people_groups WHERE id=? AND created_by=?',
                       (identity, user.user_id or '')).fetchone()
    if not row:
        raise HTTPException(404, 'Group not found')


@router.post('/groups')
def create_group(body: GroupRequest, user: CurrentUser = Depends(require_edition)):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, 'Group name cannot be blank')
    identity = str(uuid4())
    with get_db() as conn:
        with conn:
            if body.parent_id:
                _group(conn, user, body.parent_id)
            conn.execute('INSERT INTO people_groups VALUES(?,?,?,?)',
                         (identity, name, body.parent_id, user.user_id or ''))
    return {'id': identity}


@router.put('/groups/{group_id}')
def update_group(group_id: str, body: GroupRequest, user: CurrentUser = Depends(require_edition)):
    from db.people_graph import move_group
    name = body.name.strip()
    if not name:
        raise HTTPException(422, 'Group name cannot be blank')
    with get_db() as conn:
        with conn:
            conn.execute('BEGIN IMMEDIATE')
            _group(conn, user, group_id)
            if body.parent_id:
                _group(conn, user, body.parent_id)
            try:
                move_group(conn, group_id, body.parent_id)
            except PeopleGraphError as exc:
                raise HTTPException(409, str(exc)) from exc
            conn.execute('UPDATE people_groups SET name=? WHERE id=?', (name, group_id))
    return {'success': True}


@router.put('/groups/{group_id}/members/{person_id}')
def add_member(group_id: str, person_id: int, user: CurrentUser = Depends(require_edition)):
    with get_db() as conn:
        with conn:
            _group(conn, user, group_id)
            _person(conn, user, person_id)
            conn.execute('INSERT OR IGNORE INTO people_group_members VALUES(?,?)', (group_id, person_id))
    return {'success': True}


@router.delete('/groups/{group_id}/members/{person_id}')
def remove_member(group_id: str, person_id: int, user: CurrentUser = Depends(require_edition)):
    with get_db() as conn:
        with conn:
            _group(conn, user, group_id)
            _person(conn, user, person_id)
            conn.execute('DELETE FROM people_group_members WHERE group_id=? AND person_id=?', (group_id, person_id))
    return {'success': True}


@router.get('/neighborhood/{person_id}')
def neighborhood(person_id: int, depth: int = Query(1, ge=1, le=3),
                 user: CurrentUser = Depends(require_authenticated)):
    """Bounded authorized traversal from a single consistent read snapshot."""
    with get_db() as conn:
        conn.execute('BEGIN')
        _person(conn, user, person_id)
        frontier = {person_id}
        seen = {person_id}
        edges = {}
        for _ in range(depth):
            if not frontier:
                break
            marks = ','.join('?' for _ in frontier)
            left, left_params = person_visibility_exists(user.user_id, 'a.id')
            right, right_params = person_visibility_exists(user.user_id, 'b.id')
            visibility = (' AND ' + left if left else '') + (' AND ' + right if right else '')
            rows = conn.execute(
                'SELECT c.id,c.source_id,c.target_id,c.type_id,t.forward_label,t.reverse_label,t.mutual '
                'FROM people_connections c JOIN persons a ON a.id=c.source_id '
                'JOIN persons b ON b.id=c.target_id JOIN people_connection_types t ON t.id=c.type_id '
                f'WHERE (c.source_id IN ({marks}) OR c.target_id IN ({marks})) '
                'AND COALESCE(a.is_hidden,0)=0 AND COALESCE(b.is_hidden,0)=0' + visibility +
                ' ORDER BY c.id LIMIT 301', [*frontier, *frontier, *left_params, *right_params]).fetchall()
            next_frontier = set()
            for row in rows:
                edge = dict(row)
                edges[edge['id']] = edge
                next_frontier.update((edge['source_id'], edge['target_id']))
            next_frontier -= seen
            seen.update(next_frontier)
            if len(seen) > 100 or len(edges) > 300:
                raise HTTPException(412, 'This neighborhood is too large; choose a smaller depth')
            frontier = next_frontier
        marks = ','.join('?' for _ in seen)
        people = [dict(row) for row in conn.execute(
            f'SELECT id,name,face_thumbnail IS NOT NULL AS face_thumbnail FROM persons WHERE id IN ({marks}) ORDER BY id',
            sorted(seen))]
        return {'people': people, 'connections': list(edges.values())}


@router.delete('/groups/{group_id}')
def delete_group(group_id: str, user: CurrentUser = Depends(require_edition)):
    """Remove organization only; promote child groups to the removed group's parent."""
    with get_db() as conn:
        with conn:
            conn.execute('BEGIN IMMEDIATE')
            _group(conn, user, group_id)
            parent = conn.execute('SELECT parent_id FROM people_groups WHERE id=?', (group_id,)).fetchone()[0]
            conn.execute('UPDATE people_groups SET parent_id=? WHERE parent_id=?', (parent, group_id))
            conn.execute('DELETE FROM people_group_members WHERE group_id=?', (group_id,))
            conn.execute('DELETE FROM people_groups WHERE id=?', (group_id,))
    return {'success': True}
