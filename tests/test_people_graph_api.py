"""HTTP graph persistence and authorization using a private temporary database."""
from contextlib import contextmanager
import sqlite3

import pytest

from db.people_graph import create_schema


@pytest.fixture
def graph_db(tmp_path, monkeypatch):
    import api.routers.people_graph as router
    path = tmp_path / 'graph.db'
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE persons(id INTEGER PRIMARY KEY,name TEXT,is_hidden INTEGER DEFAULT 0,face_thumbnail BLOB)')
        conn.executemany('INSERT INTO persons(id,name) VALUES(?,?)', [(1, 'Alice'), (2, 'Ben'), (3, 'Cleo')])
        create_schema(conn)
    @contextmanager
    def database():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        try:
            yield conn
        finally:
            conn.close()
    monkeypatch.setattr(router, 'get_db', database)
    return path


def test_connection_round_trip_and_reverse_read(graph_db, edition_client):
    response = edition_client.post('/api/people-graph/connections', json={'source_id': 1, 'target_id': 2, 'type_id': 'parent'})
    assert response.status_code == 200
    identity = response.json()['id']
    result = edition_client.get('/api/people-graph/connections/2')
    assert result.status_code == 200
    assert result.json()['connections'][0]['reverse_label'] == 'Child of'
    with sqlite3.connect(graph_db) as conn:
        assert conn.execute('SELECT source_id,target_id FROM people_connections').fetchall() == [(1, 2)]
    assert edition_client.delete('/api/people-graph/connections/' + identity).status_code == 200
    assert edition_client.get('/api/people-graph/connections/1').json()['connections'] == []


def test_private_notes_do_not_cross_authors(graph_db, edition_client, regular_client):
    assert edition_client.put('/api/people-graph/notes/1', json={'body': 'Private memory'}).status_code == 200
    assert edition_client.get('/api/people-graph/notes/1').json() == {'body': 'Private memory'}
    assert regular_client.get('/api/people-graph/notes/1').json() == {'body': ''}
    assert regular_client.put('/api/people-graph/notes/1', json={'body': 'Overwrite'}).status_code == 403


def test_regular_user_cannot_write_connections(graph_db, regular_client):
    assert regular_client.post('/api/people-graph/connections', json={'source_id': 1, 'target_id': 2, 'type_id': 'friend'}).status_code == 403
    with sqlite3.connect(graph_db) as conn:
        assert conn.execute('SELECT COUNT(*) FROM people_connections').fetchone()[0] == 0


def test_hidden_endpoint_does_not_leak_connections(graph_db, edition_client):
    edition_client.post('/api/people-graph/connections', json={'source_id': 1, 'target_id': 2, 'type_id': 'friend'})
    with sqlite3.connect(graph_db) as conn:
        conn.execute('UPDATE persons SET is_hidden=1 WHERE id=2')
    assert edition_client.get('/api/people-graph/connections/1').json()['connections'] == []
    assert edition_client.get('/api/people-graph/connections/2').status_code == 404


def test_groups_overlap_and_nesting_cycle_refuses_atomically(graph_db, edition_client):
    family = edition_client.post('/api/people-graph/groups', json={'name': 'Family'}).json()['id']
    children = edition_client.post('/api/people-graph/groups', json={'name': 'Children', 'parent_id': family}).json()['id']
    friends = edition_client.post('/api/people-graph/groups', json={'name': 'Friends'}).json()['id']
    for group in (children, friends):
        assert edition_client.put(f'/api/people-graph/groups/{group}/members/1').status_code == 200
    refused = edition_client.put(f'/api/people-graph/groups/{family}', json={'name': 'Changed', 'parent_id': children})
    assert refused.status_code == 409
    with sqlite3.connect(graph_db) as conn:
        assert conn.execute('SELECT name,parent_id FROM people_groups WHERE id=?', (family,)).fetchone() == ('Family', None)
        assert conn.execute('SELECT COUNT(*) FROM people_group_members WHERE person_id=1').fetchone()[0] == 2
    assert len(edition_client.get('/api/people-graph/groups').json()['groups']) == 3


