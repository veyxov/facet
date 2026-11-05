# People graph experiment — design for discussion

Status: implementation accepted by the user on 05/11/2026; private notes default.

## Product

A portrait-led graph for exploring people, overlapping groups, typed relationships,
and notes, with existing photo browsing and face assignment within reach.
The user prefers flexible connections over a rigid tree and permits a fresh
experimental dataset rather than migrating their nearly completed assignments.
That does not authorize deleting or resetting the original library.

## References

- IMatch People: https://www.photools.com/help/imatch/content/en/topics/people.htm
  Separate person identities, multiple families/groups, custom relationship types.
- IMatch Albums: https://www.photools.com/help/imatch/content/en/topics/albums.htm
  Visual relationship presentation and spatial organization.
- Monica: https://www.monicahq.com/en/features/
  Person profiles with relationships and private notes.
- Obsidian: https://obsidian.md/help/plugins/graph
  Focused neighborhoods, adjustable depth, search and filters.
- digiKam People: https://docs.digikam.org/en/left_sidebar/people_view.html
  Face tags differ from ordinary whole-image tags.
- digiKam Tags: https://docs.digikam.org/en/left_sidebar/tags_view.html
  A tag has one position in the tree; photos can have many tags.

These support borrowing different interaction patterns, not a claim that any one
application implements the proposed Facet feature in full.

## Current source constraints

- `db/schema.py`: persons have integer IDs and person_key; faces reference person_id.
- `api/routers/persons.py`: reads use photo-directory visibility; edits require
  edition permission. Empty assignment targets have special handling.
- Person merge paths delete source identities after reassignment. Graph links and
  notes must be moved transactionally, with duplicate/self-edge handling, before
  graph integration is complete. Delete and split behavior also need explicit tests.
- `db/keyword_hierarchy.py`: existing shared keyword tree and photo assignments.
  Preserve this taxonomy; group membership is a separate concept.
- `api/keyword_tree.py`: only visible assignments and required ancestors are read.
- `docs/INTEROP.md`: hierarchical keywords already round-trip; named MWG face
  regions are exported but not re-imported. Relationship graph data must not
  silently become exported keywords or face regions.
- `db/maintenance.py`: viewer export explicitly excludes private operational
  tables and has incremental identity reconciliation. Existing tests in
  `tests/test_viewer_db_export.py` exercise person_key collisions and viewer-local
  edits. New graph records need stable-key mapping through this flow, not a raw
  copy of source integer person IDs.
- `db/relink.py`: unregistered tables/columns can cause dependency validation to
  refuse relinking. Register the new schema even when it contains no photo paths,
  and verify relinking remains usable after graph initialization.

## Proposed data semantics

1. Person profiles reference existing person identities; no duplicate identities
   are created because a person appears in several groups or graph locations.
2. Group membership is many-to-many. Groups can have nested organization with
   cycle validation. Membership never implies a family relationship.
3. Relationship types have forward/reverse labels and a mutual/directional flag.
   Defaults: parent/child, sibling, partner, friend, coworker. Custom labels allowed.
   Store one canonical edge for a mutual relationship; support multiple types
   between the same people. Reject self-links and exact duplicates.
4. Do not infer sibling, partner, gender, or biological relationships. Parent
   connections must reject ancestry cycles without restricting ordinary graph cycles.
5. Optional start/end dates allow changing social connections without deleting history.
6. Notes are plain text initially. Proposed default: private to their author;
   shared notes remain an explicit unresolved product choice.

## Interface

The revised presentation follows the user's Gource reference and explicit request
for a collapsed hierarchy. It preserves Facet's theme tokens and Tailwind system.

- **Hierarchy** is the default: nested groups, overlapping person references,
  lazy connection expansion, cycle-safe traversal, retry and Collapse all.
- Profiles, private notes and edit forms remain closed until Open profile is
  requested. Merely expanding people does not fetch notes.
- **Graph view** uses a deterministic organic force layout, curved semantic links,
  portrait nodes, soft light, interruptible settling and optional moving lights.
  Pause/resume and system reduced-motion preferences control movement.
- Pan/zoom/fit and one-to-three-hop exploration remain available. Camera bounds
  fit the current people rather than a fixed radial grid. Relationship filtering
  applies within the explored neighborhood.
- Keyboard navigation avoids position animation. The hierarchy remains usable
  independently of the animated visualization, including on narrow screens.
- The graph sidebar retains tag hierarchy navigation and person search. Explicit
  profiles retain photos, private notes, typed connections and group management.
