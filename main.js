/* ==========================================================================
   LoRA Archive: application logic
   Loads models.json, fills the hero strip, the newest run and the contact
   sheet, and drives search + filters.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   Config
   -------------------------------------------------------------------------- */

const ALL = '__all__';
const FAVOURITES = 'My Favourites';

/* Curated "newest" run, newest first. The first one is lifted out of the run.
   Names must match models.json; anything missing is skipped silently so the
   run never breaks the page. */
const RECENT_MODELS = [
    'Clay Model',
    'Messy Type',
    'Meta Brown',
    'Old Me',
    'Temporal Shift',
    'Face Tattoos',
    'Industrial Design Anima Style Rendering',
    'HeptapodB',
    'Hallucination'
];

/* Curated favourites, offered as a filter in the archive. Names must match models.json. */
const FAVOURITE_MODELS = [
    'Industrial Design Anima Style Rendering',
    'HeptapodB',
    'Hallucination',
    'Brown Anime Portrait',
    'Journal Sketching',
    'Brown Bob Portrait',
    'Industrial Design X Marker Rendering',
    'Industrial Design X Sketch',
    'Cyberpunk X Robot',
    'Alien X Dravuun',
    'Alien X Zynthar',
    'Steampunk X Skull Mask',
    'Devanagari X Graffiti'
];

/* Posters for the hero strip. Their order is shuffled on every visit, so the
   frame that starts in the middle is different each time. */
const STRIP_MODELS = [
    'Industrial Design Anima Style Rendering',
    'HeptapodB',
    'Hallucination',
    'Journal Sketching',
    'Exclusion',
    'Neon X Drive',
    'Brown Anime Portrait',
    'Devanagari X Graffiti',
    'Cyberpunk X Robot',
    'Alien X Dravuun',
    'Clay Model',
    'Messy Type',
    'Steampunk X Skull Mask',
    'Industrial Design X Marker Rendering',
    'Temporal Shift'
];

const FAVOURITE_SET = new Set(FAVOURITE_MODELS);
const inFavourites = model => FAVOURITE_SET.has(model.name);

/** FAVOURITES is a virtual category: membership is the curated list, not model.category. */
const inCategory = (model, category) =>
    category === FAVOURITES ? inFavourites(model) : model.category === category;

function createHeartIcon(className, size) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svgNs, 'svg');
    icon.setAttribute('class', className);
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', String(size));
    icon.setAttribute('height', String(size));
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z');
    icon.appendChild(path);
    return icon;
}

/* Categories arranged alphabetically.
   Anything not listed here is appended alphabetically. */
const CATEGORY_ORDER = [
    'Anime & Fantasy',
    'Architecture',
    'Art Styles & Techniques',
    'Character & Portraits',
    'Fashion',
    'Industrial Design',
    'Sci-Fi & Cyberpunk',
    'Typography & Digital'
];

/* Display names for base-model tags. The raw tag stays in models.json and in
   shareable URLs; anything not listed here is shown as-is. */
const BASE_LABELS = {
    ZIT: 'Z-Image Turbo',
    ZImage: 'Z-Image'
};

const baseLabel = tag => BASE_LABELS[tag] || tag;
const baseList = model => model.tags.map(baseLabel).join(', ');

/* What a LoRA teaches the model. `type` in models.json is one of these keys. */
const LORA_TYPES = {
    character: { label: 'Characters', title: 'Character LoRA' },
    style: { label: 'Styles', title: 'Style LoRA' },
    concept: { label: 'Concepts', title: 'Concept LoRA' }
};

const typeTitle = model => (model.type ? LORA_TYPES[model.type].title : 'LoRA');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
const saveData = Boolean(navigator.connection && navigator.connection.saveData);

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */

const el = {
    grid: document.getElementById('models-grid'),
    loading: document.getElementById('loading'),
    empty: document.getElementById('empty'),
    error: document.getElementById('error'),
    search: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    resultCount: document.getElementById('result-count'),
    resetFilters: document.getElementById('reset-filters'),
    panelReset: document.getElementById('panel-reset'),
    emptyReset: document.getElementById('empty-reset'),
    categoryFilters: document.getElementById('category-filters'),
    baseFilters: document.getElementById('base-filters'),
    typeFilters: document.getElementById('type-filters'),
    toTop: document.getElementById('to-top'),
    toolbar: document.getElementById('toolbar'),
    filtersToggle: document.getElementById('filters-toggle'),
    filtersCount: document.getElementById('filters-toggle-count'),
    strip: document.getElementById('strip'),
    stripCaption: document.getElementById('strip-caption'),
    newestRun: document.getElementById('newest-run'),
    newestNote: document.getElementById('newest-note'),
    preview: document.getElementById('preview'),
    heroCount: document.getElementById('hero-count'),
    heroBases: document.getElementById('hero-bases'),
    badgeReadout: document.getElementById('badge-readout')
};

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */

