"""The demo creates only independent fictional assets, never a configured library."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys


def test_demo_ignores_user_library_and_configuration(tmp_path):
    private = tmp_path / 'private-library.db'
    private.write_bytes(b'library-must-not-be-opened')
    configuration = tmp_path / 'private-config.json'
    configuration.write_text('{invalid-private-config', encoding='utf-8')
    before = private.read_bytes(), configuration.read_bytes()
    env = {**os.environ, 'DB_PATH': str(private), 'FACET_CONFIG': str(configuration)}
    result = subprocess.run([sys.executable, 'scripts/people_graph_demo.py'], env=env,
                            check=True, capture_output=True, text=True, encoding='utf-8')
    root = Path(result.stdout.split('Disposable demo: ', 1)[1].splitlines()[0])
    try:
        assert before == (private.read_bytes(), configuration.read_bytes())
        config = json.loads((root / 'config.json').read_text(encoding='utf-8'))
        assert config['users']['shared_directories'] == [str(root)]
        assert config['viewer']['trusted_local_editing'] is True
        with sqlite3.connect(root / 'demo.db') as conn:
            assert conn.execute('SELECT COUNT(*) FROM persons').fetchone()[0] == 6
            assert conn.execute('SELECT COUNT(*) FROM people_connections').fetchone()[0] == 7
            assert conn.execute('SELECT COUNT(*) FROM faces WHERE person_id IS NULL').fetchone()[0] == 1
            assert conn.execute('SELECT COUNT(*) FROM photo_keyword_nodes').fetchone()[0] == 2
            for (image,) in conn.execute('SELECT path FROM photos'):
                assert Path(image).parent == root
                assert Path(image).is_file()
    finally:
        import shutil
        shutil.rmtree(root)
