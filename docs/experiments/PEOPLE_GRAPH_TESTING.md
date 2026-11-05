# Testing the local people graph experiment

This branch is local-only. The demo uses a newly created temporary directory,
fictional people and generated initial images, including one unassigned portrait
for face-assignment practice. It never loads an existing photo
library or the user’s configuration. Each invocation creates an independent demo.
The images are interface fixtures, not detected faces or recognition examples.

## Launch

From this worktree, using the project’s Python environment:

```sh
cd client
npm ci
npm run build
cd ..
/path/to/facet/venv/bin/python scripts/people_graph_demo.py --serve --port 5071
```

Open `http://127.0.0.1:5071/people-graph`. The launcher prints the exact temporary
root containing `demo.db`, `config.json` and the generated images. It binds only to
loopback and enables trusted local editing for that disposable configuration.
Stop with Ctrl+C. Keep the printed root if you want to inspect the results; delete
that specific temporary directory when finished. No automatic reset touches a
previous run.

## Create your own fictional examples

The fresh demo for this session is at `http://127.0.0.1:5073/people-graph`.
The existing demo on 5071 is preserved. Port 5001 continues to use its existing
application and database; this experiment is not connected to it.

1. Choose **New person**, enter a name and save. The profile opens for private
   notes, connections and group membership. Reuse existing identities when they
   already represent the person. **Rename person** changes the display name.
2. Choose **Assign faces** to open Persons → Unassigned. The demo includes one
   generated `?` portrait. Choose the new person, tick the face, preview and confirm.
   Return to Connections: it is the same identity, now with a portrait.
3. Choose **New group**. Create Family, then Children with Family as its parent.
   Add members from their profiles. Add the same person to Friends and Coworkers
   to try overlapping membership.
4. Choose **Add connection**. Choose another person and type. For parent/child,
   use Direction and read the preview sentence before saving. Use Custom
   relationship for forward/reverse labels such as Mentor of / Learner of.
5. Use optional dates for relationships that change. Invalid dates, duplicate
   relationships and ancestry cycles leave the form available for correction.

In multi-user mode, a new identity without a visible face remains outside the
person directory. The creation message explains that requirement. Read-only users
see browsing guidance without edit actions. Graph creation never scans images.

## Try these workflows

1. Start in **Hierarchy**. Groups and people are collapsed. Expand Family,
   Children and Jordan to follow connections without exposing a profile or notes.
   Overlapping memberships show the same identity in each relevant branch.
2. Use a person's **Open profile** action for notes and editing. Close profile to
   return to browsing. Expanding a person alone does not fetch private notes.
3. Switch to **Graph view**. Select Alex in the sidebar; Morgan appears once,
   with friend and coworker connections. Increase connection depth to explore
   indirect relationships. Hover or focus a portrait for relationship labels.
4. Watch the organic layout settle, gently drift, and light travel along curved links.
   Drift is bounded to six horizontal/four vertical graph units, pauses while the
   pointer is over the graph, during gestures and keyboard use, and in hidden tabs.
   Manually moved people remain pinned. Use
   Pause motion, drag portraits (including the central person), drag the background
   to pan, and scroll or pinch the background to zoom. Fit graph frames the current
   arrangement; Reset layout restores automatic positions. Manual positions survive
   profile refreshes and mode switches for this page session, and clear on account
   change or page reload. Reduced-motion settings disable the
   layout motion and moving lights; keyboard-driven navigation stays immediate.
5. Write a private note, switch people, then return. The draft remains. Save it,
   reload, and check persistence. Shared logins share one identity; separate private
   notes require separate user accounts.
6. Add a relationship or a custom directional type such as Mentor of / Mentee of.
   Optional dates persist. Duplicate edges and ancestry cycles refuse safely.
7. Put someone into two groups. Create nested groups and manage their names or
   parents. Confirm deletion: people/photos remain and child groups move up.
8. Use View photos and return. Browser Back/Forward restore selected profiles.
   Tags remain available in the graph sidebar for browsing keyword branches.
9. Use the People page's established naming/face-assignment workflow. The graph
   references those same identities; no migration or library reset is required.

## Persistence boundaries

Relationships and memberships are shared within existing photo visibility rules;
notes are author-scoped. Group structure is edited by its creator with edition
permission. Both endpoints of a connection must be visible. Empty profiles remain
subject to Facet’s existing multi-user face visibility rules.

Graph information stays in the database. Image/XMP writers retain their existing
keyword and face-region behavior. Private notes are excluded from full viewer
exports and never imported from another database. Incremental shared graph import
is additive: destination UUID records win, and source deletions do not erase local
organization. Back up the SQLite database to preserve the complete local graph.

The demo is for testing this experimental branch. It does not make the feature a
supported production schema or authorize using the user’s photo library.

### D3 interaction verification (05/11/2026)

