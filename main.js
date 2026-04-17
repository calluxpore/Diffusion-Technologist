// Main application logic for LoRA Model Portfolio

// DOM elements
const modelsGrid = document.getElementById('models-grid');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Smooth scroll to an element with custom animation
 */
function smoothScrollToElement(element) {
    const navbar = document.querySelector('.navbar');
    const navbarHeight = navbar ? navbar.offsetHeight : 0;
    const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
    const offsetPosition = elementPosition - navbarHeight - 20;

    if (prefersReducedMotion.matches) {
        window.scrollTo(0, offsetPosition);
        return;
    }
    
    const startPosition = window.pageYOffset;
    const distance = offsetPosition - startPosition;
    const duration = 800; // milliseconds
    let start = null;
    
    function step(timestamp) {
        if (!start) start = timestamp;
        const progress = timestamp - start;
        const percentage = Math.min(progress / duration, 1);
        
        // Easing function (ease-in-out)
        const ease = percentage < 0.5 
            ? 2 * percentage * percentage 
            : 1 - Math.pow(-2 * percentage + 2, 2) / 2;
        
        window.scrollTo(0, startPosition + distance * ease);
        
        if (progress < duration) {
            window.requestAnimationFrame(step);
        }
    }
    
    window.requestAnimationFrame(step);
}

/**
 * Load models from models.json file
 */
async function loadModels() {
    try {
        const response = await fetch('models.json');
        
        if (!response.ok) {
            throw new Error(`Failed to load models: ${response.status} ${response.statusText}`);
        }
        
        const models = await response.json();
        
        if (!Array.isArray(models)) {
            throw new Error('models.json must contain an array of models');
        }
        
        return models;
    } catch (error) {
        console.error('Error loading models:', error);
        showError(`Failed to load models: ${error.message}`);
        return [];
    }
}

/**
 * Create a placeholder element for missing videos
 */
function createVideoPlaceholder() {
    const placeholder = document.createElement('div');
    placeholder.className = 'video-placeholder';
    return placeholder;
}

/**
 * Create a video element with proper attributes
 */
function createVideoElement(videoPath) {
    const video = document.createElement('video');
    video.src = videoPath;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('loop', '');
    
    // Function to attempt playing the video (important for mobile)
    const attemptPlay = () => {
        if (video.readyState >= 2) { // HAVE_CURRENT_DATA or higher
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    // Autoplay was prevented - this is normal on some mobile browsers
                    // Video will play when user interacts or when it comes into view via IntersectionObserver
                });
            }
        }
    };
    
    // Try to play when video metadata is loaded (helps with mobile autoplay)
    video.addEventListener('loadedmetadata', attemptPlay);
    video.addEventListener('canplay', attemptPlay);
    video.addEventListener('loadeddata', attemptPlay);
    
    // Handle video load errors gracefully
    video.addEventListener('error', () => {
        const container = video.parentElement;
        if (container && container.classList.contains('video-container')) {
            container.replaceChild(createVideoPlaceholder(), video);
        }
    });
    
    return video;
}

/**
 * Create a model card element
 */
function createModelCard(model) {
    const card = document.createElement('div');
    card.className = 'model-card';
    
    // Create video container
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    
    const videoPath = `media/${model.slug}.mp4`;
    const video = createVideoElement(videoPath);
    videoContainer.appendChild(video);
    
    // Create card content
    const cardContent = document.createElement('div');
    cardContent.className = 'card-content';
    
    // Title
    const title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = model.name;
    cardContent.appendChild(title);
    
    // Tags
    if (model.tags && model.tags.length > 0) {
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'card-tags';
        
        model.tags.forEach(tag => {
            const tagEl = document.createElement('span');
            tagEl.className = 'tag';
            tagEl.textContent = tag;
            tagsContainer.appendChild(tagEl);
        });
        
        cardContent.appendChild(tagsContainer);
    }
    
    // Assemble card
    card.appendChild(videoContainer);
    card.appendChild(cardContent);
    
    // Add click handler to open Civitai page
    card.addEventListener('click', () => {
        if (model.civitaiUrl) {
            window.open(model.civitaiUrl, '_blank', 'noopener,noreferrer');
        }
    });
    
    // Add keyboard accessibility
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `View ${model.name} on Civitai`);
    
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (model.civitaiUrl) {
                window.open(model.civitaiUrl, '_blank', 'noopener,noreferrer');
            }
        }
    });
    
    return card;
}

