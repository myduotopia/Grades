# Page Checklist

Per-page standards every new page or page change must satisfy. PR review is gated on these. The "PR checklist template" at the bottom can be pasted directly into a PR description.

## Responsive design

Every page must work at three breakpoints:

- **Mobile**: 375 px (iPhone SE / small Android)
- **Tablet**: 768 px (iPad portrait)
- **Desktop**: 1280 px+ (typical laptop)

### Required behaviours

- [ ] No horizontal scroll at 375 px
- [ ] Tap targets ≥ 44 × 44 px (Apple HIG; Android Material is 48 dp ≈ 48 px — 44 px clears both)
- [ ] No `:hover`-only interactions; every action reachable by tap
- [ ] Forms stack fields vertically on narrow screens (no multi-column at 375 px)
- [ ] Tables collapse to card list on narrow screens (or use horizontal scroll with sticky first column for small tables)
- [ ] Numeric inputs use `inputmode="numeric"` or `inputmode="decimal"` to summon the right mobile keyboard
- [ ] Modal / drawer: full-width on mobile, centered on desktop
- [ ] Top nav: collapses to hamburger on narrow screens
- [ ] Long lists virtualize (e.g. TanStack Virtual) above ~50 rows

### Tools

- Chrome DevTools → Toggle Device Toolbar (Ctrl+Shift+M) → cycle through iPhone SE / iPad / Pixel / Surface
- Manually test by clicking at the very edge of buttons (validates tap-target size in practice)

## SEO + meta tags

Most of Grades is auth-gated, so SEO matters mainly for the public-facing surface (Login + future marketing). But every page should still have correct meta for proper browser tab labels + social sharing.

### Required on every page

- [ ] `<title>` set via React Helmet (or equivalent) — translated; e.g. `${t('app.title')} — ${t('classes.title')}`
- [ ] `<meta name="description">` set per page — translated
- [ ] `<html lang="...">` matches current i18n locale (`zh-TW` or `en`) — set programmatically by the i18n provider
- [ ] Favicon present (`/favicon.ico`)
- [ ] Apple touch icon (`/apple-touch-icon.png`) for "Add to Home Screen" on iOS

### Auth-gated pages additionally

- [ ] `<meta name="robots" content="noindex, nofollow">` — crawlers shouldn't index anything behind login
- [ ] No leaked internal data in HTML before the auth check redirects

### Public pages (Login + any future marketing pages) additionally

- [ ] `<meta property="og:title">`, `og:description`, `og:image` for sharing previews
- [ ] `<meta name="twitter:card" content="summary_large_image">`
- [ ] Image at `/og-image.png` (1200 × 630 px)

### Tools

- Browser DevTools → Elements → inspect `<head>`
- <https://www.opengraph.xyz/> to preview the social card

## i18n

- [ ] No hardcoded 中文 / English in JSX — every visible string goes through `t()`
- [ ] New keys added to **both** `frontend/src/i18n/locales/zh-TW/common.json` **and** `en/common.json` in the same commit
- [ ] Date display via `Intl.DateTimeFormat` with current locale
- [ ] Number display via `Intl.NumberFormat` (especially for grades / points)
- [ ] System category names translated via `t('category.<system_key>')`, not the DB `name` field

## Accessibility (a11y)

- [ ] Use semantic HTML (`<button>`, `<a>`, `<form>`, `<label>`, `<nav>`, etc.) — not `<div onClick>`
- [ ] Form inputs have `<label>` (or `aria-label` if visually hidden)
- [ ] Interactive elements reachable via Tab key (keyboard navigation)
- [ ] Focus ring visible (don't `outline: none` without replacement)
- [ ] Color contrast meets WCAG AA (normal text ≥ 4.5 : 1; large text ≥ 3 : 1)
- [ ] Images have `alt` (decorative ones get `alt=""`)

## Loading / empty / error states

Every async page must handle (per [pages.md](pages.md)):

- [ ] **Loading**: skeleton or spinner (not blank)
- [ ] **Empty**: meaningful message + primary CTA
- [ ] **Error**: actionable message + retry button (not raw error string)

Every form must handle:

- [ ] Inline field validation before submit
- [ ] Server-rejected response with toast or inline error
- [ ] Disabled submit while in flight (prevents double-submit)

## PR checklist template

Copy this into PR descriptions for new-page or page-changing PRs:

```markdown
## Responsive
- [ ] Tested at 375 / 768 / 1280 px
- [ ] No `:hover`-only interactions
- [ ] Tap targets ≥ 44 px

## SEO + meta
- [ ] `<title>` and `<meta description>` set
- [ ] `<html lang>` reflects locale
- [ ] `noindex` on auth-gated pages

## i18n
- [ ] All strings via `t()`
- [ ] Keys added to both locale files

## a11y
- [ ] Semantic HTML
- [ ] Keyboard navigable
- [ ] Color contrast OK

## States
- [ ] Loading / empty / error UI present
```