let allModels = [];
const state = { query: '', category: ALL, base: ALL, type: ALL };

const hasFilters = () =>
    state.query !== '' || state.category !== ALL || state.base !== ALL || state.type !== ALL;

/* --------------------------------------------------------------------------
   Data
   -------------------------------------------------------------------------- */

async function loadModels() {
    const response = await fetch('models.json');
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    const models = await response.json();
    if (!Array.isArray(models)) {
        throw new Error('models.json must contain an array');
    }
    return models;
}

/** Pre-compute a lowercase haystack so filtering stays cheap on every keystroke. */
function prepare(models) {
    return models.map(model => {
        const tags = Array.isArray(model.tags) ? model.tags : [];
        // An unknown or missing type leaves the model untyped rather than breaking it.
        const type = LORA_TYPES[model.type] ? model.type : null;
        return Object.assign({}, model, {
            tags,
            type,
            category: model.category || 'Uncategorized',
            haystack: [model.name, model.slug, model.category, tags.join(' '), tags.map(baseLabel).join(' '),
                type || '', type ? LORA_TYPES[type].label : '']
                .join(' ').toLowerCase()
        });
    });
}

const byNames = (names, models) =>
    names.map(name => models.find(model => model.name === name)).filter(Boolean);

function orderedCategories(models) {
    const present = new Set(models.map(m => m.category));
    const ranked = CATEGORY_ORDER.filter(name => present.has(name));
    const rest = [...present].filter(name => !CATEGORY_ORDER.includes(name)).sort((a, b) => a.localeCompare(b));
    return ranked.concat(rest);
}

function orderedBases(models) {
    const counts = new Map();
    models.forEach(model => {
        model.tags.forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const posterPath = model => `media/${encodeURIComponent(model.slug)}.webp`;
const videoPath = model => `media/${encodeURIComponent(model.slug)}.mp4`;

/* --------------------------------------------------------------------------
   Video: previews play when the pointer rests on a model, or when the hero
   strip brings one to the middle. An .mp4 is only fetched the first time it
   is wanted. Data saver and reduced motion keep to posters unless asked.
   -------------------------------------------------------------------------- */

const canAutoplay = () => !saveData && !prefersReducedMotion.matches;

function startVideo(video) {
    if (video.dataset.failed === 'true') return;
    video.dataset.wanted = 'true';
    if (!video.src && video.dataset.src) {
        video.src = video.dataset.src;
    }
    playVideo(video);
}

function stopVideo(video) {
    video.dataset.wanted = 'false';
    video.classList.remove('is-playing');
    if (!video.paused) video.pause();
}

function playVideo(video) {
    // A slow download can finish after the pointer has already left.
    if (!video.src || video.dataset.failed === 'true' || video.dataset.wanted !== 'true') return;
    const attempt = video.play();
    if (attempt && typeof attempt.then === 'function') {
        // Autoplay can be refused (iOS Low Power Mode, data saver); the poster
        // stays visible underneath, so a rejection needs no handling.
        attempt.then(() => {
            if (video.dataset.wanted === 'true') video.classList.add('is-playing');
        }).catch(() => { });
    }
}

function createVideo(src, poster) {
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = 'none';
    if (poster) video.poster = poster;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('loop', '');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    if (src) video.dataset.src = src;

    video.addEventListener('loadeddata', () => playVideo(video));
    video.addEventListener('error', () => {
        // A shared preview video is reused for other models, so it is only
        // marked as failed for the source that failed.
        video.dataset.failed = 'true';
        video.classList.remove('is-playing');
    });

    return video;
}

/** Point a shared preview video at another model, keeping it stopped until asked. */
function retarget(video, model) {
    stopVideo(video);
    video.removeAttribute('src');
    video.load();
    video.dataset.failed = 'false';
    video.dataset.src = videoPath(model);
    video.poster = posterPath(model);
}

function createPoster(model, { lazy = true, alt } = {}) {
    const img = document.createElement('img');
    img.src = posterPath(model);
    img.alt = alt === undefined ? `Preview of the ${model.name} LoRA` : alt;
    if (lazy) img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    return img;
}

/**
 * The fallback tile sits behind the poster, so it only ever shows through
 * when the poster has nothing to paint.
 */
function guardPoster(img, media) {
    let retried = false;
    img.addEventListener('error', () => {
        if (!retried) {
            // A dropped request (a flaky connection, or one of 80-odd posters
            // losing its turn) should not blank the frame permanently.
            retried = true;
            setTimeout(() => { img.src = `${img.src.split('?')[0]}?retry=1`; }, 700);
            return;
        }
        img.hidden = true;
        if (media.querySelector('.card-media-fallback')) return;
        const fallback = document.createElement('div');
        fallback.className = 'card-media-fallback';
        fallback.textContent = 'No preview';
        media.appendChild(fallback);
    });
}

function linkTo(anchor, model, verb = 'Open') {
    const name = model.type ? `${model.name}, ${LORA_TYPES[model.type].title}` : model.name;
    if (model.civitaiUrl) {
        // A real link, so middle-click, open-in-new-tab and copy-link all work.
        anchor.href = model.civitaiUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.setAttribute('aria-label', `${verb} ${name} on Civitai`);
    } else {
        anchor.setAttribute('aria-label', name);
    }
}

/* --------------------------------------------------------------------------
   Entrance motion: reveal as each element scrolls into view
   -------------------------------------------------------------------------- */

/* Elements still waiting to arrive. An anchor link or a fast flick can jump
   clean over an element, which then never intersects, so anything above the
   bottom of the screen is shown on the next scroll whether it was seen or not. */
const pendingReveals = new Set();

const showReveal = element => {
    element.classList.add('in');
    pendingReveals.delete(element);
    if (revealObserver) revealObserver.unobserve(element);
};

const revealObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) showReveal(entry.target);
        });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 })
    : null;

