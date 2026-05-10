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

Most of Grades is auth-gated, so heavy SEO investment goes into the public surface (Login + future marketing). But every page needs correct base meta for browser tab labels + correct robots behaviour.

### Universal (every page, regardless of auth status)

- [ ] `<title>` — translated. Format: `${pageTitle} — ${siteName}`. **50–60 char max** before Google truncates
- [ ] `<meta name="description">` — translated, **150–160 char max**. This is the snippet Google often shows under your title in search results
- [ ] `<html lang="zh-TW">` or `lang="en"` — set programmatically by the i18n provider (NOT hardcoded in `index.html`)
- [ ] `<link rel="canonical" href="https://example.com/page">` — absolute URL of the canonical version. Prevents duplicate-content penalties from query params, trailing slashes, locale prefixes
- [ ] Favicon: `<link rel="icon" href="/favicon.ico">`
- [ ] Apple touch icon: `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` — for "Add to Home Screen" on iOS

### Auth-gated pages (Classes, Admin, Students, etc.)

Don't waste effort on social meta — these will never be shared.

- [ ] `<meta name="robots" content="noindex, nofollow">` — crawlers shouldn't index anything behind login
- [ ] No leaked internal data in HTML before the auth check redirects (don't render student names then redirect — render nothing then redirect)
- [ ] og:/twitter:/Schema.org tags **NOT needed** here

### Public pages (Login + future marketing)

These pages need the full SEO arsenal to compete in search.

#### Open Graph (Facebook, LinkedIn, LINE, WhatsApp previews)

- [ ] `<meta property="og:title">` — usually same as `<title>` minus the site-name suffix
- [ ] `<meta property="og:description">` — same as meta description
- [ ] `<meta property="og:image">` — **1200 × 630 px**, < 8 MB; absolute URL (`https://...`)
- [ ] `<meta property="og:url">` — absolute URL of this page
- [ ] `<meta property="og:type">` — `website` for landing, `article` for blog posts, `product` for product pages
- [ ] `<meta property="og:site_name">` — `Grades`
- [ ] `<meta property="og:locale">` — `zh_TW` or `en_US` (note underscore, not hyphen)
- [ ] `<meta property="og:locale:alternate">` — list each other supported locale

#### Twitter Cards (X)

- [ ] `<meta name="twitter:card" content="summary_large_image">`
- [ ] `<meta name="twitter:title">`, `<meta name="twitter:description">`, `<meta name="twitter:image">` — usually same as og: equivalents
- [ ] `<meta name="twitter:site" content="@handle">` — if Grades has a brand X / Twitter account

#### Multilingual hreflang (for pages that have both zh-TW and en versions)

Critical for ranking in **both** Chinese and English searches:

- [ ] `<link rel="alternate" hreflang="zh-TW" href="https://yoursite.com/zh-TW/page">`
- [ ] `<link rel="alternate" hreflang="en" href="https://yoursite.com/en/page">`
- [ ] `<link rel="alternate" hreflang="x-default" href="https://yoursite.com/en/page">` — fallback for unsupported locales

#### Schema.org structured data (JSON-LD) — **biggest ranking lift**

This is what gets you rich snippets (stars, prices, FAQ accordions) in Google results. Embed as `<script type="application/ld+json">`:

- [ ] **Homepage**: `Organization` + `WebSite` (with site search action if you have one)
- [ ] **Product / feature pages**: `SoftwareApplication` (since Grades is software) with `name`, `applicationCategory`, `operatingSystem`, optionally `offers`
- [ ] **Blog posts**: `Article` or `BlogPosting` with `author`, `datePublished`, `image`, `headline`, `mainEntityOfPage`
- [ ] **FAQ pages**: `FAQPage` with array of `Question` + `acceptedAnswer` (renders as expandable Q&A in Google!)
- [ ] **All public pages**: `BreadcrumbList` showing the page hierarchy
- [ ] **Contact / About**: `ContactPage` + `Organization` with logo, sameAs links to social profiles

**Test with**: <https://search.google.com/test/rich-results>

### Site-wide (one-time setup, not per page)

- [ ] `/robots.txt` exists and references `/sitemap.xml`:
  ```
  User-agent: *
  Allow: /
  Disallow: /classes
  Disallow: /admin
  Disallow: /students
  Sitemap: https://yoursite.com/sitemap.xml
  ```
- [ ] `/sitemap.xml` auto-generated, lists all public URLs with `<lastmod>` dates and `<priority>` (homepage 1.0, others 0.5–0.8)
- [ ] All public URLs use canonical form (consistent trailing-slash policy, lowercase, etc.)
- [ ] Submit sitemap in **Google Search Console** for indexing + ranking monitoring

### Tools

- Browser DevTools → Elements → inspect `<head>`
- <https://www.opengraph.xyz/> — preview Facebook / LINE / Twitter cards
- <https://search.google.com/test/rich-results> — validate Schema.org JSON-LD
- <https://search.google.com/search-console> — Google Search Console for ranking monitoring (need to verify ownership of domain first)
- <https://pagespeed.web.dev/> — Core Web Vitals (LCP / FID / CLS) — Google ranking factor

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