- 22 focused client tests pass, including link endpoints, manual-position retention,
  reset and account-change cleanup. Application and spec TypeScript checks and
  focused ESLint pass. Production build passes with the existing initial-bundle
  budget warning.
- Chrome mouse/touch checks on the separate disposable demo verify node and central
  person dragging, click suppression, background panning, wheel zoom, accurate
  dragging after camera transforms, profile/mode retention, Fit, Reset layout,
  touch dragging and two-finger background pinch. No browser errors.
- The graph uses pinned d3-drag, d3-selection and d3-zoom 3.0.1 packages. Gesture
  positions are never sent to the backend.

### Creation and ambient motion verification (05/11/2026)

- 31 focused client tests pass; 21 graph/domain/API/demo backend tests pass.
  Both TypeScript projects, focused ESLint and the production build pass. The
  pre-existing initial-bundle warning remains.
- Chrome end-to-end checks persist people, names, nested groups, overlapping
  memberships, both relationship directions, custom types, dates and private
  notes. Motion continues after settling, pauses on hover/Pause/reduced motion,
  and leaves dragged nodes pinned.
- Deferred-response and failure tests cover account switches, changing selection
  during group creation, and successful POST followed by refresh failure. The
  completed create form closes before refresh so retry cannot duplicate the item.
- Independent reviews covered all ten review-all axes across three Codex reviewers;
  a fresh verifier confirmed the creation-race fixes and independently passed all
  21 component specs. This used the Codex adaptation, not the Claude plugin.

- The complete browser face workflow passed: graph creation → Assign faces →
  choose identity → select → preview → confirm → graph portrait, with persisted
  face_count=1. Only an added test face was assigned; original six assignments
  and original image hashes were unchanged.
- Mouse/touch pan/zoom and expandable hierarchy regressions pass on a fresh
  independent fixture. The 5073 user demo remains at six people and one unassigned
  portrait. Expected SIGTERM/SIGINT shutdown of a demo child exits without a
  launcher traceback; other failures retain their nonzero status.

### Graph-first redesign review (05/11/2026)

The redesigned fictional demo is at http://127.0.0.1:5075/people-graph.
Earlier demos and port 5001 remain unchanged. The new demo uses clearly legible
generated initials, not photographs.

The user-supplied screenshot was rated 4/10 for its small graph, stacked toolbars,
tiny labels and long inspector. Four design passes followed, including independent
desktop/laptop/phone screenshot reviews and fixes for each demonstrated blocker.

| Review check | Evidence |
| --- | --- |
| Canvas dominates the workspace | SVG fills the available desktop, laptop and phone workspace instead of a short fixed card |
| Controls are grouped | One page header, contextual filters, compact canvas controls |
| Names are readable | Screen-aware text sizing and two-line bounds; all six fixture names fit at 1280×800 and 390×844 |
| Labels stay clear | Card collision separation and reserved control-safe fitting |
| Relationship meaning is visible | Direct connections carry role labels; inspector describes the other person's role relative to the selection |
| Inspector has one task at a time | Connections, Groups and Notes sections; composer opens on request |
| Phone preserves graph context | roughly 140px person peek; explicit Show details expands the inspector |
| Expanded inspector is accessible | CDK focus trap, modal semantics, Escape dismissal and focus restoration checked in Chrome |
| Nested creation works | Groups → New group releases the sheet, focuses the visible form, then Escape restores the sheet and trigger |
| Editing and gestures remain intact | Person/group/type/edge/note browser persistence and mouse/touch gesture regressions pass |

The checklist records concrete acceptance checks, not a universal claim that visual
taste can be proven by tests. Very dense neighborhoods and arbitrary long custom
labels still require zooming/filtering or opening the full profile.

Hallmark render-lint was also attempted on exported rendered DOM. It was not a
clean lint pass: the exported file could not load every app font/style in its file
origin. Its new search-field contrast finding was addressed with the stronger
theme outline, and page buttons now use 44px minimum hit boxes and explicit
disabled fill/text/cursor states. Existing Material/Tailwind generated color,
shadow, disabled-menu and spacing findings are waived for this locked application
design system. Landing-page stamp, centered hero, headline-size, word-count,
hero-alignment and section-count rules do not describe this full-width app
workspace; those findings are waived. The font-family count included numeric
font weights and is a parser false positive. Actual served-app screenshots and
browser interaction checks provide the rendering evidence.

Final redesign gates: 34 focused client tests, application/spec TypeScript checks,
focused ESLint, production build, demo fixture isolation test and Ruff pass. The
existing initial-bundle warning remains (1.67 MB against a 1.60 MB warning budget).
Chrome rechecked all six fixture names and control clearance, inspector sections,
keyboard-modal behavior, nested group creation/cancellation, creation-menu focus,
full editing persistence, hierarchy and mouse/touch gestures. No browser errors.
