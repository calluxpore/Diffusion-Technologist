# LoRA Archive

My personal portfolio for the LoRA models I have trained.

Hosted on GitHub Pages and connected to my main website: https://portfolio-5208db.webflow.io/

The page is laid out as a contact sheet: every model is a frame, set in strict rows by subject,
with one enlarged frame beside the sheet for whatever the pointer rests on. Putty and black with a
single teal accent, set in Libre Franklin (names and interface) and Source Serif 4 (reading), both
from Google Fonts. The hero is a black field in both themes so the posters are its only colour.

## What this site does

- **Search** across model names, categories and base models (press `/` to jump to the field)
- **Filter** by category and by base model, with live counts that update against the other
  active filter so dead-end combinations are visible before you click them
- **Shareable URLs**: every search and filter is reflected in the query string
- A hero strip of posters wider than the screen, shuffled on every visit: drag or swipe it, and
  the frame that comes to rest in the middle is lit and plays its preview
- "Newest weights": the newest model lifted out of a run of the recent ones
- The archive: one run of frames per category, with an enlarged preview (poster, loop, type,
  base models, Civitai link) that follows the pointer or keyboard focus. Phones fold each run to
  two rows behind a "Show all" link while nothing is filtered
- The Civitai badges under the hero paragraph: pictures only, each named in the line beneath
  it on hover or keyboard focus
- A short about section and a contact close
- A compact pinned toolbar: search and filters inline on desktop, with the chips folded behind a
  Filters button on phones and tablets
- Video previews play on hover or focus, and in the middle of the hero strip. Each `.mp4`
  downloads only the first time it is wanted, and Data Saver or reduced motion keep to posters
- Base-model tags get readable names in the UI (`ZIT` → Z-Image Turbo) via `BASE_LABELS` in
  `main.js`; the raw tag stays in `models.json` and in URLs
- Frames are real links, so middle-click and open-in-new-tab work as expected
- Headings, rows and frames arrive in reading order as you reach them
- Light/dark theme that follows the system by default and remembers an explicit choice
- Responsive from 320px to ultrawide; keyboard accessible with visible focus rings and
  reduced-motion support

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Design tokens and all styling |
| `main.js` | Data loading, search, filtering, rendering, theme |
| `models.json` | The model list, and the only file to edit when publishing a new model |
| `media/` | `<slug>.webp` poster and `<slug>.mp4` preview per model |
| `badges/` | Civitai badge emblems (transparent WebP) shown under the hero paragraph |

## Adding a model

Append an entry to `models.json` and drop `media/<slug>.webp` and `media/<slug>.mp4`
alongside it:

```json
{
  "name": "Display Name",
  "slug": "Media File Name",
  "category": "Art Styles & Techniques",
  "type": "style",
  "civitaiUrl": "https://civitai.com/models/...",
  "tags": ["Flux"]
}
```

`slug` must match the media filenames. Every tag in `tags` is listed in the preview and
feeds the base-model filter. `type` is `character`, `style` or `concept`: it names the
LoRA type in the preview and feeds the "LoRA" filter. New categories appear automatically; to
control where one sits, add it to `CATEGORY_ORDER` in `main.js`. The curated lists live in the
same file: `RECENT_MODELS` (the newest run, first one lifted), `FAVOURITE_MODELS` (the "My Favourites" filter)
and `STRIP_MODELS` (the hero strip).

## Local preview

```bash
npx http-server . -p 4173 -c-1
```
