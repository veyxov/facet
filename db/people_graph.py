"""People graph domain. Callers own visibility, authorization and transactions."""
from datetime import date
from uuid import uuid4


class PeopleGraphError(ValueError):
    """Invalid relationship or group structure."""


def create_schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS people_connection_types (
        id TEXT PRIMARY KEY, forward_label TEXT NOT NULL, reverse_label TEXT NOT NULL,
        mutual INTEGER NOT NULL CHECK(mutual IN (0,1)), ancestry INTEGER NOT NULL DEFAULT 0)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS people_connections (
        id TEXT PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        type_id TEXT NOT NULL REFERENCES people_connection_types(id),
        starts_on TEXT, ends_on TEXT, created_by TEXT NOT NULL,
        CHECK(source_id != target_id), UNIQUE(source_id,target_id,type_id))""")
    conn.execute("CREATE INDEX IF NOT EXISTS people_connections_target ON people_connections(target_id)")
    conn.execute("""CREATE TABLE IF NOT EXISTS people_groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        parent_id TEXT REFERENCES people_groups(id) ON DELETE RESTRICT,
        created_by TEXT NOT NULL, CHECK(id != parent_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS people_group_members (
        group_id TEXT NOT NULL REFERENCES people_groups(id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        PRIMARY KEY(group_id,person_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS people_private_notes (
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        owner TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(person_id,owner))""")
    conn.executemany("INSERT OR IGNORE INTO people_connection_types VALUES(?,?,?,?,?)", [
        ('parent', 'Parent of', 'Child of', 0, 1),
        ('sibling', 'Sibling of', 'Sibling of', 1, 0),
        ('partner', 'Partner of', 'Partner of', 1, 0),
        ('friend', 'Friend of', 'Friend of', 1, 0),
        ('coworker', 'Coworker of', 'Coworker of', 1, 0),
    ])


def add_connection(conn, source, target, kind, owner, starts_on=None, ends_on=None):
    if source == target:
        raise PeopleGraphError('Choose two different people')
    relation = conn.execute('SELECT mutual,ancestry FROM people_connection_types WHERE id=?', (kind,)).fetchone()
    if relation is None:
        raise PeopleGraphError('Unknown connection type')
    for value in (starts_on, ends_on):
        if value is not None:
            try:
                if date.fromisoformat(value).isoformat() != value:
                    raise ValueError
            except (ValueError, TypeError) as exc:
                raise PeopleGraphError('Dates must use YYYY-MM-DD') from exc
    if starts_on and ends_on and starts_on > ends_on:
        raise PeopleGraphError('End date precedes start date')
    if relation[0] and source > target:
        source, target = target, source
    if relation[1]:
        cycle = conn.execute("""WITH RECURSIVE descendants(id) AS (
            SELECT ? UNION SELECT c.target_id FROM people_connections c
            JOIN people_connection_types t ON t.id=c.type_id AND t.ancestry=1
            JOIN descendants d ON c.source_id=d.id)
            SELECT 1 FROM descendants WHERE id=? LIMIT 1""", (target, source)).fetchone()
        if cycle:
            raise PeopleGraphError('Parent connection would create an ancestry cycle')
    if conn.execute('SELECT 1 FROM people_connections WHERE source_id=? AND target_id=? AND type_id=?',
                    (source, target, kind)).fetchone():
        raise PeopleGraphError('This connection already exists')
    identity = str(uuid4())
    conn.execute('INSERT INTO people_connections VALUES(?,?,?,?,?,?,?)',
                 (identity, source, target, kind, starts_on, ends_on, owner))
    return identity


def move_group(conn, identity, parent):
    if not conn.execute('SELECT 1 FROM people_groups WHERE id=?', (identity,)).fetchone():
        raise PeopleGraphError('Group not found')
    if parent is not None:
        if not conn.execute('SELECT 1 FROM people_groups WHERE id=?', (parent,)).fetchone():
            raise PeopleGraphError('Parent group not found')
        if conn.execute("""WITH RECURSIVE branch(id) AS (
            SELECT ? UNION SELECT g.id FROM people_groups g JOIN branch b ON g.parent_id=b.id)
            SELECT 1 FROM branch WHERE id=?""", (identity, parent)).fetchone():
            raise PeopleGraphError('Group nesting would create a cycle')
    conn.execute('UPDATE people_groups SET parent_id=? WHERE id=?', (parent, identity))


def merge_person(conn, source, target):
    """Transfer graph data inside the caller's person-merge transaction.

    A contraction that makes ancestry inconsistent refuses the whole merge.
    Notes from the same author are concatenated rather than silently overwritten.
    """
    from db.transactions import savepoint

    with savepoint(conn):
        rows = conn.execute('SELECT id,source_id,target_id,type_id,starts_on,ends_on,created_by '
                            'FROM people_connections WHERE source_id=? OR target_id=?',
                            (source, source)).fetchall()
        conn.execute('DELETE FROM people_connections WHERE source_id=? OR target_id=?', (source, source))
        for _, left, right, kind, start, end, owner in rows:
            left = target if left == source else left
            right = target if right == source else right
            if left == right:
                continue
            mutual = conn.execute('SELECT mutual FROM people_connection_types WHERE id=?', (kind,)).fetchone()[0]
            if mutual and left > right:
                left, right = right, left
            existing = conn.execute('SELECT starts_on,ends_on FROM people_connections '
                                    'WHERE source_id=? AND target_id=? AND type_id=?',
                                    (left, right, kind)).fetchone()
            if existing:
                if tuple(existing) != (start, end):
                    raise PeopleGraphError('Merge has connections with conflicting dates')
                continue
            add_connection(conn, left, right, kind, owner, start, end)
        conn.execute('INSERT OR IGNORE INTO people_group_members SELECT group_id,? '
                     'FROM people_group_members WHERE person_id=?', (target, source))
        conn.execute('DELETE FROM people_group_members WHERE person_id=?', (source,))
        notes = conn.execute('SELECT owner,body FROM people_private_notes WHERE person_id=?', (source,)).fetchall()
        for owner, body in notes:
            current = conn.execute('SELECT body FROM people_private_notes WHERE person_id=? AND owner=?',
                                   (target, owner)).fetchone()
            combined = current[0] + '\n\n' + body if current and current[0] != body else body
            conn.execute('INSERT INTO people_private_notes VALUES(?,?,?) '
                         'ON CONFLICT(person_id,owner) DO UPDATE SET body=excluded.body',
                         (target, owner, combined))
        conn.execute('DELETE FROM people_private_notes WHERE person_id=?', (source,))


def person_has_graph(conn, person_id):
    """Automatic empty-cluster cleanup must preserve deliberate organization."""
    return any(conn.execute(query, params).fetchone() for query, params in (
        ('SELECT 1 FROM people_connections WHERE source_id=? OR target_id=? LIMIT 1', (person_id, person_id)),
        ('SELECT 1 FROM people_group_members WHERE person_id=? LIMIT 1', (person_id,)),
        ('SELECT 1 FROM people_private_notes WHERE person_id=? LIMIT 1', (person_id,)),
    ))


def import_viewer_graph(conn):
    """Add shared source graph data using the established stable person map.

    Viewer records win on existing UUIDs. Private notes never cross this boundary.
    Source deletions do not delete viewer organization.
    """
    from db.transactions import savepoint

    if not conn.execute("SELECT 1 FROM src.sqlite_master WHERE type='table' AND name='people_connections'").fetchone():
        return
    with savepoint(conn):
        for row in conn.execute('SELECT id,forward_label,reverse_label,mutual,ancestry FROM src.people_connection_types').fetchall():
            existing = conn.execute('SELECT forward_label,reverse_label,mutual,ancestry FROM main.people_connection_types WHERE id=?', (row[0],)).fetchone()
            if existing and tuple(existing) != tuple(row[1:]):
                raise PeopleGraphError('Connection type identity has conflicting definitions')
            conn.execute('INSERT OR IGNORE INTO main.people_connection_types VALUES(?,?,?,?,?)', tuple(row))
        groups = conn.execute('SELECT id,name,parent_id,created_by FROM src.people_groups').fetchall()
        # Define nodes first so parent ordering is independent of source row order.
        inserted = set()
        for identity, name, _, owner in groups:
            if not conn.execute('SELECT 1 FROM main.people_groups WHERE id=?', (identity,)).fetchone():
                conn.execute('INSERT INTO main.people_groups VALUES(?,?,NULL,?)', (identity, name, owner))
                inserted.add(identity)
        for identity, _, parent, _ in groups:
            if identity in inserted:
                move_group(conn, identity, parent)
        conn.execute('INSERT OR IGNORE INTO main.people_group_members '
                     'SELECT m.group_id,p.dest_id FROM src.people_group_members m '
                     'JOIN source_person_map p ON p.source_id=m.person_id')
        rows = conn.execute('SELECT c.id,a.dest_id,b.dest_id,c.type_id,c.starts_on,c.ends_on,c.created_by '
                            'FROM src.people_connections c JOIN source_person_map a ON a.source_id=c.source_id '
                            'JOIN source_person_map b ON b.source_id=c.target_id').fetchall()
        for identity, source, target, kind, start, end, owner in rows:
            if conn.execute('SELECT 1 FROM main.people_connections WHERE id=?', (identity,)).fetchone():
                continue
            mutual = conn.execute('SELECT mutual FROM main.people_connection_types WHERE id=?', (kind,)).fetchone()[0]
            if mutual and source > target:
                source, target = target, source
            if conn.execute('SELECT 1 FROM main.people_connections WHERE source_id=? AND target_id=? AND type_id=?',
                            (source, target, kind)).fetchone():
                continue
            generated = add_connection(conn, source, target, kind, owner, start, end)
            conn.execute('UPDATE main.people_connections SET id=? WHERE id=?', (identity, generated))


GRAPH_PERSON_IDS_SQL = (
    'SELECT source_id FROM people_connections UNION SELECT target_id FROM people_connections '
    'UNION SELECT person_id FROM people_group_members UNION SELECT person_id FROM people_private_notes'
)
