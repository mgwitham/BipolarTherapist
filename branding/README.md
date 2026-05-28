# Branding assets

Social profile images for BipolarTherapyHub. SVG sources + ready-to-
upload PNGs at the dimensions each platform expects.

## What's here

| File                          | Size     | Use                         |
| ----------------------------- | -------- | --------------------------- |
| `twitter-avatar.svg` / `.png` | 400×400  | Twitter / X profile picture |
| `twitter-header.svg` / `.png` | 1500×500 | Twitter / X header banner   |

The PNGs are the upload-ready files. The SVGs are the source of
truth — edit them if you want to change the wordmark, tagline, or
mark, then regenerate the PNGs with the commands below.

## Design notes

The visual language extends the existing favicon:

- **Brand mark**: two overlapping rounded squares in teal (`#4A9B8E`)
  and muted purple (`#8B7BA3`). The overlap is a quiet reference to
  the dual poles in bipolar without being clinically illustrative.
- **Palette**: cream `#F7F4EF` background, brand teal `#26667A` for
  links/accents, slate `#3A5B65` for body, dark teal `#1C4D5C` for
  the wordmark.
- **Typography**: DM Serif Display for the wordmark (matches the
  site headings), DM Sans for taglines (matches the body).
- **Tagline copy**: "Not every therapist gets bipolar. These do." —
  the patient-facing voice the founder has explicitly validated
  (see `feedback_copy` memory). No em-dashes, no clinician
  marketing.

### Layout choices on the header

The header layout reserves specific zones because Twitter overlays
UI on top of the header in predictable spots:

| Zone                             | Why it's reserved                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bottom-left** (~280px circle)  | Twitter pins the profile avatar overlay here. Any content under it is hidden, so this is left as empty cream gradient.                                                                |
| **Far left/right edges** (~50px) | Twitter occasionally crops the sides a little tighter than 1500px wide depending on the surface (timeline preview, edit-media flow). Important content stays inside ~x=100 to x=1400. |
| **Top edge** (~50px)             | Mobile crops the top slightly. Wordmark sits at y=170 (inside the middle band) so mobile center-crop keeps it.                                                                        |

Net effect: wordmark, tagline, and URL are centered horizontally and
positioned in the upper half. The mark sits in the top-right as a
quiet balance point. The bottom-left avatar zone is open background.

## Regenerating PNGs from the SVGs

The SVGs render on macOS via `qlmanage` (QuickLook, ships with the
OS). The header SVG's viewBox is 1500×1500 (square) with content
positioned in the middle band — necessary because `qlmanage`
outputs square thumbnails regardless of source aspect; the
follow-up `sips` center-crop trims back to the final 1500×500.

```sh
cd branding

# Avatar (400×400, natively square — no crop needed)
qlmanage -t -s 400 -o . twitter-avatar.svg
mv twitter-avatar.svg.png twitter-avatar.png

# Header (1500×500, center-cropped from the square render)
qlmanage -t -s 1500 -o . twitter-header.svg
mv twitter-header.svg.png twitter-header.png
sips -c 500 1500 twitter-header.png > /dev/null
```

## Uploading to Twitter / X

1. Open your profile → Edit profile
2. Click the avatar slot → upload `twitter-avatar.png`
3. Click the header slot → upload `twitter-header.png`
4. Twitter previews both. Click Save.

Twitter crops the avatar to a circle automatically — the SVG was
designed so the brand mark sits inside the circle-safe area. The
header has the mark + wordmark positioned to survive the avatar
overlap (bottom-left) and the mobile center-crop.
