/**
 * The pure half of the Evolución tab (QW4): which notes it shows, how a note is
 * created, how the deep link from Diagnóstico is read, and how the whole
 * history is fetched for printing.
 *
 * Layer files are imported by relative path: `frontend/module_layers` does not
 * resolve on this Windows host.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  EVOLUTION_CLINICAL_TYPES,
  MAX_PRINT_PAGES,
  PRINT_PAGE_SIZE,
  attachmentPrintLine,
  buildCreatePayload,
  composerIntentFromQuery,
  contextLabel,
  fetchAllClinicalNotes,
  isFdiTooth,
  sortForPrint,
  toPrintPatient,
  withoutComposerIntent
} from '../../../backend/app/modules/clinical_notes/frontend/utils/evolutionNotes'
import type {
  RecentPageRequest
} from '../../../backend/app/modules/clinical_notes/frontend/utils/evolutionNotes'
import type { RecentNoteEntry } from '../../app/types'

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

function note(id: string, createdAt: string, overrides: Partial<RecentNoteEntry> = {}): RecentNoteEntry {
  return {
    id,
    note_type: 'evolution',
    owner_type: 'patient',
    owner_id: 'p1',
    tooth_number: null,
    body: `body ${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    author: { id: 'u1', full_name: 'Dra. Ruiz', email: null },
    linked: { kind: 'patient', id: 'p1', label: null, tooth_number: null },
    attachments: [],
    ...overrides
  }
}

/** `count` notes, newest first, one minute apart. */
function history(count: number): RecentNoteEntry[] {
  const base = Date.parse('2026-01-01T00:00:00Z')
  return Array.from({ length: count }, (_, i) =>
    note(`n${String(count - i).padStart(4, '0')}`, new Date(base + (count - i) * 60_000).toISOString())
  )
}

/** A fake `/recent`: newest first, `created_at < before`, `limit` rows. */
function server(all: RecentNoteEntry[]) {
  const calls: RecentPageRequest[] = []
  const fetchPage = async (request: RecentPageRequest) => {
    calls.push(request)
    const eligible = all.filter(n => request.before === undefined || n.created_at < request.before)
    return eligible.slice(0, request.limit)
  }
  return { fetchPage, calls }
}

// ---------------------------------------------------------------------------

describe('what the tab shows', () => {
  it('is the clinical types, and never a reception note', () => {
    expect([...EVOLUTION_CLINICAL_TYPES]).toEqual([
      'evolution',
      'diagnosis',
      'treatment',
      'treatment_plan',
      'appointment_clinical'
    ])
    expect(EVOLUTION_CLINICAL_TYPES).not.toContain('administrative')
    expect(EVOLUTION_CLINICAL_TYPES).not.toContain('appointment_administrative')
  })
})

describe('creating a note', () => {
  const submission = { body: 'Mejoría', toothNumber: null, attachmentDocumentIds: ['d1', 'd2'] }

  it('"+ Nueva evolución" creates an evolution owned by the patient', () => {
    expect(buildCreatePayload({ noteType: 'evolution' }, 'p1', submission)).toEqual({
      note_type: 'evolution',
      owner_type: 'patient',
      owner_id: 'p1',
      tooth_number: null,
      body: 'Mejoría',
      attachment_document_ids: ['d1', 'd2']
    })
  })

  it('an evolution never carries a tooth, even if one is handed in', () => {
    const payload = buildCreatePayload({ noteType: 'evolution' }, 'p1', { ...submission, toothNumber: 36 })
    expect(payload.tooth_number).toBeNull()
  })

  it('the deep-linked diagnosis note keeps its tooth and stays a diagnosis', () => {
    const payload = buildCreatePayload({ noteType: 'diagnosis' }, 'p1', { ...submission, toothNumber: 36 })
    expect(payload).toMatchObject({
      note_type: 'diagnosis',
      owner_type: 'patient',
      owner_id: 'p1',
      tooth_number: 36
    })
  })

  it('a diagnosis whose tooth the clinician unticked is unbound, not guessed', () => {
    expect(buildCreatePayload({ noteType: 'diagnosis' }, 'p1', submission).tooth_number).toBeNull()
  })

  it('carries the attachments', () => {
    expect(buildCreatePayload({ noteType: 'evolution' }, 'p1', submission).attachment_document_ids)
      .toEqual(['d1', 'd2'])
  })
})

