# Facet workspace screenshots · 4 November 2026

Before: upstream master `73c3212ee8609634603b048c7dfe6265bba321ff`.
After: PR #455 client `8157b1d1f58c871cf2b3db046a0c597d3957b80b`.

The before and after servers use equivalent, disposable copies of the same sample library. Phone captures show both notice stacks collapsed, so their timing is matched. Desktop captures use a 1440 × 900 CSS viewport; phone captures use 390 × 844. Both use dark mode, aggregate sort, grid layout and a 240px thumbnail setting. Browser screenshot scaling determines the exported pixel dimensions recorded in manifest.json.

- gallery-comparison.png: matched desktop galleries, with navigation, collection and photo-frame callouts.
- photo-comparison.png: the same Coast 004 photo; the PR collection sidebar is expanded to 320px.
- phone-comparison.png: matched phone galleries.
- comparison-workspace.png: the new read-only comparison workspace at 2.3× linked zoom, with reference, candidate queue and viewport overview callouts.
- preview-workflows.png: detail crops of the rating preview and a successful two-file culling dry-run. These are two different dialogs, not a before/after pair. Both were cancelled; no rating or file operation was applied.

Numbered outlines, arrows, captions and cropping are presentation annotations over unmodified browser screenshots. Original viewport captures and native dialog-element captures are in [raw/](raw/). SHA-256 hashes and dimensions are in [manifest.json](manifest.json).

The sample photos are licensed Unsplash images; see [photo-credits.json](../photo-credits.json) and the [Unsplash license](https://unsplash.com/license). Filenames, dates, scores and decisions are synthetic fixture data, not model evaluations. A RAW placeholder exercises companion handling. Gallery counts differ because the PR groups that RAW/JPEG pair as one logical photo. No private library images or account data are included. Temporary paths visible in the culling dialog belong to the disposable fixture.

These media assets are stored separately from the application PR diff.