/**
 * Create a category header element
 */
function createCategoryHeader(categoryName, icon) {
    const header = document.createElement('div');
    header.className = 'category-header';
    header.id = `category-${categoryName.toLowerCase().replace(/\s+/g, '-').replace(/&/g, 'and')}`;
    
    const iconEl = document.createElement('span');
    iconEl.className = 'category-icon';
    iconEl.textContent = icon;
    
    const textEl = document.createElement('span');
    textEl.className = 'category-text';
    textEl.textContent = categoryName;
    
    header.appendChild(iconEl);
    header.appendChild(textEl);
    
    return header;
}

/**
 * Create a category button element
 */
function createCategoryButton(categoryName, icon) {
    const button = document.createElement('button');
    button.className = 'category-button';
    button.type = 'button';
    
    const iconEl = document.createElement('span');
    iconEl.className = 'category-button-icon';
    iconEl.textContent = icon;
    
    const textEl = document.createElement('span');
    textEl.className = 'category-button-text';
    textEl.textContent = categoryName;
    
    button.appendChild(iconEl);
    button.appendChild(textEl);
    
    // Add click handler for smooth scroll
    button.addEventListener('click', (e) => {
        e.preventDefault();
        const categoryId = `category-${categoryName.toLowerCase().replace(/\s+/g, '-').replace(/&/g, 'and')}`;
        const categoryElement = document.getElementById(categoryId);
        if (categoryElement) {
            smoothScrollToElement(categoryElement);
        }
    });
    
    return button;
}

/**
 * Render all model cards grouped by category
 */
function renderModels(models) {
    if (models.length === 0) {
        showError('No models found in models.json');
        return;
    }
    
    // Clear loading state
    loadingEl.style.display = 'none';
    
    // Clear grid
    modelsGrid.innerHTML = '';
    
    // Group models by category
    const categories = {};
    models.forEach(model => {
        const category = model.category || 'Uncategorized';
        if (!categories[category]) {
            categories[category] = [];
        }
        categories[category].push(model);
    });
    
    // Category icons mapping
    const categoryIcons = {
        'Most Recent Models': '🎉',
        'Character & Portraits': '👤',
        'Fashion': '👗',
        'Art Styles & Techniques': '🎨',
        'Industrial Design': '✏️',
        'Sci-Fi & Cyberpunk': '🤖',
        'Anime & Fantasy': '✨',
        'Architecture': '🏛️',
        'Typography & Digital': '🔤'
    };

    const fragment = document.createDocumentFragment();

    // Most Recent Models section: Hallucination, Journal Sketching, Whimsical, Impasto
    const hallucination = models.find(m => m.name === 'Hallucination');
    const journalSketching = models.find(m => m.name === 'Journal Sketching');
    const whimsical = models.find(m => m.name === 'Whimsical');
    const impasto = models.find(m => m.name === 'Impasto');
    const mostRecent = [hallucination, journalSketching, whimsical, impasto].filter(Boolean);
    if (mostRecent.length > 0) {
        const recentHeader = createCategoryHeader('Most Recent Models', categoryIcons['Most Recent Models']);
        fragment.appendChild(recentHeader);
        const recentGrid = document.createElement('div');
        recentGrid.className = 'category-grid';
        mostRecent.forEach((model, index) => {
            const card = createModelCard(model);
            card.style.animationDelay = `${index * 0.05}s`;
            recentGrid.appendChild(card);
        });
        fragment.appendChild(recentGrid);
    }
    
    // Render each category
    Object.keys(categories).sort((a, b) => a.localeCompare(b)).forEach(categoryName => {
        // Create category header
        const header = createCategoryHeader(categoryName, categoryIcons[categoryName] || '📁');
        fragment.appendChild(header);
        
        // Create category grid
        const categoryGrid = document.createElement('div');
        categoryGrid.className = 'category-grid';
        
        // Add cards for this category
        categories[categoryName].forEach((model, index) => {
            const card = createModelCard(model);
            // Add animation delay based on index within category
            card.style.animationDelay = `${index * 0.05}s`;
            categoryGrid.appendChild(card);
        });
        
        fragment.appendChild(categoryGrid);
    });

    modelsGrid.appendChild(fragment);
    
    // Setup Intersection Observer for video autoplay on mobile
    setupVideoAutoplay();
}

