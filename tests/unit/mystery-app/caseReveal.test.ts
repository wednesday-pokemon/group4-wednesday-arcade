// Case-file reveal (docs/MYSTERY_CASES.md): timeline, poses, and secrecy of the rendered markup. Presentation only —
// the reveal shows the case it is given and never names a suspect.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CaseReveal, caseFiles, filePose, REVEAL_PHASES, REVEAL_SOUNDS, REVEAL_TOTAL_MS, revealPhaseAt, type RevealPhase,
} from '../../../src/ui/mystery/CaseReveal.tsx';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { FIXED_SOLUTIONS as CASE_SOLUTIONS } from '../mystery/fixedSolutions.ts';
import type { CaseDef } from '../../../src/mystery/types.ts';

const ALL_CASES = Object.values(CASES);
const PHASES: RevealPhase[] = ['deal', 'spread', 'shuffle', 'assign', 'ready'];
const render = (caseDef: CaseDef, initialPhase?: RevealPhase) =>
  renderToStaticMarkup(createElement(CaseReveal, { caseDef, onDone: () => undefined, initialPhase }));
// Every suspect name (full, first and last) across the three cases.
const SUSPECT_WORDS = [...new Set(ALL_CASES.flatMap((c) => c.suspects.flatMap((s) => [s.name, ...s.name.split(' ')])))];

describe('case reveal timeline', () => {
  it('deal → spread → shuffle → assign → ready in 3–5 s', () => {
    expect(REVEAL_PHASES.map((p) => p.phase)).toEqual(PHASES);
    expect(REVEAL_TOTAL_MS).toBeGreaterThanOrEqual(3000);
    expect(REVEAL_TOTAL_MS).toBeLessThanOrEqual(5000);
    expect(revealPhaseAt(0)).toBe('deal');
    expect(revealPhaseAt(REVEAL_PHASES[2]!.atMs + 1)).toBe('shuffle');
    expect(revealPhaseAt(REVEAL_TOTAL_MS)).toBe('ready');
    expect(revealPhaseAt(60_000)).toBe('ready');
  });

  it('paper while dealing/spreading, shuffle while shuffling, stamp during assign', () => {
    const at = (p: RevealPhase) => REVEAL_SOUNDS.filter((s) => revealPhaseAt(s.atMs) === p).map((s) => s.sfx);
    expect(at('deal')).toContain('paper');
    expect(at('spread')).toContain('paper');
    expect(at('shuffle')).toContain('shuffle');
    expect(at('assign')).toEqual(['stamp']);
    expect(at('ready')).toEqual([]);
  });

  it('three files in number order', () => {
    expect(caseFiles().map((c) => c.number)).toEqual(['01', '02', '03']);
  });

  it('poses: fanned out while spread; the assigned file ends on top, larger, the others dimmed behind', () => {
    for (let assigned = 0; assigned < 3; assigned++) {
      const spread = [0, 1, 2].map((s) => filePose('spread', s, assigned));
      expect(new Set(spread.map((p) => p.x)).size).toBe(3);
      expect(spread.every((p) => !p.dim)).toBe(true);
      // the spread does not depend on which file is assigned (no tell before the shuffle)
      expect(spread).toEqual([0, 1, 2].map((s) => filePose('spread', s, (assigned + 1) % 3)));
      for (const phase of ['assign', 'ready'] as const) {
        const poses = [0, 1, 2].map((s) => filePose(phase, s, assigned));
        const top = poses[assigned]!;
        expect(top.dim).toBe(false);
        expect(top.scale).toBeGreaterThan(1);
        for (const [i, p] of poses.entries()) {
          if (i === assigned) continue;
          expect(p.dim).toBe(true);
          expect(p.z).toBeLessThan(top.z);
        }
        const others = poses.filter((_, i) => i !== assigned);
        expect(Math.sign(others[0]!.x)).toBe(-Math.sign(others[1]!.x)); // one peeks out on each side
      }
    }
  });
});

describe('case reveal markup', () => {
  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: marks the assigned file in every phase; all three numbers + titles present', (_id, c) => {
    for (const phase of PHASES) {
      const html = render(c, phase);
      expect(html).toContain('data-testid="screen-case-reveal"');
      expect(html).toContain(`data-case="${c.id}"`);
      expect(html).toContain(`data-phase="${phase}"`);
      for (const f of ALL_CASES) {
        expect(html).toContain(`Case ${f.number}`);
        expect(html).toContain(f.title);
      }
      expect(html.match(/data-testid="case-file-assigned"/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`data-number="${c.number}" data-testid="case-file-assigned"`));
    }
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: ready shows number, title, tagline, setting and Begin; no Skip', (_id, c) => {
    const html = render(c, 'ready');
    expect(html).toContain('data-testid="btn-case-begin"');
    expect(html).not.toContain('data-testid="btn-case-skip"');
    expect(html).toContain('case-reveal__brief is-ready');
    expect(html).toContain(c.tagline);
    expect(html).toContain(c.setting);
    expect(html).toContain('Assigned');
    expect(html).toContain('data-pose="thumbsUp"');
  });

  it('runs from the deal with Skip available, Thing hidden and the brief not yet shown', () => {
    const html = render(CASES.crypt_last_witness);
    expect(html).toContain('data-phase="deal"');
    expect(html).toContain('data-testid="btn-case-skip"');
    expect(html).not.toContain('case-reveal__brief is-ready');
    expect(html).not.toContain('data-testid="case-reveal-thing"');
    expect(render(CASES.crypt_last_witness, 'assign')).toContain('data-pose="point"');
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: never names a suspect or hints at an answer', (_id, c) => {
    const sol = CASE_SOLUTIONS[c.id];
    for (const phase of PHASES) {
      const html = render(c, phase);
      for (const w of SUSPECT_WORDS) expect(html).not.toContain(w);
      expect(html).not.toMatch(/culprit|guilty|murderer|suspect/i);
      expect(html).not.toContain(sol.resolution.slice(0, 40).replace(/'/g, "&#x27;"));
      for (const clue of c.clues) expect(html).not.toContain(clue.title.replace(/'/g, "&#x27;"));
    }
  });

  it('the three files are dealt identically for every case (only the marker and the hidden brief differ)', () => {
    const strip = (h: string, c: CaseDef) => h
      .replace(`data-case="${c.id}"`, '')
      .replace(/data-testid="case-file-(assigned|0\d)"/g, '')
      .replace(/ cfile--assigned/g, '')
      .replace(/<section class="case-reveal__brief[\s\S]*<\/section>/, '');
    const deal = ALL_CASES.map((c) => strip(render(c, 'deal'), c).replace(/<span class="cfile__stamp"[^<]*<\/span>/g, ''));
    expect(new Set(deal).size).toBe(1);
  });
});