let revealTicking = false;
window.addEventListener('scroll', () => {
    if (revealTicking || !pendingReveals.size) return;
    revealTicking = true;
    requestAnimationFrame(() => {
        revealTicking = false;
        pendingReveals.forEach(element => {
            if (!element.isConnected) {
                pendingReveals.delete(element);
            } else if (element.getBoundingClientRect().top < window.innerHeight) {
                showReveal(element);
            }
        });
    });
}, { passive: true });

/**
 * @param {number} stagger index within its group, so the parts of a section
 *   arrive in reading order rather than as one block.
 * @param {'reveal'|'reveal-frame'} kind text rises; frames settle from a scale.
 */
function reveal(element, stagger = 0, kind = 'reveal') {
    // Without an observer, or with motion turned down, show it outright, and
    // never leave content stranded at opacity 0.
    if (!revealObserver || prefersReducedMotion.matches) {
        element.classList.add(kind, 'in');
        return;
    }
    element.classList.add(kind);
    if (stagger) element.style.setProperty('--delay', `${(stagger % 8) * 70}ms`);
    pendingReveals.add(element);
    revealObserver.observe(element);
}

/** Static parts of the page, revealed in the order they are read. */
function revealStatic() {
    const groups = [
        ['#newest .newest-side > *'],
        ['#archive .archive-head > *'],
        ['#about .about-row > *'],
        ['#contact > *']
    ];
    groups.forEach(selectors => {
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach((node, index) => reveal(node, index));
        });
    });
}

/* --------------------------------------------------------------------------
   Hero strip: a row of posters wider than the screen. Whatever comes to rest
   in the middle is lit and plays; the rest wait in the dark.
   -------------------------------------------------------------------------- */

function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function buildStrip(models) {
    if (!el.strip) return;
    const picks = shuffle(byNames(STRIP_MODELS, models));
    if (!picks.length) return;

    picks.forEach((model, index) => {
        const frame = document.createElement('a');
        frame.className = 'strip-frame';
        frame.draggable = false;
        linkTo(frame, model);
        frame.style.setProperty('--i', String(Math.min(index, 8)));
        frame.dataset.name = model.name;
        frame.dataset.meta = `${typeTitle(model)} · ${baseList(model)}`;

        const img = createPoster(model, { lazy: index > 6, alt: '' });
        guardPoster(img, frame);
        frame.appendChild(img);

        const video = createVideo(videoPath(model), posterPath(model));
        frame.appendChild(video);

        const shade = document.createElement('span');
        shade.className = 'frame-shade';
        frame.appendChild(shade);

        frame.addEventListener('focus', () => {
            frame.scrollIntoView({ inline: 'center', block: 'nearest', behavior: prefersReducedMotion.matches ? 'auto' : 'smooth' });
        });

        el.strip.appendChild(frame);
    });

    // Start a few frames in, so posters run off both edges from the first paint.
    const start = el.strip.children[Math.min(3, el.strip.children.length - 1)];
    const centreOn = frame => {
        el.strip.scrollLeft = frame.offsetLeft + frame.offsetWidth / 2 - el.strip.clientWidth / 2;
    };
    centreOn(start);

    let ticking = false;
    el.strip.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            ticking = false;
            findCentre();
        });
    }, { passive: true });
    window.addEventListener('resize', findCentre, { passive: true });

    initStripDrag();
    findCentre();
}

