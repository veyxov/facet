"""Graph invariants on disposable SQLite databases."""
import sqlite3

import pytest

from db.people_graph import PeopleGraphError, add_connection, create_schema, move_group, merge_person


@pytest.fixture
def graph():
    with sqlite3.connect(':memory:') as conn:
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('CREATE TABLE persons(id INTEGER PRIMARY KEY)')
        conn.executemany('INSERT INTO persons VALUES(?)', [(1,), (2,), (3,)])
        create_schema(conn)
        yield conn


def test_parent_direction_and_cycle_refusal_leave_edges_unchanged(graph):
    add_connection(graph, 1, 2, 'parent', 'alice')
    add_connection(graph, 2, 3, 'parent', 'alice')
    with pytest.raises(PeopleGraphError, match='ancestry cycle'):
        add_connection(graph, 3, 1, 'parent', 'alice')
    assert graph.execute('SELECT source_id,target_id FROM people_connections ORDER BY source_id').fetchall() == [(1, 2), (2, 3)]


def test_mutual_connections_canonicalize_and_types_can_overlap(graph):
    add_connection(graph, 2, 1, 'friend', 'alice')
    with pytest.raises(PeopleGraphError, match='already exists'):
        add_connection(graph, 1, 2, 'friend', 'alice')
    add_connection(graph, 1, 2, 'coworker', 'alice')
    assert graph.execute('SELECT source_id,target_id,type_id FROM people_connections ORDER BY type_id').fetchall() == [(1, 2, 'coworker'), (1, 2, 'friend')]


@pytest.mark.parametrize('start,end', [('2026-02-30', None), ('2026-2-01', None), ('2026-11-05', '2026-01-01')])
def test_invalid_dates_refuse_without_writing(graph, start, end):
    with pytest.raises(PeopleGraphError):
        add_connection(graph, 1, 2, 'friend', 'alice', start, end)
    assert graph.execute('SELECT COUNT(*) FROM people_connections').fetchone()[0] == 0


def test_groups_overlap_and_cycle_refusal_preserves_nesting(graph):
    graph.executemany('INSERT INTO people_groups VALUES(?,?,?,?)', [('family', 'Family', None, 'alice'), ('children', 'Children', 'family', 'alice'), ('friends', 'Friends', None, 'alice')])
    graph.executemany('INSERT INTO people_group_members VALUES(?,?)', [('children', 1), ('friends', 1)])
    with pytest.raises(PeopleGraphError, match='cycle'):
        move_group(graph, 'family', 'children')
    assert graph.execute('SELECT parent_id FROM people_groups WHERE id=?', ('family',)).fetchone() == (None,)
    assert graph.execute('SELECT COUNT(*) FROM people_group_members WHERE person_id=1').fetchone()[0] == 2


def test_repeat_initialization_preserves_custom_types_and_notes(graph):
    graph.execute("INSERT INTO people_connection_types VALUES('mentor','Mentor of','Mentee of',0,0)")
    graph.execute("INSERT INTO people_private_notes VALUES(1,'alice','Remember this')")
    add_connection(graph, 1, 2, 'mentor', 'alice')
    create_schema(graph)
    assert graph.execute('SELECT body FROM people_private_notes WHERE owner=?', ('alice',)).fetchone() == ('Remember this',)
    assert graph.execute('SELECT COUNT(*) FROM people_connections').fetchone()[0] == 1


def test_person_delete_cascades_graph_records(graph):
    add_connection(graph, 1, 2, 'friend', 'alice')
    graph.execute("INSERT INTO people_private_notes VALUES(1,'alice','Private')")
    graph.execute('DELETE FROM persons WHERE id=1')
    assert graph.execute('SELECT COUNT(*) FROM people_connections').fetchone()[0] == 0
    assert graph.execute('SELECT COUNT(*) FROM people_private_notes').fetchone()[0] == 0


def test_merge_transfers_membership_notes_and_canonical_edges(graph):
    add_connection(graph, 1, 3, 'friend', 'alice')
    graph.execute("INSERT INTO people_groups VALUES('g','Friends',NULL,'alice')")
    graph.execute("INSERT INTO people_group_members VALUES('g',1)")
    graph.executemany('INSERT INTO people_private_notes VALUES(?,?,?)', [(1, 'alice', 'Source'), (2, 'alice', 'Target'), (1, 'bob', 'Other author')])
    merge_person(graph, 1, 2)
    assert graph.execute('SELECT source_id,target_id FROM people_connections').fetchall() == [(2, 3)]
    assert graph.execute('SELECT person_id FROM people_group_members').fetchall() == [(2,)]
    assert graph.execute('SELECT owner,body FROM people_private_notes WHERE person_id=2 ORDER BY owner').fetchall() == [('alice', 'Target\n\nSource'), ('bob', 'Other author')]


def test_merge_refuses_ancestry_cycle_and_rolls_back_graph(graph):
    add_connection(graph, 1, 2, 'parent', 'alice')
    add_connection(graph, 2, 3, 'parent', 'alice')
    before = graph.execute('SELECT * FROM people_connections ORDER BY id').fetchall()
    with pytest.raises(PeopleGraphError, match='ancestry cycle'):
        merge_person(graph, 1, 3)
    assert graph.execute('SELECT * FROM people_connections ORDER BY id').fetchall() == before