describe('the deep link from Diagnóstico', () => {
  it('?newNote=diagnosis&tooth=<FDI> opens a diagnosis note bound to that tooth', () => {
    expect(composerIntentFromQuery({ newNote: 'diagnosis', tooth: '36' }))
      .toEqual({ noteType: 'diagnosis', toothNumber: 36 })
  })

  it('without a tooth it does not invent one', () => {
    expect(composerIntentFromQuery({ newNote: 'diagnosis' }))
      .toEqual({ noteType: 'diagnosis', toothNumber: null })
  })

  it.each(['0', '9', '19', '49', '56', '90', 'abc', '3.6', '-36', ''])(
    'an invalid tooth (%s) is dropped, not coerced',
    (tooth) => {
      expect(composerIntentFromQuery({ newNote: 'diagnosis', tooth })?.toothNumber).toBeNull()
    }
  )

  it('a tooth with no newNote opens nothing', () => {
    expect(composerIntentFromQuery({ tooth: '36' })).toBeNull()
    expect(composerIntentFromQuery({})).toBeNull()
  })

  it('an unknown newNote opens nothing', () => {
    expect(composerIntentFromQuery({ newNote: 'administrative', tooth: '36' })).toBeNull()
    expect(composerIntentFromQuery({ newNote: 'treatment' })).toBeNull()
  })

  it('reads the first value of a repeated parameter', () => {
    expect(composerIntentFromQuery({ newNote: ['diagnosis', 'x'], tooth: ['46', '11'] }))
      .toEqual({ noteType: 'diagnosis', toothNumber: 46 })
  })

  it('FDI validation: permanent 11–48, deciduous 51–85', () => {
    for (const ok of [11, 18, 21, 28, 31, 38, 41, 48, 51, 55, 65, 75, 85]) expect(isFdiTooth(ok), String(ok)).toBe(true)
    for (const bad of [10, 19, 29, 49, 56, 66, 86, 90, 100, 1.5, Number.NaN]) expect(isFdiTooth(bad), String(bad)).toBe(false)
  })

  it('the parameters are removed once consumed, and nothing else is', () => {
    const query = { tab: 'clinical', clinicalMode: 'evolution', newNote: 'diagnosis', tooth: '36' }
    expect(withoutComposerIntent(query)).toEqual({ tab: 'clinical', clinicalMode: 'evolution' })
    // …so reading it again opens nothing: a refresh does not reopen the composer.
    expect(composerIntentFromQuery(withoutComposerIntent(query))).toBeNull()
    // The input is not mutated.
    expect(query.newNote).toBe('diagnosis')
  })
})

