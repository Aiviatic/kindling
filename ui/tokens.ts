/**
 * Design tokens — SSOT (mirrors DESIGN.md "Bold Spark" frontmatter).
 *
 * This is the ONE file in `ui/` permitted to hold raw hex literals (the eslint
 * no-hardcoded-hex guard is relaxed here): it *defines* the palette every other
 * component references via the `--color-*` / `--space-*` / `--radius-*` CSS custom
 * properties in tokens.css. Components must never inline hex.
 *
 * AA accessibility restrictions from DESIGN.md are encoded as comments where they
 * constrain usage — honor them in components (and verify contrast in-browser):
 *  - `text-muted` is placeholder/large-only (fails AA for body on these surfaces).
 *  - status WORDS use accessible tones: busy→accent-gold (not ember), wait→text-secondary
 *    (not text-muted), failed→text-primary (not pink). The ember/pink are icon-only.
 */

export const tokens = {
  color: {
    // Dark "flame stage" backgrounds (deep warm near-black browns)
    stageDeep: '#16100c', // titlebar / deepest chrome
    stage: '#1b1410', // page backdrop, on-flame ink
    surface: '#221913', // app canvas
    surfaceTint: '#2c1c12', // hero gradient base
    surfaceRaised: '#2c211a', // cards, panels, step rows
    surfaceRaisedHi: '#34271e', // raised insets, chips, ghost buttons
    surfaceOverlay: '#463429', // highest panel tone / heavy borders
    // Text
    textPrimary: '#fff6ee', // warm white
    textSecondary: '#d6b9a3', // warm tan
    textMuted: '#9a8170', // dim taupe — RESTRICTED: placeholders / large text only
    // Flame accents
    accent: '#ff6a1f', // ember — primary accent, in-progress
    accentGold: '#ffc24a', // gold — focus ring, gradient start, status WORD for busy
    accentPink: '#ff3d6e', // hot pink/magenta — celebratory accent, gradient end
    onFlame: '#1b1410', // text/icons sitting on a flame fill
    success: '#4fd784', // done / verified-ready green
    border: '#463429', // standard panel border
    borderWarm: '#5a3c20', // warmer border on chips / ghost / inset surfaces
    focusRing: '#ffc24a', // gold, 3px + dark offset
  },
  gradient: {
    flame: 'linear-gradient(92deg, #ffc24a 0%, #ff6a1f 45%, #ff3d6e 100%)', // signature
    flame2: 'linear-gradient(90deg, #ffc24a, #ff6a1f)', // 2-stop (buttons, progress fill)
    stage: 'linear-gradient(135deg, #2c1c12 0%, #221913 60%)', // hero stage base
  },
  radius: {
    sm: '6px', // small badges, opt pills, inline tags
    md: '8px', // inputs, url bar, status badges
    lg: '10px', // chips, ghost buttons
    xl: '12px', // buttons, cards, panels
    '2xl': '14px', // window, step rows, hero panels
    full: '999px', // kicker pills
  },
  space: {
    '1': '4px',
    '2': '8px',
    '3': '12px',
    '4': '16px',
    '5': '24px',
    '6': '32px',
    '7': '44px', // body section inner padding
    '8': '56px', // hero / surface gutter
  },
  type: {
    family:
      '-apple-system, "Segoe UI Variable", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    display: { size: '74px', weight: '900', letterSpacing: '-0.03em' },
    h1: { size: '34px', weight: '900', letterSpacing: '-0.02em' },
    lead: { size: '20px', weight: '500', letterSpacing: 'normal' },
    body: { size: '16px', weight: '500', letterSpacing: 'normal' },
    small: { size: '13px', weight: '500', letterSpacing: 'normal' },
    kicker: { size: '12px', weight: '800', letterSpacing: '0.14em' },
    badge: { size: '12px', weight: '900', letterSpacing: '0.04em' },
  },
} as const;

export type Tokens = typeof tokens;
