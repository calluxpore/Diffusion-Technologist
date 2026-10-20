/* ==========================================================================
   LoRA Archive — application logic
   Loads models.json, renders category sections, and drives search + filters.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   Config
   -------------------------------------------------------------------------- */

const ALL = '__all__';
const RECENT = 'Most Recent';
const FAVOURITES = 'My Favourites';

/* Curated "most recent" shelf, newest first. Names must match models.json;
   anything missing is skipped silently so the shelf never breaks the page. */
const RECENT_MODELS = [
    'Old Me',
    'Temporal Shift',
    'Voronoi',
    'Halftone Orange',
    'Grook',
    'Namos',
    'Face Tattoos',
    'The Iron Warden',
    'Industrial Design Anima Style Rendering',
    'HeptapodB',
    'Anbui',
    'Hallucination',
    'Impasto'
];

/* Curated favourites shelf, shown directly below Most Recent. Names must match models.json. */
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

/* Curated posters for the hero mosaic, in reading order (three per row).
   Names must match models.json; anything missing is skipped. */
const MOSAIC_MODELS = [
    'Industrial Design Anima Style Rendering',
    'HeptapodB',
    'Hallucination',
    'Journal Sketching',
    'Exclusion',
    'Neon X Drive'
];

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
    progressBar: document.getElementById('progress-bar'),
    toTop: document.getElementById('to-top'),
    toolbar: document.getElementById('toolbar'),
    filtersToggle: document.getElementById('filters-toggle'),
    filtersCount: document.getElementById('filters-toggle-count'),
    mosaic: document.getElementById('hero-mosaic')
};

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */

let allModels = [];
const state = { query: '', category: ALL, base: ALL };

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
        return Object.assign({}, model, {
            tags,
            category: model.category || 'Uncategorized',
            haystack: [model.name, model.slug, model.category, tags.join(' '), tags.map(baseLabel).join(' ')]
                .join(' ').toLowerCase()
        });
    });
}

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

/* --------------------------------------------------------------------------
   Video: previews play on hover with a mouse, or while a card is mostly in
   view on touch screens. An .mp4 is only fetched the first time it is wanted.
   -------------------------------------------------------------------------- */

const AUTOPLAY_RATIO = 0.6;

/* Touch screens have no hover, so a card plays once it is mostly on screen.
   Data saver and reduced motion keep to posters. */
const autoplayOnScroll = () => !canHover.matches && !saveData && !prefersReducedMotion.matches;

const videoObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.intersectionRatio >= AUTOPLAY_RATIO) {
                startVideo(entry.target);
            } else {
                stopVideo(entry.target);
            }
        });
    }, { threshold: [0, AUTOPLAY_RATIO] })
    : null;

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
    // A slow download can finish after the pointer has already left the card.
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

/**
 * The fallback tile sits behind the poster and the video, so it only ever shows
 * through when neither of them has anything to paint.
 */
function showFallback(media) {
    if (media.querySelector('.card-media-fallback')) return;
    const fallback = document.createElement('div');
    fallback.className = 'card-media-fallback';
    fallback.textContent = 'No preview';
    media.appendChild(fallback);
}

function clearFallback(media) {
    const fallback = media.querySelector('.card-media-fallback');
    if (fallback) fallback.remove();
}

function createVideo(src, poster) {
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = 'none';
    video.poster = poster;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('loop', '');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    video.dataset.src = src;

    video.addEventListener('loadeddata', () => playVideo(video));
    video.addEventListener('error', () => {
        video.dataset.failed = 'true';
        video.remove();
    });

    return video;
}

/* --------------------------------------------------------------------------
   Entrance motion: reveal as each element scrolls into view
   -------------------------------------------------------------------------- */

const revealObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 })
    : null;

/**
 * @param {number} stagger index within its row, so grids cascade rather than
 *   popping in as one block.
 */
