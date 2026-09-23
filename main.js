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

/* Curated "most recent" shelf, newest first. Names must match models.json;
   anything missing is skipped silently so the shelf never breaks the page. */
const RECENT_MODELS = [
    'Face Tattoos',
    'The Iron Warden',
    'Joy Potter',
    'Industrial Design Anima Style Rendering',
    'HeptapodB',
    'Anbui',
    'Anfema',
    'Hallucination',
    'Impasto'
];

/* Order categories by how a visitor is likely to browse, not alphabetically.
   Anything not listed here is appended alphabetically. */
const CATEGORY_ORDER = [
    'Character & Portraits',
    'Brown Woman',
    'Anime & Fantasy',
    'Sci-Fi & Cyberpunk',
    'Art Styles & Techniques',
    'Fashion',
    'Industrial Design',
    'Architecture',
    'Typography & Digital'
];

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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
    emptyReset: document.getElementById('empty-reset'),
    categoryFilters: document.getElementById('category-filters'),
    baseFilters: document.getElementById('base-filters'),
    progressBar: document.getElementById('progress-bar'),
    toTop: document.getElementById('to-top')
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
            haystack: [model.name, model.slug, model.category, tags.join(' ')].join(' ').toLowerCase()
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
   Video: only fetch an .mp4 once its card is near the viewport
   -------------------------------------------------------------------------- */

const videoObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
            const video = entry.target;
            if (entry.isIntersecting) {
                if (!video.src && video.dataset.src) {
                    video.src = video.dataset.src;
                }
                playVideo(video);
            } else if (!video.paused) {
                video.pause();
            }
        });
    }, { rootMargin: '250px 0px', threshold: 0.05 })
    : null;

function playVideo(video) {
    if (!video.src || video.dataset.failed === 'true') return;
    const attempt = video.play();
    if (attempt && typeof attempt.then === 'function') {
        // Autoplay can be refused (iOS Low Power Mode, data saver); the poster
        // stays visible underneath, so a rejection needs no handling.
        attempt.then(() => video.classList.add('is-playing')).catch(() => { });
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

function createCard(model, index) {
    // An anchor (rather than a click handler) so cards support middle-click,
    // open-in-new-tab and copy-link like any other link.
    const card = document.createElement('a');
    card.className = 'model-card';
    if (model.civitaiUrl) {
        card.href = model.civitaiUrl;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.setAttribute('aria-label', `${model.name} — open on Civitai`);
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
    if (videoObserver) {
        videoObserver.observe(video);
    } else {
        video.src = videoPath;
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
            badge.textContent = tag;
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

    const meta = document.createElement('p');
    meta.className = 'card-meta';
    // Bases live in the badges now, so the meta line carries only the category.
    meta.textContent = model.category;
    body.appendChild(meta);

    card.appendChild(media);
    card.appendChild(body);
    return card;
}

function createSection(title, models) {
    const section = document.createElement('section');
    section.className = 'category-section';

    const header = document.createElement('div');
    header.className = 'category-header';
    header.id = `section-${slugify(title)}`;

    const heading = document.createElement('h2');
    heading.className = 'category-title';
    heading.textContent = title;

    const count = document.createElement('span');
    count.className = 'category-count';
    count.textContent = `${models.length} ${models.length === 1 ? 'model' : 'models'}`;

    header.appendChild(heading);
    header.appendChild(count);
    section.appendChild(header);
    reveal(header, 0);

    const grid = document.createElement('div');
    grid.className = 'category-grid';
    models.forEach((model, index) => grid.appendChild(createCard(model, index)));
    section.appendChild(grid);

    return section;
}

function slugify(value) {
    return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Test a model against the active filters. Pass an axis name to ignore that one
 * axis, which is how each chip reports what it would yield if it were clicked.
 */
function matches(model, ignore) {
    if (ignore !== 'category' && state.category !== ALL && model.category !== state.category) return false;
    if (ignore !== 'base' && state.base !== ALL && !model.tags.includes(state.base)) return false;
    if (state.query && !model.haystack.includes(state.query)) return false;
    return true;
}

function render() {
    const visible = allModels.filter(model => matches(model));

    // Cards are rebuilt on every render, so drop the observers' stale targets.
    if (videoObserver) videoObserver.disconnect();
    if (revealObserver) revealObserver.disconnect();
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
            fragment.appendChild(createSection(RECENT, recent));
        }
    }

    orderedCategories(visible).forEach(category => {
        const models = visible.filter(model => model.category === category);
        if (models.length) fragment.appendChild(createSection(category, models));
    });

    el.grid.appendChild(fragment);
    updateChrome(visible.length);
}

function updateChrome(count) {
    const total = allModels.length;
    el.resultCount.textContent = count === total
        ? `${total} models`
        : `${count} of ${total} models`;

    const isFiltered = state.query !== '' || state.category !== ALL || state.base !== ALL;
    el.resetFilters.hidden = !isFiltered;

    // Each chip shows what it would yield against the *other* active filters, so
    // dead-end combinations are visible before they are clicked.
    const byCategory = allModels.filter(model => matches(model, 'category'));
    const byBase = allModels.filter(model => matches(model, 'base'));

    refreshChips(el.categoryFilters, state.category, value =>
        value === ALL ? byCategory.length : byCategory.filter(m => m.category === value).length);

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
    orderedCategories(models).forEach(category => {
        const count = models.filter(model => model.category === category).length;
        categoryFragment.appendChild(createChip(category, category, count));
    });
    el.categoryFilters.appendChild(categoryFragment);

    const baseFragment = document.createDocumentFragment();
    baseFragment.appendChild(createChip('All', ALL, models.length));
    orderedBases(models).forEach(([base, count]) => {
        baseFragment.appendChild(createChip(base, base, count));
    });
    el.baseFilters.appendChild(baseFragment);

    el.categoryFilters.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (!chip) return;
        // Tapping the active chip clears it, which is faster than hunting for "All".
        state.category = chip.dataset.value === state.category ? ALL : chip.dataset.value;
        render();
        scrollToResults();
    });

    el.baseFilters.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (!chip) return;
        state.base = chip.dataset.value === state.base ? ALL : chip.dataset.value;
        render();
        scrollToResults();
    });
}


/** Bring the results into view when a filter is applied from a scrolled-up position. */
function scrollToResults() {
    const main = document.getElementById('models');
    const header = document.querySelector('.site-header');
    const toolbar = document.getElementById('toolbar');
    const offset = (header ? header.offsetHeight : 0) + (toolbar ? toolbar.offsetHeight : 0);
    const top = main.getBoundingClientRect().top + window.pageYOffset - offset - 8;
    if (window.pageYOffset < top) {
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
    if (category && models.some(model => model.category === category)) {
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

    buildFilters(allModels);
    initSearch();
    readUrl(allModels);
    render();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