let centreFrame = null;
let centreTimer;

function findCentre() {
    const middle = el.strip.getBoundingClientRect().left + el.strip.clientWidth / 2;
    let nearest = null;
    let distance = Infinity;
    for (const frame of el.strip.children) {
        const box = frame.getBoundingClientRect();
        const d = Math.abs(box.left + box.width / 2 - middle);
        if (d < distance) {
            distance = d;
            nearest = frame;
        }
    }
    if (nearest && nearest !== centreFrame) setCentre(nearest);
}

function setCentre(frame) {
    if (centreFrame) {
        centreFrame.classList.remove('is-centre');
        stopVideo(centreFrame.querySelector('video'));
    }
    centreFrame = frame;
    frame.classList.add('is-centre');
    el.stripCaption.replaceChildren(document.createTextNode(`${frame.dataset.name} `));
    const meta = document.createElement('span');
    meta.textContent = frame.dataset.meta;
    el.stripCaption.appendChild(meta);
    alignCaption(frame);

    // Wait for the row to settle, so flicking past ten posters fetches no video.
    clearTimeout(centreTimer);
    if (!canAutoplay()) return;
    centreTimer = setTimeout(() => {
        if (centreFrame === frame) startVideo(frame.querySelector('video'));
    }, 450);
}

/** The caption sits under the lit frame, aligned to its left edge. */
function alignCaption(frame) {
    if (window.matchMedia('(max-width: 40em)').matches) return;
    el.stripCaption.style.setProperty('--caption-w', `${frame.offsetWidth}px`);
}

/** With a mouse the strip can be pulled sideways; touch and trackpads scroll it natively. */
function initStripDrag() {
    let startX = 0;
    let startScroll = 0;
    let moved = false;
    let pointer = null;

    el.strip.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        pointer = event.pointerId;
        startX = event.clientX;
        startScroll = el.strip.scrollLeft;
        moved = false;
    });

    el.strip.addEventListener('pointermove', event => {
        if (event.pointerId !== pointer) return;
        const dx = event.clientX - startX;
        if (!moved && Math.abs(dx) > 5) {
            moved = true;
            el.strip.classList.add('is-dragging');
            el.strip.setPointerCapture(pointer);
        }
        if (moved) el.strip.scrollLeft = startScroll - dx;
    });

    const release = event => {
        if (event.pointerId !== pointer) return;
        pointer = null;
        // Dropping the class hands the row back to scroll snapping, which settles it.
        el.strip.classList.remove('is-dragging');
    };
    el.strip.addEventListener('pointerup', release);
    el.strip.addEventListener('pointercancel', release);

    // A drag that ends over a poster is not a click on it.
    el.strip.addEventListener('click', event => {
        if (moved) {
            event.preventDefault();
            moved = false;
        }
    }, true);
}

/* --------------------------------------------------------------------------
   Newest: a run of frames with the newest lifted out of it
   -------------------------------------------------------------------------- */

function buildNewest(models) {
    const recent = byNames(RECENT_MODELS, models);
    if (!recent.length) return;

    recent.forEach((model, index) => {
        const frame = document.createElement('a');
        frame.className = index === 0 ? 'run-frame is-lifted' : 'run-frame';
        linkTo(frame, model);

        const picture = document.createElement('div');
        picture.className = 'run-picture';
        const img = createPoster(model);
        guardPoster(img, picture);
        picture.appendChild(img);
        const video = createVideo(videoPath(model), posterPath(model));
        picture.appendChild(video);
        frame.appendChild(picture);
        attachHoverVideo(frame, video);

        const caption = document.createElement('p');
        caption.className = 'run-caption';
        caption.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.textContent = model.name;
        const base = document.createElement('span');
        base.textContent = baseLabel(model.tags[0] || '');
        caption.append(name, base);
        frame.appendChild(caption);

        reveal(frame, index, 'reveal-frame');
        el.newestRun.appendChild(frame);
    });

    const newest = recent[0];
    const kind = newest.type ? `a ${newest.type} LoRA` : 'a LoRA';
    el.newestNote.textContent = `${newest.name} is the latest, ${kind} for ${baseList(newest)}.`;
}