describe('fetching the whole history for printing', () => {
  it('pages /recent with limit=100 and the clinical types, never administrative', async () => {
    const { fetchPage, calls } = server(history(250))
    await fetchAllClinicalNotes(fetchPage)

    expect(PRINT_PAGE_SIZE).toBe(100)
    expect(calls.map(c => c.limit)).toEqual([100, 100, 100])
    for (const call of calls) {
      expect(call.types).toEqual([...EVOLUTION_CLINICAL_TYPES])
      expect(call.types).not.toContain('administrative')
    }
    expect(calls[0]!.before).toBeUndefined()
  })

  it('returns every note, not just the first page', async () => {
    const all = history(250)
    const { notes, complete } = await fetchAllClinicalNotes(server(all).fetchPage)

    expect(notes).toHaveLength(250)
    expect(complete).toBe(true)
    expect(new Set(notes.map(n => n.id)).size).toBe(250)
  })

  it('advances the cursor to the oldest note of each page', async () => {
    const all = history(250)
    const { fetchPage, calls } = server(all)
    await fetchAllClinicalNotes(fetchPage)

    expect(calls[1]!.before).toBe(all[99]!.created_at)
    expect(calls[2]!.before).toBe(all[199]!.created_at)
  })

  it('a history that is an exact multiple of the page size ends on an empty page', async () => {
    const { notes, complete } = await fetchAllClinicalNotes(server(history(200)).fetchPage)
    expect(notes).toHaveLength(200)
    expect(complete).toBe(true)
  })

  it('a patient with no notes is a complete, empty history', async () => {
    const fetchPage = vi.fn(async () => [])
    expect(await fetchAllClinicalNotes(fetchPage)).toEqual({ notes: [], complete: true })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates by id when a note comes back twice', async () => {
    const all = history(150)
    // The oldest note of page 1 is returned again at the head of page 2.
    const pages = [all.slice(0, 100), [all[99]!, ...all.slice(100)]]
    let call = 0
    const { notes, complete } = await fetchAllClinicalNotes(async () => pages[call++] ?? [])

    expect(notes).toHaveLength(150)
    expect(new Set(notes.map(n => n.id)).size).toBe(150)
    expect(complete).toBe(true)
  })

  it('stops, and says so, when the cursor does not advance', async () => {
    // A server that answers the same full page forever.
    const stuck = history(100)
    const fetchPage = vi.fn(async () => stuck)
    const { notes, complete } = await fetchAllClinicalNotes(fetchPage)

    expect(complete).toBe(false)
    expect(notes).toHaveLength(100)
    // Page 1 sets the cursor, page 2 proves it did not move: no third request.
    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('stops when a full page holds nothing it has not already seen', async () => {
    const first = history(100)
    const repeatedWithNewCursor = first.map(n => ({ ...n, created_at: '2025-01-01T00:00:00.000Z' }))
    let call = 0
    const fetchPage = vi.fn(async () => (call++ === 0 ? first : repeatedWithNewCursor))
    const { complete } = await fetchAllClinicalNotes(fetchPage)

    expect(complete).toBe(false)
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('has a page budget, so a pathological server cannot loop it forever', async () => {
    let page = 0
    // Every page is full, unseen, and with a strictly older cursor — forever.
    const fetchPage = vi.fn(async () => {
      page += 1
      return Array.from({ length: 2 }, (_, i) =>
        note(`p${page}-${i}`, new Date(Date.UTC(2026, 0, 1) - page * 60_000 - i).toISOString()))
    })
    const { complete } = await fetchAllClinicalNotes(fetchPage, EVOLUTION_CLINICAL_TYPES, 2, 5)

    expect(complete).toBe(false)
    expect(fetchPage).toHaveBeenCalledTimes(5)
    expect(MAX_PRINT_PAGES).toBeGreaterThan(5)
  })

  it('honours a narrower set of types when asked', async () => {
    const { fetchPage, calls } = server([])
    await fetchAllClinicalNotes(fetchPage, ['evolution'])
    expect(calls[0]!.types).toEqual(['evolution'])
  })
})

describe('print order', () => {
  it('is oldest first, whatever order the pages arrived in', () => {
    const sorted = sortForPrint(history(5))
    expect(sorted.map(n => n.id)).toEqual(['n0001', 'n0002', 'n0003', 'n0004', 'n0005'])
  })

  it('is stable for notes written in the same instant', () => {
    const same = '2026-03-03T10:00:00Z'
    const a = sortForPrint([note('b', same), note('c', same), note('a', same)])
    const b = sortForPrint([note('c', same), note('a', same), note('b', same)])
    expect(a.map(n => n.id)).toEqual(['a', 'b', 'c'])
    expect(b).toEqual(a)
  })

  it('does not mutate its input', () => {
    const input = history(3)
    const before = input.map(n => n.id)
    sortForPrint(input)
    expect(input.map(n => n.id)).toEqual(before)
  })
})

describe('reading a note', () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key

  it('names the tooth, the treatment, the plan', () => {
    expect(contextLabel({ kind: 'patient', id: 'p', label: null, tooth_number: 47 }, t))
      .toBe('clinicalNotes.linked.tooth:{"n":47}')
    expect(contextLabel({ kind: 'treatment', id: 't', label: 'Endodoncia', tooth_number: 36 }, t))
      .toBe('clinicalNotes.linked.treatmentOnTooth:{"label":"Endodoncia","n":36}')
    expect(contextLabel({ kind: 'plan', id: 'x', label: 'PLAN-1', tooth_number: null }, t))
      .toBe('clinicalNotes.linked.planNamed:{"label":"PLAN-1"}')
  })

  it('a plain evolution has no context', () => {
    expect(contextLabel({ kind: 'patient', id: 'p', label: null, tooth_number: null }, t)).toBeNull()
    expect(contextLabel(null, t)).toBeNull()
  })

  it('names an appointment only when asked, so the other feeds keep their layout', () => {
    const appointment = { kind: 'appointment' as const, id: 'a', label: null, tooth_number: null }
    expect(contextLabel(appointment, t)).toBeNull()
    expect(contextLabel(appointment, t, { appointment: true })).toBe('clinicalNotes.linked.appointment')
  })

  it('an attachment prints as its name and its type, nothing rendered', () => {
    expect(attachmentPrintLine({
      title: 'Rx panorámica', document_id: 'abcdef123456', mime_type: 'image/jpeg', media_kind: 'xray'
    })).toBe('Rx panorámica (JPEG)')
    expect(attachmentPrintLine({
      title: 'Consentimiento', document_id: 'abcdef123456', mime_type: 'application/pdf', media_kind: null
    })).toBe('Consentimiento (PDF)')
    expect(attachmentPrintLine({
      title: null, document_id: 'abcdef123456', mime_type: null, media_kind: null
    })).toBe('abcdef12')
  })
})

describe('who the printout is about', () => {
  it('reduces a cached patient to a name and a document', () => {
    expect(toPrintPatient({ first_name: ' Ana ', last_name: 'García', national_id: '12345678Z', extra: 'x' } as never))
      .toEqual({ fullName: 'Ana García', documentNumber: '12345678Z' })
  })

  it('omits what it does not have rather than printing a blank', () => {
    expect(toPrintPatient({ first_name: 'Ana', last_name: 'García' }))
      .toEqual({ fullName: 'Ana García', documentNumber: null })
  })

  it('no patient, or nothing printable, is no identity', () => {
    expect(toPrintPatient(null)).toBeNull()
    expect(toPrintPatient(undefined)).toBeNull()
    expect(toPrintPatient({ first_name: ' ', last_name: '' })).toBeNull()
  })
})
