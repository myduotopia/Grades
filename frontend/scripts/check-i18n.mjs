#!/usr/bin/env node
/**
 * i18n sanity check — runs before `tsc` as part of `npm run typecheck`.
 *
 * Catches two things TypeScript and JSON.parse both stay silent about:
 *   1. A duplicate key at the same level. JSON.parse keeps the LAST one, so
 *      an earlier block is silently dead and every t() in it renders the raw
 *      key on screen. Two top-level "errors" blocks did exactly that (#243).
 *      A JSON.parse reviver can't see this — duplicates have already been
 *      collapsed by the time it runs — so the keys are scanned from the raw
 *      text instead.
 *   2. A key present in one locale but missing in the other.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const LOCALES = ['zh-TW', 'en']
const fileFor = (loc) =>
  resolve(here, '..', 'src', 'i18n', 'locales', loc, 'common.json')

const problems = []
const BACKSLASH = String.fromCharCode(92)

/**
 * Walk the raw JSON text and report any key that appears twice inside the
 * same object. Returns a list of dotted paths (with the line number of the
 * repeat) — the file is assumed to be valid JSON; JSON.parse validates it.
 */
function findDuplicateKeys(text) {
  const dupes = []
  const stack = [] // { isArray, keys: Set, name: string }
  let line = 1
  let i = 0
  const pathOf = () =>
    stack
      .map((f) => f.name)
      .filter(Boolean)
      .join('.')

  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') {
      line++
      i++
    } else if (ch === '"') {
      // Read the string, then peek: a ':' after it means this was a key.
      const start = i
      i++
      while (i < text.length) {
        if (text[i] === BACKSLASH) i += 2
        else if (text[i] === '"') break
        else {
          if (text[i] === '\n') line++
          i++
        }
      }
      const raw = text.slice(start, i + 1)
      i++
      let j = i
      while (j < text.length && /\s/.test(text[j])) j++
      const frame = stack[stack.length - 1]
      if (text[j] === ':' && frame && !frame.isArray) {
        const key = JSON.parse(raw)
        if (frame.keys.has(key)) {
          const where = pathOf()
          dupes.push(`${where ? `${where}.` : ''}${key} (line ${line})`)
        }
        frame.keys.add(key)
        frame.pendingKey = key
      }
    } else if (ch === '{' || ch === '[') {
      const parent = stack[stack.length - 1]
      stack.push({
        isArray: ch === '[',
        keys: new Set(),
        name: parent ? (parent.pendingKey ?? '') : '',
      })
      if (parent) parent.pendingKey = null
      i++
    } else if (ch === '}' || ch === ']') {
      stack.pop()
      i++
    } else {
      i++
    }
  }
  return dupes
}

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, full, out)
    else out.add(full)
  }
  return out
}

const keysets = {}
for (const loc of LOCALES) {
  const label = `${loc}/common.json`
  const text = readFileSync(fileFor(loc), 'utf8')
  for (const d of findDuplicateKeys(text)) {
    problems.push(`${label}: duplicate key "${d}" — the earlier one is dead`)
  }
  keysets[loc] = flatten(JSON.parse(text))
}

const [a, b] = LOCALES
for (const [from, to] of [
  [a, b],
  [b, a],
]) {
  for (const k of keysets[from]) {
    if (!keysets[to].has(k)) {
      problems.push(`"${k}" exists in ${from} but is missing from ${to}`)
    }
  }
}

if (problems.length) {
  console.error('i18n check failed:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`i18n check ok (${keysets[a].size} keys × ${LOCALES.length} locales)`)