function attachHoverVideo(target, video) {
    if (!canHover.matches) return;
    target.addEventListener('mouseenter', () => startVideo(video));
    target.addEventListener('mouseleave', () => stopVideo(video));
    target.addEventListener('focus', () => startVideo(video));
    target.addEventListener('blur', () => stopVideo(video));
}

/* --------------------------------------------------------------------------
   The contact sheet: one run of frames per category, and one enlarged frame
   beside it for whatever the pointer rests on
   -------------------------------------------------------------------------- */

const preview = {};

function buildPreview() {
    preview.media = document.createElement('div');
    preview.media.className = 'preview-media';
    preview.img = document.createElement('img');
    preview.img.alt = '';
    preview.video = createVideo(null, null);
    preview.media.append(preview.img, preview.video);

    preview.name = document.createElement('h3');
    preview.name.className = 'preview-name';
    preview.meta = document.createElement('p');
    preview.meta.className = 'preview-meta';
    preview.bases = document.createElement('p');
    preview.bases.className = 'preview-meta';
    preview.link = document.createElement('a');
    preview.link.className = 'button';
    preview.link.textContent = 'Open on Civitai';
    preview.link.target = '_blank';
    preview.link.rel = 'noopener noreferrer';

    el.preview.append(preview.media, preview.name, preview.meta, preview.bases, preview.link);
}

let selectedFrame = null;

/** @param {boolean} play only when the visitor asked for it by pointing at a frame. */
function select(model, frame, play) {
    if (selectedFrame) selectedFrame.classList.remove('is-selected');
    selectedFrame = frame;
    if (frame) frame.classList.add('is-selected');

    if (preview.img.dataset.slug !== model.slug) {
        preview.img.dataset.slug = model.slug;
        preview.img.src = posterPath(model);
        retarget(preview.video, model);
        preview.name.textContent = model.name;
        preview.meta.textContent = `${typeTitle(model)} · ${model.category}`;
        preview.bases.textContent = baseList(model);
        if (model.civitaiUrl) {
            preview.link.href = model.civitaiUrl;
            preview.link.hidden = false;
            preview.link.setAttribute('aria-label', `Open ${model.name} on Civitai`);
        } else {
            preview.link.hidden = true;
        }
    }
    if (play && !saveData) startVideo(preview.video);
}

function createFrame(model, index) {
    const frame = document.createElement('a');
    frame.className = 'frame';
    linkTo(frame, model);
    frame.title = model.name;

    const picture = document.createElement('div');
    picture.className = 'frame-picture';
    const img = createPoster(model);
    guardPoster(img, picture);
    picture.appendChild(img);
    frame.appendChild(picture);

    // Shown under each frame on touch screens, where there is no enlarged preview.
    const name = document.createElement('span');
    name.className = 'frame-name';
    name.setAttribute('aria-hidden', 'true');
    name.textContent = model.name;
    frame.appendChild(name);

    if (canHover.matches) {
        frame.addEventListener('mouseenter', () => select(model, frame, true));
    }
    frame.addEventListener('focus', () => select(model, frame, true));

    reveal(frame, index, 'reveal-frame');
    return frame;
}

function createRun(title, models) {
    const run = document.createElement('section');
    run.className = 'run';
    run.id = `section-${slugify(title)}`;
    run.setAttribute('aria-labelledby', `${run.id}-title`);

    const head = document.createElement('div');
    head.className = 'run-head';
    const heading = document.createElement('h3');
    heading.className = 'run-title';
    heading.id = `${run.id}-title`;
    heading.textContent = title;
    if (title === FAVOURITES) heading.prepend(createHeartIcon('category-icon', 13));
    const count = document.createElement('p');
    count.className = 'run-count';
    count.textContent = `${models.length} ${models.length === 1 ? 'model' : 'models'}`;
    head.append(heading, count);
    run.appendChild(head);
    reveal(head, 0);

    const frames = document.createElement('div');
    frames.className = 'run-frames';
    models.forEach((model, index) => frames.appendChild(createFrame(model, index)));
    run.appendChild(frames);

    // Phones show the first two rows of an unfiltered run and fold the rest,
    // so the eight subjects fit a few screens instead of seventeen.
    if (!hasFilters() && models.length > RUN_PREVIEW) {
        run.classList.add('is-folded');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'text-link run-more';
        more.textContent = `Show all ${models.length}`;
        more.setAttribute('aria-label', `Show all ${models.length} ${title} models`);
        more.addEventListener('click', () => {
            run.classList.remove('is-folded');
            more.remove();
            // Hand focus to the first frame that was folded away.
            const next = frames.children[RUN_PREVIEW];
            if (next) next.focus({ preventScroll: true });
        });
        run.appendChild(more);
    }

    return run;
}