def test_custom_type_persists_and_mutual_labels_are_consistent(graph_db, edition_client):
    invalid = edition_client.post('/api/people-graph/types', json={'forward_label': 'Mentor', 'reverse_label': 'Mentee', 'mutual': True})
    assert invalid.status_code == 422
    response = edition_client.post('/api/people-graph/types', json={'forward_label': 'Mentor of', 'reverse_label': 'Mentee of'})
    assert response.status_code == 200
    assert edition_client.post('/api/people-graph/connections', json={'source_id': 1, 'target_id': 2, 'type_id': response.json()['id']}).status_code == 200
    assert edition_client.get('/api/people-graph/connections/2').json()['connections'][0]['reverse_label'] == 'Mentee of'


def test_directory_scope_hides_foreign_edges_memberships_and_notes(graph_db, edition_client, monkeypatch):
    from db.people_graph import add_connection
    import api.db_helpers as helpers
    monkeypatch.setattr(helpers, 'is_multi_user_enabled', lambda: True)
    monkeypatch.setattr(helpers, 'get_user_directories', lambda owner: ['/visible'])
    with sqlite3.connect(graph_db) as conn:
        conn.execute('CREATE TABLE photos(path TEXT PRIMARY KEY)')
        conn.execute('CREATE TABLE faces(id INTEGER PRIMARY KEY,photo_path TEXT,person_id INTEGER)')
        conn.executemany('INSERT INTO photos VALUES(?)', [('/visible/a.jpg',), ('/hidden/b.jpg',)])
        conn.executemany('INSERT INTO faces VALUES(?,?,?)', [(1, '/visible/a.jpg', 1), (2, '/hidden/b.jpg', 2)])
        add_connection(conn, 1, 2, 'friend', 'other')
        conn.execute("INSERT INTO people_groups VALUES('secret','Secret group',NULL,'other')")
        conn.execute("INSERT INTO people_group_members VALUES('secret',2)")
    assert edition_client.get('/api/people-graph/connections/1').json()['connections'] == []
    assert edition_client.get('/api/people-graph/connections/2').status_code == 404
    assert edition_client.get('/api/people-graph/notes/2').status_code == 404
    assert edition_client.get('/api/people-graph/groups').json() == {'groups': [], 'members': []}
    assert edition_client.post('/api/people-graph/connections', json={'source_id': 1, 'target_id': 2, 'type_id': 'coworker'}).status_code == 404


def test_neighborhood_depth_and_shared_nodes(graph_db, edition_client):
    edition_client.post('/api/people-graph/connections', json={'source_id': 1, 'target_id': 2, 'type_id': 'parent'})
    edition_client.post('/api/people-graph/connections', json={'source_id': 2, 'target_id': 3, 'type_id': 'sibling'})
    first = edition_client.get('/api/people-graph/neighborhood/1?depth=1').json()
    assert {p['id'] for p in first['people']} == {1, 2}
    second = edition_client.get('/api/people-graph/neighborhood/1?depth=2').json()
    assert {p['id'] for p in second['people']} == {1, 2, 3}
    assert len(second['connections']) == 2
    with sqlite3.connect(graph_db) as conn:
        conn.execute('UPDATE persons SET is_hidden=1 WHERE id=2')
    hidden = edition_client.get('/api/people-graph/neighborhood/1?depth=3').json()
    assert [p['id'] for p in hidden['people']] == [1]
    assert hidden['connections'] == []


def test_group_delete_promotes_children_and_preserves_people(graph_db, edition_client):
    parent = edition_client.post('/api/people-graph/groups', json={'name': 'Family'}).json()['id']
    child = edition_client.post('/api/people-graph/groups', json={'name': 'Children', 'parent_id': parent}).json()['id']
    edition_client.put(f'/api/people-graph/groups/{parent}/members/1')
    assert edition_client.delete(f'/api/people-graph/groups/{parent}').status_code == 200
    with sqlite3.connect(graph_db) as conn:
        assert conn.execute('SELECT COUNT(*) FROM persons').fetchone()[0] == 3
        assert conn.execute('SELECT parent_id FROM people_groups WHERE id=?', (child,)).fetchone() == (None,)
        assert conn.execute('SELECT COUNT(*) FROM people_group_members').fetchone()[0] == 0


def test_empty_parent_id_is_validation_error(graph_db, edition_client):
    response = edition_client.post('/api/people-graph/groups', json={'name': 'Family', 'parent_id': ''})
    assert response.status_code == 422
    with sqlite3.connect(graph_db) as conn:
        assert conn.execute('SELECT COUNT(*) FROM people_groups').fetchone()[0] == 0
