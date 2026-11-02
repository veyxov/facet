# Facet workspace redesign review images

Actual browser captures for the upstream UI review PR. These images are kept
on a separate media branch so they do not add binary files to the application
diff. The application source was not modified for these screenshots.

Before: upstream master at `c4f3f88a77017865d52bd13767f877e9fda39e53`.
After: consolidated redesign at `23a84a2da0b729514263ebd2d3711f57edf395a0`.

Desktop captures use a 1440 × 900 CSS viewport. Phone captures use 390 × 844.
Both versions use dark mode, the same 240px thumbnail setting, aggregate sort,
and equivalent copies of the sample library. Other settings start from their
application defaults. The collection sidebar is expanded to two columns in the
after photo-detail capture. The comparison is in linked two-up mode at 1.5×.

Photos are public sample imagery under the [Unsplash license](https://unsplash.com/license).
Original image URLs and hashes are in [photo-credits.json](photo-credits.json).
Filenames, scores, dates, stars and review decisions are synthetic fixture data,
not results of analyzing those photos. A RAW transport placeholder exercises
companion handling; it is not a camera RAW sample. Gallery count differences
reflect the redesign grouping that RAW/JPEG pair as one photo. Detail sets keep
every physical file.

No private photo library, user database or credentials are included. Culling
and rating captures stop at Preview/Cancel; no file operation was applied.

Screenshot files are unchanged PNG captures. See [manifest.json](manifest.json)
for source revisions and checksums.