/** How many frames a folded run shows on a phone: two rows of three. */
const RUN_PREVIEW = 6;

function slugify(value) {
    return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Test a model against the active filters. Pass an axis name to ignore that one
 * axis, which is how each chip reports what it would yield if it were clicked.
 */
function matches(model, ignore) {
    if (ignore !== 'category' && state.category !== ALL && !inCategory(model, state.category)) return false;
    if (ignore !== 'base' && state.base !== ALL && !model.tags.includes(state.base)) return false;
    if (ignore !== 'type' && state.type !== ALL && model.type !== state.type) return false;
    if (state.query && !model.haystack.includes(state.query)) return false;
    return true;
}

function render() {
    const visible = allModels.filter(model => matches(model));

    // Frames are rebuilt on every render, so drop the observer's stale targets
    // (only the sheet's: the rest of the page may still be waiting to arrive).
    if (revealObserver) {
        el.grid.querySelectorAll('.reveal, .reveal-frame').forEach(node => {
            revealObserver.unobserve(node);
            pendingReveals.delete(node);
        });
    }
    selectedFrame = null;
    el.grid.replaceChildren();

    if (!visible.length) {
        el.empty.hidden = false;
        el.preview.hidden = true;
        stopVideo(preview.video);
        updateChrome(0);
        return;
    }
    el.empty.hidden = true;
    el.preview.hidden = false;

    const fragment = document.createDocumentFragment();
    let first = null;

    if (state.category === FAVOURITES) {
        // Keep the curated order rather than regrouping by real category.
        const ordered = FAVOURITE_MODELS
            .map(name => visible.find(model => model.name === name))
            .filter(Boolean);
        fragment.appendChild(createRun(FAVOURITES, ordered));
        first = ordered[0];
    } else {
        orderedCategories(visible).forEach(category => {
            const models = visible.filter(model => model.category === category);
            if (!models.length) return;
            if (!first) first = models[0];
            fragment.appendChild(createRun(category, models));
        });
    }

    el.grid.appendChild(fragment);
    if (first) select(first, el.grid.querySelector('.frame'), false);
    updateChrome(visible.length);
}

function updateChrome(count) {
    const total = allModels.length;
    el.resultCount.textContent = count === total
        ? `${total} models`
        : `${count} of ${total} models`;

    const isFiltered = hasFilters();
    // Always shown so the control never jumps in and out; disabled when there is nothing to clear.
    el.resetFilters.disabled = !isFiltered;
    el.panelReset.disabled = !isFiltered;

    // Tells a phone user that chips are active even while the panel is folded.
    const activeChips = [state.category, state.base, state.type].filter(value => value !== ALL).length;
    el.filtersCount.hidden = activeChips === 0;
    el.filtersCount.textContent = activeChips;

    // Each chip shows what it would yield against the *other* active filters, so
    // dead-end combinations are visible before they are clicked.
    const byCategory = allModels.filter(model => matches(model, 'category'));
    const byBase = allModels.filter(model => matches(model, 'base'));
    const byType = allModels.filter(model => matches(model, 'type'));

    refreshChips(el.categoryFilters, state.category, value =>
        value === ALL ? byCategory.length : byCategory.filter(m => inCategory(m, value)).length);

    refreshChips(el.baseFilters, state.base, value =>
        value === ALL ? byBase.length : byBase.filter(m => m.tags.includes(value)).length);

    refreshChips(el.typeFilters, state.type, value =>
        value === ALL ? byType.length : byType.filter(m => m.type === value).length);

    syncUrl();
}

function refreshChips(container, active, countFor) {
    container.querySelectorAll('.chip').forEach(chip => {
        const value = chip.dataset.value;
        const isActive = value === active;
        const count = countFor(value);

        chip.setAttribute('aria-pressed', String(isActive));
        chip.classList.toggle('is-empty', count === 0 && !isActive);

        const badge = chip.querySelector('.chip-count');
        if (badge) badge.textContent = count;
    });
}

/* --------------------------------------------------------------------------
   Filters
   -------------------------------------------------------------------------- */

function createChip(label, value, count) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.value = value;
    chip.setAttribute('aria-pressed', 'false');

    if (value === FAVOURITES) chip.appendChild(createHeartIcon('chip-icon', 12));

    const text = document.createElement('span');
    text.textContent = label;
    chip.appendChild(text);

    if (typeof count === 'number') {
        const badge = document.createElement('span');
        badge.className = 'chip-count';
        badge.textContent = count;
        chip.appendChild(badge);
    }

    return chip;
}