- Loading, empty, failed-save, retry, permission and stale-account states are required.

## Privacy and lifecycle

Shared visibility follows existing accessible-photo scope; edition users edit.
An edge is readable only when both endpoints are readable. Counts, search,
thumbnails, group names and graph traversal must not reveal hidden endpoints.
Empty profiles need explicit ownership/scope before exposing them to multiple users.
Notes require separate author checks if private. Identity changes clear scoped caches.

Merge transfers graph records transactionally; split does not guess which personal
relationships move. Deleting group membership does not delete people or photos.
Viewer database export and relinking must classify all new tables explicitly.
Private notes are excluded from shared viewer exports. Graph backup/import requires
stable identities and validation; it must not use display names as identity keys.

## Implementation sequence and intended areas

1. Finalize privacy and accept this design.
2. Add schema/domain helpers and disposable-fixture backend tests in `db/` and `tests/`.
3. Add authenticated graph/profile APIs in `api/models/`, `api/routers/`, register
   routes and update pinned authorization sets and generated OpenAPI contracts.
4. Add graph/list/profile UI under `client/src/app/features/persons/`, navigation
   integration and API service methods. Inspect exact services before editing.
5. Integrate merge/delete/split, viewer export and relinking; preserve metadata writers.
6. Update all seven language files and affected guides; apply Hallmark app-screen
   craft and Unslop copy review within the existing design system.
7. Run backend tests, client suites, both TypeScript projects, lint, schema generation
   and production build. Review accessibility and error/cancellation/retry paths.
8. Provide a local launch command with an explicitly disposable database/image root,
   fictional sample people and clear user test steps. Never launch against the
   user's configured library by default.

## Acceptance evidence

Tests must prove actual persisted rows and API authorization, including overlapping
membership, reverse labels, mutual-edge uniqueness, custom labels, date validation,
ancestry-cycle refusal, private notes, hidden endpoints and counts, merges, deletion,
rollback, repeat initialization and reload. Client tests cover graph/list parity,
keyboard controls, failed saves, retries, route/account changes and focus recovery.
Disposable image/metadata checks establish unchanged original bytes and existing
keyword/face export behavior. Record exact commands and tested SHA/diff locally.

## Accepted decision

Notes are private to the signed-in identity. The user authorized implementation
with this default. Shared logins share an identity; separate private notes require
separate accounts.

### Direct manipulation

D3 drag and zoom provide node dragging, background panning, wheel zoom and
two-finger background pinch. SVG content remains Angular-rendered. D3 owns only
the world camera transform and gesture listeners. Node positions are session-only,
identity-cleared overrides; Fit keeps them, Reset layout clears them. Dragging
suppresses accidental click navigation. No photo or library writes are involved.

### Ambient motion and creation actions

Unpinned neighbors gently drift within six horizontal/four vertical SVG units.
The selected person stays anchored. Drift freezes on hover, gestures, keyboard
use, hidden tabs, Pause and reduced motion; dragged positions stay pinned.
An outside-Angular animation loop updates at most about 30 times per second and
is cancelled on teardown. Edges use the same displayed positions as portraits.

Global New person/New group/Add connection actions work from the collapsed
hierarchy and from empty single-user libraries. Creation reuses existing API
contracts and visibility rules. Person profiles offer rename, private notes and
a link to the existing preview/confirm face-assignment workflow. Nested group
creation has an explicit parent; membership remains independent of relationships.
Connection direction is previewed as a sentence. Known date/duplicate/ancestry
errors provide specific correction guidance. Successful creation is acknowledged
before refresh, preventing duplicate submissions when refresh fails.

The user chose fictional data only on 05/11/2026. Port 5001 and its database remain
unchanged; no migration or real-library runtime was started.

### Graph-first composition

Following the user's screenshot critique, the screen now has one compact header,
a quieter people rail, a full-height canvas and a focused inspector. Editing lives
behind Connections/Groups/Notes sections instead of a continuously visible form.
Mobile selection opens a compact peek; expanding it creates a focus-trapped modal
sheet with Escape and return-focus behavior. New group temporarily releases that
sheet and returns to it after cancellation or creation.

SVG fitting measures the viewport and reserves space for controls and the phone
peek. A bounded final collision pass separates portrait/name cards, while text size
adapts to the fit scale. Direct relationship roles remain visible. Existing photo
visibility, notes ownership and backend contracts remain unchanged.
