// Web fonts offered by the App Builder "Customise" step. The bot has no build-time
// font bundling (unlike the Next.js templates' next/font), so the selected family is
// loaded at runtime from Google Fonts and applied via the --brand-font-primary var.
const SUPPORTED_FONTS = new Set([
    'Inter',
    'Roboto',
    'Poppins',
    'DM Sans',
    'Lato',
    'Nunito',
    'Open Sans',
    'Montserrat',
    'Raleway',
    'Source Sans 3',
]);

const loaded = new Set<string>();

/** Injects a Google Fonts stylesheet for the given family (once). No-op for unknown families. */
export function loadWebFont(family: string): void {
    if (!SUPPORTED_FONTS.has(family) || loaded.has(family)) return;
    loaded.add(family);

    const id = `webfont-${family.replace(/\s+/g, '-').toLowerCase()}`;
    if (document.getElementById(id)) return;

    const googleName = family.replace(/\s+/g, '+');
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${googleName}:wght@400;500;600;700&display=swap`;
    document.head.appendChild(link);
}

/**
 * The interface font, requested the way a font should be requested: as a
 * stylesheet link whose failure costs a typeface and nothing else.
 *
 * @deriv-com/ui's CSS asks for this font with a remote `@import` at the top of
 * the file, which is a different proposition — when the font host cannot be
 * reached, the whole stylesheet chunk fails to load, and the app is replaced by
 * an error page over a missing typeface. The build strips those imports (see
 * rsbuild.config.ts), and this puts the request back where it can fail safely.
 */
export function loadInterfaceFont(): void {
    const id = 'webfont-ibm-plex-sans';
    if (document.getElementById(id)) return;

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
        'https://fonts.googleapis.com/css?family=IBM+Plex+Sans:300,400,500,700&display=swap' +
        '&subset=cyrillic,cyrillic-ext,latin-ext,vietnamese';
    document.head.appendChild(link);
}

/** Builds a CSS font-family stack for the family with sensible system fallbacks. */
export function fontFamilyStack(family: string): string {
    if (!SUPPORTED_FONTS.has(family)) return family;
    return `'${family}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
}