function buildFilters(models) {
    const categoryFragment = document.createDocumentFragment();
    categoryFragment.appendChild(createChip('All', ALL, models.length));
    // A virtual category: the curated favourites, listed right after "All".
    categoryFragment.appendChild(createChip(FAVOURITES, FAVOURITES, models.filter(inFavourites).length));
    orderedCategories(models).forEach(category => {
        const count = models.filter(model => model.category === category).length;
        categoryFragment.appendChild(createChip(category, category, count));
    });
    el.categoryFilters.querySelector('.chip-list').appendChild(categoryFragment);

    const baseFragment = document.createDocumentFragment();
    baseFragment.appendChild(createChip('All', ALL, models.length));
    orderedBases(models).forEach(([base, count]) => {
        baseFragment.appendChild(createChip(baseLabel(base), base, count));
    });
    el.baseFilters.querySelector('.chip-list').appendChild(baseFragment);

    const typeFragment = document.createDocumentFragment();
    typeFragment.appendChild(createChip('All', ALL, models.length));
    Object.entries(LORA_TYPES).forEach(([type, { label }]) => {
        typeFragment.appendChild(createChip(label, type, models.filter(m => m.type === type).length));
    });
    el.typeFilters.querySelector('.chip-list').appendChild(typeFragment);

    el.typeFilters.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (chip) applyFilter('type', chip.dataset.value);
    });

    el.categoryFilters.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (chip) applyFilter('category', chip.dataset.value);
    });

    el.baseFilters.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (chip) applyFilter('base', chip.dataset.value);
    });
}

/** @param {'category'|'base'|'type'} axis */
function applyFilter(axis, value) {
    // Tapping the active chip clears it, which is faster than hunting for "All".
    state[axis] = value === state[axis] ? ALL : value;
    // Fold the phone panel first so the scroll below measures the short toolbar.
    setFilterPanel(false);
    render();
    scrollToResults();
}

function setFilterPanel(open) {
    el.toolbar.classList.toggle('is-open', open);
    el.filtersToggle.setAttribute('aria-expanded', String(open));
}

function initFilterPanel() {
    el.filtersToggle.addEventListener('click', () => {
        setFilterPanel(!el.toolbar.classList.contains('is-open'));
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && el.toolbar.classList.contains('is-open')) {
            setFilterPanel(false);
            el.filtersToggle.focus();
        }
    });

    // A tap anywhere outside the toolbar folds the panel away.
    document.addEventListener('click', event => {
        if (!el.toolbar.contains(event.target)) setFilterPanel(false);
    });
}

/**
 * Bring the top of the sheet into view after a filter changes: down from the
 * hero, or back up when the re-render has left the reader mid-way through.
 */
function scrollToResults() {
    const offset = el.toolbar ? el.toolbar.offsetHeight : 0;
    const top = el.grid.getBoundingClientRect().top + window.pageYOffset - offset - 16;
    if (Math.abs(window.pageYOffset - top) > 2) {
        window.scrollTo({ top, behavior: prefersReducedMotion.matches ? 'auto' : 'smooth' });
    }
}

function initSearch() {
    let timer;
    el.search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.query = el.search.value.trim().toLowerCase();
            render();
        }, 120);
    });

    el.search.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            el.search.value = '';
            state.query = '';
            render();
        }
    });

    el.searchClear.addEventListener('click', () => {
        el.search.value = '';
        state.query = '';
        el.search.focus();
        render();
    });

    const clearAll = () => {
        el.search.value = '';
        state.query = '';
        state.category = ALL;
        state.base = ALL;
        state.type = ALL;
        render();
    };

    el.resetFilters.addEventListener('click', clearAll);
    el.panelReset.addEventListener('click', () => {
        setFilterPanel(false);
        clearAll();
    });
    if (el.emptyReset) el.emptyReset.addEventListener('click', clearAll);

    // "/" focuses search from anywhere on the page.
    document.addEventListener('keydown', event => {
        if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        event.preventDefault();
        el.search.focus();
        el.search.select();
    });
}

/* --------------------------------------------------------------------------
   Counts: the first screen reads from the data, so a new model updates it
   without touching the markup
   -------------------------------------------------------------------------- */

