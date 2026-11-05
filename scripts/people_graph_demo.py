"""Create a disposable fictional people graph; optionally serve it on loopback.

No existing library/configuration is read. Every run gets a new temporary root.
"""
import argparse
from io import BytesIO
import json
import os
from pathlib import Path
import sqlite3
import signal
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--port', type=int, default=5071)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    root = Path(tempfile.mkdtemp(prefix='facet-people-graph-demo-'))
    database = root / 'demo.db'
    config = json.loads((repo / 'config/scoring_config.default.json').read_text(encoding='utf-8'))
    config.setdefault('viewer', {}).update({'trusted_local_editing': True, 'password': '', 'edition_password': ''})
    config['users'] = {'shared_directories': [str(root)]}
    config_path = root / 'config.json'
    config_path.write_text(json.dumps(config, ensure_ascii=False), encoding='utf-8')
    config_path.chmod(0o600)
    os.environ['DB_PATH'] = str(database)
    os.environ['FACET_CONFIG'] = str(config_path)
    sys.path.insert(0, str(repo))
    from PIL import Image, ImageDraw, ImageFont
    from db.schema import init_database
    from db.people_graph import add_connection
    from db.keyword_hierarchy import assign_path
    init_database(str(database))
    with sqlite3.connect(database) as conn:
        identities = []
        for index, name in enumerate(('Alex Rivera', 'Sam Rivera', 'Jordan Rivera', 'Morgan Chen', 'Taylor Brooks', 'Casey Ellis')):
            image = Image.new('RGB', (320, 320), (45 + index * 12, 70 + index * 9, 85 + index * 8))
            draw = ImageDraw.Draw(image)
            initials = ''.join(part[0] for part in name.split())
            draw.text((160, 160), initials, font=ImageFont.load_default(size=96), anchor='mm', fill='white')
            path = root / f'fictional-person-{index + 1}.jpg'
            image.save(path)
            buffer = BytesIO()
            image.save(buffer, format='JPEG')
            avatar = buffer.getvalue()
            person = conn.execute('INSERT INTO persons(name,auto_clustered,face_count,face_thumbnail) VALUES(?,0,1,?)', (name, avatar)).lastrowid
            identities.append(person)
            conn.execute('INSERT INTO photos(path,filename,thumbnail) VALUES(?,?,?)', (str(path), path.name, avatar))
            face = conn.execute('INSERT INTO faces(photo_path,face_index,embedding,person_id,face_thumbnail) VALUES(?,0,?,?,?)', (str(path), bytes(2048), person, avatar)).lastrowid
            conn.execute('UPDATE persons SET representative_face_id=? WHERE id=?', (face, person))
        # One unassigned fictional face lets the whole creation/assignment flow be tried.
        image = Image.new('RGB', (320, 320), (95, 80, 120))
        ImageDraw.Draw(image).text((160, 160), '?', font=ImageFont.load_default(size=120), anchor='mm', fill='white')
        path = root / 'fictional-unassigned.jpg'
        image.save(path)
        buffer = BytesIO()
        image.save(buffer, format='JPEG')
        avatar = buffer.getvalue()
        conn.execute('INSERT INTO photos(path,filename,thumbnail) VALUES(?,?,?)', (str(path), path.name, avatar))
        conn.execute('INSERT INTO faces(photo_path,face_index,embedding,face_thumbnail) VALUES(?,0,?,?)',
                     (str(path), bytes(2048), avatar))
        for source, target, kind in ((0, 2, 'parent'), (1, 2, 'parent'), (0, 1, 'partner'), (0, 3, 'coworker'), (0, 3, 'friend'), (0, 4, 'friend'), (2, 5, 'friend')):
            add_connection(conn, identities[source], identities[target], kind, '')
        conn.executemany('INSERT INTO people_groups VALUES(?,?,?,?)', [('family', 'Family', None, ''), ('children', 'Children', 'family', ''), ('friends', 'Friends', None, ''), ('work', 'Coworkers', None, '')])
        conn.executemany('INSERT INTO people_group_members VALUES(?,?)', [('family', identities[0]), ('family', identities[1]), ('children', identities[2]), ('friends', identities[3]), ('work', identities[3])])
        assign_path(conn, str(root / 'fictional-person-1.jpg'), ['Places', 'Home'], created_by='')
        assign_path(conn, str(root / 'fictional-person-4.jpg'), ['Activities', 'Work'], created_by='')
        conn.execute('INSERT INTO people_private_notes VALUES(?,?,?)', (identities[0], '', 'Fictional demo profile. These images are generated initials, not detected faces.'))
    print(f'Disposable demo: {root}', flush=True)
    print(f'Graph URL: http://127.0.0.1:{args.port}/people-graph', flush=True)
    if args.serve:
        if not (repo / 'client/dist/client/browser/index.html').exists():
            parser.error('Build the client before serving: cd client && npm run build')
        result = subprocess.run([sys.executable, str(repo / 'viewer.py'), '--production', '--host', '127.0.0.1', '--port', str(args.port)], cwd=repo, check=False)
        if result.returncode not in (0, -signal.SIGTERM, -signal.SIGINT):
            raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