function reveal(element, stagger) {
    // Without an observer, or with motion turned down, show it outright — never
    // leave content stranded at opacity 0.
    if (!revealObserver || prefersReducedMotion.matches) {
        element.classList.add('reveal', 'in');
        return;
    }
    element.classList.add('reveal');
    if (stagger) element.style.transitionDelay = `${(stagger % 5) * 55}ms`;
    revealObserver.observe(element);
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

/**
 * @param {boolean} showCategory only where cards from several categories sit
 *   together; inside a category section the heading already says it.
 */
function createCard(model, index, showCategory) {
    // An anchor (rather than a click handler) so cards support middle-click,
    // open-in-new-tab and copy-link like any other link.
    const card = document.createElement('a');
    card.className = 'model-card';
    if (model.civitaiUrl) {
        card.href = model.civitaiUrl;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.setAttribute('aria-label', `${model.name} — open on Civitai`);
    } else {
        card.setAttribute('aria-label', model.name);
    }
    reveal(card, index);

    const media = document.createElement('div');
    media.className = 'card-media';

    const slug = encodeURIComponent(model.slug);
    const posterPath = `media/${slug}.webp`;
    const videoPath = `media/${slug}.mp4`;

    const poster = document.createElement('img');
    poster.className = 'card-poster';
    poster.src = posterPath;
    poster.alt = `Preview of the ${model.name} LoRA`;
    poster.loading = 'lazy';
    poster.decoding = 'async';
    poster.width = 600;
    poster.height = 800;

    let retried = false;
    poster.addEventListener('error', () => {
        if (!retried) {
            // A dropped request — a flaky connection, or one of 70-odd posters
            // losing its turn — should not blank the card permanently.
            retried = true;
            setTimeout(() => { poster.src = `${posterPath}?retry=1`; }, 700);
            return;
        }
        poster.hidden = true;
        showFallback(media);
    });

    poster.addEventListener('load', () => {
        poster.hidden = false;
        clearFallback(media);
    });

    media.appendChild(poster);

    const video = createVideo(videoPath, posterPath);
    media.appendChild(video);
    if (canHover.matches) {
        card.addEventListener('mouseenter', () => startVideo(video));
        card.addEventListener('mouseleave', () => stopVideo(video));
        card.addEventListener('focus', () => startVideo(video));
        card.addEventListener('blur', () => stopVideo(video));
    } else if (videoObserver && autoplayOnScroll()) {
        videoObserver.observe(video);
    }

    // A model can target several bases, so every one gets its own badge. The base
    // being filtered on leads, otherwise a Flux search shows cards led by SD1.
    if (model.tags.length) {
        const ordered = model.tags.includes(state.base)
            ? [state.base].concat(model.tags.filter(tag => tag !== state.base))
            : model.tags;

        const badges = document.createElement('div');
        badges.className = 'card-badges';
        ordered.forEach(tag => {
            const badge = document.createElement('span');
            badge.className = 'card-badge';
            badge.textContent = baseLabel(tag);
            badges.appendChild(badge);
        });
        media.appendChild(badges);
    }

    if (model.civitaiUrl) {
        const cta = document.createElement('span');
        cta.className = 'card-cta';
        cta.textContent = 'View on Civitai ↗';
        media.appendChild(cta);
    }

    const body = document.createElement('div');
    body.className = 'card-body';

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = model.name;
    body.appendChild(title);

    if (showCategory) {
        const meta = document.createElement('p');
        meta.className = 'card-meta';
        // Bases live in the badges, so the meta line carries only the category.
        meta.textContent = model.category;
        body.appendChild(meta);
    }

    card.appendChild(media);
    card.appendChild(body);
    return card;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.shelf] one sideways-scrolling row instead of a grid.
 * @param {boolean} [options.showCategory] label each card with its category.
 * @param {Function} [options.onSeeAll] adds a "See all" button that calls this.
 */
function createSection(title, models, options = {}) {
    const section = document.createElement('section');
    section.className = options.shelf ? 'category-section is-shelf' : 'category-section';

    const header = document.createElement('div');
    header.className = 'category-header';
    header.id = `section-${slugify(title)}`;

    const heading = document.createElement('h2');
    heading.className = 'category-title';
    heading.textContent = title;
    if (title === FAVOURITES) heading.prepend(createHeartIcon('category-icon', 20));

    const count = document.createElement('span');
    count.className = 'category-count';
    count.textContent = `${models.length} ${models.length === 1 ? 'model' : 'models'}`;

    header.appendChild(heading);
    header.appendChild(count);
    section.appendChild(header);
    reveal(header, 0);

    const grid = document.createElement('div');
    grid.className = 'category-grid';
    models.forEach((model, index) => grid.appendChild(createCard(model, index, options.showCategory)));
    section.appendChild(grid);

    if (options.shelf) header.appendChild(createShelfNav(grid, title, options.onSeeAll));

    return section;
}

/* --------------------------------------------------------------------------
   Shelves: arrow buttons that page a sideways row, disabled at either end
   -------------------------------------------------------------------------- */

const shelfUpdaters = [];

function createShelfNav(grid, title, onSeeAll) {
    const nav = document.createElement('div');
    nav.className = 'shelf-nav';

    if (onSeeAll) {
        const seeAll = document.createElement('button');
        seeAll.type = 'button';
        seeAll.className = 'shelf-see-all';
        seeAll.textContent = 'See all';
        seeAll.setAttribute('aria-label', `See all of ${title}`);
        seeAll.addEventListener('click', onSeeAll);
        nav.appendChild(seeAll);
    }

    const arrow = (direction, label, path) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-btn';
        button.setAttribute('aria-label', `${label}: ${title}`);
        button.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="${path}"></path></svg>`;
        button.addEventListener('click', () => {
            grid.scrollBy({
                left: direction * grid.clientWidth * 0.9,
                behavior: prefersReducedMotion.matches ? 'auto' : 'smooth'
            });
        });
        nav.appendChild(button);
        return button;
    };

    const prev = arrow(-1, 'Scroll back', 'M15 18l-6-6 6-6');
    const next = arrow(1, 'Scroll forward', 'M9 18l6-6-6-6');

    const update = () => {
        const max = grid.scrollWidth - grid.clientWidth;
        prev.disabled = grid.scrollLeft <= 1;
        next.disabled = grid.scrollLeft >= max - 1;
    };
    grid.addEventListener('scroll', update, { passive: true });
    shelfUpdaters.push(update);

    return nav;
}

/** Shelf arrows can only be sized once the shelf is laid out on the page. */
function refreshShelves() {
    shelfUpdaters.forEach(update => update());
}

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
    if (state.query && !model.haystack.includes(state.query)) return false;
    return true;
}

function render() {
    const visible = allModels.filter(model => matches(model));

    // Cards are rebuilt on every render, so drop the observers' stale targets.
    if (videoObserver) videoObserver.disconnect();
    if (revealObserver) revealObserver.disconnect();
    shelfUpdaters.length = 0;
    el.grid.replaceChildren();

    if (!visible.length) {
        el.empty.hidden = false;
        updateChrome(0);
        return;
    }
    el.empty.hidden = true;

    const fragment = document.createDocumentFragment();
    const isFiltered = state.query !== '' || state.category !== ALL || state.base !== ALL;

    // The recent shelf duplicates models that also appear in their own category,
    // so it is only useful on the unfiltered browse view.
    if (!isFiltered) {
        const recent = RECENT_MODELS
            .map(name => allModels.find(model => model.name === name))
            .filter(Boolean);
        if (recent.length) {
            fragment.appendChild(createSection(RECENT, recent, { shelf: true, showCategory: true }));
        }
        const favourites = FAVOURITE_MODELS
            .map(name => allModels.find(model => model.name === name))
            .filter(Boolean);
        if (favourites.length) {
            fragment.appendChild(createSection(FAVOURITES, favourites, {
                shelf: true,
                showCategory: true,
                onSeeAll: () => applyFilter('category', FAVOURITES)
            }));
        }
    }

    if (state.category === FAVOURITES) {
        // Keep the curated order rather than regrouping by real category.
        const ordered = FAVOURITE_MODELS
            .map(name => visible.find(model => model.name === name))
            .filter(Boolean);
        fragment.appendChild(createSection(FAVOURITES, ordered, { showCategory: true }));
    } else {
        orderedCategories(visible).forEach(category => {
            const models = visible.filter(model => model.category === category);
            if (models.length) fragment.appendChild(createSection(category, models));
        });
    }

    el.grid.appendChild(fragment);
    refreshShelves();
    updateChrome(visible.length);
}

function updateChrome(count) {
    const total = allModels.length;
    el.resultCount.textContent = count === total
        ? `${total} models`
        : `${count} of ${total} models`;

    const isFiltered = state.query !== '' || state.category !== ALL || state.base !== ALL;
    // Always shown so the control never jumps in and out; disabled when there is nothing to clear.
    el.resetFilters.disabled = !isFiltered;
    el.panelReset.disabled = !isFiltered;

    // Tells a phone user that chips are active even while the panel is folded.
    const activeChips = (state.category !== ALL ? 1 : 0) + (state.base !== ALL ? 1 : 0);
    el.filtersCount.hidden = activeChips === 0;
    el.filtersCount.textContent = activeChips;

    // Each chip shows what it would yield against the *other* active filters, so
    // dead-end combinations are visible before they are clicked.
    const byCategory = allModels.filter(model => matches(model, 'category'));
    const byBase = allModels.filter(model => matches(model, 'base'));

    refreshChips(el.categoryFilters, state.category, value =>
        value === ALL ? byCategory.length : byCategory.filter(m => inCategory(m, value)).length);

    refreshChips(el.baseFilters, state.base, value =>
        value === ALL ? byBase.length : byBase.filter(m => m.tags.includes(value)).length);

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

    el.categoryFilters.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (chip) applyFilter('category', chip.dataset.value);
    });

    el.baseFilters.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (chip) applyFilter('base', chip.dataset.value);
    });
}

/** @param {'category'|'base'} axis */
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

/* --------------------------------------------------------------------------
   Hero mosaic: hand-picked posters, as a preview of what lies below
   -------------------------------------------------------------------------- */

function buildMosaic(models) {
    if (!el.mosaic) return;
    const picks = MOSAIC_MODELS
        .map(name => models.find(model => model.name === name))
        .filter(Boolean);

    picks.forEach((model, index) => {
        const tile = document.createElement('div');
        tile.className = 'hero-tile';
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.style.transitionDelay = `${index * 70}ms`;
        img.addEventListener('load', () => img.classList.add('is-loaded'));
        img.addEventListener('error', () => tile.remove());
        img.src = `media/${encodeURIComponent(model.slug)}.webp`;
        tile.appendChild(img);
        el.mosaic.appendChild(tile);
    });
}


/**
 * Bring the top of the results into view after a filter changes: down from the
 * hero, or back up when the re-render has left the reader mid-way through.
 */
function scrollToResults() {
    const main = document.getElementById('models');
    const header = document.querySelector('.site-header');
    const toolbar = document.getElementById('toolbar');
    const offset = (header ? header.offsetHeight : 0) + (toolbar ? toolbar.offsetHeight : 0);
    const top = main.getBoundingClientRect().top + window.pageYOffset - offset - 8;
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
   Shareable URLs
   -------------------------------------------------------------------------- */

function syncUrl() {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.category !== ALL) params.set('category', state.category);
    if (state.base !== ALL) params.set('base', state.base);
    const query = params.toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
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
        const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('title', label);
    };

    apply(document.documentElement.getAttribute('data-theme') || 'light');

    toggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next);
        localStorage.setItem('theme', next);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        if (!localStorage.getItem('theme')) apply(event.matches ? 'dark' : 'light');
    });
}

/** Keep --toolbar-h in sync so section anchors clear the sticky chrome. */
function trackToolbarHeight() {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) return;

    const measure = () => {
        document.documentElement.style.setProperty('--toolbar-h', `${toolbar.offsetHeight}px`);
    };

    measure();
    if ('ResizeObserver' in window) {
        new ResizeObserver(measure).observe(toolbar);
    } else {
        window.addEventListener('resize', measure, { passive: true });
    }
}

function initScrollChrome() {
    let ticking = false;

    const update = () => {
        const scrolled = window.pageYOffset;
        const max = document.documentElement.scrollHeight - window.innerHeight;

        if (el.progressBar) {
            el.progressBar.style.transform = `scaleX(${max > 0 ? Math.min(scrolled / max, 1) : 0})`;
        }
        if (el.toTop) {
            el.toTop.classList.toggle('is-visible', scrolled > 600);
        }
        ticking = false;
    };

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
    }, { passive: true });

    window.addEventListener('resize', update, { passive: true });
    update();

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
    initScrollChrome();
    trackToolbarHeight();

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

    buildMosaic(allModels);
    buildFilters(allModels);
    initFilterPanel();
    initSearch();
    readUrl(allModels);
    render();
    window.addEventListener('resize', refreshShelves, { passive: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