function fillCounts(models) {
    const bases = orderedBases(models);
    el.heroCount.textContent = models.length;
    const labels = bases.map(([tag]) => baseLabel(tag)).filter((label, i, all) => all.indexOf(label) === i);
    el.heroBases.textContent = labels.length > 1
        ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
        : labels.join('');
}

/* --------------------------------------------------------------------------
   Hero badges: the row is pictures only; the one in hand is named beneath it
   -------------------------------------------------------------------------- */

function initBadges() {
    const readout = el.badgeReadout;
    if (!readout) return;
    const resting = readout.textContent;

    const show = badge => {
        const name = document.createElement('strong');
        name.textContent = badge.dataset.name;
        readout.replaceChildren(name, document.createTextNode(` ${badge.dataset.note}`));
    };
    const rest = () => { readout.textContent = resting; };

    document.querySelectorAll('.badge').forEach(badge => {
        badge.addEventListener('mouseenter', () => show(badge));
        badge.addEventListener('focus', () => show(badge));
        badge.addEventListener('mouseleave', rest);
        badge.addEventListener('blur', rest);
    });
}

/* --------------------------------------------------------------------------
   Shareable URLs
   -------------------------------------------------------------------------- */

function syncUrl() {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.category !== ALL) params.set('category', state.category);
    if (state.base !== ALL) params.set('base', state.base);
    if (state.type !== ALL) params.set('lora', state.type);
    const query = params.toString();
    history.replaceState(null, '', query ? `?${query}${location.hash}` : `${location.pathname}${location.hash}`);
}

function readUrl(models) {
    const params = new URLSearchParams(location.search);

    const category = params.get('category');
    if (category && (category === FAVOURITES || models.some(model => model.category === category))) {
        state.category = category;
    }

    const base = params.get('base');
    if (base && models.some(model => model.tags.includes(base))) {
        state.base = base;
    }

    const type = params.get('lora');
    if (type && LORA_TYPES[type]) {
        state.type = type;
    }

    const query = params.get('q');
    if (query) {
        state.query = query.trim().toLowerCase();
        el.search.value = query;
    }
}

/* --------------------------------------------------------------------------
   Page chrome
   -------------------------------------------------------------------------- */

function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;

    const apply = theme => {
        document.documentElement.setAttribute('data-theme', theme);
        toggle.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
    };

    const saved = () => {
        try { return localStorage.getItem('theme'); } catch (error) { return null; }
    };

    apply(document.documentElement.getAttribute('data-theme') || 'light');

    toggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next);
        try { localStorage.setItem('theme', next); } catch (error) { /* private mode: the choice lasts this visit */ }
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        if (!saved()) apply(event.matches ? 'dark' : 'light');
    });
}

/** Keep --toolbar-h in sync so anchors and the sticky preview clear the toolbar. */
function trackToolbarHeight() {
    if (!el.toolbar) return;

    const measure = () => {
        document.documentElement.style.setProperty('--toolbar-h', `${el.toolbar.offsetHeight}px`);
    };

    measure();
    if ('ResizeObserver' in window) {
        new ResizeObserver(measure).observe(el.toolbar);
    } else {
        window.addEventListener('resize', measure, { passive: true });
    }
}

function initScrollChrome() {
    let ticking = false;

    const update = () => {
        if (el.toTop) {
            el.toTop.classList.toggle('is-visible', window.pageYOffset > 900);
        }
        ticking = false;
    };

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
    }, { passive: true });

    update();

    const footer = document.querySelector('.footer');
    if (el.toTop && footer && 'IntersectionObserver' in window) {
        new IntersectionObserver(entries => {
            el.toTop.classList.toggle('is-parked', entries[0].isIntersecting);
        }).observe(footer);
    }

    if (el.toTop) {
        el.toTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: prefersReducedMotion.matches ? 'auto' : 'smooth' });
        });
    }
}

function showError(message) {
    el.loading.hidden = true;
    el.error.hidden = false;
    el.error.textContent = message;
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function init() {
    initTheme();
    initBadges();
    initScrollChrome();
    trackToolbarHeight();
    revealStatic();

    try {
        allModels = prepare(await loadModels());
    } catch (error) {
        console.error('Failed to load models:', error);
        showError('The model archive could not be loaded. Please refresh the page.');
        return;
    }

    if (!allModels.length) {
        showError('No models are published yet.');
        return;
    }

    el.loading.hidden = true;

    fillCounts(allModels);
    buildStrip(allModels);
    buildNewest(allModels);
    buildPreview();
    buildFilters(allModels);
    initFilterPanel();
    initSearch();
    readUrl(allModels);
    render();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
