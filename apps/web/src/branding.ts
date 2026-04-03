/**
 * Branding configuration — the single file a community edits to customize this app.
 *
 * After cloning the repo:
 *   1. Change `name`, `description`, `tagline` below.
 *   2. Drop your logo image into `public/` and set `logo`.
 *   3. Adjust `colors.primary` to your brand color.
 *   4. Run `pnpm run build` and deploy.
 */
export const branding = {
  /** App name shown in header, browser tab title, and vote submissions. */
  name: 'MyVote',

  /** Short description used in HTML meta tags. */
  description: 'Decentralized governance for any community',

  /**
   * Path to logo image in the `public/` folder, e.g. '/logo.svg'.
   * When null, the header shows `name` as plain text.
   */
  logo: null as string | null,

  /**
   * Favicon path. Replace the file in `public/` and update this path.
   * Default Vite favicon will be used if this is not changed in index.html.
   */
  favicon: '/favicon.ico',

  /**
   * Brand colors injected as CSS custom properties at runtime.
   * Only these four need to change for a full re-brand.
   * The neutral structural colors (border, surface, muted) live in style.css.
   */
  colors: {
    /** Primary accent: links, active borders, focus rings. */
    primary: '#646cff',
    primaryHover: '#535bf2',
    /** Error / destructive text. */
    error: '#b00020',
    /** Background highlight for a selected voting choice. */
    selectedBg: 'rgba(66, 184, 131, 0.08)',
  },

  /** Optional footer / about links. Leave empty strings to hide. */
  links: {
    website: '',
    discord: '',
    twitter: '',
    github: '',
  },
}
