# Facet workspace screenshots · 4 November 2026

Before: upstream master `73c3212ee8609634603b048c7dfe6265bba321ff`.
After: PR #455 client `bdd9067dc93fa8c229374c48f191e30e71c3f161`.

The before and after servers use equivalent, disposable copies of the same sample library. Phone captures show both notice stacks collapsed, so their timing is matched. Desktop captures use a 1440 × 900 CSS viewport; phone captures use 390 × 844. Both use dark mode, aggregate sort, grid layout and a 240px thumbnail setting. Browser screenshot scaling determines the exported pixel dimensions recorded in manifest.json.

- gallery-comparison.png: matched desktop galleries, with navigation, collection and photo-frame callouts.
- photo-comparison.png: the same Coast 004 photo; the PR collection sidebar is expanded to 320px.
- phone-comparison.png: matched phone galleries.
- comparison-workspace.png: the new read-only comparison workspace at 2.3× linked zoom, with reference, candidate queue and viewport overview callouts.
- preview-workflows.png: detail crops of the rating preview and a successful RAW/JPEG culling dry-run for one selected photo affecting two files. The rating preview shows two photos with observed 3- and 4-star values and a proposed 2-star edit. The culling preview shows one selected logical photo and both affected physical files, including the unavailable RAW thumbnail fallback. These are two different dialogs, not a before/after pair. Both were cancelled; no rating or file operation was applied.

Numbered outlines, arrows, captions and cropping are presentation annotations over unmodified browser screenshots. Original viewport captures and native dialog-element captures are in [raw/](raw/). SHA-256 hashes and dimensions are in [manifest.json](manifest.json).

The sample photos are licensed Unsplash images; see [photo-credits.json](../photo-credits.json) and the [Unsplash license](https://unsplash.com/license). Filenames, dates, scores and decisions are synthetic fixture data, not model evaluations. A RAW placeholder exercises companion handling. Gallery counts differ because the PR groups that RAW/JPEG pair as one logical photo. No private library images or account data are included. Temporary paths visible in the culling dialog belong to the disposable fixture.

These media assets are stored separately from the application PR diff.

All after images were recaptured from the final client build. Both dialogs were cancelled; the destination stayed empty and the original 3- and 4-star values were verified unchanged.
