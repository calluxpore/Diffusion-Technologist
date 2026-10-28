# LoRA Archive

My personal portfolio for the LoRA models I have trained.

Hosted on GitHub Pages and connected to my main website: https://portfolio-5208db.webflow.io/

The visual language matches my other sites — [calluxpore.github.io](https://calluxpore.github.io/)
and the [Teaching Portfolio](https://calluxpore.github.io/Teaching-Portfolio/) — sharing the same
warm-paper / burnt-sienna palette in light mode, near-black / amber in dark, set in Newsreader
with JetBrains Mono for the interface chrome.

## What this site does

- **Search** across model names, categories and base models (press `/` to jump to the field)
- **Filter** by category and by base model, with live counts that update against the other
  active filter so dead-end combinations are visible before you click them
- **Shareable URLs** — every search and filter is reflected in the query string
- Category sections with counts, plus a "Most Recent" shelf
- Model cards with a static poster and a video preview that only downloads once the card
  approaches the viewport
- Cards are real links, so middle-click and open-in-new-tab work as expected
- Smooth scrolling, with cards and section headers easing into view as you reach them
- Light/dark theme that follows the system by default and remembers an explicit choice
- Responsive from 320px to ultrawide; keyboard accessible with visible focus rings and
  reduced-motion support

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Design tokens and all styling |
| `main.js` | Data loading, search, filtering, rendering, theme |
| `models.json` | The model list — the only file to edit when publishing a new model |
| `media/` | `<slug>.webp` poster and `<slug>.mp4` preview per model |

## Adding a model

Append an entry to `models.json` and drop `media/<slug>.webp` and `media/<slug>.mp4`
alongside it:

```json
{
  "name": "Display Name",
  "slug": "Media File Name",
  "category": "Art Styles & Techniques",
  "civitaiUrl": "https://civitai.com/models/...",
  "tags": ["Flux"]
}
```

`slug` must match the media filenames. `tags[0]` is shown as the badge on the card and
feeds the base-model filter. New categories appear automatically; to control where one
sits in the filter bar, add it to `CATEGORY_ORDER` in `main.js`. The "Most Recent" shelf
is the `RECENT_MODELS` list in the same file.

## Local preview

```bash
npx http-server . -p 4173 -c-1
```