/**
 * Setup Intersection Observer to play videos when they come into view
 * This is especially important for mobile browsers which restrict autoplay
 */
function setupVideoAutoplay() {
    const videos = document.querySelectorAll('.video-container video');
    
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const video = entry.target;
                if (entry.isIntersecting) {
                    // Video is in viewport, try to play (critical for mobile)
                    const playPromise = video.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(error => {
                            // Autoplay prevented, will try again on user interaction
                        });
                    }
                } else {
                    // Video is out of viewport, pause to save resources
                    video.pause();
                }
            });
        }, {
            rootMargin: '120px 0px',
            threshold: 0.1
        });
        
        videos.forEach(video => {
            observer.observe(video);
        });
    } else {
        // Fallback for browsers without IntersectionObserver
        videos.forEach(video => {
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }
        });
    }
}

/**
 * Show error message
 */
function showError(message) {
    loadingEl.style.display = 'none';
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

/**
 * Render category buttons in hero section
 */
function renderCategoryButtons(models) {
    const categoryButtonsContainer = document.getElementById('category-buttons');
    if (!categoryButtonsContainer) return;
    categoryButtonsContainer.innerHTML = '';
    
    // Get unique categories
    const categories = new Set();
    models.forEach(model => {
        if (model.category) {
            categories.add(model.category);
        }
    });
    
    // Category icons mapping
    const categoryIcons = {
        'Most Recent Models': '🎉',
        'Character & Portraits': '👤',
        'Fashion': '👗',
        'Art Styles & Techniques': '🎨',
        'Industrial Design': '✏️',
        'Sci-Fi & Cyberpunk': '🤖',
        'Anime & Fantasy': '✨',
        'Architecture': '🏛️',
        'Typography & Digital': '🔤'
    };

    // Add "Most Recent Models" button first
    const fragment = document.createDocumentFragment();
    const mostRecentButton = createCategoryButton('Most Recent Models', categoryIcons['Most Recent Models']);
    fragment.appendChild(mostRecentButton);

    // Create buttons for each category
    Array.from(categories).sort((a, b) => a.localeCompare(b)).forEach(categoryName => {
        const button = createCategoryButton(categoryName, categoryIcons[categoryName] || '📁');
        fragment.appendChild(button);
    });
    categoryButtonsContainer.appendChild(fragment);
}

/**
 * Initialize the application
 */
async function init() {
    try {
        const models = await loadModels();
        
        if (models.length > 0) {
            renderCategoryButtons(models);
            renderModels(models);
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to initialize application');
    }
}

/**
 * Smooth scroll to top function
 */
function smoothScrollToTop() {
    if (prefersReducedMotion.matches) {
        window.scrollTo(0, 0);
        return;
    }

    const startPosition = window.pageYOffset;
    const distance = -startPosition;
    const duration = 800; // milliseconds
    let start = null;
    
    function step(timestamp) {
        if (!start) start = timestamp;
        const progress = timestamp - start;
        const percentage = Math.min(progress / duration, 1);
        
        // Easing function (ease-in-out)
        const ease = percentage < 0.5 
            ? 2 * percentage * percentage 
            : 1 - Math.pow(-2 * percentage + 2, 2) / 2;
        
        window.scrollTo(0, startPosition + distance * ease);
        
        if (progress < duration) {
            window.requestAnimationFrame(step);
        }
    }
    
    window.requestAnimationFrame(step);
}

/**
 * Initialize scroll to top button
 */
function initScrollToTop() {
    const scrollButton = document.getElementById('scroll-to-top');
    if (!scrollButton) return;
    
    // Show/hide button based on scroll position
    function handleScroll() {
        const scrollThreshold = 300; // Show button after scrolling 300px
        if (window.pageYOffset > scrollThreshold) {
            scrollButton.classList.add('visible');
        } else {
            scrollButton.classList.remove('visible');
        }
    }
    
    // Add scroll event listener
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    // Add click event listener
    scrollButton.addEventListener('click', (e) => {
        e.preventDefault();
        smoothScrollToTop();
    });
    
    // Initial check
    handleScroll();
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
        initScrollToTop();
    });
} else {
    init();
    initScrollToTop();
}
